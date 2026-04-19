<?php
// server-php/scripts/update-missed-attendance.php

// This script is meant to be run from the command line by a cron job.
// It should be run frequently, for example, every minute.
// Example cron job: */1 * * * * /usr/bin/php /path/to/your/project/server-php/scripts/update-missed-attendance.php

require_once __DIR__ . '/../config/database.php';

echo "[CRON] Checking for missed attendance records at " . date('Y-m-d H:i:s') . "\n";

// Toggle: set to true to enable automatic marking of missed attendance as absent
// Enable automatic absent marking to match attendanceRoutes.js behavior
$AUTO_MARK_ABSENT = true;
if (!$AUTO_MARK_ABSENT) {
    echo "[CRON] Auto-mark absent is DISABLED by configuration. No changes will be performed.\n";
    exit;
}

// Debug: print DB now and timezone info to help diagnose timing mismatches
try {
    $tzRes = $mysqli->query("SELECT NOW() AS now_ts, @@session.time_zone AS session_tz, @@global.time_zone AS global_tz");
    if ($tzRes) {
        $tzRow = $tzRes->fetch_assoc();
        echo "[CRON] DB NOW={$tzRow['now_ts']} session_tz={$tzRow['session_tz']} global_tz={$tzRow['global_tz']} PHP_NOW=" . date('Y-m-d H:i:s') . "\n";
    }
} catch (Exception $e) {
    // ignore
}

try {
    $sql = "
        SELECT ar.attendance_id 
        FROM tbl_attendance_records ar 
        JOIN tbl_class_schedules cs ON ar.schedule_id = cs.schedule_id 
        WHERE (ar.flag_in_id = 1 OR ar.flag_check_id = 1 OR ar.flag_out_id = 1) 
          AND TIMESTAMP(ar.date, cs.end_time) < NOW()
    ";

    $result = $mysqli->query($sql);
    if (!$result) {
        echo "[CRON] SELECT failed: " . $mysqli->error . "\n";
        exit;
    }

    // Debug: show candidate count and sample IDs
    $candidate_count = $result->num_rows;
    echo "[CRON] Candidate rows found: " . $candidate_count . "\n";
    if ($candidate_count > 0) {
        $sampleIds = [];
        while ($row = $result->fetch_assoc()) {
            $sampleIds[] = $row['attendance_id'];
            if (count($sampleIds) >= 20) break; // limit sample
        }
        echo "[CRON] Sample candidate IDs: " . implode(',', $sampleIds) . "\n";
        // Re-run query to fetch all ids for update since we consumed some rows
        $result = $mysqli->query($sql);
    }

    if (!$result || $result->num_rows === 0) {
        echo "[CRON] No records to update.\n";
        exit;
    }

    $ids = [];
    while ($row = $result->fetch_assoc()) {
        $ids[] = $row['attendance_id'];
    }

    if (empty($ids)) {
        echo "[CRON] No IDs found to update.\n";
        exit;
    }
    
    $id_list = implode(',', $ids);

    echo "[CRON] Updating attendance IDs: " . $id_list . "\n";

    $update_sql = "
        UPDATE tbl_attendance_records 
        SET 
            flag_in_id = CASE WHEN flag_in_id = 1 THEN 3 ELSE flag_in_id END, 
            flag_check_id = CASE WHEN flag_check_id = 1 THEN 3 ELSE flag_check_id END, 
            flag_out_id = CASE WHEN flag_out_id = 1 THEN 3 ELSE flag_out_id END 
        WHERE attendance_id IN ($id_list)
    ";

    $update_result = $mysqli->query($update_sql);

    if ($update_result) {
        echo "[CRON] Successfully updated " . $mysqli->affected_rows . " records.\n";
    } else {
        echo "[CRON] Error updating records: " . $mysqli->error . "\n";
    }

} catch (Exception $e) {
    echo "[CRON] An exception occurred: " . $e->getMessage() . "\n";
}

