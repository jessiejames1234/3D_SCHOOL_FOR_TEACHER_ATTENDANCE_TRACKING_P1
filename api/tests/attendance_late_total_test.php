<?php
require __DIR__ . '/../helpers/attendance_late_helper.php';
date_default_timezone_set('Asia/Manila');
$record = ['date'=>'2026-10-13','start_time'=>'13:00:00','end_time'=>'14:00:00','flag_in'=>'Late','flag_check'=>'Late','checked_in_at'=>'2026-10-13 13:30:30','checked_mid_at'=>'2026-10-13 13:48:00'];
$checks = 0;
foreach ([
    [$record,1410],
    [array_replace($record,['checked_in_at'=>'2026-10-13 13:15:00','checked_mid_at'=>'2026-10-13 13:40:00']),0],
    [array_replace($record,['checked_in_at'=>'2026-10-13 13:15:01','checked_mid_at'=>'2026-10-13 13:40:01']),2],
    [array_replace($record,['flag_in'=>'Present','flag_check'=>'Present']),0],
    [array_replace($record,['checked_in_at'=>null,'checked_mid_at'=>null]),0],
    [array_replace($record,['end_time'=>'']),930],
    [array_replace($record,['checked_mid_at'=>'invalid timestamp']),930],
    [array_replace($record,['flag_out'=>'Late','checked_out_at'=>'2026-10-13 15:00:00']),1410],
] as [$input,$expected]) {
    if (attendance_record_late_seconds($input)!==$expected) throw new RuntimeException('Late-minute policy calculation failed.');
    $checks++;
}
echo "PASS {$checks} late-total policy checks (both checkpoints, grace boundaries, missing timestamps, and checkout exclusion).\n";
