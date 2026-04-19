<?php
// server-php/helpers/mail_helper.php
// Sends OTP email via SMTP (pure PHP, no Composer/PHPMailer needed).

/**
 * Send forgot-password OTP email.
 * Uses SMTP when configured in config/mail.php (smtp_user + smtp_pass), else PHP mail().
 *
 * @param string $to Recipient email
 * @param string $firstName User first name
 * @param string $lastName User last name
 * @param string $otp 6-digit OTP
 * @return bool True if mail was accepted for delivery
 */
function send_forgot_password_email($to, $firstName, $lastName, $otp) {
    $templatePath = __DIR__ . '/../templates/forgot_password_email.php';
    if (!is_file($templatePath)) {
        error_log('[mail_helper] Template not found: ' . $templatePath);
        return false;
    }
    ob_start();
    include $templatePath;
    $htmlBody = ob_get_clean();
    if ($htmlBody === false || $htmlBody === '') {
        return false;
    }

    $subject = 'Forget Password !!!';
    $from = 'noreply@' . ($_SERVER['SERVER_NAME'] ?? 'localhost');
    if (is_file(__DIR__ . '/../config/security.php')) {
        $sec = require __DIR__ . '/../config/security.php';
        if (!empty($sec['mail_from'])) $from = $sec['mail_from'];
    }
    if (function_exists('getenv') && getenv('MAIL_FROM')) {
        $from = getenv('MAIL_FROM');
    }

    $mailConfigPath = __DIR__ . '/../config/mail.php';
    if (is_file($mailConfigPath)) {
        $mailConfig = require $mailConfigPath;
        $useSmtp = (!empty($mailConfig['smtp_host']) && !empty($mailConfig['smtp_user']) && (string)$mailConfig['smtp_pass'] !== '');
        if ($useSmtp) {
            return send_via_smtp_socket($to, $from, $subject, $htmlBody, $mailConfig);
        }
    }

    $headers = [
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=UTF-8',
        'From: ' . $from,
        'X-Mailer: PHP/' . PHP_VERSION,
    ];
    return @mail($to, $subject, $htmlBody, implode("\r\n", $headers));
}

/**
 * Send account-created email to newly created users.
 *
 * @param string $to Recipient email
 * @param string $firstName User first name
 * @param string $lastName User last name
 * @param string $username Login username display (e.g., "ID or email")
 * @return bool True if mail was accepted for delivery
 */
function send_new_account_email($to, $firstName, $lastName, $username) {
    $templatePath = __DIR__ . '/../templates/new_account_email.php';
    if (!is_file($templatePath)) {
        error_log('[mail_helper] Template not found: ' . $templatePath);
        return false;
    }
    ob_start();
    include $templatePath;
    $htmlBody = ob_get_clean();
    if ($htmlBody === false || $htmlBody === '') {
        return false;
    }

    $subject = 'Account Successfully Created';
    $from = 'noreply@' . ($_SERVER['SERVER_NAME'] ?? 'localhost');
    if (is_file(__DIR__ . '/../config/security.php')) {
        $sec = require __DIR__ . '/../config/security.php';
        if (!empty($sec['mail_from'])) $from = $sec['mail_from'];
    }
    if (function_exists('getenv') && getenv('MAIL_FROM')) {
        $from = getenv('MAIL_FROM');
    }

    $mailConfigPath = __DIR__ . '/../config/mail.php';
    if (is_file($mailConfigPath)) {
        $mailConfig = require $mailConfigPath;
        $useSmtp = (!empty($mailConfig['smtp_host']) && !empty($mailConfig['smtp_user']) && (string)$mailConfig['smtp_pass'] !== '');
        if ($useSmtp) {
            return send_via_smtp_socket($to, $from, $subject, $htmlBody, $mailConfig);
        }
    }

    $headers = [
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=UTF-8',
        'From: ' . $from,
        'X-Mailer: PHP/' . PHP_VERSION,
    ];
    return @mail($to, $subject, $htmlBody, implode("\r\n", $headers));
}

/**
 * Send email via SMTP using only PHP sockets (no PHPMailer).
 * Works with Gmail (smtp.gmail.com:587, STARTTLS).
 */
function send_via_smtp_socket($to, $fromFallback, $subject, $htmlBody, $mailConfig) {
    $host = $mailConfig['smtp_host'];
    $port = (int)($mailConfig['smtp_port'] ?? 587);
    $user = $mailConfig['smtp_user'];
    $pass = (string)$mailConfig['smtp_pass'];
    $secure = isset($mailConfig['smtp_secure']) && strtolower($mailConfig['smtp_secure']) === 'ssl';
    $fromEmail = $mailConfig['from_email'] ?? $mailConfig['smtp_user'] ?? $fromFallback;
    $fromName = $mailConfig['from_name'] ?? 'Teacher Attendance';

    $fromHeader = $fromName ? "=?UTF-8?B?" . base64_encode($fromName) . "?= <$fromEmail>" : "<$fromEmail>";
    $subjectEnc = "=?UTF-8?B?" . base64_encode($subject) . "?=";
    $message = "Date: " . date('r') . "\r\n"
        . "From: $fromHeader\r\n"
        . "To: <$to>\r\n"
        . "Subject: $subjectEnc\r\n"
        . "MIME-Version: 1.0\r\n"
        . "Content-Type: text/html; charset=UTF-8\r\n"
        . "Content-Transfer-Encoding: base64\r\n"
        . "\r\n"
        . chunk_split(base64_encode($htmlBody));

    $errNo = 0;
    $errStr = '';
    $context = stream_context_create();
    $sock = @stream_socket_client(
        "tcp://$host:$port",
        $errNo,
        $errStr,
        15,
        STREAM_CLIENT_CONNECT,
        $context
    );
    if (!$sock) {
        if (function_exists('error_log')) {
            error_log("[mail_helper] SMTP connect failed: $errStr ($errNo)");
        }
        return false;
    }

    $getLine = function () use ($sock) {
        $line = @fgets($sock);
        return $line !== false ? trim($line) : false;
    };
    $send = function ($cmd) use ($sock) {
        return @fwrite($sock, $cmd . "\r\n") !== false;
    };
    // Read until a line starting with code (handles multi-line SMTP replies)
    $expect = function ($code) use ($getLine, $sock) {
        $code = (string)$code;
        do {
            $line = $getLine();
            if ($line === false) return false;
        } while (strlen($line) >= 4 && $line[3] === '-' && strpos($line, $code) === 0);
        return strpos($line, $code) === 0;
    };

    if (!$expect(220)) { @fclose($sock); return false; }
    if (!$send("EHLO " . ($_SERVER['SERVER_NAME'] ?? 'localhost'))) { @fclose($sock); return false; }
    if (!$expect(250)) { @fclose($sock); return false; }

    if ($port === 587 && !$secure) {
        if (!$send("STARTTLS")) { @fclose($sock); return false; }
        if (!$expect(220)) { @fclose($sock); return false; }
        $crypto = @stream_socket_enable_crypto($sock, true, STREAM_CRYPTO_METHOD_TLS_CLIENT);
        if (!$crypto) {
            if (function_exists('error_log')) error_log('[mail_helper] STARTTLS failed');
            @fclose($sock);
            return false;
        }
        if (!$send("EHLO " . ($_SERVER['SERVER_NAME'] ?? 'localhost'))) { @fclose($sock); return false; }
        if (!$expect(250)) { @fclose($sock); return false; }
    }

    if (!$send("AUTH LOGIN")) { @fclose($sock); return false; }
    if (!$expect(334)) { @fclose($sock); return false; }
    if (!$send(base64_encode($user))) { @fclose($sock); return false; }
    if (!$expect(334)) { @fclose($sock); return false; }
    if (!$send(base64_encode($pass))) { @fclose($sock); return false; }
    if (!$expect(235)) {
        if (function_exists('error_log')) error_log('[mail_helper] SMTP auth failed (check Gmail App Password)');
        @fclose($sock);
        return false;
    }

    if (!$send("MAIL FROM:<" . $fromEmail . ">")) { @fclose($sock); return false; }
    if (!$expect(250)) { @fclose($sock); return false; }
    if (!$send("RCPT TO:<" . $to . ">")) { @fclose($sock); return false; }
    if (!$expect(250)) { @fclose($sock); return false; }
    if (!$send("DATA")) { @fclose($sock); return false; }
    if (!$expect(354)) { @fclose($sock); return false; }
    if (!@fwrite($sock, $message . "\r\n.\r\n")) { @fclose($sock); return false; }
    if (!$expect(250)) {
        if (function_exists('error_log')) error_log('[mail_helper] SMTP DATA rejected');
        @fclose($sock);
        return false;
    }
    $send("QUIT");
    @fclose($sock);
    return true;
}
