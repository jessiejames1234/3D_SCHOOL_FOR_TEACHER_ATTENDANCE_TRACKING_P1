<?php
declare(strict_types=1);

// Serve the public app directly from the project root. This avoids dev-tunnel
// issues where the bare "/" URL does not reliably follow the /public/ redirect.
$publicIndex = __DIR__ . '/public/index.html';
if (!is_file($publicIndex)) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=UTF-8');
    echo 'public/index.html not found';
    exit;
}

$basePath = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '')), '/');
$publicBase = ($basePath === '' ? '' : $basePath) . '/public/';
$baseTag = '<base href="' . htmlspecialchars($publicBase, ENT_QUOTES, 'UTF-8') . '">';

$html = file_get_contents($publicIndex);
if ($html === false) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=UTF-8');
    echo 'Unable to read public/index.html';
    exit;
}

if (stripos($html, '<base ') === false) {
    $withBase = preg_replace('/<head(\s[^>]*)?>/i', '$0' . "\n    " . $baseTag, $html, 1);
    if (is_string($withBase)) {
        $html = $withBase;
    }
}

header('Content-Type: text/html; charset=UTF-8');
echo $html;
