<?php
// Signed, cacheable 96px avatar thumbnails for lightweight 3D markers.

if (!isset($GLOBALS['mysqli']) || $GLOBALS['mysqli'] === null) {
    require_once __DIR__ . '/../config/database.php';
}
global $mysqli;

$userId = isset($_GET['user_id']) ? (int)$_GET['user_id'] : 0;
$expires = isset($_GET['expires']) ? (int)$_GET['expires'] : 0;
$signature = strtolower(trim((string)($_GET['signature'] ?? '')));
$security = file_exists(__DIR__ . '/../config/security.php')
    ? require __DIR__ . '/../config/security.php'
    : [];
$secret = (string)($security['jwt_secret'] ?? 'your-secret-key');
$expected = hash_hmac('sha256', $userId . '|' . $expires . '|avatar-thumbnail', $secret);

if ($userId <= 0 || $expires < time() || $signature === '' || !hash_equals($expected, $signature)) {
    http_response_code(403);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'invalid_or_expired_thumbnail_signature']);
    exit;
}

$stmt = $mysqli->prepare('SELECT first_name, last_name, image FROM tbl_users WHERE user_id = ? LIMIT 1');
if (!$stmt) {
    http_response_code(500);
    exit;
}
$stmt->bind_param('i', $userId);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();
$stmt->close();
if (!$row) {
    http_response_code(404);
    exit;
}

$raw = (string)($row['image'] ?? '');
$binary = $raw;
if (preg_match('/^data:image\/[a-z0-9.+-]+;base64,(.*)$/is', $raw, $match)) {
    $decoded = base64_decode($match[1], true);
    $binary = $decoded === false ? '' : $decoded;
}
$sourceHash = sha1($binary !== '' ? $binary : ($userId . '|fallback|' . ($row['first_name'] ?? '') . '|' . ($row['last_name'] ?? '')));
$etag = '"avatar-' . $sourceHash . '-96"';
header('ETag: ' . $etag);
header('Cache-Control: private, max-age=300, stale-while-revalidate=600');
if (trim((string)($_SERVER['HTTP_IF_NONE_MATCH'] ?? '')) === $etag) {
    http_response_code(304);
    exit;
}

$cacheDir = __DIR__ . '/../cache/avatar-thumbnails';
$cacheFile = $cacheDir . '/' . $userId . '-' . $sourceHash . '.webp';
if (is_file($cacheFile)) {
    header('Content-Type: image/webp');
    header('Content-Length: ' . filesize($cacheFile));
    readfile($cacheFile);
    exit;
}

$source = $binary !== '' ? @imagecreatefromstring($binary) : false;
$size = 96;
$thumb = imagecreatetruecolor($size, $size);
imagealphablending($thumb, true);
imagesavealpha($thumb, true);
$background = imagecolorallocate($thumb, 226, 232, 240);
imagefilledrectangle($thumb, 0, 0, $size, $size, $background);

if ($source !== false) {
    $width = imagesx($source);
    $height = imagesy($source);
    $side = max(1, min($width, $height));
    $srcX = (int)floor(($width - $side) / 2);
    $srcY = (int)floor(($height - $side) / 2);
    imagecopyresampled($thumb, $source, 0, 0, $srcX, $srcY, $size, $size, $side, $side);
    imagedestroy($source);
} else {
    $textColor = imagecolorallocate($thumb, 71, 85, 105);
    $initials = strtoupper(substr((string)($row['first_name'] ?? 'T'), 0, 1) . substr((string)($row['last_name'] ?? ''), 0, 1));
    imagestring($thumb, 5, 38, 40, $initials !== '' ? $initials : 'T', $textColor);
}

if (!is_dir($cacheDir)) {
    @mkdir($cacheDir, 0775, true);
}
ob_start();
imagewebp($thumb, null, 78);
$output = ob_get_clean();
imagedestroy($thumb);
if (!is_string($output) || $output === '') {
    http_response_code(500);
    exit;
}
if (is_dir($cacheDir) && is_writable($cacheDir)) {
    @file_put_contents($cacheFile, $output, LOCK_EX);
}
header('Content-Type: image/webp');
header('Content-Length: ' . strlen($output));
echo $output;

