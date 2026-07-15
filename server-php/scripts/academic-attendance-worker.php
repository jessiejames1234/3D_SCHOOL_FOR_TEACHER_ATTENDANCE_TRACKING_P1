<?php
// server-php/scripts/academic-attendance-worker.php
// Long-running worker that replaces both MySQL EVENTS:
// - DailyAcademicUpdate (academic status sync every 5 minutes by default)
// - RealTimeAttendanceManager (runs every N seconds, default 5)

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    echo "CLI only.\n";
    exit(1);
}

require_once __DIR__ . '/cron_worker_lib.php';

if (!function_exists('aw_connect_db')) {
    function aw_connect_db(): mysqli
    {
        $mysqli = null;
        include __DIR__ . '/../config/database.php';
        if (!($mysqli instanceof mysqli)) {
            throw new RuntimeException('Unable to initialize mysqli connection.');
        }
        return $mysqli;
    }
}

if (!function_exists('aw_ensure_single_instance')) {
    function aw_ensure_single_instance(string $lockPath)
    {
        $lockDir = dirname($lockPath);
        if (!is_dir($lockDir) && !@mkdir($lockDir, 0777, true) && !is_dir($lockDir)) {
            throw new RuntimeException('Unable to create lock directory: ' . $lockDir);
        }

        $lockHandle = @fopen($lockPath, 'c+');
        if ($lockHandle === false) {
            throw new RuntimeException('Unable to open lock file: ' . $lockPath);
        }

        if (!@flock($lockHandle, LOCK_EX | LOCK_NB)) {
            @fclose($lockHandle);
            cw_log('[Worker] another worker instance is already running; exiting.');
            exit(0);
        }

        @ftruncate($lockHandle, 0);
        @fwrite($lockHandle, (string)getmypid());
        @fflush($lockHandle);

        return $lockHandle;
    }
}

if (!function_exists('aw_connection_alive')) {
    function aw_connection_alive(mysqli $mysqli): bool
    {
        try {
            return (bool)$mysqli->ping();
        } catch (Throwable $e) {
            cw_log('[Worker] ping failed: ' . $e->getMessage());
            return false;
        }
    }
}

$intervalSeconds = 5;
$academicSyncIntervalSeconds = 300;
$runOnce = false;

foreach (array_slice($argv, 1) as $arg) {
    if ($arg === '--once') {
        $runOnce = true;
        continue;
    }
    if (strpos($arg, '--interval=') === 0) {
        $v = (int)substr($arg, strlen('--interval='));
        if ($v > 0) {
            $intervalSeconds = $v;
        }
    }
}

$lockPath = __DIR__ . '/../logs/academic-attendance-worker.lock';
$lockHandle = aw_ensure_single_instance($lockPath);
register_shutdown_function(static function () use (&$lockHandle): void {
    if (is_resource($lockHandle)) {
        @flock($lockHandle, LOCK_UN);
        @fclose($lockHandle);
    }
});

$mysqli = aw_connect_db();

cw_log('[Worker] start interval=' . $intervalSeconds . 's run_once=' . ($runOnce ? 'yes' : 'no'));

$nextAcademicSyncAt = 0;
while (true) {
    try {
        if (!aw_connection_alive($mysqli)) {
            cw_log('[Worker] database connection lost; reconnecting.');
            $mysqli = aw_connect_db();
            cw_log('[Worker] database reconnect successful.');
        }

        $now = time();
        if ($runOnce || $now >= $nextAcademicSyncAt) {
            $daily = cw_daily_academic_update($mysqli);
            if (!$daily['ok']) {
                cw_log('[Worker][AcademicStatusSync] failed: ' . implode(' | ', $daily['errors']));
            } else {
                cw_log(
                    '[Worker][AcademicStatusSync] success'
                    . ' school_year_rows=' . (int)$daily['school_year_rows']
                    . ' semester_rows=' . (int)$daily['semester_rows']
                );
            }
            $nextAcademicSyncAt = $now + $academicSyncIntervalSeconds;
        }

        $realtime = cw_realtime_attendance_manager($mysqli);
        if (!$realtime['ok']) {
            cw_log('[Worker][RealTimeAttendanceManager] failed: ' . implode(' | ', $realtime['errors']));
        } else {
            $absentNotifications = $realtime['absent_notifications'] ?? ['sent' => 0, 'failed' => 0, 'skipped' => 0];
            cw_log(
                '[Worker][RealTimeAttendanceManager] success'
                . ' generated_rows=' . (int)$realtime['generated_rows']
                . ' pending_rows=' . (int)($realtime['pending_rows'] ?? 0)
                . ' auto_absent_rows=' . (int)$realtime['auto_absent_rows']
                . ' absent_email_sent=' . (int)($absentNotifications['sent'] ?? 0)
                . ' absent_email_failed=' . (int)($absentNotifications['failed'] ?? 0)
                . ' absent_email_skipped=' . (int)($absentNotifications['skipped'] ?? 0)
            );
        }
    } catch (Throwable $e) {
        cw_log('[Worker] exception: ' . $e->getMessage());
    }

    if ($runOnce) {
        break;
    }

    sleep($intervalSeconds);
}

@$mysqli->close();
cw_log('[Worker] stopped');
exit(0);
