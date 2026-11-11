<?php
// Database-backed regression checks use only a connection-local temporary table.
require __DIR__ . '/../config/database.php';
require __DIR__ . '/../helpers/password_reset_helper.php';
function reset_steps_check($condition, $message) {
    if (!$condition) throw new RuntimeException($message);
}
$mysqli->query('CREATE TEMPORARY TABLE tbl_password_reset_secure (
    email VARCHAR(255) PRIMARY KEY, verifier CHAR(64) NOT NULL,
    expires_at BIGINT NOT NULL, attempts INT NOT NULL DEFAULT 0
) ENGINE=InnoDB');
$email = 'reset-test@example.invalid';
try {
    reset_store_code($mysqli, $email, '123456');
    $checked = reset_verify_code($mysqli, $email, '123456');
    reset_steps_check($checked['ok'], 'Correct OTP failed verification');
    reset_steps_check(strlen($checked['reset_token']) === 64, 'Reset token missing');
    reset_steps_check($checked['expires_at'] >= time() + 590, 'Reset token has no independent ten-minute lifetime');
    reset_steps_check(!reset_verify_code($mysqli, $email, '123456')['ok'], 'OTP was not consumed by verification');
    $updates = 0;
    $saved = reset_consume_code($mysqli, $email, $checked['reset_token'], function () use (&$updates) { $updates++; });
    reset_steps_check($saved['ok'] && $updates === 1, 'Verified reset failed');
    $replay = reset_consume_code($mysqli, $email, $checked['reset_token'], function () use (&$updates) { $updates++; });
    reset_steps_check(!$replay['ok'] && $updates === 1, 'Consumed code was accepted again');
    echo "PASS OTP exchanged for independent ten-minute token; save consumes token; replay rejected\n";

    reset_store_code($mysqli, $email, '123456');
    $prior = reset_verify_code($mysqli, $email, '123456');
    reset_store_code($mysqli, $email, '654321');
    $old = reset_consume_code($mysqli, $email, $prior['reset_token'], function () use (&$updates) { $updates++; });
    reset_steps_check(!$old['ok'] && $updates === 1, 'Resend did not invalidate verified old OTP');
    $fresh = reset_verify_code($mysqli, $email, '654321');
    reset_steps_check($fresh['ok'], 'Resent OTP failed');
    echo "PASS resend invalidates old reset authorization and verifies new OTP\n";

    $mysqli->query('UPDATE tbl_password_reset_secure SET expires_at = UNIX_TIMESTAMP() - 1');
    reset_steps_check(!reset_verify_code($mysqli, $email, '654321')['ok'], 'Expired OTP verified');
    reset_steps_check(!reset_consume_code($mysqli, $email, $fresh['reset_token'], function () use (&$updates) { $updates++; })['ok'], 'Expired reset token reset password');
    echo "PASS reset authorization expiry enforced on final save\n";

    reset_store_code($mysqli, $email, '123456');
    for ($i = 0; $i < 5; $i++) reset_steps_check(!reset_verify_code($mysqli, $email, '999999')['ok'], 'Wrong OTP accepted');
    reset_steps_check(!reset_verify_code($mysqli, $email, '123456')['ok'], 'Five-attempt lockout bypassed');
    echo "PASS incorrect codes count toward five-attempt lockout\n";
} finally {
    $mysqli->query('DROP TEMPORARY TABLE tbl_password_reset_secure');
}
