<?php
// server-php/scripts/cron_worker_lib.php
// Shared logic for cron/worker jobs that replace MySQL EVENTS:
// - DailyAcademicUpdate
// - RealTimeAttendanceManager

declare(strict_types=1);

require_once __DIR__ . '/../helpers/personal_notification_helper.php';

if (!function_exists('cw_log')) {
    function cw_log(string $message): void
    {
        $ts = date('Y-m-d H:i:s');
        $line = "[{$ts}] {$message}\n";
        echo $line;

        $logFile = getenv('CW_LOG_FILE');
        if (!is_string($logFile) || trim($logFile) === '') {
            $logFile = __DIR__ . '/../logs/academic-attendance-worker.log';
        }

        @file_put_contents($logFile, $line, FILE_APPEND);
    }
}

if (!function_exists('cw_bind_params')) {
    function cw_bind_params(mysqli_stmt $stmt, string $types, array &$params): bool
    {
        $refs = [];
        $refs[] = &$types;
        foreach ($params as $k => $v) {
            $refs[] = &$params[$k];
        }
        return (bool)call_user_func_array([$stmt, 'bind_param'], $refs);
    }
}

if (!function_exists('cw_absent_candidate_select_sql')) {
    function cw_absent_candidate_select_sql(string $whereClause): string
    {
        return "
            SELECT
                a.attendance_id,
                a.user_id,
                DATE_FORMAT(a.date, '%Y-%m-%d') AS date,
                a.flag_in_id,
                a.flag_check_id,
                a.flag_out_id,
                cs.start_time,
                cs.end_time,
                r.room_name,
                s.subject_code,
                s.subject_name,
                sec.section_name
            FROM tbl_attendance_records a
            JOIN tbl_class_schedules cs ON a.schedule_id = cs.schedule_id
            JOIN tbl_rooms r ON a.room_id = r.room_id
            LEFT JOIN tbl_subject s ON cs.subject_id = s.subject_id
            LEFT JOIN tbl_sections sec ON cs.section_id = sec.section_id
            {$whereClause}
        ";
    }
}

if (!function_exists('cw_get_absent_notification_candidates')) {
    function cw_get_absent_notification_candidates(mysqli $mysqli): array
    {
        $sql = cw_absent_candidate_select_sql("
            WHERE
                TIMESTAMP(a.date, cs.end_time) < NOW()
                AND (a.flag_in_id IN (1, 8) OR a.flag_check_id IN (1, 8) OR a.flag_out_id IN (1, 8))
        ");

        try {
            $res = $mysqli->query($sql);
        } catch (Throwable $e) {
            cw_log('[Worker][AbsentEmail] candidate select failed: ' . $e->getMessage());
            return [];
        }
        if (!$res) {
            cw_log('[Worker][AbsentEmail] candidate select failed: ' . $mysqli->error);
            return [];
        }

        $rows = [];
        while ($row = $res->fetch_assoc()) {
            $rows[(int)$row['attendance_id']] = $row;
        }
        return $rows;
    }
}

if (!function_exists('cw_get_attendance_rows_by_ids')) {
    function cw_get_attendance_rows_by_ids(mysqli $mysqli, array $ids): array
    {
        $cleanIds = [];
        foreach ($ids as $id) {
            $id = (int)$id;
            if ($id > 0) $cleanIds[$id] = true;
        }
        $cleanIds = array_keys($cleanIds);
        if (empty($cleanIds)) return [];

        $placeholders = implode(',', array_fill(0, count($cleanIds), '?'));
        $sql = cw_absent_candidate_select_sql("WHERE a.attendance_id IN ({$placeholders})");
        $stmt = $mysqli->prepare($sql);
        if (!$stmt) {
            cw_log('[Worker][AbsentEmail] post-update select prepare failed: ' . $mysqli->error);
            return [];
        }

        $types = str_repeat('i', count($cleanIds));
        $params = $cleanIds;
        cw_bind_params($stmt, $types, $params);
        if (!$stmt->execute()) {
            cw_log('[Worker][AbsentEmail] post-update select failed: ' . $stmt->error);
            $stmt->close();
            return [];
        }

        $rows = [];
        $res = $stmt->get_result();
        while ($row = $res->fetch_assoc()) {
            $rows[(int)$row['attendance_id']] = $row;
        }
        $stmt->close();
        return $rows;
    }
}

if (!function_exists('cw_send_absent_notifications')) {
    function cw_send_absent_notifications(mysqli $mysqli, array $beforeRows): array
    {
        if (empty($beforeRows)) {
            return ['sent' => 0, 'failed' => 0, 'skipped' => 0];
        }

        $afterRows = cw_get_attendance_rows_by_ids($mysqli, array_keys($beforeRows));
        $sent = 0;
        $failed = 0;
        $skipped = 0;

        foreach ($beforeRows as $attendanceId => $before) {
            $after = $afterRows[(int)$attendanceId] ?? null;
            if (!$after) {
                $skipped++;
                continue;
            }

            $missed = [];
            if (in_array((int)($before['flag_in_id'] ?? 0), [1, 8], true) && (int)($after['flag_in_id'] ?? 0) === 3) {
                $missed[] = 'check-in';
            }
            if (in_array((int)($before['flag_check_id'] ?? 0), [1, 8], true) && (int)($after['flag_check_id'] ?? 0) === 3) {
                $missed[] = 'middle check';
            }
            if (in_array((int)($before['flag_out_id'] ?? 0), [1, 8], true) && (int)($after['flag_out_id'] ?? 0) === 3) {
                $missed[] = 'check-out';
            }

            if (empty($missed)) {
                $skipped++;
                continue;
            }

            $lead = 'You missed scheduled attendance scan(s): ' . implode(', ', $missed) . '.';
            $result = personal_notif_send_attendance_event(
                $mysqli,
                $after,
                'ABSENT ALERT',
                'Missed attendance scan',
                $lead,
                new DateTime()
            );

            if (!empty($result['sent'])) {
                $sent++;
            } else {
                $failed++;
            }
        }

        return ['sent' => $sent, 'failed' => $failed, 'skipped' => $skipped];
    }
}

if (!function_exists('cw_run_sql')) {
    function cw_run_sql(mysqli $mysqli, string $sql): array
    {
        try {
            $ok = $mysqli->query($sql);
        } catch (Throwable $e) {
            return [
                'ok' => false,
                'affected_rows' => 0,
                'error' => $e->getMessage(),
            ];
        }
        if ($ok === false) {
            return [
                'ok' => false,
                'affected_rows' => 0,
                'error' => $mysqli->error,
            ];
        }

        return [
            'ok' => true,
            'affected_rows' => (int)$mysqli->affected_rows,
            'error' => null,
        ];
    }
}

if (!function_exists('cw_get_db_curdate')) {
    function cw_get_db_curdate(mysqli $mysqli): string
    {
        $res = $mysqli->query("SELECT CURDATE() AS d");
        if (!$res) {
            return date('Y-m-d');
        }
        $row = $res->fetch_assoc();
        return (string)($row['d'] ?? date('Y-m-d'));
    }
}

if (!function_exists('cw_daily_academic_update')) {
    function cw_daily_academic_update(mysqli $mysqli): array
    {
        // Mirrors MySQL EVENT DailyAcademicUpdate
        $sqlSchoolYear = "
            UPDATE tbl_school_year
            SET status = CASE
                WHEN CURDATE() BETWEEN start_date AND end_date THEN 'active'
                ELSE 'inactive'
            END
            WHERE status != 'archive'
        ";

        $sqlSemester = "
            UPDATE tbl_semesters
            SET status = CASE
                WHEN CURDATE() BETWEEN start_date AND end_date THEN 'active'
                ELSE 'inactive'
            END
            WHERE status != 'archive'
        ";

        $r1 = cw_run_sql($mysqli, $sqlSchoolYear);
        $r2 = cw_run_sql($mysqli, $sqlSemester);

        return [
            'ok' => ($r1['ok'] && $r2['ok']),
            'school_year_rows' => $r1['affected_rows'],
            'semester_rows' => $r2['affected_rows'],
            'errors' => array_values(array_filter([$r1['error'], $r2['error']])),
        ];
    }
}

if (!function_exists('cw_realtime_attendance_manager')) {
    function cw_realtime_attendance_manager(mysqli $mysqli): array
    {
        // Mirrors MySQL EVENT RealTimeAttendanceManager
        $insertSql = "
            INSERT INTO tbl_attendance_records (user_id, schedule_id, room_id, floor_id, date)
            SELECT cs.user_id, cs.schedule_id, cs.room_id, r.floor_id, DATE_ADD(CURDATE(), INTERVAL seq.n DAY)
            FROM (
                SELECT -7 AS n UNION ALL SELECT -6 UNION ALL SELECT -5 UNION ALL
                SELECT -4 UNION ALL SELECT -3 UNION ALL SELECT -2 UNION ALL
                SELECT -1 UNION ALL SELECT 0 UNION ALL SELECT 1 UNION ALL
                SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL
                SELECT 5 UNION ALL SELECT 6
            ) seq
            JOIN tbl_class_schedules cs
            JOIN tbl_rooms r ON cs.room_id = r.room_id
            JOIN tbl_semesters sem ON cs.semester_id = sem.semester_id
            WHERE sem.status = 'active'
              AND DATE_ADD(CURDATE(), INTERVAL seq.n DAY) BETWEEN sem.start_date AND sem.end_date
              AND cs.day_of_week = LOWER(DAYNAME(DATE_ADD(CURDATE(), INTERVAL seq.n DAY)))
              AND NOT EXISTS (
                  SELECT 1 FROM tbl_attendance_records ar
                  WHERE ar.schedule_id = cs.schedule_id
                  AND ar.date = DATE_ADD(CURDATE(), INTERVAL seq.n DAY)
              )
        ";

        $markPendingSql = "
            UPDATE tbl_attendance_records a
            JOIN tbl_class_schedules s ON a.schedule_id = s.schedule_id
            SET
                a.flag_in_id = IF(a.flag_in_id = 1, 8, a.flag_in_id),
                a.flag_check_id = IF(a.flag_check_id = 1, 8, a.flag_check_id),
                a.flag_out_id = IF(a.flag_out_id = 1, 8, a.flag_out_id)
            WHERE
                TIMESTAMP(a.date, s.start_time) <= NOW()
                AND TIMESTAMP(a.date, s.end_time) >= NOW()
                AND (a.flag_in_id = 1 OR a.flag_check_id = 1 OR a.flag_out_id = 1)
        ";

        $autoAbsentSql = "
            UPDATE tbl_attendance_records a
            JOIN tbl_class_schedules s ON a.schedule_id = s.schedule_id
            SET
                a.flag_in_id = IF(a.flag_in_id IN (1, 8), 3, a.flag_in_id),
                a.flag_check_id = IF(a.flag_check_id IN (1, 8), 3, a.flag_check_id),
                a.flag_out_id = IF(a.flag_out_id IN (1, 8), 3, a.flag_out_id)
            WHERE
                TIMESTAMP(a.date, s.end_time) < NOW()
                AND (a.flag_in_id IN (1, 8) OR a.flag_check_id IN (1, 8) OR a.flag_out_id IN (1, 8))
        ";

        $absentCandidates = cw_get_absent_notification_candidates($mysqli);
        $r1 = cw_run_sql($mysqli, $insertSql);
        $rPending = cw_run_sql($mysqli, $markPendingSql);
        $r2 = cw_run_sql($mysqli, $autoAbsentSql);
        $absentNotifications = ['sent' => 0, 'failed' => 0, 'skipped' => 0];
        if ($r2['ok'] && (int)$r2['affected_rows'] > 0 && !empty($absentCandidates)) {
            $absentNotifications = cw_send_absent_notifications($mysqli, $absentCandidates);
        }

        return [
            'ok' => ($r1['ok'] && $rPending['ok'] && $r2['ok']),
            'generated_rows' => $r1['affected_rows'],
            'pending_rows' => $rPending['affected_rows'],
            'auto_absent_rows' => $r2['affected_rows'],
            'absent_notifications' => $absentNotifications,
            'errors' => array_values(array_filter([$r1['error'], $rPending['error'], $r2['error']])),
        ];
    }
}
