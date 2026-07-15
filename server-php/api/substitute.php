<?php
// server-php/api/substitute.php
require_once __DIR__ . '/../helpers/socket_helper.php';
require_once __DIR__ . '/../helpers/log_helper.php';
require_once __DIR__ . '/../helpers/notification_helper.php';

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
// AUTHENTICATION
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

$authUserId = null;
$authUserRole = null;
$authUserDept = null;

if (!empty($authHeader)) {
    if (preg_match('/Bearer\s+(\S+)/i', $authHeader, $m)) {
        $token = $m[1];
        $sec = [];
        if (file_exists(__DIR__ . '/../config/security.php')) $sec = require __DIR__ . '/../config/security.php';
        $secret_key = $sec['jwt_secret'] ?? 'your-secret-key';
        try {
            $decoded = JWT::decode($token, new Key($secret_key, 'HS256'));
            $authUserId = isset($decoded->user_id) ? (int)$decoded->user_id : null;
            $authUserRole = isset($decoded->role_id) ? (int)$decoded->role_id : null;
            
            if ($authUserId) {
                $uStmt = $mysqli->prepare("SELECT dept_id FROM tbl_users WHERE user_id = ? LIMIT 1");
                $uStmt->bind_param('i', $authUserId);
                $uStmt->execute();
                $res = $uStmt->get_result();
                if ($row = $res->fetch_assoc()) {
                    $authUserDept = $row['dept_id'] ? (int)$row['dept_id'] : null;
                }
            }
        } catch (Throwable $e) {}
    }
}

if (!$authUserId) { json_response(['error' => 'Unauthorized'], 401); }

function substitute_table_exists($mysqli, $table) {
    $table = preg_replace('/[^a-zA-Z0-9_]/', '', (string)$table);
    if ($table === '') return false;
    $safe = $mysqli->real_escape_string($table);
    $res = $mysqli->query("SHOW TABLES LIKE '{$safe}'");
    return $res && (int)$res->num_rows > 0;
}

function substitute_column_exists($mysqli, $table, $column) {
    $table = preg_replace('/[^a-zA-Z0-9_]/', '', (string)$table);
    $column = preg_replace('/[^a-zA-Z0-9_]/', '', (string)$column);
    if ($table === '' || $column === '') return false;
    $safeColumn = $mysqli->real_escape_string($column);
    $res = $mysqli->query("SHOW COLUMNS FROM `$table` LIKE '{$safeColumn}'");
    return $res && (int)$res->num_rows > 0;
}

function substitute_schedule_schema($mysqli) {
    $hasSo = substitute_table_exists($mysqli, 'tbl_subject_offerings');
    $csHasOffering = substitute_column_exists($mysqli, 'tbl_class_schedules', 'offering_id');
    return [
        'has_so' => $hasSo && $csHasOffering,
        'cs_has_user' => substitute_column_exists($mysqli, 'tbl_class_schedules', 'user_id'),
        'cs_has_subject' => substitute_column_exists($mysqli, 'tbl_class_schedules', 'subject_id'),
        'cs_has_section' => substitute_column_exists($mysqli, 'tbl_class_schedules', 'section_id'),
        'so_has_user' => $hasSo ? substitute_column_exists($mysqli, 'tbl_subject_offerings', 'user_id') : false,
        'so_has_subject' => $hasSo ? substitute_column_exists($mysqli, 'tbl_subject_offerings', 'subject_id') : false,
        'so_has_section' => $hasSo ? substitute_column_exists($mysqli, 'tbl_subject_offerings', 'section_id') : false,
    ];
}

function substitute_schedule_exprs($schema) {
    $joinOffering = $schema['has_so'] ? " LEFT JOIN tbl_subject_offerings so ON cs.offering_id = so.offering_id " : "";
    $teacherExpr = $schema['cs_has_user'] ? 'cs.user_id' : (($schema['has_so'] && $schema['so_has_user']) ? 'so.user_id' : 'NULL');
    $subjectExpr = $schema['cs_has_subject'] ? 'cs.subject_id' : (($schema['has_so'] && $schema['so_has_subject']) ? 'so.subject_id' : 'NULL');
    $sectionExpr = $schema['cs_has_section'] ? 'cs.section_id' : (($schema['has_so'] && $schema['so_has_section']) ? 'so.section_id' : 'NULL');
    return [$joinOffering, $teacherExpr, $subjectExpr, $sectionExpr];
}

$subSchema = substitute_schedule_schema($mysqli);
list($subJoinOffering, $subTeacherExpr, $subSubjectExpr, $subSectionExpr) = substitute_schedule_exprs($subSchema);

// =================================================================================
// ENDPOINTS
// =================================================================================

if ($request_method === 'GET' && in_array($endpoint, ['substitute', 'substitutions'], true) && $param1 === 'available') {
    if (!in_array((int)$authUserRole, [2, 6], true)) {
        json_response(['ok' => false, 'error' => 'forbidden', 'message' => 'Only dean and department admin can view available substitution schedules.'], 403);
    }
    if (in_array((int)$authUserRole, [2, 6], true) && $authUserDept === null) {
        json_response(['ok' => false, 'error' => 'forbidden', 'message' => 'Your account is not assigned to a department.'], 403);
    }
    if ($subTeacherExpr === 'NULL') {
        json_response([]);
    }

    $teacherId = isset($_GET['teacher_id']) ? (int)$_GET['teacher_id'] : (isset($_GET['original_teacher_id']) ? (int)$_GET['original_teacher_id'] : 0);
    if ($teacherId <= 0) {
        json_response(['ok' => false, 'error' => 'missing_teacher_id', 'message' => 'teacher_id is required.'], 400);
    }

    $sql = "
        SELECT
            ar.attendance_id,
            ar.user_id AS teacher_id,
            ar.schedule_id,
            DATE_FORMAT(ar.date, '%Y-%m-%d') AS date,
            cs.day_of_week,
            cs.start_time,
            cs.end_time,
            cs.room_id,
            r.floor_id,
            r.room_name,
            {$subSubjectExpr} AS subject_id,
            {$subSectionExpr} AS section_id,
            s.subject_code,
            s.subject_name,
            sec.section_name,
            sem.semester_id,
            sem.term AS semester_term,
            DATE_FORMAT(sem.start_date, '%Y-%m-%d') AS semester_start,
            DATE_FORMAT(sem.end_date, '%Y-%m-%d') AS semester_end,
            ar.flag_in_id,
            ar.flag_check_id,
            ar.flag_out_id
        FROM tbl_attendance_records ar
        JOIN tbl_class_schedules cs ON ar.schedule_id = cs.schedule_id
        {$subJoinOffering}
        JOIN tbl_semesters sem ON cs.semester_id = sem.semester_id
        LEFT JOIN tbl_rooms r ON cs.room_id = r.room_id
        LEFT JOIN tbl_subject s ON {$subSubjectExpr} = s.subject_id
        LEFT JOIN tbl_sections sec ON {$subSectionExpr} = sec.section_id
        LEFT JOIN tbl_users orig_teacher ON {$subTeacherExpr} = orig_teacher.user_id
        LEFT JOIN tbl_substitutions existing_sub ON existing_sub.schedule_id = ar.schedule_id AND existing_sub.date = ar.date
        WHERE ar.user_id = ?
          AND ar.user_id = {$subTeacherExpr}
          AND ar.date >= CURDATE()
          AND ar.date < DATE_ADD(CURDATE(), INTERVAL 7 DAY)
          AND sem.status = 'active'
          AND CURDATE() BETWEEN sem.start_date AND sem.end_date
          AND ar.date BETWEEN sem.start_date AND sem.end_date
          AND existing_sub.substitution_id IS NULL
          AND COALESCE(ar.flag_in_id, 1) = 1
          AND COALESCE(ar.flag_check_id, 1) = 1
          AND COALESCE(ar.flag_out_id, 1) = 1
    ";

    $types = 'i';
    $params = [$teacherId];
    if (in_array((int)$authUserRole, [2, 6], true)) {
        $sql .= " AND orig_teacher.dept_id = ?";
        $types .= 'i';
        $params[] = (int)$authUserDept;
    }
    $sql .= " ORDER BY ar.date ASC, cs.start_time ASC, cs.end_time ASC";

    $stmt = $mysqli->prepare($sql);
    if (!$stmt) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
    $stmt->bind_param($types, ...$params);
    if (!$stmt->execute()) {
        json_response(['error' => 'execute_failed', 'message' => $stmt->error], 500);
    }
    $res = $stmt->get_result();
    json_response($res ? $res->fetch_all(MYSQLI_ASSOC) : []);
}

if ($request_method === 'GET' && in_array($endpoint, ['substitute', 'substitutions'], true)) {
    
    $sql = "
        SELECT 
            ss.substitution_id,
            ss.date,
            ss.schedule_id,
            
            orig_teacher.user_id AS teacher_id,
            orig_teacher.first_name AS teacher_first,
            orig_teacher.last_name AS teacher_last,
            orig_teacher.dept_id AS teacher_dept_id,
            d.dept_name,

            sub.user_id AS substitute_id,
            sub.first_name AS sub_first,
            sub.last_name AS sub_last,

            s.subject_code,
            sec.section_name,
            cs.start_time,
            cs.end_time,
            orig_ar.attendance_id AS original_attendance_id,
            sub_ar.attendance_id AS substitute_attendance_id

        FROM tbl_substitutions ss
        LEFT JOIN tbl_class_schedules cs ON ss.schedule_id = cs.schedule_id
        {$subJoinOffering}
        LEFT JOIN tbl_attendance_records orig_ar ON orig_ar.schedule_id = ss.schedule_id AND orig_ar.date = ss.date AND orig_ar.user_id = {$subTeacherExpr}
        LEFT JOIN tbl_attendance_records sub_ar ON sub_ar.schedule_id = ss.schedule_id AND sub_ar.date = ss.date AND sub_ar.user_id = ss.substitute_user_id
        LEFT JOIN tbl_subject s ON {$subSubjectExpr} = s.subject_id
        LEFT JOIN tbl_sections sec ON {$subSectionExpr} = sec.section_id
        LEFT JOIN tbl_users orig_teacher ON {$subTeacherExpr} = orig_teacher.user_id
        LEFT JOIN tbl_departments d ON orig_teacher.dept_id = d.dept_id
        LEFT JOIN tbl_users sub ON ss.substitute_user_id = sub.user_id
    ";

    $where = [];
    $params = [];
    $types = '';

    if (is_numeric($param1)) {
        $where[] = "ss.substitution_id = ?";
        $params[] = (int)$param1;
        $types .= 'i';
    }

    // --- ROLE FILTERING ---
    if ((int)$authUserRole === 5) {
        $where[] = "(({$subTeacherExpr} = ? OR ss.substitute_user_id = ?) AND orig_ar.attendance_id IS NOT NULL)";
        $params[] = (int)$authUserId;
        $params[] = (int)$authUserId;
        $types .= 'ii';
    } else {
        $where[] = "orig_ar.attendance_id IS NOT NULL";
    }

    if ((int)$authUserRole !== 5 && $authUserRole !== 1 && $authUserDept !== null) {
        $where[] = "orig_teacher.dept_id = ?";
        $params[] = $authUserDept;
        $types .= 'i';
    } elseif ((int)$authUserRole !== 5 && $authUserRole !== 1 && $authUserDept === null) {
        $where[] = "1 = 0";
    }

    if (!empty($where)) {
        $sql .= " WHERE " . implode(' AND ', $where);
    }

    $sql .= " ORDER BY ss.date DESC";

    $stmt = $mysqli->prepare($sql);
    if (!$stmt) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);

    if (!empty($params)) {
        $stmt->bind_param($types, ...$params);
    }

    $stmt->execute();
    $res = $stmt->get_result();
    
    if (is_numeric($param1)) {
        $row = $res ? $res->fetch_assoc() : null;
        if (!$row) json_response([], 200); 
        json_response($row);
    } else {
        $rows = $res ? $res->fetch_all(MYSQLI_ASSOC) : [];
        json_response($rows);
    }
}

elseif ($request_method === 'POST' && in_array($endpoint, ['substitute', 'substitutions'], true)) {
    if (!in_array((int)$authUserRole, [2, 6], true)) {
        json_response(['ok' => false, 'error' => 'forbidden', 'message' => 'Only dean and department admin can add substitutions.'], 403);
    }
    if (in_array((int)$authUserRole, [2, 6], true) && $authUserDept === null) {
        json_response(['ok' => false, 'error' => 'forbidden', 'message' => 'Your account is not assigned to a department.'], 403);
    }

    // Accept both the batch payload used by the Substitutions page and
    // the legacy single-entry payload used by leave approval flows.
    $sub_id = isset($input['substitute_id']) ? (int)$input['substitute_id'] : null;
    if (!$sub_id && isset($input['substitute_user_id'])) {
        $sub_id = (int)$input['substitute_user_id'];
    }
    $originalTeacherId = isset($input['original_teacher_id']) ? (int)$input['original_teacher_id'] : null;
    $substitutions = isset($input['substitutions']) && is_array($input['substitutions']) ? $input['substitutions'] : [];
    if (empty($substitutions) && !empty($input['schedule_id']) && !empty($input['date'])) {
        $substitutions = [[
            'schedule_id' => (int)$input['schedule_id'],
            'date' => (string)$input['date'],
        ]];
    }

    if (!$sub_id || empty($substitutions)) {
        json_response(['ok'=>false, 'error'=>'missing_fields', 'message'=>'Substitute ID and at least one schedule are required'], 400);
    }

    $subDeptStmt = $mysqli->prepare("SELECT dept_id FROM tbl_users WHERE user_id = ? LIMIT 1");
    if (!$subDeptStmt) json_response(['ok' => false, 'error' => 'prepare_failed', 'message' => $mysqli->error], 500);
    $subDeptStmt->bind_param('i', $sub_id);
    $subDeptStmt->execute();
    $subDeptRow = $subDeptStmt->get_result()->fetch_assoc();
    if (!$subDeptRow) {
        json_response(['ok' => false, 'error' => 'not_found', 'message' => 'Selected substitute user was not found.'], 404);
    }
    $subDeptId = isset($subDeptRow['dept_id']) && $subDeptRow['dept_id'] !== null ? (int)$subDeptRow['dept_id'] : null;
    if (in_array((int)$authUserRole, [2, 6], true) && ($subDeptId === null || $subDeptId !== (int)$authUserDept)) {
        json_response(['ok' => false, 'error' => 'forbidden', 'message' => 'You can only assign substitutes within your own department.'], 403);
    }

    // Start Transaction for safe bulk insert
    $mysqli->begin_transaction();

    try {
        if ($subTeacherExpr === 'NULL') {
            throw new Exception('Schedule teacher mapping is not available.');
        }

        $attendanceStmt = $mysqli->prepare("
            SELECT
                ar.attendance_id,
                ar.user_id AS orig_user_id,
                ar.schedule_id,
                ar.room_id,
                ar.floor_id,
                DATE_FORMAT(ar.date, '%Y-%m-%d') AS date,
                ar.flag_in_id,
                ar.flag_check_id,
                ar.flag_out_id,
                cs.start_time,
                cs.end_time,
                orig_teacher.dept_id,
                s.subject_code,
                sec.section_name
            FROM tbl_attendance_records ar
            JOIN tbl_class_schedules cs ON ar.schedule_id = cs.schedule_id
            {$subJoinOffering}
            JOIN tbl_semesters sem ON cs.semester_id = sem.semester_id
            LEFT JOIN tbl_users orig_teacher ON {$subTeacherExpr} = orig_teacher.user_id
            LEFT JOIN tbl_subject s ON {$subSubjectExpr} = s.subject_id
            LEFT JOIN tbl_sections sec ON {$subSectionExpr} = sec.section_id
            WHERE ar.schedule_id = ?
              AND ar.date = ?
              AND ar.user_id = {$subTeacherExpr}
              AND sem.status = 'active'
              AND CURDATE() BETWEEN sem.start_date AND sem.end_date
              AND ar.date BETWEEN sem.start_date AND sem.end_date
            LIMIT 1
        ");
        $checkStmt = $mysqli->prepare("SELECT substitution_id FROM tbl_substitutions WHERE schedule_id = ? AND date = ? LIMIT 1");
        $conflictStmt = $mysqli->prepare("
            SELECT ar.attendance_id
            FROM tbl_attendance_records ar
            JOIN tbl_class_schedules cs2 ON ar.schedule_id = cs2.schedule_id
            WHERE ar.user_id = ?
              AND ar.date = ?
              AND NOT (cs2.end_time <= ? OR cs2.start_time >= ?)
            LIMIT 1
        ");
        $insertStmt = $mysqli->prepare("INSERT INTO tbl_substitutions (schedule_id, substitute_user_id, date) VALUES (?, ?, ?)");
        $insertAttendanceStmt = $mysqli->prepare("
            INSERT INTO tbl_attendance_records
                (user_id, schedule_id, room_id, floor_id, date, flag_in_id, flag_check_id, flag_out_id, remarks)
            VALUES (?, ?, ?, ?, ?, 1, 1, 1, ?)
        ");
        $markOrigStmt = $mysqli->prepare("UPDATE tbl_attendance_records SET flag_in_id = 4, flag_check_id = 4, flag_out_id = 4 WHERE attendance_id = ?");

        if (!$attendanceStmt || !$checkStmt || !$conflictStmt || !$insertStmt || !$insertAttendanceStmt || !$markOrigStmt) {
            throw new Exception('Failed to prepare substitution validation: ' . $mysqli->error);
        }

        $today = new DateTime('today');
        $weekEnd = (clone $today)->modify('+7 days');
        $selectedKeys = [];
        $batchSlots = [];
        $validatedSubs = [];
        $originalTeacherScheduleCounts = [];

        foreach ($substitutions as $sub) {
            $schedule_id = isset($sub['schedule_id']) ? (int)$sub['schedule_id'] : 0;
            $date = isset($sub['date']) ? trim((string)$sub['date']) : '';
            if ($schedule_id <= 0 || $date === '') {
                throw new Exception('Each selected substitution must include a schedule and date.');
            }

            $dateObj = DateTime::createFromFormat('Y-m-d', $date);
            if (!$dateObj || $dateObj->format('Y-m-d') !== $date) {
                throw new Exception('Invalid substitution date. Use YYYY-MM-DD.');
            }
            if ($dateObj < $today || $dateObj >= $weekEnd) {
                throw new Exception('Only attendance records within the current 7-day schedule window can be substituted.');
            }

            $payloadKey = $schedule_id . '|' . $date;
            if (isset($selectedKeys[$payloadKey])) {
                throw new Exception('The same class/date was selected more than once.');
            }
            $selectedKeys[$payloadKey] = true;

            $attendanceStmt->bind_param('is', $schedule_id, $date);
            $attendanceStmt->execute();
            $attRow = $attendanceStmt->get_result()->fetch_assoc();
            if (!$attRow) {
                throw new Exception("No active teacher attendance record exists for the selected class on {$date}.");
            }

            $origUserId = isset($attRow['orig_user_id']) ? (int)$attRow['orig_user_id'] : 0;
            if ($origUserId <= 0) {
                throw new Exception('Selected schedule has no original teacher attendance owner.');
            }
            if ($originalTeacherId && $origUserId !== (int)$originalTeacherId) {
                throw new Exception('Selected schedule does not belong to the selected original teacher.');
            }
            if ($origUserId === (int)$sub_id) {
                throw new Exception('The substitute teacher must be different from the original teacher.');
            }
            if (in_array((int)$authUserRole, [2, 6], true)) {
                $scheduleDeptId = isset($attRow['dept_id']) && $attRow['dept_id'] !== null ? (int)$attRow['dept_id'] : null;
                if ($scheduleDeptId === null || $scheduleDeptId !== (int)$authUserDept) {
                    throw new Exception('You can only manage substitutions for schedules inside your department.');
                }
            }
            if ((int)($attRow['flag_in_id'] ?? 1) !== 1 || (int)($attRow['flag_check_id'] ?? 1) !== 1 || (int)($attRow['flag_out_id'] ?? 1) !== 1) {
                throw new Exception("Only upcoming attendance records can be substituted. This class already has another attendance status on {$date}.");
            }

            $checkStmt->bind_param('is', $schedule_id, $date);
            $checkStmt->execute();
            if ($checkStmt->get_result()->num_rows > 0) {
                throw new Exception("A substitution for this class on $date already exists.");
            }

            $startTime = $attRow['start_time'];
            $endTime = $attRow['end_time'];

            $conflictStmt->bind_param('isss', $sub_id, $date, $startTime, $endTime);
            $conflictStmt->execute();
            if ($conflictStmt->get_result()->num_rows > 0) {
                throw new Exception("The selected substitute already has an overlapping class on {$date} ({$startTime}-{$endTime}).");
            }

            foreach ($batchSlots as $slot) {
                if ($slot['date'] === $date && !($slot['end_time'] <= $startTime || $slot['start_time'] >= $endTime)) {
                    throw new Exception("The selected substitute would have overlapping substitute classes on {$date}.");
                }
            }

            $batchSlots[] = [
                'date' => $date,
                'start_time' => $startTime,
                'end_time' => $endTime,
            ];
            $validatedSubs[] = [
                'attendance_id' => (int)$attRow['attendance_id'],
                'schedule_id' => $schedule_id,
                'room_id' => (int)$attRow['room_id'],
                'floor_id' => (int)$attRow['floor_id'],
                'date' => $date,
                'orig_user_id' => $origUserId,
                'subject_code' => $attRow['subject_code'] ?? 'class',
                'section_name' => $attRow['section_name'] ?? '',
            ];
        }

        $inserted_count = 0;
        $createdAttendance = 0;

        foreach ($validatedSubs as $sub) {
            $schedule_id = (int)$sub['schedule_id'];
            $roomId = (int)$sub['room_id'];
            $floorId = (int)$sub['floor_id'];
            $date = (string)$sub['date'];
            $origAttendanceId = (int)$sub['attendance_id'];
            $origUserId = (int)$sub['orig_user_id'];

            $insertStmt->bind_param('iis', $schedule_id, $sub_id, $date);
            if (!$insertStmt->execute()) {
                throw new Exception("Failed to insert schedule: " . $insertStmt->error);
            }
            $inserted_count++;

            $remark = 'Substitute attendance created for original attendance #' . $origAttendanceId . '.';
            $insertAttendanceStmt->bind_param('iiiiss', $sub_id, $schedule_id, $roomId, $floorId, $date, $remark);
            if (!$insertAttendanceStmt->execute()) {
                throw new Exception("Failed to create attendance for the substitute teacher: " . $insertAttendanceStmt->error);
            }
            $createdAttendance++;

            $markOrigStmt->bind_param('i', $origAttendanceId);
            if (!$markOrigStmt->execute()) {
                throw new Exception("Failed to mark the original teacher attendance as substituted: " . $markOrigStmt->error);
            }

            if (!isset($originalTeacherScheduleCounts[$origUserId])) {
                $originalTeacherScheduleCounts[$origUserId] = 0;
            }
            $originalTeacherScheduleCounts[$origUserId]++;
        }

        $attendanceStmt->close();
        $checkStmt->close();
        $conflictStmt->close();
        $insertStmt->close();
        $insertAttendanceStmt->close();
        $markOrigStmt->close();

        // commit only after attendance creation
        $mysqli->commit();

        // =================================================================================
        // PROFESSIONAL LOGGING LOGIC
        // =================================================================================
        if ($authUserId) {
            // 1. Get Substitute's Name
            $subName = "Unknown Substitute";
            $subStmt = $mysqli->prepare("SELECT first_name, last_name FROM tbl_users WHERE user_id = ?");
            $subStmt->bind_param('i', $sub_id);
            $subStmt->execute();
            $subRes = $subStmt->get_result();
            if ($subRow = $subRes->fetch_assoc()) {
                $subName = $subRow['first_name'] . ' ' . $subRow['last_name'];
            }
            $subStmt->close();

            // 2. Get Original Teacher's Name (using the first schedule in the array)
            $origTeacherName = "Unknown Teacher";
            $first_schedule_id = (int)$substitutions[0]['schedule_id'];
            
            if ($subTeacherExpr !== 'NULL') {
                $origStmt = $mysqli->prepare("
                    SELECT u.first_name, u.last_name 
                    FROM tbl_class_schedules cs
                    {$subJoinOffering}
                    JOIN tbl_users u ON {$subTeacherExpr} = u.user_id
                    WHERE cs.schedule_id = ? LIMIT 1
                ");
                if ($origStmt) {
                    $origStmt->bind_param('i', $first_schedule_id);
                    $origStmt->execute();
                    $origRes = $origStmt->get_result();
                    if ($origRow = $origRes->fetch_assoc()) {
                        $origTeacherName = $origRow['first_name'] . ' ' . $origRow['last_name'];
                    }
                    $origStmt->close();
                }
            }

            // 3. Format the grammar based on how many classes were substituted
            if ($inserted_count === 1) {
                $logMessage = "Assigned {$subName} to substitute a class for {$origTeacherName}.";
                $logAction = 'create_substitution';
            } else {
                $logMessage = "Assigned {$subName} to substitute multiple classes for {$origTeacherName}.";
                $logAction = 'batch_substitution';
            }

            log_system_action($mysqli, $authUserId, $logAction, $logMessage);
        }
        if ($sub_id > 0) {
            $notifTitle = 'Substitution Assignment';
            $notifMessage = $inserted_count === 1
                ? 'You have been assigned as substitute teacher for 1 class.'
                : "You have been assigned as substitute teacher for {$inserted_count} classes.";
            notif_insert($mysqli, (int)$sub_id, $notifTitle, $notifMessage, '/attendance-history', $authUserId);
        }
        if (!empty($originalTeacherScheduleCounts)) {
            $origNotifTitle = 'Substitute Assigned';
            foreach ($originalTeacherScheduleCounts as $origUserIdRaw => $classCountRaw) {
                $origUserId = (int)$origUserIdRaw;
                $classCount = (int)$classCountRaw;
                if ($origUserId <= 0 || $classCount <= 0 || $origUserId === (int)$sub_id) {
                    continue;
                }
                $origNotifMessage = $classCount === 1
                    ? 'A substitute teacher has been assigned to 1 of your classes.'
                    : "A substitute teacher has been assigned to {$classCount} of your classes.";
                notif_insert($mysqli, $origUserId, $origNotifTitle, $origNotifMessage, '/attendance-history', $authUserId);
            }
        }
        // =================================================================================

        // Return a clean message to the frontend without numbers if it's just 1
        $successMsg = $inserted_count === 1 
            ? "Successfully added the substitution!" 
            : "Successfully added substitutions for multiple classes!";

        json_response(['ok'=>true, 'message'=>$successMsg], 201);   

    } catch (Exception $e) {
        $mysqli->rollback(); // Undo everything if a duplicate or error is found
        json_response(['ok'=>false, 'error'=>'batch_failed', 'message'=>$e->getMessage()], 409);
    }
}
json_response(['error' => 'Endpoint not found'], 404);
?>
