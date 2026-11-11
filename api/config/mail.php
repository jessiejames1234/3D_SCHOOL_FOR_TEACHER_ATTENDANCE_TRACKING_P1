<?php
require_once __DIR__ . '/env.php';
// api/config/mail.php
// PHPMailer settings shared by localhost, dev tunnels, and deployed hosting.
//
// Use driver=smtp for a hosting relay (including relays without authentication).
// auto preserves the existing behavior: configured SMTP credentials, otherwise PHP mail().
// See ../docs/MAIL_SETUP.md for hosting examples. Never use the tunnel URL as the sender.
// Gmail App Password: Google Account → Security → 2-Step Verification → App passwords.
return [
    'driver'      => getenv('MAIL_DRIVER') ?: 'auto', // auto, smtp, mail, sendmail, apps_script
    'apps_script_url' => getenv('MAIL_APPS_SCRIPT_URL') ?: '',
    'apps_script_secret' => getenv('MAIL_APPS_SCRIPT_SECRET') ?: '',
    'apps_script_timeout' => (int) (getenv('MAIL_APPS_SCRIPT_TIMEOUT') ?: 30),
    'smtp_auth'   => getenv('MAIL_SMTP_AUTH') !== false ? getenv('MAIL_SMTP_AUTH') : 'auto',
    'smtp_timeout' => (int) (getenv('MAIL_SMTP_TIMEOUT') ?: 15),
    'smtp_host'   => getenv('MAIL_SMTP_HOST')   ?: 'smtp.gmail.com',
    'smtp_port'   => (int) (getenv('MAIL_SMTP_PORT')   ?: 587),
    'smtp_secure' => getenv('MAIL_SMTP_SECURE') ?: 'tls',
    'smtp_user'   => getenv('MAIL_SMTP_USER')   ?: '',
    'smtp_pass'   => getenv('MAIL_SMTP_PASS')   ?: '',
    'from_email'  => getenv('MAIL_FROM_EMAIL')  ?: '',
    'from_name'   => getenv('MAIL_FROM_NAME')  ?: 'Teacher Attendance',
];
