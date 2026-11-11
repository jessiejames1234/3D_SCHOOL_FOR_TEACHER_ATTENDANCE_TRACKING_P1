<?php
require __DIR__ . '/../config/database.php';
require __DIR__ . '/../helpers/calendar_event_helper.php';
$checks = 0;
function event_check($condition, $message) {
    global $checks;
    if (!$condition) throw new RuntimeException($message);
    $checks++;
}
event_check(calendar_event_validate_times([]) === [null,null], 'Blank times must mean all day.');
event_check(calendar_event_validate_times(['start_time'=>'13:00','end_time'=>'15:00']) === ['13:00:00','15:00:00'], 'Times must normalize.');
foreach ([['start_time'=>'13:00'],['end_time'=>'15:00'],['start_time'=>'15:00','end_time'=>'13:00'],['start_time'=>'13:00','end_time'=>'13:00'],['start_time'=>'25:00','end_time'=>'26:00']] as $times) {
    try { calendar_event_validate_times($times); throw new RuntimeException('Invalid time accepted.'); }
    catch (InvalidArgumentException $error) { $checks++; }
}
event_check(calendar_event_normalize_teacher_ids(['11',10,10]) === [10,11], 'Teacher IDs must be unique and sorted.');
foreach (['10',[0],['10 OR 1=1'],[-1],[true]] as $ids) {
    try { calendar_event_normalize_teacher_ids($ids); throw new RuntimeException('Invalid teacher accepted.'); }
    catch (InvalidArgumentException $error) { $checks++; }
}
$teacher=['role_id'=>5,'status'=>'active','dept_id'=>1,'assigned_program_head_id'=>1];
event_check(calendar_event_teacher_matches_scope($teacher,6,1,1,1), 'Own-department teacher rejected.');
event_check(!calendar_event_teacher_matches_scope($teacher,6,2,null,null), 'Cross-department teacher accepted.');
event_check(!calendar_event_teacher_matches_scope($teacher,1,0,1,2), 'Wrong-program teacher accepted.');
event_check(calendar_event_teacher_matches_scope($teacher,1,0,null,null), 'Admin all-department selection rejected.');
foreach ([1,6] as $role) event_check(!calendar_event_teacher_matches_scope(array_replace($teacher,['role_id'=>$role]),1,0,null,null), 'Non-teaching role accepted.');
event_check(!calendar_event_teacher_matches_scope(array_replace($teacher,['status'=>'inactive']),1,0,null,null), 'Inactive account accepted.');

// Schema initialization is additive; every following fixture is connection-local.
calendar_event_schema_ensure($mysqli);
foreach (['tbl_calendar_events','tbl_calendar_event_teachers'] as $table) {
    $definition = $mysqli->query("SHOW CREATE TABLE {$table}")->fetch_row()[1];
    $mysqli->query(preg_replace('/^CREATE TABLE/', 'CREATE TEMPORARY TABLE', $definition));
}
$mysqli->query('CREATE TEMPORARY TABLE tbl_programs (program_id INT PRIMARY KEY,dept_id INT)');
$mysqli->query('CREATE TEMPORARY TABLE tbl_subject (subject_id INT PRIMARY KEY,program_id INT)');
$mysqli->query('CREATE TEMPORARY TABLE tbl_sections (section_id INT PRIMARY KEY,program_id INT)');
$mysqli->query('CREATE TEMPORARY TABLE tbl_class_schedules (schedule_id INT PRIMARY KEY,user_id INT,subject_id INT,section_id INT,start_time TIME,end_time TIME)');
$mysqli->query('CREATE TEMPORARY TABLE tbl_attendance_records (attendance_id INT PRIMARY KEY,schedule_id INT,user_id INT,date DATE,checked_in_at DATETIME NULL,checked_mid_at DATETIME NULL,checked_out_at DATETIME NULL,flag_in_id INT DEFAULT 1,flag_check_id INT DEFAULT 1,flag_out_id INT DEFAULT 1)');
$mysqli->query('INSERT INTO tbl_programs VALUES (1,1),(2,2)');
$mysqli->query('INSERT INTO tbl_subject VALUES (1,1),(2,2)');
$mysqli->query('INSERT INTO tbl_sections VALUES (1,1),(2,2)');
$date=date('Y-m-d',strtotime('+2 days'));
$stmt=$mysqli->prepare("INSERT INTO tbl_calendar_events (event_id,title,event_type,date_from,date_to,dept_id,program_id,start_time,end_time,status,created_by) VALUES (1,'Scope test','event',?,?,1,1,'13:00','15:00','active',1)");
$stmt->bind_param('ss',$date,$date); $stmt->execute(); $stmt->close();
calendar_event_save_teacher_ids($mysqli,1,[10]);
$mysqli->query("INSERT INTO tbl_class_schedules VALUES (1,10,1,1,'13:00','14:00'),(2,11,1,1,'13:00','14:00'),(3,10,1,1,'15:00','16:00'),(4,10,2,2,'13:00','14:00'),(5,10,1,1,'12:00','13:00'),(6,10,1,1,'14:00','16:00'),(7,10,1,1,'13:00','14:00'),(8,10,1,1,'13:00','14:00'),(9,10,1,1,'13:00','14:00'),(10,10,1,1,'13:00','14:00')");
for($id=1;$id<=6;$id++) $mysqli->query("INSERT INTO tbl_attendance_records (attendance_id,schedule_id,user_id,date) SELECT schedule_id,schedule_id,user_id,'{$date}' FROM tbl_class_schedules WHERE schedule_id={$id}");
$event=$mysqli->query('SELECT * FROM tbl_calendar_events WHERE event_id=1')->fetch_assoc();
event_check(!calendar_event_has_protected_attendance($mysqli,$event,[10]), 'Upcoming attendance wrongly locks an event.');
$coverage=calendar_event_not_exists_sql("'{$date}'",'sp.dept_id','secp.dept_id','sp.program_id','secp.program_id','cs.user_id','cs.start_time','cs.end_time');
$query="SELECT cs.schedule_id FROM tbl_class_schedules cs JOIN tbl_subject subj ON subj.subject_id=cs.subject_id JOIN tbl_programs sp ON sp.program_id=subj.program_id JOIN tbl_sections sec ON sec.section_id=cs.section_id JOIN tbl_programs secp ON secp.program_id=sec.program_id WHERE {$coverage} ORDER BY cs.schedule_id";
event_check(array_map('intval',array_column($mysqli->query($query)->fetch_all(MYSQLI_ASSOC),'schedule_id')) === [2,3,4,5], 'Teacher/program/half-open overlap generation rule failed.');
event_check(calendar_event_attendance_is_blocked($mysqli,1), 'Selected overlapping class not blocked.');
foreach ([2,3,4,5] as $id) event_check(!calendar_event_attendance_is_blocked($mysqli,$id), 'Unselected or non-overlapping class blocked.');
foreach ([7=>2,8=>8,9=>1,10=>3] as $id=>$flag) $mysqli->query("INSERT INTO tbl_attendance_records (attendance_id,schedule_id,user_id,date,flag_in_id,flag_check_id,flag_out_id) VALUES ({$id},{$id},10,'{$date}',{$flag},{$flag},{$flag})");
$mysqli->query("UPDATE tbl_attendance_records SET checked_in_at='{$date} 13:01:00' WHERE attendance_id=9");
event_check(calendar_event_has_protected_attendance($mysqli,$event,[10]), 'Finalized/activity records must lock changes.');
$sync=calendar_event_delete_blocked_upcoming_attendance($mysqli);
event_check($sync['ok'] && $sync['deleted_rows']===2, 'Cleanup must remove only selected untouched overlapping upcoming records.');
event_check(array_map('intval',array_column($mysqli->query('SELECT attendance_id FROM tbl_attendance_records ORDER BY attendance_id')->fetch_all(MYSQLI_ASSOC),'attendance_id')) === [2,3,4,5,7,8,9,10], 'Cleanup damaged attendance history or other teachers.');
calendar_event_save_teacher_ids($mysqli,1,[]);
event_check(calendar_event_teacher_ids($mysqli,1) === [], 'Clearing selected teachers failed.');
$sync=calendar_event_delete_blocked_upcoming_attendance($mysqli);
event_check($sync['deleted_rows']===1, 'Empty selection must cover all eligible teachers in the scope.');
$mysqli->query('UPDATE tbl_calendar_events SET start_time=NULL,end_time=NULL WHERE event_id=1');
event_check(!calendar_event_attendance_is_blocked($mysqli,4), 'All-day event leaked to a different program.');
event_check(calendar_event_attendance_is_blocked($mysqli,3), 'All-day event did not cover a later class.');
$mysqli->query("UPDATE tbl_calendar_events SET status='cancelled' WHERE event_id=1");
event_check(count($mysqli->query($query)->fetch_all(MYSQLI_ASSOC))===10, 'Cancelled event must no longer suppress generation.');
// Exercise the real read/preview API with temporary rosters and schedules.
$mysqli->query("ALTER TABLE tbl_programs ADD COLUMN status VARCHAR(20) DEFAULT 'active', ADD COLUMN program_name VARCHAR(80) DEFAULT 'Test program'");
$mysqli->query("ALTER TABLE tbl_class_schedules ADD COLUMN semester_id INT DEFAULT 1, ADD COLUMN day_of_week VARCHAR(20)");
$day=strtolower(date('l',strtotime($date)));
$mysqli->query("UPDATE tbl_class_schedules SET day_of_week='{$day}'");
$mysqli->query('CREATE TEMPORARY TABLE tbl_semesters (semester_id INT PRIMARY KEY,start_date DATE,end_date DATE)');
$mysqli->query("INSERT INTO tbl_semesters VALUES (1,CURDATE(),DATE_ADD(CURDATE(),INTERVAL 10 DAY))");
$mysqli->query("CREATE TEMPORARY TABLE tbl_departments (dept_id INT PRIMARY KEY,dept_name VARCHAR(80),status VARCHAR(20))");
$mysqli->query("INSERT INTO tbl_departments VALUES (1,'One','active'),(2,'Two','active')");
$mysqli->query("CREATE TEMPORARY TABLE tbl_users (user_id INT PRIMARY KEY,first_name VARCHAR(50),last_name VARCHAR(50),email VARCHAR(100),role_id INT,status VARCHAR(20),dept_id INT,assigned_program_head_id INT)");
$mysqli->query("INSERT INTO tbl_users VALUES (10,'A','Teacher','a@example.invalid',5,'active',1,1),(11,'B','Teacher','b@example.invalid',5,'active',1,1),(12,'C','Teacher','c@example.invalid',5,'active',2,2),(13,'D','Admin','d@example.invalid',1,'active',1,1),(14,'E','Teacher','e@example.invalid',5,'inactive',1,1)");
class CalendarTestResponse extends Exception {
    public $data;
    public function __construct($data, $status) { parent::__construct('test response', $status); $this->data=$data; }
}
function get_input() { return $GLOBALS['calendar_test_input'] ?? []; }
function json_response($data, $status=200) {
    if (!empty($GLOBALS['calendar_test_exit_response'])) { echo json_encode(['status'=>$status,'data'=>$data]); exit; }
    throw new CalendarTestResponse($data,$status);
}
function calendar_test_api($role, $path, $method, $input=[], $query=[]) {
    global $authPayload, $calendar_test_input;
    $authPayload=['user_id'=>100,'role_id'=>$role,'dept_id'=>1];
    $calendar_test_input=$input; $_GET=$query;
    $_SERVER['REQUEST_METHOD']=$method; $_SERVER['REQUEST_URI']=$path;
    try { include __DIR__ . '/../api/calendar-events.php'; }
    catch (CalendarTestResponse $response) { return $response; }
    throw new RuntimeException('API did not return a response.');
}
$response=calendar_test_api(6,'/api/calendar-events/teachers','GET',[],['dept_id'=>2]);
event_check($response->getCode()===200 && array_column($response->data,'user_id')===[10,11], 'Department Admin teacher list leaked another department or ineligible accounts.');
$payload=['title'=>'Preview scope','event_type'=>'event','date_from'=>$date,'date_to'=>$date,'dept_id'=>1,'program_id'=>1,'start_time'=>'13:00','end_time'=>'15:00','teacher_ids'=>[10]];
$response=calendar_test_api(6,'/api/calendar-events/preview','POST',$payload);
event_check($response->getCode()===200 && $response->data['affected_class_count']===2, 'Actual preview count differs from selected/time-aware cleanup.');
$response=calendar_test_api(6,'/api/calendar-events/preview','POST',array_replace($payload,['teacher_ids'=>[12]]));
event_check($response->getCode()===403, 'API accepted a cross-department selected teacher.');
$response=calendar_test_api(1,'/api/calendar-events/preview','POST',array_replace($payload,['end_time'=>'']));
event_check($response->getCode()===422, 'API accepted only one event time.');
$response=calendar_test_api(2,'/api/calendar-events/teachers','GET');
event_check($response->getCode()===403, 'Dean gained holiday/event management.');
$mysqli->query("UPDATE tbl_calendar_events SET status='active',start_time='13:00',end_time='15:00' WHERE event_id=1");
calendar_event_save_teacher_ids($mysqli,1,[10]);
$response=calendar_test_api(6,'/api/calendar-events/preview','POST',array_replace($payload,['event_id'=>1]));
event_check($response->getCode()===409 && $response->data['error']==='attendance_locked', 'Editing preview did not protect finalized attendance.');
$response=calendar_test_api(6,'/api/calendar-events/preview','POST',array_replace($payload,['teacher_ids'=>[11]]));
event_check($response->getCode()===200 && count($response->data['overlaps'])===0, 'Events for disjoint selected teachers were reported as overlapping.');
$response=calendar_test_api(6,'/api/calendar-events/preview','POST',array_replace($payload,['start_time'=>'15:00','end_time'=>'16:00']));
event_check($response->getCode()===200 && count($response->data['overlaps'])===0, 'Touching event time boundaries were reported as overlapping.');
$response=calendar_test_api(1,'/api/calendar-events/preview','POST',array_replace($payload,['date_from'=>'2026-99-99','date_to'=>'2026-99-99']));
event_check($response->getCode()===422, 'API accepted an invalid calendar date.');
$response=calendar_test_api(1,'/api/calendar-events/preview','POST',array_replace($payload,['date_from'=>date('Y-m-d',strtotime('-1 day'))]));
event_check($response->getCode()===422 && $response->data['error']==='past_date', 'API accepted a past start date.');
// Child-process modes use real JSON exits to test mutation rejection paths.
$mode=$argv[1] ?? '';
if (in_array($mode,['locked_delete','locked_put','different_department','past_delete'],true)) {
    $calendar_test_exit_response=true;
    $authPayload=['user_id'=>100,'role_id'=>6,'dept_id'=>1];
    $calendar_test_input=$payload;
    $_SERVER['REQUEST_METHOD']=$mode==='locked_put' ? 'PUT' : 'DELETE';
    $_SERVER['REQUEST_URI']='/api/calendar-events/1'; $_GET=[];
    if ($mode==='different_department') $mysqli->query('UPDATE tbl_calendar_events SET dept_id=2 WHERE event_id=1');
    if ($mode==='past_delete') $mysqli->query('UPDATE tbl_calendar_events SET date_from=DATE_SUB(CURDATE(),INTERVAL 1 DAY) WHERE event_id=1');
    include __DIR__ . '/../api/calendar-events.php';
    throw new RuntimeException('Mutation guard did not return.');
}
echo "PASS {$checks} calendar teacher/time/scope/history/API checks; all attendance fixtures were temporary.\n";
