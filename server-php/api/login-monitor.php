<?php
// server-php/api/login-monitor.php
global $mysqli, $authPayload;

$request_method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// Ensure the auth payload is loaded
if (!isset($authPayload) || !is_array($authPayload)) {
    json_response(['error' => 'unauthorized', 'message' => 'Authentication required.'], 401);
}

$authRoleId = isset($authPayload['role_id']) ? (int)$authPayload['role_id'] : 0;

// Only admin can view login monitoring
if ($authRoleId !== 1) {
    json_response(['error' => 'forbidden', 'message' => 'Only admin can access login monitoring.'], 403);
}

if ($request_method === 'GET') {
    // Ensure history table exists
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

    // Get login lock stats
    $totalLocked = 0;
    $totalFailed = 0;

    $lockResult = $mysqli->query("SELECT COUNT(*) AS cnt FROM tbl_login_locks WHERE lock_until IS NOT NULL AND lock_until > NOW()");
    if ($lockResult) {
        $totalLocked = (int)$lockResult->fetch_assoc()['cnt'];
    }

    $failedResult = $mysqli->query("SELECT COALESCE(SUM(failed_attempts), 0) AS total FROM tbl_login_locks");
    if ($failedResult) {
        $totalFailed = (int)$failedResult->fetch_assoc()['total'];
    }

    // Get all login lock records with user details
    $details = [];
    $detailResult = $mysqli->query("
        SELECT 
            l.id,
            l.email,
            l.failed_attempts,
            l.lock_until,
            u.user_id,
            u.first_name,
            u.last_name,
            u.role_id,
            r.role_name
        FROM tbl_login_locks l
        LEFT JOIN tbl_users u ON l.email = u.email
        LEFT JOIN tbl_roles r ON u.role_id = r.role_id
        ORDER BY l.id DESC
    ");
    if ($detailResult) {
        while ($row = $detailResult->fetch_assoc()) {
            $row['is_locked'] = ($row['lock_until'] !== null && strtotime($row['lock_until']) > time());
            $details[] = $row;
        }
    }

    // Get login history (last 100 attempts)
    $history = [];
    $histResult = $mysqli->query("
        SELECT 
            a.attempt_id,
            a.email,
            a.attempt_time,
            a.status,
            a.ip_address,
            a.details,
            u.user_id,
            u.first_name,
            u.last_name,
            r.role_name
        FROM tbl_login_attempts a
        LEFT JOIN tbl_users u ON a.user_id = u.user_id
        LEFT JOIN tbl_roles r ON u.role_id = r.role_id
        ORDER BY a.attempt_time DESC
        LIMIT 100
    ");
    if ($histResult) {
        $history = $histResult->fetch_all(MYSQLI_ASSOC);
    }

    json_response([
        'total_locked' => $totalLocked,
        'total_failed_attempts' => $totalFailed,
        'total_accounts_with_attempts' => count($details),
        'details' => $details,
        'history' => $history,
    ]);
}

if ($request_method === 'DELETE') {
    $input = get_input();
    $lockId = isset($input['id']) ? (int)$input['id'] : 0;

    if ($lockId <= 0) {
        json_response(['error' => 'validation', 'message' => 'Invalid lock ID.'], 400);
    }

    $stmt = $mysqli->prepare("DELETE FROM tbl_login_locks WHERE id = ?");
    if (!$stmt) {
        json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
    }
    $stmt->bind_param('i', $lockId);
    if (!$stmt->execute()) {
        json_response(['error' => 'delete_failed', 'message' => $stmt->error], 500);
    }

    json_response(['ok' => true, 'message' => 'Login lock record cleared.']);
}

json_response(['error' => 'method_not_allowed'], 405);