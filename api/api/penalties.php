<?php
// api/api/penalties.php
require_once __DIR__ . '/../helpers/socket_helper.php';
require_once __DIR__ . '/../helpers/log_helper.php';
require_once __DIR__ . '/../helpers/tardiness_penalty_helper.php';
global $mysqli, $authPayload;

$request_method = $_SERVER['REQUEST_METHOD'];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$parts = explode('/', $path);
$api_prefix_key = array_search('api', $parts);
$endpoint = $parts[$api_prefix_key + 1] ?? null;
$param1 = $parts[$api_prefix_key + 2] ?? null; 
$input = get_input() ?? [];

$auth = is_array($authPayload) ? $authPayload : app_get_authenticated_session(true);
$authUserId = (int)($auth['user_id'] ?? 0);
$authUserRole = (int)($auth['role_id'] ?? 0);
$authUserDept = isset($auth['dept_id']) && $auth['dept_id'] !== null ? (int)$auth['dept_id'] : null;

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
        $activeSemesterId = attendance_policy_active_semester_id($mysqli);
        $semesterOptions = [];
        $res = $mysqli->query("SELECT sem.semester_id, sem.term, sem.status, sy.session_name
            FROM tbl_semesters sem LEFT JOIN tbl_school_year sy ON sy.school_year_id = sem.school_year_id
            ORDER BY sem.start_date DESC, sem.semester_id DESC");
        if (!$res) json_response(['error' => 'semester_lookup_failed'], 500);
        while ($option = $res->fetch_assoc()) {
            $option['semester_id'] = (int)$option['semester_id'];
            $semesterOptions[] = $option;
        }
        $requestedSemester = $_GET['semester_id'] ?? 'active';
        $selectedSemesterId = $activeSemesterId;
        if ($requestedSemester !== 'active' && $requestedSemester !== '') {
            if (!ctype_digit((string)$requestedSemester) || (int)$requestedSemester <= 0
                || !in_array((int)$requestedSemester, array_column($semesterOptions, 'semester_id'), true)) {
                json_response(['error' => 'invalid_semester', 'message' => 'The selected semester is not available.'], 400);
            }
            $selectedSemesterId = (int)$requestedSemester;
        }
        // View Single Penalty
        if (is_numeric($param1)){
            $id = (int)$param1;
            $stmt = $mysqli->prepare("SELECT p.*, pt.type_name, u.first_name, u.last_name, u.dept_id, u.role_id, u.status AS user_status, r.role_name
                FROM tbl_penalties p
                LEFT JOIN tbl_penalties_type pt ON p.penal_type_id = pt.penal_type_id
                LEFT JOIN tbl_users u ON p.user_id = u.user_id
                LEFT JOIN tbl_roles r ON u.role_id = r.role_id
                WHERE p.sanction_id = ? AND p.semester_id = ? LIMIT 1");
            $stmt->bind_param('ii',$id,$selectedSemesterId);
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
        $selectSql = "SELECT p.sanction_id, p.user_id, p.penal_type_id, p.semester_id, p.date, p.reason,
                       p.source, p.policy_code, p.trigger_attendance_id, p.trigger_stage, p.status, p.voided_at,
                       pt.type_name, 
                       u.first_name, u.last_name, u.dept_id, u.role_id, u.status AS user_status,
                       r.role_name,
                       d.dept_name";
        $fromSql = " FROM tbl_penalties p 
                LEFT JOIN tbl_penalties_type pt ON p.penal_type_id = pt.penal_type_id 
                LEFT JOIN tbl_users u ON p.user_id = u.user_id 
                LEFT JOIN tbl_roles r ON u.role_id = r.role_id
                LEFT JOIN tbl_departments d ON u.dept_id = d.dept_id";
        $where = ['u.role_id IN (2, 3, 4, 5)', 'p.semester_id = ?'];
        
        $types = 'i';
        $params = [$selectedSemesterId];

        $validateDateFilter = static function ($value) {
            if (!is_string($value) || !preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $matches)) return false;
            return checkdate((int)$matches[2], (int)$matches[3], (int)$matches[1]);
        };
        $dateFrom = isset($_GET['date_from']) ? trim((string)$_GET['date_from']) : '';
        $dateTo = isset($_GET['date_to']) ? trim((string)$_GET['date_to']) : '';
        if (($dateFrom !== '' && !$validateDateFilter($dateFrom)) || ($dateTo !== '' && !$validateDateFilter($dateTo))) {
            json_response(['error' => 'validation', 'message' => 'date_from and date_to must use YYYY-MM-DD format.'], 400);
        }
        if ($dateFrom !== '' && $dateTo !== '' && $dateFrom > $dateTo) {
            json_response(['error' => 'validation', 'message' => 'date_from cannot be later than date_to.'], 400);
        }

        if ($dateFrom !== '') {
            $where[] = 'p.date >= ?';
            $types .= 's';
            $params[] = $dateFrom;
        }
        if ($dateTo !== '') {
            $where[] = 'p.date <= ?';
            $types .= 's';
            $params[] = $dateTo;
        }

        // Role Filter
        if ((int)$authUserRole === 5) {
            $where[] = 'p.user_id = ?';
            $types .= "i";
            $params[] = (int)$authUserId;
        } elseif ($authUserRole !== 1 && $authUserDept !== null) {
            $where[] = 'u.dept_id = ?';
            $types .= "i";
            $params[] = $authUserDept;
        } elseif ($authUserRole !== 1 && $authUserDept === null) {
            $where[] = '1 = 0';
        }

        $summaryWhere = $where;
        $summaryTypes = $types;
        $summaryParams = $params;

        $roleId = isset($_GET['role_id']) && is_numeric($_GET['role_id']) ? (int)$_GET['role_id'] : 0;
        $source = strtolower(trim((string)($_GET['source'] ?? '')));
        $status = strtolower(trim((string)($_GET['status'] ?? '')));
        $search = substr(trim((string)($_GET['search'] ?? '')), 0, 200);
        if (in_array($roleId, [2, 3, 4, 5], true)) {
            $where[] = 'u.role_id = ?'; $types .= 'i'; $params[] = $roleId;
        }
        if (in_array($source, ['automatic', 'manual'], true)) {
            $where[] = 'LOWER(COALESCE(p.source, \'manual\')) = ?'; $types .= 's'; $params[] = $source;
        }
        if (in_array($status, ['active', 'voided'], true)) {
            $where[] = 'LOWER(COALESCE(p.status, \'active\')) = ?'; $types .= 's'; $params[] = $status;
        }
        if ($search !== '') {
            $where[] = "LOWER(CONCAT_WS(' ', u.first_name, u.last_name, pt.type_name, p.reason, d.dept_name, r.role_name)) LIKE ?";
            $types .= 's'; $params[] = '%' . strtolower($search) . '%';
        }

        $whereSql = ' WHERE ' . implode(' AND ', $where);
        $paginate = isset($_GET['paginate']) && in_array(strtolower((string)$_GET['paginate']), ['1', 'true', 'yes'], true);
        $page = isset($_GET['page']) && is_numeric($_GET['page']) ? max(1, (int)$_GET['page']) : 1;
        $pageSize = isset($_GET['page_size']) && is_numeric($_GET['page_size']) ? max(1, min(100, (int)$_GET['page_size'])) : 10;

        if ($paginate) {
            $countStmt = $mysqli->prepare('SELECT COUNT(*) AS total' . $fromSql . $whereSql);
            if (!$countStmt) json_response(['error'=>'prepare_failed','message'=>$mysqli->error], 500);
            if ($params) $countStmt->bind_param($types, ...$params);
            $countStmt->execute();
            $total = (int)($countStmt->get_result()->fetch_assoc()['total'] ?? 0);
            $countStmt->close();
            $totalPages = max(1, (int)ceil($total / $pageSize));
            $page = min($page, $totalPages);
            $offset = ($page - 1) * $pageSize;

            $summarySql = "SELECT COUNT(*) AS total,
                SUM(CASE WHEN LOWER(COALESCE(p.status, 'active')) = 'active' THEN 1 ELSE 0 END) AS active,
                SUM(CASE WHEN LOWER(COALESCE(p.source, 'manual')) = 'automatic' THEN 1 ELSE 0 END) AS automatic,
                SUM(CASE WHEN LOWER(COALESCE(p.source, 'manual')) <> 'automatic' THEN 1 ELSE 0 END) AS manual,
                SUM(CASE WHEN LOWER(COALESCE(p.status, 'active')) = 'voided' THEN 1 ELSE 0 END) AS voided" .
                $fromSql . ' WHERE ' . implode(' AND ', $summaryWhere);
            $summaryStmt = $mysqli->prepare($summarySql);
            if (!$summaryStmt) json_response(['error'=>'prepare_failed','message'=>$mysqli->error], 500);
            if ($summaryParams) $summaryStmt->bind_param($summaryTypes, ...$summaryParams);
            $summaryStmt->execute();
            $summary = $summaryStmt->get_result()->fetch_assoc() ?: [];
            $summaryStmt->close();
        }

        $sql = $selectSql . $fromSql . $whereSql . " ORDER BY p.date DESC, p.sanction_id DESC";
        $dataTypes = $types;
        $dataParams = $params;
        if ($paginate) {
            $sql .= ' LIMIT ? OFFSET ?';
            $dataTypes .= 'ii'; $dataParams[] = $pageSize; $dataParams[] = $offset;
        }
        
        $stmt = $mysqli->prepare($sql);
        if (!$stmt) json_response(['error'=>'prepare_failed','message'=>$mysqli->error], 500);
        if(!empty($dataParams)) $stmt->bind_param($dataTypes, ...$dataParams);
        $stmt->execute();
        $res = $stmt->get_result();
        $rows = $res ? $res->fetch_all(MYSQLI_ASSOC) : [];
        if ($paginate) {
            json_response([
                'rows'=>$rows,
                'active_semester_id'=>$activeSemesterId,
                'selected_semester_id'=>$selectedSemesterId,
                'semester_options'=>$semesterOptions,
                'pagination'=>['page'=>$page,'page_size'=>$pageSize,'total'=>$total,'total_pages'=>$totalPages],
                'summary'=>[
                    'total'=>(int)($summary['total'] ?? 0),
                    'active'=>(int)($summary['active'] ?? 0),
                    'automatic'=>(int)($summary['automatic'] ?? 0),
                    'manual'=>(int)($summary['manual'] ?? 0),
                    'voided'=>(int)($summary['voided'] ?? 0),
                ]
            ]);
        }
        json_response($rows);
        break;

    case 'POST':
    case 'PUT':
    case 'PATCH':
    case 'DELETE':
        json_response(['error' => 'automatic_penalties_only', 'message' => 'Penalties are automatic. Submit an attendance edit request for an authorized reviewer to approve a correction.'], 403);
        break;
}
?>
