<?php
// server-php/api/socket_helper.php

if (!function_exists('trigger_socket_update')) {
    function trigger_socket_update($data) {
        // Allow overriding the socket trigger URL via environment variable for flexibility in different dev setups
        $default = 'http://localhost:8080/trigger-update';
        $env = getenv('SOCKET_SERVER_URL');
        $configUrl = null;
        if (file_exists(__DIR__ . '/../config/security.php')) {
            $cfg = require __DIR__ . '/../config/security.php';
            if (!empty($cfg['socket_server_url'])) $configUrl = $cfg['socket_server_url'];
        }
        $url = $env ?: ($configUrl ?: $default);

        $payload = json_encode($data);
        if ($payload === false) {
            error_log('[socket_helper] json_encode failed: ' . json_last_error_msg());
            return false;
        }

        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_POST, 1);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
        curl_setopt($ch, CURLOPT_HTTPHEADER, array('Content-Type: application/json', 'Content-Length: ' . strlen($payload)));
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);

        // Timeout: keep it short so PHP doesn't hang if Node is down, but slightly higher than 200ms
        curl_setopt($ch, CURLOPT_TIMEOUT_MS, 800);

        $resp = curl_exec($ch);
        if ($resp === false) {
            $err = curl_error($ch);
            error_log('[socket_helper] curl_exec failed when notifying ' . $url . ': ' . $err);
            curl_close($ch);
            return false;
        }
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        if ($code < 200 || $code >= 300) {
            error_log('[socket_helper] unexpected response code ' . $code . ' from ' . $url . ' resp: ' . substr($resp,0,200));
            curl_close($ch);
            return false;
        }
        curl_close($ch);
        return true;
    }
}
?>