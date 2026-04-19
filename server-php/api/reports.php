<?php
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

require_once __DIR__ . '/../config/database.php';
global $mysqli;

// Simple helper to send JSON responses
if (!function_exists('json_response')) {
    function json_response($data, $status = 200) {
        http_response_code($status);
        header('Content-Type: application/json');
        echo json_encode($data);
        exit;
    }
}

if (!function_exists('output_csv')) {
    function output_csv($rows, $columns, $filename = 'report.csv') {
        header('Content-Type: text/csv');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        $out = fopen('php://output', 'w');
        fputcsv($out, $columns);
        foreach ($rows as $r) {
            $line = [];
            foreach ($columns as $c) $line[] = $r[$c] ?? '';
            fputcsv($out, $line);
        }
        fclose($out);
        exit;
    }
}

if (!function_exists('output_html_printable')) {
    function output_html_printable($rows, $columns, $title = 'Report') {
        header('Content-Type: text/html');
        echo "<html><head><meta charset=\"utf-8\"><title>" . htmlspecialchars($title) . "</title>";
        echo "<style>table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:8px;text-align:left}</style>";
        echo "</head><body><h2>" . htmlspecialchars($title) . "</h2><table><thead><tr>";
        foreach ($columns as $c) echo "<th>" . htmlspecialchars($c) . "</th>";
        echo "</tr></thead><tbody>";
        foreach ($rows as $r) {
            echo "<tr>";
            foreach ($columns as $c) echo "<td>" . htmlspecialchars((string)($r[$c] ?? '')) . "</td>";
            echo "</tr>";
        }
        echo "</tbody></table></body></html>";
        exit;
    }
}

// Helper: find an existing column from a list of candidates for a given table
function find_column($table, $candidates) {
    global $mysqli;
    foreach ($candidates as $c) {
        $c_esc = $mysqli->real_escape_string($c);
        $res = $mysqli->query("SHOW COLUMNS FROM `{$table}` LIKE '{$c_esc}'");
        if ($res && $res->num_rows) return $c;
    }
    return null;
}

// Helper: choose a timestamp column for a table (common names)
function choose_timestamp_column($table, $preferred = null) {
    $cands = [];
    if ($preferred) $cands[] = $preferred;
    $cands = array_merge($cands, ['edited_at','created_at','created','logged_at','timestamp','time','date_time']);
    return find_column($table, $cands);
}

$report = $_GET['report'] ?? null;
$export = $_GET['export'] ?? null; // 'csv' or 'html'
$start_date = $_GET['start_date'] ?? null;
$end_date = $_GET['end_date'] ?? null;
$room_id = isset($_GET['room_id']) && is_numeric($_GET['room_id']) ? (int)$_GET['room_id'] : null;
$teacher_id = isset($_GET['teacher_id']) && is_numeric($_GET['teacher_id']) ? (int)$_GET['teacher_id'] : null;
$dept_id = isset($_GET['dept_id']) && is_numeric($_GET['dept_id']) ? (int)$_GET['dept_id'] : null;

if (!$report) {
    json_response(['error' => 'missing_report'], 400);
}

// default date range: last 30 days
if (!$end_date) $end_date = date('Y-m-d');
if (!$start_date) $start_date = date('Y-m-d', strtotime($end_date . ' -30 days'));

$rows = [];
$columns = [];
$title = '';

if ($report === 'classroom_utilization') {
    $title = 'Classroom Utilization Report';
    $columns = ['Room Name','Total Classes Held','Total Hours Used (hrs)','Most Frequent Teacher'];

    // ADDED: dept_id subquery check inside the LEFT JOIN to filter out teachers outside the department
    $sql = "SELECT r.room_id, r.room_name, COUNT(ar.attendance_id) AS total_classes, 
        COALESCE(SUM(TIME_TO_SEC(TIMEDIFF(cs.end_time, cs.start_time))),0) AS total_seconds
        FROM tbl_rooms r
        LEFT JOIN tbl_attendance_records ar ON ar.room_id = r.room_id AND ar.date BETWEEN ? AND ?";
    
    if ($dept_id) {
        $sql .= " AND ar.user_id IN (SELECT user_id FROM tbl_users WHERE dept_id = ?)";
    }
    
    $sql .= " LEFT JOIN tbl_class_schedules cs ON ar.schedule_id = cs.schedule_id WHERE 1=1";

    $params = [$start_date, $end_date];
    $types = 'ss';
    if ($dept_id) { $types .= 'i'; $params[] = $dept_id; }
    if ($room_id) { $sql .= ' AND r.room_id = ?'; $types .= 'i'; $params[] = $room_id; }
    $sql .= ' GROUP BY r.room_id ORDER BY total_classes DESC';
    
    $stmt = $mysqli->prepare($sql);
    if (!$stmt) json_response(['error' => 'db_prepare_failed', 'message' => $mysqli->error], 500);
    
    $refs = [];
    $refs[] = &$types;
    foreach ($params as $k => $v) { $refs[] = &$params[$k]; }
    call_user_func_array([$stmt, 'bind_param'], $refs);
    $stmt->execute();
    $res = $stmt->get_result();
    
    while ($r = $res->fetch_assoc()) {
        $q = $mysqli->prepare("SELECT CONCAT_WS(' ',u.first_name,u.last_name) AS teacher, COUNT(*) AS cnt FROM tbl_attendance_records ar JOIN tbl_users u ON ar.user_id = u.user_id WHERE ar.room_id = ? AND ar.date BETWEEN ? AND ? GROUP BY ar.user_id ORDER BY cnt DESC LIMIT 1");
        $teacher = '';
        if ($q) {
            $q->bind_param('iss', $r['room_id'], $start_date, $end_date);
            $q->execute();
            $tr = $q->get_result()->fetch_assoc();
            if ($tr && !empty($tr['teacher'])) $teacher = $tr['teacher'];
            $q->close();
        }
        $total_hours = round(((int)$r['total_seconds'])/3600,2);
        $rows[] = ['Room Name' => $r['room_name'] ?? '','Total Classes Held' => (int)$r['total_classes'],'Total Hours Used (hrs)' => $total_hours,'Most Frequent Teacher' => $teacher];
    }
    $stmt->close();

} elseif ($report === 'leave_substitution') {
    $title = 'Leave & Substitution Report';
    $columns = ['Teacher Name','Date','Type','Reason','Status'];
    
    // Leaves
    $sqlL = "SELECT CONCAT_WS(' ',u.first_name,u.last_name) AS teacher, l.date_from AS date, 'Leave' AS type, l.reason AS reason, l.req_status AS status FROM tbl_leaves l JOIN tbl_users u ON l.teacher_id = u.user_id WHERE l.date_from BETWEEN ? AND ?";
    $paramsL = [$start_date, $end_date];
    $types = 'ss';
    if ($teacher_id) { $sqlL .= ' AND l.teacher_id = ?'; $types .= 'i'; $paramsL[] = $teacher_id; }
    if ($dept_id) { $sqlL .= ' AND u.dept_id = ?'; $types .= 'i'; $paramsL[] = $dept_id; } // ADDED DEPT FILTER
    
    $stmt = $mysqli->prepare($sqlL);
    if (!$stmt) json_response(['error'=>'db_prepare_failed','message'=>$mysqli->error],500);
    $refs = []; $refs[] = &$types; foreach ($paramsL as $k=>&$v) $refs[] = &$v; call_user_func_array([$stmt,'bind_param'],$refs);
    $stmt->execute();
    $res = $stmt->get_result();
    while ($r = $res->fetch_assoc()) $rows[] = ['Teacher Name'=>$r['teacher'],'Date'=>$r['date'],'Type'=>$r['type'],'Reason'=>$r['reason'],'Status'=>$r['status']];
    $stmt->close();

    // Substitutions
    $subReasonCol = find_column('tbl_substitutions', ['reason','substitution_reason','note','comments','remarks']);
    $subStatusCol = find_column('tbl_substitutions', ['status','req_status','approval_status','state']);
    $reasonExpr = $subReasonCol ? "COALESCE(s.`{$subReasonCol}`,'') AS reason" : "'' AS reason";
    $statusExpr = $subStatusCol ? "COALESCE(s.`{$subStatusCol}`,'') AS status" : "'' AS status";

    $sqlS = "SELECT CONCAT_WS(' ',u.first_name,u.last_name) AS teacher, s.date AS date, 'Substitution' AS type, {$reasonExpr}, {$statusExpr} FROM tbl_substitutions s JOIN tbl_users u ON s.substitute_user_id = u.user_id WHERE s.date BETWEEN ? AND ?";
    $paramsS = [$start_date, $end_date];
    $types = 'ss';
    if ($teacher_id) { $sqlS .= ' AND s.substitute_user_id = ?'; $types .= 'i'; $paramsS[] = $teacher_id; }
    if ($dept_id) { $sqlS .= ' AND u.dept_id = ?'; $types .= 'i'; $paramsS[] = $dept_id; } // ADDED DEPT FILTER
    
    $stmt = $mysqli->prepare($sqlS);
    if (!$stmt) {
        $sqlS = "SELECT s.substitute_user_id AS teacher_id, s.date AS date, 'Substitution' AS type, '' AS reason, '' AS status FROM tbl_substitutions s WHERE s.date BETWEEN ? AND ?";
        $stmt = $mysqli->prepare($sqlS);
        if (!$stmt) json_response(['error'=>'db_prepare_failed','message'=>$mysqli->error],500);
    } else {
        $refs = []; $refs[] = &$types; foreach ($paramsS as $k=>&$v) $refs[] = &$v; call_user_func_array([$stmt,'bind_param'],$refs);
    }
    $stmt->execute();
    $res = $stmt->get_result();
    while ($r = $res->fetch_assoc()) {
        $teacher = $r['teacher'] ?? (isset($r['teacher_id']) ? ('User #' . $r['teacher_id']) : '');
        $rows[] = ['Teacher Name'=>$teacher,'Date'=>$r['date'],'Type'=>$r['type'],'Reason'=>$r['reason'],'Status'=>$r['status']];
    }
    $stmt->close();

} elseif ($report === 'attendance_records') {
    $title = 'Attendance Records';
    $columns = ['#','Teacher','Schedule','Room','Date','Flag In','Checked In','Flag Check','Checked Mid','Flag Out','Checked Out'];

    // Support both schemas:
    // 1) Legacy: class_schedules.offering_id -> subject_offerings
    // 2) Current: class_schedules.subject_id/section_id direct links
    $hasSubjectOfferings = false;
    $csHasOfferingCol = false;
    $tRes = $mysqli->query("SHOW TABLES LIKE 'tbl_subject_offerings'");
    if ($tRes && $tRes->num_rows > 0) $hasSubjectOfferings = true;
    $cRes = $mysqli->query("SHOW COLUMNS FROM tbl_class_schedules LIKE 'offering_id'");
    if ($cRes && $cRes->num_rows > 0) $csHasOfferingCol = true;

    $subjectJoinSql = '';
    if ($hasSubjectOfferings && $csHasOfferingCol) {
        $subjectJoinSql = "LEFT JOIN tbl_subject_offerings so ON cs.offering_id = so.offering_id
        LEFT JOIN tbl_subject s ON so.subject_id = s.subject_id
        LEFT JOIN tbl_sections sec ON so.section_id = sec.section_id";
    } else {
        $subjectJoinSql = "LEFT JOIN tbl_subject s ON cs.subject_id = s.subject_id
        LEFT JOIN tbl_sections sec ON cs.section_id = sec.section_id";
    }

    $sql = "SELECT ar.attendance_id, ar.user_id, CONCAT_WS(' ', tu.first_name, tu.last_name) AS teacher_name,
               cs.schedule_id, s.subject_code, s.subject_name, sec.section_name,
               r.room_name AS room_name, ar.date,
               ft_in.flag_name AS flag_in, ar.checked_in_at,
               ft_check.flag_name AS flag_check, ar.checked_mid_at,
               ft_out.flag_name AS flag_out, ar.checked_out_at
        FROM tbl_attendance_records ar
        LEFT JOIN tbl_users tu ON ar.user_id = tu.user_id
        LEFT JOIN tbl_rooms r ON ar.room_id = r.room_id
        LEFT JOIN tbl_class_schedules cs ON ar.schedule_id = cs.schedule_id
        {$subjectJoinSql}
        LEFT JOIN tbl_flag_types ft_in ON ar.flag_in_id = ft_in.flag_id
        LEFT JOIN tbl_flag_types ft_check ON ar.flag_check_id = ft_check.flag_id
        LEFT JOIN tbl_flag_types ft_out ON ar.flag_out_id = ft_out.flag_id
        WHERE ar.date BETWEEN ? AND ?";

    $params = [$start_date, $end_date]; $types = 'ss';
    if ($teacher_id) { $sql .= ' AND ar.user_id = ?'; $types .= 'i'; $params[] = $teacher_id; }
    if ($room_id) { $sql .= ' AND ar.room_id = ?'; $types .= 'i'; $params[] = $room_id; }
    if ($dept_id) { $sql .= ' AND tu.dept_id = ?'; $types .= 'i'; $params[] = $dept_id; } // ADDED DEPT FILTER
    
    $sql .= ' ORDER BY ar.date DESC, cs.start_time, tu.last_name, tu.first_name';

    $stmt = $mysqli->prepare($sql);
    if (!$stmt) json_response(['error'=>'db_prepare_failed','message'=>$mysqli->error,'sql'=>$sql],500);
    $refs = []; $refs[] = &$types; foreach ($params as $k=>&$v) $refs[] = &$v; call_user_func_array([$stmt,'bind_param'],$refs);
    $stmt->execute();
    $res = $stmt->get_result();
    if ($res) {
        $i = 1;
        $out = [];
        while ($r = $res->fetch_assoc()) {
            $scheduleLabel = '';
            if (!empty($r['subject_code']) || !empty($r['subject_name'])) {
                $code = $r['subject_code'] ?: $r['subject_name'];
                $section = $r['section_name'] ? (' / ' . $r['section_name']) : '';
                $scheduleLabel = $code . $section;
            }
            $out[] = [
                '#' => $i++,
                'Teacher' => $r['teacher_name'] ?? '',
                'Schedule' => $scheduleLabel,
                'Room' => $r['room_name'] ?? '',
                'Date' => $r['date'] ?? '',
                'Flag In' => $r['flag_in'] ?? '',
                'Checked In' => $r['checked_in_at'] ?? '',
                'Flag Check' => $r['flag_check'] ?? '',
                'Checked Mid' => $r['checked_mid_at'] ?? '',
                'Flag Out' => $r['flag_out'] ?? '',
                'Checked Out' => $r['checked_out_at'] ?? '',
            ];
        }
        $rows = $out;
        $stmt->close();
    } else {
        json_response(['error'=>'db_query_failed','message'=>$mysqli->error],500);
    }

} elseif ($report === 'teacher_attendance_summary') {
    $title = 'Teacher Attendance Summary';
    $columns = [
        '#',
        'Teacher',
        'Department',
        'Total Classes',
        'Present',
        'Late',
        'Absent',
        'Unresolved',
        'Total Late Minutes',
        'Late Minutes by Day',
        '7:30 AM Red Flags',
        'Latest Red-Flag Date',
        'Red-Flag Status',
    ];

    $sql = "SELECT
                ar.user_id,
                CONCAT_WS(' ', u.first_name, u.last_name) AS teacher_name,
                COALESCE(d.dept_name, '') AS dept_name,
                ar.date,
                ar.checked_in_at,
                ar.flag_in_id,
                cs.start_time
            FROM tbl_attendance_records ar
            JOIN tbl_users u ON ar.user_id = u.user_id
            LEFT JOIN tbl_departments d ON u.dept_id = d.dept_id
            LEFT JOIN tbl_class_schedules cs ON ar.schedule_id = cs.schedule_id
            WHERE ar.date BETWEEN ? AND ?";

    $params = [$start_date, $end_date];
    $types = 'ss';
    if ($teacher_id) { $sql .= ' AND ar.user_id = ?'; $types .= 'i'; $params[] = $teacher_id; }
    if ($dept_id) { $sql .= ' AND u.dept_id = ?'; $types .= 'i'; $params[] = $dept_id; }
    $sql .= ' ORDER BY u.last_name, u.first_name, ar.date ASC, cs.start_time ASC';

    $stmt = $mysqli->prepare($sql);
    if (!$stmt) json_response(['error' => 'db_prepare_failed', 'message' => $mysqli->error], 500);

    $refs = [];
    $refs[] = &$types;
    foreach ($params as $k => &$v) $refs[] = &$v;
    call_user_func_array([$stmt, 'bind_param'], $refs);

    $stmt->execute();
    $res = $stmt->get_result();
    if (!$res) json_response(['error' => 'db_query_failed', 'message' => $mysqli->error], 500);

    $summary = [];
    while ($r = $res->fetch_assoc()) {
        $uid = (int)($r['user_id'] ?? 0);
        if ($uid <= 0) continue;

        if (!isset($summary[$uid])) {
            $summary[$uid] = [
                'Teacher' => trim((string)($r['teacher_name'] ?? '')) ?: ('User #' . $uid),
                'Department' => trim((string)($r['dept_name'] ?? '')),
                'Total Classes' => 0,
                'Present' => 0,
                'Late' => 0,
                'Absent' => 0,
                'Unresolved' => 0,
                'Total Late Minutes' => 0,
                '_late_by_day' => [],
                '7:30 AM Red Flags' => 0,
                'Latest Red-Flag Date' => '',
                'Red-Flag Status' => 'OK',
            ];
        }

        $summary[$uid]['Total Classes']++;
        $recordDate = (string)($r['date'] ?? '');
        $checkedInAt = $r['checked_in_at'] ?? null;
        $flagIn = isset($r['flag_in_id']) ? (int)$r['flag_in_id'] : 0;
        $deptNameNorm = strtolower(trim((string)($r['dept_name'] ?? '')));
        $startTime = trim((string)($r['start_time'] ?? ''));
        $startHm = '';
        if (preg_match('/^\d{1,2}:\d{2}/', $startTime, $m)) {
            $parts = explode(':', $m[0]);
            $startHm = str_pad((string)((int)$parts[0]), 2, '0', STR_PAD_LEFT) . ':' . $parts[1];
        }

        $isStrict730 = ($deptNameNorm === 'college of education' && $startHm === '07:30');
        $graceMinutes = $isStrict730 ? 0 : 15;

        $scheduledTs = null;
        $checkedTs = null;
        if ($recordDate !== '' && $startTime !== '') {
            $scheduledTs = strtotime($recordDate . ' ' . $startTime);
        }
        if (!empty($checkedInAt)) {
            $checkedTs = strtotime((string)$checkedInAt);
        }

        $isPolicyLate = false;
        $lateMinutes = 0;
        if ($scheduledTs !== false && $scheduledTs !== null && $checkedTs !== false && $checkedTs !== null) {
            $lateThresholdTs = $scheduledTs + ($graceMinutes * 60);
            if ($checkedTs > $lateThresholdTs) {
                $isPolicyLate = true;
                $lateMinutes = (int) floor(($checkedTs - $lateThresholdTs) / 60);
                if ($lateMinutes < 0) $lateMinutes = 0;
            }

            if ($isStrict730 && $checkedTs > $scheduledTs) {
                $summary[$uid]['7:30 AM Red Flags']++;
                if ($recordDate !== '' && ($summary[$uid]['Latest Red-Flag Date'] === '' || $recordDate > $summary[$uid]['Latest Red-Flag Date'])) {
                    $summary[$uid]['Latest Red-Flag Date'] = $recordDate;
                }
            }
        }

        if ($flagIn === 3) {
            $summary[$uid]['Absent']++;
        } elseif ($isPolicyLate || $flagIn === 5) {
            $summary[$uid]['Late']++;
        } elseif ($flagIn === 2 || (!empty($checkedInAt) && $flagIn !== 4 && $flagIn !== 7)) {
            $summary[$uid]['Present']++;
        } else {
            $summary[$uid]['Unresolved']++;
        }

        if ($lateMinutes > 0) {
            $summary[$uid]['Total Late Minutes'] += $lateMinutes;
            if (!isset($summary[$uid]['_late_by_day'][$recordDate])) $summary[$uid]['_late_by_day'][$recordDate] = 0;
            $summary[$uid]['_late_by_day'][$recordDate] += $lateMinutes;
        }
    }
    $stmt->close();

    $out = [];
    foreach ($summary as $uid => $item) {
        $lateByDay = $item['_late_by_day'];
        ksort($lateByDay);
        $dailyParts = [];
        foreach ($lateByDay as $dateKey => $mins) {
            $dailyParts[] = $dateKey . ': ' . (int)$mins . ' min';
        }
        $dailyLateText = !empty($dailyParts) ? implode('; ', $dailyParts) : '-';

        $redFlags = (int)$item['7:30 AM Red Flags'];
        if ($redFlags >= 3) $redFlagStatus = 'ALERT (3+ red flags)';
        elseif ($redFlags > 0) $redFlagStatus = 'Watchlist (' . $redFlags . '/3)';
        else $redFlagStatus = 'OK';

        $out[] = [
            '#' => 0,
            'Teacher' => $item['Teacher'],
            'Department' => $item['Department'],
            'Total Classes' => (int)$item['Total Classes'],
            'Present' => (int)$item['Present'],
            'Late' => (int)$item['Late'],
            'Absent' => (int)$item['Absent'],
            'Unresolved' => (int)$item['Unresolved'],
            'Total Late Minutes' => (int)$item['Total Late Minutes'],
            'Late Minutes by Day' => $dailyLateText,
            '7:30 AM Red Flags' => $redFlags,
            'Latest Red-Flag Date' => $item['Latest Red-Flag Date'] ?: '-',
            'Red-Flag Status' => $redFlagStatus,
        ];
    }

    usort($out, function($a, $b) {
        $flagCmp = (int)$b['7:30 AM Red Flags'] <=> (int)$a['7:30 AM Red Flags'];
        if ($flagCmp !== 0) return $flagCmp;
        $lateCmp = (int)$b['Total Late Minutes'] <=> (int)$a['Total Late Minutes'];
        if ($lateCmp !== 0) return $lateCmp;
        return strcasecmp((string)$a['Teacher'], (string)$b['Teacher']);
    });

    foreach ($out as $i => &$row) {
        $row['#'] = $i + 1;
    }
    unset($row);
    $rows = $out;

} elseif ($report === 'attendance_logs') {
    $title = 'Attendance Logs';
    $columns = ['Edit Session', 'Teacher', 'Action', 'Field', 'Old Value', 'New Value', 'Reason', 'Edited By', 'Date'];

    // ADDED: Converted to Prepared Statement to safely insert the Dept Filter
    $sql = "SELECT 
                l.edit_session_id AS 'Edit Session',
                CONCAT(COALESCE(target.first_name,''), ' ', COALESCE(target.last_name,'')) AS 'Teacher',
                l.action_type AS 'Action',
                l.field_name AS 'Field',
                l.old_value AS 'Old Value',
                l.new_value AS 'New Value',
                l.reason AS 'Reason',
                CONCAT(COALESCE(editor.first_name,''), ' ', COALESCE(editor.last_name,'')) AS 'Edited By',
                l.edited_at AS 'Date'
            FROM tbl_attendance_logs l
            LEFT JOIN tbl_attendance_records ar ON l.attendance_id = ar.attendance_id
            LEFT JOIN tbl_users target ON ar.user_id = target.user_id
            LEFT JOIN tbl_users editor ON l.edited_by = editor.user_id
            WHERE 1=1";

    $params = [];
    $types = '';

    if ($dept_id) { 
        $sql .= " AND target.dept_id = ?"; 
        $types .= 'i'; 
        $params[] = $dept_id; 
    }

    $sql .= " ORDER BY l.log_id DESC LIMIT 100";

    $stmt = $mysqli->prepare($sql);
    if (!$stmt) json_response(['error' => 'db_error', 'message' => $mysqli->error], 500);

    if (!empty($params)) {
        $refs = [];
        $refs[] = &$types;
        foreach ($params as $k => &$v) $refs[] = &$v;
        call_user_func_array([$stmt, 'bind_param'], $refs);
    }
    
    $stmt->execute();
    $result = $stmt->get_result();

    while ($r = $result->fetch_assoc()) {
        $rows[] = $r;
    }
    $stmt->close();

} elseif ($report === 'system_logs') {
    $title = 'System Logs';
    $columns = ['User','action','details','ip_address','created_at'];
    
    $sysTime = choose_timestamp_column('tbl_system_logs', 'created_at') ?: 'created_at';
    $detailCol = find_column('tbl_system_logs', ['details','info','message']) ?: 'details';
    
    $sql = "SELECT CONCAT_WS(' ', u.first_name, u.last_name) AS `User`, l.action AS action, l.`{$detailCol}` AS details, l.ip_address AS ip_address, l.`{$sysTime}` AS created_at 
            FROM tbl_system_logs l 
            LEFT JOIN tbl_users u ON l.user_id = u.user_id 
            WHERE l.`{$sysTime}` BETWEEN ? AND ?";
    
    $params = [$start_date . ' 00:00:00', $end_date . ' 23:59:59']; 
    $types = 'ss';
    
    if ($teacher_id) { $sql .= ' AND l.user_id = ?'; $types .= 'i'; $params[] = $teacher_id; }
    if ($dept_id) { $sql .= ' AND u.dept_id = ?'; $types .= 'i'; $params[] = $dept_id; }

    // --- Role-Based & Department Filtering ---
    $current_user_id = $_GET['current_user_id'] ?? $authUserId;

    if ($current_user_id) {
        $reqStmt = $mysqli->prepare("SELECT role_id, dept_id FROM tbl_users WHERE user_id = ?");
        if ($reqStmt) {
            $reqStmt->bind_param('i', $current_user_id);
            $reqStmt->execute();
            $reqRes = $reqStmt->get_result()->fetch_assoc();
            
            if ($reqRes) {
                $reqRole = (int)$reqRes['role_id'];
                $reqDept = $reqRes['dept_id'];
                
                if ($reqRole === 1) {
                    // Admin: Can see everything, no extra filter needed.
                } else if ($reqRole === 2) {
                    // Dean: See own logs OR (same dept AND roles 3 [Program Head], 4 [Secretary], 5 [Teacher])
                    $sql .= " AND (l.user_id = ? OR (u.dept_id = ? AND u.role_id IN (3, 4, 5)))";
                    $types .= 'ii';
                    $params[] = $current_user_id;
                    $params[] = $reqDept;
                } else if ($reqRole === 3) {
                    // Program Head: See own logs OR (same dept AND roles 4 [Secretary], 5 [Teacher])
                    $sql .= " AND (l.user_id = ? OR (u.dept_id = ? AND u.role_id IN (4, 5)))";
                    $types .= 'ii';
                    $params[] = $current_user_id;
                    $params[] = $reqDept;
                } else if ($reqRole === 4) {
                    // Secretary: See own logs OR (same dept AND role 5 [Teacher])
                    $sql .= " AND (l.user_id = ? OR (u.dept_id = ? AND u.role_id = 5))";
                    $types .= 'ii';
                    $params[] = $current_user_id;
                    $params[] = $reqDept;
                } else {
                    // Teacher/Others: Only see their own logs
                    $sql .= " AND l.user_id = ?";
                    $types .= 'i';
                    $params[] = $current_user_id;
                }
            }
            $reqStmt->close();
        }
    }

    $sql .= " ORDER BY l.`{$sysTime}` DESC LIMIT 500"; // Optional limit for performance

    $stmt = $mysqli->prepare($sql);
    if (!$stmt) {
        json_response(['error'=>'db_prepare_failed','message'=>$mysqli->error], 500);
    } else {
        $refs = []; 
        $refs[] = &$types; 
        foreach ($params as $k => &$v) { $refs[] = &$v; } 
        call_user_func_array([$stmt, 'bind_param'], $refs);
        
        $stmt->execute(); 
        $res = $stmt->get_result(); 
        while ($r = $res->fetch_assoc()) $rows[] = $r; 
        $stmt->close();
    }

} else {
    json_response(['error' => 'unknown_report'], 400);
}

// export handling
if ($export === 'csv') {
    output_csv($rows, $columns, preg_replace('/[^A-Za-z0-9_\-]/','_', $title) . '.csv');
} elseif ($export === 'html') {
    output_html_printable($rows, $columns, $title);
} else {
    json_response(['title' => $title, 'columns' => $columns, 'rows' => $rows]);
}
