<?php
require_once __DIR__ . '/schedule_edit_helper.php';

/** Resolve a snapshot, including the old room/time before an edit. */
function schedule_notification_snapshot($mysqli, array $state) {
    $subjectId = (int)$state['subject_id'];
    $sectionId = (int)$state['section_id'];
    $roomId = (int)$state['room_id'];
    $semesterId = (int)$state['semester_id'];
    $labels = [];
    try {
        $result = $mysqli->query("SELECT s.subject_code, s.subject_name, sec.section_name, r.room_name, sem.term, sy.session_name
            FROM tbl_subject s
            LEFT JOIN tbl_sections sec ON sec.section_id = {$sectionId}
            LEFT JOIN tbl_rooms r ON r.room_id = {$roomId}
            LEFT JOIN tbl_semesters sem ON sem.semester_id = {$semesterId}
            LEFT JOIN tbl_school_year sy ON sy.school_year_id = sem.school_year_id
            WHERE s.subject_id = {$subjectId} LIMIT 1");
        if ($result) $labels = $result->fetch_assoc() ?: [];
    } catch (Throwable $error) {
        error_log('[schedule_notification] Snapshot labels unavailable: ' . $error->getMessage());
    }
    $short = function($value) {
        $text = trim(preg_replace('/\s+/', ' ', (string)$value));
        return function_exists('mb_strimwidth') ? mb_strimwidth($text, 0, 65, '...', 'UTF-8') : substr($text, 0, 65);
    };
    $subject = trim(($labels['subject_code'] ?? '') . ' ' . ($labels['subject_name'] ?? ''));
    $term = trim(($labels['term'] ?? '') . ' ' . ($labels['session_name'] ?? ''));
    return implode(' | ', [
        'Subject: ' . $short($subject ?: '#' . $subjectId),
        'Section: ' . $short($labels['section_name'] ?? '#' . $sectionId),
        'Room: ' . $short($labels['room_name'] ?? '#' . $roomId),
        ucfirst($state['day_of_week']) . ' ' . substr($state['start_time'], 0, 5) . '-' . substr($state['end_time'], 0, 5),
        'Semester: ' . $short($term ?: '#' . $semesterId),
    ]);
}

/** Call after the edit transaction commits; delivery must not fail the save. */
function schedule_notify_updated($mysqli, $scheduleId, array $before, array $after, $actorUserId = null) {
    $before = schedule_edit_normalize_state($before);
    $after = schedule_edit_normalize_state($after);
    if ((int)$scheduleId <= 0 || $before === $after) return 0;
    $oldTeacher = $before['user_id'];
    $newTeacher = $after['user_id'];
    $oldDetails = schedule_notification_snapshot($mysqli, $before);
    $newDetails = schedule_notification_snapshot($mysqli, $after);
    $recipients = [];
    if ($oldTeacher === $newTeacher) {
        $recipients[$newTeacher] = ['Class schedule updated', "Your class schedule was updated. Before: {$oldDetails}. After: {$newDetails}."];
    } else {
        $recipients[$oldTeacher] = ['Class schedule reassigned', "This class schedule is no longer assigned to you: {$oldDetails}."];
        $recipients[$newTeacher] = ['Class schedule assigned to you', "A class schedule was reassigned to you: {$newDetails}."];
    }
    $notified = 0;
    foreach ($recipients as $teacherId => [$title, $message]) {
        if ($teacherId <= 0) continue;
        try {
            $message .= ' Open Teaching Schedule to review your current classes.';
            if (notif_insert($mysqli, $teacherId, $title, $message, '/Teaching_Schedule', $actorUserId)) {
                $notified++;
            } else {
                error_log('[schedule_notification] Edit notification could not be saved for user_id=' . $teacherId);
            }
        } catch (Throwable $error) {
            error_log('[schedule_notification] Edit notification failed for user_id=' . $teacherId . ': ' . $error->getMessage());
        }
    }
    return $notified;
}

// The caller loads notification_helper.php, which provides all three channels.
// Call only after creation succeeds and any import transaction has committed.
function schedule_notify_created($mysqli, $scheduleIds, $actorUserId = null) {
    $ids = array_values(array_unique(array_filter(array_map('intval', (array)$scheduleIds), function($id) {
        return $id > 0;
    })));
    if (!$ids) return 0;

    try {
        $result = $mysqli->query("SELECT cs.schedule_id, cs.user_id, cs.day_of_week, cs.start_time, cs.end_time,
                s.subject_code, s.subject_name, sec.section_name, r.room_name,
                sem.term, sy.session_name
            FROM tbl_class_schedules cs
            LEFT JOIN tbl_subject s ON s.subject_id = cs.subject_id
            LEFT JOIN tbl_sections sec ON sec.section_id = cs.section_id
            LEFT JOIN tbl_rooms r ON r.room_id = cs.room_id
            LEFT JOIN tbl_semesters sem ON sem.semester_id = cs.semester_id
            LEFT JOIN tbl_school_year sy ON sy.school_year_id = sem.school_year_id
            WHERE cs.schedule_id IN (" . implode(',', $ids) . ")
            ORDER BY cs.user_id, cs.schedule_id");
        if (!$result) throw new RuntimeException('Could not load saved schedules');
        $byTeacher = [];
        while ($row = $result->fetch_assoc()) {
            $teacherId = (int)$row['user_id'];
            if ($teacherId > 0) $byTeacher[$teacherId][] = $row;
        }
    } catch (Throwable $error) {
        error_log('[schedule_notification] Could not load created schedules: ' . $error->getMessage());
        return 0;
    }

    $notified = 0;
    foreach ($byTeacher as $teacherId => $schedules) {
        try {
            $count = count($schedules);
            $title = $count === 1 ? 'New class schedule assigned' : 'New class schedules assigned';
            $message = $count === 1 ? 'A new class schedule has been assigned to you.' : "{$count} new class schedules have been assigned to you.";
            foreach ($schedules as $index => $schedule) {
                $subject = trim((string)($schedule['subject_code'] ?? '') . ' ' . (string)($schedule['subject_name'] ?? ''));
                $term = trim((string)($schedule['term'] ?? '') . ' ' . (string)($schedule['session_name'] ?? ''));
                $details = implode(' | ', array_filter([
                    $subject !== '' ? 'Subject: ' . $subject : '',
                    'Section: ' . ($schedule['section_name'] ?? 'Unspecified'),
                    'Room: ' . ($schedule['room_name'] ?? 'Unspecified'),
                    ucfirst((string)$schedule['day_of_week']) . ' ' . substr((string)$schedule['start_time'], 0, 5) . '-' . substr((string)$schedule['end_time'], 0, 5),
                    $term !== '' ? 'Semester: ' . $term : '',
                ]));
                // Keep the summary within the email helper's 1000-character limit.
                $suffix = ' Open Teaching Schedule to view all assigned classes.';
                if (strlen($message . ' ' . $details . $suffix) > 900) {
                    $remaining = $count - $index;
                    $message .= " {$remaining} additional schedule(s).";
                    break;
                }
                $message .= ' ' . $details . '.';
            }
            $message .= ' Open Teaching Schedule to view all assigned classes.';
            // One summary per teacher per request; notif_insert saves the website
            // notification and attempts email and push through the existing helpers.
            if (notif_insert($mysqli, $teacherId, $title, $message, '/Teaching_Schedule', $actorUserId)) {
                $notified++;
            } else {
                error_log('[schedule_notification] Notification could not be saved for user_id=' . $teacherId);
            }
        } catch (Throwable $error) {
            // Delivery problems must not turn an already saved schedule into a failed save.
            error_log('[schedule_notification] Delivery failed for user_id=' . $teacherId . ': ' . $error->getMessage());
        }
    }
    return $notified;
}
