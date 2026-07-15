<?php
// server-php/api/user_profile.php

if (!isset($GLOBALS['mysqli']) || $GLOBALS['mysqli'] === null) {
    if (file_exists(__DIR__ . '/../config/database.php')) {
        require_once __DIR__ . '/../config/database.php';
    }
}

if (!function_exists('json_response')) {
    require_once __DIR__ . '/../helpers/functions.php';
}

global $mysqli;

$permissionModeColCheck = $mysqli->query("SHOW COLUMNS FROM tbl_users LIKE 'permission_mode'");
$modulePermissionsColCheck = $mysqli->query("SHOW COLUMNS FROM tbl_users LIKE 'module_permissions'");
$hasPermissionModeCol = $permissionModeColCheck && $permissionModeColCheck->num_rows > 0;
$hasModulePermissionsCol = $modulePermissionsColCheck && $modulePermissionsColCheck->num_rows > 0;
$hasUserModulePermissions = $hasPermissionModeCol && $hasModulePermissionsCol;

$decode_module_permissions = function($raw) {
    if ($raw === null || $raw === '') return ['allow' => [], 'deny' => []];
    $parsed = is_array($raw) ? $raw : json_decode((string)$raw, true);
    if (!is_array($parsed)) return ['allow' => [], 'deny' => []];
    $allow = isset($parsed['allow']) && is_array($parsed['allow']) ? array_values($parsed['allow']) : [];
    $deny = isset($parsed['deny']) && is_array($parsed['deny']) ? array_values($parsed['deny']) : [];
    return ['allow' => $allow, 'deny' => $deny];
};

$normalize_avatar = function($rawImage) {
    if (empty($rawImage)) return null;
    $image = (string)$rawImage;
    if (strpos($image, 'data:') === 0) {
        return $image;
    }
    return 'data:image/png;base64,' . $image;
};

$fetch_profile_row = function($userId) use ($mysqli, $hasUserModulePermissions) {
    $permissionCols = $hasUserModulePermissions
        ? ", u.permission_mode, u.module_permissions"
        : ", NULL AS permission_mode, NULL AS module_permissions";
    $stmt = $mysqli->prepare("SELECT u.user_id, u.role_id, u.dept_id, d.dept_name, u.first_name, u.last_name, u.id_number, u.email, u.image, u.contact_no, r.role_name{$permissionCols} FROM tbl_users u LEFT JOIN tbl_departments d ON u.dept_id = d.dept_id LEFT JOIN tbl_roles r ON u.role_id = r.role_id WHERE u.user_id = ? LIMIT 1");
    if (!$stmt) {
        json_response(['ok' => false, 'error' => 'db_prepare_failed', 'details' => $mysqli->error], 500);
    }
    $stmt->bind_param('i', $userId);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    return $row ?: null;
};

$build_profile_payload = function($row) use ($hasUserModulePermissions, $decode_module_permissions, $normalize_avatar) {
    return [
        'user_id' => (int)$row['user_id'],
        'role_id' => isset($row['role_id']) ? (int)$row['role_id'] : null,
        'dept_id' => isset($row['dept_id']) ? (int)$row['dept_id'] : null,
        'dept_name' => isset($row['dept_name']) ? $row['dept_name'] : null,
        'first_name' => $row['first_name'],
        'last_name' => $row['last_name'],
        'id_number' => isset($row['id_number']) ? (string)$row['id_number'] : '',
        'email' => $row['email'],
        'contact_no' => isset($row['contact_no']) ? $row['contact_no'] : null,
        'avatar' => $normalize_avatar($row['image'] ?? null),
        'role_name' => isset($row['role_name']) ? app_format_role_name($row['role_name']) : null,
        'permission_mode' => $hasUserModulePermissions ? ($row['permission_mode'] ?? 'default') : 'default',
        'module_permissions' => $hasUserModulePermissions ? $decode_module_permissions($row['module_permissions'] ?? null) : ['allow' => [], 'deny' => []],
    ];
};

$request_method = $_SERVER['REQUEST_METHOD'];
$auth = app_decode_auth_token_payload(true);
$authUserId = isset($auth['user_id']) ? (int)$auth['user_id'] : 0;
$authRoleId = isset($auth['role_id']) ? (int)$auth['role_id'] : 0;

if ($request_method === 'GET') {
    $user_id = isset($_GET['user_id']) ? (int)$_GET['user_id'] : null;
    if (!$user_id) json_response(['ok' => false, 'error' => 'missing_user_id'], 400);

    $canView = ($authUserId > 0 && $authUserId === (int)$user_id) || $authRoleId === 1;
    if (!$canView && in_array($authRoleId, [2, 6], true)) {
        $authDeptId = app_get_user_department_id($mysqli, $authUserId);
        $targetDeptId = app_get_user_department_id($mysqli, $user_id);
        $canView = $authDeptId !== null && $targetDeptId !== null && $authDeptId === $targetDeptId;
    }
    if (!$canView) {
        json_response(['ok' => false, 'error' => 'forbidden'], 403);
    }

    $row = $fetch_profile_row($user_id);
    if (!$row) json_response(['ok' => false, 'error' => 'user_not_found'], 404);

    json_response([
        'ok' => true,
        'user' => $build_profile_payload($row),
    ]);

} elseif ($request_method === 'POST') {
    if (empty($_POST['user_id'])) json_response(['ok' => false, 'error' => 'missing_user_id'], 400);
    $user_id = (int)$_POST['user_id'];
    if ($user_id <= 0) json_response(['ok' => false, 'error' => 'invalid_user_id'], 400);

    $postFields = [];
    foreach ($_POST as $key => $value) {
        if ($key !== 'user_id') $postFields[] = $key;
    }
    $hasAvatarUpload = !empty($_FILES) && !empty($_FILES['avatar']) && $_FILES['avatar']['error'] !== UPLOAD_ERR_NO_FILE;
    $canUpdateAll = $authRoleId === 1;
    $canUpdateOwnContact = $authUserId > 0 && $authUserId === $user_id && !$hasAvatarUpload && count($postFields) > 0;
    foreach ($postFields as $fieldName) {
        if ($fieldName !== 'contact_no') {
            $canUpdateOwnContact = false;
            break;
        }
    }

    if (!$canUpdateAll && !$canUpdateOwnContact) {
        json_response(['ok' => false, 'error' => 'forbidden'], 403);
    }

    $currentUser = $fetch_profile_row($user_id);
    if (!$currentUser) json_response(['ok' => false, 'error' => 'user_not_found'], 404);

    $fields = [];
    $types = '';
    $values = [];

    if (array_key_exists('first_name', $_POST)) {
        $firstName = trim((string)$_POST['first_name']);
        if ($firstName === '') json_response(['ok' => false, 'error' => 'invalid_first_name'], 400);
        $fields[] = 'first_name = ?';
        $types .= 's';
        $values[] = $firstName;
    }

    if (array_key_exists('last_name', $_POST)) {
        $lastName = trim((string)$_POST['last_name']);
        if ($lastName === '') json_response(['ok' => false, 'error' => 'invalid_last_name'], 400);
        $fields[] = 'last_name = ?';
        $types .= 's';
        $values[] = $lastName;
    }

    if (array_key_exists('email', $_POST)) {
        $email = strtolower(trim((string)$_POST['email']));
        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            json_response(['ok' => false, 'error' => 'invalid_email'], 400);
        }

        $dupStmt = $mysqli->prepare("SELECT user_id FROM tbl_users WHERE LOWER(email) = LOWER(?) AND user_id <> ? LIMIT 1");
        if (!$dupStmt) json_response(['ok' => false, 'error' => 'db_prepare_failed', 'details' => $mysqli->error], 500);
        $dupStmt->bind_param('si', $email, $user_id);
        $dupStmt->execute();
        $dupUser = $dupStmt->get_result()->fetch_assoc();
        $dupStmt->close();
        if ($dupUser) json_response(['ok' => false, 'error' => 'email_in_use'], 409);

        $fields[] = 'email = ?';
        $types .= 's';
        $values[] = $email;
    }

    if (array_key_exists('contact_no', $_POST)) {
        $contactNo = trim((string)$_POST['contact_no']);
        if ($contactNo === '') {
            $fields[] = 'contact_no = NULL';
        } else {
            if (!$canUpdateAll && !preg_match('/^09\d{9}$/', $contactNo)) {
                json_response(['ok' => false, 'error' => 'invalid_contact_no'], 400);
            }
            if (!preg_match('/^[0-9+\-\s()]{7,25}$/', $contactNo)) {
                json_response(['ok' => false, 'error' => 'invalid_contact_no'], 400);
            }
            $fields[] = 'contact_no = ?';
            $types .= 's';
            $values[] = $contactNo;
        }
    }

    if (!empty($_FILES) && !empty($_FILES['avatar']) && $_FILES['avatar']['error'] !== UPLOAD_ERR_NO_FILE) {
        if ($_FILES['avatar']['error'] !== UPLOAD_ERR_OK) {
            json_response(['ok' => false, 'error' => 'avatar_upload_error'], 400);
        }

        $file = $_FILES['avatar'];
        $maxUploadBytes = 4000000;
        if ($file['size'] > $maxUploadBytes) json_response(['ok' => false, 'error' => 'file_too_large'], 400);

        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $mime = finfo_file($finfo, $file['tmp_name']);
        finfo_close($finfo);
        $allowed = ['image/jpeg', 'image/png', 'image/webp'];
        if (!in_array($mime, $allowed, true)) {
            json_response(['ok' => false, 'error' => 'unsupported_mime', 'allowed' => $allowed], 400);
        }

        $img = null;
        if ($mime === 'image/jpeg') $img = @imagecreatefromjpeg($file['tmp_name']);
        elseif ($mime === 'image/png') $img = @imagecreatefrompng($file['tmp_name']);
        elseif ($mime === 'image/webp') $img = @imagecreatefromwebp($file['tmp_name']);

        if ($img === false || $img === null) {
            $data = file_get_contents($file['tmp_name']);
            if ($data === false) json_response(['ok' => false, 'error' => 'failed_read_file'], 500);
            $b64 = base64_encode($data);
            $dataUrl = 'data:' . $mime . ';base64,' . $b64;
        } else {
            $maxDim = 800;
            $w = imagesx($img);
            $h = imagesy($img);
            $scale = min(1, $maxDim / max($w, $h));
            $nw = (int)max(1, floor($w * $scale));
            $nh = (int)max(1, floor($h * $scale));
            $tmp = imagecreatetruecolor($nw, $nh);
            if ($mime === 'image/png' || $mime === 'image/webp') {
                imagealphablending($tmp, false);
                imagesavealpha($tmp, true);
                $transparent = imagecolorallocatealpha($tmp, 0, 0, 0, 127);
                imagefilledrectangle($tmp, 0, 0, $nw, $nh, $transparent);
            }
            imagecopyresampled($tmp, $img, 0, 0, 0, 0, $nw, $nh, $w, $h);

            ob_start();
            if ($mime === 'image/png') {
                imagepng($tmp, null, 6);
            } elseif ($mime === 'image/webp') {
                imagewebp($tmp, null, 80);
            } else {
                imagejpeg($tmp, null, 80);
            }
            $outData = ob_get_clean();
            imagedestroy($tmp);
            imagedestroy($img);
            if ($outData === false) json_response(['ok' => false, 'error' => 'image_processing_failed'], 500);
            $b64 = base64_encode($outData);
            $dataUrl = 'data:' . $mime . ';base64,' . $b64;
        }

        $fields[] = 'image = ?';
        $types .= 's';
        $values[] = $dataUrl;
    }

    if (empty($fields)) {
        json_response(['ok' => false, 'error' => 'nothing_to_update'], 400);
    }

    try {
        $values[] = $user_id;
        $types .= 'i';
        $sql = 'UPDATE tbl_users SET ' . implode(', ', $fields) . ' WHERE user_id = ?';
        $stmt = $mysqli->prepare($sql);
        if (!$stmt) json_response(['ok' => false, 'error' => 'db_prepare_failed', 'details' => $mysqli->error], 500);
        $stmt->bind_param($types, ...$values);
        if (!$stmt->execute()) {
            json_response(['ok' => false, 'error' => 'db_execute_failed', 'details' => $stmt->error], 500);
        }
        $stmt->close();
    } catch (mysqli_sql_exception $mse) {
        json_response(['ok' => false, 'error' => 'db_packet_too_large', 'message' => 'Image too large for database packet. Resize image or increase MySQL max_allowed_packet.'], 500);
    }

    $row = $fetch_profile_row($user_id);
    if (!$row) json_response(['ok' => false, 'error' => 'user_not_found'], 404);

    json_response([
        'ok' => true,
        'message' => 'profile_updated',
        'user' => $build_profile_payload($row),
    ]);

} else {
    json_response(['ok' => false, 'error' => 'method_not_allowed'], 405);
}
