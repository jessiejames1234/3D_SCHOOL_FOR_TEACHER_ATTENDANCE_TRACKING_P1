<?php
// All fixtures shadow live tables on this connection and disappear on exit.
require __DIR__ . '/../config/env.php';
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
$mysqli = new mysqli(getenv('DB_HOST'), getenv('DB_USER'), getenv('DB_PASS'), getenv('DB_NAME'));
$mysqli->query("SET time_zone = '+08:00'");
require __DIR__ . '/../helpers/tardiness_penalty_helper.php';
$checks = 0;
function policy_check($condition, $message) {
    global $checks;
    if (!$condition) throw new RuntimeException($message);
    $checks++;
}
foreach ([
    'tbl_users' => 'user_id INT PRIMARY KEY, dept_id INT, assigned_program_head_id INT, role_id INT, status VARCHAR(20), first_name VARCHAR(50), last_name VARCHAR(50)',
    'tbl_school_year' => 'school_year_id INT PRIMARY KEY, session_name VARCHAR(50)',
    'tbl_semesters' => 'semester_id INT PRIMARY KEY, school_year_id INT, term VARCHAR(30), status VARCHAR(20), start_date DATE, end_date DATE',
    'tbl_class_schedules' => 'schedule_id INT PRIMARY KEY, semester_id INT, start_time TIME, end_time TIME',
    'tbl_attendance_records' => 'attendance_id INT PRIMARY KEY, user_id INT, schedule_id INT, date DATE, flag_in_id INT, flag_check_id INT, flag_out_id INT',
    'tbl_penalties_type' => 'penal_type_id INT PRIMARY KEY, type_name VARCHAR(50)',
    'tbl_penalties' => 'sanction_id INT AUTO_INCREMENT PRIMARY KEY, issued_by INT NULL, user_id INT, penal_type_id INT, semester_id INT, date DATE, reason TEXT, source VARCHAR(20), policy_code VARCHAR(50), trigger_attendance_id INT, trigger_stage VARCHAR(20), status VARCHAR(20), voided_at DATETIME NULL, UNIQUE KEY (user_id, semester_id, policy_code)',
    'tbl_roles' => 'role_id INT PRIMARY KEY, role_name VARCHAR(30)',
    'tbl_departments' => 'dept_id INT PRIMARY KEY, dept_name VARCHAR(50)',
] as $table => $columns) {
    $mysqli->query("CREATE TEMPORARY TABLE {$table} ({$columns}) ENGINE=InnoDB");
}
$mysqli->query("INSERT INTO tbl_users VALUES (1,1,1,5,'active','Test','Teacher'), (2,2,1,5,'active','Other','Teacher'), (3,1,1,5,'inactive','Inactive','Teacher')");
$mysqli->query("INSERT INTO tbl_school_year VALUES (1,'Test Year')");
$mysqli->query("INSERT INTO tbl_semesters VALUES (1,1,'Current','active',CURDATE() - INTERVAL 1 DAY,CURDATE() + INTERVAL 1 DAY), (2,1,'Previous','inactive','2020-01-01','2020-06-01')");
$mysqli->query("INSERT INTO tbl_class_schedules VALUES (1,1,'08:00:00','09:00:00'), (2,2,'08:00:00','09:00:00')");
$mysqli->query("INSERT INTO tbl_penalties_type VALUES (1,'Tardiness'),(2,'Absences')");
$mysqli->query("INSERT INTO tbl_roles VALUES (5,'Teacher')");
$mysqli->query("INSERT INTO tbl_departments VALUES (1,'Department One'),(2,'Department Two')");

// Exhaustively compare Late/Absent SQL to the report's two-of-three majority.
$id = 100;
$flags = [null,1,2,3,4,5,7,8];
foreach ($flags as $in) foreach ($flags as $mid) foreach ($flags as $out) {
    $values = array_map(static function ($flag) { return $flag === null ? 'NULL' : (string)$flag; }, [$in,$mid,$out]);
    $mysqli->query("INSERT INTO tbl_attendance_records VALUES ({$id},2,1,CURDATE()," . implode(',', $values) . ')');
    $overall = attendance_red_flag_sql();
    $actual = $mysqli->query("SELECT ({$overall}) AS overall FROM tbl_attendance_records ar WHERE attendance_id={$id}")->fetch_assoc()['overall'];
    $expected = count(array_filter([$in,$mid,$out], static function ($flag) { return $flag === 5; })) >= 2 ? 'late'
        : (count(array_filter([$in,$mid,$out], static function ($flag) { return $flag === 3; })) >= 2 ? 'absent' : '');
    policy_check($actual === $expected, 'Overall policy differs from report majority.');
    $id++;
}
$mysqli->query('DELETE FROM tbl_attendance_records');
$mysqli->query("INSERT INTO tbl_attendance_records VALUES
    (1,1,1,CURDATE(),5,5,2),(2,1,1,CURDATE(),5,2,5),
    (3,1,1,CURDATE(),3,3,2),(4,1,1,CURDATE(),3,2,3),
    (5,1,1,CURDATE(),5,3,2)");
$result = attendance_reconcile_red_flags($mysqli,1,1);
policy_check($result['late_count'] === 2 && $result['absent_count'] === 2 && !$result['changed'], 'Two results must not trigger a penalty; partial results must not count.');
policy_check(count(tardiness_late_checkpoints($mysqli,1,1)) === 2, 'Dashboard must count overall records, not individual late stages.');
$mysqli->query("INSERT INTO tbl_attendance_records VALUES (6,1,1,CURDATE(),5,5,2),(7,1,1,CURDATE(),3,3,2)");
$result = attendance_reconcile_red_flags($mysqli,1,1);
policy_check(count($result['events']) === 2 && $result['late_count'] === 3 && $result['absent_count'] === 3, 'Three Late and three Absent must create two independent flags.');
$penalties = $mysqli->query('SELECT * FROM tbl_penalties ORDER BY penal_type_id')->fetch_all(MYSQLI_ASSOC);
policy_check(count($penalties) === 2 && $penalties[0]['policy_code'] === 'SEMESTER_LATE_3' && $penalties[1]['policy_code'] === 'SEMESTER_ABSENT_3', 'Policy identities must be distinct.');
policy_check($penalties[0]['trigger_stage'] === 'overall' && (int)$penalties[0]['trigger_attendance_id'] === 6, 'The third overall result must be the trigger.');
$lateId = $penalties[0]['sanction_id'];
policy_check(!attendance_reconcile_red_flags($mysqli,1,1)['changed'], 'Repeated reconciliation must not duplicate penalties or notifications.');
$mysqli->query("INSERT INTO tbl_attendance_records VALUES (8,1,1,CURDATE(),5,5,2)");
attendance_reconcile_red_flags($mysqli,1,1);
policy_check((int)$mysqli->query('SELECT COUNT(*) AS n FROM tbl_penalties')->fetch_assoc()['n'] === 2, 'Fourth Late must not create another flag.');
$mysqli->query('UPDATE tbl_attendance_records SET flag_in_id=2,flag_check_id=2,flag_out_id=2 WHERE attendance_id IN (6,8)');
policy_check(!attendance_reconcile_red_flags($mysqli,1,1)['changed'], 'A direct correction must not void a flag.');
$result = attendance_reconcile_red_flags($mysqli,1,1,true);
policy_check(count($result['events']) === 1 && $result['events'][0]['action'] === 'voided' && $result['absent_status'] === 'red_flag', 'Approved correction below three must void only the affected policy.');
$voided = $mysqli->query("SELECT status,voided_at,reason FROM tbl_penalties WHERE sanction_id={$lateId}")->fetch_assoc();
policy_check($voided['status'] === 'voided' && $voided['voided_at'] !== null && strpos($voided['reason'],'approved attendance edit') !== false, 'Void history must remain recorded.');
policy_check(!attendance_reconcile_red_flags($mysqli,1,1,true)['changed'], 'Repeated approval reconciliation must be idempotent.');
$mysqli->query('UPDATE tbl_attendance_records SET flag_in_id=5,flag_check_id=5,flag_out_id=2 WHERE attendance_id=6');
$result = attendance_reconcile_red_flags($mysqli,1,1);
policy_check($result['events'][0]['action'] === 'reactivated', 'Returning to three must reactivate the same flag.');
policy_check((int)$mysqli->query("SELECT COUNT(*) AS n FROM tbl_penalties WHERE sanction_id={$lateId} AND status='active' AND voided_at IS NULL")->fetch_assoc()['n'] === 1, 'Reactivation must preserve penalty identity.');
$mysqli->query("INSERT INTO tbl_attendance_records VALUES (9,1,2,'2020-02-01',5,5,2),(10,1,2,'2020-02-02',5,5,2)");
policy_check(!attendance_reconcile_red_flags($mysqli,1,2)['changed'], 'Semester counts must not mix.');
$mysqli->query("INSERT INTO tbl_attendance_records VALUES (11,1,2,'2020-02-03',5,5,2)");
policy_check(attendance_reconcile_red_flags($mysqli,1,2)['changed'], 'A second semester may have its own flag.');
policy_check(attendance_reconcile_red_flags($mysqli,3,1)['status'] === 'excluded', 'Inactive teaching staff must be excluded.');

// Exercise actual API listing, semester totals and mutation guards.
class PolicyResponse extends RuntimeException {
    public $data;
    public function __construct($data, $status) { parent::__construct('response', $status); $this->data = $data; }
}
function json_response($data, $status = 200) { throw new PolicyResponse($data,$status); }
function get_input() { return []; }
$authPayload = ['user_id'=>10,'role_id'=>6,'dept_id'=>1];
function penalty_api($method, $query = []) {
    global $mysqli, $authPayload;
    $_SERVER['REQUEST_METHOD'] = $method;
    $_SERVER['REQUEST_URI'] = '/api/penalties';
    $_GET = $query;
    try { include __DIR__ . '/../api/penalties.php'; }
    catch (PolicyResponse $response) { return $response; }
    throw new RuntimeException('API did not respond.');
}
$response = penalty_api('GET',['paginate'=>'1']);
policy_check($response->getCode() === 200 && $response->data['selected_semester_id'] === 1 && count($response->data['rows']) === 2, 'API must default to current active semester.');
policy_check($response->data['summary']['total'] === 2 && count($response->data['semester_options']) === 2, 'Totals and options must reflect the semester scope.');
$response = penalty_api('GET',['paginate'=>'1','semester_id'=>'2']);
policy_check(count($response->data['rows']) === 1 && $response->data['summary']['total'] === 1 && $response->data['selected_semester_id'] === 2, 'Previous semester filter must scope rows and totals.');
policy_check(penalty_api('GET',['semester_id'=>'999'])->getCode() === 400, 'Invalid semester must be rejected.');
foreach (['POST','PUT','PATCH','DELETE'] as $method) policy_check(penalty_api($method)->getCode() === 403, 'Manual mutation was allowed.');
$mysqli->query("UPDATE tbl_semesters SET status='inactive'");
$response = penalty_api('GET',['paginate'=>'1']);
policy_check($response->data['selected_semester_id'] === 0 && !$response->data['rows'] && $response->data['summary']['total'] === 0, 'No active semester must show an empty current view, not old records.');
echo "PASS {$checks} overall red flag and penalty API checks; only connection-local temporary tables were changed.\n";
