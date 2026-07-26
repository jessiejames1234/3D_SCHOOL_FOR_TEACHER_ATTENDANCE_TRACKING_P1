<?php
// Compact, authenticated live marker feed for the 3D building viewer.

if (!isset($GLOBALS['mysqli']) || $GLOBALS['mysqli'] === null) {
    require_once __DIR__ . '/../config/database.php';
}
if (!function_exists('json_response')) {
    require_once __DIR__ . '/../helpers/functions.php';
}

global $mysqli, $authPayload;

if (strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'GET') {
    json_response(['error' => 'method_not_allowed'], 405);
}

$buildingCode = strtoupper(trim((string)($_GET['building_code'] ?? '')));
$buildingAliases = [
    'MW' => ['mainwest', 'mw'],
    'MN' => ['mainnorth', 'mn'],
    'MS' => ['mainsouth', 'ms'],
    'PH' => ['phinmahall', 'ph'],
];
if (!isset($buildingAliases[$buildingCode])) {
    json_response(['error' => 'validation', 'message' => 'building_code must be MW, MN, MS, or PH.'], 400);
}

$authUserId = isset($authPayload['user_id']) ? (int)$authPayload['user_id'] : 0;
$authRoleId = isset($authPayload['role_id']) ? (int)$authPayload['role_id'] : 0;
if ($authUserId <= 0) {
    json_response(['error' => 'unauthorized'], 401);
}

function tdb_presence_table_exists(mysqli $mysqli, string $table): bool {
    $safe = $mysqli->real_escape_string(preg_replace('/[^a-zA-Z0-9_]/', '', $table));
    $result = $mysqli->query("SHOW TABLES LIKE '{$safe}'");
    return $result && $result->num_rows > 0;
}

function tdb_presence_column_exists(mysqli $mysqli, string $table, string $column): bool {
    $safeTable = preg_replace('/[^a-zA-Z0-9_]/', '', $table);
    $safeColumn = $mysqli->real_escape_string(preg_replace('/[^a-zA-Z0-9_]/', '', $column));
    $result = $mysqli->query("SHOW COLUMNS FROM `{$safeTable}` LIKE '{$safeColumn}'");
    return $result && $result->num_rows > 0;
}

function tdb_presence_status(int $flagId): string {
    if ($flagId === 2) return 'PRESENT';
    if ($flagId === 5) return 'LATE';
    if ($flagId === 3) return 'ABSENT';
    return 'PENDING';
}

function tdb_presence_thumbnail_url(int $userId): ?string {
    if ($userId <= 0) return null;
    $security = file_exists(__DIR__ . '/../config/security.php')
        ? require __DIR__ . '/../config/security.php'
        : [];
    $secret = (string)($security['jwt_secret'] ?? 'your-secret-key');
    $expires = ((int)ceil(time() / 3600) + 1) * 3600;
    $payload = $userId . '|' . $expires . '|avatar-thumbnail';
    $signature = hash_hmac('sha256', $payload, $secret);
    return 'avatar-thumbnail.php?user_id=' . $userId
        . '&expires=' . $expires
        . '&signature=' . rawurlencode($signature);
}

$hasOfferings = tdb_presence_table_exists($mysqli, 'tbl_subject_offerings')
    && tdb_presence_column_exists($mysqli, 'tbl_class_schedules', 'offering_id');
$csHasUser = tdb_presence_column_exists($mysqli, 'tbl_class_schedules', 'user_id');
$csHasSubject = tdb_presence_column_exists($mysqli, 'tbl_class_schedules', 'subject_id');
$csHasSection = tdb_presence_column_exists($mysqli, 'tbl_class_schedules', 'section_id');
$soHasUser = $hasOfferings && tdb_presence_column_exists($mysqli, 'tbl_subject_offerings', 'user_id');
$soHasSubject = $hasOfferings && tdb_presence_column_exists($mysqli, 'tbl_subject_offerings', 'subject_id');
$soHasSection = $hasOfferings && tdb_presence_column_exists($mysqli, 'tbl_subject_offerings', 'section_id');
$hasSubstitutions = tdb_presence_table_exists($mysqli, 'tbl_substitutions');
$hasLeaves = tdb_presence_table_exists($mysqli, 'tbl_leaves');
$hasLeaveTypes = tdb_presence_table_exists($mysqli, 'tbl_leave_type');

$joinOffering = $hasOfferings ? 'LEFT JOIN tbl_subject_offerings so ON cs.offering_id = so.offering_id' : '';
$teacherExpr = $csHasUser ? 'cs.user_id' : (($hasOfferings && $soHasUser) ? 'so.user_id' : 'NULL');
$subjectExpr = $csHasSubject ? 'cs.subject_id' : (($hasOfferings && $soHasSubject) ? 'so.subject_id' : 'NULL');
$sectionExpr = $csHasSection ? 'cs.section_id' : (($hasOfferings && $soHasSection) ? 'so.section_id' : 'NULL');

$joinSubstitution = $hasSubstitutions ? "
    LEFT JOIN tbl_substitutions ss ON ss.substitution_id = (
        SELECT MAX(ss2.substitution_id)
        FROM tbl_substitutions ss2
        WHERE ss2.schedule_id = cs.schedule_id
          AND ss2.date = CURDATE()
          AND LOWER(COALESCE(ss2.req_status, 'approve')) NOT IN ('canceled', 'rejected')
    )
    LEFT JOIN tbl_users su ON su.user_id = ss.substitute_user_id
    LEFT JOIN tbl_attendance_records sar ON sar.schedule_id = cs.schedule_id
        AND sar.date = CURDATE() AND sar.user_id = ss.substitute_user_id" : "
    LEFT JOIN (SELECT NULL AS substitution_id, NULL AS substitute_user_id) ss ON 1 = 0
    LEFT JOIN tbl_users su ON 1 = 0
    LEFT JOIN tbl_attendance_records sar ON 1 = 0";

$substitutionSelect = $hasSubstitutions
    ? 'ss.substitution_id, ss.substitute_user_id, ss.req_status AS substitution_status,'
    : 'NULL AS substitution_id, NULL AS substitute_user_id, NULL AS substitution_status,';

$joinLeave = $hasLeaves ? "
    LEFT JOIN tbl_leaves l ON l.leave_id = (
        SELECT MAX(l2.leave_id)
        FROM tbl_leaves l2
        WHERE l2.teacher_id = {$teacherExpr}
          AND l2.req_status = 'approve'
          AND CURDATE() BETWEEN l2.date_from AND l2.date_to
    )" : 'LEFT JOIN (SELECT NULL AS leave_id, NULL AS leave_type_id, NULL AS reason) l ON 1 = 0';
$joinLeaveType = $hasLeaves && $hasLeaveTypes
    ? 'LEFT JOIN tbl_leave_type lt ON lt.leave_type_id = l.leave_type_id'
    : 'LEFT JOIN (SELECT NULL AS name_type) lt ON 1 = 0';

$normalizedAliases = array_map(function ($value) use ($mysqli) {
    return "'" . $mysqli->real_escape_string($value) . "'";
}, $buildingAliases[$buildingCode]);

$scopeSql = '';
$authDeptId = app_get_user_department_id($mysqli, $authUserId);
if ($authDeptId === null && in_array($authRoleId, [2, 4, 6], true)
    && tdb_presence_column_exists($mysqli, 'tbl_departments', 'dean_id')) {
    $deptStmt = $mysqli->prepare('SELECT dept_id FROM tbl_departments WHERE dean_id = ? LIMIT 1');
    if ($deptStmt) {
        $deptStmt->bind_param('i', $authUserId);
        $deptStmt->execute();
        $deptRow = $deptStmt->get_result()->fetch_assoc();
        $deptStmt->close();
        if ($deptRow && isset($deptRow['dept_id'])) $authDeptId = (int)$deptRow['dept_id'];
    }
}
if (in_array($authRoleId, [2, 4, 6], true)) {
    if ($authDeptId === null) {
        header('Cache-Control: no-store');
        json_response(['building_code' => $buildingCode, 'generated_at' => date(DATE_ATOM), 'version' => sha1('[]'), 'markers' => []]);
    }
    $scopeSql = ' AND u.dept_id = ' . (int)$authDeptId;
} elseif ($authRoleId === 3) {
    $scopeSql = ' AND p.head_id = ' . $authUserId;
} elseif ($authRoleId === 5) {
    $scopeSql = ' AND u.user_id = ' . $authUserId;
}

$effectiveFlagExpr = 'CASE
    WHEN ss.substitution_id IS NOT NULL THEN COALESCE(sar.flag_in_id, 1)
    WHEN l.leave_id IS NOT NULL THEN 1
    ELSE COALESCE(ar.flag_in_id, 1)
END';
$sql = "SELECT
    cs.schedule_id,
    cs.semester_id,
    r.room_id,
    r.room_name,
    b.building_name,
    f.floor_name,
    cs.start_time,
    cs.end_time,
    {$teacherExpr} AS original_teacher_id,
    {$subjectExpr} AS subject_id,
    CONCAT_WS(' ', u.first_name, u.last_name) AS original_teacher_name,
    u.dept_id,
    d.dept_name,
    {$substitutionSelect}
    CONCAT_WS(' ', su.first_name, su.last_name) AS substitute_teacher_name,
    l.leave_id,
    lt.name_type AS leave_type,
    l.reason AS leave_reason,
    s.subject_code,
    s.subject_name,
    sec.section_name,
    ar.attendance_id,
    ar.flag_in_id,
    ar.flag_check_id,
    ar.flag_out_id,
    ar.checked_in_at,
    ar.checked_mid_at,
    ar.checked_out_at,
    sar.attendance_id AS substitute_attendance_id,
    sar.flag_in_id AS substitute_flag_in_id,
    sar.flag_check_id AS substitute_flag_check_id,
    sar.flag_out_id AS substitute_flag_out_id,
    sar.checked_in_at AS substitute_checked_in_at,
    sar.checked_mid_at AS substitute_checked_mid_at,
    sar.checked_out_at AS substitute_checked_out_at,
    CASE WHEN NOW() BETWEEN TIMESTAMP(CURDATE(), cs.start_time) AND TIMESTAMP(CURDATE(), cs.end_time) THEN 1 ELSE 0 END AS is_active
FROM tbl_class_schedules cs
JOIN tbl_rooms r ON r.room_id = cs.room_id
JOIN tbl_buildings b ON b.building_id = r.building_id
LEFT JOIN tbl_floors f ON f.floor_id = r.floor_id
{$joinOffering}
LEFT JOIN tbl_users u ON u.user_id = {$teacherExpr}
LEFT JOIN tbl_departments d ON d.dept_id = u.dept_id
LEFT JOIN tbl_subject s ON s.subject_id = {$subjectExpr}
LEFT JOIN tbl_sections sec ON sec.section_id = {$sectionExpr}
LEFT JOIN tbl_programs p ON p.program_id = s.program_id
LEFT JOIN tbl_semesters sem ON sem.semester_id = cs.semester_id
LEFT JOIN tbl_attendance_records ar ON ar.schedule_id = cs.schedule_id
    AND ar.date = CURDATE() AND ar.user_id = {$teacherExpr}
{$joinSubstitution}
{$joinLeave}
{$joinLeaveType}
WHERE LOWER(REPLACE(REPLACE(TRIM(b.building_name), ' ', ''), '-', '')) IN (" . implode(',', $normalizedAliases) . ")
  AND LOWER(cs.day_of_week) = LOWER(DAYNAME(CURDATE()))
  AND (sem.semester_id IS NULL OR CURDATE() BETWEEN sem.start_date AND sem.end_date)
  AND (
      NOW() BETWEEN TIMESTAMP(CURDATE(), cs.start_time) AND TIMESTAMP(CURDATE(), cs.end_time)
      OR (
          {$effectiveFlagExpr} = 3
          AND NOW() > TIMESTAMP(CURDATE(), cs.end_time)
          AND NOW() <= DATE_ADD(TIMESTAMP(CURDATE(), cs.end_time), INTERVAL 15 MINUTE)
      )
  )
  {$scopeSql}
ORDER BY r.room_id ASC, is_active DESC, cs.start_time DESC";

$result = $mysqli->query($sql);
if (!$result) {
    error_log('3d-room-presence query failed: ' . $mysqli->error);
    json_response(['error' => 'presence_query_failed', 'message' => 'Unable to load live room presence.'], 500);
}

$byRoom = [];
while ($row = $result->fetch_assoc()) {
    $roomId = (int)$row['room_id'];
    if (isset($byRoom[$roomId])) continue;

    $hasSubstitute = !empty($row['substitution_id']) && !empty($row['substitute_user_id']);
    $hasLeave = !$hasSubstitute && !empty($row['leave_id']);
    $teacherId = $hasSubstitute ? (int)$row['substitute_user_id'] : (int)$row['original_teacher_id'];
    $teacherName = trim((string)($hasSubstitute ? $row['substitute_teacher_name'] : $row['original_teacher_name']));
    $flagIn = (int)($hasSubstitute ? ($row['substitute_flag_in_id'] ?? 1) : ($row['flag_in_id'] ?? 1));
    $attendanceStatus = tdb_presence_status($flagIn);
    $displayStatus = $hasSubstitute ? 'SUBSTITUTED' : ($hasLeave ? 'ON_LEAVE' : $attendanceStatus);

    $byRoom[$roomId] = [
        'room_id' => $roomId,
        'room_name' => (string)$row['room_name'],
        'building_name' => (string)$row['building_name'],
        'floor_name' => (string)($row['floor_name'] ?? ''),
        'schedule_id' => (int)$row['schedule_id'],
        'semester_id' => isset($row['semester_id']) ? (int)$row['semester_id'] : null,
        'subject_id' => isset($row['subject_id']) ? (int)$row['subject_id'] : null,
        'teacher_id' => $teacherId,
        'teacher_name' => $teacherName !== '' ? $teacherName : 'Teacher',
        'avatar_url' => tdb_presence_thumbnail_url($teacherId),
        'status' => $displayStatus,
        'attendance_status' => $attendanceStatus,
        'flag_in_id' => $flagIn,
        'flag_check_id' => isset($row[$hasSubstitute ? 'substitute_flag_check_id' : 'flag_check_id']) ? (int)$row[$hasSubstitute ? 'substitute_flag_check_id' : 'flag_check_id'] : null,
        'flag_out_id' => isset($row[$hasSubstitute ? 'substitute_flag_out_id' : 'flag_out_id']) ? (int)$row[$hasSubstitute ? 'substitute_flag_out_id' : 'flag_out_id'] : null,
        'time_in' => $row[$hasSubstitute ? 'substitute_checked_in_at' : 'checked_in_at'] ?: null,
        'time_check' => $row[$hasSubstitute ? 'substitute_checked_mid_at' : 'checked_mid_at'] ?: null,
        'time_out' => $row[$hasSubstitute ? 'substitute_checked_out_at' : 'checked_out_at'] ?: null,
        'subject' => trim((string)($row['subject_code'] ?? '') . ' ' . (string)($row['subject_name'] ?? '')),
        'section_name' => (string)($row['section_name'] ?? ''),
        'start_time' => (string)$row['start_time'],
        'end_time' => (string)$row['end_time'],
        'is_active' => (bool)$row['is_active'],
        'is_substitute' => $hasSubstitute,
        'original_teacher_id' => (int)$row['original_teacher_id'],
        'original_teacher_name' => trim((string)$row['original_teacher_name']),
        'department_id' => isset($row['dept_id']) ? (int)$row['dept_id'] : null,
        'department_name' => (string)($row['dept_name'] ?? ''),
        'leave_type' => $hasLeave ? (string)($row['leave_type'] ?? 'Approved Leave') : null,
        'leave_reason' => $hasLeave ? (string)($row['leave_reason'] ?? '') : null,
        '_parallel_key' => implode('|', [
            (string)$row['original_teacher_id'],
            (string)($row['semester_id'] ?? ''),
            (string)($row['subject_id'] ?? ''),
            substr((string)$row['start_time'], 0, 5),
            substr((string)$row['end_time'], 0, 5),
        ]),
    ];
}
$result->free();

$parallelGroups = [];
$parallelTeacherIds = array_values(array_unique(array_filter(array_map(function ($marker) {
    return (int)($marker['original_teacher_id'] ?? 0);
}, array_values($byRoom)))));
if (!empty($parallelTeacherIds)) {
    $parallelSql = "SELECT
        {$teacherExpr} AS original_teacher_id,
        cs.semester_id,
        {$subjectExpr} AS subject_id,
        cs.start_time,
        cs.end_time,
        r.room_name
      FROM tbl_class_schedules cs
      JOIN tbl_rooms r ON r.room_id = cs.room_id
      {$joinOffering}
      LEFT JOIN tbl_semesters sem ON sem.semester_id = cs.semester_id
      WHERE {$teacherExpr} IN (" . implode(',', array_map('intval', $parallelTeacherIds)) . ")
        AND LOWER(cs.day_of_week) = LOWER(DAYNAME(CURDATE()))
        AND (sem.semester_id IS NULL OR CURDATE() BETWEEN sem.start_date AND sem.end_date)";
    $parallelResult = $mysqli->query($parallelSql);
    if ($parallelResult) {
        while ($parallelRow = $parallelResult->fetch_assoc()) {
            $parallelKey = implode('|', [
                (string)$parallelRow['original_teacher_id'],
                (string)($parallelRow['semester_id'] ?? ''),
                (string)($parallelRow['subject_id'] ?? ''),
                substr((string)$parallelRow['start_time'], 0, 5),
                substr((string)$parallelRow['end_time'], 0, 5),
            ]);
            $parallelGroups[$parallelKey][] = (string)$parallelRow['room_name'];
        }
        $parallelResult->free();
    }
}
foreach ($byRoom as $marker) {
    if (!isset($parallelGroups[$marker['_parallel_key']])) {
        $parallelGroups[$marker['_parallel_key']] = [(string)$marker['room_name']];
    }
}
$markers = [];
foreach (array_values($byRoom) as $marker) {
    $parallelRooms = array_values(array_unique($parallelGroups[$marker['_parallel_key']] ?? []));
    $marker['parallel_count'] = count($parallelRooms);
    $marker['parallel_rooms'] = $parallelRooms;
    $marker['is_parallel'] = count($parallelRooms) > 1;
    unset($marker['_parallel_key']);
    $markers[] = $marker;
}
$versionPayload = json_encode($markers, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
header('Cache-Control: no-store');
json_response([
    'building_code' => $buildingCode,
    'generated_at' => date(DATE_ATOM),
    'version' => sha1($versionPayload ?: '[]'),
    'markers' => $markers,
]);
