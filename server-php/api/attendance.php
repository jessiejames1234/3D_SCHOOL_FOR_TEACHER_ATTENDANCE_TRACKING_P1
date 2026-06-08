<?php
// server-php/api/attendance.php
require_once __DIR__ . '/../helpers/socket_helper.php';
require_once __DIR__ . '/../helpers/attendance-logs.php';
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
global $mysqli;

$request_method = $_SERVER['REQUEST_METHOD'];
$input = get_input();

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$parts = explode('/', $path);
$api_prefix_key = array_search('api', $parts);

$endpoint = $parts[$api_prefix_key + 1] ?? null;
$param1 = $parts[$api_prefix_key + 2] ?? null;

// =================================================================================
// 1. AUTHENTICATION (Identify who is logged in for the logs)
// =================================================================================
$authHeader = null;
$candidates = ['HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION', 'HTTP_X_AUTHORIZATION', 'HTTP_X_API_TOKEN', 'HTTP_AUTH', 'AUTHORIZATION'];
foreach ($candidates as $k) { if (!empty($_SERVER[$k])) { $authHeader = $_SERVER[$k]; break; } }

if (empty($authHeader) && function_exists('apache_request_headers')) {
    $headers = apache_request_headers();
    foreach (['Authorization','authorization','AUTHORIZATION'] as $h) { if (!empty($headers[$h])) { $authHeader = $headers[$h]; break; } }
}

$queryToken = $_GET['token'] ?? null;
if (empty($authHeader) && !empty($queryToken)) { $authHeader = 'Bearer ' . $queryToken; }

$authUserId = null; // Default to null (system action) if not logged in








// function generateAttendanceWeek($start_date_str, $end_date_str) {
//     global $mysqli;
//     $today = new DateTime();
//     $today->setTime(0, 0, 0);

//     $defaultStart = clone $today;
//     $defaultEnd = clone $today;
//     $defaultEnd->modify('+6 days');

//     $rangeStart = $start_date_str ? new DateTime($start_date_str) : $defaultStart;
//     $rangeEnd = $end_date_str ? new DateTime($end_date_str) : $defaultEnd;

//     if ($rangeEnd < $rangeStart) {
//         throw new Exception("end_date must be >= start_date");
//     }

//     $sql = "SELECT cs.schedule_id, cs.room_id, r.floor_id AS room_floor_id, cs.day_of_week, so.user_id AS teacher_id, sem.start_date, sem.end_date FROM tbl_class_schedules cs JOIN tbl_subject_offerings so ON cs.offering_id = so.offering_id JOIN tbl_semesters sem ON so.semester_id = sem.semester_id JOIN tbl_rooms r ON cs.room_id = r.room_id";
//     $schedules_result = $mysqli->query($sql);
//     $schedules = $schedules_result->fetch_all(MYSQLI_ASSOC);

//     $dayMap = ['sunday' => 0, 'monday' => 1, 'tuesday' => 2, 'wednesday' => 3, 'thursday' => 4, 'friday' => 5, 'saturday' => 6];
//     $totalInserted = 0;

//     foreach ($schedules as $row) {
//         $targetDow = $dayMap[strtolower($row['day_of_week'])] ?? -1;
//         if ($targetDow === -1) continue;

//         $semStart = new DateTime($row['start_date']);
//         $semEnd = new DateTime($row['end_date']);
        
//         $effStart = max($rangeStart, $semStart);
//         $effEnd = min($rangeEnd, $semEnd);
        
//         if ($effEnd < $effStart) continue;
        
//         $currentDate = clone $effStart;
//         while ($currentDate <= $effEnd) {
//             if ((int)$currentDate->format('w') === $targetDow) {
//                 $dateStr = $currentDate->format('Y-m-d');
//                 $stmt = $mysqli->prepare("INSERT INTO tbl_attendance_records (user_id, schedule_id, room_id, floor_id, date, flag_in_id, flag_check_id, flag_out_id) SELECT ?, ?, ?, ?, ?, 1, 1, 1 FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tbl_attendance_records WHERE user_id = ? AND schedule_id = ? AND date = ?)");
//                 $stmt->bind_param("iiiisiss", $row['teacher_id'], $row['schedule_id'], $row['room_id'], $row['room_floor_id'], $dateStr, $row['teacher_id'], $row['schedule_id'], $dateStr);
//                 $stmt->execute();
//                 $totalInserted += $stmt->affected_rows;
//             }
//             $currentDate->modify('+1 day');
//         }
//     }
//     return [
//         'inserted' => $totalInserted,
//         'rangeStart' => $rangeStart->format('Y-m-d'),
//         'rangeEnd' => $rangeEnd->format('Y-m-d'),
//     ];
// }










// Add a small helper to bind params safely using references (call_user_func_array)
function safe_bind_params($stmt, $types, $params) {
    // prepare array of references: first element is types string
    $refs = [];
    $refs[] = &$types;
    // bind_param requires variables passed by reference
    foreach ($params as $k => $v) {
        // ensure we have variables (not literals) to reference
        $refs[] = &$params[$k];
    }
    return call_user_func_array([$stmt, 'bind_param'], $refs);
}

function attendance_table_exists($mysqli, $table) {
    $table = preg_replace('/[^a-zA-Z0-9_]/', '', (string)$table);
    if ($table === '') return false;
    $safe = $mysqli->real_escape_string($table);
    $res = $mysqli->query("SHOW TABLES LIKE '{$safe}'");
    return $res && (int)$res->num_rows > 0;
}

function attendance_column_exists($mysqli, $table, $column) {
    $table = preg_replace('/[^a-zA-Z0-9_]/', '', (string)$table);
    $column = preg_replace('/[^a-zA-Z0-9_]/', '', (string)$column);
    if ($table === '' || $column === '') return false;
    $safeColumn = $mysqli->real_escape_string($column);
    $res = $mysqli->query("SHOW COLUMNS FROM `$table` LIKE '{$safeColumn}'");
    return $res && (int)$res->num_rows > 0;
}

// --- ROUTING within attendance.php ---
// When included from another PHP script (e.g. to call generateAttendanceWeek),
// callers can set $GLOBALS['SKIP_ATTENDANCE_ROUTING'] = true to prevent the
// routing logic below from running (which would call json_response() and exit).
if (empty($GLOBALS['SKIP_ATTENDANCE_ROUTING'])) {

// Auto-reset temporary floor overrides for attendance records whose class end time already passed
// This ensures the 'temporary floor' set during checks is cleared after class end.
$mysqli->query("UPDATE tbl_attendance_records ar JOIN tbl_class_schedules cs ON ar.schedule_id = cs.schedule_id JOIN tbl_rooms r ON ar.room_id = r.room_id SET ar.floor_id = r.floor_id WHERE TIMESTAMP(ar.date, cs.end_time) < NOW() AND ar.floor_id != r.floor_id");

// --- DISABLED: automatic generation function removed per request ---
// The generateAttendanceWeek function remains available if included directly, but its
// automatic invocation and any exposed endpoints that create attendance rows have been
// intentionally disabled to prevent automatic insertion of attendance records.

// To re-enable generation, set $GLOBALS['ENABLE_AUTOGEN'] = true before including this file
// or call generateAttendanceWeek(...) manually from a controlled script.

if ($request_method === 'GET' && $endpoint === 'attendance') {
    $hasSubjectOfferings = attendance_table_exists($mysqli, 'tbl_subject_offerings');
    $csHasOffering = attendance_column_exists($mysqli, 'tbl_class_schedules', 'offering_id');
    $csHasSubject = attendance_column_exists($mysqli, 'tbl_class_schedules', 'subject_id');
    $csHasSection = attendance_column_exists($mysqli, 'tbl_class_schedules', 'section_id');
    $soHasSubject = $hasSubjectOfferings ? attendance_column_exists($mysqli, 'tbl_subject_offerings', 'subject_id') : false;
    $soHasSection = $hasSubjectOfferings ? attendance_column_exists($mysqli, 'tbl_subject_offerings', 'section_id') : false;
    $joinOffering = ($hasSubjectOfferings && $csHasOffering) ? "LEFT JOIN tbl_subject_offerings so ON cs.offering_id = so.offering_id" : "";
    $subjectExpr = $csHasSubject ? 'cs.subject_id' : (($hasSubjectOfferings && $csHasOffering && $soHasSubject) ? 'so.subject_id' : 'NULL');
    $sectionExpr = $csHasSection ? 'cs.section_id' : (($hasSubjectOfferings && $csHasOffering && $soHasSection) ? 'so.section_id' : 'NULL');

    // This GET endpoint is confirmed to be correct.
    $sql = "
      SELECT
        ar.attendance_id,
        ar.user_id,
        ar.schedule_id,
        ar.room_id,
        ar.floor_id,
        DATE_FORMAT(ar.date, '%Y-%m-%d') AS date,
        cs.semester_id,
        cs.day_of_week,
        {$subjectExpr} AS subject_id,
        {$sectionExpr} AS section_id,
        ar.checked_in_at AS time_in,
        ar.altitude_in,
        ar.latitude_in,
        ar.longitude_in,
        ar.flag_in_id,
        ar.checked_mid_at AS time_check,
        ar.altitude_check,
        ar.latitude_check,
        ar.longitude_check,
        ar.flag_check_id,
        ar.checked_out_at AS time_out,
        ar.altitude_out,
        ar.latitude_out,
        ar.longitude_out,
        ar.flag_out_id,
        u.first_name,
        u.last_name,
        NULLIF(CAST(u.image AS CHAR), '') AS avatar,
        u.dept_id,
        cs.start_time,
        cs.end_time,
        r.room_name,
        sc.school_name AS campus_name,
        sc.school_name AS school_name,
        b.building_name,
        COALESCE(f.floor_name, rf.floor_name) AS floor_name,
        s.subject_code,
        s.subject_name,
        sec.section_name,
        ft_in.flag_name AS flag_in_name,
        ft_check.flag_name AS flag_check_name,
        ft_out.flag_name AS flag_out_name,
        f.floor_name AS attendance_floor_name

      FROM tbl_attendance_records ar
      JOIN tbl_users u              ON ar.user_id = u.user_id
      JOIN tbl_class_schedules cs   ON ar.schedule_id = cs.schedule_id
      JOIN tbl_rooms r              ON ar.room_id = r.room_id
      LEFT JOIN tbl_floors f        ON ar.floor_id = f.floor_id
      LEFT JOIN tbl_floors rf       ON r.floor_id = rf.floor_id
      LEFT JOIN tbl_buildings b     ON r.building_id = b.building_id
      LEFT JOIN tbl_school sc       ON b.school_id = sc.school_id
      {$joinOffering}
      LEFT JOIN tbl_subject s       ON {$subjectExpr} = s.subject_id
      LEFT JOIN tbl_sections sec    ON {$sectionExpr} = sec.section_id
      LEFT JOIN tbl_flag_types ft_in    ON ar.flag_in_id = ft_in.flag_id
      LEFT JOIN tbl_flag_types ft_check ON ar.flag_check_id = ft_check.flag_id
      LEFT JOIN tbl_flag_types ft_out   ON ar.flag_out_id = ft_out.flag_id
    ";
    $where = []; $params = []; $types = '';

    // --- Server-side RBAC: require Authorization header and restrict by role/department ---
    // Robust token extraction across different PHP setups
    $authHeader = null;
    // Common server variables
    $candidates = [
        'HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION', 'HTTP_X_AUTHORIZATION', 'HTTP_X_API_TOKEN', 'HTTP_AUTH', 'AUTHORIZATION'
    ];
    foreach ($candidates as $k) {
        if (!empty($_SERVER[$k])) { $authHeader = $_SERVER[$k]; break; }
    }
    // Try apache_request_headers if available
    if (empty($authHeader) && function_exists('apache_request_headers')) {
        $headers = apache_request_headers();
        foreach (['Authorization','authorization','AUTHORIZATION'] as $h) {
            if (!empty($headers[$h])) { $authHeader = $headers[$h]; break; }
        }
    }
    // Fallback: allow token via query param ?token= for clients that can't set headers
    $queryToken = $_GET['token'] ?? null;
    if (empty($authHeader) && !empty($queryToken)) {
        $authHeader = 'Bearer ' . $queryToken;
    }

    if (empty($authHeader)) {
        json_response(['error' => 'missing_authorization'], 401);
    }
    if (!preg_match('/Bearer\s+(\S+)/i', $authHeader, $m)) {
        json_response(['error' => 'invalid_authorization_format'], 401);
    }
    $token = $m[1];
    // load secret
    $sec = [];
    if (file_exists(__DIR__ . '/../config/security.php')) $sec = require __DIR__ . '/../config/security.php';
    $secret_key = $sec['jwt_secret'] ?? 'your-secret-key';
    try {
        $decoded = JWT::decode($token, new Key($secret_key, 'HS256'));
    } catch (Throwable $e) {
        json_response(['error' => 'invalid_token', 'message' => $e->getMessage()], 401);
    }
    $authRole = isset($decoded->role_id) ? (int)$decoded->role_id : null;
    $authUserId = isset($decoded->user_id) ? (int)$decoded->user_id : null;

    // Log decoded identity for diagnostics
    error_log("attendance: decoded token -> user_id={$authUserId}, role_id={$authRole}");

    $resolveUserDeptId = function($userId) use ($mysqli) {
        $uid = (int)$userId;
        if ($uid <= 0) return null;
        $deptId = null;

        $uStmt = $mysqli->prepare("SELECT dept_id FROM tbl_users WHERE user_id = ? LIMIT 1");
        if ($uStmt) {
            $uStmt->bind_param('i', $uid);
            $uStmt->execute();
            $uRow = $uStmt->get_result()->fetch_assoc();
            if ($uRow && isset($uRow['dept_id']) && $uRow['dept_id'] !== null) {
                $deptId = (int)$uRow['dept_id'];
            }
        }

        if ($deptId !== null) return $deptId;

        if (attendance_column_exists($mysqli, 'tbl_departments', 'dean_id')) {
            $dStmt = $mysqli->prepare("SELECT dept_id FROM tbl_departments WHERE dean_id = ? LIMIT 1");
            if ($dStmt) {
                $dStmt->bind_param('i', $uid);
                $dStmt->execute();
                $dRow = $dStmt->get_result()->fetch_assoc();
                if ($dRow && isset($dRow['dept_id']) && $dRow['dept_id'] !== null) {
                    return (int)$dRow['dept_id'];
                }
            }
        }

        return null;
    };

    $resolveProgramHeadProgramIds = function($userId) use ($mysqli) {
        $uid = (int)$userId;
        if ($uid <= 0) return [];
        $programIds = [];

        $headColumn = null;
        if (attendance_column_exists($mysqli, 'tbl_programs', 'head_id')) {
            $headColumn = 'head_id';
        } elseif (attendance_column_exists($mysqli, 'tbl_programs', 'program_head_id')) {
            $headColumn = 'program_head_id';
        }

        if ($headColumn !== null) {
            $sql = "SELECT program_id FROM tbl_programs WHERE {$headColumn} = ?";
            $pStmt = $mysqli->prepare($sql);
            if ($pStmt) {
                $pStmt->bind_param('i', $uid);
                $pStmt->execute();
                $res = $pStmt->get_result();
                if ($res) {
                    while ($row = $res->fetch_assoc()) {
                        $pid = isset($row['program_id']) ? (int)$row['program_id'] : 0;
                        if ($pid > 0) $programIds[] = $pid;
                    }
                }
            }
        }

        if (empty($programIds) && attendance_column_exists($mysqli, 'tbl_users', 'program_id')) {
            $uStmt = $mysqli->prepare("SELECT program_id FROM tbl_users WHERE user_id = ? LIMIT 1");
            if ($uStmt) {
                $uStmt->bind_param('i', $uid);
                $uStmt->execute();
                $uRow = $uStmt->get_result()->fetch_assoc();
                $pid = ($uRow && isset($uRow['program_id'])) ? (int)$uRow['program_id'] : 0;
                if ($pid > 0) $programIds[] = $pid;
            }
        }

        $programIds = array_values(array_unique(array_filter($programIds, function($v){ return (int)$v > 0; })));
        return $programIds;
    };

    // Teachers: allow only access to their own attendance rows (GET requests)
    if ($authRole === 5) {
        // If caller didn't specify teacher_id, default it to the authenticated user
        if (empty($_GET['teacher_id'])) {
            $_GET['teacher_id'] = $authUserId;
        }
        // If a teacher tries to request other teacher's data, forbid
        if (!empty($_GET['teacher_id']) && (int)$_GET['teacher_id'] !== (int)$authUserId) {
            json_response(['error' => 'forbidden', 'message' => 'Teachers can only access their own attendance'], 403);
        }
        // otherwise allow to continue and the later WHERE clause will filter by ar.user_id
    }

    // Dean + secretary: restrict to their department
    if (in_array($authRole, [2,4], true)) {
        $deptId = $resolveUserDeptId($authUserId);
        error_log("attendance: resolved dept scope for user {$authUserId} role {$authRole} -> dept_id=" . var_export($deptId, true));
        if ($deptId !== null) {
            $where[] = 'u.dept_id = ?';
            $params[] = $deptId;
            $types .= 'i';
        } else {
            json_response([], 200);
        }
    }

    // Program head: restrict to assigned program(s)
    if ((int)$authRole === 3) {
        $programIds = $resolveProgramHeadProgramIds($authUserId);
        error_log("attendance: resolved program scope for user {$authUserId} -> program_ids=" . json_encode($programIds));
        if (empty($programIds)) {
            json_response([], 200);
        }

        $subjectHasProgram = attendance_column_exists($mysqli, 'tbl_subject', 'program_id');
        $sectionHasProgram = attendance_column_exists($mysqli, 'tbl_sections', 'program_id');
        $programExpr = null;
        if ($subjectHasProgram && $sectionHasProgram) {
            $programExpr = 'COALESCE(s.program_id, sec.program_id)';
        } elseif ($subjectHasProgram) {
            $programExpr = 's.program_id';
        } elseif ($sectionHasProgram) {
            $programExpr = 'sec.program_id';
        }

        if ($programExpr === null) {
            json_response([], 200);
        }

        $placeholders = implode(',', array_fill(0, count($programIds), '?'));
        $where[] = "{$programExpr} IN ({$placeholders})";
        foreach ($programIds as $pid) {
            $params[] = (int)$pid;
            $types .= 'i';
        }
    }

    if (!empty($_GET['date'])) { $where[] = 'ar.date = ?'; $params[] = $_GET['date']; $types .= 's'; }
    if (!empty($_GET['status'])) {
        // match status against any of the flag name aliases (in/check/out)
        $where[] = '(ft_in.flag_name = ? OR ft_check.flag_name = ? OR ft_out.flag_name = ?)';
        $params[] = $_GET['status']; $params[] = $_GET['status']; $params[] = $_GET['status']; $types .= 'sss';
    }
    if (!empty($_GET['teacher_id'])) { $where[] = 'ar.user_id = ?'; $params[] = (int)$_GET['teacher_id']; $types .= 'i'; }
    if (!empty($where)) { $sql .= ' WHERE ' . implode(' AND ', $where); }
    $sql .= ' ORDER BY ar.date DESC, cs.start_time, u.last_name, u.first_name';

    // Log final sql/types/params for debugging
    error_log("attendance: final sql=" . str_replace("\n", ' ', $sql));
    error_log("attendance: types={$types} params=" . json_encode($params));

    $stmt = $mysqli->prepare($sql);
    if ($stmt === false) {
        json_response(['error' => 'Failed to prepare attendance query', 'sql_error' => $mysqli->error, 'sql' => $sql], 500);
    }

    // If we only have a single integer dept param (common RBAC case), bind it explicitly to avoid variadic/reference issues
    if (!empty($params)) {
        // fallback to safe helper (already defined in file)
        safe_bind_params($stmt, $types, $params);
    }
    if (!$stmt->execute()) {
        json_response(['error' => 'Failed to execute attendance query', 'stmt_error' => $stmt->error], 500);
    }
    $res = $stmt->get_result();
    if ($res === false) {
        error_log('attendance: get_result returned false, stmt_error=' . $stmt->error);
        json_response(['error' => 'Failed to fetch attendance result', 'stmt_error' => $stmt->error], 500);
    }
    $num = $res->num_rows;
    error_log("attendance: fetched rows count={$num}");
    $rows = $res->fetch_all(MYSQLI_ASSOC);
    json_response($rows);

} elseif ($request_method === 'POST' && $endpoint === 'attendance' && empty($param1)) {
    // Create a new attendance record (used by admin/secretary UI when adding a placeholder record)
    
    // Force integer conversion immediately
    $userId     = isset($input['user_id']) ? (int)$input['user_id'] : 0;
    $scheduleId = isset($input['schedule_id']) ? (int)$input['schedule_id'] : 0;
    $roomId     = isset($input['room_id']) ? (int)$input['room_id'] : 0;
    $date       = isset($input['date']) ? $input['date'] : null;
    $remarks    = isset($input['remarks']) ? $input['remarks'] : null;

    // --- SECURITY FIX: STRICT VALIDATION ---
    if ($userId <= 0 || $scheduleId <= 0 || !$date) {
        json_response(['ok' => false, 'error' => 'missing_fields', 'message' => 'User ID, Schedule ID, and Date are required'], 400);
    }
    // ---------------------------------------

    // Block future dates
    if ($date > date('Y-m-d')) json_response(['ok' => false, 'error' => 'future_date_not_allowed'], 400);

    // ... (The rest of your logic stays exactly the same) ...
    // Server-side duplicate check: same teacher, same schedule, same date
    $dup = $mysqli->prepare("SELECT 1 FROM tbl_attendance_records WHERE user_id = ? AND schedule_id = ? AND date = ? LIMIT 1");
    if ($dup) {
        $dup->bind_param('iis', $userId, $scheduleId, $date);
        $dup->execute();
        $exists = $dup->get_result()->fetch_assoc();
        if ($exists) json_response(['ok' => false, 'error' => 'duplicate_record'], 409);
    }

    // Clone/overlap check: ensure teacher does not have another attendance at overlapping schedule time on same date
    $sStmt = $mysqli->prepare("SELECT start_time, end_time FROM tbl_class_schedules WHERE schedule_id = ? LIMIT 1");
    if ($sStmt) {
        $sStmt->bind_param('i', $scheduleId);
        $sStmt->execute();
        $sRow = $sStmt->get_result()->fetch_assoc();
        if ($sRow) {
            $newStart = $sRow['start_time'];
            $newEnd = $sRow['end_time'];
            $overlapSql = "SELECT 1 FROM tbl_attendance_records ar JOIN tbl_class_schedules cs2 ON ar.schedule_id = cs2.schedule_id WHERE ar.user_id = ? AND ar.date = ? AND NOT (cs2.end_time <= ? OR cs2.start_time >= ?) LIMIT 1";
            $ov = $mysqli->prepare($overlapSql);
            if ($ov) {
                $ov->bind_param('isss', $userId, $date, $newStart, $newEnd);
                $ov->execute();
                $found = $ov->get_result()->fetch_assoc();
                if ($found) json_response(['ok' => false, 'error' => 'time_conflict_with_existing_attendance'], 409);
            }
        }
    }

    // Map optional fields and flags
    $flag_in = isset($input['flag_in_id']) ? (int)$input['flag_in_id'] : 1;
    $flag_check = isset($input['flag_check_id']) ? (int)$input['flag_check_id'] : $flag_in;
    $flag_out = isset($input['flag_out_id']) ? (int)$input['flag_out_id'] : $flag_in;
    $checked_in = isset($input['checked_in_at']) ? $input['checked_in_at'] : null;
    $checked_out = isset($input['checked_out_at']) ? $input['checked_out_at'] : null;

    // Resolve floor_id from room to satisfy foreign key constraint
    $floorId = null;
    if (!empty($roomId)) {
        $rf = $mysqli->prepare("SELECT floor_id FROM tbl_rooms WHERE room_id = ? LIMIT 1");
        if ($rf) {
            $rf->bind_param('i', $roomId);
            $rf->execute();
            $rrow = $rf->get_result()->fetch_assoc();
            if ($rrow && isset($rrow['floor_id'])) {
                $floorId = (int)$rrow['floor_id'];
            } else {
                // room exists but no floor mapping -> cannot insert due to FK
                json_response(['ok' => false, 'error' => 'room_floor_missing', 'message' => 'Selected room does not have a floor_id mapping'], 400);
            }
        }
    }

    // If status is absent (flag 3) enforce no times
    if ($flag_in === 3) { $checked_in = null; $checked_out = null; }

    // Build dynamic insert to accept optional checked_in/out and remarks
    $fields = ['user_id','schedule_id','room_id','floor_id','date','flag_in_id','flag_check_id','flag_out_id'];
    $placeholders = ['?','?','?','?','?','?','?','?'];
    $types = 'iiiisiii';
    $values = [$userId, $scheduleId, $roomId ?: null, $floorId, $date, $flag_in, $flag_check, $flag_out];

    if ($checked_in !== null) { $fields[] = 'checked_in_at'; $placeholders[] = '?'; $types .= 's'; $values[] = $checked_in; }
    if ($checked_out !== null) { $fields[] = 'checked_out_at'; $placeholders[] = '?'; $types .= 's'; $values[] = $checked_out; }
    if ($remarks !== null) { $fields[] = 'remarks'; $placeholders[] = '?'; $types .= 's'; $values[] = $remarks; }

    $sql = "INSERT INTO tbl_attendance_records (" . implode(',', $fields) . ") VALUES (" . implode(',', $placeholders) . ")";
    $stmt = $mysqli->prepare($sql);
    if (!$stmt) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error, 'sql' => $sql], 500);

    // bind params
    if (!empty($values)) safe_bind_params($stmt, $types, $values);
    if (!$stmt->execute()) json_response(['error' => 'insert_failed', 'message' => $stmt->error], 500);
    $newId = $stmt->insert_id;

    // Get the dept_id of the user whose attendance record was created
    $dept_id = null;
    $uStmt = $mysqli->prepare("SELECT dept_id FROM tbl_users WHERE user_id = ? LIMIT 1");
    if ($uStmt) {
        $uStmt->bind_param('i', $userId);
        $uStmt->execute();
        $uRow = $uStmt->get_result()->fetch_assoc();
        if ($uRow && isset($uRow['dept_id'])) { $dept_id = (int)$uRow['dept_id']; }
    }

    // Notify websocket listeners
    try {
        $payload = ['entity' => 'attendance', 'action' => 'create', 'attendance_id' => $newId, 'user_id' => $userId, 'schedule_id' => $scheduleId, 'date' => $date];
        if ($dept_id) { $payload['dept_id'] = $dept_id; }
        trigger_socket_update($payload);
    } catch (Throwable $_) {}
    json_response(['ok' => true, 'attendance_id' => $newId], 201);

} elseif ($request_method === 'PUT' && $endpoint === 'attendance' && is_numeric($param1)) {
    // Update an existing attendance record (used by admin/secretary UI edit)
    $attendanceId = (int)$param1;
    // ensure exists and fetch current values for logging
    $check = $mysqli->prepare("SELECT * FROM tbl_attendance_records WHERE attendance_id = ? LIMIT 1");
    if (!$check) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
    $check->bind_param('i', $attendanceId);
    $check->execute();
    $existing = $check->get_result()->fetch_assoc();
    if (!$existing) json_response(['error' => 'not_found', 'message' => 'Attendance record not found'], 404);

    // Determine actor (who edited) by decoding bearer token if present
    $authUserId = null;
    $authHeaderLocal = null;
    $candidates = ['HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION', 'HTTP_X_AUTHORIZATION', 'HTTP_X_API_TOKEN', 'HTTP_AUTH', 'AUTHORIZATION'];
    foreach ($candidates as $k) { if (!empty($_SERVER[$k])) { $authHeaderLocal = $_SERVER[$k]; break; } }
    if (empty($authHeaderLocal) && function_exists('apache_request_headers')) {
        $headers = apache_request_headers();
        foreach (['Authorization','authorization','AUTHORIZATION'] as $h) { if (!empty($headers[$h])) { $authHeaderLocal = $headers[$h]; break; } }
    }
    $queryToken = $_GET['token'] ?? null;
    if (empty($authHeaderLocal) && !empty($queryToken)) { $authHeaderLocal = 'Bearer ' . $queryToken; }
    if (!empty($authHeaderLocal) && preg_match('/Bearer\s+(\S+)/i', $authHeaderLocal, $m)) {
        $token = $m[1];
        $sec = [];
        if (file_exists(__DIR__ . '/../config/security.php')) $sec = require __DIR__ . '/../config/security.php';
        $secret_key = $sec['jwt_secret'] ?? 'your-secret-key';
        try {
            $decoded = JWT::decode($token, new Key($secret_key, 'HS256'));
            $authUserId = isset($decoded->user_id) ? (int)$decoded->user_id : null;
        } catch (Throwable $_) { $authUserId = null; }
    }

    // Build dynamic update - allow changing room_id, date, checked_in_at, checked_out_at, flag_in_id, flag_check_id, flag_out_id, schedule_id, user_id, remarks
    $fields = [];
    $types = '';
    $values = [];
    if (isset($input['user_id'])) { $fields[] = 'user_id = ?'; $types .= 'i'; $values[] = (int)$input['user_id']; }
    if (isset($input['schedule_id'])) { $fields[] = 'schedule_id = ?'; $types .= 'i'; $values[] = (int)$input['schedule_id']; }
    if (isset($input['room_id'])) { $fields[] = 'room_id = ?'; $types .= 'i'; $values[] = (int)$input['room_id']; }
    if (isset($input['date'])) { $fields[] = 'date = ?'; $types .= 's'; $values[] = $input['date']; }
    if (isset($input['checked_in_at'])) { $fields[] = 'checked_in_at = ?'; $types .= 's'; $values[] = $input['checked_in_at']; }
    if (isset($input['checked_mid_at'])) { $fields[] = 'checked_mid_at = ?'; $types .= 's'; $values[] = $input['checked_mid_at']; }
    if (isset($input['checked_out_at'])) { $fields[] = 'checked_out_at = ?'; $types .= 's'; $values[] = $input['checked_out_at']; }
    if (isset($input['flag_in_id'])) { $fields[] = 'flag_in_id = ?'; $types .= 'i'; $values[] = (int)$input['flag_in_id']; }
    if (isset($input['flag_check_id'])) { $fields[] = 'flag_check_id = ?'; $types .= 'i'; $values[] = (int)$input['flag_check_id']; }
    if (isset($input['flag_out_id'])) { $fields[] = 'flag_out_id = ?'; $types .= 'i'; $values[] = (int)$input['flag_out_id']; }
    if (isset($input['remarks'])) { $fields[] = 'remarks = ?'; $types .= 's'; $values[] = $input['remarks']; }

    // If status is being set to absent (flag 3) ensure times are nulled
    if (isset($input['flag_in_id']) && (int)$input['flag_in_id'] === 3) {
        // ensure times are set to NULL
        $fields[] = 'checked_in_at = NULL';
        $fields[] = 'checked_out_at = NULL';
    }

    if (empty($fields)) json_response(['message' => 'Nothing to update'], 200);

    $sql = "UPDATE tbl_attendance_records SET " . implode(', ', $fields) . " WHERE attendance_id = ?";
    $stmt = $mysqli->prepare($sql);
    if (!$stmt) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
    $types .= 'i';
    $values[] = $attendanceId;
    // bind params safely
    safe_bind_params($stmt, $types, $values);
    if (!$stmt->execute()) json_response(['error' => 'update_failed', 'message' => $stmt->error], 500);

    // Reload the updated record from DB to determine actual changes
    $updated = null;
    $uReload = $mysqli->prepare("SELECT checked_in_at, checked_mid_at, checked_out_at, flag_in_id, flag_check_id, flag_out_id FROM tbl_attendance_records WHERE attendance_id = ? LIMIT 1");
    if ($uReload) {
        $uReload->bind_param('i', $attendanceId);
        $uReload->execute();
        $updated = $uReload->get_result()->fetch_assoc();
        $uReload->close();
    }

    // After update: log changes for the specific fields the user requested (only flags and times)
    $ipAddr = $_SERVER['REMOTE_ADDR'] ?? ($_SERVER['HTTP_X_FORWARDED_FOR'] ?? '');
    $reason = $input['reason'] ?? ($input['edit_reason'] ?? null);
    $action_type = isset($input['action_type']) ? $input['action_type'] : 'update';

    // Determine actor name (use for reason text). If authUserId present, fetch full name
    $actor_name = null;
    if (!empty($authUserId)) {
        $nameStmt = $mysqli->prepare("SELECT CONCAT_WS(' ', first_name, last_name) AS full_name FROM tbl_users WHERE user_id = ? LIMIT 1");
        if ($nameStmt) {
            $nameStmt->bind_param('i', $authUserId);
            $nameStmt->execute();
            $nr = $nameStmt->get_result()->fetch_assoc();
            if ($nr && !empty($nr['full_name'])) $actor_name = $nr['full_name'];
            $nameStmt->close();
        }
    }

    // Generate edit_session_id for this batch: format EDIT_YYYYMMDD_XXX
    $todayPrefix = 'EDIT_' . date('Ymd') . '_';
    $sessNumber = 1;
    $sessStmt = $mysqli->prepare("SELECT edit_session_id FROM tbl_attendance_logs WHERE edit_session_id LIKE CONCAT(?, '%') ORDER BY edit_session_id DESC LIMIT 1");
    if ($sessStmt) {
        $sessStmt->bind_param('s', $todayPrefix);
        if ($sessStmt->execute()) {
            $last = $sessStmt->get_result()->fetch_assoc();
            if ($last && !empty($last['edit_session_id'])) {
                if (preg_match('/_(\d{3})$/', $last['edit_session_id'], $m)) {
                    $sessNumber = (int)$m[1] + 1;
                }
            }
        }
        $sessStmt->close();
    }
    $edit_session_id = $todayPrefix . sprintf('%03d', $sessNumber);

    // Map DB columns -> user-visible field names requested by the user
    $logMap = [
        'flag_in_id' => 'flag_in',
        'flag_check_id' => 'flag_mid',
        'flag_out_id' => 'flag_out',
        'checked_in_at' => 'time_in',
        'checked_mid_at' => 'time_mid',
        'checked_out_at' => 'time_out'
    ];

    foreach ($logMap as $dbField => $logName) {
        // fetch old from pre-update and new from reloaded DB
        $old = array_key_exists($dbField, $existing) ? $existing[$dbField] : null;
        $new = is_array($updated) && array_key_exists($dbField, $updated) ? $updated[$dbField] : null;

        // If neither old nor new exist, skip
        if ($old === null && $new === null) continue;

        // If values are identical, skip
        if ($old === $new) continue;

        // Only log if the user explicitly provided the field in the request OR the DB value actually changed
        if (!array_key_exists($dbField, $input) && $old === $new) continue; // defensive

        // debug trace to inspect what's passed to logger (remove when verified)
        error_log(sprintf("attendance: logging change (db compare) - attendance_id=%d dbField=%s logName=%s old=%s new=%s action=%s session=%s actor=%s", $attendanceId, $dbField, $logName, json_encode($old), json_encode($new), $action_type, $edit_session_id, $actor_name ?? ''));

        // insert log row — helper will convert flags to text and store old/new for time and flag fields
        log_attendance_change($mysqli, $authUserId, $attendanceId, $logName, $old, $new, $reason, $ipAddr, $action_type, $edit_session_id, $actor_name);
    }

    // Get the user_id from the updated record
    $uStmt = $mysqli->prepare("SELECT user_id FROM tbl_attendance_records WHERE attendance_id = ? LIMIT 1");
    $user_id = null;
    if ($uStmt) {
        $uStmt->bind_param('i', $attendanceId);
        $uStmt->execute();
        $uRow = $uStmt->get_result()->fetch_assoc();
        if ($uRow) { $user_id = (int)$uRow['user_id']; }
    }

    // Get the dept_id of the user whose attendance record was updated
    $dept_id = null;
    if ($user_id) {
        $dStmt = $mysqli->prepare("SELECT dept_id FROM tbl_users WHERE user_id = ? LIMIT 1");
        if ($dStmt) {
            $dStmt->bind_param('i', $user_id);
            $dStmt->execute();
            $dRow = $dStmt->get_result()->fetch_assoc();
            if ($dRow && isset($dRow['dept_id'])) { $dept_id = (int)$dRow['dept_id']; }
        }
    }

    try {
        $payload = ['entity' => 'attendance', 'action' => 'update', 'attendance_id' => $attendanceId];
        if ($dept_id) { $payload['dept_id'] = $dept_id; }
        trigger_socket_update($payload);
    } catch (Throwable $_) {}
    json_response(['ok' => true, 'attendance_id' => $attendanceId]);

} elseif ($request_method === 'POST' && ($param1 === 'check-in' || $param1 === 'mid-check' || $param1 === 'check-out')) {
    // Shared logic for all check types
    $schedule_id = isset($input['schedule_id']) ? (int)$input['schedule_id'] : 0;
    $user_id     = isset($input['user_id']) ? (int)$input['user_id'] : 0; // Force integer
    $date        = $input['date'] ?? null;
    $latitude    = $input['latitude'] ?? null;
    $longitude   = $input['longitude'] ?? null;
    $accuracy    = $input['accuracy'] ?? null;
    $altitude    = $input['altitude'] ?? null;
    $altitudeAccuracy = $input['altitudeAccuracy'] ?? null;
    $qr_token    = $input['qr_token'] ?? null;
    $devicePlatform = strtolower(trim((string)($input['device_platform'] ?? $input['devicePlatform'] ?? 'unknown')));
    if (!in_array($devicePlatform, ['android', 'ios', 'desktop', 'unknown'], true)) $devicePlatform = 'unknown';
    $rawAltitude = $input['raw_altitude'] ?? $input['rawAltitude'] ?? $altitude;
    $normalizedAltitude = $input['normalized_altitude'] ?? $input['normalizedAltitude'] ?? null;
    $altitudeOffset = $input['altitude_offset'] ?? $input['altitudeOffset'] ?? null;
    $altitudeSource = $input['altitude_source'] ?? $input['altitudeSource'] ?? null;
    if (is_numeric($normalizedAltitude)) {
        $altitude = $normalizedAltitude;
    }

    // --- SECURITY FIX: STRICT VALIDATION ---
    if ($user_id <= 0) {
        // This stops "undefined" or "0" from passing
        json_response(['ok' => false, 'error' => 'invalid_user_id', 'message' => 'User ID is missing or invalid'], 400);
    }
    if ($schedule_id <= 0) {
        json_response(['ok' => false, 'error' => 'invalid_schedule_id'], 400);
    }
    // ---------------------------------------

    $ACCURACY_THRESHOLD_METERS = 30;
    $ALTITUDE_ACCURACY_THRESHOLD_METERS = 15;
    $DEFAULT_VERTICAL_TOLERANCE_METERS = 1.5;

    if (!$date) json_response(['ok' => false, 'error' => 'missing_fields'], 400);
    if (!is_numeric($latitude) || !is_numeric($longitude)) json_response(['ok' => false, 'error' => 'missing_coordinates'], 400);

    $groupSelectSql = "
        SELECT
            ar.attendance_id,
            ar.user_id,
            ar.schedule_id,
            ar.room_id,
            ar.floor_id,
            ar.date,
            ar.flag_in_id,
            ar.flag_check_id,
            cs.semester_id,
            cs.subject_id,
            cs.section_id,
            cs.day_of_week,
            cs.start_time,
            cs.end_time,
            r.latitude AS room_lat,
            r.longitude AS room_lon,
            r.radius AS room_radius,
            r.floor_id AS room_floor_id,
            r.building_id AS room_building_id,
            f.qr_token AS qr_token,
            f.status AS floor_status,
            f.baseline_altitude AS room_baseline_altitude
        FROM tbl_attendance_records ar
        JOIN tbl_class_schedules cs ON ar.schedule_id = cs.schedule_id
        JOIN tbl_rooms r ON ar.room_id = r.room_id
        LEFT JOIN tbl_floors f ON r.floor_id = f.floor_id
    ";

    $stmt = $mysqli->prepare($groupSelectSql . " WHERE ar.schedule_id = ? AND ar.user_id = ? AND ar.date = ? LIMIT 1");
    $stmt->bind_param("iis", $schedule_id, $user_id, $date);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();

    if (!$row) json_response(['ok' => false, 'error' => 'attendance_record_not_found'], 404);

    $groupRows = [$row];
    if (isset($row['subject_id']) && $row['subject_id'] !== null && isset($row['semester_id']) && $row['semester_id'] !== null) {
        $groupStmt = $mysqli->prepare($groupSelectSql . "
            WHERE ar.user_id = ?
              AND ar.date = ?
              AND cs.semester_id = ?
              AND cs.subject_id = ?
              AND cs.start_time = ?
              AND cs.end_time = ?
        ");
        if ($groupStmt) {
            $selectedSemesterId = (int)$row['semester_id'];
            $selectedSubjectId = (int)$row['subject_id'];
            $selectedStartTime = $row['start_time'];
            $selectedEndTime = $row['end_time'];
            $groupStmt->bind_param(
                "isiiss",
                $user_id,
                $date,
                $selectedSemesterId,
                $selectedSubjectId,
                $selectedStartTime,
                $selectedEndTime
            );
            $groupStmt->execute();
            $result = $groupStmt->get_result();
            $fetchedRows = $result ? $result->fetch_all(MYSQLI_ASSOC) : [];
            if (!empty($fetchedRows)) $groupRows = $fetchedRows;
        }
    }

    $validationRow = $row;
    $matchedQrRow = false;
    if ($qr_token) {
        $qrFallback = null;
        $qrNearest = null;
        foreach ($groupRows as $candidate) {
            if (!empty($candidate['qr_token']) && $candidate['qr_token'] === $qr_token && isset($candidate['floor_status']) && $candidate['floor_status'] === 'active') {
                if ($qrFallback === null) $qrFallback = $candidate;
                if (isInsideBox($latitude, $longitude, $candidate['room_lat'], $candidate['room_lon'], (float)$candidate['room_radius'])) {
                    $candidateDistance = getDistanceMeters($latitude, $longitude, $candidate['room_lat'], $candidate['room_lon']);
                    if ($qrNearest === null || $candidateDistance < $qrNearest['distance']) {
                        $qrNearest = ['row' => $candidate, 'distance' => $candidateDistance];
                    }
                }
            }
        }
        if ($qrNearest !== null) {
            $validationRow = $qrNearest['row'];
            $matchedQrRow = true;
        } elseif ($qrFallback !== null) {
            $validationRow = $qrFallback;
            $matchedQrRow = true;
        }
    }
    if (!$matchedQrRow) {
        $nearest = null;
        foreach ($groupRows as $candidate) {
            if (!isInsideBox($latitude, $longitude, $candidate['room_lat'], $candidate['room_lon'], (float)$candidate['room_radius'])) continue;
            $candidateDistance = getDistanceMeters($latitude, $longitude, $candidate['room_lat'], $candidate['room_lon']);
            if ($nearest === null || $candidateDistance < $nearest['distance']) {
                $nearest = ['row' => $candidate, 'distance' => $candidateDistance];
            }
        }
        if ($nearest !== null) $validationRow = $nearest['row'];
    }
    $row = $validationRow;
    $groupAttendanceIds = array_values(array_unique(array_map(function($item) {
        return (int)$item['attendance_id'];
    }, $groupRows)));
    if (empty($groupAttendanceIds)) $groupAttendanceIds = [(int)$row['attendance_id']];
    $groupPlaceholders = implode(',', array_fill(0, count($groupAttendanceIds), '?'));
    $groupIdTypes = str_repeat('i', count($groupAttendanceIds));
    $groupCount = count($groupAttendanceIds);

    $classStart = new DateTime(toDateYMD($row['date']) . ' ' . $row['start_time']);
    $classEnd = new DateTime(toDateYMD($row['date']) . ' ' . $row['end_time']);
    $now = new DateTime();

    // --- New: Building containment check ---
    $building_stmt = $mysqli->prepare("SELECT building_id, building_name, latitude, longitude, radius FROM tbl_buildings WHERE building_id = ? LIMIT 1");
    if ($building_stmt) {
        $building_stmt->bind_param('i', $row['room_building_id']);
        $building_stmt->execute();
        $building = $building_stmt->get_result()->fetch_assoc();
        if ($building && is_numeric($building['latitude']) && is_numeric($building['longitude']) && is_numeric($building['radius']) && (float)$building['radius'] > 0) {
            $distToBuilding = getDistanceMeters($latitude, $longitude, (float)$building['latitude'], (float)$building['longitude']);
            if ($distToBuilding > (float)$building['radius']) {
                json_response(['ok' => false, 'error' => 'outside_building', 'distanceMeters' => $distToBuilding, 'building_radius' => (float)$building['radius'], 'building_id' => (int)$building['building_id']], 400);
            }
        }
    }

    // 1. Check QR Validity: qr_token must match and the floor's status should be 'active'
    $isQrValid = ($qr_token && !empty($row['qr_token']) && $qr_token === $row['qr_token'] && isset($row['floor_status']) && $row['floor_status'] === 'active');

    // 2. Horizontal GPS Check
    $distanceMeters = getDistanceMeters($latitude, $longitude, $row['room_lat'], $row['room_lon']);
    $inBox = isInsideBox($latitude, $longitude, $row['room_lat'], $row['room_lon'], (float)$row['room_radius']);
    if (!$inBox) {
        json_response([
            'ok' => false, 
            'error' => 'out_of_range', 
            'in_box' => false, 
            'distanceMeters' => $distanceMeters, 
            'room_radius' => (float)$row['room_radius']
        ], 400);
    }
    if (is_numeric($accuracy) && $accuracy > $ACCURACY_THRESHOLD_METERS) json_response(['ok' => false, 'error' => 'low_accuracy'], 400);

    // 3. Vertical / Altitude Check (CORRECTED LOGIC)
    $finalAltitude = $altitude;
    $detectedFloorId = null;
    if ($isQrValid) {
        // For QR path: validate user's reported altitude falls within the floor's baseline +/- floor_meter_vertical.
        // This replaces trusting a static baseline value and enforces the floor range for the scanned floor.
        try {
            $roomFloorId = $row['room_floor_id'] ? (int)$row['room_floor_id'] : null;
            $floorInfo = null;
            if ($roomFloorId) {
                $fstmt = $mysqli->prepare("SELECT baseline_altitude, floor_meter_vertical FROM tbl_floors WHERE floor_id = ? LIMIT 1");
                if ($fstmt) {
                    $fstmt->bind_param('i', $roomFloorId);
                    $fstmt->execute();
                    $floorInfo = $fstmt->get_result()->fetch_assoc();
                }
            }

            // Require both baseline_altitude and floor_meter_vertical to be present and numeric.
            if ($floorInfo && is_numeric($floorInfo['baseline_altitude']) && is_numeric($floorInfo['floor_meter_vertical'])) {
                $baseline = (float)$floorInfo['baseline_altitude'];
                $vertical = (float)$floorInfo['floor_meter_vertical'];
                // Use full vertical value as limit (baseline +/- vertical)
                $minAlt = $baseline - $vertical;
                $maxAlt = $baseline + $vertical;

                if (!is_numeric($altitude)) {
                    json_response(['ok' => false, 'error' => 'missing_altitude'], 400);
                }

                $userAlt = (float)$altitude;
                if ($userAlt < $minAlt || $userAlt > $maxAlt) {
                    json_response([
                        'ok' => false,
                        'error' => 'wrong_floor',
                        'expected_floor_id' => $roomFloorId,
                        'expected_baseline' => $baseline,
                        'floor_meter_vertical' => $vertical,
                        'min_altitude' => $minAlt,
                        'max_altitude' => $maxAlt,
                        'detected_altitude' => $userAlt
                    ], 400);
                }

                // Passed range check — use user's altitude as stored value and mark detected floor
                $finalAltitude = $userAlt;
                $detectedFloorId = $roomFloorId;

            } else {
                // Floor data incomplete: do not fall back to static baseline. Require floor vertical info.
                json_response(['ok' => false, 'error' => 'no_floor_match', 'reason' => 'floor_baseline_or_vertical_missing'], 400);
            }
        } catch (Exception $e) {
            // On unexpected failure, return no_floor_match instead of silently falling back
            json_response(['ok' => false, 'error' => 'no_floor_match', 'reason' => 'exception_occurred'], 400);
        }

    } else {
        if (!is_numeric($altitude)) json_response(['ok' => false, 'error' => 'missing_altitude'], 400);
        if (!is_numeric($altitudeAccuracy) || $altitudeAccuracy > $ALTITUDE_ACCURACY_THRESHOLD_METERS) json_response(['ok' => false, 'error' => 'altitude_too_poor'], 400);
        
        $floor_stmt = $mysqli->prepare("SELECT floor_id, baseline_altitude, floor_meter_vertical FROM tbl_floors WHERE building_id = ?");
        $floor_stmt->bind_param("i", $row['room_building_id']);
        $floor_stmt->execute();
        $floors_result = $floor_stmt->get_result();
        $floors = $floors_result->fetch_all(MYSQLI_ASSOC);
        
        $detectedFloorId = null;
        $detectedFloorBaseline = null;
        $detectedFloorVertical = null;
        
        if (!empty($floors)) {
            $best_match = null;
            foreach ($floors as $f) {
                if ($f['baseline_altitude'] === null) continue;
                $diff = abs((float)$f['baseline_altitude'] - (float)$altitude);
                if ($best_match === null || $diff < $best_match['diff']) {
                    $best_match = ['diff' => $diff, 'floor' => $f];
                }
            }
            if ($best_match) {
                $detectedFloorId = (int)$best_match['floor']['floor_id'];
                $detectedFloorBaseline = (float)$best_match['floor']['baseline_altitude'];
                $detectedFloorVertical = $best_match['floor']['floor_meter_vertical'] !== null ? (float)$best_match['floor']['floor_meter_vertical'] : null;
            }
        }

        if ($detectedFloorId === null) json_response(['ok' => false, 'error' => 'no_floor_match'], 400);

        // Require floor_meter_vertical to be present. Do not fallback to static baseline.
        if ($detectedFloorVertical === null) json_response(['ok' => false, 'error' => 'no_floor_match', 'reason' => 'floor_vertical_missing'], 400);

        // Use full +/- floor_meter_vertical range for validation
        $minAlt = $detectedFloorBaseline - $detectedFloorVertical;
        $maxAlt = $detectedFloorBaseline + $detectedFloorVertical;
        $userAlt = (float)$altitude;

        if ($userAlt < $minAlt || $userAlt > $maxAlt || $detectedFloorId !== (int)$row['room_floor_id']) {
            json_response([
                'ok' => false,
                'error' => 'wrong_floor',
                'detected_floor_id' => $detectedFloorId,
                'expected_floor_id' => (int)$row['room_floor_id'],
                'detected_baseline' => $detectedFloorBaseline,
                'floor_meter_vertical' => $detectedFloorVertical,
                'min_altitude' => $minAlt,
                'max_altitude' => $maxAlt,
                'detected_altitude' => $userAlt
            ], 400);
        }
    }
    
    // Persist detected floor for this attendance record so client can trust floor altitude until class end
    if ($detectedFloorId !== null) {
        $update_floor_stmt = $mysqli->prepare("UPDATE tbl_attendance_records SET floor_id = ? WHERE attendance_id IN ({$groupPlaceholders})");
        if ($update_floor_stmt) {
            $floorParams = array_merge([$detectedFloorId], $groupAttendanceIds);
            safe_bind_params($update_floor_stmt, 'i' . $groupIdTypes, $floorParams);
            $update_floor_stmt->execute();
        }
    }
    
    // --- Action based on check type ---
    $message = '';
    if ($param1 === 'check-in') {
        $inPresentWindowEnd = (clone $classStart)->modify('+15 minutes');
        if ($now < $classStart) json_response(['ok' => false, 'error' => 'too_early', 'allow_at' => $classStart->format(DateTime::ISO8601)]);
        if ($now > $classEnd) json_response(['ok' => false, 'error' => 'class_ended']);
        $flagIn = ($now <= $inPresentWindowEnd) ? 2 : 5;
        $stmt = $mysqli->prepare("UPDATE tbl_attendance_records SET checked_in_at = NOW(), altitude_in = ?, latitude_in = ?, longitude_in = ?, flag_in_id = ? WHERE attendance_id IN ({$groupPlaceholders}) AND checked_in_at IS NULL");
        $params = array_merge([$finalAltitude, $latitude, $longitude, $flagIn], $groupAttendanceIds);
        safe_bind_params($stmt, "dddi" . $groupIdTypes, $params);
        $stmt->execute();
        $message = $flagIn === 2 ? 'checked_in_present' : 'checked_in_late';

    } elseif ($param1 === 'mid-check') {
        $duration = $classEnd->getTimestamp() - $classStart->getTimestamp();
        $midPoint = (clone $classStart)->modify('+' . ($duration / 2) . ' seconds');
        $midStart = (clone $midPoint)->modify('-10 minutes');
        $midEnd = (clone $midPoint)->modify('+10 minutes');
        if ($now < $midStart) json_response(['ok' => false, 'error' => 'too_early', 'allow_at' => $midStart->format(DateTime::ISO8601)]);
        if ($now > $classEnd) json_response(['ok' => false, 'error' => 'class_ended']);
        
        // Catch-up for flag_in_id
        $inPresentWindowEnd = (clone $classStart)->modify('+15 minutes');
        if ($now > $inPresentWindowEnd) {
            $update_stmt = $mysqli->prepare("UPDATE tbl_attendance_records SET flag_in_id = 5 WHERE attendance_id IN ({$groupPlaceholders}) AND flag_in_id = 1");
            safe_bind_params($update_stmt, $groupIdTypes, $groupAttendanceIds);
            $update_stmt->execute();
        }

        $flagCheck = ($now >= $midStart && $now <= $midEnd) ? 2 : 5;
        $stmt = $mysqli->prepare("UPDATE tbl_attendance_records SET checked_mid_at = NOW(), altitude_check = ?, latitude_check = ?, longitude_check = ?, flag_check_id = ? WHERE attendance_id IN ({$groupPlaceholders}) AND checked_mid_at IS NULL");
        $params = array_merge([$finalAltitude, $latitude, $longitude, $flagCheck], $groupAttendanceIds);
        safe_bind_params($stmt, "dddi" . $groupIdTypes, $params);
        $stmt->execute();
        $message = $flagCheck === 2 ? 'mid_check_present' : 'mid_check_late';

    } elseif ($param1 === 'check-out') {
        $outStart = (clone $classEnd)->modify('-15 minutes');
        if ($now < $outStart) json_response(['ok' => false, 'error' => 'too_early', 'allow_at' => $outStart->format(DateTime::ISO8601)]);
        if ($now > $classEnd) json_response(['ok' => false, 'error' => 'class_ended']);

        // Catch-up for flag_in_id
        $inPresentWindowEnd = (clone $classStart)->modify('+15 minutes');
        if ($now > $inPresentWindowEnd) {
            $update_stmt = $mysqli->prepare("UPDATE tbl_attendance_records SET flag_in_id = 5 WHERE attendance_id IN ({$groupPlaceholders}) AND flag_in_id = 1");
            safe_bind_params($update_stmt, $groupIdTypes, $groupAttendanceIds);
            $update_stmt->execute();
        }
        
        // Catch-up for flag_check_id
        $duration = $classEnd->getTimestamp() - $classStart->getTimestamp();
        $midPoint = (clone $classStart)->modify('+' . ($duration / 2) . ' seconds');
        $midWindowEnd = (clone $midPoint)->modify('+10 minutes');
        if ($now > $midWindowEnd) {
            $update_stmt = $mysqli->prepare("UPDATE tbl_attendance_records SET flag_check_id = 5 WHERE attendance_id IN ({$groupPlaceholders}) AND flag_check_id = 1");
            safe_bind_params($update_stmt, $groupIdTypes, $groupAttendanceIds);
            $update_stmt->execute();
        }

        $stmt = $mysqli->prepare("UPDATE tbl_attendance_records SET checked_out_at = NOW(), altitude_out = ?, latitude_out = ?, longitude_out = ?, flag_out_id = 2 WHERE attendance_id IN ({$groupPlaceholders}) AND checked_out_at IS NULL");
        $params = array_merge([$finalAltitude, $latitude, $longitude], $groupAttendanceIds);
        safe_bind_params($stmt, "ddd" . $groupIdTypes, $params);
        $stmt->execute();
        $message = 'checked_out';
    }

    // Return the final updated records with joined fields (same projection as GET /api/attendance)
    $sql = "
      SELECT
        ar.attendance_id,
        ar.user_id,
        ar.schedule_id,
        ar.room_id,
        ar.floor_id,
        DATE_FORMAT(ar.date, '%Y-%m-%d') AS date,
        cs.semester_id,
        cs.subject_id,
        cs.section_id,
        cs.day_of_week,
        ar.checked_in_at AS time_in,
        ar.altitude_in,
        ar.latitude_in,
        ar.longitude_in,
        ar.flag_in_id,
        ar.checked_mid_at AS time_check,
        ar.altitude_check,
        ar.latitude_check,
        ar.longitude_check,
        ar.flag_check_id,
        ar.checked_out_at AS time_out,
        ar.altitude_out,
        ar.latitude_out,
        ar.longitude_out,
        ar.flag_out_id,
        u.first_name, u.last_name,
        NULLIF(CAST(u.image AS CHAR), '') AS avatar,
        cs.start_time, cs.end_time,
        r.room_name,
        sc.school_name AS campus_name,
        sc.school_name AS school_name,
        b.building_name,
        COALESCE(f.floor_name, rf.floor_name) AS floor_name,
        s.subject_code,
        s.subject_name,
        sec.section_name,
        f.floor_name AS attendance_floor_name,
        ft_in.flag_name AS flag_in_name,
        ft_check.flag_name AS flag_check_name,
        ft_out.flag_name AS flag_out_name
      FROM tbl_attendance_records ar
      JOIN tbl_users u              ON ar.user_id = u.user_id
      JOIN tbl_class_schedules cs   ON ar.schedule_id = cs.schedule_id
      JOIN tbl_rooms r              ON ar.room_id = r.room_id
      LEFT JOIN tbl_floors f        ON ar.floor_id = f.floor_id
      LEFT JOIN tbl_floors rf       ON r.floor_id = rf.floor_id
      LEFT JOIN tbl_buildings b     ON r.building_id = b.building_id
      LEFT JOIN tbl_school sc       ON b.school_id = sc.school_id
      LEFT JOIN tbl_subject s       ON cs.subject_id = s.subject_id
      LEFT JOIN tbl_sections sec    ON cs.section_id = sec.section_id
      LEFT JOIN tbl_flag_types ft_in   ON ar.flag_in_id = ft_in.flag_id
      LEFT JOIN tbl_flag_types ft_check ON ar.flag_check_id = ft_check.flag_id
      LEFT JOIN tbl_flag_types ft_out  ON ar.flag_out_id = ft_out.flag_id
      WHERE ar.attendance_id IN ({$groupPlaceholders})
      ORDER BY cs.start_time, r.room_name, sec.section_name
    ";
    $stmt = $mysqli->prepare($sql);
    if ($stmt === false) { json_response(['error' => 'db_prepare_failed', 'details' => $mysqli->error], 500); }
    safe_bind_params($stmt, $groupIdTypes, $groupAttendanceIds);
    if (!$stmt->execute()) { json_response(['error' => 'db_execute_failed', 'details' => $stmt->error], 500); }
     
    $finalRows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    $final = $finalRows[0] ?? null;
    json_response([
        'ok' => true,
        'message' => $message,
        'record' => $final,
        'attendance' => $final,
        'records' => $finalRows,
        'group_count' => $groupCount,
        'grouped' => $groupCount > 1,
        'device_platform' => $devicePlatform,
        'altitude_used' => is_numeric($finalAltitude) ? (float)$finalAltitude : null,
        'raw_altitude' => is_numeric($rawAltitude) ? (float)$rawAltitude : null,
        'normalized_altitude' => is_numeric($altitude) ? (float)$altitude : null,
        'altitude_offset' => is_numeric($altitudeOffset) ? (float)$altitudeOffset : null,
        'altitude_source' => $altitudeSource
    ]);

} else {
    json_response(['error' => 'Endpoint not found in attendance API file.'], 404);
}

} // end skip-routing guard
