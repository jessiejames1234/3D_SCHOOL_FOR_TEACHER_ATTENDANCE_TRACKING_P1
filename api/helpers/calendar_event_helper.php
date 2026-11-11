<?php

declare(strict_types=1);

if (!function_exists('calendar_event_schema_ensure')) {
    function calendar_event_schema_ensure(mysqli $mysqli): void
    {
        static $ready = false;
        if ($ready) return;
        $exists = $mysqli->query("SHOW TABLES LIKE 'tbl_calendar_events'");
        $sql = "CREATE TABLE IF NOT EXISTS tbl_calendar_events (
            event_id INT NOT NULL AUTO_INCREMENT,
            title VARCHAR(180) NOT NULL,
            event_type ENUM('holiday','event') NOT NULL DEFAULT 'event',
            date_from DATE NOT NULL,
            date_to DATE NOT NULL,
            dept_id INT NULL,
            program_id INT NULL,
            start_time TIME NULL,
            end_time TIME NULL,
            description TEXT NULL,
            status ENUM('active','cancelled') NOT NULL DEFAULT 'active',
            created_by INT NOT NULL,
            updated_by INT NULL,
            cancelled_by INT NULL,
            cancelled_at DATETIME NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (event_id),
            KEY idx_calendar_events_dates (status, date_from, date_to),
            KEY idx_calendar_events_scope (dept_id, program_id, status),
            KEY idx_calendar_events_created_by (created_by)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
        if (!$mysqli->query($sql)) {
            throw new RuntimeException('Unable to initialize calendar events: ' . $mysqli->error);
        }
        foreach (['start_time', 'end_time'] as $column) {
            $check = $mysqli->query("SHOW COLUMNS FROM tbl_calendar_events LIKE '{$column}'");
            if (!$check->num_rows && !$mysqli->query("ALTER TABLE tbl_calendar_events ADD COLUMN {$column} TIME NULL")) throw new RuntimeException('Unable to upgrade calendar event times.');
        }
        $mysqli->query("CREATE TABLE IF NOT EXISTS tbl_calendar_event_teachers (
            event_id INT NOT NULL, user_id INT NOT NULL,
            PRIMARY KEY (event_id, user_id), KEY idx_calendar_event_teacher_user (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        $ready = true;
    }
}

if (!function_exists('calendar_event_not_exists_sql')) {
    function calendar_event_not_exists_sql(
        string $dateExpression,
        string $subjectDepartmentExpression,
        string $sectionDepartmentExpression,
        string $subjectProgramExpression,
        string $sectionProgramExpression,
        string $teacherExpression,
        string $startTimeExpression,
        string $endTimeExpression
    ): string {
        $coverageSql = calendar_event_schedule_conditions_sql($teacherExpression, $startTimeExpression, $endTimeExpression);
        return "NOT EXISTS (
            SELECT 1
            FROM tbl_calendar_events ce
            WHERE ce.status = 'active'
              AND {$dateExpression} BETWEEN ce.date_from AND ce.date_to
              AND (ce.dept_id IS NULL OR (ce.dept_id = {$subjectDepartmentExpression} AND ce.dept_id = {$sectionDepartmentExpression}))
              AND (ce.program_id IS NULL OR (ce.program_id = {$subjectProgramExpression} AND ce.program_id = {$sectionProgramExpression}))
              AND {$coverageSql}
        )";
    }
}

if (!function_exists('calendar_event_delete_blocked_upcoming_attendance')) {
    function calendar_event_delete_blocked_upcoming_attendance(mysqli $mysqli): array
    {
        calendar_event_schema_ensure($mysqli);
        $coverageSql = calendar_event_schedule_conditions_sql('cs.user_id', 'cs.start_time', 'cs.end_time');
        $sql = "DELETE ar
            FROM tbl_attendance_records ar
            JOIN tbl_class_schedules cs ON cs.schedule_id = ar.schedule_id
            JOIN tbl_subject subj ON subj.subject_id = cs.subject_id
            JOIN tbl_programs sp ON sp.program_id = subj.program_id
            JOIN tbl_sections sec ON sec.section_id = cs.section_id
            JOIN tbl_programs secp ON secp.program_id = sec.program_id
            WHERE ar.checked_in_at IS NULL
              AND ar.checked_mid_at IS NULL
              AND ar.checked_out_at IS NULL
              AND COALESCE(ar.flag_in_id, 1) = 1
              AND COALESCE(ar.flag_check_id, 1) = 1
              AND COALESCE(ar.flag_out_id, 1) = 1
              AND (ar.date > CURDATE() OR (ar.date = CURDATE() AND cs.start_time > CURTIME()))
              AND EXISTS (
                  SELECT 1 FROM tbl_calendar_events ce
                  WHERE ce.status = 'active'
                    AND ar.date BETWEEN ce.date_from AND ce.date_to
                    AND (ce.dept_id IS NULL OR (ce.dept_id = sp.dept_id AND ce.dept_id = secp.dept_id))
                    AND (ce.program_id IS NULL OR (ce.program_id = sp.program_id AND ce.program_id = secp.program_id))
                    AND {$coverageSql}
              )";
        if (!$mysqli->query($sql)) {
            return ['ok' => false, 'deleted_rows' => 0, 'error' => $mysqli->error];
        }
        return ['ok' => true, 'deleted_rows' => (int)$mysqli->affected_rows, 'error' => null];
    }
}

if (!function_exists('calendar_event_attendance_is_blocked')) {
    function calendar_event_attendance_is_blocked(mysqli $mysqli, int $attendanceId): bool
    {
        if ($attendanceId <= 0) return false;
        calendar_event_schema_ensure($mysqli);
        $coverageSql = calendar_event_schedule_conditions_sql('cs.user_id', 'cs.start_time', 'cs.end_time');
        $stmt = $mysqli->prepare("SELECT 1
            FROM tbl_attendance_records ar
            JOIN tbl_class_schedules cs ON cs.schedule_id = ar.schedule_id
            JOIN tbl_subject subj ON subj.subject_id = cs.subject_id
            JOIN tbl_programs sp ON sp.program_id = subj.program_id
            JOIN tbl_sections sec ON sec.section_id = cs.section_id
            JOIN tbl_programs secp ON secp.program_id = sec.program_id
            JOIN tbl_calendar_events ce
              ON ce.status = 'active'
             AND ar.date BETWEEN ce.date_from AND ce.date_to
             AND (ce.dept_id IS NULL OR (ce.dept_id = sp.dept_id AND ce.dept_id = secp.dept_id))
             AND (ce.program_id IS NULL OR (ce.program_id = sp.program_id AND ce.program_id = secp.program_id))
             AND {$coverageSql}
            WHERE ar.attendance_id = ?
              AND ar.checked_in_at IS NULL AND ar.checked_mid_at IS NULL AND ar.checked_out_at IS NULL
              AND COALESCE(ar.flag_in_id, 1) = 1
              AND COALESCE(ar.flag_check_id, 1) = 1
              AND COALESCE(ar.flag_out_id, 1) = 1
              AND (ar.date > CURDATE() OR (ar.date = CURDATE() AND cs.start_time > CURTIME()))
            LIMIT 1");
        if (!$stmt) throw new RuntimeException($mysqli->error);
        $stmt->bind_param('i', $attendanceId);
        $stmt->execute();
        $blocked = (bool)$stmt->get_result()->fetch_row();
        $stmt->close();
        return $blocked;
    }
}

// Boundary-touching classes do not overlap; a selected window repeats each covered day.
function calendar_event_validate_times(array $payload): array {
    $start = trim((string)($payload['start_time'] ?? ''));
    $end = trim((string)($payload['end_time'] ?? ''));
    if ($start === '' && $end === '') return [null, null];
    $pattern = '/^(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/D';
    if (!preg_match($pattern, $start) || !preg_match($pattern, $end)) throw new InvalidArgumentException('Provide both Start Time and End Time, or leave both blank for all day.');
    $start = substr($start, 0, 5) . ':00'; $end = substr($end, 0, 5) . ':00';
    if ($start >= $end) throw new InvalidArgumentException('Start Time must be earlier than End Time.');
    return [$start, $end];
}

function calendar_event_normalize_teacher_ids($raw): array {
    if (!is_array($raw) || count($raw) > 1000) throw new InvalidArgumentException('Choose teachers from the available list.');
    $ids = [];
    foreach ($raw as $value) {
        if ((!is_int($value) && !is_string($value)) || !preg_match('/^[0-9]+$/D', (string)$value) || (int)$value <= 0) throw new InvalidArgumentException('Invalid selected teacher.');
        $ids[] = (int)$value;
    }
    $ids = array_values(array_unique($ids)); sort($ids, SORT_NUMERIC); return $ids;
}

function calendar_event_teacher_matches_scope(array $teacher, int $actorRole, int $actorDept, ?int $dept, ?int $program): bool {
    return in_array((int)($teacher['role_id'] ?? 0), [2,3,4,5], true)
        && in_array(strtolower(trim((string)($teacher['status'] ?? ''))), ['active','1','true'], true)
        && ($actorRole !== 6 || ($actorDept > 0 && (int)($teacher['dept_id'] ?? 0) === $actorDept))
        && ($dept === null || (int)($teacher['dept_id'] ?? 0) === $dept)
        && ($program === null || (int)($teacher['assigned_program_head_id'] ?? 0) === $program);
}

function calendar_event_schedule_conditions_sql(string $teacher, string $start, string $end): string {
    return "(ce.start_time IS NULL OR ({$start} < ce.end_time AND {$end} > ce.start_time))
        AND COALESCE((SELECT MAX(CASE WHEN cet.user_id = {$teacher} THEN 1 ELSE 0 END)
            FROM tbl_calendar_event_teachers cet WHERE cet.event_id = ce.event_id), 1) = 1";
}

function calendar_event_teacher_ids(mysqli $db, int $eventId): array {
    $stmt = $db->prepare('SELECT user_id FROM tbl_calendar_event_teachers WHERE event_id = ? ORDER BY user_id');
    $stmt->bind_param('i', $eventId); $stmt->execute();
    $ids = array_map('intval', array_column($stmt->get_result()->fetch_all(MYSQLI_ASSOC), 'user_id'));
    $stmt->close(); return $ids;
}

function calendar_event_save_teacher_ids(mysqli $db, int $eventId, array $ids): void {
    $stmt = $db->prepare('DELETE FROM tbl_calendar_event_teachers WHERE event_id = ?');
    $stmt->bind_param('i', $eventId); $stmt->execute(); $stmt->close();
    $stmt = $db->prepare('INSERT INTO tbl_calendar_event_teachers (event_id,user_id) VALUES (?,?)');
    foreach ($ids as $id) { $stmt->bind_param('ii', $eventId, $id); $stmt->execute(); }
    $stmt->close();
}

function calendar_event_append_scope_filter(string &$sql, string &$types, array &$values, array $event): void {
    $dept = $event['deptId'] ?? $event['dept_id'] ?? null;
    $program = $event['programId'] ?? $event['program_id'] ?? null;
    $start = $event['startTime'] ?? $event['start_time'] ?? null;
    $end = $event['endTime'] ?? $event['end_time'] ?? null;
    if ($dept !== null) { $sql .= ' AND sp.dept_id = ? AND secp.dept_id = ?'; $types .= 'ii'; array_push($values, $dept, $dept); }
    if ($program !== null) { $sql .= ' AND sp.program_id = ? AND secp.program_id = ?'; $types .= 'ii'; array_push($values, $program, $program); }
    $ids = $event['teacherIds'] ?? $event['teacher_ids'] ?? [];
    if ($ids) { $sql .= ' AND cs.user_id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')'; $types .= str_repeat('i', count($ids)); array_push($values, ...$ids); }
    if ($start !== null) { $sql .= ' AND cs.start_time < ? AND cs.end_time > ?'; $types .= 'ss'; array_push($values, $end, $start); }
}

function calendar_event_has_protected_attendance(mysqli $db, array $event, array $teacherIds, bool $lock = false): bool {
    $sql = "SELECT ar.checked_in_at, ar.checked_mid_at, ar.checked_out_at, ar.flag_in_id, ar.flag_check_id, ar.flag_out_id
        FROM tbl_attendance_records ar
        JOIN tbl_class_schedules cs ON cs.schedule_id = ar.schedule_id
        JOIN tbl_subject subj ON subj.subject_id = cs.subject_id
        JOIN tbl_programs sp ON sp.program_id = subj.program_id
        JOIN tbl_sections sec ON sec.section_id = cs.section_id
        JOIN tbl_programs secp ON secp.program_id = sec.program_id
        WHERE ar.date BETWEEN ? AND ?";
    $types = 'ss'; $values = [$event['from'] ?? $event['date_from'], $event['to'] ?? $event['date_to']];
    $event['teacherIds'] = $teacherIds;
    calendar_event_append_scope_filter($sql, $types, $values, $event);
    if ($lock) $sql .= ' FOR UPDATE';
    $stmt = $db->prepare($sql); $stmt->bind_param($types, ...$values); $stmt->execute();
    $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC); $stmt->close();
    foreach ($rows as $row) {
        if ($row['checked_in_at'] || $row['checked_mid_at'] || $row['checked_out_at']) return true;
        foreach (['flag_in_id','flag_check_id','flag_out_id'] as $flag) if (!in_array((int)($row[$flag] ?? 1), [1,8], true)) return true;
    }
    return false;
}

function calendar_event_attach_coverage(mysqli $db, array $items): array {
    if (!$items) return [];
    $ids = implode(',', array_map(static fn($item) => (int)$item['event_id'], $items));
    $result = $db->query("SELECT cet.event_id, cet.user_id, CONCAT_WS(' ', u.first_name, u.last_name) AS name FROM tbl_calendar_event_teachers cet LEFT JOIN tbl_users u ON u.user_id=cet.user_id WHERE cet.event_id IN ({$ids}) ORDER BY cet.user_id");
    $teachers = [];
    while ($row = $result->fetch_assoc()) $teachers[(int)$row['event_id']][] = ['user_id'=>(int)$row['user_id'], 'name'=>$row['name'] ?: 'Deleted teaching account'];
    foreach ($items as &$item) {
        $item['teachers'] = $teachers[(int)$item['event_id']] ?? [];
        $item['teacher_ids'] = array_column($item['teachers'], 'user_id');
        $item['attendance_locked'] = calendar_event_has_protected_attendance($db, $item, $item['teacher_ids']);
    }
    unset($item); return $items;
}
