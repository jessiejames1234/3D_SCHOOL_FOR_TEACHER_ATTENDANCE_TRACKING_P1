<?php
// server-php/scripts/daily-academic-update.php
// One-shot job equivalent to MySQL EVENT DailyAcademicUpdate.

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    echo "CLI only.\n";
    exit(1);
}

require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/cron_worker_lib.php';

cw_log('[DailyAcademicUpdate] start');

$result = cw_daily_academic_update($mysqli);
if (!$result['ok']) {
    cw_log('[DailyAcademicUpdate] failed: ' . implode(' | ', $result['errors']));
    exit(1);
}

cw_log(
    '[DailyAcademicUpdate] success'
    . ' school_year_rows=' . (int)$result['school_year_rows']
    . ' semester_rows=' . (int)$result['semester_rows']
);

exit(0);

