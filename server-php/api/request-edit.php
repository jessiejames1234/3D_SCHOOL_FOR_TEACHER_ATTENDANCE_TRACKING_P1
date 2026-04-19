<?php
// server-php/api/request-edit.php
require_once __DIR__ . '/../helpers/log_helper.php';
require_once __DIR__ . '/../helpers/attendance-logs.php';
require_once __DIR__ . '/../helpers/notification_helper.php';

use Firebase\JWT\JWT;
use Firebase\JWT\Key;

global $mysqli;

$request_method = $_SERVER['REQUEST_METHOD'];
$input = get_input();
if (!is_array($input)) $input = [];

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$parts = explode('/', $path);
$api_prefix_key = array_search('api', $parts);
$endpoint = $parts[$api_prefix_key + 1] ?? null;
$param1 = $parts[$api_prefix_key + 2] ?? null; // attendance | schedule
$param2 = $parts[$api_prefix_key + 3] ?? null; // request id

if ($endpoint !== 'request-edit') {
    json_response(['error' => 'endpoint_not_found'], 404);
}

function safe_bind_params($stmt, $types, $params) {
    $refs = [];
    $refs[] = &$types;
    foreach ($params as $k => $v) $refs[] = &$params[$k];
    return call_user_func_array([$stmt, 'bind_param'], $refs);
}

function table_exists($mysqli, $table) {
    $table = preg_replace('/[^a-zA-Z0-9_]/', '', (string)$table);
    if ($table === '') return false;
    $safe = $mysqli->real_escape_string($table);
    $res = $mysqli->query("SHOW TABLES LIKE '{$safe}'");
    return $res && (int)$res->num_rows > 0;
}

function column_exists($mysqli, $table, $column) {
    $table = preg_replace('/[^a-zA-Z0-9_]/', '', (string)$table);
    $column = preg_replace('/[^a-zA-Z0-9_]/', '', (string)$column);
    if ($table === '' || $column === '') return false;
    $safeColumn = $mysqli->real_escape_string($column);
    $res = $mysqli->query("SHOW COLUMNS FROM `$table` LIKE '{$safeColumn}'");
    return $res && (int)$res->num_rows > 0;
}

function get_auth_header() {
    $authHeader = null;
    $candidates = ['HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION', 'HTTP_X_AUTHORIZATION', 'HTTP_X_API_TOKEN', 'HTTP_AUTH', 'AUTHORIZATION'];
    foreach ($candidates as $k) {
        if (!empty($_SERVER[$k])) {
            $authHeader = $_SERVER[$k];
            break;
        }
    }
    if (empty($authHeader) && function_exists('apache_request_headers')) {
        $headers = apache_request_headers();
        foreach (['Authorization', 'authorization', 'AUTHORIZATION'] as $h) {
            if (!empty($headers[$h])) {
                $authHeader = $headers[$h];
                break;
            }
        }
    }
    $queryToken = $_GET['token'] ?? null;
    if (empty($authHeader) && !empty($queryToken)) {
        $authHeader = 'Bearer ' . $queryToken;
    }
    return $authHeader;
}

function normalize_day($value) {
    if ($value === null) return null;
    $v = strtolower(trim((string)$value));
    if ($v === '') return null;
    $map = [
        'mon' => 'monday', 'monday' => 'monday',
        'tue' => 'tuesday', 'tues' => 'tuesday', 'tuesday' => 'tuesday',
        'wed' => 'wednesday', 'wednesday' => 'wednesday',
        'thu' => 'thursday', 'thur' => 'thursday', 'thurs' => 'thursday', 'thursday' => 'thursday',
        'fri' => 'friday', 'friday' => 'friday',
        'sat' => 'saturday', 'saturday' => 'saturday',
        'sun' => 'sunday', 'sunday' => 'sunday',
    ];
    return $map[$v] ?? null;
}

function normalize_time($value) {
    if ($value === null) return null;
    $raw = trim((string)$value);
    if ($raw === '') return null;
    if (preg_match('/^\d{2}:\d{2}$/', $raw)) return $raw . ':00';
    if (preg_match('/^\d{2}:\d{2}:\d{2}$/', $raw)) return $raw;
    $ts = strtotime($raw);
    if ($ts === false) return null;
    return date('H:i:s', $ts);
}

function parse_auth_user($mysqli) {
    $authHeader = get_auth_header();
    if (empty($authHeader)) {
        json_response(['error' => 'missing_authorization'], 401);
    }
    if (!preg_match('/Bearer\s+(\S+)/i', $authHeader, $m)) {
        json_response(['error' => 'invalid_authorization_format'], 401);
    }
    $token = $m[1];
    $sec = [];
    if (file_exists(__DIR__ . '/../config/security.php')) $sec = require __DIR__ . '/../config/security.php';
    $secret_key = $sec['jwt_secret'] ?? 'your-secret-key';
    try {
        $decoded = JWT::decode($token, new Key($secret_key, 'HS256'));
    } catch (Throwable $e) {
        json_response(['error' => 'invalid_token', 'message' => $e->getMessage()], 401);
    }

    $authUserId = isset($decoded->user_id) ? (int)$decoded->user_id : null;
    $authRole = isset($decoded->role_id) ? (int)$decoded->role_id : null;
    if (!$authUserId) json_response(['error' => 'invalid_token_payload'], 401);

    $deptId = null;
    $s = $mysqli->prepare("SELECT dept_id FROM tbl_users WHERE user_id = ? LIMIT 1");
    if ($s) {
        $s->bind_param('i', $authUserId);
        $s->execute();
        $row = $s->get_result()->fetch_assoc();
        if ($row && isset($row['dept_id'])) $deptId = $row['dept_id'] !== null ? (int)$row['dept_id'] : null;
    }

    return [
        'user_id' => $authUserId,
        'role_id' => $authRole,
        'dept_id' => $deptId,
    ];
}

function request_edit_is_self_scope($scope) {
    return in_array(strtolower(trim((string)$scope)), ['my', 'mine', 'self'], true);
}

function request_edit_apply_scope_filter($scope, $authRole, $authUserId, $authDeptId, $manageRoleId, $requestedByColumn, $teacherDeptColumn, &$sql, &$types, &$params) {
    $authRole = (int)$authRole;
    $authUserId = (int)$authUserId;
    $isSelfScope = request_edit_is_self_scope($scope);

    if ($authRole === 1) {
        if ($isSelfScope) {
            $sql .= " AND {$requestedByColumn} = ?";
            $types .= 'i';
            $params[] = $authUserId;
        }
        return;
    }

    if ($authRole === (int)$manageRoleId && !$isSelfScope) {
        if ($authDeptId === null) {
            json_response([], 200);
        }
        $sql .= " AND {$teacherDeptColumn} = ?";
        $types .= 'i';
        $params[] = (int)$authDeptId;
        return;
    }

    if (in_array($authRole, [2, 3, 4, 5], true)) {
        $sql .= " AND {$requestedByColumn} = ?";
        $types .= 'i';
        $params[] = $authUserId;
        return;
    }

    json_response(['error' => 'forbidden'], 403);
}

function build_schedule_schema($mysqli) {
    $hasSubjectOfferings = table_exists($mysqli, 'tbl_subject_offerings');
    $csHasOffering = column_exists($mysqli, 'tbl_class_schedules', 'offering_id');
    return [
        'cs_has_offering' => $csHasOffering,
        'cs_has_user' => column_exists($mysqli, 'tbl_class_schedules', 'user_id'),
        'cs_has_section' => column_exists($mysqli, 'tbl_class_schedules', 'section_id'),
        'cs_has_subject' => column_exists($mysqli, 'tbl_class_schedules', 'subject_id'),
        'cs_has_semester' => column_exists($mysqli, 'tbl_class_schedules', 'semester_id'),
        'has_so' => $hasSubjectOfferings && $csHasOffering,
        'so_has_user' => $hasSubjectOfferings ? column_exists($mysqli, 'tbl_subject_offerings', 'user_id') : false,
        'so_has_section' => $hasSubjectOfferings ? column_exists($mysqli, 'tbl_subject_offerings', 'section_id') : false,
        'so_has_subject' => $hasSubjectOfferings ? column_exists($mysqli, 'tbl_subject_offerings', 'subject_id') : false,
        'so_has_semester' => $hasSubjectOfferings ? column_exists($mysqli, 'tbl_subject_offerings', 'semester_id') : false,
    ];
}

function schedule_exprs($schema) {
    $joinOffering = $schema['has_so'] ? " LEFT JOIN tbl_subject_offerings so ON cs.offering_id = so.offering_id " : "";
    $teacherExpr = $schema['cs_has_user'] ? 'cs.user_id' : (($schema['has_so'] && $schema['so_has_user']) ? 'so.user_id' : 'NULL');
    $sectionExpr = $schema['cs_has_section'] ? 'cs.section_id' : (($schema['has_so'] && $schema['so_has_section']) ? 'so.section_id' : 'NULL');
    $subjectExpr = $schema['cs_has_subject'] ? 'cs.subject_id' : (($schema['has_so'] && $schema['so_has_subject']) ? 'so.subject_id' : 'NULL');
    $semesterExpr = $schema['cs_has_semester'] ? 'cs.semester_id' : (($schema['has_so'] && $schema['so_has_semester']) ? 'so.semester_id' : 'NULL');
    return [$joinOffering, $teacherExpr, $sectionExpr, $subjectExpr, $semesterExpr];
}

function get_schedule_context($mysqli, $schema, $scheduleId) {
    list($joinOffering, $teacherExpr, $sectionExpr, $subjectExpr, $semesterExpr) = schedule_exprs($schema);

    $sql = "SELECT
                cs.schedule_id,
                cs.room_id,
                LOWER(TRIM(cs.day_of_week)) AS day_of_week,
                TIME_FORMAT(cs.start_time, '%H:%i:%s') AS start_time,
                TIME_FORMAT(cs.end_time, '%H:%i:%s') AS end_time,
                $teacherExpr AS teacher_id,
                $sectionExpr AS section_id,
                $subjectExpr AS subject_id,
                $semesterExpr AS semester_id
            FROM tbl_class_schedules cs
            $joinOffering
            WHERE cs.schedule_id = ?
            LIMIT 1";
    $stmt = $mysqli->prepare($sql);
    if (!$stmt) return null;
    $stmt->bind_param('i', $scheduleId);
    $stmt->execute();
    return $stmt->get_result()->fetch_assoc() ?: null;
}

function find_schedule_conflicts($mysqli, $schema, $excludeScheduleId, $semesterId, $teacherId, $sectionId, $roomId, $dayOfWeek, $startTime, $endTime) {
    list($joinOffering, $teacherExpr, $sectionExpr, $subjectExpr, $semesterExpr) = schedule_exprs($schema);
    $conflicts = [];

    $appendSemester = ($semesterId !== null && $semesterExpr !== 'NULL');

    // Room conflict
    $sql = "SELECT cs.schedule_id
            FROM tbl_class_schedules cs
            $joinOffering
            WHERE LOWER(TRIM(cs.day_of_week)) = ?
              AND NOT (cs.end_time <= ? OR cs.start_time >= ?)
              AND cs.schedule_id <> ?
              AND cs.room_id = ?";
    $types = 'sssii';
    $params = [$dayOfWeek, $startTime, $endTime, (int)$excludeScheduleId, (int)$roomId];
    if ($teacherId !== null && $teacherExpr !== 'NULL') {
        $sql .= " AND ($teacherExpr IS NULL OR $teacherExpr <> ?)";
        $types .= 'i';
        $params[] = (int)$teacherId;
    }
    if ($appendSemester) {
        $sql .= " AND $semesterExpr = ?";
        $types .= 'i';
        $params[] = (int)$semesterId;
    }
    $sql .= " LIMIT 1";
    $stmt = $mysqli->prepare($sql);
    if ($stmt) {
        safe_bind_params($stmt, $types, $params);
        $stmt->execute();
        if ($stmt->get_result()->fetch_assoc()) {
            $conflicts[] = ['type' => 'room', 'message' => 'Room already has another class at this time with a different teacher'];
        }
    }

    // Section conflict
    if ($sectionId !== null && $sectionExpr !== 'NULL') {
        $sql = "SELECT cs.schedule_id
                FROM tbl_class_schedules cs
                $joinOffering
                WHERE LOWER(TRIM(cs.day_of_week)) = ?
                  AND NOT (cs.end_time <= ? OR cs.start_time >= ?)
                  AND cs.schedule_id <> ?
                  AND $sectionExpr = ?";
        $types = 'sssii';
        $params = [$dayOfWeek, $startTime, $endTime, (int)$excludeScheduleId, (int)$sectionId];
        if ($teacherId !== null && $teacherExpr !== 'NULL') {
            $sql .= " AND ($teacherExpr IS NULL OR $teacherExpr <> ?)";
            $types .= 'i';
            $params[] = (int)$teacherId;
        }
        if ($appendSemester) {
            $sql .= " AND $semesterExpr = ?";
            $types .= 'i';
            $params[] = (int)$semesterId;
        }
        $sql .= " LIMIT 1";
        $stmt = $mysqli->prepare($sql);
        if ($stmt) {
            safe_bind_params($stmt, $types, $params);
            $stmt->execute();
            if ($stmt->get_result()->fetch_assoc()) {
                $conflicts[] = ['type' => 'section', 'message' => 'Section already has another class at this time with a different teacher'];
            }
        }
    }

    return $conflicts;
}

$auth = parse_auth_user($mysqli);
$authUserId = (int)$auth['user_id'];
$authRole = (int)$auth['role_id'];
$authDeptId = $auth['dept_id'];

$scheduleSchema = build_schedule_schema($mysqli);
list($joinOffering, $teacherExpr, $sectionExpr, $subjectExpr, $semesterExpr) = schedule_exprs($scheduleSchema);

if ($param1 === 'attendance') {
    if ($request_method === 'GET') {
        $scope = strtolower(trim((string)($_GET['scope'] ?? '')));
        $status = strtolower(trim((string)($_GET['status'] ?? '')));
        $validStatuses = ['pending', 'approved', 'rejected'];
        if (!in_array($status, $validStatuses, true)) $status = null;

        $sql = "SELECT
                    aer.request_id,
                    aer.attendance_id,
                    aer.requested_by,
                    aer.reason,
                    aer.status,
                    aer.created_at,
                    aer.decided_by,
                    DATE_FORMAT(ar.date, '%Y-%m-%d') AS attendance_date,
                    TIME_FORMAT(ar.checked_in_at, '%H:%i:%s') AS checked_in_at,
                    TIME_FORMAT(ar.checked_mid_at, '%H:%i:%s') AS checked_mid_at,
                    TIME_FORMAT(ar.checked_out_at, '%H:%i:%s') AS checked_out_at,
                    ar.flag_in_id,
                    ar.flag_check_id,
                    ar.flag_out_id,
                    fti.flag_name AS flag_in_name,
                    ftc.flag_name AS flag_check_name,
                    fto.flag_name AS flag_out_name,
                    ar.remarks AS attendance_remarks,
                    ar.user_id AS teacher_id,
                    CONCAT(t.first_name, ' ', t.last_name) AS teacher_name,
                    t.dept_id AS teacher_dept_id,
                    CONCAT(req.first_name, ' ', req.last_name) AS requested_by_name,
                    CONCAT(decider.first_name, ' ', decider.last_name) AS decided_by_name,
                    cs.schedule_id,
                    TIME_FORMAT(cs.start_time, '%H:%i:%s') AS schedule_start_time,
                    TIME_FORMAT(cs.end_time, '%H:%i:%s') AS schedule_end_time,
                    r.room_name,
                    s.subject_code,
                    s.subject_name,
                    sec.section_name
                FROM tbl_attendance_edit_requests aer
                JOIN tbl_attendance_records ar ON aer.attendance_id = ar.attendance_id
                LEFT JOIN tbl_class_schedules cs ON ar.schedule_id = cs.schedule_id
                $joinOffering
                LEFT JOIN tbl_subject s ON $subjectExpr = s.subject_id
                LEFT JOIN tbl_sections sec ON $sectionExpr = sec.section_id
                LEFT JOIN tbl_rooms r ON ar.room_id = r.room_id
                LEFT JOIN tbl_flag_types fti ON ar.flag_in_id = fti.flag_id
                LEFT JOIN tbl_flag_types ftc ON ar.flag_check_id = ftc.flag_id
                LEFT JOIN tbl_flag_types fto ON ar.flag_out_id = fto.flag_id
                LEFT JOIN tbl_users t ON ar.user_id = t.user_id
                LEFT JOIN tbl_users req ON aer.requested_by = req.user_id
                LEFT JOIN tbl_users decider ON aer.decided_by = decider.user_id
                WHERE 1=1";
        $types = '';
        $params = [];
        request_edit_apply_scope_filter(
            $scope,
            $authRole,
            $authUserId,
            $authDeptId,
            2,
            'aer.requested_by',
            't.dept_id',
            $sql,
            $types,
            $params
        );

        if ($status !== null) {
            $sql .= " AND aer.status = ?";
            $types .= 's';
            $params[] = $status;
        }

        $sql .= " ORDER BY aer.created_at DESC, aer.request_id DESC";
        $stmt = $mysqli->prepare($sql);
        if (!$stmt) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
        if (!empty($params)) safe_bind_params($stmt, $types, $params);
        if (!$stmt->execute()) json_response(['error' => 'execute_failed', 'message' => $stmt->error], 500);
        $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
        json_response($rows);
    }

    if ($request_method === 'POST' && empty($param2)) {
        if (!in_array((int)$authRole, [2, 3, 4, 5], true)) {
            json_response(['error' => 'forbidden', 'message' => 'Only dean, program head, secretary, and teacher can submit attendance edit requests'], 403);
        }

        $attendanceId = isset($input['attendance_id']) ? (int)$input['attendance_id'] : 0;
        $reason = trim((string)($input['reason'] ?? ''));
        if ($attendanceId <= 0 || $reason === '') {
            json_response(['error' => 'missing_fields', 'message' => 'attendance_id and reason are required'], 400);
        }

        $check = $mysqli->prepare("SELECT attendance_id, user_id, date FROM tbl_attendance_records WHERE attendance_id = ? LIMIT 1");
        if (!$check) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
        $check->bind_param('i', $attendanceId);
        $check->execute();
        $attendance = $check->get_result()->fetch_assoc();
        if (!$attendance) json_response(['error' => 'not_found', 'message' => 'Attendance record not found'], 404);
        if ((int)$attendance['user_id'] !== $authUserId) {
            json_response(['error' => 'forbidden', 'message' => 'You can only request edits for your own attendance records'], 403);
        }

        $dup = $mysqli->prepare("SELECT request_id FROM tbl_attendance_edit_requests WHERE attendance_id = ? AND requested_by = ? AND status = 'pending' LIMIT 1");
        if ($dup) {
            $dup->bind_param('ii', $attendanceId, $authUserId);
            $dup->execute();
            if ($dup->get_result()->fetch_assoc()) {
                json_response(['error' => 'duplicate_pending', 'message' => 'A pending request for this attendance record already exists'], 409);
            }
        }

        $stmt = $mysqli->prepare("INSERT INTO tbl_attendance_edit_requests (attendance_id, requested_by, reason, status) VALUES (?, ?, ?, 'pending')");
        if (!$stmt) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
        $stmt->bind_param('iis', $attendanceId, $authUserId, $reason);
        if (!$stmt->execute()) json_response(['error' => 'insert_failed', 'message' => $stmt->error], 500);

        $requestId = (int)$stmt->insert_id;
        log_system_action(
            $mysqli,
            $authUserId,
            'create_attendance_edit_request',
            "Submitted attendance edit request #{$requestId} for attendance_id={$attendanceId}"
        );
        if ((int)$authRole === 5 && $authDeptId !== null) {
            $requesterName = notif_get_user_full_name($mysqli, $authUserId);
            $notifTitle = 'Attendance Edit Request';
            $notifMessage = "{$requesterName} submitted an attendance edit request.";
            $notifLink = '/attendance-edit-requests?request_id=' . $requestId;
            notif_notify_role_dept($mysqli, 2, (int)$authDeptId, $notifTitle, $notifMessage, $notifLink, $authUserId, $authUserId);
        }
        json_response(['ok' => true, 'request_id' => $requestId], 201);
    }

    if (($request_method === 'PUT' || $request_method === 'POST') && is_numeric($param2)) {
        if ($authRole !== 2) {
            json_response(['error' => 'forbidden', 'message' => 'Only dean can decide attendance edit requests'], 403);
        }
        $requestId = (int)$param2;
        $decision = strtolower(trim((string)($input['decision'] ?? $input['status'] ?? '')));
        if (!in_array($decision, ['approved', 'rejected'], true)) {
            json_response(['error' => 'invalid_decision', 'message' => 'decision must be approved or rejected'], 400);
        }

        $sql = "SELECT
                    aer.request_id,
                    aer.status,
                    aer.attendance_id,
                    aer.requested_by,
                    aer.reason,
                    ar.user_id AS teacher_id,
                    ar.date,
                    t.dept_id AS teacher_dept_id
                FROM tbl_attendance_edit_requests aer
                JOIN tbl_attendance_records ar ON aer.attendance_id = ar.attendance_id
                JOIN tbl_users t ON ar.user_id = t.user_id
                WHERE aer.request_id = ?
                LIMIT 1";
        $check = $mysqli->prepare($sql);
        if (!$check) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
        $check->bind_param('i', $requestId);
        $check->execute();
        $row = $check->get_result()->fetch_assoc();
        if (!$row) json_response(['error' => 'not_found', 'message' => 'Attendance edit request not found'], 404);
        if ($authDeptId === null || (int)$row['teacher_dept_id'] !== (int)$authDeptId) {
            json_response(['error' => 'forbidden', 'message' => 'Request belongs to another department'], 403);
        }
        if (strtolower((string)$row['status']) !== 'pending') {
            json_response(['error' => 'already_decided', 'message' => 'Request is already decided'], 409);
        }

        $changes = isset($input['changes']) && is_array($input['changes']) ? $input['changes'] : [];
        $mysqli->begin_transaction();
        try {
            if ($decision === 'approved' && !empty($changes)) {
                $existingStmt = $mysqli->prepare("SELECT checked_in_at, checked_mid_at, checked_out_at, flag_in_id, flag_check_id, flag_out_id FROM tbl_attendance_records WHERE attendance_id = ? LIMIT 1");
                if (!$existingStmt) {
                    throw new Exception($mysqli->error);
                }
                $attendanceId = (int)$row['attendance_id'];
                $existingStmt->bind_param('i', $attendanceId);
                if (!$existingStmt->execute()) {
                    throw new Exception($existingStmt->error);
                }
                $existing = $existingStmt->get_result()->fetch_assoc();
                $existingStmt->close();

                $allowed = [
                    'checked_in_at' => 's',
                    'checked_mid_at' => 's',
                    'checked_out_at' => 's',
                    'flag_in_id' => 'i',
                    'flag_check_id' => 'i',
                    'flag_out_id' => 'i',
                    'remarks' => 's',
                ];
                $fields = [];
                $types = '';
                $vals = [];
                foreach ($allowed as $field => $type) {
                    if (array_key_exists($field, $changes)) {
                        $value = $changes[$field];
                        if ($type === 'i') $value = ($value === null || $value === '') ? null : (int)$value;
                        if ($type === 's') $value = ($value === null || $value === '') ? null : trim((string)$value);
                        $fields[] = $field . " = ?";
                        $types .= $type;
                        $vals[] = $value;
                    }
                }
                if (!empty($fields)) {
                    $sql = "UPDATE tbl_attendance_records SET " . implode(', ', $fields) . " WHERE attendance_id = ?";
                    $types .= 'i';
                    $vals[] = (int)$row['attendance_id'];
                    $u = $mysqli->prepare($sql);
                    if (!$u) {
                        throw new Exception($mysqli->error);
                    }
                    safe_bind_params($u, $types, $vals);
                    if (!$u->execute()) {
                        throw new Exception($u->error);
                    }
                    $u->close();

                    $updatedStmt = $mysqli->prepare("SELECT checked_in_at, checked_mid_at, checked_out_at, flag_in_id, flag_check_id, flag_out_id FROM tbl_attendance_records WHERE attendance_id = ? LIMIT 1");
                    if (!$updatedStmt) {
                        throw new Exception($mysqli->error);
                    }
                    $updatedStmt->bind_param('i', $attendanceId);
                    if (!$updatedStmt->execute()) {
                        throw new Exception($updatedStmt->error);
                    }
                    $updated = $updatedStmt->get_result()->fetch_assoc();
                    $updatedStmt->close();

                    if (is_array($existing) && is_array($updated)) {
                        $ipAddr = $_SERVER['REMOTE_ADDR'] ?? ($_SERVER['HTTP_X_FORWARDED_FOR'] ?? '');
                        $actorName = null;
                        $nameStmt = $mysqli->prepare("SELECT CONCAT_WS(' ', first_name, last_name) AS full_name FROM tbl_users WHERE user_id = ? LIMIT 1");
                        if ($nameStmt) {
                            $nameStmt->bind_param('i', $authUserId);
                            if (!$nameStmt->execute()) {
                                throw new Exception($nameStmt->error);
                            }
                            $nameRow = $nameStmt->get_result()->fetch_assoc();
                            if ($nameRow && !empty($nameRow['full_name'])) $actorName = $nameRow['full_name'];
                            $nameStmt->close();
                        }

                        $todayPrefix = 'EDIT_' . date('Ymd') . '_';
                        $sessNumber = 1;
                        $sessStmt = $mysqli->prepare("SELECT edit_session_id FROM tbl_attendance_logs WHERE edit_session_id LIKE CONCAT(?, '%') ORDER BY edit_session_id DESC LIMIT 1");
                        if ($sessStmt) {
                            $sessStmt->bind_param('s', $todayPrefix);
                            if (!$sessStmt->execute()) {
                                throw new Exception($sessStmt->error);
                            }
                            $last = $sessStmt->get_result()->fetch_assoc();
                            if ($last && !empty($last['edit_session_id']) && preg_match('/_(\d{3})$/', $last['edit_session_id'], $m)) {
                                $sessNumber = (int)$m[1] + 1;
                            }
                            $sessStmt->close();
                        }
                        $editSessionId = $todayPrefix . sprintf('%03d', $sessNumber);

                        $approvalReason = "Approved via attendance edit request #{$requestId}";
                        $requestReason = trim((string)($row['reason'] ?? ''));
                        if ($requestReason !== '') $approvalReason .= ': ' . $requestReason;

                        $logMap = [
                            'flag_in_id' => 'flag_in',
                            'flag_check_id' => 'flag_mid',
                            'flag_out_id' => 'flag_out',
                            'checked_in_at' => 'time_in',
                            'checked_mid_at' => 'time_mid',
                            'checked_out_at' => 'time_out'
                        ];
                        foreach ($logMap as $dbField => $logName) {
                            $old = array_key_exists($dbField, $existing) ? $existing[$dbField] : null;
                            $new = array_key_exists($dbField, $updated) ? $updated[$dbField] : null;
                            if ($old === $new) continue;
                            log_attendance_change($mysqli, $authUserId, (int)$row['attendance_id'], $logName, $old, $new, $approvalReason, $ipAddr, 'approval', $editSessionId, $actorName);
                        }
                    }
                }
            }

            $upd = $mysqli->prepare("UPDATE tbl_attendance_edit_requests SET status = ?, decided_by = ? WHERE request_id = ?");
            if (!$upd) {
                throw new Exception($mysqli->error);
            }
            $upd->bind_param('sii', $decision, $authUserId, $requestId);
            if (!$upd->execute()) {
                throw new Exception($upd->error);
            }
            $upd->close();

            $mysqli->commit();
        } catch (Throwable $e) {
            $mysqli->rollback();
            json_response(['error' => 'update_failed', 'message' => $e->getMessage()], 500);
        }

        $logAction = $decision === 'approved' ? 'approve_attendance_edit_request' : 'reject_attendance_edit_request';
        log_system_action(
            $mysqli,
            $authUserId,
            $logAction,
            ucfirst($decision) . " attendance edit request #{$requestId} for attendance_id=" . (int)$row['attendance_id']
        );
        $targetUserId = isset($row['requested_by']) ? (int)$row['requested_by'] : 0;
        if ($targetUserId > 0) {
            $notifTitle = $decision === 'approved' ? 'Attendance Edit Approved' : 'Attendance Edit Rejected';
            $notifMessage = "Your attendance edit request was {$decision}.";
            notif_insert($mysqli, $targetUserId, $notifTitle, $notifMessage, '/my-requested-edits', $authUserId);
        }
        json_response(['ok' => true, 'request_id' => $requestId, 'status' => $decision]);
    }

    json_response(['error' => 'method_not_allowed'], 405);
}

if ($param1 === 'schedule') {
    if ($request_method === 'GET') {
        $scope = strtolower(trim((string)($_GET['scope'] ?? '')));
        $status = strtolower(trim((string)($_GET['status'] ?? '')));
        $validStatuses = ['pending', 'approved', 'rejected'];
        if (!in_array($status, $validStatuses, true)) $status = null;

        $sql = "SELECT
                    ser.request_id,
                    ser.schedule_id,
                    ser.requested_by,
                    ser.new_room_id,
                    ser.new_day_of_week,
                    TIME_FORMAT(ser.new_start_time, '%H:%i:%s') AS new_start_time,
                    TIME_FORMAT(ser.new_end_time, '%H:%i:%s') AS new_end_time,
                    ser.reason,
                    ser.status,
                    ser.requested_at,
                    ser.approved_by,
                    cs.room_id AS original_room_id,
                    LOWER(TRIM(cs.day_of_week)) AS original_day_of_week,
                    TIME_FORMAT(cs.start_time, '%H:%i:%s') AS original_start_time,
                    TIME_FORMAT(cs.end_time, '%H:%i:%s') AS original_end_time,
                    $teacherExpr AS teacher_id,
                    $sectionExpr AS section_id,
                    $subjectExpr AS subject_id,
                    $semesterExpr AS semester_id,
                    CONCAT(t.first_name, ' ', t.last_name) AS teacher_name,
                    t.dept_id AS teacher_dept_id,
                    CONCAT(req.first_name, ' ', req.last_name) AS requested_by_name,
                    CONCAT(ap.first_name, ' ', ap.last_name) AS approved_by_name,
                    r.room_name AS original_room_name,
                    nr.room_name AS new_room_name,
                    s.subject_code,
                    s.subject_name,
                    sec.section_name
                FROM tbl_schedule_edit_requests ser
                JOIN tbl_class_schedules cs ON ser.schedule_id = cs.schedule_id
                $joinOffering
                LEFT JOIN tbl_users t ON $teacherExpr = t.user_id
                LEFT JOIN tbl_subject s ON $subjectExpr = s.subject_id
                LEFT JOIN tbl_sections sec ON $sectionExpr = sec.section_id
                LEFT JOIN tbl_rooms r ON cs.room_id = r.room_id
                LEFT JOIN tbl_rooms nr ON ser.new_room_id = nr.room_id
                LEFT JOIN tbl_users req ON ser.requested_by = req.user_id
                LEFT JOIN tbl_users ap ON ser.approved_by = ap.user_id
                WHERE 1=1";
        $types = '';
        $params = [];
        request_edit_apply_scope_filter(
            $scope,
            $authRole,
            $authUserId,
            $authDeptId,
            4,
            'ser.requested_by',
            't.dept_id',
            $sql,
            $types,
            $params
        );

        if ($status !== null) {
            $sql .= " AND ser.status = ?";
            $types .= 's';
            $params[] = $status;
        }
        $sql .= " ORDER BY ser.requested_at DESC, ser.request_id DESC";

        $stmt = $mysqli->prepare($sql);
        if (!$stmt) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
        if (!empty($params)) safe_bind_params($stmt, $types, $params);
        if (!$stmt->execute()) json_response(['error' => 'execute_failed', 'message' => $stmt->error], 500);
        $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
        json_response($rows);
    }

    if ($request_method === 'POST' && empty($param2)) {
        if (!in_array((int)$authRole, [2, 3, 4, 5], true)) {
            json_response(['error' => 'forbidden', 'message' => 'Only dean, program head, secretary, and teacher can submit schedule edit requests'], 403);
        }

        $scheduleId = isset($input['schedule_id']) ? (int)$input['schedule_id'] : 0;
        $reason = trim((string)($input['reason'] ?? ''));
        $newRoomId = isset($input['new_room_id']) && $input['new_room_id'] !== '' ? (int)$input['new_room_id'] : null;
        $newDay = normalize_day($input['new_day_of_week'] ?? null);
        $newStart = normalize_time($input['new_start_time'] ?? null);
        $newEnd = normalize_time($input['new_end_time'] ?? null);

        if ($scheduleId <= 0 || $reason === '') {
            json_response(['error' => 'missing_fields', 'message' => 'schedule_id and reason are required'], 400);
        }
        $ctx = get_schedule_context($mysqli, $scheduleSchema, $scheduleId);
        if (!$ctx) json_response(['error' => 'not_found', 'message' => 'Schedule not found'], 404);

        if (!isset($ctx['teacher_id']) || (int)$ctx['teacher_id'] !== $authUserId) {
            json_response(['error' => 'forbidden', 'message' => 'You can only request edits for your own schedules'], 403);
        }

        $origRoom = isset($ctx['room_id']) ? (int)$ctx['room_id'] : null;
        $origDay = normalize_day($ctx['day_of_week'] ?? null);
        $origStart = normalize_time($ctx['start_time'] ?? null);
        $origEnd = normalize_time($ctx['end_time'] ?? null);

        $effectiveRoom = $newRoomId !== null ? $newRoomId : $origRoom;
        $effectiveDay = $newDay !== null ? $newDay : $origDay;
        $effectiveStart = $newStart !== null ? $newStart : $origStart;
        $effectiveEnd = $newEnd !== null ? $newEnd : $origEnd;

        $hasChange = false;
        if ($newRoomId !== null && $newRoomId !== $origRoom) $hasChange = true;
        if ($newDay !== null && $newDay !== $origDay) $hasChange = true;
        if ($newStart !== null && $newStart !== $origStart) $hasChange = true;
        if ($newEnd !== null && $newEnd !== $origEnd) $hasChange = true;

        if (!$hasChange) {
            json_response(['error' => 'no_changes', 'message' => 'Please change at least one field before submitting'], 400);
        }
        if (!$effectiveRoom || !$effectiveDay || !$effectiveStart || !$effectiveEnd) {
            json_response(['error' => 'invalid_effective_values', 'message' => 'Schedule values are incomplete'], 400);
        }
        if ($effectiveStart >= $effectiveEnd) {
            json_response(['error' => 'validation', 'message' => 'start_time must be before end_time'], 400);
        }

        $pendingSameSchedule = $mysqli->prepare("SELECT request_id FROM tbl_schedule_edit_requests WHERE schedule_id = ? AND status = 'pending' LIMIT 1");
        if ($pendingSameSchedule) {
            $pendingSameSchedule->bind_param('i', $scheduleId);
            $pendingSameSchedule->execute();
            if ($pendingSameSchedule->get_result()->fetch_assoc()) {
                json_response(['error' => 'duplicate_pending', 'message' => 'There is already a pending request for this schedule'], 409);
            }
        }

        $conflicts = find_schedule_conflicts(
            $mysqli,
            $scheduleSchema,
            $scheduleId,
            isset($ctx['semester_id']) ? ($ctx['semester_id'] !== null ? (int)$ctx['semester_id'] : null) : null,
            isset($ctx['teacher_id']) ? ($ctx['teacher_id'] !== null ? (int)$ctx['teacher_id'] : null) : null,
            isset($ctx['section_id']) ? ($ctx['section_id'] !== null ? (int)$ctx['section_id'] : null) : null,
            $effectiveRoom,
            $effectiveDay,
            $effectiveStart,
            $effectiveEnd
        );
        if (!empty($conflicts)) {
            json_response([
                'error' => 'schedule_conflict',
                'message' => $conflicts[0]['message'],
                'conflicts' => $conflicts
            ], 409);
        }

        $stmt = $mysqli->prepare("INSERT INTO tbl_schedule_edit_requests (schedule_id, requested_by, new_room_id, new_day_of_week, new_start_time, new_end_time, reason, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')");
        if (!$stmt) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
        $stmt->bind_param('iiissss', $scheduleId, $authUserId, $newRoomId, $newDay, $newStart, $newEnd, $reason);
        if (!$stmt->execute()) json_response(['error' => 'insert_failed', 'message' => $stmt->error], 500);
        $requestId = (int)$stmt->insert_id;

        log_system_action(
            $mysqli,
            $authUserId,
            'create_schedule_edit_request',
            "Submitted schedule edit request #{$requestId} for schedule_id={$scheduleId}"
        );
        if ((int)$authRole === 5 && $authDeptId !== null) {
            $requesterName = notif_get_user_full_name($mysqli, $authUserId);
            $notifTitle = 'Schedule Edit Request';
            $notifMessage = "{$requesterName} submitted a schedule edit request.";
            $notifLink = '/schedule-edit-requests?request_id=' . $requestId;
            notif_notify_role_dept($mysqli, 4, (int)$authDeptId, $notifTitle, $notifMessage, $notifLink, $authUserId, $authUserId);
            notif_notify_role_dept($mysqli, 3, (int)$authDeptId, $notifTitle, $notifMessage, $notifLink, $authUserId, $authUserId);
        }
        json_response(['ok' => true, 'request_id' => $requestId], 201);
    }

    if (($request_method === 'PUT' || $request_method === 'POST') && is_numeric($param2)) {
        if ($authRole !== 4) {
            json_response(['error' => 'forbidden', 'message' => 'Only secretary can decide schedule edit requests'], 403);
        }
        $requestId = (int)$param2;
        $decision = strtolower(trim((string)($input['decision'] ?? $input['status'] ?? '')));
        if (!in_array($decision, ['approved', 'rejected'], true)) {
            json_response(['error' => 'invalid_decision', 'message' => 'decision must be approved or rejected'], 400);
        }

        $sql = "SELECT
                    ser.request_id,
                    ser.schedule_id,
                    ser.requested_by,
                    ser.status,
                    ser.new_room_id,
                    ser.new_day_of_week,
                    TIME_FORMAT(ser.new_start_time, '%H:%i:%s') AS new_start_time,
                    TIME_FORMAT(ser.new_end_time, '%H:%i:%s') AS new_end_time,
                    ser.reason,
                    cs.room_id AS original_room_id,
                    LOWER(TRIM(cs.day_of_week)) AS original_day_of_week,
                    TIME_FORMAT(cs.start_time, '%H:%i:%s') AS original_start_time,
                    TIME_FORMAT(cs.end_time, '%H:%i:%s') AS original_end_time,
                    $teacherExpr AS teacher_id,
                    $sectionExpr AS section_id,
                    $subjectExpr AS subject_id,
                    $semesterExpr AS semester_id,
                    t.dept_id AS teacher_dept_id
                FROM tbl_schedule_edit_requests ser
                JOIN tbl_class_schedules cs ON ser.schedule_id = cs.schedule_id
                $joinOffering
                LEFT JOIN tbl_users t ON $teacherExpr = t.user_id
                WHERE ser.request_id = ?
                LIMIT 1";
        $check = $mysqli->prepare($sql);
        if (!$check) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
        $check->bind_param('i', $requestId);
        $check->execute();
        $row = $check->get_result()->fetch_assoc();
        if (!$row) json_response(['error' => 'not_found', 'message' => 'Schedule edit request not found'], 404);
        if ($authDeptId === null || (int)$row['teacher_dept_id'] !== (int)$authDeptId) {
            json_response(['error' => 'forbidden', 'message' => 'Request belongs to another department'], 403);
        }
        if (strtolower((string)$row['status']) !== 'pending') {
            json_response(['error' => 'already_decided', 'message' => 'Request is already decided'], 409);
        }

        $effectiveRoom = $row['new_room_id'] !== null ? (int)$row['new_room_id'] : (int)$row['original_room_id'];
        $effectiveDay = normalize_day($row['new_day_of_week'] ?? null);
        if ($effectiveDay === null) $effectiveDay = normalize_day($row['original_day_of_week'] ?? null);
        $effectiveStart = normalize_time($row['new_start_time'] ?? null);
        if ($effectiveStart === null) $effectiveStart = normalize_time($row['original_start_time'] ?? null);
        $effectiveEnd = normalize_time($row['new_end_time'] ?? null);
        if ($effectiveEnd === null) $effectiveEnd = normalize_time($row['original_end_time'] ?? null);

        if (!$effectiveRoom || !$effectiveDay || !$effectiveStart || !$effectiveEnd) {
            json_response(['error' => 'invalid_effective_values', 'message' => 'Resulting schedule values are incomplete'], 400);
        }
        if ($effectiveStart >= $effectiveEnd) {
            json_response(['error' => 'validation', 'message' => 'start_time must be before end_time'], 400);
        }

        if ($decision === 'approved') {
            $conflicts = find_schedule_conflicts(
                $mysqli,
                $scheduleSchema,
                (int)$row['schedule_id'],
                isset($row['semester_id']) ? ($row['semester_id'] !== null ? (int)$row['semester_id'] : null) : null,
                isset($row['teacher_id']) ? ($row['teacher_id'] !== null ? (int)$row['teacher_id'] : null) : null,
                isset($row['section_id']) ? ($row['section_id'] !== null ? (int)$row['section_id'] : null) : null,
                $effectiveRoom,
                $effectiveDay,
                $effectiveStart,
                $effectiveEnd
            );
            if (!empty($conflicts)) {
                json_response([
                    'error' => 'schedule_conflict',
                    'message' => $conflicts[0]['message'],
                    'conflicts' => $conflicts
                ], 409);
            }
        }

        $mysqli->begin_transaction();
        try {
            if ($decision === 'approved') {
                $us = $mysqli->prepare("UPDATE tbl_class_schedules SET room_id = ?, day_of_week = ?, start_time = ?, end_time = ? WHERE schedule_id = ?");
                if (!$us) throw new Exception($mysqli->error);
                $scheduleId = (int)$row['schedule_id'];
                $us->bind_param('isssi', $effectiveRoom, $effectiveDay, $effectiveStart, $effectiveEnd, $scheduleId);
                if (!$us->execute()) throw new Exception($us->error);
            }

            $ur = $mysqli->prepare("UPDATE tbl_schedule_edit_requests SET status = ?, approved_by = ? WHERE request_id = ?");
            if (!$ur) throw new Exception($mysqli->error);
            $ur->bind_param('sii', $decision, $authUserId, $requestId);
            if (!$ur->execute()) throw new Exception($ur->error);

            $mysqli->commit();
        } catch (Throwable $e) {
            $mysqli->rollback();
            json_response(['error' => 'update_failed', 'message' => $e->getMessage()], 500);
        }

        $logAction = $decision === 'approved' ? 'approve_schedule_edit_request' : 'reject_schedule_edit_request';
        log_system_action(
            $mysqli,
            $authUserId,
            $logAction,
            ucfirst($decision) . " schedule edit request #{$requestId} for schedule_id=" . (int)$row['schedule_id']
        );
        $targetUserId = isset($row['requested_by']) ? (int)$row['requested_by'] : 0;
        if ($targetUserId > 0) {
            $notifTitle = $decision === 'approved' ? 'Schedule Edit Approved' : 'Schedule Edit Rejected';
            $notifMessage = "Your schedule edit request was {$decision}.";
            notif_insert($mysqli, $targetUserId, $notifTitle, $notifMessage, '/my-requested-edits', $authUserId);
        }
        json_response(['ok' => true, 'request_id' => $requestId, 'status' => $decision]);
    }

    json_response(['error' => 'method_not_allowed'], 405);
}

json_response(['error' => 'endpoint_not_found'], 404);
