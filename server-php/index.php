<?php

ini_set('zlib.output_compression', 'Off');
ini_set('output_buffering', 'Off');
ini_set('output_handler', '');

ob_start();

error_reporting(E_ALL & ~E_DEPRECATED & ~E_STRICT & ~E_NOTICE & ~E_WARNING);
ini_set('display_errors', 0);

$security = [];
if (file_exists(__DIR__ . '/config/security.php')) {
    $security = require __DIR__ . '/config/security.php';
}

if (!empty($security['error_log'])) {
    ini_set('log_errors', '1');
    ini_set('error_log', $security['error_log']);
}

$allowed = $security['allowed_origins'] ?? ['*'];
$normalize = $security['normalize_origin'] ?? function ($origin) {
    if (empty($origin)) return '';
    $parts = parse_url(trim($origin));
    if (!$parts || empty($parts['scheme']) || empty($parts['host'])) return '';
    $base = $parts['scheme'] . '://' . $parts['host'];
    if (!empty($parts['port'])) $base .= ':' . $parts['port'];
    return $base;
};

$originHeader = $_SERVER['HTTP_ORIGIN'] ?? '';
$origin = $normalize($originHeader);

// If wildcard allowed, allow all origins
if (in_array('*', $allowed, true)) {
    header('Access-Control-Allow-Origin: *');
} elseif ($origin && in_array($origin, $allowed, true)) {
    // Reflect the exact origin for CORS
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
    // If you need cookies or HTTP auth cross-site, uncomment:
    // header('Access-Control-Allow-Credentials: true');
}

header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS, PUT, DELETE');

// Short-circuit preflight requests
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// 5. LOAD APP
require_once __DIR__ . '/config/database.php';
// Load app helpers (includes a lightweight JWT autoloader).
require_once __DIR__ . '/helpers/functions.php';

$request_uri = $_SERVER['REQUEST_URI'];
$path = parse_url($request_uri, PHP_URL_PATH);
$parts = explode('/', $path);

$api_prefix_key = array_search('api', $parts);
$endpoint_root = null;
$param1 = null;
$param2 = null;
if ($api_prefix_key !== false && isset($parts[$api_prefix_key + 1])) {
    $endpoint_root = $parts[$api_prefix_key + 1];
    $param1 = $parts[$api_prefix_key + 2] ?? null;
    $param2 = $parts[$api_prefix_key + 3] ?? null;
}

$request_method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$query = $_GET ?? [];
$authPayload = null;

function resolve_module_requirement($endpointRoot, $requestMethod, $param1, $param2, array $query, array $authPayload = null) {
    $endpoint = strtolower(trim((string)$endpointRoot));
    $subroute = strtolower(trim((string)$param1));
    $scope = strtolower(trim((string)($query['scope'] ?? '')));
    $report = strtolower(trim((string)($query['report'] ?? '')));
    $teacherId = isset($query['teacher_id']) && is_numeric($query['teacher_id']) ? (int)$query['teacher_id'] : 0;
    $authUserId = isset($authPayload['user_id']) ? (int)$authPayload['user_id'] : 0;

    switch ($endpoint) {
        case 'login':
        case 'forgot-password':
        case 'reset-password':
        case 'first-login-password':
        case 'qrcode':
        case 'worker-bootstrap':
            return $endpoint === 'first-login-password' ? '__authenticated' : null;

        case 'dashboard':
            if ($scope === 'self') {
                return ['any_of' => ['dashboard', 'faculty_dashboard']];
            }
            return 'dashboard';

        case 'attendance':
            if (in_array($subroute, ['check-in', 'mid-check', 'check-out'], true)) {
                return 'attendance';
            }
            if ($requestMethod === 'POST' && $subroute === '') {
                return 'attendancemgmt';
            }
            if ($requestMethod === 'PUT' && is_numeric($param1)) {
                return 'attendancemgmt';
            }
            if ($requestMethod === 'GET' && $teacherId > 0 && $authUserId > 0 && $teacherId === $authUserId) {
                return 'attendance';
            }
            return ['any_of' => ['attendancemgmt', 'attendance']];

        case 'reports':
            if ($report === 'attendance_logs') {
                return 'attendance_logs';
            }
            if ($report === 'system_logs') {
                return 'logs';
            }
            return 'reports';

        case 'audit-log':
            return 'logs';

        case 'buildings':
        case 'rooms':
        case 'floors':
            if ($requestMethod === 'GET') {
                return ['any_of' => ['locations', 'attendance', 'class_schedules', '3d_building', 'settings', 'reports']];
            }
            return 'locations';

        case 'camera-positions.php':
        case 'room-status.php':
            return '3d_building';

        case 'school':
            if ($requestMethod === 'GET') {
                return ['any_of' => ['settings', 'attendance', 'class_schedules', '3d_building']];
            }
            return 'settings';

        case 'roles':
            return 'users';

        case 'users':
            if (is_numeric($param1) && strtolower(trim((string)$param2)) === 'module-access') {
                return 'settings';
            }
            if (is_numeric($param1) && strtolower(trim((string)$param2)) === 'reset-default-password') {
                return 'settings';
            }
            if ($requestMethod === 'GET') {
                return ['any_of' => ['users', 'settings', 'reports', 'logs', 'leaves_file', 'leaves_approvals', 'substitutions', 'academic_manage', 'academic_program', 'class_schedules', 'attendancemgmt', 'attendance_logs']];
            }
            return 'users';

        case 'teachers':
        case 'deans':
            return ['any_of' => ['users', 'leaves_file', 'leaves_approvals', 'substitutions', 'academic_manage', 'reports', 'class_schedules', 'settings']];

        case 'class-schedules':
            if ($requestMethod === 'GET') {
                return ['any_of' => ['class_schedules', 'attendance', 'substitutions', 'schedule_edits']];
            }
            return 'class_schedules';

        case 'departments':
            if ($requestMethod === 'GET') {
                return ['any_of' => ['academic_admin', 'academic_program', 'users', 'class_schedules', 'attendancemgmt']];
            }
            return 'academic_admin';

        case 'programs':
            if ($requestMethod === 'GET') {
                return ['any_of' => ['academic_program', 'academic_manage', 'users', 'class_schedules']];
            }
            return 'academic_program';

        case 'sections':
        case 'subjects':
        case 'subject-offerings':
        case 'year-levels':
            if ($requestMethod === 'GET') {
                return ['any_of' => ['academic_manage', 'class_schedules']];
            }
            return 'academic_manage';

        case 'school-years':
        case 'semesters':
        case 'sessions':
            if ($requestMethod === 'GET') {
                return ['any_of' => ['academic_admin', 'class_schedules']];
            }
            return 'academic_admin';

        case 'leaves':
            if ($requestMethod === 'GET') {
                return ['any_of' => ['leaves_file', 'leaves_approvals', 'attendance']];
            }
            return ['any_of' => ['leaves_file', 'leaves_approvals']];

        case 'my-schedule':
            return 'attendance';

        case 'substitute':
        case 'substitutions':
            if ($requestMethod === 'GET') {
                return ['any_of' => ['substitutions', 'attendance']];
            }
            return 'substitutions';

        case 'request-edit':
            if ($subroute === 'attendance') {
                $isSelfScope = in_array($scope, ['my', 'mine', 'self'], true);
                if (($requestMethod === 'POST' && !is_numeric($param2)) || $isSelfScope) {
                    return 'attendance';
                }
                return 'attendance_edits';
            }
            if ($subroute === 'schedule') {
                $isSelfScope = in_array($scope, ['my', 'mine', 'self'], true);
                if (($requestMethod === 'POST' && !is_numeric($param2)) || $isSelfScope) {
                    return 'attendance';
                }
                return 'schedule_edits';
            }
            return ['any_of' => ['attendance', 'attendance_edits', 'schedule_edits']];

        case 'notification':
        case 'notifications':
        case 'penalties':
        case 'penalty-types':
            return '__authenticated';

        case 'app-settings':
            if ($requestMethod === 'GET') {
                return '__authenticated';
            }
            return 'settings';

        default:
            return '__authenticated';
    }
}

if ($endpoint_root !== null) {
    $moduleRequirement = resolve_module_requirement($endpoint_root, $request_method, $param1, $param2, $query, $authPayload ?? []);
    if ($moduleRequirement !== null) {
        $authPayload = app_require_module_access($mysqli, $moduleRequirement, $authPayload);
    }
}

switch ($endpoint_root) {
    case 'dashboard':
        require_once __DIR__ . '/api/dashboard.php';
        break;
    case 'attendance':
        require_once __DIR__ . '/api/attendance.php';
        break;
    case 'qrcode':
        require_once __DIR__ . '/api/qrcode.php';
        break;
    case 'reports':
        require_once __DIR__ . '/api/reports.php';
        break;
    case 'audit-log':
        require_once __DIR__ . '/api/audit-log.php';
        break;
    case 'buildings':
    case 'rooms':
    case 'floors':
    case 'school':
        require_once __DIR__ . '/api/locations.php';
        break;
    case 'camera-positions.php':
        require_once __DIR__ . '/api/camera-positions.php';
        break;
    case 'room-status.php':
        require_once __DIR__ . '/api/room-status.php';
        break;
    case 'login':
        require_once __DIR__ . '/api/login.php';
        break;
    case 'forgot-password':
        require_once __DIR__ . '/api/forgot-password.php';
        break;
    case 'reset-password':
        require_once __DIR__ . '/api/reset-password.php';
        break;
    case 'first-login-password':
        require_once __DIR__ . '/api/first-login-password.php';
        break;
    case 'roles':
    case 'users':
    case 'teachers':
    case 'deans':
    case 'class-schedules':
        require_once __DIR__ . '/api/main.php';
        break;
    // Academic related endpoints moved to academic.php
    case 'departments':
    case 'programs':
    case 'sections':
    case 'school-years':
    case 'semesters':
    case 'sessions':
    case 'subjects':
    case 'subject-offerings':
    case 'year-levels':
        require_once __DIR__ . '/api/academic.php';
        break;
    case 'leaves':
        require_once __DIR__ . '/api/leaves.php';
        break;
    case 'my-schedule':
        require_once __DIR__ . '/api/my-schedule.php';
        break;
    case 'penalty-types':
        require_once __DIR__ . '/api/penalties.php';
        break;
    case 'substitute':
    case 'substitutions':
        require_once __DIR__ . '/api/substitute.php';
        break;
    case 'penalties':
        require_once __DIR__ . '/api/penalties.php';
        break;
    case 'request-edit':
        require_once __DIR__ . '/api/request-edit.php';
        break;
    case 'notification':
    case 'notifications':
        require_once __DIR__ . '/api/notification.php';
        break;
    case 'app-settings':
        require_once __DIR__ . '/api/app-settings.php';
        break;
    case 'login-monitor':
        require_once __DIR__ . '/api/login-monitor.php';
        break;
    case 'worker-bootstrap':
        require_once __DIR__ . '/api/worker-bootstrap.php';
        break;
    default:
        http_response_code(404);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'API endpoint not found']);
        break;
}
