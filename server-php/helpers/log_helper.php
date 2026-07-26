<?php

/**
 * Logs a system action to the database.
 * * @param mysqli $mysqli Database connection
 * @param int $user_id The ID of the user performing the action (MUST exist in tbl_users)
 * @param string $action Short action name (e.g., 'create_department')
 * @param string $details Readable details
 */
function log_system_action($mysqli, $user_id, $action, $details) {
    // 1. Validate User ID (Crucial because of Foreign Key)
    if (empty($user_id) || !is_numeric($user_id)) {
        // If we don't have a user ID, we technically can't log to tbl_system_logs 
        // because of the foreign key constraint. You might want to log to a text file as fallback.
        error_log("Failed to log action '$action': No valid user_id provided.");
        return;
    }

    // 2. Get IP Address (check forwarded headers first for proxy/tunnel support)
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'UNKNOWN';
    if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        // X-Forwarded-For can contain multiple IPs (comma-separated); take the first (original client)
        $forwardedIps = explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']);
        $forwardedIp = trim($forwardedIps[0]);
        if (filter_var($forwardedIp, FILTER_VALIDATE_IP)) {
            $ip = $forwardedIp;
        }
    } elseif (!empty($_SERVER['HTTP_X_REAL_IP'])) {
        $realIp = trim($_SERVER['HTTP_X_REAL_IP']);
        if (filter_var($realIp, FILTER_VALIDATE_IP)) {
            $ip = $realIp;
        }
    }

    // 3. Prepare Query
    // Note: 'timestamp' is usually handled by MySQL (CURRENT_TIMESTAMP), 
    // but if your schema requires it explicitly, we use NOW().
    $sql = "INSERT INTO tbl_system_logs (user_id, action, timestamp, details, ip_address) VALUES (?, ?, NOW(), ?, ?)";
    
    $stmt = $mysqli->prepare($sql);
    
    if ($stmt) {
        $stmt->bind_param("isss", $user_id, $action, $details, $ip);
        $stmt->execute();
        $stmt->close();
    } else {
        error_log("Log Insert Error: " . $mysqli->error);
    }
}
?>