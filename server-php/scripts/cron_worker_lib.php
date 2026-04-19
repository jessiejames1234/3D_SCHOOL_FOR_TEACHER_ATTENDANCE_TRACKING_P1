<?php
// server-php/scripts/cron_worker_lib.php
// Shared logic for cron/worker jobs that replace MySQL EVENTS:
// - DailyAcademicUpdate
// - RealTimeAttendanceManager

declare(strict_types=1);

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

if (!function_exists('cw_run_sql')) {
    function cw_run_sql(mysqli $mysqli, string $sql): array
    {
        $ok = $mysqli->query($sql);
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

        $autoAbsentSql = "
            UPDATE tbl_attendance_records a
            JOIN tbl_class_schedules s ON a.schedule_id = s.schedule_id
            SET
                a.flag_in_id = IF(a.flag_in_id = 1, 3, a.flag_in_id),
                a.flag_check_id = IF(a.flag_check_id = 1, 3, a.flag_check_id),
                a.flag_out_id = IF(a.flag_out_id = 1, 3, a.flag_out_id)
            WHERE
                TIMESTAMP(a.date, s.end_time) < NOW()
                AND (a.flag_in_id = 1 OR a.flag_check_id = 1 OR a.flag_out_id = 1)
        ";

        $r1 = cw_run_sql($mysqli, $insertSql);
        $r2 = cw_run_sql($mysqli, $autoAbsentSql);

        return [
            'ok' => ($r1['ok'] && $r2['ok']),
            'generated_rows' => $r1['affected_rows'],
            'auto_absent_rows' => $r2['affected_rows'],
            'errors' => array_values(array_filter([$r1['error'], $r2['error']])),
        ];
    }
}
