<?php

// Match the Check In and Mid Check late labels; checkout does not add lateness.
function attendance_record_late_seconds(array $record): int {
    $date = (string)($record['date'] ?? '');
    $start = strtotime($date . ' ' . ($record['start_time'] ?? ''));
    $end = strtotime($date . ' ' . ($record['end_time'] ?? ''));
    if ($date === '' || empty($record['start_time']) || $start === false) return 0;
    $total = 0;
    foreach (['in'=>['flag_in','checked_in_at'], 'mid'=>['flag_check','checked_mid_at']] as $stage=>$fields) {
        if (strtolower(trim((string)($record[$fields[0]] ?? ''))) !== 'late' || empty($record[$fields[1]])) continue;
        if ($stage === 'mid' && (empty($record['end_time']) || $end === false)) continue;
        $scan = strtotime((string)$record[$fields[1]]);
        $cutoff = $stage === 'in' ? $start + 15 * 60 : $start + ($end - $start) / 2 + 10 * 60;
        if ($scan !== false && $scan > $cutoff) $total += (int)floor($scan - $cutoff);
    }
    return $total;
}
