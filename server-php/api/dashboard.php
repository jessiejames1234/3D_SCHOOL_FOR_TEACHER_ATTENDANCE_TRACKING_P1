<?php
// server-php/api/dashboard.php
require_once __DIR__ . '/../helpers/socket_helper.php';

if (!isset($GLOBALS['mysqli']) || $GLOBALS['mysqli'] === null) {
    if (file_exists(__DIR__ . '/../config/database.php')) {
        require_once __DIR__ . '/../config/database.php';
    }
}

if (!function_exists('json_response')) {
    require_once __DIR__ . '/../helpers/functions.php';
}

global $mysqli;

$request_method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$path = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH);
$parts = explode('/', (string)$path);
$api_prefix_key = array_search('api', $parts, true);
$param1 = ($api_prefix_key !== false) ? ($parts[$api_prefix_key + 2] ?? null) : null;

function dashboard_get_auth_context(): array {
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

    if (empty($authHeader) || !preg_match('/Bearer\s+(\S+)/i', (string)$authHeader, $m)) {
        return ['user_id' => null, 'role_id' => null];
    }

    $token = $m[1];
    $sec = [];
    if (file_exists(__DIR__ . '/../config/security.php')) {
        $sec = require __DIR__ . '/../config/security.php';
    }
    $secret_key = $sec['jwt_secret'] ?? 'your-secret-key';

    try {
        $decoded = \Firebase\JWT\JWT::decode($token, new \Firebase\JWT\Key($secret_key, 'HS256'));
        return [
            'user_id' => isset($decoded->user_id) ? (int)$decoded->user_id : null,
            'role_id' => isset($decoded->role_id) ? (int)$decoded->role_id : null,
        ];
    } catch (Throwable $e) {
        return ['user_id' => null, 'role_id' => null];
    }
}

function dashboard_table_exists($mysqli, $table) {
    $table = preg_replace('/[^a-zA-Z0-9_]/', '', (string)$table);
    if ($table === '') return false;
    $safe = $mysqli->real_escape_string($table);
    $res = $mysqli->query("SHOW TABLES LIKE '{$safe}'");
    return $res && (int)$res->num_rows > 0;
}

function dashboard_column_exists($mysqli, $table, $column) {
    $table = preg_replace('/[^a-zA-Z0-9_]/', '', (string)$table);
    $column = preg_replace('/[^a-zA-Z0-9_]/', '', (string)$column);
    if ($table === '' || $column === '') return false;
    $safeColumn = $mysqli->real_escape_string($column);
    $res = $mysqli->query("SHOW COLUMNS FROM `$table` LIKE '{$safeColumn}'");
    return $res && (int)$res->num_rows > 0;
}

function dashboard_db_fetch_one($mysqli, $sql) {
    $result = $mysqli->query($sql);
    if (!$result) {
        error_log('[dashboard] query failed: ' . $mysqli->error . ' SQL=' . $sql);
        return [];
    }
    $row = $result->fetch_assoc();
    return is_array($row) ? $row : [];
}

function dashboard_db_fetch_all($mysqli, $sql) {
    $result = $mysqli->query($sql);
    if (!$result) {
        error_log('[dashboard] query failed: ' . $mysqli->error . ' SQL=' . $sql);
        return [];
    }
    return $result->fetch_all(MYSQLI_ASSOC);
}

function dashboard_to_int($value) {
    return is_numeric($value) ? (int)$value : 0;
}

function dashboard_cast_int_fields(array $rows, array $fields): array {
    foreach ($rows as &$row) {
        foreach ($fields as $field) {
            if (array_key_exists($field, $row)) {
                $row[$field] = dashboard_to_int($row[$field]);
            }
        }
    }
    unset($row);
    return $rows;
}

function dashboard_user_active_condition(string $alias = 'u'): string {
    $prefix = trim($alias) !== '' ? trim($alias) . '.' : '';
    // Supports enum('active', ...) and legacy numeric status fields.
    return "({$prefix}status = 'active' OR {$prefix}status = 1 OR {$prefix}status = '1')";
}

function dashboard_teacher_condition(bool $hasRolesTable, string $userAlias = 'u', string $roleAlias = 'ro'): string {
    if ($hasRolesTable) {
        return "(LOWER(COALESCE({$roleAlias}.role_name, '')) = 'teacher' OR {$userAlias}.role_id = 5)";
    }
    return "{$userAlias}.role_id = 5";
}

function dashboard_sql_int_list(array $values): string {
    $ints = [];
    foreach ($values as $v) {
        if ($v === null || $v === '') continue;
        $ints[] = (int)$v;
    }
    if (empty($ints)) return '0';
    return implode(',', array_values(array_unique($ints)));
}

function dashboard_apply_user_scope(string $template, string $alias): string {
    $alias = preg_replace('/[^a-zA-Z0-9_]/', '', $alias);
    if ($alias === '') $alias = 'u';
    $tpl = trim($template);
    if ($tpl === '') return '1=1';
    return str_replace('{u}', $alias, $tpl);
}

function dashboard_build_summary($mysqli, array $expr, $finalFlagExpr, string $scopeUserTemplate, bool $restrictAttendanceByUser, array $meta = []) {
    $summary_query = "SELECT
        {$expr['departments']} AS total_departments,
        {$expr['programs']} AS total_programs,
        {$expr['sections']} AS total_sections,
        {$expr['semesters']} AS total_semesters,
        {$expr['subjects']} AS total_subjects,
        {$expr['offerings']} AS total_offerings,
        {$expr['rooms']} AS total_rooms,
        {$expr['teachers']} AS total_teachers";
    $summary_counts = dashboard_db_fetch_one($mysqli, $summary_query);

    $attendanceJoin = '';
    $attendanceWhereScope = '';
    if ($restrictAttendanceByUser) {
        $attendanceJoin = " JOIN tbl_users us ON ar.user_id = us.user_id ";
        $attendanceWhereScope = " AND (" . dashboard_apply_user_scope($scopeUserTemplate, 'us') . ")";
    }

    $attendanceDate = date('Y-m-d');
    $attendanceIsFallback = false;

    $attendance_today_row = dashboard_db_fetch_one(
        $mysqli,
        "SELECT
            COUNT(*) AS total_records,
            SUM(ar.checked_in_at IS NOT NULL) AS checked_in,
            SUM(ar.checked_mid_at IS NOT NULL) AS checked_mid,
            SUM(ar.checked_out_at IS NOT NULL) AS checked_out,
            SUM(({$finalFlagExpr}) = 2) AS present,
            SUM(({$finalFlagExpr}) = 3) AS absent,
            SUM(({$finalFlagExpr}) = 5) AS late,
            SUM(({$finalFlagExpr}) = 4) AS substituted,
            SUM(({$finalFlagExpr}) = 7) AS on_leave,
            SUM(({$finalFlagExpr}) = 1) AS na
         FROM tbl_attendance_records ar
         {$attendanceJoin}
         WHERE ar.date = CURDATE()
         {$attendanceWhereScope}"
    );

    $todayTotalRecords = dashboard_to_int($attendance_today_row['total_records'] ?? 0);
    if ($todayTotalRecords === 0) {
        $latestDateRow = dashboard_db_fetch_one(
            $mysqli,
            "SELECT DATE_FORMAT(MAX(ar.date), '%Y-%m-%d') AS latest_date
             FROM tbl_attendance_records ar
             {$attendanceJoin}
             WHERE 1=1
             AND ar.date <= CURDATE()
             {$attendanceWhereScope}"
        );

        $latestDate = trim((string)($latestDateRow['latest_date'] ?? ''));
        if ($latestDate !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $latestDate)) {
            $safeLatestDate = $mysqli->real_escape_string($latestDate);
            $latestRow = dashboard_db_fetch_one(
                $mysqli,
                "SELECT
                    COUNT(*) AS total_records,
                    SUM(ar.checked_in_at IS NOT NULL) AS checked_in,
                    SUM(ar.checked_mid_at IS NOT NULL) AS checked_mid,
                    SUM(ar.checked_out_at IS NOT NULL) AS checked_out,
                    SUM(({$finalFlagExpr}) = 2) AS present,
                    SUM(({$finalFlagExpr}) = 3) AS absent,
                    SUM(({$finalFlagExpr}) = 5) AS late,
                    SUM(({$finalFlagExpr}) = 4) AS substituted,
                    SUM(({$finalFlagExpr}) = 7) AS on_leave,
                    SUM(({$finalFlagExpr}) = 1) AS na
                 FROM tbl_attendance_records ar
                 {$attendanceJoin}
                 WHERE ar.date = '{$safeLatestDate}'
                 {$attendanceWhereScope}"
            );
            if (!empty($latestRow)) {
                $attendance_today_row = $latestRow;
                $attendanceDate = $latestDate;
                $attendanceIsFallback = true;
            }
        }
    }

    $response = [
        'total_departments' => dashboard_to_int($summary_counts['total_departments'] ?? 0),
        'total_programs' => dashboard_to_int($summary_counts['total_programs'] ?? 0),
        'total_sections' => dashboard_to_int($summary_counts['total_sections'] ?? 0),
        'total_semesters' => dashboard_to_int($summary_counts['total_semesters'] ?? 0),
        'total_subjects' => dashboard_to_int($summary_counts['total_subjects'] ?? 0),
        'total_offerings' => dashboard_to_int($summary_counts['total_offerings'] ?? 0),
        'total_rooms' => dashboard_to_int($summary_counts['total_rooms'] ?? 0),
        'total_teachers' => dashboard_to_int($summary_counts['total_teachers'] ?? 0),
        'attendance_today' => [
            'date' => $attendanceDate,
            'is_fallback' => $attendanceIsFallback,
            'total_records' => dashboard_to_int($attendance_today_row['total_records'] ?? 0),
            'checked_in' => dashboard_to_int($attendance_today_row['checked_in'] ?? 0),
            'checked_mid' => dashboard_to_int($attendance_today_row['checked_mid'] ?? 0),
            'checked_out' => dashboard_to_int($attendance_today_row['checked_out'] ?? 0),
            'present' => dashboard_to_int($attendance_today_row['present'] ?? 0),
            'absent' => dashboard_to_int($attendance_today_row['absent'] ?? 0),
            'late' => dashboard_to_int($attendance_today_row['late'] ?? 0),
            'substituted' => dashboard_to_int($attendance_today_row['substituted'] ?? 0),
            'on_leave' => dashboard_to_int($attendance_today_row['on_leave'] ?? 0),
            'na' => dashboard_to_int($attendance_today_row['na'] ?? 0),
        ],
    ];

    if (!empty($meta)) {
        $response['meta'] = $meta;
    }

    return $response;
}

if ($request_method !== 'GET') {
    json_response(['error' => 'Invalid request method for dashboard.'], 405);
}

$dashboardScope = strtolower(trim((string)($_GET['scope'] ?? '')));
app_require_module_access(
    $mysqli,
    $dashboardScope === 'self' ? ['any_of' => ['dashboard', 'faculty_dashboard']] : 'dashboard'
);

$hasRolesTable = dashboard_table_exists($mysqli, 'tbl_roles');
$hasSubjectOfferings = dashboard_table_exists($mysqli, 'tbl_subject_offerings');
$csHasOffering = dashboard_column_exists($mysqli, 'tbl_class_schedules', 'offering_id');
$csHasSubject = dashboard_column_exists($mysqli, 'tbl_class_schedules', 'subject_id');
$csHasSection = dashboard_column_exists($mysqli, 'tbl_class_schedules', 'section_id');
$soHasSubject = $hasSubjectOfferings ? dashboard_column_exists($mysqli, 'tbl_subject_offerings', 'subject_id') : false;

$joinOffering = ($hasSubjectOfferings && $csHasOffering)
    ? "LEFT JOIN tbl_subject_offerings so ON cs.offering_id = so.offering_id"
    : "";
$subjectExpr = $csHasSubject
    ? 'cs.subject_id'
    : (($hasSubjectOfferings && $csHasOffering && $soHasSubject) ? 'so.subject_id' : 'NULL');
$sectionJoin = $csHasSection ? "LEFT JOIN tbl_sections sec ON cs.section_id = sec.section_id" : "";
$sectionSelect = $csHasSection ? "sec.section_name" : "NULL AS section_name";

$offeringsCountExpr = $hasSubjectOfferings ? "(SELECT COUNT(*) FROM tbl_subject_offerings)" : "0";
$teacherJoin = $hasRolesTable ? "LEFT JOIN tbl_roles ro ON u.role_id = ro.role_id" : "";
$teacherCondition = dashboard_teacher_condition($hasRolesTable, 'u', 'ro');
$activeUserCondition = dashboard_user_active_condition('u');
$teacherCountExpr = "(SELECT COUNT(*) FROM tbl_users u {$teacherJoin} WHERE {$teacherCondition} AND {$activeUserCondition})";

// Prioritize out -> check -> in; ignore NA(1) whenever a non-NA flag exists.
$finalFlagExpr = "COALESCE(NULLIF(ar.flag_out_id, 1), NULLIF(ar.flag_check_id, 1), NULLIF(ar.flag_in_id, 1), 1)";

$auth = dashboard_get_auth_context();
$authUserId = isset($auth['user_id']) ? (int)$auth['user_id'] : null;
$authRole = isset($auth['role_id']) ? (int)$auth['role_id'] : null;
if (!$authUserId) {
    json_response(['error' => 'unauthorized', 'message' => 'Authentication required'], 401);
}

$authUser = dashboard_db_fetch_one(
    $mysqli,
    "SELECT u.user_id, u.role_id, u.dept_id, u.assigned_program_head_id, d.dept_name
     FROM tbl_users u
     LEFT JOIN tbl_departments d ON u.dept_id = d.dept_id
     WHERE u.user_id = " . (int)$authUserId . "
     LIMIT 1"
);
if (empty($authUser)) {
    json_response(['error' => 'unauthorized', 'message' => 'Authenticated user not found'], 401);
}
if (!$authRole) {
    $authRole = (int)($authUser['role_id'] ?? 0);
}

$authDeptId = isset($authUser['dept_id']) && $authUser['dept_id'] !== null ? (int)$authUser['dept_id'] : null;
$authDeptName = (string)($authUser['dept_name'] ?? '');
$authAssignedProgramId = isset($authUser['assigned_program_head_id']) && $authUser['assigned_program_head_id'] !== null
    ? (int)$authUser['assigned_program_head_id']
    : null;
$requestedScope = strtolower(trim((string)($_GET['scope'] ?? 'managed')));
$forceSelfScope = in_array($requestedScope, ['self', 'my', 'personal'], true);

$programRowsForHead = [];
if ($authRole === 3) {
    $programRowsForHead = dashboard_db_fetch_all(
        $mysqli,
        "SELECT p.program_id, p.program_name, p.dept_id
         FROM tbl_programs p
         WHERE p.head_id = " . (int)$authUserId . "
         ORDER BY p.program_id ASC"
    );
}

$scopeProgramIds = [];
$scopeProgramNames = [];
$scopeProgramDeptId = null;
foreach ($programRowsForHead as $pr) {
    $pid = isset($pr['program_id']) ? (int)$pr['program_id'] : 0;
    if ($pid <= 0) continue;
    $scopeProgramIds[] = $pid;
    $scopeProgramNames[] = (string)($pr['program_name'] ?? ('Program ' . $pid));
    if ($scopeProgramDeptId === null && isset($pr['dept_id']) && $pr['dept_id'] !== null) {
        $scopeProgramDeptId = (int)$pr['dept_id'];
    }
}

if (empty($scopeProgramIds) && $authAssignedProgramId) {
    $fallbackProgram = dashboard_db_fetch_one(
        $mysqli,
        "SELECT p.program_id, p.program_name, p.dept_id
         FROM tbl_programs p
         WHERE p.program_id = " . (int)$authAssignedProgramId . "
         LIMIT 1"
    );
    if (!empty($fallbackProgram)) {
        $scopeProgramIds[] = (int)$fallbackProgram['program_id'];
        $scopeProgramNames[] = (string)($fallbackProgram['program_name'] ?? ('Program ' . (int)$fallbackProgram['program_id']));
        if ($scopeProgramDeptId === null && isset($fallbackProgram['dept_id']) && $fallbackProgram['dept_id'] !== null) {
            $scopeProgramDeptId = (int)$fallbackProgram['dept_id'];
        }
    }
}

$programIdsSql = dashboard_sql_int_list($scopeProgramIds);
$primaryProgramName = !empty($scopeProgramNames) ? $scopeProgramNames[0] : '';
$scopedDeptId = $authDeptId ?: $scopeProgramDeptId;
if ($scopedDeptId && $authDeptName === '') {
    $deptRow = dashboard_db_fetch_one($mysqli, "SELECT dept_name FROM tbl_departments WHERE dept_id = " . (int)$scopedDeptId . " LIMIT 1");
    $authDeptName = (string)($deptRow['dept_name'] ?? '');
}

$scopeUserTemplate = '1=1';
$restrictAttendanceByUser = false;
$summaryMeta = [
    'teacher_label' => 'Teachers',
    'department_display' => null,
    'program_display' => null,
    'scope' => 'managed',
];

$departmentsCountExpr = "(SELECT COUNT(*) FROM tbl_departments)";
$programsCountExpr = "(SELECT COUNT(*) FROM tbl_programs)";
$sectionsCountExpr = "(SELECT COUNT(*) FROM tbl_sections)";
$semestersCountExpr = "(SELECT COUNT(*) FROM tbl_semesters)";
$subjectsCountExpr = "(SELECT COUNT(*) FROM tbl_subject)";
$roomsCountExpr = "(SELECT COUNT(*) FROM tbl_rooms)";

$departmentWhereSql = '';
$programWhereSql = '';
$sectionsWhereSql = '';
$subjectsWhereSql = '';
$teachersWhereSql = "{$teacherCondition} AND {$activeUserCondition}";
$offeringsWhereSql = '';

if ($authRole === 1) {
    $teacherCountExpr = "(SELECT COUNT(*) FROM tbl_users u WHERE {$activeUserCondition})";
    $summaryMeta['teacher_label'] = 'Users';
} elseif ($forceSelfScope && in_array($authRole, [2, 3, 4, 5], true)) {
    $summaryMeta['teacher_label'] = 'My Records';
    $summaryMeta['scope'] = 'self';
    $summaryMeta['department_display'] = $authDeptName !== '' ? $authDeptName : null;
    if ($primaryProgramName !== '') {
        $summaryMeta['program_display'] = $primaryProgramName;
    }
    $teacherCountExpr = "(SELECT COUNT(*) FROM tbl_users u WHERE {$activeUserCondition} AND u.user_id = " . (int)$authUserId . ")";
    $scopeUserTemplate = "({u}.user_id = " . (int)$authUserId . ")";
    $restrictAttendanceByUser = true;
    if ($scopedDeptId) {
        $departmentsCountExpr = "(SELECT COUNT(*) FROM tbl_departments d WHERE d.dept_id = " . (int)$scopedDeptId . ")";
        $departmentWhereSql = " WHERE d.dept_id = " . (int)$scopedDeptId . " ";
    } else {
        $departmentsCountExpr = "0";
    }
    if (!empty($scopeProgramIds)) {
        $programsCountExpr = "(SELECT COUNT(*) FROM tbl_programs p WHERE p.program_id IN ({$programIdsSql}))";
        $sectionsCountExpr = "(SELECT COUNT(*) FROM tbl_sections sec WHERE sec.program_id IN ({$programIdsSql}))";
        $subjectsCountExpr = "(SELECT COUNT(*) FROM tbl_subject s WHERE s.program_id IN ({$programIdsSql}))";
        $programWhereSql = " WHERE p.program_id IN ({$programIdsSql}) ";
        $sectionsWhereSql = " WHERE sec.program_id IN ({$programIdsSql}) ";
        $subjectsWhereSql = " WHERE s.program_id IN ({$programIdsSql}) ";
        $offeringsWhereSql = " WHERE p.program_id IN ({$programIdsSql}) ";
    } else {
        $programsCountExpr = "0";
        $sectionsCountExpr = "0";
        $subjectsCountExpr = "0";
    }
    $teachersWhereSql = "{$activeUserCondition} AND u.user_id = " . (int)$authUserId;
} elseif ($authRole === 2 && $scopedDeptId) {
    $summaryMeta['teacher_label'] = 'People';
    $summaryMeta['department_display'] = $authDeptName !== '' ? $authDeptName : ('Department #' . (int)$scopedDeptId);
    $departmentsCountExpr = "(SELECT COUNT(*) FROM tbl_departments d WHERE d.dept_id = " . (int)$scopedDeptId . ")";
    $programsCountExpr = "(SELECT COUNT(*) FROM tbl_programs p WHERE p.dept_id = " . (int)$scopedDeptId . ")";
    $sectionsCountExpr = "(SELECT COUNT(*) FROM tbl_sections sec JOIN tbl_programs p ON sec.program_id = p.program_id WHERE p.dept_id = " . (int)$scopedDeptId . ")";
    $subjectsCountExpr = "(SELECT COUNT(*) FROM tbl_subject s JOIN tbl_programs p ON s.program_id = p.program_id WHERE p.dept_id = " . (int)$scopedDeptId . ")";
    $teacherCountExpr = "(SELECT COUNT(*) FROM tbl_users u WHERE {$activeUserCondition} AND u.dept_id = " . (int)$scopedDeptId . " AND u.role_id IN (3,4,5))";
    $scopeUserTemplate = "({u}.dept_id = " . (int)$scopedDeptId . " AND {u}.role_id IN (3,4,5))";
    $restrictAttendanceByUser = true;
    $departmentWhereSql = " WHERE d.dept_id = " . (int)$scopedDeptId . " ";
    $programWhereSql = " WHERE p.dept_id = " . (int)$scopedDeptId . " ";
    $sectionsWhereSql = " WHERE p.dept_id = " . (int)$scopedDeptId . " ";
    $subjectsWhereSql = " WHERE p.dept_id = " . (int)$scopedDeptId . " ";
    $teachersWhereSql = "{$activeUserCondition} AND u.dept_id = " . (int)$scopedDeptId . " AND u.role_id IN (3,4,5)";
    $offeringsWhereSql = " WHERE p.dept_id = " . (int)$scopedDeptId . " ";
} elseif ($authRole === 4 && $scopedDeptId) {
    $summaryMeta['teacher_label'] = 'Teachers';
    $summaryMeta['department_display'] = $authDeptName !== '' ? $authDeptName : ('Department #' . (int)$scopedDeptId);
    $departmentsCountExpr = "(SELECT COUNT(*) FROM tbl_departments d WHERE d.dept_id = " . (int)$scopedDeptId . ")";
    $programsCountExpr = "(SELECT COUNT(*) FROM tbl_programs p WHERE p.dept_id = " . (int)$scopedDeptId . ")";
    $sectionsCountExpr = "(SELECT COUNT(*) FROM tbl_sections sec JOIN tbl_programs p ON sec.program_id = p.program_id WHERE p.dept_id = " . (int)$scopedDeptId . ")";
    $subjectsCountExpr = "(SELECT COUNT(*) FROM tbl_subject s JOIN tbl_programs p ON s.program_id = p.program_id WHERE p.dept_id = " . (int)$scopedDeptId . ")";
    $teacherCountExpr = "(SELECT COUNT(*) FROM tbl_users u WHERE {$activeUserCondition} AND u.dept_id = " . (int)$scopedDeptId . " AND u.role_id = 5)";
    $scopeUserTemplate = "({u}.dept_id = " . (int)$scopedDeptId . " AND {u}.role_id = 5)";
    $restrictAttendanceByUser = true;
    $departmentWhereSql = " WHERE d.dept_id = " . (int)$scopedDeptId . " ";
    $programWhereSql = " WHERE p.dept_id = " . (int)$scopedDeptId . " ";
    $sectionsWhereSql = " WHERE p.dept_id = " . (int)$scopedDeptId . " ";
    $subjectsWhereSql = " WHERE p.dept_id = " . (int)$scopedDeptId . " ";
    $teachersWhereSql = "{$activeUserCondition} AND u.dept_id = " . (int)$scopedDeptId . " AND u.role_id = 5";
    $offeringsWhereSql = " WHERE p.dept_id = " . (int)$scopedDeptId . " ";
} elseif ($authRole === 3 && !empty($scopeProgramIds)) {
    $summaryMeta['teacher_label'] = 'People';
    $summaryMeta['department_display'] = $authDeptName !== '' ? $authDeptName : ($scopedDeptId ? ('Department #' . (int)$scopedDeptId) : null);
    $summaryMeta['program_display'] = implode(', ', $scopeProgramNames);
    $departmentsCountExpr = $scopedDeptId ? "(SELECT COUNT(*) FROM tbl_departments d WHERE d.dept_id = " . (int)$scopedDeptId . ")" : "0";
    $programsCountExpr = "(SELECT COUNT(*) FROM tbl_programs p WHERE p.program_id IN ({$programIdsSql}))";
    $sectionsCountExpr = "(SELECT COUNT(*) FROM tbl_sections sec WHERE sec.program_id IN ({$programIdsSql}))";
    $subjectsCountExpr = "(SELECT COUNT(*) FROM tbl_subject s WHERE s.program_id IN ({$programIdsSql}))";
    $programTeacherCondTpl = "({u}.role_id = 5 AND {u}.assigned_program_head_id IN ({$programIdsSql}))";
    $programSecretaryCondTpl = $scopedDeptId
        ? "({u}.role_id = 4 AND ({u}.assigned_program_head_id IN ({$programIdsSql}) OR {u}.dept_id = " . (int)$scopedDeptId . "))"
        : "({u}.role_id = 4 AND {u}.assigned_program_head_id IN ({$programIdsSql}))";
    $scopeUserTemplate = "({$programTeacherCondTpl} OR {$programSecretaryCondTpl})";
    $programPeopleCondSql = dashboard_apply_user_scope($scopeUserTemplate, 'u');
    $teacherCountExpr = "(SELECT COUNT(*) FROM tbl_users u WHERE {$activeUserCondition} AND {$programPeopleCondSql})";
    $restrictAttendanceByUser = true;
    $departmentWhereSql = $scopedDeptId ? " WHERE d.dept_id = " . (int)$scopedDeptId . " " : '';
    $programWhereSql = " WHERE p.program_id IN ({$programIdsSql}) ";
    $sectionsWhereSql = " WHERE sec.program_id IN ({$programIdsSql}) ";
    $subjectsWhereSql = " WHERE s.program_id IN ({$programIdsSql}) ";
    $teachersWhereSql = "{$activeUserCondition} AND {$programPeopleCondSql}";
    $offeringsWhereSql = " WHERE p.program_id IN ({$programIdsSql}) ";
} else {
    $summaryMeta['teacher_label'] = 'Teachers';
    $summaryMeta['department_display'] = $authDeptName !== '' ? $authDeptName : null;
    if ($primaryProgramName !== '') {
        $summaryMeta['program_display'] = $primaryProgramName;
    }
    $teacherCountExpr = "(SELECT COUNT(*) FROM tbl_users u WHERE {$activeUserCondition} AND u.user_id = " . (int)$authUserId . ")";
    $scopeUserTemplate = "({u}.user_id = " . (int)$authUserId . ")";
    $restrictAttendanceByUser = true;
    if ($scopedDeptId) {
        $departmentsCountExpr = "(SELECT COUNT(*) FROM tbl_departments d WHERE d.dept_id = " . (int)$scopedDeptId . ")";
        $departmentWhereSql = " WHERE d.dept_id = " . (int)$scopedDeptId . " ";
    } else {
        $departmentsCountExpr = "0";
    }
    if (!empty($scopeProgramIds)) {
        $programsCountExpr = "(SELECT COUNT(*) FROM tbl_programs p WHERE p.program_id IN ({$programIdsSql}))";
        $sectionsCountExpr = "(SELECT COUNT(*) FROM tbl_sections sec WHERE sec.program_id IN ({$programIdsSql}))";
        $subjectsCountExpr = "(SELECT COUNT(*) FROM tbl_subject s WHERE s.program_id IN ({$programIdsSql}))";
        $programWhereSql = " WHERE p.program_id IN ({$programIdsSql}) ";
        $sectionsWhereSql = " WHERE sec.program_id IN ({$programIdsSql}) ";
        $subjectsWhereSql = " WHERE s.program_id IN ({$programIdsSql}) ";
        $offeringsWhereSql = " WHERE p.program_id IN ({$programIdsSql}) ";
    } else {
        $programsCountExpr = "0";
        $sectionsCountExpr = "0";
        $subjectsCountExpr = "0";
    }
    $teachersWhereSql = "{$activeUserCondition} AND u.user_id = " . (int)$authUserId;
}

if ($hasSubjectOfferings && trim($offeringsWhereSql) !== '') {
    $offeringsCountExpr = "(SELECT COUNT(*) FROM tbl_subject_offerings so LEFT JOIN tbl_subject s ON so.subject_id = s.subject_id LEFT JOIN tbl_programs p ON s.program_id = p.program_id {$offeringsWhereSql})";
} elseif (!$hasSubjectOfferings && trim($offeringsWhereSql) !== '') {
    $offeringsCountExpr = "(SELECT COUNT(DISTINCT cs.schedule_id) FROM tbl_class_schedules cs LEFT JOIN tbl_subject s ON cs.subject_id = s.subject_id LEFT JOIN tbl_programs p ON s.program_id = p.program_id {$offeringsWhereSql})";
}

$summaryExpr = [
    'departments' => $departmentsCountExpr,
    'programs' => $programsCountExpr,
    'sections' => $sectionsCountExpr,
    'semesters' => $semestersCountExpr,
    'subjects' => $subjectsCountExpr,
    'offerings' => $offeringsCountExpr,
    'rooms' => $roomsCountExpr,
    'teachers' => $teacherCountExpr,
];

if ($param1 === 'summary') {
    json_response(dashboard_build_summary($mysqli, $summaryExpr, $finalFlagExpr, $scopeUserTemplate, $restrictAttendanceByUser, $summaryMeta));
}

if ($param1 === null || $param1 === '' || $param1 === 'full') {
    $summary_response = dashboard_build_summary($mysqli, $summaryExpr, $finalFlagExpr, $scopeUserTemplate, $restrictAttendanceByUser, $summaryMeta);
    $snapshotDate = trim((string)($summary_response['attendance_today']['date'] ?? date('Y-m-d')));
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $snapshotDate)) {
        $snapshotDate = date('Y-m-d');
    }
    $snapshotDateSql = $mysqli->real_escape_string($snapshotDate);

    $departments = dashboard_db_fetch_all($mysqli, "SELECT d.dept_id, d.dept_name FROM tbl_departments d {$departmentWhereSql} ORDER BY d.dept_name");
    $programs = dashboard_db_fetch_all($mysqli, "SELECT p.program_id, p.program_name, p.dept_id FROM tbl_programs p {$programWhereSql} ORDER BY p.program_name");
    $sections = dashboard_db_fetch_all(
        $mysqli,
        "SELECT sec.section_id, sec.section_name, sec.program_id
         FROM tbl_sections sec
         LEFT JOIN tbl_programs p ON sec.program_id = p.program_id
         {$sectionsWhereSql}
         ORDER BY sec.section_name"
    );
    $semesters = dashboard_db_fetch_all($mysqli, "SELECT semester_id, term, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date, DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date FROM tbl_semesters ORDER BY start_date DESC");
    $subjects = dashboard_db_fetch_all(
        $mysqli,
        "SELECT s.subject_id, s.subject_code, s.subject_name, s.program_id
         FROM tbl_subject s
         LEFT JOIN tbl_programs p ON s.program_id = p.program_id
         {$subjectsWhereSql}
         ORDER BY s.subject_code"
    );

    if ($hasSubjectOfferings) {
        $offerings = dashboard_db_fetch_all(
            $mysqli,
            'SELECT so.offering_id, so.semester_id, so.section_id, so.subject_id, so.user_id, s.subject_code, s.subject_name, sec.section_name
             FROM tbl_subject_offerings so
             LEFT JOIN tbl_subject s ON so.subject_id = s.subject_id
             LEFT JOIN tbl_sections sec ON so.section_id = sec.section_id
             LEFT JOIN tbl_programs p ON s.program_id = p.program_id
             ' . $offeringsWhereSql . '
             ORDER BY s.subject_code, sec.section_name'
        );
    } else {
        $offeringsSubjectSelect = $csHasSubject ? 'cs.subject_id' : 'NULL AS subject_id';
        $offeringsSectionSelect = $csHasSection ? 'cs.section_id' : 'NULL AS section_id';
        $offeringsSubjectJoin = $csHasSubject ? 'LEFT JOIN tbl_subject s ON cs.subject_id = s.subject_id' : 'LEFT JOIN tbl_subject s ON 1=0';
        $offeringsSectionJoin = $csHasSection ? 'LEFT JOIN tbl_sections sec ON cs.section_id = sec.section_id' : 'LEFT JOIN tbl_sections sec ON 1=0';

        $offerings = dashboard_db_fetch_all(
            $mysqli,
            "SELECT DISTINCT
                NULL AS offering_id,
                cs.semester_id,
                {$offeringsSectionSelect},
                {$offeringsSubjectSelect},
                cs.user_id,
                s.subject_code,
                s.subject_name,
                sec.section_name
             FROM tbl_class_schedules cs
             {$offeringsSubjectJoin}
             {$offeringsSectionJoin}
             LEFT JOIN tbl_programs p ON s.program_id = p.program_id
             {$offeringsWhereSql}
             ORDER BY s.subject_code, sec.section_name"
        );
    }

    $rooms = dashboard_db_fetch_all($mysqli, 'SELECT room_id, room_name, latitude, longitude, radius FROM tbl_rooms ORDER BY room_name');
    $teachers = dashboard_db_fetch_all(
        $mysqli,
        "SELECT u.user_id, u.first_name, u.last_name, u.role_id, u.dept_id, u.assigned_program_head_id
         FROM tbl_users u
         {$teacherJoin}
         WHERE {$teachersWhereSql}
         ORDER BY u.last_name, u.first_name"
    );

    $attendanceScopeSql = '';
    if ($restrictAttendanceByUser) {
        $attendanceScopeSql = " AND (" . dashboard_apply_user_scope($scopeUserTemplate, 'u') . ")";
    }

    $recent_attendance_sql = "SELECT
            ar.attendance_id,
            ar.user_id,
            ar.schedule_id,
            ar.room_id,
            ar.floor_id,
            DATE_FORMAT(ar.date, '%Y-%m-%d') AS date,
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
            ar.remarks,
            u.first_name,
            u.last_name,
            cs.day_of_week,
            cs.start_time,
            cs.end_time,
            r.room_name,
            {$sectionSelect},
            s.subject_code,
            s.subject_name,
            ({$finalFlagExpr}) AS final_flag_id,
            COALESCE(ft_final.flag_name, 'NA') AS final_flag_name,
            COALESCE(ft_in.flag_name, 'NA') AS flag_in_name,
            COALESCE(ft_check.flag_name, 'NA') AS flag_check_name,
            COALESCE(ft_out.flag_name, 'NA') AS flag_out_name
         FROM tbl_attendance_records ar
         LEFT JOIN tbl_users u ON ar.user_id = u.user_id
         LEFT JOIN tbl_class_schedules cs ON ar.schedule_id = cs.schedule_id
         LEFT JOIN tbl_rooms r ON ar.room_id = r.room_id
         {$joinOffering}
         LEFT JOIN tbl_subject s ON {$subjectExpr} = s.subject_id
         {$sectionJoin}
         LEFT JOIN tbl_flag_types ft_in ON ar.flag_in_id = ft_in.flag_id
         LEFT JOIN tbl_flag_types ft_check ON ar.flag_check_id = ft_check.flag_id
         LEFT JOIN tbl_flag_types ft_out ON ar.flag_out_id = ft_out.flag_id
         LEFT JOIN tbl_flag_types ft_final ON ft_final.flag_id = {$finalFlagExpr}
         WHERE 1=1
         AND ({$finalFlagExpr}) <> 1
         {$attendanceScopeSql}
         ORDER BY ar.date DESC, ar.attendance_id DESC
         LIMIT 200";
    $recent_attendance = dashboard_db_fetch_all($mysqli, $recent_attendance_sql);
    $recent_attendance = dashboard_cast_int_fields($recent_attendance, [
        'attendance_id', 'user_id', 'schedule_id', 'room_id', 'floor_id', 'flag_in_id', 'flag_check_id', 'flag_out_id'
    ]);

    $trend_sql = "SELECT
            DATE_FORMAT(ar.date, '%Y-%m-%d') AS d,
            SUM(({$finalFlagExpr}) = 2) AS present,
            SUM(({$finalFlagExpr}) = 3) AS absent,
            SUM(({$finalFlagExpr}) = 5) AS late,
            SUM(({$finalFlagExpr}) = 1) AS na,
            COUNT(*) AS total
         FROM tbl_attendance_records ar
         LEFT JOIN tbl_users u ON ar.user_id = u.user_id
         WHERE ar.date >= CURDATE() - INTERVAL 13 DAY
         AND ar.date <= CURDATE()
         {$attendanceScopeSql}
         GROUP BY ar.date
         ORDER BY ar.date ASC";
    $trend = dashboard_db_fetch_all($mysqli, $trend_sql);
    $trend = dashboard_cast_int_fields($trend, ['present', 'absent', 'late', 'na', 'total']);

    $hour_sql = "SELECT HOUR(ar.checked_in_at) AS hr, COUNT(*) AS cnt
         FROM tbl_attendance_records ar
         LEFT JOIN tbl_users u ON ar.user_id = u.user_id
         WHERE ar.date = '{$snapshotDateSql}' AND ar.checked_in_at IS NOT NULL
         {$attendanceScopeSql}
         GROUP BY hr
         ORDER BY hr ASC";
    $hourly = dashboard_db_fetch_all($mysqli, $hour_sql);
    $hourly = dashboard_cast_int_fields($hourly, ['hr', 'cnt']);

    $top_rooms_sql = "SELECT r.room_id, r.room_name, COUNT(*) AS checks
         FROM tbl_attendance_records ar
         JOIN tbl_rooms r ON ar.room_id = r.room_id
         LEFT JOIN tbl_users u ON ar.user_id = u.user_id
         WHERE ar.date >= CURDATE() - INTERVAL 29 DAY
         AND ar.date <= CURDATE()
         {$attendanceScopeSql}
         GROUP BY r.room_id, r.room_name
         ORDER BY checks DESC, r.room_name ASC
         LIMIT 10";
    $top_rooms = dashboard_db_fetch_all($mysqli, $top_rooms_sql);
    $top_rooms = dashboard_cast_int_fields($top_rooms, ['room_id', 'checks']);

    $floor_sql = "SELECT f.floor_id, f.floor_name, COUNT(*) AS checks
         FROM tbl_attendance_records ar
         JOIN tbl_floors f ON ar.floor_id = f.floor_id
         LEFT JOIN tbl_users u ON ar.user_id = u.user_id
         WHERE ar.date >= CURDATE() - INTERVAL 29 DAY
         AND ar.date <= CURDATE()
         {$attendanceScopeSql}
         GROUP BY f.floor_id, f.floor_name
         ORDER BY checks DESC, f.floor_name ASC";
    $floor_dist = dashboard_db_fetch_all($mysqli, $floor_sql);
    $floor_dist = dashboard_cast_int_fields($floor_dist, ['floor_id', 'checks']);

    $role_sql = "SELECT ro.role_id, ro.role_name, COUNT(*) AS checks
         FROM tbl_attendance_records ar
         JOIN tbl_users u ON ar.user_id = u.user_id
         JOIN tbl_roles ro ON u.role_id = ro.role_id
         WHERE ar.date >= CURDATE() - INTERVAL 29 DAY
         AND ar.date <= CURDATE()
         {$attendanceScopeSql}
         GROUP BY ro.role_id, ro.role_name
         ORDER BY checks DESC, ro.role_id ASC";
    $by_role = $hasRolesTable ? dashboard_db_fetch_all($mysqli, $role_sql) : [];
    $by_role = dashboard_cast_int_fields($by_role, ['role_id', 'checks']);

    $weekly_sql = "SELECT
            DATE_FORMAT(ar.date, '%Y-%m-%d') AS d,
            COUNT(*) AS total,
            SUM(({$finalFlagExpr}) = 2) AS present,
            SUM(({$finalFlagExpr}) = 3) AS absent,
            SUM(({$finalFlagExpr}) = 5) AS late
         FROM tbl_attendance_records ar
         LEFT JOIN tbl_users u ON ar.user_id = u.user_id
         WHERE ar.date >= CURDATE() - INTERVAL 6 DAY
         AND ar.date <= CURDATE()
         {$attendanceScopeSql}
         GROUP BY ar.date
         ORDER BY ar.date ASC";
    $weekly = dashboard_db_fetch_all($mysqli, $weekly_sql);
    $weekly = dashboard_cast_int_fields($weekly, ['total', 'present', 'absent', 'late']);

    json_response([
        'generated_at' => date('c'),
        'snapshot_date' => $snapshotDate,
        'summary' => $summary_response,
        'departments' => $departments,
        'programs' => $programs,
        'sections' => $sections,
        'semesters' => $semesters,
        'subjects' => $subjects,
        'offerings' => $offerings,
        'rooms' => $rooms,
        'teachers' => $teachers,
        'recent_attendance' => $recent_attendance,
        'viz' => [
            'trend_14d' => $trend,
            'hourly_today' => $hourly,
            'top_rooms_30d' => $top_rooms,
            'floor_distribution_30d' => $floor_dist,
            'attendance_by_role_30d' => $by_role,
            'weekly_7d' => $weekly
        ]
    ]);
}

json_response(['error' => 'Dashboard endpoint not found.'], 404);
