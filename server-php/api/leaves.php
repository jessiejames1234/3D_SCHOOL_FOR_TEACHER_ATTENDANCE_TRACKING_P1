<?php
// server-php/api/leaves.php
require_once __DIR__ . '/../helpers/socket_helper.php';
require_once __DIR__ . '/../helpers/log_helper.php'; 
require_once __DIR__ . '/../helpers/notification_helper.php';
global $mysqli;

$request_method = $_SERVER['REQUEST_METHOD'];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$parts = explode('/', $path);
$api_prefix_key = array_search('api', $parts);
$endpoint = $parts[$api_prefix_key + 1] ?? null;
$param1 = $parts[$api_prefix_key + 2] ?? null; // id

$input = json_decode(file_get_contents('php://input'), true) ?? [];

// --- AUTHENTICATION & TOKEN DECODING ---
$authHeader = null;
$candidates = ['HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION', 'HTTP_X_AUTHORIZATION', 'HTTP_X_API_TOKEN', 'HTTP_AUTH', 'AUTHORIZATION'];
foreach ($candidates as $k) { if (!empty($_SERVER[$k])) { $authHeader = $_SERVER[$k]; break; } }
if (empty($authHeader) && function_exists('apache_request_headers')) {
    $headers = apache_request_headers();
    foreach (['Authorization','authorization','AUTHORIZATION'] as $h) { if (!empty($headers[$h])) { $authHeader = $headers[$h]; break; } }
}
$queryToken = $_GET['token'] ?? null;
if (empty($authHeader) && !empty($queryToken)) { $authHeader = 'Bearer ' . $queryToken; }

$authRole = null; $authUserId = null;
if (!empty($authHeader)) {
    if (!preg_match('/Bearer\s+(\S+)/i', $authHeader, $m)) { json_response(['error'=>'invalid_authorization_format'],401); }
    $token = $m[1];
    $sec = [];
    if (file_exists(__DIR__ . '/../config/security.php')) $sec = require __DIR__ . '/../config/security.php';
    $secret_key = $sec['jwt_secret'] ?? 'your-secret-key';
    try {
        $decoded = \Firebase\JWT\JWT::decode($token, new \Firebase\JWT\Key($secret_key, 'HS256'));
        $authRole = isset($decoded->role_id) ? (int)$decoded->role_id : null;
        $authUserId = isset($decoded->user_id) ? (int)$decoded->user_id : null;
    } catch (Throwable $e) {
        json_response(['error'=>'invalid_token','message'=>$e->getMessage()],401);
    }
}

// --- HELPERS ---

function resolve_auth_dept($mysqli, $authUserId) {
    if (!$authUserId) return null;
    $s = $mysqli->prepare("SELECT dept_id FROM tbl_users WHERE user_id = ? LIMIT 1");
    if (!$s) return null;
    $s->bind_param('i', $authUserId);
    $s->execute();
    $r = $s->get_result()->fetch_assoc();
    return isset($r['dept_id']) ? (int)$r['dept_id'] : null;
}

function safe_bind_params($stmt, $types, $params) {
    $refs = [$types];
    foreach ($params as $k => $v) $refs[] = &$params[$k];
    return call_user_func_array([$stmt, 'bind_param'], $refs);
}

// --- ROUTING ---

switch ($request_method) {
    case 'GET':
        if ($param1 === 'types') {
            $res = $mysqli->query("SELECT leave_type_id, name_type FROM tbl_leave_type ORDER BY leave_type_id");            
            json_response($res ? $res->fetch_all(MYSQLI_ASSOC) : []);
        }
        
        if (is_numeric($param1)){
            $id = (int)$param1;
            $stmt = $mysqli->prepare("SELECT l.*, lt.name_type, u.first_name, u.last_name, u.dept_id, ap.first_name AS approver_first, ap.last_name AS approver_last FROM tbl_leaves l LEFT JOIN tbl_leave_type lt ON l.leave_type_id = lt.leave_type_id LEFT JOIN tbl_users u ON l.teacher_id = u.user_id LEFT JOIN tbl_users ap ON l.approved_by = ap.user_id WHERE l.leave_id = ? LIMIT 1");
            $stmt->bind_param('i', $id);
            $stmt->execute();
            $res = $stmt->get_result()->fetch_assoc();
            
            if ($authRole && (int)$authRole === 5) {
                if (!$res || (int)($res['teacher_id'] ?? 0) !== (int)$authUserId) {
                    json_response(['error'=>'forbidden'],403);
                }
            } elseif ($authRole && in_array($authRole, [2,3,4,6], true)) {
                $authDept = resolve_auth_dept($mysqli, $authUserId);
                if ($authDept === null || ($res && isset($res['dept_id']) && (int)$res['dept_id'] !== $authDept)) {
                    json_response(['error'=>'forbidden'],403);
                }
            }
            json_response($res ?: null);
        }

        $sql = "SELECT l.*, lt.name_type, u.first_name, u.last_name, u.dept_id, ap.first_name AS approver_first, ap.last_name AS approver_last FROM tbl_leaves l LEFT JOIN tbl_leave_type lt ON l.leave_type_id = lt.leave_type_id LEFT JOIN tbl_users u ON l.teacher_id = u.user_id LEFT JOIN tbl_users ap ON l.approved_by = ap.user_id ORDER BY l.leave_id DESC";
        
        if ($authRole && (int)$authRole === 5) {
            $sql = "SELECT l.*, lt.name_type, u.first_name, u.last_name, u.dept_id, ap.first_name AS approver_first, ap.last_name AS approver_last FROM tbl_leaves l LEFT JOIN tbl_leave_type lt ON l.leave_type_id = lt.leave_type_id LEFT JOIN tbl_users u ON l.teacher_id = u.user_id LEFT JOIN tbl_users ap ON l.approved_by = ap.user_id WHERE l.teacher_id = " . intval($authUserId) . " ORDER BY l.leave_id DESC";
        } elseif ($authRole && in_array($authRole, [2,3,4,6], true)) {
            $authDept = resolve_auth_dept($mysqli, $authUserId);
            if ($authDept === null) json_response([], 200);
            $sql = "SELECT l.*, lt.name_type, u.first_name, u.last_name, u.dept_id, ap.first_name AS approver_first, ap.last_name AS approver_last FROM tbl_leaves l LEFT JOIN tbl_leave_type lt ON l.leave_type_id = lt.leave_type_id LEFT JOIN tbl_users u ON l.teacher_id = u.user_id LEFT JOIN tbl_users ap ON l.approved_by = ap.user_id WHERE u.dept_id = " . intval($authDept) . " ORDER BY l.leave_id DESC";
        }
        
        $res = $mysqli->query($sql);
        json_response($res ? $res->fetch_all(MYSQLI_ASSOC) : []);
        break;

    case 'POST':
        if (!$authUserId) json_response(['error'=>'unauthorized','message'=>'Authentication required'], 401);
        $teacher_id = $input['teacher_id'] ?? null;
        $leave_type_id = $input['leave_type_id'] ?? 1;
        $date_from = $input['date_from'] ?? null;
        $date_to = $input['date_to'] ?? null;
        $reason = $input['reason'] ?? '';

        if (!$teacher_id || !$date_from || !$date_to){ json_response(['error'=>'missing_fields'], 400); }

        if ($authRole) {
            if (!in_array((int)$authRole, [2, 6], true)) {
                json_response(['error'=>'forbidden','message'=>'Only dean and department admin can file leave records.'], 403);
            } else {
                $tstmt = $mysqli->prepare("SELECT dept_id FROM tbl_users WHERE user_id = ? LIMIT 1");
                $tstmt->bind_param('i', $teacher_id); $tstmt->execute();
                $trow = $tstmt->get_result()->fetch_assoc();
                $authDept = resolve_auth_dept($mysqli, $authUserId);
                if ($authDept === null || !$trow || $authDept !== (int)$trow['dept_id']) json_response(['error'=>'forbidden_dept', 'message'=>'You can only file leaves for users inside your department.'],403);
            }
        }

        // Prevent Overlapping Dates Validation (Ignores 'void' leaves)
        $dupCheck = $mysqli->prepare("
            SELECT leave_id, date_from, date_to 
            FROM tbl_leaves 
            WHERE teacher_id = ? 
            AND req_status != 'void' 
            AND date_from <= ? 
            AND date_to >= ? 
            LIMIT 1
        ");
        
        $dupCheck->bind_param('iss', $teacher_id, $date_to, $date_from);
        $dupCheck->execute();
        
        if ($dupCheck->get_result()->num_rows > 0) {
            json_response(['error'=>'duplicate_leave', 'message'=>'Leave dates overlap with an existing active leave for this teacher.'], 409);
        }
        $dupCheck->close();

        $requested_by = $authUserId ?? null;
        $auto_status = 'approve';

        $stmt = $mysqli->prepare("INSERT INTO tbl_leaves (approved_by, teacher_id, leave_type_id, req_status, date_from, date_to, reason, requested_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
        $stmt->bind_param('iiissssi', $authUserId, $teacher_id, $leave_type_id, $auto_status, $date_from, $date_to, $reason, $requested_by);
        if (!$stmt->execute()) json_response(['error'=>'insert_failed','message'=>$stmt->error],500);
        $new_id = $stmt->insert_id;

        $log_teacher_name = "Unknown";
        $log_leave_name = "Leave";

        $nameQ = $mysqli->prepare("SELECT u.last_name, u.first_name, lt.name_type FROM tbl_users u, tbl_leave_type lt WHERE u.user_id = ? AND lt.leave_type_id = ?");
        $nameQ->bind_param('ii', $teacher_id, $leave_type_id);
        $nameQ->execute();
        $nameRes = $nameQ->get_result()->fetch_assoc();
        
        if ($nameRes) {
            $log_teacher_name = $nameRes['first_name'] . " " . $nameRes['last_name'];
            $log_leave_name = $nameRes['name_type'];
        }

        $log_message = "Filed and auto-approved $log_leave_name for $log_teacher_name ($date_from to $date_to)";
        log_system_action($mysqli, $authUserId, 'file_leave', $log_message);
        if ((int)$teacher_id > 0) {
            $notifTitle = 'Leave Approved';
            $notifMessage = "Your {$log_leave_name} leave ({$date_from} to {$date_to}) has been created and approved.";
            notif_insert($mysqli, (int)$teacher_id, $notifTitle, $notifMessage, '/attendance-history', $authUserId);
        }

        try { trigger_socket_update(['entity'=>'leaves','action'=>'create','leave_id'=>$new_id]); } catch(Throwable $_){}
        json_response(['leave_id'=>$new_id],201);
        break;

    case 'PUT':
        if (!$authUserId) json_response(['error'=>'unauthorized','message'=>'Authentication required'], 401);
        if (!is_numeric($param1)) json_response(['error'=>'missing_id'],400);
        $id = (int)$param1;

        $check = $mysqli->prepare("
            SELECT l.*, u.dept_id, u.first_name, u.last_name, lt.name_type 
            FROM tbl_leaves l 
            JOIN tbl_users u ON l.teacher_id = u.user_id 
            JOIN tbl_leave_type lt ON l.leave_type_id = lt.leave_type_id
            WHERE l.leave_id = ? LIMIT 1
        ");
        $check->bind_param('i',$id);
        $check->execute();
        $row = $check->get_result()->fetch_assoc();

        if (!$row) json_response(['error'=>'not_found'],404);

        if ($authRole) { 
            $authDept = resolve_auth_dept($mysqli, $authUserId);
            if (!in_array((int)$authRole, [2, 6], true)) {
                 json_response(['error'=>'forbidden', 'message'=>'Only dean and department admin can edit leave records.'],403);
            } else {
                 if ($authDept === null || (int)$row['dept_id'] !== $authDept) json_response(['error'=>'forbidden', 'message'=>'You cannot edit records outside your specific department.'],403);
            }
        }

        $fields = []; $types = ''; $vals = [];
        $log_action_type = 'update_leave'; 
        $log_status_note = '';

        if (isset($input['req_status'])){
            // Force status to be either 'approve' or 'void'
            $status = (strtolower($input['req_status']) === 'void') ? 'void' : 'approve';
            
            $fields[] = 'req_status = ?'; $types .= 's'; $vals[] = $status;
            
            if ($status === 'approve'){
                $fields[] = 'approved_by = ?'; $types .= 'i'; $vals[] = $authUserId;
                $log_action_type = 'approve_leave';
                $log_status_note = "Approved";
            } elseif ($status === 'void') {
                $log_action_type = 'void_leave';
                $log_status_note = "Voided";
            }
        }
        
        if (isset($input['date_from'])){ $fields[] = 'date_from = ?'; $types .= 's'; $vals[] = $input['date_from']; }
        if (isset($input['date_to'])){ $fields[] = 'date_to = ?'; $types .= 's'; $vals[] = $input['date_to']; }
        if (isset($input['reason'])){ $fields[] = 'reason = ?'; $types .= 's'; $vals[] = $input['reason']; }
        if (isset($input['leave_type_id'])){ $fields[] = 'leave_type_id = ?'; $types .= 'i'; $vals[] = $input['leave_type_id']; }
        if (isset($input['teacher_id'])){ $fields[] = 'teacher_id = ?'; $types .= 'i'; $vals[] = $input['teacher_id']; }

        if (empty($fields)) json_response(['message'=>'nothing_to_update'],200);

        $sql = "UPDATE tbl_leaves SET " . implode(', ', $fields) . " WHERE leave_id = ?";
        $stmt = $mysqli->prepare($sql);
        $types .= 'i'; $vals[] = $id;
        
        safe_bind_params($stmt, $types, $vals); 

        if (!$stmt->execute()) json_response(['error'=>'update_failed','message'=>$stmt->error],500);

        $teacher_name = $row['first_name'] . " " . $row['last_name'];
        $leave_name = $row['name_type'];

        if ($log_status_note) {
            $log_details = "$log_status_note $leave_name for $teacher_name";
        } else {
            $log_details = "Updated details of $leave_name for $teacher_name";
        }

        log_system_action($mysqli, $authUserId, $log_action_type, $log_details);

        try { trigger_socket_update(['entity'=>'leaves','action'=>'update','leave_id'=>$id]); } catch(Throwable $_){}
        json_response(['ok'=>true]);
        break;

    case 'DELETE':
        json_response(['error'=>'not_allowed'],405);
        break;
}
?>
