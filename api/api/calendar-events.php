<?php

declare(strict_types=1);

require_once __DIR__ . '/../helpers/calendar_event_helper.php';
require_once __DIR__ . '/../helpers/log_helper.php';
require_once __DIR__ . '/../helpers/socket_helper.php';
require_once __DIR__ . '/../scripts/cron_worker_lib.php';

global $mysqli, $authPayload;

calendar_event_schema_ensure($mysqli);
$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$input = get_input();
$path = parse_url((string)($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH);
$parts = array_values(array_filter(explode('/', (string)$path), 'strlen'));
$apiIndex = array_search('api', $parts, true);
$param1 = $apiIndex === false ? null : ($parts[$apiIndex + 2] ?? null);
$auth = is_array($authPayload) ? $authPayload : app_get_authenticated_session(true);
$userId = (int)($auth['user_id'] ?? 0);
$roleId = (int)($auth['role_id'] ?? 0);
$authDeptId = isset($auth['dept_id']) && $auth['dept_id'] !== null ? (int)$auth['dept_id'] : 0;

$bind = static function(mysqli_stmt $stmt, string $types, array &$values): void {
    if ($types === '') return;
    $refs = [&$types];
    foreach ($values as $key => $_) $refs[] = &$values[$key];
    call_user_func_array([$stmt, 'bind_param'], $refs);
};

$requireManager = static function() use ($roleId, $authDeptId): void {
    if (!in_array($roleId, [1, 6], true)) {
        json_response(['error' => 'forbidden', 'message' => 'Only Admin and Department Admin can manage holidays and events.'], 403);
    }
    if ($roleId === 6 && $authDeptId <= 0) {
        json_response(['error' => 'department_required', 'message' => 'This Department Admin account has no assigned department.'], 403);
    }
};

$validateScope = static function(array $payload) use ($mysqli, $roleId, $authDeptId): array {
    $deptId = isset($payload['dept_id']) && $payload['dept_id'] !== '' ? (int)$payload['dept_id'] : null;
    $programId = isset($payload['program_id']) && $payload['program_id'] !== '' ? (int)$payload['program_id'] : null;
    if ($roleId === 6) $deptId = $authDeptId;
    if ($programId !== null && $programId <= 0) $programId = null;
    if ($deptId !== null && $deptId <= 0) $deptId = null;
    if ($programId !== null && $deptId === null) {
        json_response(['error' => 'department_required', 'message' => 'Select a department before selecting a program.'], 422);
    }
    if ($deptId !== null) {
        $stmt = $mysqli->prepare("SELECT dept_id FROM tbl_departments WHERE dept_id = ? AND LOWER(TRIM(status)) = 'active' LIMIT 1");
        $stmt->bind_param('i', $deptId); $stmt->execute();
        if (!$stmt->get_result()->fetch_row()) json_response(['error' => 'invalid_department', 'message' => 'The selected department is unavailable.'], 422);
        $stmt->close();
    }
    if ($programId !== null) {
        $stmt = $mysqli->prepare("SELECT program_id FROM tbl_programs WHERE program_id = ? AND dept_id = ? AND LOWER(TRIM(status)) = 'active' LIMIT 1");
        $stmt->bind_param('ii', $programId, $deptId); $stmt->execute();
        if (!$stmt->get_result()->fetch_row()) json_response(['error' => 'invalid_program', 'message' => 'The selected program is unavailable or outside the department.'], 422);
        $stmt->close();
    }
    return [$deptId, $programId];
};

$validateEvent = static function(array $payload, ?int $ignoreId = null) use ($mysqli, $validateScope, $roleId, $authDeptId, $bind): array {
    $title = trim((string)($payload['title'] ?? ''));
    $description = trim((string)($payload['description'] ?? ''));
    $type = strtolower(trim((string)($payload['event_type'] ?? 'event')));
    $from = trim((string)($payload['date_from'] ?? ''));
    $to = trim((string)($payload['date_to'] ?? ''));
    if ($title === '' || mb_strlen($title) > 180) json_response(['error' => 'validation', 'message' => 'Enter a title of up to 180 characters.'], 422);
    if (!in_array($type, ['holiday', 'event'], true)) json_response(['error' => 'validation', 'message' => 'Type must be Holiday or Event.'], 422);
    $fromDate = DateTimeImmutable::createFromFormat('!Y-m-d', $from);
    $toDate = DateTimeImmutable::createFromFormat('!Y-m-d', $to);
    if (!$fromDate || !$toDate || $fromDate->format('Y-m-d') !== $from || $toDate->format('Y-m-d') !== $to || $to < $from) {
        json_response(['error' => 'validation', 'message' => 'Choose a valid start and end date.'], 422);
    }
    if ($from < date('Y-m-d')) json_response(['error' => 'past_date', 'message' => 'Past holidays or events cannot be created or edited.'], 422);
    [$deptId, $programId] = $validateScope($payload);
    try {
        [$startTime, $endTime] = calendar_event_validate_times($payload);
        $teacherIds = calendar_event_normalize_teacher_ids($payload['teacher_ids'] ?? []);
    } catch (InvalidArgumentException $error) {
        json_response(['error'=>'validation', 'message'=>$error->getMessage()], 422);
    }
    if ($teacherIds) {
        $idSql = implode(',', $teacherIds);
        $teachers = $mysqli->query("SELECT user_id,role_id,status,dept_id,assigned_program_head_id FROM tbl_users WHERE user_id IN ({$idSql})")->fetch_all(MYSQLI_ASSOC);
        if (count($teachers) !== count($teacherIds)) json_response(['error'=>'invalid_teacher','message'=>'A selected teacher no longer exists.'],422);
        foreach ($teachers as $teacher) {
            if (!calendar_event_teacher_matches_scope($teacher, $roleId, $authDeptId, $deptId, $programId)) json_response(['error'=>'forbidden_teacher','message'=>'Selected teachers must be active teaching accounts within the chosen department/program and your allowed scope.'],403);
        }
    }
    $sql = "SELECT event_id FROM tbl_calendar_events WHERE status = 'active' AND LOWER(title) = LOWER(?) AND event_type = ? AND date_from = ? AND date_to = ? AND dept_id <=> ? AND program_id <=> ? AND start_time <=> ? AND end_time <=> ?";
    $values = [$title,$type,$from,$to,$deptId,$programId,$startTime,$endTime]; $types = 'ssssiiss';
    if ($ignoreId) { $sql .= ' AND event_id <> ?'; $types .= 'i'; $values[] = $ignoreId; }
    $stmt = $mysqli->prepare($sql); $bind($stmt,$types,$values); $stmt->execute();
    $duplicates = $stmt->get_result()->fetch_all(MYSQLI_ASSOC); $stmt->close();
    foreach ($duplicates as $duplicate) {
        if (calendar_event_teacher_ids($mysqli,(int)$duplicate['event_id']) === $teacherIds) json_response(['error'=>'duplicate','message'=>'This active holiday or event already exists with the same coverage.'],409);
    }
    return compact('title', 'description', 'type', 'from', 'to', 'deptId', 'programId', 'startTime', 'endTime', 'teacherIds');
};

if ($method === 'GET' && $param1 === 'occurrences') {
    $teacherId = (int)($_GET['teacher_id'] ?? $userId);
    if ($teacherId !== $userId) json_response(['error' => 'forbidden', 'message' => 'You can only view your own calendar.'], 403);
    $from = (string)($_GET['date_from'] ?? date('Y-m-01'));
    $to = (string)($_GET['date_to'] ?? date('Y-m-t'));
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $from) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $to) || $to < $from || (strtotime($to) - strtotime($from)) > 70 * 86400) {
        json_response(['error' => 'invalid_range', 'message' => 'Calendar range must be valid and no longer than 70 days.'], 422);
    }
    $semesterId = (int)($_GET['semester_id'] ?? 0);
    $coverageSql = calendar_event_schedule_conditions_sql('cs.user_id', 'cs.start_time', 'cs.end_time');
    $sql = "SELECT cs.schedule_id, cs.semester_id, cs.day_of_week, cs.start_time, cs.end_time,
                   s.subject_id, s.subject_code, s.subject_name, sec.section_id, sec.section_name,
                   r.room_id, r.room_name, ce.event_id, ce.title AS event_title, ce.event_type,
                   GREATEST(ce.date_from, ?, sem.start_date) AS effective_from,
                   LEAST(ce.date_to, ?, sem.end_date) AS effective_to
            FROM tbl_class_schedules cs
            JOIN tbl_semesters sem ON sem.semester_id = cs.semester_id
            JOIN tbl_subject s ON s.subject_id = cs.subject_id
            JOIN tbl_programs sp ON sp.program_id = s.program_id
            JOIN tbl_sections sec ON sec.section_id = cs.section_id
            JOIN tbl_programs secp ON secp.program_id = sec.program_id
            JOIN tbl_rooms r ON r.room_id = cs.room_id
            JOIN tbl_calendar_events ce ON ce.status = 'active'
              AND ce.date_to >= ? AND ce.date_from <= ?
              AND (ce.dept_id IS NULL OR (ce.dept_id = sp.dept_id AND ce.dept_id = secp.dept_id))
              AND (ce.program_id IS NULL OR (ce.program_id = sp.program_id AND ce.program_id = secp.program_id))
              AND {$coverageSql}
            WHERE cs.user_id = ?";
    if ($semesterId > 0) $sql .= ' AND cs.semester_id = ?';
    $stmt = $mysqli->prepare($sql);
    if ($semesterId > 0) $stmt->bind_param('ssssii', $from, $to, $from, $to, $teacherId, $semesterId);
    else $stmt->bind_param('ssssi', $from, $to, $from, $to, $teacherId);
    $stmt->execute();
    $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    $stmt->close();

    $attendance = [];
    $stmt = $mysqli->prepare("SELECT schedule_id, DATE_FORMAT(date, '%Y-%m-%d') AS record_date,
            checked_in_at, checked_mid_at, checked_out_at, flag_in_id, flag_check_id, flag_out_id
        FROM tbl_attendance_records WHERE user_id = ? AND date BETWEEN ? AND ?");
    $stmt->bind_param('iss', $teacherId, $from, $to); $stmt->execute();
    foreach ($stmt->get_result()->fetch_all(MYSQLI_ASSOC) as $record) $attendance[$record['schedule_id'] . ':' . $record['record_date']] = $record;
    $stmt->close();

    $occurrences = [];
    $today = date('Y-m-d'); $nowTime = date('H:i:s');
    foreach ($rows as $row) {
        $start = max($from, (string)$row['effective_from']);
        $end = min($to, (string)$row['effective_to']);
        if ($end < $start) continue;
        $cursor = new DateTimeImmutable($start); $last = new DateTimeImmutable($end);
        for (; $cursor <= $last; $cursor = $cursor->modify('+1 day')) {
            $date = $cursor->format('Y-m-d');
            if (strtolower($cursor->format('l')) !== strtolower((string)$row['day_of_week'])) continue;
            if ($date === $today && (string)$row['start_time'] <= $nowTime) continue;
            $key = $row['schedule_id'] . ':' . $date;
            $record = $attendance[$key] ?? null;
            if ($record) {
                $pristine = !$record['checked_in_at'] && !$record['checked_mid_at'] && !$record['checked_out_at']
                    && (int)($record['flag_in_id'] ?? 1) === 1
                    && (int)($record['flag_check_id'] ?? 1) === 1
                    && (int)($record['flag_out_id'] ?? 1) === 1;
                if (!$pristine) continue;
            }
            if (!isset($occurrences[$key])) {
                $occurrences[$key] = [
                    'id' => 'no-class-' . $row['schedule_id'] . '-' . $date,
                    'schedule_id' => (int)$row['schedule_id'], 'semester_id' => (int)$row['semester_id'], 'date' => $date,
                    'subject_id' => (int)$row['subject_id'], 'subject_code' => $row['subject_code'], 'subject_name' => $row['subject_name'],
                    'section_id' => (int)$row['section_id'], 'section_name' => $row['section_name'],
                    'room_id' => (int)$row['room_id'], 'room_name' => $row['room_name'],
                    'start_time' => $row['start_time'], 'end_time' => $row['end_time'],
                    'is_no_class' => true, 'event_titles' => [], 'event_types' => [],
                ];
            }
            $occurrences[$key]['event_titles'][] = $row['event_title'];
            $occurrences[$key]['event_types'][] = $row['event_type'];
        }
    }
    foreach ($occurrences as &$entry) {
        $entry['event_titles'] = array_values(array_unique($entry['event_titles']));
        $entry['event_types'] = array_values(array_unique($entry['event_types']));
        $entry['event_title'] = implode(' / ', $entry['event_titles']);
    }
    unset($entry);
    json_response(['items' => array_values($occurrences), 'total' => count($occurrences)]);
}

$requireManager();

if ($method === 'GET' && $param1 === 'teachers') {
    [$deptId, $programId] = $validateScope($_GET);
    $sql = "SELECT user_id, first_name, last_name, email, dept_id, role_id, assigned_program_head_id FROM tbl_users WHERE role_id IN (2,3,4,5) AND LOWER(TRIM(status)) IN ('active','1','true')";
    $types = ''; $values = [];
    if ($deptId !== null) { $sql .= ' AND dept_id = ?'; $types .= 'i'; $values[] = $deptId; }
    if ($programId !== null) { $sql .= ' AND assigned_program_head_id = ?'; $types .= 'i'; $values[] = $programId; }
    $sql .= ' ORDER BY last_name, first_name, user_id';
    $stmt = $mysqli->prepare($sql); $bind($stmt,$types,$values); $stmt->execute();
    $teachers = $stmt->get_result()->fetch_all(MYSQLI_ASSOC); $stmt->close();
    json_response($teachers);
}

if ($method === 'POST' && $param1 === 'preview') {
    $ignoreId = isset($input['event_id']) && (int)$input['event_id'] > 0 ? (int)$input['event_id'] : null;
    if ($ignoreId !== null) {
        $scopeStmt = $mysqli->prepare('SELECT * FROM tbl_calendar_events WHERE event_id = ? LIMIT 1');
        $scopeStmt->bind_param('i', $ignoreId); $scopeStmt->execute(); $scopeRow = $scopeStmt->get_result()->fetch_assoc(); $scopeStmt->close();
        if (!$scopeRow) json_response(['error' => 'not_found', 'message' => 'Calendar event not found.'], 404);
        if ($roleId === 6 && (int)$scopeRow['dept_id'] !== $authDeptId) json_response(['error' => 'forbidden', 'message' => 'You can only preview changes inside your department.'], 403);
        if ((string)$scopeRow['date_from'] < date('Y-m-d')) json_response(['error' => 'locked', 'message' => 'This event has already started and is read-only.'], 409);
    }
    if ($ignoreId !== null && calendar_event_has_protected_attendance($mysqli, $scopeRow, calendar_event_teacher_ids($mysqli, $ignoreId))) json_response(['error'=>'attendance_locked','message'=>'This entry cannot be edited because covered attendance has activity or finalized statuses.'],409);
    $event = $validateEvent($input, $ignoreId);
    if ($ignoreId !== null && calendar_event_has_protected_attendance($mysqli, $event, $event['teacherIds'])) json_response(['error'=>'attendance_locked','message'=>'The proposed coverage includes recorded attendance and cannot be applied as an edit.'],409);

    $scheduleSql = "SELECT cs.schedule_id, cs.day_of_week, cs.start_time,
            GREATEST(sem.start_date, ?) AS effective_from,
            LEAST(sem.end_date, ?) AS effective_to
        FROM tbl_class_schedules cs
        JOIN tbl_semesters sem ON sem.semester_id = cs.semester_id
        JOIN tbl_subject subj ON subj.subject_id = cs.subject_id
        JOIN tbl_programs sp ON sp.program_id = subj.program_id
        JOIN tbl_sections sec ON sec.section_id = cs.section_id
        JOIN tbl_programs secp ON secp.program_id = sec.program_id
        WHERE sem.end_date >= ? AND sem.start_date <= ?";
    $scheduleTypes = 'ssss';
    $scheduleValues = [$event['from'], $event['to'], $event['from'], $event['to']];
    calendar_event_append_scope_filter($scheduleSql, $scheduleTypes, $scheduleValues, $event);
    $scheduleStmt = $mysqli->prepare($scheduleSql);
    $bind($scheduleStmt, $scheduleTypes, $scheduleValues); $scheduleStmt->execute();
    $scheduleRows = $scheduleStmt->get_result()->fetch_all(MYSQLI_ASSOC); $scheduleStmt->close();
    $affected = [];
    $today = date('Y-m-d'); $nowTime = date('H:i:s');
    foreach ($scheduleRows as $schedule) {
        $start = max($event['from'], (string)$schedule['effective_from']);
        $end = min($event['to'], (string)$schedule['effective_to']);
        if ($end < $start) continue;
        $cursor = new DateTimeImmutable($start); $last = new DateTimeImmutable($end);
        for (; $cursor <= $last; $cursor = $cursor->modify('+1 day')) {
            $date = $cursor->format('Y-m-d');
            if (strtolower($cursor->format('l')) !== strtolower((string)$schedule['day_of_week'])) continue;
            if ($date === $today && (string)$schedule['start_time'] <= $nowTime) continue;
            $affected[$schedule['schedule_id'] . ':' . $date] = true;
        }
    }

    // A class that already contains attendance activity is intentionally not
    // converted to No Class, so exclude it from the preview count as well.
    $attendanceSql = "SELECT ar.schedule_id, DATE_FORMAT(ar.date, '%Y-%m-%d') AS record_date,
            ar.checked_in_at, ar.checked_mid_at, ar.checked_out_at,
            ar.flag_in_id, ar.flag_check_id, ar.flag_out_id
        FROM tbl_attendance_records ar
        JOIN tbl_class_schedules cs ON cs.schedule_id = ar.schedule_id
        JOIN tbl_subject subj ON subj.subject_id = cs.subject_id
        JOIN tbl_programs sp ON sp.program_id = subj.program_id
        JOIN tbl_sections sec ON sec.section_id = cs.section_id
        JOIN tbl_programs secp ON secp.program_id = sec.program_id
        WHERE ar.date BETWEEN ? AND ?";
    $attendanceTypes = 'ss'; $attendanceValues = [$event['from'], $event['to']];
    calendar_event_append_scope_filter($attendanceSql, $attendanceTypes, $attendanceValues, $event);
    $attendanceStmt = $mysqli->prepare($attendanceSql);
    $bind($attendanceStmt, $attendanceTypes, $attendanceValues); $attendanceStmt->execute();
    foreach ($attendanceStmt->get_result()->fetch_all(MYSQLI_ASSOC) as $record) {
        $pristine = !$record['checked_in_at'] && !$record['checked_mid_at'] && !$record['checked_out_at']
            && (int)($record['flag_in_id'] ?? 1) === 1
            && (int)($record['flag_check_id'] ?? 1) === 1
            && (int)($record['flag_out_id'] ?? 1) === 1;
        if (!$pristine) unset($affected[$record['schedule_id'] . ':' . $record['record_date']]);
    }
    $attendanceStmt->close();

    $overlapSql = "SELECT ce.event_id, ce.title, ce.event_type, ce.date_from, ce.date_to, ce.start_time, ce.end_time,
            COALESCE(d.dept_name, 'All departments') AS department_name,
            COALESCE(p.program_name, 'All programs') AS program_name
        FROM tbl_calendar_events ce
        LEFT JOIN tbl_departments d ON d.dept_id = ce.dept_id
        LEFT JOIN tbl_programs p ON p.program_id = ce.program_id
        WHERE ce.status = 'active' AND ce.date_from <= ? AND ce.date_to >= ?
          AND (ce.dept_id IS NULL OR ? IS NULL OR ce.dept_id = ?)
          AND (ce.program_id IS NULL OR ? IS NULL OR ce.program_id = ?)";
    $overlapValues = [$event['to'], $event['from'], $event['deptId'], $event['deptId'], $event['programId'], $event['programId']];
    $overlapTypes = 'ssiiii';
    if ($ignoreId !== null) { $overlapSql .= ' AND ce.event_id <> ?'; $overlapTypes .= 'i'; $overlapValues[] = $ignoreId; }
    if ($event['startTime'] !== null) {
        $overlapSql .= ' AND (ce.start_time IS NULL OR (ce.start_time < ? AND ce.end_time > ?))';
        $overlapTypes .= 'ss'; array_push($overlapValues,$event['endTime'],$event['startTime']);
    }
    if ($event['teacherIds']) {
        $overlapSql .= ' AND (NOT EXISTS (SELECT 1 FROM tbl_calendar_event_teachers cet_all WHERE cet_all.event_id=ce.event_id) OR EXISTS (SELECT 1 FROM tbl_calendar_event_teachers cet_match WHERE cet_match.event_id=ce.event_id AND cet_match.user_id IN (' . implode(',', $event['teacherIds']) . ')))';
    }
    $overlapSql .= ' ORDER BY ce.date_from, ce.title';
    $overlapStmt = $mysqli->prepare($overlapSql);
    $bind($overlapStmt, $overlapTypes, $overlapValues); $overlapStmt->execute();
    $overlaps = $overlapStmt->get_result()->fetch_all(MYSQLI_ASSOC); $overlapStmt->close();
    json_response(['affected_class_count' => count($affected), 'overlaps' => $overlaps]);
}

if ($method === 'GET') {
    $page = max(1, (int)($_GET['page'] ?? 1));
    $pageSize = min(200, max(1, (int)($_GET['page_size'] ?? 10)));
    $status = strtolower(trim((string)($_GET['status'] ?? 'all')));
    $type = strtolower(trim((string)($_GET['event_type'] ?? 'all')));
    $search = trim((string)($_GET['q'] ?? ''));
    $rangeFrom = trim((string)($_GET['date_from'] ?? ''));
    $rangeTo = trim((string)($_GET['date_to'] ?? ''));
    $where = []; $types = ''; $values = [];
    if ($roleId === 6) { $where[] = '(ce.dept_id IS NULL OR ce.dept_id = ?)'; $types .= 'i'; $values[] = $authDeptId; }
    if (in_array($status, ['active', 'cancelled'], true)) { $where[] = 'ce.status = ?'; $types .= 's'; $values[] = $status; }
    if (in_array($type, ['holiday', 'event'], true)) { $where[] = 'ce.event_type = ?'; $types .= 's'; $values[] = $type; }
    if ($search !== '') { $where[] = '(ce.title LIKE ? OR ce.description LIKE ?)'; $like = '%' . $search . '%'; $types .= 'ss'; $values[] = $like; $values[] = $like; }
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $rangeFrom)) { $where[] = 'ce.date_to >= ?'; $types .= 's'; $values[] = $rangeFrom; }
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $rangeTo)) { $where[] = 'ce.date_from <= ?'; $types .= 's'; $values[] = $rangeTo; }
    $whereSql = $where ? ' WHERE ' . implode(' AND ', $where) : '';
    $countStmt = $mysqli->prepare('SELECT COUNT(*) FROM tbl_calendar_events ce' . $whereSql);
    $countValues = $values; $bind($countStmt, $types, $countValues); $countStmt->execute();
    $total = (int)$countStmt->get_result()->fetch_row()[0]; $countStmt->close();
    $offset = ($page - 1) * $pageSize;
    $sql = "SELECT ce.*, d.dept_name, p.program_name,
              CONCAT(TRIM(COALESCE(u.first_name,'')), ' ', TRIM(COALESCE(u.last_name,''))) AS created_by_name,
              CONCAT(TRIM(COALESCE(cu.first_name,'')), ' ', TRIM(COALESCE(cu.last_name,''))) AS cancelled_by_name
            FROM tbl_calendar_events ce
            LEFT JOIN tbl_departments d ON d.dept_id = ce.dept_id
            LEFT JOIN tbl_programs p ON p.program_id = ce.program_id
            LEFT JOIN tbl_users u ON u.user_id = ce.created_by
            LEFT JOIN tbl_users cu ON cu.user_id = ce.cancelled_by
            {$whereSql} ORDER BY ce.date_from DESC, ce.event_id DESC LIMIT ? OFFSET ?";
    $stmt = $mysqli->prepare($sql); $dataValues = $values; $dataValues[] = $pageSize; $dataValues[] = $offset;
    $dataTypes = $types . 'ii'; $bind($stmt, $dataTypes, $dataValues); $stmt->execute();
    $items = $stmt->get_result()->fetch_all(MYSQLI_ASSOC); $stmt->close();
    $items = calendar_event_attach_coverage($mysqli, $items);
    $statsWhere = $roleId === 6 ? ' WHERE dept_id IS NULL OR dept_id = ' . $authDeptId : '';
    $statsResult = $mysqli->query("SELECT status, COUNT(*) total FROM tbl_calendar_events{$statsWhere} GROUP BY status");
    $stats = ['active' => 0, 'cancelled' => 0];
    while ($row = $statsResult->fetch_assoc()) $stats[$row['status']] = (int)$row['total'];
    json_response(['items' => $items, 'total' => $total, 'page' => $page, 'page_size' => $pageSize, 'stats' => $stats]);
}

if ($method === 'POST') {
    $event = $validateEvent($input);
    $mysqli->begin_transaction();
    try {
        $stmt = $mysqli->prepare("INSERT INTO tbl_calendar_events (title,event_type,date_from,date_to,dept_id,program_id,start_time,end_time,description,status,created_by) VALUES (?,?,?,?,?,?,?,?,?,'active',?)");
        $values = [$event['title'],$event['type'],$event['from'],$event['to'],$event['deptId'],$event['programId'],$event['startTime'],$event['endTime'],$event['description'],$userId];
        $bind($stmt,'ssssiisssi',$values); $stmt->execute(); $id=(int)$stmt->insert_id; $stmt->close();
        calendar_event_save_teacher_ids($mysqli,$id,$event['teacherIds']);
        $sync = calendar_event_delete_blocked_upcoming_attendance($mysqli);
        if (!$sync['ok']) throw new RuntimeException('Attendance synchronization failed.');
        $mysqli->commit();
    } catch (Throwable $error) {
        $mysqli->rollback(); error_log('[calendar-events/create] '.$error->getMessage());
        json_response(['error'=>'create_failed','message'=>'The entry was not saved because coverage could not be synchronized.'],500);
    }
    log_system_action($mysqli,$userId,'Create Calendar Event',"Created {$event['type']} '{$event['title']}' ({$event['from']} to {$event['to']}).");
    try { trigger_socket_update(['entity'=>'calendar_events','action'=>'create','event_id'=>$id]); } catch (Throwable $_) {}
    json_response(['event_id'=>$id,'message'=>'Holiday or event created.','removed_upcoming_records'=>$sync['deleted_rows']],201);
}

$eventId = is_numeric($param1) ? (int)$param1 : 0;
if ($eventId <= 0) json_response(['error'=>'not_found','message'=>'Calendar event not found.'],404);
if (!in_array($method,['PUT','DELETE'],true)) json_response(['error'=>'method_not_allowed'],405);
$event = $method === 'PUT' ? $validateEvent($input,$eventId) : null;
$mysqli->begin_transaction();
try {
    $stmt=$mysqli->prepare('SELECT * FROM tbl_calendar_events WHERE event_id=? FOR UPDATE');
    $stmt->bind_param('i',$eventId); $stmt->execute(); $existing=$stmt->get_result()->fetch_assoc(); $stmt->close();
    if (!$existing) { $mysqli->rollback(); json_response(['error'=>'not_found','message'=>'Calendar event not found.'],404); }
    if ($roleId===6 && (int)$existing['dept_id']!==$authDeptId) { $mysqli->rollback(); json_response(['error'=>'forbidden','message'=>'You can only manage events in your department.'],403); }
    if ($existing['date_from'] < date('Y-m-d')) { $mysqli->rollback(); json_response(['error'=>'locked','message'=>'Past events are read-only.'],409); }
    if ($existing['status'] !== 'active') { $mysqli->rollback(); json_response(['error'=>'cancelled','message'=>'Cancelled events are read-only.'],409); }
    $oldTeachers=calendar_event_teacher_ids($mysqli,$eventId);
    $protected=calendar_event_has_protected_attendance($mysqli,$existing,$oldTeachers,true);
    if ($event !== null) $protected = calendar_event_has_protected_attendance($mysqli,$event,$event['teacherIds'],true) || $protected;
    if ($protected) { $mysqli->rollback(); json_response(['error'=>'attendance_locked','message'=>'This entry cannot be edited or cancelled because affected attendance has activity or finalized statuses.'],409); }
    if ($method==='PUT') {
        $stmt=$mysqli->prepare('UPDATE tbl_calendar_events SET title=?,event_type=?,date_from=?,date_to=?,dept_id=?,program_id=?,start_time=?,end_time=?,description=?,updated_by=? WHERE event_id=?');
        $values=[$event['title'],$event['type'],$event['from'],$event['to'],$event['deptId'],$event['programId'],$event['startTime'],$event['endTime'],$event['description'],$userId,$eventId];
        $bind($stmt,'ssssiisssii',$values); $stmt->execute(); $stmt->close();
        calendar_event_save_teacher_ids($mysqli,$eventId,$event['teacherIds']);
    } else {
        $stmt=$mysqli->prepare("UPDATE tbl_calendar_events SET status='cancelled',cancelled_by=?,cancelled_at=NOW(),updated_by=? WHERE event_id=?");
        $stmt->bind_param('iii',$userId,$userId,$eventId); $stmt->execute(); $stmt->close();
    }
    $generated=cw_generate_attendance_records($mysqli,[],0,31,true);
    $sync=calendar_event_delete_blocked_upcoming_attendance($mysqli);
    if (!$generated['ok'] || !$sync['ok']) throw new RuntimeException('Attendance synchronization failed.');
    $mysqli->commit();
} catch (Throwable $error) {
    $mysqli->rollback(); error_log('[calendar-events/update] '.$error->getMessage());
    json_response(['error'=>'sync_failed','message'=>'The change was not saved because attendance could not be synchronized.'],500);
}
$action=$method==='PUT' ? 'update' : 'cancel';
log_system_action($mysqli,$userId,$method==='PUT' ? 'Update Calendar Event' : 'Cancel Calendar Event',ucfirst($action)."d '{$existing['title']}'.");
try { trigger_socket_update(['entity'=>'calendar_events','action'=>$action,'event_id'=>$eventId]); } catch (Throwable $_) {}
json_response(['message'=>$method==='PUT' ? 'Holiday or event updated.' : 'Holiday or event cancelled.','removed_upcoming_records'=>$sync['deleted_rows'],'restored_upcoming_records'=>$generated['generated_rows']]);
