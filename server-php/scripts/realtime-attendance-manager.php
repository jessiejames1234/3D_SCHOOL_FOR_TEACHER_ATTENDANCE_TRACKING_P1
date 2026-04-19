<?php
// server-php/scripts/realtime-attendance-manager.php
// One-shot job equivalent to MySQL EVENT RealTimeAttendanceManager.

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    echo "CLI only.\n";
    exit(1);
}

require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/cron_worker_lib.php';

cw_log('[RealTimeAttendanceManager] tick start');

$result = cw_realtime_attendance_manager($mysqli);
if (!$result['ok']) {
    cw_log('[RealTimeAttendanceManager] failed: ' . implode(' | ', $result['errors']));
    exit(1);
}

cw_log(
    '[RealTimeAttendanceManager] success'
    . ' generated_rows=' . (int)$result['generated_rows']
    . ' auto_absent_rows=' . (int)$result['auto_absent_rows']
);

exit(0);

