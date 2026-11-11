<?php
// All database fixtures shadow live tables only for this connection. No mail is sent.
require __DIR__ . '/../config/database.php';
require __DIR__ . '/../helpers/security_policy_helper.php';
function app_user_status_is_active($value) { return in_array(strtolower(trim((string)$value)), ['active', '1', 'true'], true); }
function temporary_password_check($ok, $message) { if (!$ok) throw new RuntimeException($message); }

for ($i = 0; $i < 500; $i++) {
    $password = security_policy_generate_temporary_password(6);
    temporary_password_check(strlen($password) === 6 && preg_match('/[A-Z]/', $password) && preg_match('/[a-z]/', $password) && preg_match('/[0-9]/', $password) && preg_match('/[!@#$%*\-_]/', $password), 'Temporary password composition failed.');
}
$mysqli->query("CREATE TEMPORARY TABLE tbl_users (user_id INT PRIMARY KEY, email VARCHAR(255), password_hash VARCHAR(255), status VARCHAR(20), role_id INT, dept_id INT, is_first_login INT DEFAULT 0, token_version INT DEFAULT 0, temporary_password_expires_at DATETIME NULL, temporary_password_sent_at DATETIME NULL, password_changed_at DATETIME NULL) ENGINE=InnoDB");
$mysqli->query("CREATE TEMPORARY TABLE tbl_password_history (history_id BIGINT AUTO_INCREMENT PRIMARY KEY, user_id INT, password_hash VARCHAR(255), created_at DATETIME DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB");
$mysqli->query("CREATE TEMPORARY TABLE tbl_user_sessions (session_id CHAR(64) PRIMARY KEY, user_id INT, token_version INT DEFAULT 0, csrf_token_hash CHAR(64), created_at DATETIME DEFAULT CURRENT_TIMESTAMP, last_activity_at DATETIME DEFAULT CURRENT_TIMESTAMP, absolute_expires_at DATETIME, revoked_at DATETIME NULL) ENGINE=InnoDB");
security_schema_ensure($mysqli);
$oldHash = password_hash('OldPassword7!', PASSWORD_BCRYPT);
$stmt = $mysqli->prepare("INSERT INTO tbl_users (user_id,email,password_hash,status,role_id,dept_id) VALUES (1,'test@example.invalid',?,'active',5,1)");
$stmt->bind_param('s', $oldHash); $stmt->execute();
$mysqli->query("INSERT INTO tbl_user_sessions (session_id,user_id,absolute_expires_at) VALUES ('session',1,DATE_ADD(NOW(),INTERVAL 1 HOUR))");
$expected = $mysqli->query('SELECT * FROM tbl_users WHERE user_id=1')->fetch_assoc();
$mysqli->begin_transaction();
try {
    security_apply_reset_temporary_password($mysqli, $expected, static function () { return false; });
    throw new RuntimeException('Email failure was accepted.');
} catch (RuntimeException $error) {
    $mysqli->rollback();
    temporary_password_check($error->getMessage() === 'mail_delivery_failed', 'Unexpected failure.');
}
$after = $mysqli->query('SELECT * FROM tbl_users WHERE user_id=1')->fetch_assoc();
temporary_password_check($after === $expected, 'Failed mail changed the account.');
temporary_password_check((int)$mysqli->query('SELECT COUNT(*) n FROM tbl_password_history')->fetch_assoc()['n'] === 0, 'Failed reset retained password history.');
temporary_password_check($mysqli->query("SELECT revoked_at FROM tbl_user_sessions WHERE session_id='session'")->fetch_assoc()['revoked_at'] === null, 'Failed reset revoked a session.');

$delivered = null;
$mysqli->begin_transaction();
security_apply_reset_temporary_password($mysqli, $expected, static function ($password) use (&$delivered) { $delivered = $password; return true; });
$mysqli->commit();
$after = $mysqli->query('SELECT * FROM tbl_users WHERE user_id=1')->fetch_assoc();
temporary_password_check(password_verify($delivered, $after['password_hash']) && !password_verify('OldPassword7!', $after['password_hash']), 'Stored password differs from the mailed password.');
temporary_password_check((int)$after['is_first_login'] === 1 && (int)$after['token_version'] === 1, 'First-login or session version not enforced.');
temporary_password_check($after['temporary_password_expires_at'] === null, 'Temporary reset password must have no expiry timer.');
temporary_password_check($mysqli->query("SELECT revoked_at FROM tbl_user_sessions WHERE session_id='session'")->fetch_assoc()['revoked_at'] !== null, 'Prior session was not revoked.');
temporary_password_check(security_password_was_used($mysqli, 1, 'OldPassword7!'), 'Prior password was not preserved.');
$mysqli->begin_transaction();
try {
    security_apply_reset_temporary_password($mysqli, $expected, static function () { throw new RuntimeException('Stale reset sent email.'); });
    throw new RuntimeException('Stale reset succeeded.');
} catch (RuntimeException $error) {
    $mysqli->rollback();
    temporary_password_check($error->getMessage() === 'reset_account_changed', 'Stale reset was not blocked before email.');
}
echo "PASS six-character composition, mail-failure rollback, password/hash agreement, expiry, first-login, history, session revocation, and stale reset protection. No live accounts or emails changed.\n";
