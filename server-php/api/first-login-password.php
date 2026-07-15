<?php
// server-php/api/first-login-password.php
global $mysqli;

$request_method = $_SERVER['REQUEST_METHOD'];
$input = get_input();

if ($request_method !== 'POST') {
    json_response(['ok' => false, 'error' => 'method_not_allowed'], 405);
}

$auth = app_decode_auth_token_payload(true);
$userId = isset($auth['user_id']) ? (int)$auth['user_id'] : 0;
if ($userId <= 0) {
    json_response(['ok' => false, 'error' => 'missing_authorization'], 401);
}

$newPassword = $input['new_password'] ?? '';
$confirmPassword = $input['confirm_password'] ?? '';

if (!is_string($newPassword) || !is_string($confirmPassword)) {
    json_response(['ok' => false, 'error' => 'invalid_password'], 400);
}

if ($newPassword !== $confirmPassword) {
    json_response(['ok' => false, 'error' => 'password_mismatch', 'message' => 'Passwords do not match.'], 400);
}

$firstLoginColCheck = $mysqli->query("SHOW COLUMNS FROM tbl_users LIKE 'is_first_login'");
$hasFirstLoginCol = $firstLoginColCheck && $firstLoginColCheck->num_rows > 0;

$stmt = $mysqli->prepare("SELECT user_id, first_name, last_name, id_number, password_hash FROM tbl_users WHERE user_id = ? LIMIT 1");
if (!$stmt) {
    json_response(['ok' => false, 'error' => 'db_prepare_failed', 'details' => $mysqli->error], 500);
}
$stmt->bind_param('i', $userId);
$stmt->execute();
$user = $stmt->get_result()->fetch_assoc();
$stmt->close();

if (!$user) {
    json_response(['ok' => false, 'error' => 'user_not_found'], 404);
}

if (strlen($newPassword) < 8) {
    json_response(['ok' => false, 'error' => 'weak_password', 'message' => 'Password must be at least 8 characters long.'], 400);
}

if (!preg_match('/[A-Za-z]/', $newPassword) ||
    !preg_match('/[0-9]/', $newPassword) ||
    !preg_match('/[^A-Za-z0-9]/', $newPassword)) {
    json_response([
        'ok' => false,
        'error' => 'weak_password',
        'message' => 'Password must include a letter, number, and special character.'
    ], 400);
}

if (password_verify($newPassword, $user['password_hash'])) {
    json_response([
        'ok' => false,
        'error' => 'same_password',
        'message' => 'Please choose a password different from your current temporary password.'
    ], 400);
}

$passwordHash = password_hash($newPassword, PASSWORD_BCRYPT);
if ($hasFirstLoginCol) {
    $up = $mysqli->prepare("UPDATE tbl_users SET password_hash = ?, is_first_login = 0 WHERE user_id = ?");
} else {
    $up = $mysqli->prepare("UPDATE tbl_users SET password_hash = ? WHERE user_id = ?");
}
if (!$up) {
    json_response(['ok' => false, 'error' => 'db_prepare_failed', 'details' => $mysqli->error], 500);
}
$up->bind_param('si', $passwordHash, $userId);
if (!$up->execute()) {
    json_response(['ok' => false, 'error' => 'db_execute_failed', 'details' => $up->error], 500);
}
$up->close();

json_response([
    'ok' => true,
    'message' => 'password_changed',
    'is_first_login' => 0,
], 200);
