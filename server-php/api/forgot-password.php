<?php
// server-php/api/forgot-password.php — request OTP and send email
require_once __DIR__ . '/../helpers/mail_helper.php';
require_once __DIR__ . '/../helpers/log_helper.php';
global $mysqli;

$request_method = $_SERVER['REQUEST_METHOD'];
$input = get_input();

if ($request_method !== 'POST') {
    json_response(['error' => 'method_not_allowed'], 405);
}

$email = isset($input['email']) ? trim((string) $input['email']) : '';
if ($email === '') {
    json_response(['error' => 'Missing email'], 400);
}

// Optional: ensure table exists
$createTable = "CREATE TABLE IF NOT EXISTS `tbl_password_reset_otps` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `email` varchar(255) NOT NULL,
  `otp_code` varchar(6) NOT NULL,
  `expires_at` datetime NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `email` (`email`),
  KEY `expires_at` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";
$mysqli->query($createTable);

$stmt = $mysqli->prepare("SELECT user_id, first_name, last_name, email FROM tbl_users WHERE email = ? LIMIT 1");
$stmt->bind_param("s", $email);
$stmt->execute();
$user = $stmt->get_result()->fetch_assoc();
$stmt->close();

// Always return same message for security (don't reveal if email exists)
$genericSuccess = ['message' => 'If this email is registered, you will receive a one-time password shortly. The code expires in 2 minutes.'];

if (!$user) {
    json_response($genericSuccess, 200);
}

$otp = (string) random_int(100000, 999999);
$otpTtlSeconds = 2 * 60; // 2 minutes
$expiresAt = date('Y-m-d H:i:s', time() + $otpTtlSeconds);

$delStmt = $mysqli->prepare("DELETE FROM tbl_password_reset_otps WHERE email = ?");
$delStmt->bind_param("s", $email);
$delStmt->execute();
$delStmt->close();

$insStmt = $mysqli->prepare("INSERT INTO tbl_password_reset_otps (email, otp_code, expires_at) VALUES (?, ?, ?)");
$insStmt->bind_param("sss", $email, $otp, $expiresAt);
if (!$insStmt->execute()) {
    json_response(['error' => 'Failed to save OTP'], 500);
}
$insStmt->close();

$sent = send_forgot_password_email(
    $user['email'],
    $user['first_name'] ?? '',
    $user['last_name'] ?? '',
    $otp
);

// Log the password reset request
log_system_action($mysqli, (int)$user['user_id'], 'request_password_reset', "Password reset OTP requested for account {$user['email']}");

// In all cases we return success; in local/dev we can also expose the OTP for easier testing.
$response = $genericSuccess;

// If sending failed, log a clear message for debugging.
if (!$sent && function_exists('error_log')) {
    error_log('[forgot-password] Failed to send OTP email to ' . $email);
}

// Developer-friendly fallback: when running on localhost, include the OTP in the response
// so you can test the flow even if email is blocked.
$host = $_SERVER['HTTP_HOST'] ?? ($_SERVER['SERVER_NAME'] ?? '');
if ($host === 'localhost' || strpos($host, '127.0.0.1') !== false) {
    $response['debug_otp'] = $otp;
}

json_response($response, 200);
