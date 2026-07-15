Developer: Restart Extension Host<?php
// server-php/api/my-schedule.php
global $mysqli;
require_once __DIR__ . '/../helpers/socket_helper.php';
use Firebase\JWT\JWT;
use Firebase\JWT\Key;

$request_method = $_SERVER['REQUEST_METHOD'];
$input = get_input();

// 1. AUTHENTICATION
$authHeader = null;
$candidates = ['HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION', 'HTTP_X_AUTHORIZATION', 'HTTP_X_API_TOKEN', 'HTTP_AUTH', 'AUTHORIZATION'];
foreach ($candidates as $k) { if (!empty($_SERVER[$k])) { $authHeader = $_SERVER[$k]; break; } }

if (empty($authHeader) && function_exists('apache_request_headers')) {
    $headers = apache_request_headers();
    foreach (['Authorization','authorization','AUTHORIZATION'] as $h) { if (!empty($headers[$h])) { $authHeader = $headers[$h]; break; } }
}

$queryToken = $_GET['token'] ?? null;
if (empty($authHeader) && !empty($queryToken)) { $authHeader = 'Bearer ' . $queryToken; }

$authUserId = null;
if (!empty($authHeader)) {
    if (preg_match('/Bearer\s+(\S+)/i', $authHeader, $m)) { 
        $token = $m[1];
        $sec = [];
        if (file_exists(__DIR__ . '/../config/security.php')) $sec = require __DIR__ . '/../config/security.php';
        $secret_key = $sec['jwt_secret'] ?? 'your-secret-key';
        try {
            $decoded = JWT::decode($token, new Key($secret_key, 'HS256'));
            $authUserId = isset($decoded->user_id) ? (int)$decoded->user_id : null;
        } catch (Throwable $e) {}
    }
}

if (!$authUserId) {
    json_response(['error' => 'missing_authorization'], 401);
}

if ($request_method !== 'GET') { json_response(['error' => 'method_not_allowed'], 405); }

function my_schedule_table_exists($mysqli, $table) {
    $table = preg_replace('/[^a-zA-Z0-9_]/', '', (string)$table);
    if ($table === '') return false;
    $safe = $mysqli->real_escape_string($table);
    $res = $mysqli->query("SHOW TABLES LIKE '{$safe}'");
    return $res && (int)$res->num_rows > 0;
}

function my_schedule_column_exists($mysqli, $table, $column) {
    $table = preg_replace('/[^a-zA-Z0-9_]/', '', (string)$table);
    $column = preg_replace('/[^a-zA-Z0-9_]/', '', (string)$column);
    if ($table === '' || $column === '') return false;
    $safeColumn = $mysqli->real_escape_string($column);
    $res = $mysqli->query("SHOW COLUMNS FROM `$table` LIKE '{$safeColumn}'");
    return $res && (int)$res->num_rows > 0;
}

// 2. FETCH SCHEDULES (Fixed SQL)
// Supports both schemas:
// - Legacy: tbl_class_schedules has user_id/subject_id/section_id directly.
// - Offering-based: tbl_subject_offerings provides those fields via offering_id.
$hasSubjectOfferings = my_schedule_table_exists($mysqli, 'tbl_subject_offerings');
$csHasOffering = my_schedule_column_exists($mysqli, 'tbl_class_schedules', 'offering_id');
$csHasUser = my_schedule_column_exists($mysqli, 'tbl_class_schedules', 'user_id');
$csHasSubject = my_schedule_column_exists($mysqli, 'tbl_class_schedules', 'subject_id');
$csHasSection = my_schedule_column_exists($mysqli, 'tbl_class_schedules', 'section_id');
$soHasUser = $hasSubjectOfferings ? my_schedule_column_exists($mysqli, 'tbl_subject_offerings', 'user_id') : false;
$soHasSubject = $hasSubjectOfferings ? my_schedule_column_exists($mysqli, 'tbl_subject_offerings', 'subject_id') : false;
$soHasSection = $hasSubjectOfferings ? my_schedule_column_exists($mysqli, 'tbl_subject_offerings', 'section_id') : false;

$joinOffering = ($hasSubjectOfferings && $csHasOffering) ? "LEFT JOIN tbl_subject_offerings so ON cs.offering_id = so.offering_id" : "";
$teacherExpr = $csHasUser ? 'cs.user_id' : (($hasSubjectOfferings && $csHasOffering && $soHasUser) ? 'so.user_id' : 'NULL');
$subjectExpr = $csHasSubject ? 'cs.subject_id' : (($hasSubjectOfferings && $csHasOffering && $soHasSubject) ? 'so.subject_id' : 'NULL');
$sectionExpr = $csHasSection ? 'cs.section_id' : (($hasSubjectOfferings && $csHasOffering && $soHasSection) ? 'so.section_id' : 'NULL');
$offeringExpr = $csHasOffering ? 'cs.offering_id' : 'NULL';

if ($teacherExpr === 'NULL') {
    json_response([]);
}

$sql = "SELECT 
            cs.schedule_id, 
            cs.room_id, 
            {$offeringExpr} AS offering_id, 
            cs.day_of_week, 
            cs.start_time, 
            cs.end_time,
            {$teacherExpr} AS offering_user_id,
            {$teacherExpr} AS teacher_id,
            s.subject_code, 
            s.subject_name, 
            sec.section_name,
            r.room_name, 
            r.building_id, 
            r.floor_id
        FROM tbl_class_schedules cs
        {$joinOffering}
        LEFT JOIN tbl_subject s ON {$subjectExpr} = s.subject_id
        LEFT JOIN tbl_sections sec ON {$sectionExpr} = sec.section_id
        LEFT JOIN tbl_rooms r ON cs.room_id = r.room_id
        WHERE {$teacherExpr} = ? AND cs.day_of_week IS NOT NULL
        ORDER BY FIELD(LOWER(cs.day_of_week), 'monday','tuesday','wednesday','thursday','friday','saturday','sunday'), cs.start_time";

$stmt = $mysqli->prepare($sql);
if (!$stmt) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);

// Bind only once
$stmt->bind_param('i', $authUserId);

if (!$stmt->execute()) json_response(['error' => 'execute_failed', 'message' => $stmt->error], 500);
$res = $stmt->get_result();
$rows = $res ? $res->fetch_all(MYSQLI_ASSOC) : [];

// Normalize data
foreach ($rows as &$r) {
    $r['day_of_week'] = isset($r['day_of_week']) ? strtolower($r['day_of_week']) : null;
    if (!empty($r['start_time']) && strlen($r['start_time']) === 5) $r['start_time'] = $r['start_time'] . ':00';
    if (!empty($r['end_time']) && strlen($r['end_time']) === 5) $r['end_time'] = $r['end_time'] . ':00';
}

json_response($rows);
?>
