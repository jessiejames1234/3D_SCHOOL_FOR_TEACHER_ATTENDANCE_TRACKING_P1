<?php
// api/helpers/mail_helper.php
// All application emails share a configurable PHPMailer or Apps Script transport.
require_once __DIR__ . '/email_design_helper.php';

/** Build a message without sending it, so transport configuration is testable. */
function mail_helper_create_mailer($to, $fromFallback, $subject, $htmlBody, $mailConfig, $plainBody = null) {
    require_once __DIR__ . '/../vendor/autoload.php';
    if (!mail_helper_is_single_recipient($to)) throw new InvalidArgumentException('Invalid recipient email');

    $mailer = new \PHPMailer\PHPMailer\PHPMailer(true);
    $mailer->CharSet = 'UTF-8';
    $mailer->SMTPDebug = 0;
    $driver = strtolower(trim((string)($mailConfig['driver'] ?? 'auto')));
    $user = (string)($mailConfig['smtp_user'] ?? '');
    $password = (string)($mailConfig['smtp_pass'] ?? '');
    $host = trim((string)($mailConfig['smtp_host'] ?? ''));
    if ($driver === 'auto') {
        $driver = $host !== '' && $user !== '' && $password !== '' ? 'smtp' : 'mail';
    }
    if ($driver === 'smtp') {
        if ($host === '') throw new InvalidArgumentException('SMTP host is required');
        $authSetting = $mailConfig['smtp_auth'] ?? 'auto';
        $auth = strtolower((string)$authSetting) === 'auto'
            ? ($user !== '' || $password !== '')
            : filter_var($authSetting, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
        if ($auth === null) throw new InvalidArgumentException('Invalid SMTP authentication setting');
        if ($auth && ($user === '' || $password === '')) throw new InvalidArgumentException('SMTP credentials are required');
        $secure = strtolower(trim((string)($mailConfig['smtp_secure'] ?? 'tls')));
        if (in_array($secure, ['ssl', 'smtps'], true)) $secure = 'ssl';
        elseif (in_array($secure, ['tls', 'starttls'], true)) $secure = 'tls';
        elseif (in_array($secure, ['', 'none', 'off'], true)) $secure = '';
        else throw new InvalidArgumentException('Invalid SMTP encryption setting');
        $port = (int)($mailConfig['smtp_port'] ?? ($secure === 'ssl' ? 465 : ($secure === 'tls' ? 587 : 25)));
        if ($port < 1 || $port > 65535) throw new InvalidArgumentException('Invalid SMTP port');
        $mailer->isSMTP();
        $mailer->Host = $host;
        $mailer->Port = $port;
        $mailer->SMTPAuth = $auth;
        $mailer->Username = $user;
        $mailer->Password = $password;
        $mailer->SMTPSecure = $secure;
        // An explicit "none" supports hosting relays that do not offer TLS.
        $mailer->SMTPAutoTLS = $secure !== '';
        $mailer->Timeout = max(1, min(60, (int)($mailConfig['smtp_timeout'] ?? 15)));
    } elseif ($driver === 'mail') {
        $mailer->isMail();
    } elseif ($driver === 'sendmail') {
        $mailer->isSendmail();
    } else {
        throw new InvalidArgumentException('Invalid mail transport');
    }

    $from = trim((string)($mailConfig['from_email'] ?? ''));
    if ($from === '') $from = mail_helper_is_single_recipient($user) ? $user : trim((string)$fromFallback);
    if (!mail_helper_is_single_recipient($from)) throw new InvalidArgumentException('Configure a valid MAIL_FROM_EMAIL sender');
    $mailer->setFrom($from, (string)($mailConfig['from_name'] ?? 'Teacher Attendance'));
    $mailer->addAddress(trim((string)$to));
    $mailer->isHTML(true);
    $mailer->Subject = (string)$subject;
    $mailer->Body = (string)$htmlBody;
    $mailer->AltBody = $plainBody !== null ? (string)$plainBody : trim(html_entity_decode(
        strip_tags(preg_replace('/<(?:br\s*\/?|\/p|\/div|\/tr|\/h[1-6])\s*>/i', "\n", (string)$htmlBody)),
        ENT_QUOTES | ENT_HTML5, 'UTF-8'
    ));
    return $mailer;
}

/** Send existing email content through a GmailApp web app instead of SMTP. */
function mail_helper_send_apps_script($to, $subject, $htmlBody, $plainBody, $mailConfig) {
    if (!function_exists('curl_init')) throw new RuntimeException('Apps Script email requires PHP cURL');
    $url = trim((string)($mailConfig['apps_script_url'] ?? ''));
    $parts = parse_url($url);
    if (!filter_var($url, FILTER_VALIDATE_URL) || !$parts
        || strtolower($parts['scheme'] ?? '') !== 'https'
        || isset($parts['user']) || isset($parts['pass'])) {
        throw new InvalidArgumentException('Configure MAIL_APPS_SCRIPT_URL with an HTTPS web app URL');
    }
    $secret = (string)($mailConfig['apps_script_secret'] ?? '');
    if (trim($secret) === '') throw new InvalidArgumentException('Configure MAIL_APPS_SCRIPT_SECRET');
    $body = $plainBody !== null ? (string)$plainBody : trim(html_entity_decode(
        strip_tags(preg_replace('/<(?:br\s*\/?|\/p|\/div|\/tr|\/h[1-6])\s*>/i', "\n", (string)$htmlBody)),
        ENT_QUOTES | ENT_HTML5, 'UTF-8'
    ));
    $payload = json_encode([
        'secret' => $secret, 'to' => trim((string)$to), 'subject' => (string)$subject,
        'body' => $body, 'html_body' => (string)$htmlBody,
        'from_name' => (string)($mailConfig['from_name'] ?? 'Teacher Attendance'),
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    $timeout = max(1, min(60, (int)($mailConfig['apps_script_timeout'] ?? 30)));
    $response = '';
    $ch = curl_init($url);
    try {
        $caFile = trim((string)ini_get('curl.cainfo'));
        if ($caFile !== '') curl_setopt($ch, CURLOPT_CAINFO, $caFile);
        curl_setopt_array($ch, [
            CURLOPT_POST => true, CURLOPT_POSTFIELDS => $payload,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json'],
            // ContentService redirects the result; 302/303 should become GET.
            CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 3,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_CONNECTTIMEOUT => min(10, $timeout), CURLOPT_TIMEOUT => $timeout,
            CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_WRITEFUNCTION => static function ($handle, $chunk) use (&$response) {
                if (strlen($response) + strlen($chunk) > 65536) return 0;
                $response .= $chunk;
                return strlen($chunk);
            },
        ]);
        if (curl_exec($ch) === false) {
            // Avoid logging credentials, email content or remote responses.
            throw new RuntimeException('Apps Script email connection failed (cURL code ' . curl_errno($ch) . ')');
        }
        $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        if ($httpCode < 200 || $httpCode >= 300) {
            throw new RuntimeException('Apps Script email returned HTTP ' . $httpCode);
        }
    } finally {
        curl_close($ch);
    }
    $result = json_decode($response, true);
    if (!is_array($result) || ($result['status'] ?? null) !== 'success') {
        throw new RuntimeException('Apps Script email did not confirm success; check deployment access, secret and Google execution logs');
    }
    return true;
}

/** Return true only when the selected transport accepts the message. */
function mail_helper_send($to, $subject, $htmlBody, $plainBody = null, $mailConfig = null, $fromFallback = null) {
    if (!mail_helper_is_single_recipient($to)) return false;
    try {
        if ($mailConfig === null) {
            $mailConfig = require __DIR__ . '/../config/mail.php';
            app_log_env_diagnostic('email');
        }
        if (strtolower(trim((string)($mailConfig['driver'] ?? 'auto'))) === 'apps_script') {
            return mail_helper_send_apps_script($to, $subject, $htmlBody, $plainBody, $mailConfig);
        }
        if ($fromFallback === null) {
            $security = is_file(__DIR__ . '/../config/security.php') ? require __DIR__ . '/../config/security.php' : [];
            $fromFallback = getenv('MAIL_FROM') ?: ($security['mail_from'] ?? '');
        }
        $mailer = mail_helper_create_mailer($to, $fromFallback, $subject, $htmlBody, $mailConfig, $plainBody);
        return $mailer->send();
    } catch (Throwable $error) {
        error_log('[mail_helper] Email send failed: ' . $error->getMessage());
        return false;
    }
}

// Preserve compatibility for callers of the former socket sender.
function send_via_smtp_socket($to, $fromFallback, $subject, $htmlBody, $mailConfig) {
    $mailConfig['driver'] = 'smtp';
    return mail_helper_send($to, $subject, $htmlBody, null, $mailConfig, $fromFallback);
}

/**
 * Validate that an email string is exactly one deliverable recipient.
 */
function mail_helper_is_single_recipient($email) {
    $recipient = trim((string)$email);
    if ($recipient === '') return false;
    if (preg_match('/[\r\n,;]/', $recipient)) return false;
    return (bool)filter_var($recipient, FILTER_VALIDATE_EMAIL);
}

/**
 * Send forgot-password OTP email.
 * Uses the email transport selected in config/mail.php.
 *
 * @param string $to Recipient email
 * @param string $firstName User first name
 * @param string $lastName User last name
 * @param string $otp 6-digit OTP
 * @return bool True if mail was accepted for delivery
 */
function send_forgot_password_email($to, $firstName, $lastName, $otp) {
    if (!mail_helper_is_single_recipient($to)) {
        error_log('[mail_helper] Refusing forgot-password email: invalid single recipient');
        return false;
    }

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
    return mail_helper_send($to, $subject, $htmlBody);
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
function send_new_account_email($to, $firstName, $lastName, $username, $usesDefaultPassword = true, $temporaryPassword = '') {
    if (!mail_helper_is_single_recipient($to)) {
        error_log('[mail_helper] Refusing new-account email: invalid single recipient');
        return false;
    }

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
    return mail_helper_send($to, $subject, $htmlBody);
}

function send_temporary_password_email($to, $firstName, $lastName, $temporaryPassword) {
    if (!mail_helper_is_single_recipient($to)) return false;
    $name = trim((string)$firstName . ' ' . (string)$lastName) ?: 'User';
    $content = '<p style="margin:0 0 12px;">Hello ' . email_design_escape($name) . ',</p>'
        . '<p style="margin:0 0 12px;">A password reset was requested for your account.</p>'
        . email_design_panel('Temporary password', $temporaryPassword, 'Replace it immediately after sign-in.', true)
        . '<p style="margin:0;color:#64748b;font-size:13px;">If you did not expect this reset, contact your administrator.</p>';
    $htmlBody = email_design_render('Account security', 'Your temporary password', $content, 'Your temporary password is ready.');
    $subject = 'Your temporary account password';
    return mail_helper_send($to, $subject, $htmlBody);
}

function send_school_id_password_reset_email($to, $firstName, $lastName) {
    if (!mail_helper_is_single_recipient($to)) return false;
    $name = trim((string)$firstName . ' ' . (string)$lastName) ?: 'User';
    $content = '<p style="margin:0 0 12px;">Hello ' . email_design_escape($name) . ',</p>'
        . '<p style="margin:0 0 12px;">An administrator reset your account password.</p>'
        . email_design_panel('Temporary sign-in', 'Use your registered School ID', 'Create a new secure password immediately after signing in.')
        . '<p style="margin:0;color:#64748b;font-size:13px;">If you did not expect this reset, contact your administrator.</p>';
    $htmlBody = email_design_render('Account security', 'Your password was reset', $content, 'Use your School ID to sign in and set a new password.');
    $subject = 'Your account password was reset';
    return mail_helper_send($to, $subject, $htmlBody);
}

/**
 * Send a personal system notification email.
 *
 * The recipient must already be resolved from the triggering user's own profile.
 */
function send_personal_notification_email($to, $firstName, $notificationType, $briefDescription, $eventDetails, $eventDateTime = null) {
    if (!mail_helper_is_single_recipient($to)) {
        error_log('[mail_helper] Refusing personal notification email: invalid single recipient');
        return false;
    }

    $recipient = trim((string)$to);
    $name = trim((string)$firstName);
    if ($name === '') $name = 'there';

    $type = strtoupper(trim((string)$notificationType));
    if ($type === '') $type = 'GENERAL';

    $brief = trim((string)$briefDescription);
    if ($brief === '') $brief = 'Account notification';

    $details = trim((string)$eventDetails);
    if ($details === '') $details = 'A system update was recorded for your account.';

    try {
        if ($eventDateTime instanceof DateTimeInterface) {
            $dt = DateTime::createFromFormat('U', (string)$eventDateTime->getTimestamp());
            if ($dt instanceof DateTime) $dt->setTimezone(new DateTimeZone(date_default_timezone_get()));
        } elseif (is_string($eventDateTime) && trim($eventDateTime) !== '') {
            $dt = new DateTime($eventDateTime);
        } else {
            $dt = new DateTime();
        }
    } catch (Throwable $_) {
        $dt = new DateTime();
    }
    if (!isset($dt) || !($dt instanceof DateTimeInterface)) {
        $dt = new DateTime();
    }

    $subject = '[' . $type . '] ' . $brief . ' · ' . $dt->format('Y-m-d');
    $plainBody =
        "Hi {$name},\n\n" .
        "This is a personal notification for your account.\n\n" .
        "Event     : {$type}\n" .
        "Details   : {$details}\n" .
        "Date/Time : " . $dt->format('Y-m-d  h:i A') . "\n\n" .
        "If you did not expect this message, please contact\n" .
        "your administrator.";

    $content = '<p style="margin:0 0 12px;">Hello ' . email_design_escape($name) . ',</p>'
        . '<p style="margin:0 0 12px;">A new update has been recorded for your account.</p>'
        . email_design_notification_details($details)
        . '<p style="margin:0 0 16px;color:#64748b;font-size:12px;">' . email_design_escape($dt->format('Y-m-d  h:i A')) . '</p>'
        . '<p style="margin:0;color:#475569;font-size:13px;">Open Teacher Attendance to review this update. If you did not expect it, contact your administrator.</p>';
    $htmlBody = email_design_render($type, $brief, $content, $brief);

    return mail_helper_send($recipient, $subject, $htmlBody, $plainBody);
}

