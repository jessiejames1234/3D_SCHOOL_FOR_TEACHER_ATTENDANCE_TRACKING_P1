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
            cs.end_time

        FROM tbl_substitutions ss
        LEFT JOIN tbl_class_schedules cs ON ss.schedule_id = cs.schedule_id
        {$subJoinOffering}
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

    // --- DEPARTMENT FILTERING ---
    if ($authUserRole !== 1 && $authUserDept !== null) {
        $where[] = "orig_teacher.dept_id = ?";
        $params[] = $authUserDept;
        $types .= 'i';
    } elseif ($authUserRole !== 1 && $authUserDept === null) {
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
    if ((int)$authUserRole !== 2) {
        json_response(['ok' => false, 'error' => 'forbidden', 'message' => 'Only dean can add substitutions.'], 403);
    }
    if ((int)$authUserRole === 2 && $authUserDept === null) {
        json_response(['ok' => false, 'error' => 'forbidden', 'message' => 'Dean is not assigned to a department.'], 403);
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
    if ((int)$authUserRole === 2 && ($subDeptId === null || $subDeptId !== (int)$authUserDept)) {
        json_response(['ok' => false, 'error' => 'forbidden', 'message' => 'Dean can only assign substitutes within their own department.'], 403);
    }

    // Start Transaction for safe bulk insert
    $mysqli->begin_transaction();

    try {
        $deptScopeStmt = $mysqli->prepare("
            SELECT orig_teacher.user_id AS teacher_id, orig_teacher.dept_id
            FROM tbl_class_schedules cs
            {$subJoinOffering}
            LEFT JOIN tbl_users orig_teacher ON {$subTeacherExpr} = orig_teacher.user_id
            WHERE cs.schedule_id = ?
            LIMIT 1
        ");
        if (!$deptScopeStmt) {
            throw new Exception('Failed to validate schedule scope: ' . $mysqli->error);
        }
        $checkStmt = $mysqli->prepare("SELECT substitution_id FROM tbl_substitutions WHERE schedule_id = ? AND date = ?");
        $insertStmt = $mysqli->prepare("INSERT INTO tbl_substitutions (schedule_id, substitute_user_id, date) VALUES (?, ?, ?)");

        $inserted_count = 0;
        $createdSubs = [];

        foreach ($substitutions as $sub) {
            $schedule_id = (int)$sub['schedule_id'];
            $date = $sub['date'];

            if ((int)$authUserRole === 2) {
                $deptScopeStmt->bind_param('i', $schedule_id);
                $deptScopeStmt->execute();
                $deptScopeRow = $deptScopeStmt->get_result()->fetch_assoc();
                $scheduleTeacherId = isset($deptScopeRow['teacher_id']) && $deptScopeRow['teacher_id'] !== null ? (int)$deptScopeRow['teacher_id'] : null;
                if ($originalTeacherId && $scheduleTeacherId !== $originalTeacherId) {
                    throw new Exception('Selected schedule does not belong to the selected original teacher.');
                }
                $scheduleDeptId = isset($deptScopeRow['dept_id']) && $deptScopeRow['dept_id'] !== null ? (int)$deptScopeRow['dept_id'] : null;
                if ($scheduleDeptId === null || $scheduleDeptId !== (int)$authUserDept) {
                    throw new Exception('Dean can only manage substitutions for schedules inside their department.');
                }
            }

            // 1. Check for duplicate
            $checkStmt->bind_param('is', $schedule_id, $date);
            $checkStmt->execute();
            if ($checkStmt->get_result()->num_rows > 0) {
                throw new Exception("A substitution for this class on $date already exists.");
            }

            // 2. Insert
            $insertStmt->bind_param('iis', $schedule_id, $sub_id, $date);
            if (!$insertStmt->execute()) {
                throw new Exception("Failed to insert schedule: " . $insertStmt->error);
            }
            $inserted_count++;
            // record created substitution for post-processing
            $createdSubs[] = ['schedule_id' => $schedule_id, 'date' => $date, 'substitution_id' => $insertStmt->insert_id];
        }

        // --- After inserting substitutions, attempt to create attendance records for the substitute user ---
        // We will copy existing original teacher attendance rows (if any) into new rows for the substitute
        $createdAttendance = 0;
        $messages = [];
        $originalTeacherScheduleCounts = [];

        // Prepare statements used in processing
        $schedQ = $mysqli->prepare("SELECT cs.schedule_id, cs.start_time, cs.end_time, cs.room_id, {$subTeacherExpr} AS orig_user_id FROM tbl_class_schedules cs {$subJoinOffering} WHERE cs.schedule_id = ? LIMIT 1");
        $origAttQ = $mysqli->prepare("SELECT attendance_id FROM tbl_attendance_records WHERE schedule_id = ? AND date = ? AND user_id = ? LIMIT 1");
        $dupSubAttQ = $mysqli->prepare("SELECT 1 FROM tbl_attendance_records WHERE user_id = ? AND schedule_id = ? AND date = ? LIMIT 1");
        $conflictQ = $mysqli->prepare("SELECT ar.attendance_id FROM tbl_attendance_records ar JOIN tbl_class_schedules cs2 ON ar.schedule_id = cs2.schedule_id WHERE ar.user_id = ? AND ar.date = ? AND NOT (cs2.end_time <= ? OR cs2.start_time >= ?) LIMIT 1");
        $copyAttStmt = $mysqli->prepare("INSERT INTO tbl_attendance_records (user_id, schedule_id, room_id, floor_id, date, checked_in_at, altitude_in, latitude_in, longitude_in, flag_in_id, checked_mid_at, altitude_check, latitude_check, longitude_check, flag_check_id, checked_out_at, altitude_out, latitude_out, longitude_out, flag_out_id, remarks) SELECT ?, schedule_id, room_id, floor_id, date, checked_in_at, altitude_in, latitude_in, longitude_in, flag_in_id, checked_mid_at, altitude_check, latitude_check, longitude_check, flag_check_id, checked_out_at, altitude_out, latitude_out, longitude_out, flag_out_id, remarks FROM tbl_attendance_records WHERE attendance_id = ?");
        // Prepare statement to mark the original attendance as 'substituted' (flag id = 4)
        $markOrigStmt = $mysqli->prepare("UPDATE tbl_attendance_records SET flag_in_id = 4, flag_check_id = 4, flag_out_id = 4 WHERE attendance_id = ?");

        foreach ($createdSubs as $cs) {
            $schedule_id = (int)$cs['schedule_id'];
            $date = $cs['date'];

            // get schedule and original teacher
            $schedQ->bind_param('i', $schedule_id);
            $schedQ->execute();
            $sres = $schedQ->get_result();
            $srow = $sres ? $sres->fetch_assoc() : null;
            if (!$srow) {
                $messages[] = "Schedule $schedule_id not found, skipping attendance creation.";
                continue;
            }
            $orig_user = isset($srow['orig_user_id']) ? (int)$srow['orig_user_id'] : 0;
            if ($orig_user <= 0) {
                $messages[] = "No original teacher mapping for schedule {$schedule_id}; skipped.";
                continue;
            }
            if (!isset($originalTeacherScheduleCounts[$orig_user])) {
                $originalTeacherScheduleCounts[$orig_user] = 0;
            }
            $originalTeacherScheduleCounts[$orig_user]++;
            $s_start = $srow['start_time'];
            $s_end = $srow['end_time'];

            // find original attendance row for that schedule/date
            $origAttQ->bind_param('iss', $schedule_id, $date, $orig_user);
            $origAttQ->execute();
            $oRes = $origAttQ->get_result();
            $origAtt = $oRes ? $oRes->fetch_assoc() : null;

            if (!$origAtt) {
                // nothing to copy; skip
                $messages[] = "No attendance record for original teacher (user_id={$orig_user}) for schedule {$schedule_id} on {$date}; skipped.";
                continue;
            }

            $orig_attendance_id = (int)$origAtt['attendance_id'];

            // check substitute does not already have attendance for same schedule/date
            $dupSubAttQ->bind_param('iis', $sub_id, $schedule_id, $date);
            $dupSubAttQ->execute();
            if ($dupSubAttQ->get_result()->num_rows > 0) {
                $messages[] = "Substitute (user_id={$sub_id}) already has attendance for schedule {$schedule_id} on {$date}; skipped.";
                continue;
            }

            // check time overlap conflicts for substitute on that date
            $conflictQ->bind_param('isss', $sub_id, $date, $s_start, $s_end);
            $conflictQ->execute();
            if ($conflictQ->get_result()->num_rows > 0) {
                $messages[] = "Time conflict detected for substitute (user_id={$sub_id}) on {$date} for schedule {$schedule_id}; skipped.";
                continue;
            }

            // perform copy-insert
            $copyAttStmt->bind_param('ii', $sub_id, $orig_attendance_id);
            if (!$copyAttStmt->execute()) {
                $messages[] = "Failed to create attendance for substitute on schedule {$schedule_id} date {$date}: " . $copyAttStmt->error;
                continue;
            }
            $createdAttendance++;

            // mark original attendance record as 'substituted'
            if ($markOrigStmt) {
                $markOrigStmt->bind_param('i', $orig_attendance_id);
                if (!$markOrigStmt->execute()) {
                    // log but do not fail the whole transaction
                    $messages[] = "Warning: failed to mark original attendance {$orig_attendance_id} as substituted: " . $markOrigStmt->error;
                }
            }
        }

        // close helper statements
        $schedQ->close();
        $origAttQ->close();
        $dupSubAttQ->close();
        $conflictQ->close();
        $copyAttStmt->close();
        if ($markOrigStmt) $markOrigStmt->close();
        $deptScopeStmt->close();

        $checkStmt->close();
        $insertStmt->close();

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
