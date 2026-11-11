<?php
// Exercise production transition guards with an in-memory database double.
// No connection is opened and no stored buildings or camera positions change.
$sourcePath = $argv[1] ?? __DIR__ . '/../api/locations.php';
$source = file_get_contents($sourcePath);
$start = strpos($source, 'function location_status_is_active(');
$end = strpos($source, 'function location_assert_archived_update_is_restore_only(', $start);
if ($start === false || $end === false) throw new RuntimeException('Location transition helpers not found.');
eval(substr($source, $start, $end - $start));

class CameraStatusResponse extends RuntimeException {
    public $data;
    public function __construct($data, $status) { parent::__construct('response', $status); $this->data = $data; }
}
function json_response($data, $status = 200) { throw new CameraStatusResponse($data, $status); }
class CameraStatusResult {
    public $rows;
    public function __construct($rows) { $this->rows = $rows; }
    public function fetch_all($mode) { return $this->rows; }
    public function fetch_assoc() { return array_shift($this->rows); }
}
class CameraStatusStatement {
    private $db;
    private $sql;
    private $params;
    public function __construct($db, $sql) { $this->db = $db; $this->sql = $sql; }
    public function bind_param($types, &...$params) { $this->params = $params; }
    public function execute() { return true; }
    public function close() {}
    public function get_result() {
        if (strpos($this->sql, 'INFORMATION_SCHEMA.COLUMNS') !== false) {
            // Also cover a schema where presets reference building_id directly.
            return new CameraStatusResult(array_map(static function ($table) { return ['TABLE_NAME' => $table]; }, array_keys($this->db->counts)));
        }
        if (preg_match('/SELECT COUNT\(\*\) AS total FROM `([a-z_0-9]+)`/', $this->sql, $match)) {
            if ($match[1] === 'tbl_3d_camera_presets') throw new RuntimeException('Camera settings must not be an archive dependency.');
            return new CameraStatusResult([['total' => $this->db->counts[$match[1]]]]);
        }
        throw new RuntimeException('Unexpected SQL: ' . $this->sql);
    }
}
class CameraStatusDatabase {
    public $counts = ['tbl_3d_camera_presets' => 1, 'tbl_floors' => 0, 'tbl_rooms' => 0];
    public $presets = ['MW' => ['position' => [22,10,-16], 'target' => [0,3,0]]];
    public function prepare($sql) { return new CameraStatusStatement($this, $sql); }
    public function query($sql) { throw new RuntimeException('Unexpected query or mutation: ' . $sql); }
}
$checks = 0;
function camera_status_check($condition, $message) {
    global $checks;
    if (!$condition) throw new RuntimeException($message);
    $checks++;
}
$db = new CameraStatusDatabase();
$saved = $db->presets;
foreach (['inactive','archive','archived'] as $requested) {
    $expected = $requested === 'archived' ? 'archive' : $requested;
    camera_status_check(location_prepare_status_transition($db,'building',1,'active',$requested) === $expected, 'Saved camera blocked a building status change.');
    camera_status_check($db->presets === $saved, 'Saved camera position was modified.');
}
camera_status_check(location_prepare_status_transition($db,'building',1,'inactive','active') === 'active', 'Reactivation should still be available.');
camera_status_check(location_prepare_status_transition($db,'building',1,'archive','active') === 'inactive', 'Restoration must retain the inactive review step.');
foreach (['tbl_floors','tbl_rooms'] as $relatedTable) {
    $db->counts[$relatedTable] = 1;
    try {
        location_prepare_status_transition($db,'building',1,'active','archive');
        throw new RuntimeException('Real location dependency was ignored.');
    } catch (CameraStatusResponse $response) {
        camera_status_check($response->getCode() === 409 && $response->data['error'] === 'archive_blocked', 'Real dependency must still be reported.');
        camera_status_check(count($response->data['dependencies']) === 1 && $response->data['dependencies'][0]['table'] === $relatedTable, 'Camera setting must not appear in the blocking dependencies.');
    }
    camera_status_check(location_prepare_status_transition($db,'building',1,'active','inactive') === 'inactive', 'Existing location records must still allow deactivation.');
    $db->counts[$relatedTable] = 0;
}
echo "PASS {$checks} camera/status checks: {$sourcePath}; no database connection used.\n";
