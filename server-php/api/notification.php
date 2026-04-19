<?php
// server-php/api/notification.php
require_once __DIR__ . '/../helpers/notification_helper.php';

use Firebase\JWT\JWT;
use Firebase\JWT\Key;

global $mysqli;

$request_method = $_SERVER['REQUEST_METHOD'];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$parts = explode('/', $path);
$api_prefix_key = array_search('api', $parts);
$endpoint = $parts[$api_prefix_key + 1] ?? null;
$param1 = $parts[$api_prefix_key + 2] ?? null;

if (!in_array($endpoint, ['notification', 'notifications'], true)) {
    json_response(['error' => 'endpoint_not_found'], 404);
}

if (!notif_table_exists($mysqli)) {
    json_response(['error' => 'notifications_table_missing'], 500);
}

function notif_api_get_auth_header() {
    $authHeader = null;
    $candidates = ['HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION', 'HTTP_X_AUTHORIZATION', 'HTTP_X_API_TOKEN', 'HTTP_AUTH', 'AUTHORIZATION'];
    foreach ($candidates as $k) {
        if (!empty($_SERVER[$k])) { $authHeader = $_SERVER[$k]; break; }
    }
    if (empty($authHeader) && function_exists('apache_request_headers')) {
        $headers = apache_request_headers();
        foreach (['Authorization', 'authorization', 'AUTHORIZATION'] as $h) {
            if (!empty($headers[$h])) { $authHeader = $headers[$h]; break; }
        }
    }
    $queryToken = $_GET['token'] ?? null;
    if (empty($authHeader) && !empty($queryToken)) $authHeader = 'Bearer ' . $queryToken;
    return $authHeader;
}

function notif_api_auth_user_id() {
    $authHeader = notif_api_get_auth_header();
    if (empty($authHeader)) json_response(['error' => 'missing_authorization'], 401);
    if (!preg_match('/Bearer\s+(\S+)/i', $authHeader, $m)) {
        json_response(['error' => 'invalid_authorization_format'], 401);
    }
    $token = $m[1];
    $sec = [];
    if (file_exists(__DIR__ . '/../config/security.php')) $sec = require __DIR__ . '/../config/security.php';
    $secret_key = $sec['jwt_secret'] ?? 'your-secret-key';
    try {
        $decoded = JWT::decode($token, new Key($secret_key, 'HS256'));
    } catch (Throwable $e) {
        json_response(['error' => 'invalid_token', 'message' => $e->getMessage()], 401);
    }
    $authUserId = isset($decoded->user_id) ? (int)$decoded->user_id : null;
    if (!$authUserId) json_response(['error' => 'invalid_token_payload'], 401);
    return $authUserId;
}

function notif_api_extract_actor_user_id($link) {
    $raw = trim((string)$link);
    if ($raw === '') return null;
    $query = parse_url($raw, PHP_URL_QUERY);
    if (!$query) return null;
    parse_str($query, $q);
    if (!isset($q['actor'])) return null;
    $id = (int)$q['actor'];
    return $id > 0 ? $id : null;
}

function notif_api_strip_actor_from_link($link) {
    $raw = trim((string)$link);
    if ($raw === '') return $raw;
    $parts = parse_url($raw);
    if ($parts === false) return $raw;
    $path = $parts['path'] ?? '';
    $query = [];
    if (!empty($parts['query'])) parse_str($parts['query'], $query);
    unset($query['actor']);
    $new = $path;
    $newQuery = http_build_query($query);
    if ($newQuery !== '') $new .= '?' . $newQuery;
    if (!empty($parts['fragment'])) $new .= '#' . $parts['fragment'];
    return $new !== '' ? $new : $raw;
}

function notif_api_avatar_from_db($raw) {
    if ($raw === null || $raw === '') return null;
    $img = (string)$raw;
    if (strpos($img, 'data:') === 0) return $img;
    return 'data:image/png;base64,' . $img;
}

function notif_api_bind_dynamic($stmt, $types, &$params) {
    $refs = [];
    $refs[] = &$types;
    foreach ($params as $k => $v) $refs[] = &$params[$k];
    return call_user_func_array([$stmt, 'bind_param'], $refs);
}

$authUserId = notif_api_auth_user_id();

if ($request_method === 'GET') {
    $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 20;
    if ($limit <= 0) $limit = 20;
    if ($limit > 100) $limit = 100;
    $onlyUnread = isset($_GET['unread']) && in_array(strtolower((string)$_GET['unread']), ['1', 'true', 'yes'], true);

    $sql = "SELECT notif_id, user_id, title, message, link, is_read, created_at
            FROM tbl_notifications
            WHERE user_id = ?";
    $types = 'i';
    $params = [$authUserId];
    if ($onlyUnread) {
        $sql .= " AND is_read = 0";
    }
    $sql .= " ORDER BY created_at DESC, notif_id DESC LIMIT ?";
    $types .= 'i';
    $params[] = $limit;

    $stmt = $mysqli->prepare($sql);
    if (!$stmt) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
    $stmt->bind_param($types, $params[0], $params[1]);
    if (!$stmt->execute()) json_response(['error' => 'execute_failed', 'message' => $stmt->error], 500);
    $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

    // Enrich notifications with actor details (name + avatar), if actor is encoded in link query.
    $actorIds = [];
    foreach ($rows as $idx => $row) {
        $actorId = notif_api_extract_actor_user_id($row['link'] ?? '');
        $rows[$idx]['actor_user_id'] = $actorId;
        $rows[$idx]['link'] = notif_api_strip_actor_from_link($row['link'] ?? '');
        if ($actorId !== null) $actorIds[$actorId] = true;
    }

    $actorMap = [];
    if (!empty($actorIds)) {
        $ids = array_keys($actorIds);
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $aSql = "SELECT user_id, first_name, last_name, image FROM tbl_users WHERE user_id IN ($placeholders)";
        $aStmt = $mysqli->prepare($aSql);
        if ($aStmt) {
            $aTypes = str_repeat('i', count($ids));
            $aParams = $ids;
            notif_api_bind_dynamic($aStmt, $aTypes, $aParams);
            if ($aStmt->execute()) {
                $aRes = $aStmt->get_result();
                while ($aRow = $aRes->fetch_assoc()) {
                    $uid = (int)$aRow['user_id'];
                    $fullName = trim((string)($aRow['first_name'] ?? '') . ' ' . (string)($aRow['last_name'] ?? ''));
                    $actorMap[$uid] = [
                        'name' => $fullName !== '' ? $fullName : 'System',
                        'avatar' => notif_api_avatar_from_db($aRow['image'] ?? null),
                    ];
                }
            }
            $aStmt->close();
        }
    }

    foreach ($rows as $idx => $row) {
        $actorId = isset($row['actor_user_id']) ? (int)$row['actor_user_id'] : 0;
        if ($actorId > 0 && isset($actorMap[$actorId])) {
            $rows[$idx]['actor_name'] = $actorMap[$actorId]['name'];
            $rows[$idx]['actor_avatar'] = $actorMap[$actorId]['avatar'];
        } else {
            $rows[$idx]['actor_name'] = null;
            $rows[$idx]['actor_avatar'] = null;
        }
    }

    $countStmt = $mysqli->prepare("SELECT COUNT(*) AS unread_count FROM tbl_notifications WHERE user_id = ? AND is_read = 0");
    $count = 0;
    if ($countStmt) {
        $countStmt->bind_param('i', $authUserId);
        if ($countStmt->execute()) {
            $cRow = $countStmt->get_result()->fetch_assoc();
            $count = isset($cRow['unread_count']) ? (int)$cRow['unread_count'] : 0;
        }
        $countStmt->close();
    }

    json_response([
        'notifications' => $rows ?: [],
        'unread_count' => $count,
    ]);
}

if ($request_method === 'PUT' || $request_method === 'POST') {
    if ($param1 === 'read-all') {
        $stmt = $mysqli->prepare("UPDATE tbl_notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0");
        if (!$stmt) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
        $stmt->bind_param('i', $authUserId);
        if (!$stmt->execute()) json_response(['error' => 'update_failed', 'message' => $stmt->error], 500);
        json_response(['ok' => true, 'updated' => (int)$stmt->affected_rows]);
    }

    if (!is_numeric($param1)) {
        json_response(['error' => 'missing_notif_id'], 400);
    }
    $notifId = (int)$param1;
    if ($notifId <= 0) json_response(['error' => 'invalid_notif_id'], 400);

    $stmt = $mysqli->prepare("UPDATE tbl_notifications SET is_read = 1 WHERE notif_id = ? AND user_id = ?");
    if (!$stmt) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
    $stmt->bind_param('ii', $notifId, $authUserId);
    if (!$stmt->execute()) json_response(['error' => 'update_failed', 'message' => $stmt->error], 500);

    $sel = $mysqli->prepare("SELECT notif_id, user_id, title, message, link, is_read, created_at FROM tbl_notifications WHERE notif_id = ? AND user_id = ? LIMIT 1");
    $row = null;
    if ($sel) {
        $sel->bind_param('ii', $notifId, $authUserId);
        if ($sel->execute()) {
            $row = $sel->get_result()->fetch_assoc();
        }
        $sel->close();
    }

    json_response(['ok' => true, 'notification' => $row]);
}

if ($request_method === 'DELETE') {
    if ($param1 === 'clear-read') {
        $stmt = $mysqli->prepare("DELETE FROM tbl_notifications WHERE user_id = ? AND is_read = 1");
        if (!$stmt) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
        $stmt->bind_param('i', $authUserId);
        if (!$stmt->execute()) json_response(['error' => 'delete_failed', 'message' => $stmt->error], 500);
        json_response(['ok' => true, 'deleted' => (int)$stmt->affected_rows]);
    }

    if ($param1 === 'clear-all') {
        $stmt = $mysqli->prepare("DELETE FROM tbl_notifications WHERE user_id = ?");
        if (!$stmt) json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
        $stmt->bind_param('i', $authUserId);
        if (!$stmt->execute()) json_response(['error' => 'delete_failed', 'message' => $stmt->error], 500);
        json_response(['ok' => true, 'deleted' => (int)$stmt->affected_rows]);
    }

    json_response(['error' => 'invalid_delete_action'], 400);
}

json_response(['error' => 'method_not_allowed'], 405);
