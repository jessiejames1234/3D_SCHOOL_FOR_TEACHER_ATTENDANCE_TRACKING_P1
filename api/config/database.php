<?php
require_once __DIR__ . '/env.php';
app_log_env_diagnostic('database');
// api/config/database.php

// Use Philippine time for this application regardless of the computer or
// hosting provider's default PHP timezone.
date_default_timezone_set('Asia/Manila');

$db_host = getenv('DB_HOST') !== false ? getenv('DB_HOST') : '';
$db_user = getenv('DB_USER') !== false ? getenv('DB_USER') : '';
$db_pass = getenv('DB_PASS') !== false ? getenv('DB_PASS') : '';
$db_name = getenv('DB_NAME') !== false ? getenv('DB_NAME') : '';
try {
  $mysqli = new mysqli($db_host, $db_user, $db_pass, $db_name);
  if ($mysqli->connect_error) {
    throw new RuntimeException($mysqli->connect_error);
  }

  // Apply the same timezone to this MySQL session. This keeps NOW(),
  // CURDATE(), CURRENT_TIMESTAMP, session expiry, cron work, and stored
  // application timestamps consistent on XAMPP and hosted servers.
  if (!$mysqli->query("SET time_zone = '+08:00'")) {
    throw new RuntimeException('Unable to configure the database timezone: ' . $mysqli->error);
  }
} catch (Throwable $error) {
  error_log('[database connection] ' . $error->getMessage());
  http_response_code(500);
  header('Content-Type: application/json');
  echo json_encode(['error' => 'database_unavailable', 'message' => 'Unable to connect to the database. Please try again later.']);
  exit;
}
