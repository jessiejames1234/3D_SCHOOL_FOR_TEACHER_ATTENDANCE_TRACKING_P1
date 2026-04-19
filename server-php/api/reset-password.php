<?php
// server-php/api/reset-password.php — verify OTP and set new password
global $mysqli;

$request_method = $_SERVER['REQUEST_METHOD'];
$input = get_input();

if ($request_method !== 'POST') {
    json_response(['error' => 'method_not_allowed'], 405);
}

$email = isset($input['email']) ? trim((string) $input['email']) : '';
$otp = isset($input['otp']) ? trim((string) $input['otp']) : '';
$newPassword = $input['new_password'] ?? '';

if ($email === '' || $otp === '') {
    json_response(['error' => 'Missing email or OTP'], 400);
}

// Strong password policy (matches UI):
// - At least 8 characters
// - At least 1 letter (A–Z or a–z)
// - At least 1 digit (0–9)
// - At least 1 special character (non-alphanumeric)
if (!is_string($newPassword) || strlen($newPassword) < 8) {
    json_response(['error' => 'Password must be at least 8 characters long.'], 400);
}
if (!preg_match('/[A-Za-z]/', $newPassword) ||
    !preg_match('/[0-9]/', $newPassword) ||
    !preg_match('/[^A-Za-z0-9]/', $newPassword)) {
    json_response([
        'error' => 'Password must include a letter, a number, and a special character.'
    ], 400);
}

$stmt = $mysqli->prepare("SELECT id, email, otp_code, expires_at FROM tbl_password_reset_otps WHERE email = ? ORDER BY created_at DESC LIMIT 1");
$stmt->bind_param("s", $email);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$row) {
    json_response(['error' => 'Invalid or expired OTP'], 400);
}
if (strtotime($row['expires_at']) < time()) {
    $del = $mysqli->prepare("DELETE FROM tbl_password_reset_otps WHERE email = ?");
    $del->bind_param("s", $email);
    $del->execute();
    $del->close();
    json_response(['error' => 'OTP has expired (valid for 2 minutes). Please request a new code.'], 400);
}
if (!hash_equals($row['otp_code'], $otp)) {
    json_response(['error' => 'Invalid OTP'], 400);
}

$passwordHash = password_hash($newPassword, PASSWORD_BCRYPT);
$up = $mysqli->prepare("UPDATE tbl_users SET password_hash = ? WHERE email = ?");
$up->bind_param("ss", $passwordHash, $email);
if (!$up->execute()) {
    json_response(['error' => 'Failed to update password'], 500);
}
$up->close();

$del = $mysqli->prepare("DELETE FROM tbl_password_reset_otps WHERE email = ?");
$del->bind_param("s", $email);
$del->execute();
$del->close();

json_response(['message' => 'Password has been reset. You can sign in with your new password.'], 200);
