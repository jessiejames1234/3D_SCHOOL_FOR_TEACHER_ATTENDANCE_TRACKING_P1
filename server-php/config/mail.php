<?php
// server-php/config/mail.php
// Configure SMTP so OTP emails are sent. On XAMPP/Windows, PHP mail() does not send real email.
//
// No Composer needed. Fill in smtp_user and smtp_pass (Gmail App Password) and OTP emails will send via SMTP.
// Gmail App Password: Google Account → Security → 2-Step Verification → App passwords.
return [
    'smtp_host'   => getenv('MAIL_SMTP_HOST')   ?: 'smtp.gmail.com',
    'smtp_port'   => (int) (getenv('MAIL_SMTP_PORT')   ?: 587),
    'smtp_secure' => getenv('MAIL_SMTP_SECURE') ?: 'tls',
    'smtp_user'   => getenv('MAIL_SMTP_USER')   ?: 'jessarose123321@gmail.com', // your Gmail address
    'smtp_pass'   => getenv('MAIL_SMTP_PASS')   ?: 'hsrhvjwbkbfsbtnl', // Gmail App Password (16 characters)
    'from_email'  => getenv('MAIL_FROM_EMAIL')  ?: 'jessarose123321@gmail.com',
    'from_name'   => getenv('MAIL_FROM_NAME')  ?: 'Teacher Attendance',
];
