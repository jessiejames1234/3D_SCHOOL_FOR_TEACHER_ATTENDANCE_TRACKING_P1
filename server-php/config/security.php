<?php
// server-php/config/security.php
// Security-related configuration. Keep secrets out of VCS by overriding via environment variables.
$security = [


    'jwt_secret' => getenv('JWT_SECRET') ?: 'your-secret-key',

    'allowed_origins' => [
        'https://pg7tj9bp-80.asse.devtunnels.ms',
        'https://pg7tj9bp-8070.asse.devtunnels.ms',
        'https://pg7tj9bp-8080.asse.devtunnels.ms',
        'https://sjc8x44q-8070.asse.devtunnels.ms',
        'http://localhost:8080',
        'http://localhost:80',
        'http://localhost:8070',
        'http://localhost',
        'http://127.0.0.1:8080',
        'http://127.0.0.1:80',
        'http://127.0.0.1:8070',
        'http://127.0.0.1',
        // Note: origins must not include a path (e.g. '/3D1.2'). Paths are ignored when comparing origins.
    ],

    'allow_dev_tunnel_origins' => getenv('ALLOW_DEV_TUNNEL_ORIGINS') === '0' ? false : true,

    'error_log' => __DIR__ . '/../logs/php-errors.log',

    'socket_server_url' => getenv('SOCKET_SERVER_URL') ?: 'http://localhost:8080/trigger-update',

    // Forgot-password email "From" address (optional). Set for better deliverability to Gmail.
    'mail_from' => getenv('MAIL_FROM') ?: null,

    // Helper: normalize an Origin header to scheme://host[:port] for reliable comparisons
    'normalize_origin' => function ($origin) {
        if (empty($origin)) return '';
        $parts = parse_url(trim($origin));
        if (!$parts || empty($parts['scheme']) || empty($parts['host'])) return '';
        $base = $parts['scheme'] . '://' . $parts['host'];
        if (!empty($parts['port'])) $base .= ':' . $parts['port'];
        return $base;
    },
];

$logDir = __DIR__ . '/../logs';
if (!is_dir($logDir)) @mkdir($logDir, 0755, true);

return $security;
