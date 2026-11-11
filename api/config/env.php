<?php
// Load the project .env for web requests and CLI workers without dependencies.
// Existing server/terminal variables always take priority, even when empty.
function app_load_env($path = null) {
    static $loaded = [];
    $path = $path ?? dirname(__DIR__, 2) . '/.env';
    if (isset($loaded[$path]) || !is_file($path)) return;
    $lines = file($path, FILE_IGNORE_NEW_LINES);
    if ($lines === false) throw new RuntimeException('Unable to read environment configuration.');
    $values = [];
    foreach ($lines as $index => $line) {
        $line = trim($index === 0 ? preg_replace('/^\xEF\xBB\xBF/', '', $line) : $line);
        if ($line === '' || $line[0] === '#') continue;
        if (!preg_match('/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/', $line, $match)) {
            throw new RuntimeException('Invalid environment configuration at line ' . ($index + 1));
        }
        $value = trim($match[2]);
        if ($value !== '' && $value[0] === '"') {
            // Double-quoted values use JSON escaping; no variable interpolation.
            $value = json_decode($value, true);
            if (!is_string($value)) throw new RuntimeException('Invalid quoted environment value at line ' . ($index + 1));
        } elseif ($value !== '' && $value[0] === "'") {
            if (substr($value, -1) !== "'") throw new RuntimeException('Invalid quoted environment value at line ' . ($index + 1));
            $value = substr($value, 1, -1);
        } else {
            $value = trim(preg_replace('/\s+#.*$/', '', $value));
        }
        $values[$match[1]] = $value;
    }
    foreach ($values as $name => $value) {
        if (getenv($name) !== false) {
            $GLOBALS['app_env_sources'][$name] = 'server/terminal';
            continue;
        }
        putenv($name . '=' . $value);
        $_ENV[$name] = $value;
        $GLOBALS['app_env_sources'][$name] = '.env';
    }
    $loaded[$path] = true;
}

// Temporary, value-free diagnostics. Delete the marker to disable logging.
function app_env_diagnostic_sources($channel) {
    $groups = [
        'email' => ['MAIL_DRIVER', 'MAIL_SMTP_AUTH', 'MAIL_SMTP_TIMEOUT', 'MAIL_SMTP_HOST', 'MAIL_SMTP_PORT', 'MAIL_SMTP_SECURE', 'MAIL_SMTP_USER', 'MAIL_SMTP_PASS', 'MAIL_FROM_EMAIL', 'MAIL_FROM_NAME'],
        'web_push' => ['VAPID_SUBJECT', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'],
        'database' => ['DB_HOST', 'DB_USER', 'DB_PASS', 'DB_NAME'],
    ];
    $sources = [];
    foreach ($groups[$channel] ?? [] as $name) {
        $value = getenv($name);
        // Database values (including an empty password) and smtp_auth use !== false.
        $hasValue = $channel === 'database' || $name === 'MAIL_SMTP_AUTH'
            ? $value !== false : (bool)$value;
        $sources[$name] = $hasValue
            ? ($GLOBALS['app_env_sources'][$name] ?? 'server/terminal')
            : 'PHP fallback';
    }
    return $sources;
}

function app_log_env_diagnostic($channel) {
    if (!is_file(dirname(__DIR__, 2) . '/.env.diagnostics')) return;
    error_log('[env-source][' . $channel . '] ' . json_encode([
        'env_file_present' => is_file(dirname(__DIR__, 2) . '/.env'),
        'settings' => app_env_diagnostic_sources($channel),
    ], JSON_UNESCAPED_SLASHES));
}

app_load_env();
