<?php
// server-php/helpers/functions.php

// Register a focused autoloader for firebase/php-jwt so API endpoints can run
// even if other Composer dependencies target a newer PHP version.
(function () {
    static $registered = false;
    if ($registered) {
        return;
    }
    $registered = true;

    $prefix = 'Firebase\\JWT\\';
    $jwtBase = __DIR__ . '/../vendor/firebase/php-jwt/src/';
    if (!is_dir($jwtBase)) {
        return;
    }

    spl_autoload_register(function ($class) use ($prefix, $jwtBase) {
        if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
            return;
        }
        $relative = substr($class, strlen($prefix));
        $file = $jwtBase . str_replace('\\', '/', $relative) . '.php';
        if (file_exists($file)) {
            require_once $file;
        }
    });
})();

use Firebase\JWT\JWT;
use Firebase\JWT\Key;

function json_response($data, $status_code = 200) {
    // Clean any buffered output to ensure clean JSON
    if (ob_get_length() !== false) {
        @ob_end_clean();
    }
    http_response_code($status_code);
    header('Content-Type: application/json');
    // Ensure accurate content length (Helps HTTP/2 framing)
    $json = json_encode($data);
    header('Content-Length: ' . strlen($json));
    echo $json;
    exit;
}

function app_get_auth_header_value() {
    $authHeader = null;
    $candidates = ['HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION', 'HTTP_X_AUTHORIZATION', 'HTTP_X_API_TOKEN', 'HTTP_AUTH', 'AUTHORIZATION'];
    foreach ($candidates as $key) {
        if (!empty($_SERVER[$key])) {
            $authHeader = $_SERVER[$key];
            break;
        }
    }
    if (empty($authHeader) && function_exists('apache_request_headers')) {
        $headers = apache_request_headers();
        foreach (['Authorization', 'authorization', 'AUTHORIZATION'] as $name) {
            if (!empty($headers[$name])) {
                $authHeader = $headers[$name];
                break;
            }
        }
    }
    $queryToken = $_GET['token'] ?? null;
    if (empty($authHeader) && !empty($queryToken)) {
        $authHeader = 'Bearer ' . $queryToken;
    }
    return $authHeader;
}

function app_decode_auth_token_payload($required = false) {
    $authHeader = app_get_auth_header_value();
    if (empty($authHeader)) {
        if ($required) {
            json_response(['ok' => false, 'error' => 'missing_authorization'], 401);
        }
        return null;
    }

    if (!preg_match('/Bearer\s+(\S+)/i', $authHeader, $matches)) {
        if ($required) {
            json_response(['ok' => false, 'error' => 'invalid_authorization_format'], 401);
        }
        return null;
    }

    $token = $matches[1];
    $sec = [];
    if (file_exists(__DIR__ . '/../config/security.php')) {
        $sec = require __DIR__ . '/../config/security.php';
    }
    $secret_key = $sec['jwt_secret'] ?? 'your-secret-key';

    try {
        $decoded = JWT::decode($token, new Key($secret_key, 'HS256'));
        return [
            'user_id' => isset($decoded->user_id) ? (int)$decoded->user_id : null,
            'role_id' => isset($decoded->role_id) ? (int)$decoded->role_id : null,
            'dept_id' => isset($decoded->dept_id) ? (int)$decoded->dept_id : null,
            'email' => isset($decoded->email) ? (string)$decoded->email : null,
            'iat' => isset($decoded->iat) ? (int)$decoded->iat : null,
            'exp' => isset($decoded->exp) ? (int)$decoded->exp : null,
        ];
    } catch (Throwable $e) {
        if ($required) {
            json_response(['ok' => false, 'error' => 'invalid_token', 'message' => $e->getMessage()], 401);
        }
        return null;
    }
}

function app_get_user_department_id($mysqli, $userId) {
    $uid = (int)$userId;
    if ($uid <= 0) {
        return null;
    }

    $stmt = $mysqli->prepare("SELECT dept_id FROM tbl_users WHERE user_id = ? LIMIT 1");
    if (!$stmt) {
        return null;
    }
    $stmt->bind_param('i', $uid);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if (!$row || !array_key_exists('dept_id', $row) || $row['dept_id'] === null) {
        return null;
    }
    return (int)$row['dept_id'];
}

function app_permission_matrix() {
    static $matrix = null;
    if ($matrix !== null) {
        return $matrix;
    }

    $matrix = [
        'dashboard' => ['admin', 'dean', 'program_head', 'secretary'],
        'faculty_dashboard' => ['dean', 'program_head', 'secretary', 'teacher'],
        'users' => ['admin', 'dean', 'program_head', 'secretary'],
        'attendance' => ['dean', 'program_head', 'secretary', 'teacher'],
        'attendancemgmt' => ['admin', 'secretary', 'dean', 'program_head'],
        'class_schedules' => ['admin', 'dean', 'program_head', 'secretary'],
        '3d_building' => ['admin', 'dean', 'program_head', 'secretary'],
        'attendance_edits' => ['dean'],
        'schedule_edits' => ['secretary'],
        'academic_admin' => ['admin'],
        'academic_manage' => ['admin', 'dean', 'program_head', 'secretary'],
        'academic_program' => ['admin', 'dean'],
        'locations' => ['admin'],
        'reports' => ['admin', 'dean', 'program_head', 'secretary', 'teacher'],
        'leaves_file' => ['secretary'],
        'leaves_approvals' => ['admin', 'dean', 'program_head'],
        'substitutions' => ['secretary', 'dean'],
        'logs' => ['admin', 'dean', 'program_head', 'secretary'],
        'settings' => ['admin', 'dean'],
        'attendance_logs' => ['admin', 'dean', 'program_head'],
    ];

    return $matrix;
}

function app_role_id_to_name_map() {
    static $map = [
        1 => 'admin',
        2 => 'dean',
        3 => 'program_head',
        4 => 'secretary',
        5 => 'teacher',
    ];
    return $map;
}

function app_role_name_from_id($roleId) {
    $map = app_role_id_to_name_map();
    $rid = (int)$roleId;
    return $map[$rid] ?? null;
}

function app_normalize_module_token($value) {
    $token = strtolower(trim((string)$value));
    if ($token === '') {
        return '';
    }
    $token = preg_replace('/[^a-z0-9]+/', '_', $token);
    $token = trim((string)$token, '_');
    if ($token === '') {
        return '';
    }

    $matrix = app_permission_matrix();
    return array_key_exists($token, $matrix) ? $token : '';
}

function app_get_default_modules_for_role($roleName) {
    $role = strtolower(trim((string)$roleName));
    if ($role === '') {
        return [];
    }

    $out = [];
    foreach (app_permission_matrix() as $moduleKey => $roles) {
        if (in_array($role, $roles, true)) {
            $out[] = $moduleKey;
        }
    }
    sort($out, SORT_STRING);
    return $out;
}

function app_has_user_module_permission_columns($mysqli) {
    static $cached = null;
    if ($cached !== null) {
        return $cached;
    }

    $permissionModeColCheck = $mysqli->query("SHOW COLUMNS FROM tbl_users LIKE 'permission_mode'");
    $modulePermissionsColCheck = $mysqli->query("SHOW COLUMNS FROM tbl_users LIKE 'module_permissions'");
    $cached = ($permissionModeColCheck && $permissionModeColCheck->num_rows > 0)
        && ($modulePermissionsColCheck && $modulePermissionsColCheck->num_rows > 0);
    return $cached;
}

function app_decode_module_permissions_value($raw) {
    if ($raw === null || $raw === '') {
        return ['allow' => [], 'deny' => []];
    }

    $parsed = is_array($raw) ? $raw : json_decode((string)$raw, true);
    if (!is_array($parsed)) {
        return ['allow' => [], 'deny' => []];
    }

    $normalize = function ($list) {
        if (!is_array($list)) {
            return [];
        }

        $out = [];
        foreach ($list as $entry) {
            $token = app_normalize_module_token($entry);
            if ($token !== '') {
                $out[$token] = true;
            }
        }

        $keys = array_keys($out);
        sort($keys, SORT_STRING);
        return $keys;
    };

    return [
        'allow' => $normalize($parsed['allow'] ?? []),
        'deny' => $normalize($parsed['deny'] ?? []),
    ];
}

function app_compute_effective_modules($roleName, $rawPermissions = null) {
    $effective = [];
    foreach (app_get_default_modules_for_role($roleName) as $moduleKey) {
        $effective[$moduleKey] = true;
    }

    $bag = app_decode_module_permissions_value($rawPermissions);
    foreach ($bag['allow'] as $moduleKey) {
        $effective[$moduleKey] = true;
    }
    foreach ($bag['deny'] as $moduleKey) {
        unset($effective[$moduleKey]);
    }

    $keys = array_keys($effective);
    sort($keys, SORT_STRING);
    return $keys;
}

function app_get_user_effective_modules($mysqli, $userId, $roleId = null) {
    static $cache = [];

    $uid = (int)$userId;
    if ($uid <= 0) {
        return [];
    }
    if (array_key_exists($uid, $cache)) {
        return $cache[$uid];
    }

    $hasModuleColumns = app_has_user_module_permission_columns($mysqli);
    $selectPermissionCols = $hasModuleColumns
        ? ", permission_mode, module_permissions"
        : ", NULL AS permission_mode, NULL AS module_permissions";

    $stmt = $mysqli->prepare("SELECT role_id{$selectPermissionCols} FROM tbl_users WHERE user_id = ? LIMIT 1");
    if (!$stmt) {
        $resolvedRoleName = app_role_name_from_id($roleId);
        $cache[$uid] = app_get_default_modules_for_role($resolvedRoleName);
        return $cache[$uid];
    }

    $stmt->bind_param('i', $uid);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    $resolvedRoleId = $row && isset($row['role_id']) ? (int)$row['role_id'] : (int)$roleId;
    $resolvedRoleName = app_role_name_from_id($resolvedRoleId);
    if (!$resolvedRoleName) {
        $cache[$uid] = [];
        return $cache[$uid];
    }

    $permissionMode = isset($row['permission_mode']) ? strtolower(trim((string)$row['permission_mode'])) : 'default';
    $rawPermissions = ($permissionMode === 'custom') ? ($row['module_permissions'] ?? null) : null;
    $cache[$uid] = app_compute_effective_modules($resolvedRoleName, $rawPermissions);
    return $cache[$uid];
}

function app_user_has_module_access($mysqli, $userId, $roleId, $moduleKey) {
    $token = app_normalize_module_token($moduleKey);
    if ($token === '') {
        return false;
    }

    $effective = app_get_user_effective_modules($mysqli, $userId, $roleId);
    return in_array($token, $effective, true);
}

function app_require_module_access($mysqli, $requirement, $auth = null) {
    if ($requirement === null) {
        return is_array($auth) ? $auth : app_decode_auth_token_payload(false);
    }

    $resolvedAuth = is_array($auth) ? $auth : app_decode_auth_token_payload(true);
    $userId = isset($resolvedAuth['user_id']) ? (int)$resolvedAuth['user_id'] : 0;
    $roleId = isset($resolvedAuth['role_id']) ? (int)$resolvedAuth['role_id'] : 0;

    if ($userId <= 0) {
        json_response(['ok' => false, 'error' => 'missing_authorization'], 401);
    }

    if ($requirement === '__authenticated') {
        return $resolvedAuth;
    }

    $mode = 'any';
    $modules = [];
    if (is_string($requirement)) {
        $modules = [$requirement];
    } elseif (is_array($requirement)) {
        if (isset($requirement['all_of']) && is_array($requirement['all_of'])) {
            $mode = 'all';
            $modules = $requirement['all_of'];
        } elseif (isset($requirement['any_of']) && is_array($requirement['any_of'])) {
            $modules = $requirement['any_of'];
        } else {
            $modules = $requirement;
        }
    }

    $normalizedModules = [];
    foreach ($modules as $moduleKey) {
        $token = app_normalize_module_token($moduleKey);
        if ($token !== '') {
            $normalizedModules[] = $token;
        }
    }
    $normalizedModules = array_values(array_unique($normalizedModules));

    if (empty($normalizedModules)) {
        return $resolvedAuth;
    }

    $hasAccess = ($mode === 'all');
    foreach ($normalizedModules as $moduleKey) {
        $allowed = app_user_has_module_access($mysqli, $userId, $roleId, $moduleKey);
        if ($mode === 'all' && !$allowed) {
            $hasAccess = false;
            break;
        }
        if ($mode !== 'all' && $allowed) {
            $hasAccess = true;
            break;
        }
        if ($mode !== 'all') {
            $hasAccess = false;
        }
    }

    if (!$hasAccess) {
        json_response([
            'ok' => false,
            'error' => 'forbidden',
            'message' => 'You do not have module access for this action.',
            'required_modules' => $normalizedModules,
        ], 403);
    }

    return $resolvedAuth;
}

function getDistanceMeters($lat1, $lon1, $lat2, $lon2) {
  $R = 6371000; // Earth radius in meters
  $dLat = deg2rad($lat2 - $lat1);
  $dLon = deg2rad($lon2 - $lon1);
  $a =
    sin($dLat / 2) * sin($dLat / 2) +
    cos(deg2rad($lat1)) *
      cos(deg2rad($lat2)) *
      sin($dLon / 2) *
      sin($dLon / 2);

  $c = 2 * atan2(sqrt($a), sqrt(1 - $a));
  return $R * $c;
}

function isInsideBox($coordsLat, $coordsLon, $roomLat, $roomLon, $roomRadiusMeters) {
  if (!is_numeric($coordsLat) || !is_numeric($coordsLon) || $roomLat == null || $roomLon == null || $roomRadiusMeters == null) return false;
  $metersPerDegLat = 111320; // ~ meters per degree latitude
  $deltaLat = $roomRadiusMeters / $metersPerDegLat;
  $latRad = deg2rad($roomLat);
  $metersPerDegLon = $metersPerDegLat * cos($latRad) ?: 1e-6;
  $deltaLon = $roomRadiusMeters / $metersPerDegLon;

  $minLat = $roomLat - $deltaLat;
  $maxLat = $roomLat + $deltaLat;
  $minLon = $roomLon - $deltaLon;
  $maxLon = $roomLon + $deltaLon;

  return $coordsLat >= $minLat && $coordsLat <= $maxLat && $coordsLon >= $minLon && $coordsLon <= $maxLon;
}

function toDateYMD($d) {
    if (!$d) return null;
    try {
        $dt = new DateTime($d);
        return $dt->format('Y-m-d');
    } catch (Exception $e) {
        return null;
    }
}

function generate_random_token($length = 32) {
    return bin2hex(random_bytes($length / 2));
}

function get_input() {
    return json_decode(file_get_contents('php://input'), true);
}
