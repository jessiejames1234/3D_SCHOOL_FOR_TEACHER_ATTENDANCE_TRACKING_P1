<?php
// No real notification records, emails, or push deliveries are produced.
require_once __DIR__ . '/../helpers/schedule_notification_helper.php';
$notifications = [];
$failTeacher = null;
function notif_insert($mysqli, $userId, $title, $message, $link, $actorUserId) {
    global $notifications, $failTeacher;
    if ($userId === $failTeacher) throw new RuntimeException('Simulated delivery failure');
    $notifications[] = compact('userId', 'title', 'message', 'link', 'actorUserId');
    return true;
}
function log_system_action($mysqli, $userId, $action, $details) {}
function schedule_test_check($condition, $message) {
    if (!$condition) throw new RuntimeException($message);
}
class ScheduleTestResult {
    private $rows;
    function __construct($rows) { $this->rows = $rows; }
    function fetch_assoc() { return array_shift($this->rows); }
}
class ScheduleTestDatabase {
    public $rows = [];
    public $queries = [];
    function query($sql) {
        $this->queries[] = $sql;
        return new ScheduleTestResult($this->rows);
    }
}
$mysqli = new ScheduleTestDatabase();
$row = [
    'schedule_id' => 101, 'user_id' => 11, 'subject_code' => 'IT101',
    'subject_name' => 'Programming', 'section_name' => 'BSIT 1A', 'room_name' => 'Room 201',
    'day_of_week' => 'monday', 'start_time' => '08:00:00', 'end_time' => '09:00:00',
    'term' => 'First Semester', 'session_name' => '2026-2027',
];
$mysqli->rows = [$row];
schedule_test_check(schedule_notify_created($mysqli, [101, 101, 0, -1], 99) === 1, 'Single notification missing');
schedule_test_check(strpos($mysqli->queries[0], 'IN (101)') !== false, 'IDs were not filtered and deduplicated');
schedule_test_check($notifications[0]['userId'] === 11 && $notifications[0]['actorUserId'] === 99, 'Incorrect recipient or actor');
schedule_test_check($notifications[0]['link'] === '/Teaching_Schedule', 'Incorrect teacher destination');
foreach (['IT101', 'Programming', 'BSIT 1A', 'Room 201', 'Monday 08:00-09:00', '2026-2027'] as $detail) {
    schedule_test_check(strpos($notifications[0]['message'], $detail) !== false, 'Schedule details missing');
}

$notifications = [];
$mysqli->rows = [$row, array_replace($row, ['schedule_id' => 102]), array_replace($row, ['schedule_id' => 103, 'user_id' => 22, 'subject_code' => 'OTHER'])];
schedule_test_check(schedule_notify_created($mysqli, [101, 102, 103], 99) === 2, 'Expected one summary per teacher');
schedule_test_check(strpos($notifications[0]['message'], '2 new class schedules') !== false, 'Batch count missing');
schedule_test_check(strpos($notifications[0]['message'], 'OTHER') === false, 'Another teacher schedule leaked');

$notifications = [];
$failTeacher = 11;
schedule_test_check(schedule_notify_created($mysqli, [101, 102, 103], 99) === 1, 'Failure prevented another teacher notification');
schedule_test_check($notifications[0]['userId'] === 22, 'Wrong remaining teacher');
$failTeacher = null;
$before = count($mysqli->queries);
schedule_test_check(schedule_notify_created($mysqli, [], 99) === 0 && count($mysqli->queries) === $before, 'Empty save sent notifications');

// Exercise the exact batch hook in main.php for previews and real saves.
$source = file_get_contents(__DIR__ . '/../api/main.php');
$start = strpos($source, '            if (!$previewOnly && $inserted > 0) {');
$end = strpos($source, "\n            json_response([", $start);
schedule_test_check($start !== false && $end !== false, 'Batch hook missing');
$hook = substr($source, $start, $end - $start);
$authUserId = 99; $spreadsheetImport = true; $attendanceSync = ['generated_rows' => 0];
$createdScheduleIds = [101]; $mysqli->rows = [$row];
foreach ([[true, 1, 0], [false, 0, 0], [false, 1, 1]] as $case) {
    [$previewOnly, $inserted, $expected] = $case;
    $notifications = [];
    eval($hook);
    schedule_test_check(count($notifications) === $expected, 'Preview or empty batch sent notifications');
}
schedule_test_check(strpos($source, 'schedule_notify_created($mysqli, [$newScheduleId], $authUserId);') !== false, 'Single creation hook missing');
schedule_test_check(strrpos(substr($source, 0, $start), '$mysqli->commit();') !== false, 'Import commit must precede notifications');

$state = [
    'user_id' => 11, 'subject_id' => 1, 'section_id' => 2, 'room_id' => 3, 'semester_id' => 4,
    'day_of_week' => 'Monday', 'start_time' => '08:00', 'end_time' => '09:00',
];
$after = array_replace($state, ['room_id' => 9, 'start_time' => '10:00', 'end_time' => '11:00']);
$mysqli->rows = [$row];
$notifications = [];
schedule_test_check(schedule_notify_updated($mysqli, 101, $state, $after, 99) === 1, 'Edit notification missing');
schedule_test_check($notifications[0]['userId'] === 11 && $notifications[0]['actorUserId'] === 99, 'Edit recipient or actor incorrect');
schedule_test_check(strpos($notifications[0]['message'], 'Monday 08:00-09:00') !== false && strpos($notifications[0]['message'], 'Monday 10:00-11:00') !== false, 'Before/after details missing');
schedule_test_check(strlen($notifications[0]['message']) < 1000, 'Edit message exceeds email detail limit');
$notifications = [];
schedule_test_check(schedule_notify_updated($mysqli, 101, $state, array_replace($state, ['day_of_week' => 'monday', 'start_time' => '08:00:00', 'end_time' => '09:00:00']), 99) === 0, 'Unchanged save sent alerts');
schedule_test_check(count($notifications) === 0, 'Unchanged save emitted notification');
$reassigned = array_replace($after, ['user_id' => 22]);
schedule_test_check(schedule_notify_updated($mysqli, 101, $state, $reassigned, 99) === 2, 'Both teachers must receive reassignment alerts');
schedule_test_check($notifications[0]['userId'] === 11 && strpos($notifications[0]['message'], 'no longer assigned') !== false, 'Previous teacher alert incorrect');
schedule_test_check($notifications[1]['userId'] === 22 && strpos($notifications[1]['message'], 'reassigned to you') !== false, 'New teacher alert incorrect');
schedule_test_check($notifications[1]['link'] === '/Teaching_Schedule', 'Edit alert destination incorrect');
$notifications = []; $failTeacher = 11;
schedule_test_check(schedule_notify_updated($mysqli, 101, $state, $reassigned, 99) === 1 && $notifications[0]['userId'] === 22, 'Edit failure prevented new teacher alert');
$failTeacher = null;
schedule_test_check(strpos($source, 'schedule_notify_updated($mysqli, $scheduleId, $beforeState, $afterState, $authUserId);') !== false, 'Edit hook missing');

if (in_array('--database', $argv, true)) {
    // Validate the real joins against existing data, using the fake delivery above.
    require __DIR__ . '/../config/database.php';
    $result = $mysqli->query('SELECT schedule_id FROM tbl_class_schedules ORDER BY schedule_id DESC LIMIT 2');
    $ids = [];
    while ($saved = $result->fetch_assoc()) $ids[] = (int)$saved['schedule_id'];
    $notifications = [];
    $count = schedule_notify_created($mysqli, $ids, 99);
    schedule_test_check(!$ids || $count > 0, 'Real schedule lookup failed');
    echo "Read-only database lookup passed; delivery was stubbed.\n";
}
echo "Schedule recipient, summary, failure-isolation, and preview checks passed.\n";
