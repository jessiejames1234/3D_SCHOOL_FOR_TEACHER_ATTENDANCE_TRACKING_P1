<?php
declare(strict_types=1);

/**
 * Development-only router for:
 *   php -S localhost:8070 dev-router.php
 *
 * PHP's built-in server does not read .htaccess. Route browser API requests
 * through the existing front controller and only serve known public assets.
 * Keep the forwarded port private; this is not a production web server.
 */

// If this development file is accidentally uploaded to Apache hosting, it
// must not become another public entry point.
if (PHP_SAPI !== 'cli-server') {
    http_response_code(404);
    exit;
}

function devRouterReject(int $status, string $message): never
{
    http_response_code($status);
    header('Content-Type: text/plain; charset=UTF-8');
    echo $message;
    exit;
}

$requestPath = parse_url((string)($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
if (!is_string($requestPath) || $requestPath === '' || $requestPath[0] !== '/') {
    devRouterReject(400, 'Bad Request');
}

// Reject encoded separators and non-canonical paths before filesystem access.
if (preg_match('/%(?:00|2f|5c)/i', $requestPath)) {
    devRouterReject(400, 'Bad Request');
}
$requestPath = rawurldecode($requestPath);
if (preg_match('/[\x00-\x1f\\\\:]/', $requestPath) || str_contains($requestPath, '//')) {
    devRouterReject(400, 'Bad Request');
}
foreach (explode('/', trim($requestPath, '/')) as $segment) {
    if ($segment !== '' && str_starts_with($segment, '.')) {
        devRouterReject(403, 'Forbidden');
    }
}

$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$pagePaths = ['/', '/index.php', '/public', '/public/', '/public/index.html'];
if (in_array($requestPath, $pagePaths, true)) {
    if ($method !== 'GET' && $method !== 'HEAD') {
        header('Allow: GET, HEAD');
        devRouterReject(405, 'Method Not Allowed');
    }
    $_SERVER['SCRIPT_NAME'] = '/index.php';
    $_SERVER['PHP_SELF'] = '/index.php';
    $_SERVER['SCRIPT_FILENAME'] = __DIR__ . '/index.php';
    require __DIR__ . '/index.php';
    return true;
}

if ($requestPath === '/api' || str_starts_with($requestPath, '/api/')) {
    $apiSubpath = ltrim(substr($requestPath, 4), '/');
    $firstApiSegment = strtolower(explode('/', $apiSubpath, 2)[0]);
    if (in_array($firstApiSegment, [
        'api', 'cache', 'config', 'helpers', 'logs', 'migrations',
        'scripts', 'templates', 'uploads', 'vendor',
    ], true)) {
        devRouterReject(403, 'Forbidden');
    }
    $_SERVER['SCRIPT_NAME'] = '/api/index.php';
    $_SERVER['PHP_SELF'] = '/api/index.php';
    $_SERVER['SCRIPT_FILENAME'] = __DIR__ . '/api/index.php';
    require __DIR__ . '/api/index.php';
    return true;
}

if ($method !== 'GET' && $method !== 'HEAD') {
    header('Allow: GET, HEAD');
    devRouterReject(405, 'Method Not Allowed');
}

$staticRoot = str_starts_with($requestPath, '/public/') ? 'public'
    : (str_starts_with($requestPath, '/src/') ? 'src' : null);
if ($staticRoot === null) {
    devRouterReject(403, 'Forbidden');
}

$extension = strtolower(pathinfo($requestPath, PATHINFO_EXTENSION));
$allowedExtensions = [
    'js', 'jsx', 'css', 'json', 'webmanifest', 'map', 'wasm',
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico',
    'woff', 'woff2', 'ttf', 'otf', 'eot',
    'glb', 'gltf', 'bin', 'obj', 'fbx', 'stl', 'pdf', 'txt',
];
if (!in_array($extension, $allowedExtensions, true)) {
    devRouterReject(403, 'Forbidden');
}

// Uploaded files are data, not executable frontend code.
if (str_starts_with($requestPath, '/public/uploads/')
    && !in_array($extension, ['png', 'jpg', 'jpeg', 'gif', 'webp', 'glb', 'gltf', 'bin'], true)) {
    devRouterReject(403, 'Forbidden');
}

$root = realpath(__DIR__ . DIRECTORY_SEPARATOR . $staticRoot);
$file = realpath(__DIR__ . str_replace('/', DIRECTORY_SEPARATOR, $requestPath));
if ($root === false || $file === false || !is_file($file)) {
    devRouterReject(404, 'Not Found');
}
$rootPrefix = strtolower(str_replace('\\', '/', $root)) . '/';
$filePath = strtolower(str_replace('\\', '/', $file));
if (!str_starts_with($filePath, $rootPrefix)) {
    devRouterReject(403, 'Forbidden');
}

// Let PHP's built-in server transfer approved static files efficiently.
return false;
