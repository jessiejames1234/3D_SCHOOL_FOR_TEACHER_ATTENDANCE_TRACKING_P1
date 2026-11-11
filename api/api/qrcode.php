<?php
// api/api/qrcode.php
// Generate a QR PNG on the server.

use Endroid\QrCode\Builder\Builder;
use Endroid\QrCode\ErrorCorrectionLevel;

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

if (empty($_GET['data'])) {
    header('Content-Type: application/json');
    http_response_code(400);
    echo json_encode(['error' => 'missing_data']);
    exit;
}

$data = (string) $_GET['data'];
$size = isset($_GET['size']) ? (int)$_GET['size'] : 240;
$margin = isset($_GET['margin']) ? (int)$_GET['margin'] : 0;
$size = max(64, min(1024, $size));
$margin = max(0, min(20, $margin));

if (!file_exists(__DIR__ . '/../vendor/autoload.php')) {
    header('Content-Type: application/json');
    http_response_code(500);
    echo json_encode([
        'error' => 'qr_generation_unavailable',
        'message' => 'QR dependencies are missing. Run composer install in api.',
    ]);
    exit;
}
require_once __DIR__ . '/../vendor/autoload.php';

try {
    // The v5 builder supports local PNG generation on PHP 8.1 and newer.
    $result = Builder::create()
        ->data($data)
        ->errorCorrectionLevel(ErrorCorrectionLevel::High)
        ->size($size)
        ->margin($margin)
        ->build();

    // Output PNG
    header('Content-Type: image/png');
    header('Cache-Control: private, max-age=86400');
    echo $result->getString();
    exit;
} catch (Throwable $e) {
    error_log('[qrcode] Generation failed: ' . $e->getMessage());
    header('Content-Type: application/json');
    http_response_code(500);
    echo json_encode(['error' => 'qr_generation_failed', 'message' => $e->getMessage()]);
    exit;
}
