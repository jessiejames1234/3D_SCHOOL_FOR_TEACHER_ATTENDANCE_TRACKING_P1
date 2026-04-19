<?php
// server-php/api/main.php
require_once __DIR__ . '/../helpers/socket_helper.php';
require_once __DIR__ . '/../helpers/log_helper.php'; // enable system logging
require_once __DIR__ . '/../helpers/mail_helper.php';

// No need to include db/helpers again, index.php does it.
global $mysqli;

// make JWT class available from vendor
use Firebase\JWT\JWT;

// Capture authenticated user (optional) so logs can record who performed the action
$authHeader = null;
$candidates = ['HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION', 'HTTP_X_AUTHORIZATION', 'HTTP_X_API_TOKEN', 'HTTP_AUTH', 'AUTHORIZATION'];
foreach ($candidates as $k) { if (!empty($_SERVER[$k])) { $authHeader = $_SERVER[$k]; break; } }
if (empty($authHeader) && function_exists('apache_request_headers')) {
    $headers = apache_request_headers();
    foreach (['Authorization','authorization','AUTHORIZATION'] as $h) { if (!empty($headers[$h])) { $authHeader = $headers[$h]; break; } }
}
$queryToken = $_GET['token'] ?? null;
if (empty($authHeader) && !empty($queryToken)) { $authHeader = 'Bearer ' . $queryToken; }
$authUserId = null; // default to null (system)
$authRoleId = null;
if (!empty($authHeader) && preg_match('/Bearer\s+(\S+)/i', $authHeader, $m)) {
    $token = $m[1];
    $sec = [];
    if (file_exists(__DIR__ . '/../config/security.php')) $sec = require __DIR__ . '/../config/security.php';
    $secret_key = $sec['jwt_secret'] ?? 'your-secret-key';
    try {
        $decoded = \Firebase\JWT\JWT::decode($token, new \Firebase\JWT\Key($secret_key, 'HS256'));
        $authUserId = isset($decoded->user_id) ? (int)$decoded->user_id : null;
        $authRoleId = isset($decoded->role_id) ? (int)$decoded->role_id : null;
    } catch (Throwable $_) { /* ignore invalid token for logging */ }
}
$authUserDeptId = null;
if ($authUserId) {
    $deptStmt = $mysqli->prepare("SELECT dept_id FROM tbl_users WHERE user_id = ? LIMIT 1");
    if ($deptStmt) {
        $deptStmt->bind_param("i", $authUserId);
        $deptStmt->execute();
        $deptRow = $deptStmt->get_result()->fetch_assoc();
        if ($deptRow && isset($deptRow['dept_id'])) {
            $authUserDeptId = $deptRow['dept_id'] !== null ? (int)$deptRow['dept_id'] : null;
        }
    }
}
$request_method = $_SERVER['REQUEST_METHOD'];
$input = get_input();

// The router in index.php has already identified the endpoint root.
// We can use the full path to distinguish between similar endpoints if needed.
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$parts = explode('/', $path);
$api_prefix_key = array_search('api', $parts);
$endpoint = $parts[$api_prefix_key + 1] ?? null;
$param1 = $parts[$api_prefix_key + 2] ?? null;
$param2 = $parts[$api_prefix_key + 3] ?? null;

$permissionModeColCheck = $mysqli->query("SHOW COLUMNS FROM tbl_users LIKE 'permission_mode'");
$modulePermissionsColCheck = $mysqli->query("SHOW COLUMNS FROM tbl_users LIKE 'module_permissions'");
$hasPermissionModeCol = $permissionModeColCheck && $permissionModeColCheck->num_rows > 0;
$hasModulePermissionsCol = $modulePermissionsColCheck && $modulePermissionsColCheck->num_rows > 0;
$hasUserModulePermissions = $hasPermissionModeCol && $hasModulePermissionsCol;

$roleIdToName = [
    1 => 'admin',
    2 => 'dean',
    3 => 'program_head',
    4 => 'secretary',
    5 => 'teacher',
];

$permissionMatrix = [
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
$allModuleKeys = array_values(array_keys($permissionMatrix));
$allModuleLookup = array_fill_keys($allModuleKeys, true);

$normalize_module_key = function($value) {
    $token = strtolower(trim((string)$value));
    if ($token === '') return '';
    $token = preg_replace('/[^a-z0-9]+/', '_', $token);
    $token = trim((string)$token, '_');
    return $token;
};

$get_role_name_by_id = function($roleId) use ($roleIdToName) {
    $rid = (int)$roleId;
    return $roleIdToName[$rid] ?? null;
};

$get_default_modules_for_role = function($roleName) use ($permissionMatrix) {
    $role = strtolower(trim((string)$roleName));
    if ($role === '') return [];
    $modules = [];
    foreach ($permissionMatrix as $moduleKey => $allowedRoles) {
        if (in_array($role, $allowedRoles, true)) {
            $modules[] = $moduleKey;
        }
    }
    sort($modules, SORT_STRING);
    return $modules;
};

$normalize_module_list = function($list) use ($normalize_module_key, $allModuleLookup) {
    if (!is_array($list)) return [];
    $out = [];
    foreach ($list as $raw) {
        $token = $normalize_module_key($raw);
        if ($token === '' || !isset($allModuleLookup[$token])) continue;
        $out[$token] = true;
    }
    $keys = array_keys($out);
    sort($keys, SORT_STRING);
    return $keys;
};

$decode_module_permissions = function($raw) use ($normalize_module_list) {
    if ($raw === null || $raw === '') {
        return ['allow' => [], 'deny' => []];
    }
    $parsed = is_array($raw) ? $raw : json_decode((string)$raw, true);
    if (!is_array($parsed)) {
        return ['allow' => [], 'deny' => []];
    }

    $allow = $normalize_module_list($parsed['allow'] ?? []);
    $deny = $normalize_module_list($parsed['deny'] ?? []);
    return ['allow' => $allow, 'deny' => $deny];
};

$compute_effective_modules = function($roleName, $rawPermissions) use ($get_default_modules_for_role, $decode_module_permissions) {
    $base = $get_default_modules_for_role($roleName);
    $permissionBag = $decode_module_permissions($rawPermissions);
    $effective = [];
    foreach ($base as $moduleKey) $effective[$moduleKey] = true;
    foreach ($permissionBag['allow'] as $moduleKey) $effective[$moduleKey] = true;
    foreach ($permissionBag['deny'] as $moduleKey) unset($effective[$moduleKey]);
    $keys = array_keys($effective);
    sort($keys, SORT_STRING);
    return $keys;
};

$get_dean_manageable_modules = function() use ($get_default_modules_for_role) {
    $roles = ['program_head', 'secretary', 'teacher'];
    $bag = [];
    foreach ($roles as $roleName) {
        $mods = $get_default_modules_for_role($roleName);
        foreach ($mods as $m) $bag[$m] = true;
    }
    $keys = array_keys($bag);
    sort($keys, SORT_STRING);
    return $keys;
};

switch ($endpoint) {
    case 'login':
        if ($request_method === 'POST') {
            try {
                $identifier = isset($input['email']) ? trim((string)$input['email']) : null;
                $password = $input['password'] ?? null;
                if (!$identifier || !$password) {
                    json_response(['error' => 'Missing email / ID or password'], 400);
                }

                // Allow login by email OR id_number using the same identifier
                $selectPermissionColumns = $hasUserModulePermissions
                    ? ", permission_mode, module_permissions"
                    : ", NULL AS permission_mode, NULL AS module_permissions";
                $stmt = $mysqli->prepare("SELECT user_id, role_id, dept_id, first_name, last_name, email, password_hash{$selectPermissionColumns} FROM tbl_users WHERE email = ? OR id_number = ? LIMIT 1");
                $stmt->bind_param("ss", $identifier, $identifier);
                $stmt->execute();
                $result = $stmt->get_result();
                $user = $result->fetch_assoc();

                if (!$user || !password_verify($password, $user['password_hash'])) {
                    json_response(['error' => 'Invalid email / ID or password'], 401);
                }

                $sec = [];
                if (file_exists(__DIR__ . '/../config/security.php')) $sec = require __DIR__ . '/../config/security.php';
                $secret_key = $sec['jwt_secret'] ?? 'your-secret-key';
                $payload = [
                    'user_id' => $user['user_id'],
                    'email' => $user['email'],
                    'role_id' => $user['role_id'],
                    'dept_id' => isset($user['dept_id']) && $user['dept_id'] !== null ? (int)$user['dept_id'] : null,
                    'iat' => time(),
                    'exp' => time() + (60 * 60 * 2) // 2 hours
                ];
                $token = JWT::encode($payload, $secret_key, 'HS256');

                json_response([
                    'token' => $token,
                    'user' => [
                        'user_id' => $user['user_id'],
                        'first_name' => $user['first_name'],
                        'last_name' => $user['last_name'],
                        'email' => $user['email'],
                        'role_id' => $user['role_id'],
                        'dept_id' => $user['dept_id'],
                        'permission_mode' => $hasUserModulePermissions ? ($user['permission_mode'] ?? 'default') : 'default',
                        'module_permissions' => $hasUserModulePermissions ? $decode_module_permissions($user['module_permissions'] ?? null) : ['allow' => [], 'deny' => []],
                    ]
                ]);
            } catch (Throwable $e) {
                // Catch any error (including from JWT encode) and return a proper JSON response
                json_response(['error' => 'An internal server error occurred during login.', 'details' => $e->getMessage()], 500);
            }
        }
        break;

    case 'users':
        if (!$authUserId) {
            json_response(['error' => 'unauthorized', 'message' => 'Authentication required'], 401);
        }
        $isAdminRole = ((int)$authRoleId === 1);

        $normalize_user_email = function($value) {
            return strtolower(trim((string)$value));
        };
        $is_valid_user_email = function($value) {
            return (bool)preg_match('/^[a-z0-9._%+\-]+@phinmaed\.com$/i', trim((string)$value));
        };
        $normalize_id_number = function($value) {
            return trim((string)$value);
        };
        $is_valid_id_number = function($value) {
            return (bool)preg_match('/^02-\d{4}-\d+$/', trim((string)$value));
        };
        $assignedHeadColCheck = $mysqli->query("SHOW COLUMNS FROM tbl_users LIKE 'assigned_program_head_id'");
        $hasAssignedProgramHeadCol = $assignedHeadColCheck && $assignedHeadColCheck->num_rows > 0;

        $validateAssignedProgramHead = function($headId, $deptId) use ($mysqli) {
            $pq = $mysqli->prepare("SELECT p.program_id, p.dept_id, p.head_id, u.role_id FROM tbl_programs p LEFT JOIN tbl_users u ON p.head_id = u.user_id WHERE p.program_id = ? LIMIT 1");
            if (!$pq) return 'Failed to validate Program Head program assignment.';
            $pq->bind_param("i", $headId);
            $pq->execute();
            $programRow = $pq->get_result()->fetch_assoc();
            if (!$programRow) return 'Assigned program does not exist.';
            if (empty($programRow['head_id'])) return 'Assigned program has no Program Head.';
            if ((int)($programRow['role_id'] ?? 0) !== 3) return 'Assigned program head user is invalid.';
            $programDeptId = isset($programRow['dept_id']) && $programRow['dept_id'] !== null ? (int)$programRow['dept_id'] : null;
            if ($deptId !== null && $programDeptId !== null && (int)$programDeptId !== (int)$deptId) {
                return 'Assigned program must belong to the same department.';
            }
            return null;
        };

        $sendAccountCreatedEmail = function($firstName, $lastName, $email, $idNumber) use ($mysqli, $authUserId) {
            $recipient = strtolower(trim((string)$email));
            if ($recipient === '') {
                return ['sent' => false, 'error' => 'Missing recipient email'];
            }

            $schoolId = trim((string)$idNumber);
            $username = $schoolId !== '' ? ($schoolId . ' or ' . $recipient) : $recipient;

            try {
                if (!function_exists('send_new_account_email')) {
                    return ['sent' => false, 'error' => 'Email helper is unavailable'];
                }
                $sent = send_new_account_email(
                    $recipient,
                    (string)$firstName,
                    (string)$lastName,
                    $username
                );
            } catch (Throwable $e) {
                error_log('[users] Failed to send account-created email to ' . $recipient . ': ' . $e->getMessage());
                return ['sent' => false, 'error' => 'Mail exception: ' . $e->getMessage()];
            }

            if (!$sent) {
                $msg = "Failed to send account-created email to {$recipient}";
                log_system_action($mysqli, $authUserId, 'send_account_email_failed', $msg);
                return ['sent' => false, 'error' => 'Mail delivery failed'];
            }

            return ['sent' => true, 'error' => null];
        };

        $programHeadDeptId = null;
        if ((int)$authRoleId === 3) {
            $phScopeStmt = $mysqli->prepare("SELECT dept_id FROM tbl_programs WHERE head_id = ? LIMIT 1");
            if ($phScopeStmt) {
                $phScopeStmt->bind_param("i", $authUserId);
                $phScopeStmt->execute();
                $phScopeRow = $phScopeStmt->get_result()->fetch_assoc();
                if ($phScopeRow && isset($phScopeRow['dept_id']) && $phScopeRow['dept_id'] !== null) {
                    $programHeadDeptId = (int)$phScopeRow['dept_id'];
                }
            }
        }

        $isDeanRole = ((int)$authRoleId === 2);
        $isModuleAccessEndpoint = (is_numeric($param1) && strtolower((string)$param2) === 'module-access');
        if ($isModuleAccessEndpoint) {
            if (!$isAdminRole && !$isDeanRole) {
                json_response(['error' => 'forbidden', 'message' => 'Only admin and dean can manage module access overrides.'], 403);
            }

            $targetUserId = (int)$param1;
            $permSelect = $hasUserModulePermissions
                ? ", permission_mode, module_permissions"
                : ", NULL AS permission_mode, NULL AS module_permissions";
            $targetStmt = $mysqli->prepare("SELECT user_id, role_id, dept_id, first_name, last_name{$permSelect} FROM tbl_users WHERE user_id = ? LIMIT 1");
            if (!$targetStmt) {
                json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
            }
            $targetStmt->bind_param("i", $targetUserId);
            $targetStmt->execute();
            $targetUser = $targetStmt->get_result()->fetch_assoc();
            if (!$targetUser) {
                json_response(['error' => 'not_found', 'message' => 'User not found.'], 404);
            }

            $targetRoleId = isset($targetUser['role_id']) ? (int)$targetUser['role_id'] : 0;
            $targetDeptId = isset($targetUser['dept_id']) && $targetUser['dept_id'] !== null ? (int)$targetUser['dept_id'] : null;
            $targetRoleName = $get_role_name_by_id($targetRoleId);
            if (!$targetRoleName) {
                json_response(['error' => 'validation', 'message' => 'Target user role is invalid.'], 400);
            }

            if ($isDeanRole) {
                if ($authUserDeptId === null) {
                    json_response(['error' => 'forbidden', 'message' => 'Dean is not assigned to a department.'], 403);
                }
                if (!in_array($targetRoleId, [3, 4, 5], true)) {
                    json_response(['error' => 'forbidden', 'message' => 'Dean can only manage Program Head, Secretary, and Teacher users.'], 403);
                }
                if ($targetDeptId === null || (int)$targetDeptId !== (int)$authUserDeptId) {
                    json_response(['error' => 'forbidden', 'message' => 'Dean can only manage users inside the same department.'], 403);
                }
            }

            $roleDefaultModules = $get_default_modules_for_role($targetRoleName);
            $effectiveModules = $compute_effective_modules($targetRoleName, $targetUser['module_permissions'] ?? null);
            $managedModules = $isAdminRole ? $allModuleKeys : $get_dean_manageable_modules();
            $managedLookup = array_fill_keys($managedModules, true);

            $storedMode = 'default';
            if ($hasUserModulePermissions && !empty($targetUser['permission_mode'])) {
                $candidate = strtolower(trim((string)$targetUser['permission_mode']));
                $storedMode = ($candidate === 'custom') ? 'custom' : 'default';
            }
            $storedPermissions = $hasUserModulePermissions
                ? $decode_module_permissions($targetUser['module_permissions'] ?? null)
                : ['allow' => [], 'deny' => []];

            if ($request_method === 'GET') {
                json_response([
                    'user_id' => $targetUserId,
                    'first_name' => $targetUser['first_name'] ?? '',
                    'last_name' => $targetUser['last_name'] ?? '',
                    'role_id' => $targetRoleId,
                    'role_name' => $targetRoleName,
                    'dept_id' => $targetDeptId,
                    'permission_mode' => $storedMode,
                    'module_permissions' => $storedPermissions,
                    'role_default_modules' => $roleDefaultModules,
                    'manageable_modules' => $managedModules,
                    'effective_modules' => $effectiveModules,
                    'schema_ready' => $hasUserModulePermissions,
                ]);
            }

            if ($request_method !== 'PUT' && $request_method !== 'POST') {
                json_response(['error' => 'method_not_allowed'], 405);
            }

            if (!$hasUserModulePermissions) {
                json_response([
                    'error' => 'schema_mismatch',
                    'message' => 'Database is missing permission_mode/module_permissions columns. Run the latest migration first.',
                ], 500);
            }

            $selectedModules = null;
            if (array_key_exists('selected_modules', $input)) {
                $selectedModules = $normalize_module_list($input['selected_modules']);
            }

            $nextMode = isset($input['permission_mode']) ? strtolower(trim((string)$input['permission_mode'])) : null;
            $nextPermissions = null;

            if ($selectedModules !== null) {
                foreach ($selectedModules as $moduleKey) {
                    if (!isset($managedLookup[$moduleKey])) {
                        json_response(['error' => 'forbidden_module', 'message' => "Module '{$moduleKey}' is outside your management scope."], 403);
                    }
                }

                $baseLookup = array_fill_keys($roleDefaultModules, true);
                $selectedLookup = array_fill_keys($selectedModules, true);
                $allow = [];
                $deny = [];

                foreach ($selectedModules as $moduleKey) {
                    if (!isset($baseLookup[$moduleKey])) {
                        $allow[] = $moduleKey;
                    }
                }
                foreach ($roleDefaultModules as $moduleKey) {
                    if (!isset($selectedLookup[$moduleKey])) {
                        $deny[] = $moduleKey;
                    }
                }

                sort($allow, SORT_STRING);
                sort($deny, SORT_STRING);
                $nextPermissions = ['allow' => $allow, 'deny' => $deny];
                $nextMode = (empty($allow) && empty($deny)) ? 'default' : 'custom';
            } else {
                if ($nextMode !== 'custom') {
                    $nextMode = 'default';
                }
                $incomingBag = $decode_module_permissions($input['module_permissions'] ?? null);
                foreach (['allow', 'deny'] as $bucket) {
                    foreach ($incomingBag[$bucket] as $moduleKey) {
                        if (!isset($managedLookup[$moduleKey])) {
                            json_response(['error' => 'forbidden_module', 'message' => "Module '{$moduleKey}' is outside your management scope."], 403);
                        }
                    }
                }
                $denyLookup = array_fill_keys($incomingBag['deny'], true);
                $allow = [];
                foreach ($incomingBag['allow'] as $moduleKey) {
                    if (!isset($denyLookup[$moduleKey])) $allow[] = $moduleKey;
                }
                $deny = $incomingBag['deny'];
                $nextPermissions = ['allow' => $allow, 'deny' => $deny];
                if ($nextMode === 'custom' && empty($allow) && empty($deny)) {
                    $nextMode = 'default';
                }
            }

            $modulePermissionsJson = null;
            if ($nextMode === 'custom') {
                $modulePermissionsJson = json_encode($nextPermissions, JSON_UNESCAPED_SLASHES);
                if ($modulePermissionsJson === false) {
                    json_response(['error' => 'encode_failed', 'message' => 'Failed to encode module permissions.'], 500);
                }
            }

            $saveStmt = $mysqli->prepare("UPDATE tbl_users SET permission_mode = ?, module_permissions = ? WHERE user_id = ?");
            if (!$saveStmt) {
                json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
            }
            $saveStmt->bind_param("ssi", $nextMode, $modulePermissionsJson, $targetUserId);
            if (!$saveStmt->execute()) {
                json_response(['error' => 'update_failed', 'message' => $saveStmt->error], 500);
            }

            $updatedPermissions = ($nextMode === 'custom')
                ? $nextPermissions
                : ['allow' => [], 'deny' => []];
            $updatedEffective = $compute_effective_modules(
                $targetRoleName,
                $nextMode === 'custom' ? $modulePermissionsJson : null
            );

            $targetFullName = trim(((string)($targetUser['first_name'] ?? '')) . ' ' . ((string)($targetUser['last_name'] ?? '')));
            if ($targetFullName === '') $targetFullName = "User ID {$targetUserId}";
            $logMsg = "Updated module access for {$targetFullName}";
            log_system_action($mysqli, $authUserId, 'update_user_module_access', $logMsg);

            json_response([
                'user_id' => $targetUserId,
                'permission_mode' => $nextMode,
                'module_permissions' => $updatedPermissions,
                'role_default_modules' => $roleDefaultModules,
                'manageable_modules' => $managedModules,
                'effective_modules' => $updatedEffective,
            ]);
        }

        if ($request_method === 'GET') {
            // Lightweight list mode for dropdowns
            if (isset($_GET['list'])) {
                $roleFilter = isset($_GET['role']) && is_numeric($_GET['role']) ? (int)$_GET['role'] : null;
                $deptFilter = isset($_GET['dept_id']) && is_numeric($_GET['dept_id']) ? (int)$_GET['dept_id'] : null;
                $isProgramHeadRole = ((int)$authRoleId === 3);
                $isDeanRole = ((int)$authRoleId === 2);
                $isSecretaryRole = ((int)$authRoleId === 4);

                $sql = "SELECT user_id, first_name, last_name FROM tbl_users WHERE status = 'active'";
                $params = [];
                $types = '';

                if ($isAdminRole) {
                    // Admin: can see all active users, including admins and self.
                    if ($roleFilter !== null) {
                        $sql .= " AND role_id = ?";
                        $params[] = $roleFilter;
                        $types .= 'i';
                    }
                    if ($deptFilter !== null) {
                        $sql .= " AND dept_id = ?";
                        $params[] = $deptFilter;
                        $types .= 'i';
                    }
                } elseif ($isDeanRole) {
                    // Dean: self + same-department users except admins.
                    if ($authUserDeptId === null) {
                        $sql .= " AND user_id = ?";
                        $params[] = (int)$authUserId;
                        $types .= 'i';
                    } else {
                        $sql .= " AND (user_id = ? OR (dept_id = ? AND role_id <> 1))";
                        $params[] = (int)$authUserId;
                        $params[] = (int)$authUserDeptId;
                        $types .= 'ii';
                    }

                    if ($roleFilter !== null) {
                        if ($roleFilter === 1) {
                            json_response([]);
                        }
                        $sql .= " AND role_id = ?";
                        $params[] = $roleFilter;
                        $types .= 'i';
                    }
                } elseif ($isSecretaryRole) {
                    // Secretary: self + teachers in same department.
                    if ($authUserDeptId === null) {
                        $sql .= " AND user_id = ?";
                        $params[] = (int)$authUserId;
                        $types .= 'i';
                    } else {
                        $sql .= " AND (user_id = ? OR (dept_id = ? AND role_id = 5))";
                        $params[] = (int)$authUserId;
                        $params[] = (int)$authUserDeptId;
                        $types .= 'ii';
                    }

                    if ($roleFilter !== null) {
                        if (!in_array($roleFilter, [4, 5], true)) {
                            json_response([]);
                        }
                        $sql .= " AND role_id = ?";
                        $params[] = $roleFilter;
                        $types .= 'i';
                    }
                } elseif ($isProgramHeadRole) {
                    // Program Head: self + secretary/teacher only within programs headed by this user.
                    if ($roleFilter !== null && !in_array($roleFilter, [3, 4, 5], true)) {
                        json_response([]);
                    }

                    $programScopeSql = "SELECT program_id FROM tbl_programs WHERE head_id = ?";

                    $sql .= " AND (
                        user_id = ?
                        OR (
                            role_id IN (4, 5)
                            AND (
                                " . ($hasAssignedProgramHeadCol ? "assigned_program_head_id IN ({$programScopeSql})" : "0=1") . "
                                OR user_id IN (
                                    SELECT DISTINCT cs.user_id
                                    FROM tbl_class_schedules cs
                                    LEFT JOIN tbl_subject s ON cs.subject_id = s.subject_id
                                    LEFT JOIN tbl_sections sec ON cs.section_id = sec.section_id
                                    LEFT JOIN tbl_programs ps ON s.program_id = ps.program_id
                                    LEFT JOIN tbl_programs psec ON sec.program_id = psec.program_id
                                    WHERE cs.user_id IS NOT NULL
                                      AND (ps.head_id = ? OR psec.head_id = ?)
                                )
                            )
                        )
                    )";

                    $params[] = (int)$authUserId;
                    $types .= 'i';
                    if ($hasAssignedProgramHeadCol) {
                        $params[] = (int)$authUserId;
                        $types .= 'i';
                    }
                    $params[] = (int)$authUserId;
                    $params[] = (int)$authUserId;
                    $types .= 'ii';

                    if ($roleFilter !== null) {
                        $sql .= " AND role_id = ?";
                        $params[] = $roleFilter;
                        $types .= 'i';
                    }
                } else {
                    json_response([]);
                }

                $sql .= " ORDER BY last_name, first_name";
                
                $stmt = $mysqli->prepare($sql);
                if (!$stmt) json_response(['error' => 'db_prepare_failed', 'message' => $mysqli->error], 500);
                
                if (!empty($params)) {
                    $stmt->bind_param($types, ...$params);
                }
                
                $stmt->execute();
                $res = $stmt->get_result();
                $out = [];
                while ($r = $res->fetch_assoc()) {
                    $label = trim(($r['first_name'] ?? '') . ' ' . ($r['last_name'] ?? ''));
                    if ($label === '') $label = 'User #' . $r['user_id'];
                    $out[] = ['id' => $r['user_id'], 'label' => $label];
                }
                $stmt->close();
                json_response($out);
            }

            $selectAssignedHead = $hasAssignedProgramHeadCol
                ? ", u.assigned_program_head_id, CONCAT_WS(' ', aph.first_name, aph.last_name) AS assigned_program_head_name"
                : ", NULL AS assigned_program_head_id, NULL AS assigned_program_head_name";
            $selectAssignedProgram = $hasAssignedProgramHeadCol
                ? ", phead.program_id AS assigned_program_id, phead.program_name AS assigned_program_name"
                : ", NULL AS assigned_program_id, NULL AS assigned_program_name";
            $joinAssignedProgram = $hasAssignedProgramHeadCol
                ? " LEFT JOIN tbl_programs phead ON u.assigned_program_head_id = phead.program_id LEFT JOIN tbl_users aph ON phead.head_id = aph.user_id "
                : "";
            $sql = "SELECT u.user_id, u.role_id, u.first_name, u.last_name, u.email, u.contact_no, u.image AS avatar, u.id_number, u.dept_id, d.dept_name, r.role_name, u.status, u.is_first_login{$selectAssignedHead}{$selectAssignedProgram} FROM tbl_users u LEFT JOIN tbl_departments d ON u.dept_id = d.dept_id JOIN tbl_roles r ON u.role_id = r.role_id{$joinAssignedProgram}";
            $types = '';
            $params = [];
            if (!$isAdminRole) {
                // Role-based read scopes for non-admin accounts.
                if ((int)$authRoleId === 3) {
                    $sql .= " WHERE u.role_id = 5";
                    if ($programHeadDeptId === null) {
                        json_response([]);
                    }
                    $sql .= " AND u.dept_id = ?";
                    $types .= 'i';
                    $params[] = (int)$programHeadDeptId;
                    if ($hasAssignedProgramHeadCol) {
                        $sql .= " AND u.assigned_program_head_id IN (SELECT program_id FROM tbl_programs WHERE head_id = ?)";
                        $types .= 'i';
                        $params[] = (int)$authUserId;
                    } else {
                        // Backward-compatible fallback for schemas without assigned_program_head_id.
                        $sql .= " AND u.user_id IN (
                            SELECT DISTINCT cs.user_id
                            FROM tbl_class_schedules cs
                            LEFT JOIN tbl_subject s ON cs.subject_id = s.subject_id
                            LEFT JOIN tbl_sections sec ON cs.section_id = sec.section_id
                            LEFT JOIN tbl_programs ps ON s.program_id = ps.program_id
                            LEFT JOIN tbl_programs psec ON sec.program_id = psec.program_id
                            WHERE cs.user_id IS NOT NULL
                              AND (ps.head_id = ? OR psec.head_id = ?)
                        )";
                        $types .= 'ii';
                        $params[] = (int)$authUserId;
                        $params[] = (int)$authUserId;
                    }
                } elseif ((int)$authRoleId === 2) {
                    if ($authUserDeptId === null) {
                        json_response([]);
                    }
                    $sql .= " WHERE u.role_id IN (3, 4, 5) AND u.dept_id = ?";
                    $types .= 'i';
                    $params[] = (int)$authUserDeptId;
                } elseif ((int)$authRoleId === 4) {
                    if ($authUserDeptId === null) {
                        json_response([]);
                    }
                    $sql .= " WHERE u.role_id = 5 AND u.dept_id = ?";
                    $types .= 'i';
                    $params[] = (int)$authUserDeptId;
                } else {
                    json_response([]);
                }
            }
            $sql .= " ORDER BY u.user_id DESC";

            $stmt = $mysqli->prepare($sql);
            if (!$stmt) json_response(['error' => 'db_prepare_failed', 'message' => $mysqli->error], 500);
            if (!empty($params)) {
                $stmt->bind_param($types, ...$params);
            }
            $stmt->execute();
            $res = $stmt->get_result();
            json_response($res ? $res->fetch_all(MYSQLI_ASSOC) : []);

        } elseif ($request_method === 'POST' && $param1 === 'import') {
            // Admin-only bulk import. Default password = school ID (id_number)
            if (!$isAdminRole) {
                json_response(['error' => 'forbidden', 'message' => 'Only admin can import users'], 403);
            }

            $rows = isset($input['rows']) && is_array($input['rows']) ? $input['rows'] : [];
            if (empty($rows)) {
                json_response(['error' => 'validation', 'message' => 'rows is required and must be a non-empty array'], 400);
            }
            $previewOnly = !empty($input['preview']);

            $roleMap = [];
            $rolesRes = $mysqli->query("SELECT role_id, role_name FROM tbl_roles");
            if ($rolesRes) {
                while ($rr = $rolesRes->fetch_assoc()) {
                    $rid = (int)($rr['role_id'] ?? 0);
                    $rname = strtolower(trim((string)($rr['role_name'] ?? '')));
                    if ($rid > 0) {
                        if ($rname !== '') {
                            $key = preg_replace('/[^a-z0-9]+/', '_', $rname);
                            $roleMap[$key] = $rid;
                        }
                    }
                }
            }
            // Defensive aliases for common role strings
            $roleMap['admin'] = $roleMap['admin'] ?? 1;
            $roleMap['dean'] = $roleMap['dean'] ?? 2;
            $roleMap['program_head'] = $roleMap['program_head'] ?? 3;
            $roleMap['programhead'] = $roleMap['program_head'];
            $roleMap['secretary'] = $roleMap['secretary'] ?? 4;
            $roleMap['teacher'] = $roleMap['teacher'] ?? 5;

            $deptNameToId = [];
            $deptRes = $mysqli->query("SELECT dept_id, dept_name FROM tbl_departments");
            if ($deptRes) {
                while ($dr = $deptRes->fetch_assoc()) {
                    $did = (int)($dr['dept_id'] ?? 0);
                    $dname = strtolower(trim((string)($dr['dept_name'] ?? '')));
                    if ($did > 0 && $dname !== '') {
                        $deptNameToId[$dname] = $did;
                    }
                }
            }

            $normalizeProgramKey = function($value) {
                return preg_replace('/[^a-z0-9]+/', '', strtolower(trim((string)$value)));
            };
            $programNameToId = [];
            if ($hasAssignedProgramHeadCol) {
                $programRes = $mysqli->query("SELECT program_id, program_name FROM tbl_programs");
                if ($programRes) {
                    while ($pr = $programRes->fetch_assoc()) {
                        $programId = (int)($pr['program_id'] ?? 0);
                        $programName = trim((string)($pr['program_name'] ?? ''));
                        if ($programId <= 0) continue;

                        $programNameLower = strtolower($programName);
                        if ($programNameLower !== '') {
                            $programNameToId[$programNameLower] = $programId;
                        }
                        $programNameCompact = $normalizeProgramKey($programName);
                        if ($programNameCompact !== '') {
                            $programNameToId[$programNameCompact] = $programId;
                        }
                    }
                }
            }

            $checkEmailStmt = $mysqli->prepare("SELECT user_id FROM tbl_users WHERE email = ? LIMIT 1");
            $checkIdStmt = $mysqli->prepare("SELECT user_id FROM tbl_users WHERE id_number = ? LIMIT 1");
            $insertStmtWithAssigned = null;
            $insertStmtNoAssigned = null;
            if (!$previewOnly) {
                if ($hasAssignedProgramHeadCol) {
                    $insertStmtWithAssigned = $mysqli->prepare("INSERT INTO tbl_users (role_id, dept_id, first_name, last_name, id_number, email, password_hash, contact_no, is_first_login, assigned_program_head_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)");
                    $insertStmtNoAssigned = $mysqli->prepare("INSERT INTO tbl_users (role_id, dept_id, first_name, last_name, id_number, email, password_hash, contact_no, is_first_login, assigned_program_head_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)");
                } else {
                    $insertStmtNoAssigned = $mysqli->prepare("INSERT INTO tbl_users (role_id, dept_id, first_name, last_name, id_number, email, password_hash, contact_no, is_first_login) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)");
                }
            }
            if (
                !$checkEmailStmt
                || !$checkIdStmt
                || (
                    !$previewOnly
                    && (
                        !$insertStmtNoAssigned
                        || ($hasAssignedProgramHeadCol && !$insertStmtWithAssigned)
                    )
                )
            ) {
                json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
            }

            $inserted = 0;
            $skipped = 0;
            $errors = [];
            $seenEmails = [];
            $seenSchoolIds = [];
            $mailSent = 0;
            $mailFailed = 0;
            $mailFailures = [];

            foreach ($rows as $idx => $row) {
                $rowNum = $idx + 2; // header is row 1 in spreadsheets
                if (!is_array($row)) {
                    $skipped++;
                    $errors[] = ['row' => $rowNum, 'message' => 'Invalid row format'];
                    continue;
                }

                $normalized = [];
                foreach ($row as $k => $v) {
                    $key = preg_replace('/[^a-z0-9]+/', '_', strtolower(trim((string)$k)));
                    if ($key === '') continue;
                    $normalized[$key] = is_string($v) ? trim($v) : $v;
                }

                $pick = function(array $keys) use ($normalized) {
                    foreach ($keys as $k) {
                        if (array_key_exists($k, $normalized) && $normalized[$k] !== null && trim((string)$normalized[$k]) !== '') {
                            return trim((string)$normalized[$k]);
                        }
                    }
                    return '';
                };

                $firstName = $pick(['first_name', 'firstname', 'first', 'given_name']);
                $lastName = $pick(['last_name', 'lastname', 'last', 'family_name']);
                $email = $normalize_user_email($pick(['email', 'email_address', 'mail']));
                $schoolId = $normalize_id_number($pick(['school_id', 'schoolid', 'id_number', 'id_no', 'id', 'school_id_number']));
                $contactNo = $pick(['contact_no', 'contact', 'contact_number', 'phone', 'mobile']);
                $roleRaw = $pick(['role_id', 'role', 'role_name']);
                $deptRaw = $pick(['dept_id', 'department_id', 'department', 'dept', 'dept_name']);
                $programRaw = $pick(['assigned_program_head_id', 'assigned_program_id', 'assigned_program', 'program_id', 'program', 'program_name', 'program_head_assigned']);

                if ($firstName === '' || $lastName === '' || $email === '' || $schoolId === '' || $roleRaw === '') {
                    $skipped++;
                    $errors[] = ['row' => $rowNum, 'message' => 'Missing required fields (first_name, last_name, email, school_id, role)'];
                    continue;
                }
                if (!$is_valid_user_email($email)) {
                    $skipped++;
                    $errors[] = ['row' => $rowNum, 'message' => 'Invalid email. Must be @phinmaed.com'];
                    continue;
                }
                if (!$is_valid_id_number($schoolId)) {
                    $skipped++;
                    $errors[] = ['row' => $rowNum, 'message' => 'Invalid school_id format. Expected 02-xxxx-<any digits>'];
                    continue;
                }

                $roleId = null;
                if (is_numeric($roleRaw)) {
                    $roleId = (int)$roleRaw;
                } else {
                    $roleKey = preg_replace('/[^a-z0-9]+/', '_', strtolower(trim((string)$roleRaw)));
                    if (isset($roleMap[$roleKey])) {
                        $roleId = (int)$roleMap[$roleKey];
                    }
                }
                if (!$roleId) {
                    $skipped++;
                    $errors[] = ['row' => $rowNum, 'message' => 'Invalid role value'];
                    continue;
                }
                if ($roleId === 1) {
                    $skipped++;
                    $errors[] = ['row' => $rowNum, 'message' => 'Admin role is not allowed.'];
                    continue;
                }

                $deptId = null;
                if ($roleId !== 1) {
                    if ($deptRaw === '') {
                        $skipped++;
                        $errors[] = ['row' => $rowNum, 'message' => 'Department is required for non-admin users'];
                        continue;
                    }
                    if (is_numeric($deptRaw)) {
                        $deptId = (int)$deptRaw;
                    } else {
                        $deptKey = strtolower(trim((string)$deptRaw));
                        if (isset($deptNameToId[$deptKey])) $deptId = (int)$deptNameToId[$deptKey];
                    }
                    if (!$deptId) {
                        $skipped++;
                        $errors[] = ['row' => $rowNum, 'message' => 'Invalid department value'];
                        continue;
                    }
                }

                $assignedProgramId = null;
                if ($roleId === 5) {
                    if (!$hasAssignedProgramHeadCol) {
                        $skipped++;
                        $errors[] = ['row' => $rowNum, 'message' => 'Database is missing assigned_program_head_id. Run the latest SQL migration first.'];
                        continue;
                    }

                    if ($programRaw === '') {
                        $skipped++;
                        $errors[] = ['row' => $rowNum, 'message' => 'Assigned program is required for teachers. Provide program_id or program_name.'];
                        continue;
                    }

                    if (is_numeric($programRaw)) {
                        $assignedProgramId = (int)$programRaw;
                    } else {
                        $programKeyLower = strtolower(trim((string)$programRaw));
                        if (isset($programNameToId[$programKeyLower])) {
                            $assignedProgramId = (int)$programNameToId[$programKeyLower];
                        } else {
                            $programKeyCompact = $normalizeProgramKey($programRaw);
                            if ($programKeyCompact !== '' && isset($programNameToId[$programKeyCompact])) {
                                $assignedProgramId = (int)$programNameToId[$programKeyCompact];
                            }
                        }
                    }

                    if (!$assignedProgramId) {
                        $skipped++;
                        $errors[] = ['row' => $rowNum, 'message' => "Program '{$programRaw}' not recognized. Use a valid program_id or program_name."];
                        continue;
                    }

                    $assignedHeadError = $validateAssignedProgramHead($assignedProgramId, $deptId);
                    if ($assignedHeadError !== null) {
                        $skipped++;
                        $errors[] = ['row' => $rowNum, 'message' => $assignedHeadError];
                        continue;
                    }
                }

                $contactNo = preg_replace('/\D+/', '', (string)$contactNo);
                if ($contactNo === '') $contactNo = null;

                $emailKey = strtolower($email);
                $schoolIdKey = strtolower(trim((string)$schoolId));
                if (isset($seenEmails[$emailKey])) {
                    $skipped++;
                    $errors[] = ['row' => $rowNum, 'message' => 'Duplicate email in import file'];
                    continue;
                }
                if (isset($seenSchoolIds[$schoolIdKey])) {
                    $skipped++;
                    $errors[] = ['row' => $rowNum, 'message' => 'Duplicate school ID in import file'];
                    continue;
                }

                $checkEmailStmt->bind_param('s', $email);
                $checkEmailStmt->execute();
                if ($checkEmailStmt->get_result()->fetch_assoc()) {
                    $skipped++;
                    $errors[] = ['row' => $rowNum, 'message' => 'Email already exists'];
                    continue;
                }

                $checkIdStmt->bind_param('s', $schoolId);
                $checkIdStmt->execute();
                if ($checkIdStmt->get_result()->fetch_assoc()) {
                    $skipped++;
                    $errors[] = ['row' => $rowNum, 'message' => 'School ID already exists'];
                    continue;
                }

                $seenEmails[$emailKey] = true;
                $seenSchoolIds[$schoolIdKey] = true;
                $inserted++;

                if ($previewOnly) {
                    continue;
                }

                $passwordHash = password_hash((string)$schoolId, PASSWORD_BCRYPT);
                $stmtToUse = ($hasAssignedProgramHeadCol && $roleId === 5) ? $insertStmtWithAssigned : $insertStmtNoAssigned;
                if ($hasAssignedProgramHeadCol && $roleId === 5) {
                    $stmtToUse->bind_param(
                        'iissssssi',
                        $roleId,
                        $deptId,
                        $firstName,
                        $lastName,
                        $schoolId,
                        $email,
                        $passwordHash,
                        $contactNo,
                        $assignedProgramId
                    );
                } else {
                    $stmtToUse->bind_param(
                        'iissssss',
                        $roleId,
                        $deptId,
                        $firstName,
                        $lastName,
                        $schoolId,
                        $email,
                        $passwordHash,
                        $contactNo
                    );
                }
                if (!$stmtToUse->execute()) {
                    $inserted--;
                    $skipped++;
                    $errors[] = ['row' => $rowNum, 'message' => 'Insert failed: ' . $stmtToUse->error];
                    unset($seenEmails[$emailKey], $seenSchoolIds[$schoolIdKey]);
                    continue;
                }

                $mailResult = $sendAccountCreatedEmail($firstName, $lastName, $email, $schoolId);
                if (!empty($mailResult['sent'])) {
                    $mailSent++;
                } else {
                    $mailFailed++;
                    if (count($mailFailures) < 20) {
                        $mailFailures[] = [
                            'row' => $rowNum,
                            'email' => $email,
                            'message' => $mailResult['error'] ?? 'Mail delivery failed'
                        ];
                    }
                }
            }

            $logAction = $previewOnly ? 'preview_import_users' : 'import_users';
            $logPrefix = $previewOnly ? 'Previewed user import' : 'Imported users via spreadsheet';
            log_system_action(
                $mysqli,
                $authUserId,
                $logAction,
                "{$logPrefix}: inserted={$inserted}, skipped={$skipped}, total=" . count($rows)
                    . ($previewOnly ? '' : ", email_sent={$mailSent}, email_failed={$mailFailed}")
            );
            json_response([
                'preview' => $previewOnly,
                'inserted' => $inserted,
                'skipped' => $skipped,
                'total' => count($rows),
                'errors' => $errors,
                'email_notifications' => [
                    'sent' => $previewOnly ? 0 : $mailSent,
                    'failed' => $previewOnly ? 0 : $mailFailed,
                    'failures' => $previewOnly ? [] : $mailFailures
                ]
            ]);

        } elseif (($request_method === 'PUT' || $request_method === 'POST') && is_numeric($param1)) {
            if (!$isAdminRole) {
                json_response(['error' => 'forbidden', 'message' => 'View-only access. Only admin can modify users.'], 403);
            }
            $userId = (int)$param1;

            if ($param2 === 'toggle') {
                $u = $mysqli->prepare("SELECT status FROM tbl_users WHERE user_id = ? LIMIT 1");
                if (!$u) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
                $u->bind_param("i", $userId);
                if (!$u->execute()) json_response(['error' => 'execute_failed', 'message' => $u->error], 500);
                $row = null;
                if (method_exists($u, 'get_result')) {
                    $res = $u->get_result();
                    $row = $res ? $res->fetch_assoc() : null;
                } else {
                    $u->bind_result($status);
                    if ($u->fetch()) $row = ['status' => $status];
                }
                if (!$row) json_response(['error' => 'not_found', 'message' => 'User not found'], 404);
                $new = (strval($row['status']) === 'active') ? 'inactive' : 'active';

                $up = $mysqli->prepare("UPDATE tbl_users SET status = ? WHERE user_id = ?");
                if (!$up) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
                $up->bind_param("si", $new, $userId);
                if (!$up->execute()) json_response(['error' => 'update_failed', 'message' => $up->error], 500);
                if ($up->affected_rows === 0) json_response(['error' => 'not_found', 'message' => 'User not found'], 404);
                // Notify socket server about status toggle
                $dept_id = null;
                $dStmt = $mysqli->prepare("SELECT dept_id FROM tbl_users WHERE user_id = ? LIMIT 1");
                if ($dStmt) {
                    $dStmt->bind_param('i', $userId);
                    $dStmt->execute();
                    $dRow = $dStmt->get_result()->fetch_assoc();
                    if ($dRow && isset($dRow['dept_id'])) {
                        $dept_id = (int)$dRow['dept_id'];
                    }
                }

                try {
                    $payload = ['entity' => 'users', 'action' => 'toggle', 'user_id' => $userId, 'status' => $new];
                    if ($dept_id) {
                        $payload['dept_id'] = $dept_id;
                    }
                    trigger_socket_update($payload);
                } catch (Throwable $_) {}

                // Log user status toggle with friendly name
                $logName = null;
                $qn = $mysqli->prepare("SELECT first_name, last_name, email FROM tbl_users WHERE user_id = ? LIMIT 1");
                if ($qn) { $qn->bind_param('i', $userId); $qn->execute(); $rn = $qn->get_result()->fetch_assoc(); if ($rn) { $logName = trim(($rn['first_name'] ?? '') . ' ' . ($rn['last_name'] ?? '')); if ($logName === '') $logName = $rn['email'] ?? null; } }
                $logMsg = $logName ? "Changed status of user '{$logName}' to {$new}" : "Changed status of user ID {$userId} to {$new}";
                log_system_action($mysqli, $authUserId, 'toggle_user', $logMsg);
                json_response(['user_id' => $userId, 'status' => $new]);
            }

            if ($param2 === 'archive') {
                $up = $mysqli->prepare("UPDATE tbl_users SET status = ? WHERE user_id = ?");
                if (!$up) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
                $statusVal = 'archive';
                $up->bind_param("si", $statusVal, $userId);
                if (!$up->execute()) json_response(['error' => 'update_failed', 'message' => $up->error], 500);
                if ($up->affected_rows === 0) json_response(['error' => 'not_found', 'message' => 'User not found'], 404);
                $dept_id = null;
                $dStmt = $mysqli->prepare("SELECT dept_id FROM tbl_users WHERE user_id = ? LIMIT 1");
                if ($dStmt) {
                    $dStmt->bind_param('i', $userId);
                    $dStmt->execute();
                    $dRow = $dStmt->get_result()->fetch_assoc();
                    if ($dRow && isset($dRow['dept_id'])) {
                        $dept_id = (int)$dRow['dept_id'];
                    }
                }

                try {
                    $payload = ['entity' => 'users', 'action' => 'archive', 'user_id' => $userId];
                    if ($dept_id) {
                        $payload['dept_id'] = $dept_id;
                    }
                    trigger_socket_update($payload);
                } catch (Throwable $_) {}

                // Log archive action
                $logName = null;
                $qn = $mysqli->prepare("SELECT first_name, last_name, email FROM tbl_users WHERE user_id = ? LIMIT 1");
                if ($qn) { $qn->bind_param('i', $userId); $qn->execute(); $rn = $qn->get_result()->fetch_assoc(); if ($rn) { $logName = trim(($rn['first_name'] ?? '') . ' ' . ($rn['last_name'] ?? '')); if ($logName === '') $logName = $rn['email'] ?? null; } }
                $logMsg = $logName ? "Archived user '{$logName}'" : "Archived user ID {$userId}";
                log_system_action($mysqli, $authUserId, 'archive_user', $logMsg);
                json_response(['user_id' => $userId, 'status' => 'archive']);
            }

            // Normal update: validate and apply
            // Check user exists
            $existingSelectAssigned = $hasAssignedProgramHeadCol ? ", assigned_program_head_id" : "";
            $checkExisting = $mysqli->prepare("SELECT user_id, role_id, dept_id{$existingSelectAssigned} FROM tbl_users WHERE user_id = ? LIMIT 1");
            if (!$checkExisting) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
            $checkExisting->bind_param("i", $userId);
            $checkExisting->execute();
            $existing = $checkExisting->get_result()->fetch_assoc();
            if (!$existing) json_response(['error' => 'not_found', 'message' => 'User not found'], 404);

            if (isset($input['email'])) {
                $input['email'] = $normalize_user_email($input['email']);
                if (!$is_valid_user_email($input['email'])) {
                    json_response(['error' => 'validation', 'message' => 'Email must use @phinmaed.com'], 400);
                }
                $dup = $mysqli->prepare("SELECT user_id FROM tbl_users WHERE email = ? AND user_id <> ? LIMIT 1");
                $dup->bind_param("si", $input['email'], $userId);
                $dup->execute();
                if ($dup->get_result()->fetch_assoc()) {
                    json_response(['error' => 'duplicate', 'message' => 'Email already exists'], 400);
                }
            }
            if (isset($input['id_number'])) {
                $input['id_number'] = $normalize_id_number($input['id_number']);
                if ($input['id_number'] === '') {
                    json_response(['error' => 'validation', 'message' => 'ID number is required'], 400);
                }
                if (!$is_valid_id_number($input['id_number'])) {
                    json_response(['error' => 'validation', 'message' => 'ID number must match 02-xxxx-<any digits>'], 400);
                }
                $dupId = $mysqli->prepare("SELECT user_id FROM tbl_users WHERE id_number = ? AND user_id <> ? LIMIT 1");
                if (!$dupId) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
                $dupId->bind_param("si", $input['id_number'], $userId);
                $dupId->execute();
                if ($dupId->get_result()->fetch_assoc()) {
                    json_response(['error' => 'duplicate', 'message' => 'ID number already exists'], 400);
                }
            }

            if ($hasAssignedProgramHeadCol) {
                $targetRoleId = isset($input['role_id']) ? (int)$input['role_id'] : (int)($existing['role_id'] ?? 0);
                $targetDeptId = array_key_exists('dept_id', $input)
                    ? (($input['dept_id'] === '' || $input['dept_id'] === null) ? null : (int)$input['dept_id'])
                    : (isset($existing['dept_id']) && $existing['dept_id'] !== null ? (int)$existing['dept_id'] : null);

                if ($targetRoleId === 5 && array_key_exists('assigned_program_head_id', $input)) {
                    if ($input['assigned_program_head_id'] === '' || $input['assigned_program_head_id'] === null) {
                        json_response(['error' => 'validation', 'message' => 'Assigned program is required for teachers.'], 400);
                    }
                    $assignedHeadId = (int)$input['assigned_program_head_id'];
                    $assignedHeadError = $validateAssignedProgramHead($assignedHeadId, $targetDeptId);
                    if ($assignedHeadError !== null) {
                        json_response(['error' => 'validation', 'message' => $assignedHeadError], 400);
                    }
                }
            } elseif (array_key_exists('assigned_program_head_id', $input)) {
                json_response(['error' => 'schema_mismatch', 'message' => 'Database is missing assigned_program_head_id. Run the latest SQL migration first.'], 500);
            }

            // Build update dynamically - allow changing role_id, first_name, last_name, email, contact_no, id_number, dept_id, password_hash
            $fields = [];
            $types = '';
            $values = [];
            if (isset($input['role_id'])) { $fields[] = 'role_id = ?'; $types .= 'i'; $values[] = (int)$input['role_id']; }
            if (isset($input['first_name'])) { $fields[] = 'first_name = ?'; $types .= 's'; $values[] = $input['first_name']; }
            if (isset($input['last_name'])) { $fields[] = 'last_name = ?'; $types .= 's'; $values[] = $input['last_name']; }
            if (isset($input['email'])) { $fields[] = 'email = ?'; $types .= 's'; $values[] = $input['email']; }
            if (isset($input['contact_no'])) { $fields[] = 'contact_no = ?'; $types .= 's'; $values[] = $input['contact_no']; }
            if (isset($input['id_number'])) { $fields[] = 'id_number = ?'; $types .= 's'; $values[] = $input['id_number']; }
            if (isset($input['dept_id'])) { $fields[] = 'dept_id = ?'; $types .= 'i'; $values[] = (int)$input['dept_id']; }
            if ($hasAssignedProgramHeadCol) {
                $targetRoleId = isset($input['role_id']) ? (int)$input['role_id'] : (int)($existing['role_id'] ?? 0);
                if ($targetRoleId !== 5) {
                    $fields[] = 'assigned_program_head_id = NULL';
                } elseif (array_key_exists('assigned_program_head_id', $input)) {
                    $fields[] = 'assigned_program_head_id = ?';
                    $types .= 'i';
                    $values[] = (int)$input['assigned_program_head_id'];
                }
            }
            if (isset($input['is_first_login'])) { $fields[] = 'is_first_login = ?'; $types .= 'i'; $values[] = (int)$input['is_first_login']; }
            if (!empty($input['password'])) { $fields[] = 'password_hash = ?'; $types .= 's'; $values[] = password_hash($input['password'], PASSWORD_BCRYPT); }

            if (empty($fields)) json_response(['message' => 'Nothing to update'], 200);

            $sql = "UPDATE tbl_users SET " . implode(', ', $fields) . " WHERE user_id = ?";
            $stmt = $mysqli->prepare($sql);
            if (!$stmt) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
            // bind params
            $types .= 'i';
            $values[] = $userId;
            $stmt->bind_param($types, ...$values);
            if (!$stmt->execute()) json_response(['error' => 'update_failed', 'message' => $stmt->error], 500);
            $dept_id = null;
            if (isset($input['dept_id'])) {
                $dept_id = (int)$input['dept_id'];
            } else {
                $dStmt = $mysqli->prepare("SELECT dept_id FROM tbl_users WHERE user_id = ? LIMIT 1");
                if ($dStmt) {
                    $dStmt->bind_param('i', $userId);
                    $dStmt->execute();
                    $dRow = $dStmt->get_result()->fetch_assoc();
                    if ($dRow && isset($dRow['dept_id'])) {
                        $dept_id = (int)$dRow['dept_id'];
                    }
                }
            }

            try {
                $payload = ['entity' => 'users', 'action' => 'update', 'user_id' => $userId];
                if ($dept_id) {
                    $payload['dept_id'] = $dept_id;
                }
                trigger_socket_update($payload);
            } catch (Throwable $_) {}

            // Log user update with friendly name
            $logName = null;
            if (!empty($input['first_name']) || !empty($input['last_name'])) {
                $logName = trim((string)($input['first_name'] ?? '') . ' ' . ($input['last_name'] ?? ''));
                if ($logName === '') $logName = null;
            }
            if (!$logName) {
                $qn = $mysqli->prepare("SELECT first_name, last_name, email FROM tbl_users WHERE user_id = ? LIMIT 1");
                if ($qn) { $qn->bind_param('i', $userId); $qn->execute(); $rn = $qn->get_result()->fetch_assoc(); if ($rn) { $logName = trim(($rn['first_name'] ?? '') . ' ' . ($rn['last_name'] ?? '')); if ($logName === '') $logName = $rn['email'] ?? null; } }
            }
            $logMsg = $logName ? "Updated user details for '{$logName}'" : "Updated user details for ID {$userId}";
            log_system_action($mysqli, $authUserId, 'update_user', $logMsg);
            json_response(['user_id' => $userId] + $input);

        } elseif ($request_method === 'POST') {
            if (!$isAdminRole) {
                json_response(['error' => 'forbidden', 'message' => 'View-only access. Only admin can create users.'], 403);
            }
            // Create new user - validate required fields
            if (empty($input['email']) || empty($input['first_name']) || empty($input['last_name']) || empty($input['id_number']) || !isset($input['role_id'])) {
                json_response(['error' => 'validation', 'message' => 'Missing required fields'], 400);
            }
            $input['email'] = $normalize_user_email($input['email']);
            $input['id_number'] = $normalize_id_number($input['id_number']);
            if (!$is_valid_user_email($input['email'])) {
                json_response(['error' => 'validation', 'message' => 'Email must use @phinmaed.com'], 400);
            }
            if (!$is_valid_id_number($input['id_number'])) {
                json_response(['error' => 'validation', 'message' => 'ID number must match 02-xxxx-<any digits>'], 400);
            }

            // Ensure email uniqueness
            $check = $mysqli->prepare("SELECT user_id FROM tbl_users WHERE email = ? LIMIT 1");
            if (!$check) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
            $check->bind_param("s", $input['email']);
            $check->execute();
            if ($check->get_result()->fetch_assoc()) {
                json_response(['error' => 'duplicate', 'message' => 'Email already exists'], 400);
            }
            $checkId = $mysqli->prepare("SELECT user_id FROM tbl_users WHERE id_number = ? LIMIT 1");
            if (!$checkId) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
            $checkId->bind_param("s", $input['id_number']);
            $checkId->execute();
            if ($checkId->get_result()->fetch_assoc()) {
                json_response(['error' => 'duplicate', 'message' => 'ID number already exists'], 400);
            }

            $password_hash = password_hash($input['password'] ?? '', PASSWORD_BCRYPT);
            // include optional id_number and dept_id when creating a user; set is_first_login default to 1 if not provided
            $roleVal = (int)$input['role_id'];
            if ($roleVal === 1) {
                json_response(['error' => 'validation', 'message' => 'Admin role is not allowed.'], 400);
            }
            $deptVal = isset($input['dept_id']) && $input['dept_id'] !== '' ? (int)$input['dept_id'] : null;
            if ($roleVal !== 1 && $deptVal === null) {
                json_response(['error' => 'validation', 'message' => 'Department is required for non-admin users.'], 400);
            }
            if ($roleVal === 1) {
                $deptVal = null;
            }
            if ($roleVal === 5 && !$hasAssignedProgramHeadCol) {
                json_response(['error' => 'schema_mismatch', 'message' => 'Database is missing assigned_program_head_id. Run the latest SQL migration first.'], 500);
            }
            $idNumberVal = $input['id_number'];
            $isFirst = isset($input['is_first_login']) ? (int)$input['is_first_login'] : 1;
            $contactNoVal = $input['contact_no'] ?? null;
            $assignedHeadVal = null;

            if ($hasAssignedProgramHeadCol && $roleVal === 5) {
                if (!array_key_exists('assigned_program_head_id', $input) || $input['assigned_program_head_id'] === '' || $input['assigned_program_head_id'] === null) {
                    json_response(['error' => 'validation', 'message' => 'Assigned program is required for teachers.'], 400);
                }
                $assignedHeadVal = (int)$input['assigned_program_head_id'];
                $assignedHeadError = $validateAssignedProgramHead($assignedHeadVal, $deptVal);
                if ($assignedHeadError !== null) {
                    json_response(['error' => 'validation', 'message' => $assignedHeadError], 400);
                }
            }

            if ($hasAssignedProgramHeadCol) {
                if ($assignedHeadVal !== null) {
                    $stmt = $mysqli->prepare("INSERT INTO tbl_users (role_id, dept_id, first_name, last_name, id_number, email, password_hash, contact_no, is_first_login, assigned_program_head_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
                    if (!$stmt) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
                    $stmt->bind_param("iissssssii", $roleVal, $deptVal, $input['first_name'], $input['last_name'], $idNumberVal, $input['email'], $password_hash, $contactNoVal, $isFirst, $assignedHeadVal);
                } else {
                    $stmt = $mysqli->prepare("INSERT INTO tbl_users (role_id, dept_id, first_name, last_name, id_number, email, password_hash, contact_no, is_first_login, assigned_program_head_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)");
                    if (!$stmt) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
                    $stmt->bind_param("iissssssi", $roleVal, $deptVal, $input['first_name'], $input['last_name'], $idNumberVal, $input['email'], $password_hash, $contactNoVal, $isFirst);
                }
            } else {
                $stmt = $mysqli->prepare("INSERT INTO tbl_users (role_id, dept_id, first_name, last_name, id_number, email, password_hash, contact_no, is_first_login) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
                if (!$stmt) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
                $stmt->bind_param("iissssssi", $roleVal, $deptVal, $input['first_name'], $input['last_name'], $idNumberVal, $input['email'], $password_hash, $contactNoVal, $isFirst);
            }
            if (!$stmt->execute()) json_response(['error' => 'insert_failed', 'message' => $stmt->error], 500);
            $newId = $stmt->insert_id;
            
            $dept_id = isset($input['dept_id']) ? (int)$input['dept_id'] : null;

            try {
                $payload = ['entity' => 'users', 'action' => 'create', 'user_id' => $newId];
                if ($dept_id) {
                    $payload['dept_id'] = $dept_id;
                }
                trigger_socket_update($payload);
            } catch (Throwable $_) {}

            // Log user creation
            $logName = trim((string)($input['first_name'] ?? '') . ' ' . ($input['last_name'] ?? ''));
            $logName = $logName === '' ? ($input['email'] ?? null) : $logName;
            $logMsg = $logName ? "Created new user: {$logName}" : "Created new user ID {$newId}";
            log_system_action($mysqli, $authUserId, 'create_user', $logMsg);
            $emailResult = $sendAccountCreatedEmail(
                $input['first_name'] ?? '',
                $input['last_name'] ?? '',
                $input['email'] ?? '',
                $idNumberVal
            );
            $responsePayload = ['user_id' => $newId] + $input;
            $responsePayload['email_notification'] = [
                'sent' => !empty($emailResult['sent'])
            ];
            if (empty($emailResult['sent']) && !empty($emailResult['error'])) {
                $responsePayload['email_notification']['error'] = $emailResult['error'];
            }
            json_response($responsePayload, 201);

        }
        break;

    case 'roles':
        if ($request_method === 'GET') {
            $result = $mysqli->query("SELECT role_id, role_name FROM tbl_roles ORDER BY role_id");
            json_response($result->fetch_all(MYSQLI_ASSOC));
        }
        break;
    
    case 'teachers':
         if ($request_method === 'GET') {
            if (!$authUserId) {
                json_response(['error' => 'unauthorized', 'message' => 'Authentication required'], 401);
            }

            $isAdminRole = ((int)$authRoleId === 1);
            if ($isAdminRole) {
                $result = $mysqli->query("SELECT user_id, first_name, last_name, dept_id FROM tbl_users WHERE role_id = 5 AND status = 'active' ORDER BY last_name, first_name");
                if (!$result) json_response(['error' => 'query_failed', 'message' => $mysqli->error], 500);
                json_response($result->fetch_all(MYSQLI_ASSOC));
            }

            if ((int)$authRoleId === 3) {
                $phScopeStmt = $mysqli->prepare("SELECT program_id, dept_id FROM tbl_programs WHERE head_id = ? LIMIT 1");
                if (!$phScopeStmt) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
                $phScopeStmt->bind_param("i", $authUserId);
                $phScopeStmt->execute();
                $phScopeRow = $phScopeStmt->get_result()->fetch_assoc();
                $programHeadProgramId = ($phScopeRow && isset($phScopeRow['program_id']) && $phScopeRow['program_id'] !== null) ? (int)$phScopeRow['program_id'] : null;
                $programHeadDeptId = ($phScopeRow && isset($phScopeRow['dept_id']) && $phScopeRow['dept_id'] !== null) ? (int)$phScopeRow['dept_id'] : null;
                if ($programHeadDeptId === null || $programHeadProgramId === null) {
                    json_response([]);
                }

                $assignedHeadColCheck = $mysqli->query("SHOW COLUMNS FROM tbl_users LIKE 'assigned_program_head_id'");
                $hasAssignedProgramHeadCol = $assignedHeadColCheck && $assignedHeadColCheck->num_rows > 0;
                if ($hasAssignedProgramHeadCol) {
                    $stmt = $mysqli->prepare("SELECT user_id, first_name, last_name, dept_id FROM tbl_users WHERE role_id = 5 AND status = 'active' AND dept_id = ? AND assigned_program_head_id = ? ORDER BY last_name, first_name");
                    if (!$stmt) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
                    $stmt->bind_param("ii", $programHeadDeptId, $programHeadProgramId);
                    $stmt->execute();
                    $res = $stmt->get_result();
                    json_response($res ? $res->fetch_all(MYSQLI_ASSOC) : []);
                }

                // Backward-compatible fallback for schemas without assigned_program_head_id.
                $stmt = $mysqli->prepare("SELECT DISTINCT u.user_id, u.first_name, u.last_name, u.dept_id
                                          FROM tbl_users u
                                          JOIN tbl_class_schedules cs ON cs.user_id = u.user_id
                                          LEFT JOIN tbl_subject s ON cs.subject_id = s.subject_id
                                          LEFT JOIN tbl_sections sec ON cs.section_id = sec.section_id
                                          LEFT JOIN tbl_programs ps ON s.program_id = ps.program_id
                                          LEFT JOIN tbl_programs psec ON sec.program_id = psec.program_id
                                          WHERE u.role_id = 5
                                            AND u.status = 'active'
                                            AND u.dept_id = ?
                                            AND (ps.head_id = ? OR psec.head_id = ?)
                                          ORDER BY u.last_name, u.first_name");
                if (!$stmt) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
                $stmt->bind_param("iii", $programHeadDeptId, $authUserId, $authUserId);
                $stmt->execute();
                $res = $stmt->get_result();
                json_response($res ? $res->fetch_all(MYSQLI_ASSOC) : []);
            }

            if (in_array((int)$authRoleId, [2, 4], true)) {
                if ($authUserDeptId === null) {
                    json_response([]);
                }
                $stmt = $mysqli->prepare("SELECT user_id, first_name, last_name, dept_id FROM tbl_users WHERE role_id = 5 AND status = 'active' AND dept_id = ? ORDER BY last_name, first_name");
                if (!$stmt) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
                $stmt->bind_param("i", $authUserDeptId);
                $stmt->execute();
                $res = $stmt->get_result();
                json_response($res ? $res->fetch_all(MYSQLI_ASSOC) : []);
            }

            json_response([]);
        }
        break;

    case 'deans':
         if ($request_method === 'GET') {
             $result = $mysqli->query("SELECT user_id, first_name, last_name FROM tbl_users WHERE role_id = 2 AND status = 1 ORDER BY last_name, first_name");
             json_response($result->fetch_all(MYSQLI_ASSOC));
         }
         break;

    case 'class-schedules':
        $normalize_time_simple = function($value) {
            if ($value === null) return null;
            $value = trim((string)$value);
            if ($value === '') return null;
            if (preg_match('/^\d{1,2}:\d{2}:\d{2}$/', $value)) return $value;
            if (preg_match('/^\d{1,2}:\d{2}$/', $value)) return $value . ':00';
            $ts = strtotime($value);
            if ($ts === false) return $value;
            return date('H:i:s', $ts);
        };

        // Helper: detect if a column exists in a table
        $column_exists = function($table, $col) use ($mysqli) {
            $tbl = $mysqli->real_escape_string($table);
            $c = $mysqli->real_escape_string($col);
            $res = $mysqli->query("SHOW COLUMNS FROM `{$tbl}` LIKE '{$c}'");
            return $res && $res->num_rows > 0;
        };

        // Determine if the legacy offerings table/column exists
        $offerings_table_check = $mysqli->query("SHOW TABLES LIKE 'tbl_subject_offerings'");
        $has_subject_offerings = $offerings_table_check && $offerings_table_check->num_rows > 0;
        $cs_has_offering_col = $column_exists('tbl_class_schedules', 'offering_id');
        $cs_has_subject_cols = $column_exists('tbl_class_schedules', 'subject_id') && $column_exists('tbl_class_schedules', 'section_id');
        $resolve_active_semester_id = function() use ($mysqli) {
            $queries = [
                "SELECT semester_id FROM tbl_semesters WHERE status = 'active' AND CURDATE() BETWEEN start_date AND end_date ORDER BY semester_id DESC LIMIT 1",
                "SELECT semester_id FROM tbl_semesters WHERE CURDATE() BETWEEN start_date AND end_date ORDER BY (status = 'active') DESC, semester_id DESC LIMIT 1",
                "SELECT semester_id FROM tbl_semesters WHERE status = 'active' ORDER BY semester_id DESC LIMIT 1",
            ];
            foreach ($queries as $q) {
                $res = $mysqli->query($q);
                if ($res) {
                    $row = $res->fetch_assoc();
                    if ($row && isset($row['semester_id'])) return (int)$row['semester_id'];
                }
            }
            return null;
        };
        $activeSemesterId = $resolve_active_semester_id();

        $isAdminRole = ((int)$authRoleId === 1);
        $isProgramHeadRole = ((int)$authRoleId === 3);
        $programHeadProgramIds = [];
        if ($isProgramHeadRole && $authUserId) {
            $phStmt = $mysqli->prepare("SELECT program_id FROM tbl_programs WHERE head_id = ?");
            if ($phStmt) {
                $phStmt->bind_param('i', $authUserId);
                $phStmt->execute();
                $phRes = $phStmt->get_result();
                while ($phRow = $phRes->fetch_assoc()) {
                    if (isset($phRow['program_id']) && $phRow['program_id'] !== null) {
                        $programHeadProgramIds[] = (int)$phRow['program_id'];
                    }
                }
            }
            $programHeadProgramIds = array_values(array_unique($programHeadProgramIds));
        }

        $require_program_head_scope = function() use ($isProgramHeadRole, $programHeadProgramIds) {
            if (!$isProgramHeadRole) return;
            if (!$programHeadProgramIds || count($programHeadProgramIds) === 0) {
                json_response(['error' => 'forbidden', 'message' => 'Program head has no assigned program.'], 403);
            }
        };

        $get_program_id_for_subject = function($subjectId) use ($mysqli) {
            if (!$subjectId) return null;
            $stmt = $mysqli->prepare("SELECT program_id FROM tbl_subject WHERE subject_id = ? LIMIT 1");
            if (!$stmt) return null;
            $stmt->bind_param('i', $subjectId);
            $stmt->execute();
            $row = $stmt->get_result()->fetch_assoc();
            return ($row && isset($row['program_id'])) ? (int)$row['program_id'] : null;
        };

        $get_program_id_for_section = function($sectionId) use ($mysqli) {
            if (!$sectionId) return null;
            $stmt = $mysqli->prepare("SELECT program_id FROM tbl_sections WHERE section_id = ? LIMIT 1");
            if (!$stmt) return null;
            $stmt->bind_param('i', $sectionId);
            $stmt->execute();
            $row = $stmt->get_result()->fetch_assoc();
            return ($row && isset($row['program_id'])) ? (int)$row['program_id'] : null;
        };

        $usersHasAssignedProgramCol = $column_exists('tbl_users', 'assigned_program_head_id');
        $usersHasProgramIdCol = $column_exists('tbl_users', 'program_id');
        $usersHasDeptIdCol = $column_exists('tbl_users', 'dept_id');
        $get_user_role_id = function($userId) use ($mysqli) {
            if (!$userId) return null;
            $stmt = $mysqli->prepare("SELECT role_id FROM tbl_users WHERE user_id = ? LIMIT 1");
            if (!$stmt) return null;
            $stmt->bind_param('i', $userId);
            $stmt->execute();
            $row = $stmt->get_result()->fetch_assoc();
            if (!$row || !isset($row['role_id'])) return null;
            return (int)$row['role_id'];
        };
        $get_teacher_program_id = function($teacherId) use ($mysqli, $usersHasAssignedProgramCol, $usersHasProgramIdCol, $usersHasDeptIdCol) {
            if (!$teacherId) return null;

            $teachingRoles = [2, 3, 4, 5]; // dean, program_head, secretary, teacher

            $select = "SELECT role_id";
            if ($usersHasAssignedProgramCol) $select .= ", assigned_program_head_id";
            if ($usersHasProgramIdCol) $select .= ", program_id";
            if ($usersHasDeptIdCol) $select .= ", dept_id";
            $sql = $select . " FROM tbl_users WHERE user_id = ? LIMIT 1";
            $stmt = $mysqli->prepare($sql);
            if (!$stmt) return null;
            $stmt->bind_param('i', $teacherId);
            $stmt->execute();
            $row = $stmt->get_result()->fetch_assoc();
            if (!$row) return null;

            $roleId = isset($row['role_id']) ? (int)$row['role_id'] : 0;
            if (!in_array($roleId, $teachingRoles, true)) return null;

            // Direct assignment on user row (preferred)
            if ($usersHasAssignedProgramCol && isset($row['assigned_program_head_id']) && $row['assigned_program_head_id'] !== null && (string)$row['assigned_program_head_id'] !== '') {
                return (int)$row['assigned_program_head_id'];
            }
            if ($usersHasProgramIdCol && isset($row['program_id']) && $row['program_id'] !== null && (string)$row['program_id'] !== '') {
                return (int)$row['program_id'];
            }

            // Program head fallback: program where this user is the head.
            if ($roleId === 3) {
                $phProgram = $mysqli->prepare("SELECT program_id FROM tbl_programs WHERE head_id = ? ORDER BY program_id ASC LIMIT 1");
                if ($phProgram) {
                    $phProgram->bind_param('i', $teacherId);
                    $phProgram->execute();
                    $phRow = $phProgram->get_result()->fetch_assoc();
                    if ($phRow && isset($phRow['program_id']) && $phRow['program_id'] !== null) {
                        return (int)$phRow['program_id'];
                    }
                }
            }

            // Dean/Secretary fallback: if department maps to exactly one active program, use it.
            if ($usersHasDeptIdCol && isset($row['dept_id']) && $row['dept_id'] !== null && (string)$row['dept_id'] !== '') {
                $deptId = (int)$row['dept_id'];
                if ($deptId > 0) {
                    $deptPrograms = $mysqli->prepare("
                        SELECT program_id
                        FROM tbl_programs
                        WHERE dept_id = ?
                          AND LOWER(TRIM(COALESCE(status, 'active'))) IN ('active', '1', 'true')
                        ORDER BY program_id ASC
                        LIMIT 2
                    ");
                    if ($deptPrograms) {
                        $deptPrograms->bind_param('i', $deptId);
                        $deptPrograms->execute();
                        $res = $deptPrograms->get_result();
                        $rows = $res ? $res->fetch_all(MYSQLI_ASSOC) : [];
                        if (count($rows) === 1 && isset($rows[0]['program_id'])) {
                            return (int)$rows[0]['program_id'];
                        }
                    }
                }
            }

            return null;
        };

        $enforce_program_scope_for_subject_section = function($subjectId, $sectionId) use (
            $isProgramHeadRole,
            $programHeadProgramIds,
            $require_program_head_scope,
            $get_program_id_for_subject,
            $get_program_id_for_section
        ) {
            if (!$isProgramHeadRole) return;
            $require_program_head_scope();

            $programId = null;
            if ($subjectId) $programId = $get_program_id_for_subject($subjectId);
            if (!$programId && $sectionId) $programId = $get_program_id_for_section($sectionId);

            if (!$programId || !in_array((int)$programId, $programHeadProgramIds, true)) {
                json_response(['error' => 'forbidden', 'message' => 'Program head can only manage schedules within their assigned program.'], 403);
            }
        };

        $get_program_id_for_schedule = function($scheduleId) use ($mysqli, $has_subject_offerings, $cs_has_offering_col) {
            if (!$scheduleId) return null;
            if ($has_subject_offerings && $cs_has_offering_col) {
                $stmt = $mysqli->prepare("SELECT COALESCE(s_so.program_id, s_cs.program_id) AS program_id
                    FROM tbl_class_schedules cs
                    LEFT JOIN tbl_subject_offerings so ON (cs.offering_id IS NOT NULL AND so.offering_id = cs.offering_id)
                    LEFT JOIN tbl_subject s_so ON (so.offering_id IS NOT NULL AND so.subject_id = s_so.subject_id)
                    LEFT JOIN tbl_subject s_cs ON (cs.subject_id IS NOT NULL AND cs.subject_id = s_cs.subject_id)
                    WHERE cs.schedule_id = ? LIMIT 1");
            } else {
                $stmt = $mysqli->prepare("SELECT s.program_id AS program_id
                    FROM tbl_class_schedules cs
                    LEFT JOIN tbl_subject s ON (cs.subject_id IS NOT NULL AND cs.subject_id = s.subject_id)
                    WHERE cs.schedule_id = ? LIMIT 1");
            }
            if (!$stmt) return null;
            $stmt->bind_param('i', $scheduleId);
            $stmt->execute();
            $row = $stmt->get_result()->fetch_assoc();
            return ($row && isset($row['program_id'])) ? (int)$row['program_id'] : null;
        };

        $delete_schedule = function($scheduleId) use ($mysqli, $authUserId, $isProgramHeadRole, $programHeadProgramIds, $require_program_head_scope, $get_program_id_for_schedule) {
            $checkExisting = $mysqli->prepare("SELECT schedule_id FROM tbl_class_schedules WHERE schedule_id = ? LIMIT 1");
            if (!$checkExisting) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
            $checkExisting->bind_param("i", $scheduleId);
            $checkExisting->execute();
            $existingRow = $checkExisting->get_result()->fetch_assoc();
            if (!$existingRow) {
                json_response(['error' => 'schedule_not_found', 'message' => 'Schedule not found.'], 404);
            }

            if ($isProgramHeadRole) {
                $require_program_head_scope();
                $scheduleProgramId = $get_program_id_for_schedule($scheduleId);
                if (!$scheduleProgramId || !in_array((int)$scheduleProgramId, $programHeadProgramIds, true)) {
                    json_response(['error' => 'forbidden', 'message' => 'Program head can only delete schedules within their assigned program.'], 403);
                }
            }

            // Fetch details for logging before delete (use merged fields)
            $details = null;
            $qd = $mysqli->prepare("SELECT cs.day_of_week, cs.start_time, cs.end_time, r.room_name, s.subject_code, s.subject_name, sec.section_name, CONCAT(u.first_name,' ',u.last_name) AS teacher_name FROM tbl_class_schedules cs JOIN tbl_rooms r ON cs.room_id = r.room_id LEFT JOIN tbl_subject s ON cs.subject_id = s.subject_id LEFT JOIN tbl_sections sec ON cs.section_id = sec.section_id LEFT JOIN tbl_users u ON cs.user_id = u.user_id WHERE cs.schedule_id = ? LIMIT 1");
            if ($qd) { $qd->bind_param('i', $scheduleId); $qd->execute(); $details = $qd->get_result()->fetch_assoc(); }

            $attCheck = $mysqli->prepare("SELECT attendance_id FROM tbl_attendance_records WHERE schedule_id = ? LIMIT 1");
            if ($attCheck) {
                $attCheck->bind_param("i", $scheduleId);
                $attCheck->execute();
                if ($attCheck->get_result()->fetch_assoc()) {
                    json_response(['error' => 'schedule_in_use', 'message' => 'Schedule has attendance records. Delete attendance records first.'], 409);
                }
            }

            $subCheck = $mysqli->prepare("SELECT substitution_id FROM tbl_substitutions WHERE schedule_id = ? LIMIT 1");
            if ($subCheck) {
                $subCheck->bind_param("i", $scheduleId);
                $subCheck->execute();
                if ($subCheck->get_result()->fetch_assoc()) {
                    json_response(['error' => 'schedule_in_use', 'message' => 'Schedule has substitutions. Delete substitutions first.'], 409);
                }
            }

            $stmt = $mysqli->prepare("DELETE FROM tbl_class_schedules WHERE schedule_id = ?");
            if (!$stmt) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
            $stmt->bind_param("i", $scheduleId);
            if (!$stmt->execute()) {
                json_response(['error' => 'delete_failed', 'message' => $stmt->error], 500);
            }
            if ($stmt->affected_rows === 0) {
                json_response(['error' => 'schedule_not_found', 'message' => 'Schedule not found.'], 404);
            }

            // Log deletion
            $logMsg = 'Deleted schedule ID ' . $scheduleId;
            if ($details) {
                $subj = $details['subject_code'] ?? ($details['subject_name'] ?? '');
                $room = $details['room_name'] ?? '';
                $day = $details['day_of_week'] ?? '';
                $start = $details['start_time'] ?? '';
                $end = $details['end_time'] ?? '';
                $logMsg = "Deleted schedule for '{$subj}' in room '{$room}' on {$day} {$start}-{$end}";
            }
            log_system_action($mysqli, $authUserId, 'delete_schedule', $logMsg);
            json_response(['deleted' => true, 'schedule_id' => $scheduleId]);
        };

        $update_schedule = function($scheduleId) use ($mysqli, $input, $normalize_time_simple, $authUserId, $enforce_program_scope_for_subject_section, $isProgramHeadRole, $programHeadProgramIds, $require_program_head_scope, $get_program_id_for_schedule, $get_program_id_for_subject, $get_program_id_for_section, $get_teacher_program_id, $get_user_role_id) {
            $checkExisting = $mysqli->prepare("SELECT schedule_id FROM tbl_class_schedules WHERE schedule_id = ? LIMIT 1");
            if (!$checkExisting) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
            $checkExisting->bind_param("i", $scheduleId);
            $checkExisting->execute();
            $existingRow = $checkExisting->get_result()->fetch_assoc();
            if (!$existingRow) {
                json_response(['error' => 'schedule_not_found', 'message' => 'Schedule not found.'], 404);
            }

            if ($isProgramHeadRole) {
                $require_program_head_scope();
                $scheduleProgramId = $get_program_id_for_schedule($scheduleId);
                if (!$scheduleProgramId || !in_array((int)$scheduleProgramId, $programHeadProgramIds, true)) {
                    json_response(['error' => 'forbidden', 'message' => 'Program head can only update schedules within their assigned program.'], 403);
                }
            }

            $roomId = isset($input['room_id']) ? (int)$input['room_id'] : null;
            $subjectId = isset($input['subject_id']) ? (int)$input['subject_id'] : null;
            $sectionId = isset($input['section_id']) ? (int)$input['section_id'] : null;
            $teacherId = isset($input['user_id']) ? (int)$input['user_id'] : null;
            $semesterId = isset($input['semester_id']) ? (int)$input['semester_id'] : null;
            $dayOfWeek = isset($input['day_of_week']) ? strtolower(trim((string)$input['day_of_week'])) : null;
            $startTime = $normalize_time_simple($input['start_time'] ?? null);
            $endTime = $normalize_time_simple($input['end_time'] ?? null);
            if (!$roomId || !$subjectId || !$sectionId || !$teacherId || !$semesterId || !$dayOfWeek || !$startTime || !$endTime) {
                json_response(['error' => 'missing_fields', 'message' => 'room_id, subject_id, section_id, user_id, semester_id, day_of_week, start_time, end_time are required.'], 400);
            }

            $enforce_program_scope_for_subject_section($subjectId, $sectionId);
            $rowProgramId = $get_program_id_for_subject($subjectId);
            if (!$rowProgramId && $sectionId) $rowProgramId = $get_program_id_for_section($sectionId);
            $assigneeRoleId = $get_user_role_id($teacherId);
            if (!$assigneeRoleId) {
                json_response(['error' => 'validation', 'message' => 'Selected instructor account was not found.'], 409);
            }
            if ($assigneeRoleId === 1) {
                json_response(['error' => 'validation', 'message' => 'Admin accounts cannot be scheduled for classes.'], 409);
            }
            $teacherProgramId = $get_teacher_program_id($teacherId);
            $assigneeNeedsProgramMatch = in_array((int)$assigneeRoleId, [2, 3, 4, 5], true);
            if ($assigneeNeedsProgramMatch) {
                if ($rowProgramId && !$teacherProgramId) {
                    json_response(['error' => 'validation', 'message' => 'Program mismatch: selected instructor has no program assignment.'], 409);
                }
                if ($rowProgramId && $teacherProgramId && (int)$teacherProgramId !== (int)$rowProgramId) {
                    json_response(['error' => 'validation', 'message' => 'Program mismatch: instructor, subject, and section must belong to the same program.'], 409);
                }
            }
            if ($isProgramHeadRole && $assigneeNeedsProgramMatch) {
                if (!$teacherProgramId || !in_array((int)$teacherProgramId, $programHeadProgramIds, true)) {
                    json_response(['error' => 'forbidden', 'message' => 'Program head can only assign instructors within their own program.'], 403);
                }
            }

            // Reject 'localhost' in any string fields
            if (stripos($dayOfWeek, 'localhost') !== false || stripos($startTime, 'localhost') !== false || stripos($endTime, 'localhost') !== false) {
                json_response(['error' => 'validation', 'message' => 'Invalid input (localhost addresses are not allowed)'], 400);
            }
            if ($startTime >= $endTime) {
                json_response(['error' => 'validation', 'message' => 'start_time must be before end_time'], 400);
            }

            // Check exact duplicate (different schedule_id)
            $dup = $mysqli->prepare("SELECT schedule_id FROM tbl_class_schedules WHERE room_id = ? AND subject_id = ? AND section_id = ? AND user_id = ? AND semester_id = ? AND LOWER(TRIM(day_of_week)) = ? AND start_time = ? AND end_time = ? AND schedule_id <> ? LIMIT 1");
            if (!$dup) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
            $dup->bind_param("iiiiisssi", $roomId, $subjectId, $sectionId, $teacherId, $semesterId, $dayOfWeek, $startTime, $endTime, $scheduleId);
            $dup->execute();
            if ($dup->get_result()->fetch_assoc()) {
                json_response(['error' => 'duplicate_schedule', 'message' => 'Schedule already exists.'], 409);
            }

            $subjectTeacherConflict = $mysqli->prepare("SELECT schedule_id FROM tbl_class_schedules WHERE semester_id = ? AND LOWER(TRIM(day_of_week)) = ? AND subject_id = ? AND start_time = ? AND end_time = ? AND schedule_id <> ? AND (user_id IS NULL OR user_id <> ?) LIMIT 1");
            if ($subjectTeacherConflict) {
                $subjectTeacherConflict->bind_param("isissii", $semesterId, $dayOfWeek, $subjectId, $startTime, $endTime, $scheduleId, $teacherId);
                $subjectTeacherConflict->execute();
                if ($subjectTeacherConflict->get_result()->fetch_assoc()) {
                    json_response(['error' => 'time_conflict', 'message' => 'Subject-time conflict: same subject and exact time can only be assigned to the same teacher'], 409);
                }
            }

            // Check room overlap: same day, same room, overlapping times
            $roomOverlap = $mysqli->prepare("SELECT schedule_id FROM tbl_class_schedules WHERE semester_id = ? AND LOWER(TRIM(day_of_week)) = ? AND room_id = ? AND NOT (end_time <= ? OR start_time >= ?) AND schedule_id <> ? LIMIT 1");
            if (!$roomOverlap) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
            $roomOverlap->bind_param("isissi", $semesterId, $dayOfWeek, $roomId, $startTime, $endTime, $scheduleId);
            $roomOverlap->execute();
            if ($roomOverlap->get_result()->fetch_assoc()) {
                json_response(['error' => 'time_conflict', 'message' => 'Time conflict: room already has a class during this time'], 409);
            }

            // Block duplicate section+subject assignments on the same day (same semester).
            if ($sectionId && $subjectId) {
                $secSubjectDup = $mysqli->prepare("SELECT schedule_id FROM tbl_class_schedules WHERE semester_id = ? AND LOWER(TRIM(day_of_week)) = ? AND section_id = ? AND subject_id = ? AND schedule_id <> ? LIMIT 1");
                if ($secSubjectDup) {
                    $secSubjectDup->bind_param('isiii', $semesterId, $dayOfWeek, $sectionId, $subjectId, $scheduleId);
                    $secSubjectDup->execute();
                    if ($secSubjectDup->get_result()->fetch_assoc()) {
                        json_response(['error' => 'duplicate_section_subject', 'message' => 'Duplicate not allowed: this section already has this subject on the selected day'], 409);
                    }
                }
            }

            // Now perform update: set user_id, semester_id, subject_id, section_id, room_id, day_of_week, start_time, end_time
            $stmt = $mysqli->prepare("UPDATE tbl_class_schedules SET user_id = ?, semester_id = ?, subject_id = ?, section_id = ?, room_id = ?, day_of_week = ?, start_time = ?, end_time = ? WHERE schedule_id = ?");
            if (!$stmt) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
            $uVal = $teacherId ? $teacherId : null;
            $semVal = $semesterId ? $semesterId : null;
            $sSubj = $subjectId ? $subjectId : null;
            $sSec = $sectionId ? $sectionId : null;
            $stmt->bind_param("iiiiisssi", $uVal, $semVal, $sSubj, $sSec, $roomId, $dayOfWeek, $startTime, $endTime, $scheduleId);
            if (!$stmt->execute()) json_response(['error' => 'update_failed', 'message' => $stmt->error], 500);

            // Log schedule update - fetch friendly names from merged fields
            $roomName = null; $subjCode = null; $subjName = null;
            $qinfo = $mysqli->prepare("SELECT r.room_name, s.subject_code, s.subject_name FROM tbl_rooms r LEFT JOIN tbl_subject s ON s.subject_id = (SELECT subject_id FROM tbl_class_schedules WHERE schedule_id = ?) WHERE r.room_id = (SELECT room_id FROM tbl_class_schedules WHERE schedule_id = ?) LIMIT 1");
            if ($qinfo) { $qinfo->bind_param('ii', $scheduleId, $scheduleId); $qinfo->execute(); $inf = $qinfo->get_result()->fetch_assoc(); if ($inf) { $roomName = $inf['room_name'] ?? null; $subjCode = $inf['subject_code'] ?? null; $subjName = $inf['subject_name'] ?? null; } }
            $logMsg = "Updated schedule";
            if ($subjCode || $subjName || $roomName) { $logMsg = "Updated schedule for '" . ($subjCode ?? $subjName ?? '') . "' in room '" . ($roomName ?? '') . "' on {$dayOfWeek} {$startTime}-{$endTime}"; }
            log_system_action($mysqli, $authUserId, 'update_schedule', $logMsg);
            json_response(['schedule_id' => $scheduleId, 'room_id' => $roomId, 'subject_id' => $subjectId, 'section_id' => $sectionId, 'user_id' => $teacherId, 'semester_id' => $semesterId, 'day_of_week' => $dayOfWeek, 'start_time' => $startTime, 'end_time' => $endTime]);
        };

        $create_schedule = function() use ($mysqli, $input, $normalize_time_simple, $authUserId, $activeSemesterId, $enforce_program_scope_for_subject_section, $isProgramHeadRole, $programHeadProgramIds, $get_program_id_for_subject, $get_program_id_for_section, $get_teacher_program_id, $get_user_role_id) {
            $roomId = isset($input['room_id']) ? (int)$input['room_id'] : null;
            $subjectId = isset($input['subject_id']) ? (int)$input['subject_id'] : null;
            $sectionId = isset($input['section_id']) ? (int)$input['section_id'] : null;
            $teacherId = isset($input['user_id']) ? (int)$input['user_id'] : null;
            $semesterId = $activeSemesterId ? (int)$activeSemesterId : null;
            $dayOfWeek = isset($input['day_of_week']) ? strtolower(trim((string)$input['day_of_week'])) : null;
            $startTime = $normalize_time_simple($input['start_time'] ?? null);
            $endTime = $normalize_time_simple($input['end_time'] ?? null);

            if (!$semesterId) {
                json_response(['error' => 'no_active_semester', 'message' => 'No active semester found for current date.'], 409);
            }
            if (!$roomId || !$subjectId || !$sectionId || !$teacherId || !$dayOfWeek || !$startTime || !$endTime) {
                json_response(['error' => 'missing_fields', 'message' => 'room_id, subject_id, section_id, user_id, day_of_week, start_time, end_time are required.'], 400);
            }
            if ($startTime >= $endTime) {
                json_response(['error' => 'validation', 'message' => 'start_time must be before end_time'], 400);
            }

            $enforce_program_scope_for_subject_section($subjectId, $sectionId);
            $rowProgramId = $get_program_id_for_subject($subjectId);
            if (!$rowProgramId && $sectionId) $rowProgramId = $get_program_id_for_section($sectionId);
            $assigneeRoleId = $get_user_role_id($teacherId);
            if (!$assigneeRoleId) {
                json_response(['error' => 'validation', 'message' => 'Selected instructor account was not found.'], 409);
            }
            if ($assigneeRoleId === 1) {
                json_response(['error' => 'validation', 'message' => 'Admin accounts cannot be scheduled for classes.'], 409);
            }
            $teacherProgramId = $get_teacher_program_id($teacherId);
            $assigneeNeedsProgramMatch = in_array((int)$assigneeRoleId, [2, 3, 4, 5], true);
            if ($assigneeNeedsProgramMatch) {
                if ($rowProgramId && !$teacherProgramId) {
                    json_response(['error' => 'validation', 'message' => 'Program mismatch: selected instructor has no program assignment.'], 409);
                }
                if ($rowProgramId && $teacherProgramId && (int)$teacherProgramId !== (int)$rowProgramId) {
                    json_response(['error' => 'validation', 'message' => 'Program mismatch: instructor, subject, and section must belong to the same program.'], 409);
                }
            }
            if ($isProgramHeadRole && $assigneeNeedsProgramMatch) {
                if (!$teacherProgramId || !in_array((int)$teacherProgramId, $programHeadProgramIds, true)) {
                    json_response(['error' => 'forbidden', 'message' => 'Program head can only assign instructors within their own program.'], 403);
                }
            }

            $dup = $mysqli->prepare("SELECT schedule_id FROM tbl_class_schedules WHERE room_id = ? AND subject_id = ? AND section_id = ? AND user_id = ? AND semester_id = ? AND LOWER(TRIM(day_of_week)) = ? AND start_time = ? AND end_time = ? LIMIT 1");
            if (!$dup) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
            $dup->bind_param("iiiiisss", $roomId, $subjectId, $sectionId, $teacherId, $semesterId, $dayOfWeek, $startTime, $endTime);
            $dup->execute();
            if ($dup->get_result()->fetch_assoc()) {
                json_response(['error' => 'duplicate_schedule', 'message' => 'Schedule already exists.'], 409);
            }

            $subjectTeacherConflict = $mysqli->prepare("SELECT schedule_id FROM tbl_class_schedules WHERE semester_id = ? AND LOWER(TRIM(day_of_week)) = ? AND subject_id = ? AND start_time = ? AND end_time = ? AND (user_id IS NULL OR user_id <> ?) LIMIT 1");
            if ($subjectTeacherConflict) {
                $subjectTeacherConflict->bind_param("isissi", $semesterId, $dayOfWeek, $subjectId, $startTime, $endTime, $teacherId);
                $subjectTeacherConflict->execute();
                if ($subjectTeacherConflict->get_result()->fetch_assoc()) {
                    json_response(['error' => 'time_conflict', 'message' => 'Subject-time conflict: same subject and exact time can only be assigned to the same teacher'], 409);
                }
            }

            $roomOverlap = $mysqli->prepare("SELECT schedule_id FROM tbl_class_schedules WHERE semester_id = ? AND LOWER(TRIM(day_of_week)) = ? AND room_id = ? AND NOT (end_time <= ? OR start_time >= ?) LIMIT 1");
            if ($roomOverlap) {
                $roomOverlap->bind_param("isiss", $semesterId, $dayOfWeek, $roomId, $startTime, $endTime);
                $roomOverlap->execute();
                if ($roomOverlap->get_result()->fetch_assoc()) json_response(['error' => 'time_conflict', 'message' => 'Time conflict: room already has a class during this time'], 409);
            }

            $secSubjectDup = $mysqli->prepare("SELECT schedule_id FROM tbl_class_schedules WHERE semester_id = ? AND LOWER(TRIM(day_of_week)) = ? AND section_id = ? AND subject_id = ? LIMIT 1");
            if ($secSubjectDup) {
                $secSubjectDup->bind_param("isii", $semesterId, $dayOfWeek, $sectionId, $subjectId);
                $secSubjectDup->execute();
                if ($secSubjectDup->get_result()->fetch_assoc()) {
                    json_response(['error' => 'duplicate_section_subject', 'message' => 'Duplicate not allowed: this section already has this subject on the selected day'], 409);
                }
            }

            $stmt = $mysqli->prepare("INSERT INTO tbl_class_schedules (user_id, semester_id, subject_id, section_id, room_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
            if (!$stmt) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
            $stmt->bind_param("iiiiisss", $teacherId, $semesterId, $subjectId, $sectionId, $roomId, $dayOfWeek, $startTime, $endTime);
            if (!$stmt->execute()) json_response(['error' => 'insert_failed', 'message' => $stmt->error], 500);

            log_system_action($mysqli, $authUserId, 'create_schedule', "Created class schedule in room {$roomId} on {$dayOfWeek} {$startTime}-{$endTime}");
            json_response([
                'schedule_id' => $stmt->insert_id,
                'room_id' => $roomId,
                'subject_id' => $subjectId,
                'section_id' => $sectionId,
                'user_id' => $teacherId,
                'semester_id' => $semesterId,
                'day_of_week' => $dayOfWeek,
                'start_time' => $startTime,
                'end_time' => $endTime,
            ], 201);
        };

        if ($request_method === 'GET' && $param1 === 'offerings') {
            // Provide a list of subject+section+teacher combos. If tbl_subject_offerings exists use it; otherwise build from subjects + sections + users mapping
            $programFilterSql = '';
            if ($isProgramHeadRole) {
                $require_program_head_scope();
                $programFilterSql = " WHERE p.program_id IN (" . implode(',', array_map('intval', $programHeadProgramIds)) . ")";
            }
            if ($has_subject_offerings) {
                $result = $mysqli->query("SELECT so.offering_id, so.user_id, s.subject_code, s.subject_name, sec.section_name, p.head_id, p.dept_id AS program_dept_id, u.dept_id AS teacher_dept_id FROM tbl_subject_offerings so JOIN tbl_subject s ON so.subject_id = s.subject_id JOIN tbl_sections sec ON so.section_id = sec.section_id LEFT JOIN tbl_programs p ON s.program_id = p.program_id LEFT JOIN tbl_users u ON so.user_id = u.user_id{$programFilterSql}");
                json_response($result->fetch_all(MYSQLI_ASSOC));
            } else {
                $result = $mysqli->query("SELECT s.subject_id, s.subject_code, s.subject_name, sec.section_id, sec.section_name, NULL AS offering_id, NULL AS user_id, p.program_id, p.dept_id AS program_dept_id FROM tbl_subject s JOIN tbl_sections sec ON sec.program_id = s.program_id LEFT JOIN tbl_programs p ON s.program_id = p.program_id{$programFilterSql}");
                json_response($result->fetch_all(MYSQLI_ASSOC));
            }
        } elseif ($request_method === 'GET') {
            // Rich GET for class schedules: use offerings path only when table + column are present.
            $programFilterSql = '';
            if ($isProgramHeadRole) {
                $require_program_head_scope();
                $programFilterSql = " WHERE p.program_id IN (" . implode(',', array_map('intval', $programHeadProgramIds)) . ")";
            }
            if ($has_subject_offerings && $cs_has_offering_col) {
                $sql = "SELECT cs.schedule_id, cs.room_id, cs.offering_id, cs.subject_id, cs.section_id, cs.semester_id, cs.user_id AS teacher_id, cs.day_of_week, cs.start_time, cs.end_time, r.room_name,
                           COALESCE(s_so.subject_code, s_cs.subject_code) AS subject_code,
                           COALESCE(s_so.subject_name, s_cs.subject_name) AS subject_name,
                           COALESCE(sec_so.section_name, sec_cs.section_name) AS section_name,
                           CONCAT(u.first_name, ' ', u.last_name) AS teacher_name, u.dept_id AS teacher_dept_id,
                           p.program_id, p.program_name, p.dept_id, d.dept_name, sc.school_id AS campus_id, sc.school_name AS campus_name, b.building_id, b.building_name, f.floor_id, f.floor_name, sem.start_date AS semester_start, sem.end_date AS semester_end
                        FROM tbl_class_schedules cs
                        JOIN tbl_rooms r ON cs.room_id = r.room_id
                        LEFT JOIN tbl_subject_offerings so ON (cs.offering_id IS NOT NULL AND so.offering_id = cs.offering_id)
                        LEFT JOIN tbl_subject s_so ON (so.offering_id IS NOT NULL AND so.subject_id = s_so.subject_id)
                        LEFT JOIN tbl_sections sec_so ON (so.offering_id IS NOT NULL AND so.section_id = sec_so.section_id)
                        LEFT JOIN tbl_subject s_cs ON (cs.subject_id IS NOT NULL AND cs.subject_id = s_cs.subject_id)
                        LEFT JOIN tbl_sections sec_cs ON (cs.section_id IS NOT NULL AND cs.section_id = sec_cs.section_id)
                        LEFT JOIN tbl_users u ON (cs.user_id IS NOT NULL AND cs.user_id = u.user_id)
                        LEFT JOIN tbl_programs p ON ( (so.offering_id IS NOT NULL AND s_so.program_id = p.program_id) OR (cs.subject_id IS NOT NULL AND s_cs.program_id = p.program_id) )
                        LEFT JOIN tbl_departments d ON p.dept_id = d.dept_id
                        LEFT JOIN tbl_buildings b ON r.building_id = b.building_id
                        LEFT JOIN tbl_school sc ON b.school_id = sc.school_id
                        LEFT JOIN tbl_floors f ON r.floor_id = f.floor_id
                        LEFT JOIN tbl_semesters sem ON (cs.semester_id IS NOT NULL AND cs.semester_id = sem.semester_id)
                        {$programFilterSql}
                        ORDER BY FIELD(cs.day_of_week, 'monday','tuesday','wednesday','thursday','friday','saturday','sunday'), cs.start_time";
            } else {
                $sql = "SELECT cs.schedule_id, cs.room_id, NULL AS offering_id, cs.subject_id, cs.section_id, cs.semester_id, cs.user_id AS teacher_id, cs.day_of_week, cs.start_time, cs.end_time, r.room_name,
                           s.subject_code, s.subject_name, sec.section_name,
                           CONCAT(u.first_name, ' ', u.last_name) AS teacher_name, u.dept_id AS teacher_dept_id,
                           p.program_id, p.program_name, p.dept_id, d.dept_name, sc.school_id AS campus_id, sc.school_name AS campus_name, b.building_id, b.building_name, f.floor_id, f.floor_name, sem.start_date AS semester_start, sem.end_date AS semester_end
                        FROM tbl_class_schedules cs
                        JOIN tbl_rooms r ON cs.room_id = r.room_id
                        LEFT JOIN tbl_subject s ON (cs.subject_id IS NOT NULL AND cs.subject_id = s.subject_id)
                        LEFT JOIN tbl_sections sec ON (cs.section_id IS NOT NULL AND cs.section_id = sec.section_id)
                        LEFT JOIN tbl_users u ON (cs.user_id IS NOT NULL AND cs.user_id = u.user_id)
                        LEFT JOIN tbl_programs p ON (s.program_id = p.program_id)
                        LEFT JOIN tbl_departments d ON p.dept_id = d.dept_id
                        LEFT JOIN tbl_buildings b ON r.building_id = b.building_id
                        LEFT JOIN tbl_school sc ON b.school_id = sc.school_id
                        LEFT JOIN tbl_floors f ON r.floor_id = f.floor_id
                        LEFT JOIN tbl_semesters sem ON (cs.semester_id IS NOT NULL AND cs.semester_id = sem.semester_id)
                        {$programFilterSql}
                        ORDER BY FIELD(cs.day_of_week, 'monday','tuesday','wednesday','thursday','friday','saturday','sunday'), cs.start_time";
            }
            $result = $mysqli->query($sql);
            if ($result === false) {
                error_log('class-schedules: SQL error: ' . $mysqli->error . ' -- SQL: ' . preg_replace('/\s+/', ' ', substr($sql, 0, 1000)));
                json_response(['error' => 'query_failed', 'message' => 'Failed to fetch class schedules', 'details' => $mysqli->error], 500);
            }
            json_response($result->fetch_all(MYSQLI_ASSOC));
        }

        if ($request_method === 'PUT' && is_numeric($param1)) {
            $update_schedule((int)$param1);
        } elseif ($request_method === 'POST' && is_numeric($param1) && $param2 === 'update') {
            $update_schedule((int)$param1);
        } elseif ($request_method === 'DELETE' && is_numeric($param1)) {
            $delete_schedule((int)$param1);
        } elseif ($request_method === 'POST' && is_numeric($param1) && $param2 === 'delete') {
            $delete_schedule((int)$param1);
        }

        // Batch import/create: supports ClassSchedule page payload ({ rows: [...] }) and spreadsheet rows.
        if ($request_method === 'POST' && isset($input['rows']) && is_array($input['rows'])) {
            $rows = $input['rows'];
            $errors = [];
            $inserted = 0;
            $skipped = 0;
            $previewOnly = !empty($input['preview']);
            if (!$activeSemesterId) {
                json_response(['error' => 'no_active_semester', 'message' => 'No active semester found for current date.'], 409);
            }

            $normalize_header = function($key) {
                $k = strtolower(trim((string)$key));
                return preg_replace('/[^a-z0-9]+/', '_', $k);
            };
            $normalize_lookup = function($v) {
                return strtolower(trim((string)$v));
            };
            $get_value = function($arr, $keys) {
                foreach ($keys as $k) {
                    if (array_key_exists($k, $arr) && $arr[$k] !== null && trim((string)$arr[$k]) !== '') return $arr[$k];
                }
                return null;
            };
            $normalize_day = function($value) {
                if ($value === null) return null;
                $v = strtolower(trim((string)$value));
                if ($v === '') return null;
                $map = [
                    'mon' => 'monday', 'monday' => 'monday',
                    'tue' => 'tuesday', 'tues' => 'tuesday', 'tuesday' => 'tuesday',
                    'wed' => 'wednesday', 'wednesday' => 'wednesday',
                    'thu' => 'thursday', 'thur' => 'thursday', 'thurs' => 'thursday', 'thursday' => 'thursday',
                    'fri' => 'friday', 'friday' => 'friday',
                    'sat' => 'saturday', 'saturday' => 'saturday',
                    'sun' => 'sunday', 'sunday' => 'sunday',
                ];
                return $map[$v] ?? null;
            };
            $normalize_time = function($value) use ($normalize_time_simple) {
                $t = $normalize_time_simple($value);
                if (!$t) return null;
                if (!preg_match('/^\d{2}:\d{2}:\d{2}$/', $t)) {
                    $ts = strtotime((string)$value);
                    if ($ts === false) return null;
                    $t = date('H:i:s', $ts);
                }
                return $t;
            };
            $time_overlaps = function($startA, $endA, $startB, $endB) {
                return !($endA <= $startB || $startA >= $endB);
            };

            $rooms_result = $mysqli->query("
                SELECT r.room_id, r.room_name
                FROM tbl_rooms r
                LEFT JOIN tbl_floors f ON r.floor_id = f.floor_id
                LEFT JOIN tbl_buildings b ON r.building_id = b.building_id
                WHERE LOWER(TRIM(COALESCE(r.status, 'active'))) IN ('active', '1', 'true')
                  AND (f.floor_id IS NULL OR LOWER(TRIM(COALESCE(f.status, 'active'))) IN ('active', '1', 'true'))
                  AND (b.building_id IS NULL OR LOWER(TRIM(COALESCE(b.status, 'active'))) IN ('active', '1', 'true'))
            ");
            if (!$rooms_result) json_response(['error' => 'Failed to load rooms', 'details' => $mysqli->error], 500);
            $roomById = [];
            $roomByName = [];
            foreach ($rooms_result->fetch_all(MYSQLI_ASSOC) as $room) {
                $roomById[(string)$room['room_id']] = $room;
                $roomByName[$normalize_lookup($room['room_name'])] = $room;
            }

            $subjects_result = $mysqli->query("
                SELECT s.subject_id, s.subject_code, s.subject_name, s.program_id
                FROM tbl_subject s
                LEFT JOIN tbl_programs p ON s.program_id = p.program_id
                LEFT JOIN tbl_departments d ON p.dept_id = d.dept_id
                WHERE LOWER(TRIM(COALESCE(s.status, 'active'))) IN ('active', '1', 'true')
                  AND (p.program_id IS NULL OR LOWER(TRIM(COALESCE(p.status, 'active'))) IN ('active', '1', 'true'))
                  AND (d.dept_id IS NULL OR LOWER(TRIM(COALESCE(d.status, 'active'))) IN ('active', '1', 'true'))
            ");
            $sections_result = $mysqli->query("
                SELECT sec.section_id, sec.section_name, sec.program_id
                FROM tbl_sections sec
                LEFT JOIN tbl_programs p ON sec.program_id = p.program_id
                LEFT JOIN tbl_departments d ON p.dept_id = d.dept_id
                WHERE LOWER(TRIM(COALESCE(sec.status, 'active'))) IN ('active', '1', 'true')
                  AND (p.program_id IS NULL OR LOWER(TRIM(COALESCE(p.status, 'active'))) IN ('active', '1', 'true'))
                  AND (d.dept_id IS NULL OR LOWER(TRIM(COALESCE(d.status, 'active'))) IN ('active', '1', 'true'))
            ");
            $users_select = "user_id, role_id, first_name, last_name, email";
            if ($usersHasAssignedProgramCol) $users_select .= ", assigned_program_head_id";
            if ($usersHasProgramIdCol) $users_select .= ", program_id";
            $users_result = $mysqli->query("
                SELECT {$users_select}
                FROM tbl_users
                WHERE role_id <> 1
                  AND LOWER(TRIM(COALESCE(status, 'active'))) IN ('active', '1', 'true')
            ");

            $subjById = []; $subjByCode = []; $subjByName = [];
            if ($subjects_result) {
                foreach ($subjects_result->fetch_all(MYSQLI_ASSOC) as $s) {
                    $subjById[(string)$s['subject_id']] = $s;
                    $subjByCode[$normalize_lookup($s['subject_code'])] = $s;
                    $subjByName[$normalize_lookup($s['subject_name'])] = $s;
                }
            }

            $secById = []; $secByName = [];
            if ($sections_result) {
                foreach ($sections_result->fetch_all(MYSQLI_ASSOC) as $s) {
                    $secById[(string)$s['section_id']] = $s;
                    $secByName[$normalize_lookup($s['section_name'])] = $s;
                }
            }

            $resolve_teacher_program_id = function($teacher) use ($usersHasAssignedProgramCol, $usersHasProgramIdCol, $get_teacher_program_id) {
                if (!$teacher || !is_array($teacher)) return null;
                $roleId = isset($teacher['role_id']) ? (int)$teacher['role_id'] : 0;
                if (!in_array($roleId, [2, 3, 4, 5], true)) return null;
                if ($usersHasAssignedProgramCol && isset($teacher['assigned_program_head_id']) && $teacher['assigned_program_head_id'] !== null && (string)$teacher['assigned_program_head_id'] !== '') {
                    return (int)$teacher['assigned_program_head_id'];
                }
                if ($usersHasProgramIdCol && isset($teacher['program_id']) && $teacher['program_id'] !== null && (string)$teacher['program_id'] !== '') {
                    return (int)$teacher['program_id'];
                }
                if (isset($teacher['user_id'])) {
                    return $get_teacher_program_id((int)$teacher['user_id']);
                }
                return null;
            };

            $teacherById = []; $teacherByName = []; $teacherByEmail = [];
            if ($users_result) {
                foreach ($users_result->fetch_all(MYSQLI_ASSOC) as $u) {
                    $teacherById[(string)$u['user_id']] = $u;
                    $teacherByName[$normalize_lookup(trim(($u['first_name'] ?? '') . ' ' . ($u['last_name'] ?? '')))] = $u;
                    if (!empty($u['email'])) $teacherByEmail[$normalize_lookup($u['email'])] = $u;
                }
            }

            $existingExact = [];
            $existingResult = $mysqli->query("SELECT semester_id, room_id, subject_id, section_id, user_id, LOWER(TRIM(day_of_week)) AS day_of_week, TIME_FORMAT(start_time, '%H:%i:%s') AS start_time, TIME_FORMAT(end_time, '%H:%i:%s') AS end_time FROM tbl_class_schedules WHERE semester_id = " . (int)$activeSemesterId);
            if ($existingResult) {
                foreach ($existingResult->fetch_all(MYSQLI_ASSOC) as $ex) {
                    $k = $ex['semester_id'] . '|' . $ex['room_id'] . '|' . $ex['subject_id'] . '|' . $ex['section_id'] . '|' . (int)($ex['user_id'] ?? 0) . '|' . $ex['day_of_week'] . '|' . $ex['start_time'] . '|' . $ex['end_time'];
                    $existingExact[$k] = true;
                }
            }
            $acceptedRows = [];

            $subjectTeacherConflictStmt = $mysqli->prepare("SELECT schedule_id FROM tbl_class_schedules WHERE semester_id = ? AND LOWER(TRIM(day_of_week)) = ? AND subject_id = ? AND start_time = ? AND end_time = ? AND (user_id IS NULL OR user_id <> ?) LIMIT 1");
            $roomOverlapStmt = $mysqli->prepare("SELECT schedule_id FROM tbl_class_schedules WHERE semester_id = ? AND LOWER(TRIM(day_of_week)) = ? AND room_id = ? AND NOT (end_time <= ? OR start_time >= ?) LIMIT 1");
            $secSubjectDupStmt = $mysqli->prepare("SELECT schedule_id FROM tbl_class_schedules WHERE semester_id = ? AND LOWER(TRIM(day_of_week)) = ? AND section_id = ? AND subject_id = ? LIMIT 1");

            $stmt = $mysqli->prepare("INSERT INTO tbl_class_schedules (user_id, semester_id, subject_id, section_id, room_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
            if (!$stmt) json_response(['error' => 'Failed to prepare schedule insert', 'details' => $mysqli->error], 500);

            foreach ($rows as $idx => $row) {
                $rowNumber = $idx + 1;
                if (!is_array($row)) {
                    $errors[] = ['row' => $rowNumber, 'message' => 'Row is not a valid object'];
                    continue;
                }

                $normalized = [];
                foreach ($row as $key => $value) {
                    $nk = $normalize_header($key);
                    if ($nk !== '') $normalized[$nk] = $value;
                }

                $roomIdVal = $get_value($normalized, ['room_id', 'roomid']);
                $roomNameVal = $get_value($normalized, ['room_name', 'room', 'room_no', 'room_number']);
                $room = null;
                if ($roomIdVal !== null && is_numeric($roomIdVal)) {
                    $room = $roomById[(string)(int)$roomIdVal] ?? null;
                }
                if (!$room && $roomNameVal !== null) {
                    $room = $roomByName[$normalize_lookup($roomNameVal)] ?? null;
                }
                if (!$room) {
                    $errors[] = ['row' => $rowNumber, 'message' => 'Room not found, or room/building/floor is inactive or archived'];
                    continue;
                }

                $subject = null;
                $subjectIdVal = $get_value($normalized, ['subject_id', 'subjectid']);
                $subjectCode = $get_value($normalized, ['subject_code', 'subjectcode', 'subject']);
                $subjectName = $get_value($normalized, ['subject_name', 'subjectname']);
                if ($subjectIdVal !== null && is_numeric($subjectIdVal)) $subject = $subjById[(string)(int)$subjectIdVal] ?? null;
                if (!$subject && $subjectCode !== null) $subject = $subjByCode[$normalize_lookup($subjectCode)] ?? null;
                if (!$subject && $subjectName !== null) $subject = $subjByName[$normalize_lookup($subjectName)] ?? null;
                if (!$subject) {
                    $errors[] = ['row' => $rowNumber, 'message' => 'Subject not found, or subject/program/department is inactive or archived'];
                    continue;
                }

                $section = null;
                $sectionIdVal = $get_value($normalized, ['section_id', 'sectionid']);
                $sectionName = $get_value($normalized, ['section_name', 'section', 'sectionname']);
                if ($sectionIdVal !== null && is_numeric($sectionIdVal)) $section = $secById[(string)(int)$sectionIdVal] ?? null;
                if (!$section && $sectionName !== null) $section = $secByName[$normalize_lookup($sectionName)] ?? null;
                if (!$section) {
                    $errors[] = ['row' => $rowNumber, 'message' => 'Section not found, or section/program/department is inactive or archived'];
                    continue;
                }

                $subjectProgramId = (isset($subject['program_id']) && $subject['program_id'] !== null) ? (int)$subject['program_id'] : null;
                $sectionProgramId = (isset($section['program_id']) && $section['program_id'] !== null) ? (int)$section['program_id'] : null;
                if ($subjectProgramId && $sectionProgramId && $subjectProgramId !== $sectionProgramId) {
                    $errors[] = ['row' => $rowNumber, 'message' => 'Program mismatch: subject and section belong to different programs.'];
                    $skipped++;
                    continue;
                }
                $rowProgramId = $subjectProgramId ?: $sectionProgramId;

                if ($isProgramHeadRole) {
                    $require_program_head_scope();
                    if (!$rowProgramId || !in_array((int)$rowProgramId, $programHeadProgramIds, true)) {
                        $errors[] = ['row' => $rowNumber, 'message' => 'Program mismatch: you can only import schedules for your assigned program.'];
                        $skipped++;
                        continue;
                    }
                }

                $teacherVal = $get_value($normalized, ['user_id', 'teacher_id', 'teacher', 'teacher_name', 'teacher_email']);
                $teacher = null;
                if ($teacherVal !== null && is_numeric($teacherVal)) {
                    $teacher = $teacherById[(string)(int)$teacherVal] ?? null;
                } elseif ($teacherVal !== null) {
                    $teacher = $teacherByName[$normalize_lookup($teacherVal)] ?? ($teacherByEmail[$normalize_lookup($teacherVal)] ?? null);
                }
                if (!$teacher) {
                    $errors[] = ['row' => $rowNumber, 'message' => 'Instructor is required and must be active (not archived)'];
                    continue;
                }
                $teacherId = (int)$teacher['user_id'];
                $assigneeRoleId = (int)($teacher['role_id'] ?? 0);
                $teacherProgramId = $resolve_teacher_program_id($teacher);
                if (in_array($assigneeRoleId, [2, 3, 4, 5], true)) {
                    if ($rowProgramId && !$teacherProgramId) {
                        $errors[] = ['row' => $rowNumber, 'message' => 'Program mismatch: selected instructor has no program assignment.'];
                        $skipped++;
                        continue;
                    }
                    if ($rowProgramId && $teacherProgramId && (int)$teacherProgramId !== (int)$rowProgramId) {
                        $errors[] = ['row' => $rowNumber, 'message' => 'Program mismatch: instructor, subject, and section must belong to the same program.'];
                        $skipped++;
                        continue;
                    }
                }
                if ($isProgramHeadRole && in_array($assigneeRoleId, [2, 3, 4, 5], true)) {
                    if (!$teacherProgramId || !in_array((int)$teacherProgramId, $programHeadProgramIds, true)) {
                        $errors[] = ['row' => $rowNumber, 'message' => 'Program mismatch: selected instructor belongs to a different program.'];
                        $skipped++;
                        continue;
                    }
                }

                $semesterId = (int)$activeSemesterId;

                $day = $normalize_day($get_value($normalized, ['day_of_week', 'day', 'weekday', 'dow']));
                $startTime = $normalize_time($get_value($normalized, ['start_time', 'start', 'time_start', 'from']));
                $endTime = $normalize_time($get_value($normalized, ['end_time', 'end', 'time_end', 'to']));
                if (!$day || !$startTime || !$endTime) {
                    $errors[] = ['row' => $rowNumber, 'message' => 'day_of_week, start_time, and end_time are required'];
                    continue;
                }
                if ($startTime >= $endTime) {
                    $errors[] = ['row' => $rowNumber, 'message' => 'start_time must be before end_time'];
                    continue;
                }

                $roomIdForCheck = (int)$room['room_id'];
                $subjectIdForCheck = (int)$subject['subject_id'];
                $sectionIdForCheck = (int)$section['section_id'];
                $exactKey = $semesterId . '|' . $roomIdForCheck . '|' . $subjectIdForCheck . '|' . $sectionIdForCheck . '|' . $teacherId . '|' . $day . '|' . $startTime . '|' . $endTime;
                if (isset($existingExact[$exactKey])) {
                    $errors[] = ['row' => $rowNumber, 'message' => 'Duplicate schedule already exists'];
                    $skipped++;
                    continue;
                }

                $conflict = false;
                foreach ($acceptedRows as $accepted) {
                    if ((int)$accepted['semester_id'] !== $semesterId) continue;
                    if ($accepted['day_of_week'] !== $day) continue;

                    $sameTeacher = ((int)$accepted['teacher_id'] === $teacherId);
                    $sameSubjectExactSlot = ((int)$accepted['subject_id'] === $subjectIdForCheck)
                        && $accepted['start_time'] === $startTime
                        && $accepted['end_time'] === $endTime;
                    if ($sameSubjectExactSlot && !$sameTeacher) {
                        $errors[] = ['row' => $rowNumber, 'message' => 'Subject-time conflict: same subject and exact time can only be assigned to the same teacher'];
                        $skipped++;
                        $conflict = true;
                        break;
                    }

                    $sameSectionAndSubject = ((int)$accepted['section_id'] === $sectionIdForCheck)
                        && ((int)$accepted['subject_id'] === $subjectIdForCheck);
                    if ($sameSectionAndSubject) {
                        $errors[] = ['row' => $rowNumber, 'message' => 'Duplicate not allowed: this section already has this subject on the selected day'];
                        $skipped++;
                        $conflict = true;
                        break;
                    }

                    if (!$time_overlaps($startTime, $endTime, $accepted['start_time'], $accepted['end_time'])) continue;
                    if ((int)$accepted['room_id'] === $roomIdForCheck) {
                        $errors[] = ['row' => $rowNumber, 'message' => 'Conflict: room already has a class during this time'];
                        $skipped++;
                        $conflict = true;
                        break;
                    }
                }
                if ($conflict) continue;

                if ($subjectTeacherConflictStmt) {
                    $subjectTeacherConflictStmt->bind_param('isissi', $semesterId, $day, $subjectIdForCheck, $startTime, $endTime, $teacherId);
                    $subjectTeacherConflictStmt->execute();
                    $stv = $subjectTeacherConflictStmt->get_result();
                    if ($stv && $stv->fetch_assoc()) {
                        $errors[] = ['row' => $rowNumber, 'message' => 'Subject-time conflict: same subject and exact time can only be assigned to the same teacher'];
                        $skipped++;
                        $conflict = true;
                    }
                }
                if ($conflict) continue;

                if ($roomOverlapStmt) {
                    $roomOverlapStmt->bind_param('isiss', $semesterId, $day, $roomIdForCheck, $startTime, $endTime);
                    $roomOverlapStmt->execute();
                    $rv = $roomOverlapStmt->get_result();
                    if ($rv && $rv->fetch_assoc()) {
                        $errors[] = ['row' => $rowNumber, 'message' => 'Conflict: room already has a class during this time'];
                        $skipped++;
                        $conflict = true;
                    }
                }
                if ($conflict) continue;

                if ($secSubjectDupStmt) {
                    $secSubjectDupStmt->bind_param('isii', $semesterId, $day, $sectionIdForCheck, $subjectIdForCheck);
                    $secSubjectDupStmt->execute();
                    $sv = $secSubjectDupStmt->get_result();
                    if ($sv && $sv->fetch_assoc()) {
                        $errors[] = ['row' => $rowNumber, 'message' => 'Duplicate not allowed: this section already has this subject on the selected day'];
                        $skipped++;
                        $conflict = true;
                    }
                }
                if ($conflict) continue;

                $acceptedRow = [
                    'semester_id' => $semesterId,
                    'room_id' => $roomIdForCheck,
                    'subject_id' => $subjectIdForCheck,
                    'section_id' => $sectionIdForCheck,
                    'teacher_id' => $teacherId,
                    'day_of_week' => $day,
                    'start_time' => $startTime,
                    'end_time' => $endTime
                ];
                if ($previewOnly) {
                    $existingExact[$exactKey] = true;
                    $acceptedRows[] = $acceptedRow;
                    $inserted++;
                    continue;
                }
                $stmt->bind_param('iiiiisss', $teacherId, $semesterId, $subjectIdForCheck, $sectionIdForCheck, $roomIdForCheck, $day, $startTime, $endTime);
                if (!$stmt->execute()) {
                    $errors[] = ['row' => $rowNumber, 'message' => 'Insert failed: ' . $stmt->error];
                    $skipped++;
                    continue;
                }

                $existingExact[$exactKey] = true;
                $acceptedRows[] = $acceptedRow;
                $inserted++;
            }

            if (!$previewOnly && $inserted > 0) {
                log_system_action($mysqli, $authUserId, 'batch_create_schedules', "Batch added {$inserted} class schedule(s)");
            }

            json_response([
                'preview' => $previewOnly,
                'inserted' => $inserted,
                'skipped' => $skipped,
                'errors' => $errors,
            ]);
        } elseif ($request_method === 'POST') {
            $create_schedule();
        }
        break;

    default:
        // This case should ideally not be reached if the main index.php router is correct
        json_response(['error' => 'Endpoint not found in main API file.'], 404);
        break;
}
