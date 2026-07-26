<?php
// server-php/api/penalties.php
require_once __DIR__ . '/../helpers/socket_helper.php';
require_once __DIR__ . '/../helpers/log_helper.php';
use Firebase\JWT\JWT;
use Firebase\JWT\Key;

global $mysqli;

$request_method = $_SERVER['REQUEST_METHOD'];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$parts = explode('/', $path);
$api_prefix_key = array_search('api', $parts);
$endpoint = $parts[$api_prefix_key + 1] ?? null;
$param1 = $parts[$api_prefix_key + 2] ?? null; 
$input = json_decode(file_get_contents('php://input'), true) ?? [];

// =================================================================================
// AUTHENTICATION
// =================================================================================
$authHeader = null;
$candidates = ['HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION', 'HTTP_X_AUTHORIZATION', 'HTTP_X_API_TOKEN', 'HTTP_AUTH', 'AUTHORIZATION'];
foreach ($candidates as $k) { if (!empty($_SERVER[$k])) { $authHeader = $_SERVER[$k]; break; } }

if (empty($authHeader) && function_exists('apache_request_headers')) {
    $headers = apache_request_headers();
    foreach (['Authorization','authorization','AUTHORIZATION'] as $h) { if (!empty($headers[$h])) { $authHeader = $headers[$h]; break; } }
}

$queryToken = $_GET['token'] ?? null;
if (empty($authHeader) && !empty($queryToken)) { $authHeader = 'Bearer ' . $queryToken; }

$authUserId = null;
$authUserRole = null;
$authUserDept = null;

if (!empty($authHeader)) {
    if (preg_match('/Bearer\s+(\S+)/i', $authHeader, $m)) {
        $token = $m[1];
        $sec = [];
        if (file_exists(__DIR__ . '/../config/security.php')) $sec = require __DIR__ . '/../config/security.php';
        $secret_key = $sec['jwt_secret'] ?? 'your-secret-key';
        try {
            $decoded = JWT::decode($token, new Key($secret_key, 'HS256'));
            $authUserId = isset($decoded->user_id) ? (int)$decoded->user_id : null;
            $authUserRole = isset($decoded->role_id) ? (int)$decoded->role_id : null;
            
            // Get user's department
            if ($authUserId) {
                $uStmt = $mysqli->prepare("SELECT dept_id FROM tbl_users WHERE user_id = ? LIMIT 1");
                $uStmt->bind_param('i', $authUserId);
                $uStmt->execute();
                $res = $uStmt->get_result();
                if ($row = $res->fetch_assoc()) {
                    $authUserDept = $row['dept_id'] ? (int)$row['dept_id'] : null;
                }
            }
        } catch (Throwable $e) {}
    }
}

// --------------------------------------------------------------------------------
// ENDPOINT: GET /api/penalty-types (Fixed: Removed 'description')
// --------------------------------------------------------------------------------
if ($request_method === 'GET' && $endpoint === 'penalty-types') {
    // FIXED: Removed 'description' from column list
    $res = $mysqli->query("SELECT penal_type_id, type_name FROM tbl_penalties_type ORDER BY type_name");
    json_response($res ? $res->fetch_all(MYSQLI_ASSOC) : []);
    exit;
}

// --------------------------------------------------------------------------------
// MAIN ENDPOINT: /api/penalties
// --------------------------------------------------------------------------------
switch ($request_method){
    case 'GET':
        // View Single Penalty
        if (is_numeric($param1)){
            $id = (int)$param1;
            $stmt = $mysqli->prepare("SELECT p.*, pt.type_name, u.first_name, u.last_name, u.dept_id FROM tbl_penalties p LEFT JOIN tbl_penalties_type pt ON p.penal_type_id = pt.penal_type_id LEFT JOIN tbl_users u ON p.user_id = u.user_id WHERE p.sanction_id = ? LIMIT 1");
            $stmt->bind_param('i',$id);
            $stmt->execute();
            $row = $stmt->get_result()->fetch_assoc();
            
            // Authorization
            if ((int)$authUserRole === 5) {
                if (!$row || (int)($row['user_id'] ?? 0) !== (int)$authUserId) {
                    json_response(['error'=>'forbidden'], 403);
                }
            } elseif ($authUserRole !== 1 && $authUserDept !== null) {
                if ($row && isset($row['dept_id']) && (int)$row['dept_id'] !== $authUserDept) {
                    json_response(['error'=>'forbidden'], 403);
                }
            } elseif ($authUserRole !== 1 && $authUserDept === null) {
                json_response(['error'=>'forbidden'], 403);
            }
            json_response($row);
        }
        
        // List All Penalties
        $sql = "SELECT p.sanction_id, p.user_id, p.penal_type_id, p.date, p.reason, 
                       pt.type_name, 
                       u.first_name, u.last_name, u.dept_id,
                       d.dept_name
                FROM tbl_penalties p 
                LEFT JOIN tbl_penalties_type pt ON p.penal_type_id = pt.penal_type_id 
                LEFT JOIN tbl_users u ON p.user_id = u.user_id 
                LEFT JOIN tbl_departments d ON u.dept_id = d.dept_id
                WHERE 1=1 ";
        
        $types = "";
        $params = [];

        // Role Filter
        if ((int)$authUserRole === 5) {
            $sql .= " AND p.user_id = ?";
            $types .= "i";
            $params[] = (int)$authUserId;
        } elseif ($authUserRole !== 1 && $authUserDept !== null) {
            $sql .= " AND u.dept_id = ?";
            $types .= "i";
            $params[] = $authUserDept;
        } elseif ($authUserRole !== 1 && $authUserDept === null) {
            $sql .= " AND 1 = 0";
        }

        $sql .= " ORDER BY p.date DESC, p.sanction_id DESC";
        
        $stmt = $mysqli->prepare($sql);
        if(!empty($params)) $stmt->bind_param($types, ...$params);
        $stmt->execute();
        $res = $stmt->get_result();
        
        json_response($res ? $res->fetch_all(MYSQLI_ASSOC) : []);
        break;

    case 'POST':
        $issued_by = $authUserId; 
        $user_id = $input['user_id'] ?? null;
        $penal_type_id = $input['penal_type_id'] ?? null;
        $date = $input['date'] ?? null;
        $reason = $input['reason'] ?? '';
        
        if (!$issued_by || !$user_id || !$penal_type_id || !$date) json_response(['error'=>'missing_fields'], 400);
        
        // Validate Department Access
        if ($authUserRole !== 1 && $authUserDept !== null) {
            $s = $mysqli->prepare("SELECT dept_id FROM tbl_users WHERE user_id = ? LIMIT 1"); 
            $s->bind_param('i', $user_id); 
            $s->execute(); 
            $ur = $s->get_result()->fetch_assoc(); 
            $targetDept = isset($ur['dept_id']) ? (int)$ur['dept_id'] : null; 
            
            if ($targetDept !== $authUserDept) {
                json_response(['error'=>'forbidden_different_dept', 'message'=>'You can only penalize teachers in your department.'], 403);
            }
        }
        
        $stmt = $mysqli->prepare("INSERT INTO tbl_penalties (issued_by, user_id, penal_type_id, date, reason) VALUES (?, ?, ?, ?, ?)");
        $stmt->bind_param('iiiss', $issued_by, $user_id, $penal_type_id, $date, $reason);
        if (!$stmt->execute()) json_response(['error'=>'insert_failed','message'=>$stmt->error], 500);
        
        // Get penalty type name for logging
        $penaltyTypeName = '';
        $ptStmt = $mysqli->prepare("SELECT type_name FROM tbl_penalties_type WHERE penal_type_id = ? LIMIT 1");
        if ($ptStmt) { $ptStmt->bind_param('i', $penal_type_id); $ptStmt->execute(); $ptRow = $ptStmt->get_result()->fetch_assoc(); $penaltyTypeName = $ptRow['type_name'] ?? ''; $ptStmt->close(); }
        // Get teacher name for logging
        $teacherName = '';
        $tnStmt = $mysqli->prepare("SELECT CONCAT_WS(' ', first_name, last_name) AS full_name FROM tbl_users WHERE user_id = ? LIMIT 1");
        if ($tnStmt) { $tnStmt->bind_param('i', $user_id); $tnStmt->execute(); $tnRow = $tnStmt->get_result()->fetch_assoc(); $teacherName = $tnRow['full_name'] ?? ''; $tnStmt->close(); }
        $logMsg = $penaltyTypeName ? "Issued {$penaltyTypeName} sanction to {$teacherName}" : "Issued sanction to {$teacherName}";
        log_system_action($mysqli, $authUserId, 'create_penalty', $logMsg);

        $id = $stmt->insert_id;
        try { trigger_socket_update(['entity'=>'penalties','action'=>'create','sanction_id'=>$id]); } catch(Throwable $_){}
        json_response(['sanction_id'=>$id], 201);
        break;

    case 'PUT':
        if (!is_numeric($param1)) json_response(['error'=>'missing_id'], 400);
        $id = (int)$param1;
        
        $fields = []; $types = ''; $vals = [];
        if (isset($input['user_id'])){ $fields[]='user_id = ?'; $types.='i'; $vals[]=(int)$input['user_id']; }
        if (isset($input['penal_type_id'])){ $fields[]='penal_type_id = ?'; $types.='i'; $vals[]=(int)$input['penal_type_id']; }
        if (isset($input['date'])){ $fields[]='date = ?'; $types.='s'; $vals[]=$input['date']; }
        if (isset($input['reason'])){ $fields[]='reason = ?'; $types.='s'; $vals[]=$input['reason']; }
        
        if (empty($fields)) { json_response(['message'=>'nothing_to_update'], 200); exit; }

        // Get existing penalty info for logging before updating
        $oldPenalty = null;
        $olStmt = $mysqli->prepare("SELECT p.reason, pt.type_name, CONCAT_WS(' ', u.first_name, u.last_name) AS teacher_name FROM tbl_penalties p LEFT JOIN tbl_penalties_type pt ON p.penal_type_id = pt.penal_type_id LEFT JOIN tbl_users u ON p.user_id = u.user_id WHERE p.sanction_id = ? LIMIT 1");
        if ($olStmt) { $olStmt->bind_param('i', $id); $olStmt->execute(); $oldPenalty = $olStmt->get_result()->fetch_assoc(); $olStmt->close(); }
        
        $sql = "UPDATE tbl_penalties SET " . implode(', ', $fields) . " WHERE sanction_id = ?";
        $stmt = $mysqli->prepare($sql);
        $types .= 'i'; $vals[] = $id;
        $stmt->bind_param($types, ...$vals);
        if (!$stmt->execute()) json_response(['error'=>'update_failed','message'=>$stmt->error], 500);
        
        // Log penalty update
        $logTeacher = $oldPenalty['teacher_name'] ?? 'Unknown';
        $logType = $oldPenalty['type_name'] ?? 'Sanction';
        log_system_action($mysqli, $authUserId, 'update_penalty', "Updated {$logType} details for {$logTeacher}");
        
        try { trigger_socket_update(['entity'=>'penalties','action'=>'update','sanction_id'=>$id]); } catch(Throwable $e){}
        json_response(['ok'=>true]);
        break;
}
?>
