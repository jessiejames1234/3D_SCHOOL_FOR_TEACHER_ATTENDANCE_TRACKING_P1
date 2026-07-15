<?php
// server-php/api/login.php
require_once __DIR__ . '/../helpers/socket_helper.php';
global $mysqli;

use Firebase\JWT\JWT;

$permissionModeColCheck = $mysqli->query("SHOW COLUMNS FROM tbl_users LIKE 'permission_mode'");
$modulePermissionsColCheck = $mysqli->query("SHOW COLUMNS FROM tbl_users LIKE 'module_permissions'");
$firstLoginColCheck = $mysqli->query("SHOW COLUMNS FROM tbl_users LIKE 'is_first_login'");
$hasPermissionModeCol = $permissionModeColCheck && $permissionModeColCheck->num_rows > 0;
$hasModulePermissionsCol = $modulePermissionsColCheck && $modulePermissionsColCheck->num_rows > 0;
$hasUserModulePermissions = $hasPermissionModeCol && $hasModulePermissionsCol;
$hasFirstLoginCol = $firstLoginColCheck && $firstLoginColCheck->num_rows > 0;

$decode_module_permissions = function($raw) {
    if ($raw === null || $raw === '') return ['allow' => [], 'deny' => []];
    $parsed = is_array($raw) ? $raw : json_decode((string)$raw, true);
    if (!is_array($parsed)) return ['allow' => [], 'deny' => []];
    $allow = isset($parsed['allow']) && is_array($parsed['allow']) ? array_values($parsed['allow']) : [];
    $deny = isset($parsed['deny']) && is_array($parsed['deny']) ? array_values($parsed['deny']) : [];
    return ['allow' => $allow, 'deny' => $deny];
};

$request_method = $_SERVER['REQUEST_METHOD'];
$input = get_input();

if ($request_method === 'POST') {
    try {
        // Single identifier field: can be email or ID number
        $identifier = isset($input['email']) ? trim((string)$input['email']) : null;
        $password = $input['password'] ?? null;
        if (!$identifier || !$password) {
            json_response(['error' => 'Missing email / ID or password'], 400);
        }

        $clientIp = $_SERVER['REMOTE_ADDR'] ?? 'unknown';

        // Create login lock table and login attempts history table
        $mysqli->query("CREATE TABLE IF NOT EXISTS `tbl_login_locks` (
            `id` INT(11) NOT NULL AUTO_INCREMENT,
            `email` VARCHAR(255) NOT NULL,
            `failed_attempts` INT(11) NOT NULL DEFAULT 0,
            `lock_until` DATETIME DEFAULT NULL,
            PRIMARY KEY (`id`),
            UNIQUE KEY `email_unique` (`email`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
        $mysqli->query("CREATE TABLE IF NOT EXISTS `tbl_login_attempts` (
            `attempt_id` INT(11) NOT NULL AUTO_INCREMENT,
            `email` VARCHAR(255) NOT NULL,
            `user_id` INT(11) NULL DEFAULT NULL,
            `attempt_time` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            `status` ENUM('success', 'failed') NOT NULL DEFAULT 'failed',
            `ip_address` VARCHAR(45) NULL DEFAULT NULL,
            `details` VARCHAR(255) NULL DEFAULT NULL,
            PRIMARY KEY (`attempt_id`),
            KEY `email` (`email`),
            KEY `user_id` (`user_id`),
            KEY `attempt_time` (`attempt_time`),
            KEY `status` (`status`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

        // Check if this email is currently locked
        $lockFailedAttempts = 0;
        $lockUntil = null;
        $lockStmt = $mysqli->prepare("SELECT failed_attempts, lock_until FROM tbl_login_locks WHERE email = ? LIMIT 1");
        if ($lockStmt) {
            $lockStmt->bind_param("s", $identifier);
            $lockStmt->execute();
            $lockRes = $lockStmt->get_result();
            if ($row = $lockRes->fetch_assoc()) {
                $lockFailedAttempts = (int)$row['failed_attempts'];
                $lockUntil = $row['lock_until'] ? strtotime($row['lock_until']) : null;
            }
            $lockStmt->close();
        }
        if ($lockUntil && $lockUntil > time()) {
            $remaining = max(1, $lockUntil - time());
            json_response([
                'error' => 'account_locked',
                'message' => 'Too many failed attempts. Please wait before trying again.',
                'remaining_seconds' => $remaining
            ], 429);
        }

        // Allow login by email OR id_number using the same input
        // Include `status` so we can prevent inactive/archived accounts from logging in
        $permissionCols = $hasUserModulePermissions
            ? ", permission_mode, module_permissions"
            : ", NULL AS permission_mode, NULL AS module_permissions";
        $firstLoginCol = $hasFirstLoginCol ? ", is_first_login" : ", 0 AS is_first_login";
        $stmt = $mysqli->prepare("SELECT user_id, role_id, dept_id, first_name, last_name, id_number, email, password_hash, status{$permissionCols}{$firstLoginCol} FROM tbl_users WHERE email = ? OR id_number = ? LIMIT 1");
        $stmt->bind_param("ss", $identifier, $identifier);
        $stmt->execute();
        $result = $stmt->get_result();
        $user = $result->fetch_assoc();

        // If the account exists but is inactive/archived, deny login immediately
        if ($user) {
            $statusVal = isset($user['status']) ? strtolower(trim((string)$user['status'])) : '';
            if ($statusVal !== '' && in_array($statusVal, ['inactive','inactive','archive','archived','0','false'], true)) {
                json_response([
                    'error' => 'account_inactive',
                    'message' => 'Account is inactive or archived. Please contact your administrator.'
                ], 403);
            }
        }

        if (!$user || !password_verify($password, $user['password_hash'])) {
            // Log failed attempt
            $failedUserId = $user ? (int)$user['user_id'] : null;
            $logStmt = $mysqli->prepare("INSERT INTO tbl_login_attempts (email, user_id, status, ip_address, details) VALUES (?, ?, 'failed', ?, 'Invalid password')");
            if ($logStmt) {
                $logStmt->bind_param("sis", $identifier, $failedUserId, $clientIp);
                $logStmt->execute();
                $logStmt->close();
            }

            // Handle failed attempt: increment counter and lock for 30s after 10 consecutive failures
            $failed = $lockFailedAttempts + 1;
            $lockSeconds = 0;

            if ($failed >= 10) {
                $lockSeconds = 30;
                $lockUntilTime = date('Y-m-d H:i:s', time() + $lockSeconds);
                // reset failed_attempts back to 0 while locked
                $up = $mysqli->prepare("INSERT INTO tbl_login_locks (email, failed_attempts, lock_until)
                    VALUES (?, 0, ?)
                    ON DUPLICATE KEY UPDATE failed_attempts = VALUES(failed_attempts), lock_until = VALUES(lock_until)");
                if ($up) {
                    $up->bind_param("ss", $identifier, $lockUntilTime);
                    $up->execute();
                    $up->close();
                }
                json_response([
                    'error' => 'account_locked',
                    'message' => 'Too many failed attempts. Your account is temporarily locked.',
                    'remaining_seconds' => $lockSeconds
                ], 429);
            } else {
                // just update failed_attempts and tell client how many tries are left before lock
                $up = $mysqli->prepare("INSERT INTO tbl_login_locks (email, failed_attempts, lock_until)
                    VALUES (?, ?, NULL)
                    ON DUPLICATE KEY UPDATE failed_attempts = VALUES(failed_attempts), lock_until = NULL");
                if ($up) {
                    $up->bind_param("si", $identifier, $failed);
                    $up->execute();
                    $up->close();
                }
                $remaining = max(0, 10 - $failed);
                json_response([
                    'error' => 'Invalid email or password',
                    'remaining_attempts' => $remaining
                ], 401);
            }
        }

        // Log successful login
        $logSuccess = $mysqli->prepare("INSERT INTO tbl_login_attempts (email, user_id, status, ip_address, details) VALUES (?, ?, 'success', ?, 'Login successful')");
        if ($logSuccess) {
            $uid = (int)$user['user_id'];
            $logSuccess->bind_param("sis", $identifier, $uid, $clientIp);
            $logSuccess->execute();
            $logSuccess->close();
        }

        // Successful login: clear any lock state for this email
        $clear = $mysqli->prepare("DELETE FROM tbl_login_locks WHERE email = ?");
        if ($clear) {
            $clear->bind_param("s", $identifier);
            $clear->execute();
            $clear->close();
        }

        $sec = [];
        if (file_exists(__DIR__ . '/../config/security.php')) $sec = require __DIR__ . '/../config/security.php';
        $secret_key = $sec['jwt_secret'] ?? 'your-secret-key';
        $payload = [
            'user_id' => $user['user_id'],
            'email' => $user['email'],
            'role_id' => $user['role_id'],
            'dept_id' => isset($user['dept_id']) && $user['dept_id'] !== null ? (int)$user['dept_id'] : null,
            'iat' => time(),
            'exp' => time() + (60 * 60 * 2) // 2 hours
        ];
        $token = JWT::encode($payload, $secret_key, 'HS256');

        json_response([
            'token' => $token,
            'user' => [
                'user_id' => $user['user_id'],
                'first_name' => $user['first_name'],
                'last_name' => $user['last_name'],
                'id_number' => isset($user['id_number']) ? (string)$user['id_number'] : '',
                'email' => $user['email'],
                'role_id' => $user['role_id'],
                'dept_id' => $user['dept_id'],
                'is_first_login' => isset($user['is_first_login']) ? (int)$user['is_first_login'] : 0,
                'permission_mode' => $hasUserModulePermissions ? ($user['permission_mode'] ?? 'default') : 'default',
                'module_permissions' => $hasUserModulePermissions ? $decode_module_permissions($user['module_permissions'] ?? null) : ['allow' => [], 'deny' => []],
            ]
        ]);
    } catch (Throwable $e) {
        json_response(['error' => 'An internal server error occurred during login.', 'details' => $e->getMessage()], 500);
    }
} else {
    json_response(['error' => 'method_not_allowed'], 405);
}