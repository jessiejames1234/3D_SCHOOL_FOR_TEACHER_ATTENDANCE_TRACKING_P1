<?php
// server-php/scripts/generate-weekly-attendance.php

// This script is meant to be run from the command line by a cron job.
// Example cron job: 0 3 * * 1 /usr/bin/php /path/to/your/project/server-php/scripts/generate-weekly-attendance.php








// require_once __DIR__ . '/../config/database.php';
// require_once __DIR__ . '/../helpers/functions.php';
// // We need to include the attendance API file to get the generation function
// require_once __DIR__ . '/../api/attendance.php';


// echo "[CRON] Starting weekly attendance generation at " . date('Y-m-d H:i:s') . "\n";

// try {
//     // Calling the function with null arguments will make it use the default (next 7 days)
//     $result = generateAttendanceWeek(null, null);
    
//     echo "[CRON] Done. Inserted " . $result['inserted'] . " rows for range " . $result['rangeStart'] . " to " . $result['rangeEnd'] . ".\n";
// } catch (Exception $e) {
//     echo "[CRON] Error generating weekly attendance: " . $e->getMessage() . "\n";
// }

