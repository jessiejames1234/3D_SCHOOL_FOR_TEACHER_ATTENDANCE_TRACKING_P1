<?php
require_once __DIR__ . '/../helpers/mail_helper.php';

function mail_test_check($condition, $message) {
    if (!$condition) throw new RuntimeException($message);
}

$base = [
    'driver' => 'smtp', 'smtp_host' => 'smtp.example.com', 'smtp_port' => 587,
    'smtp_secure' => 'tls', 'smtp_auth' => true, 'smtp_user' => 'sender@example.com',
    'smtp_pass' => 'test-only', 'from_email' => 'sender@example.com', 'from_name' => 'Test',
];
$build = function($config) {
    return mail_helper_create_mailer('recipient@example.com', '', 'Test', '<p>Hello &amp; welcome</p>', $config);
};
$smtp = $build($base);
mail_test_check($smtp->Mailer === 'smtp' && $smtp->SMTPAuth && $smtp->SMTPSecure === 'tls', 'Authenticated STARTTLS configuration');
mail_test_check($smtp->preSend(), 'MIME construction failed');
mail_test_check(strpos($smtp->getSentMIMEMessage(), 'multipart/alternative') !== false, 'Missing plain-text alternative');
mail_test_check($smtp->AltBody === 'Hello & welcome', 'Plain-text encoding');
$ssl = $build(array_replace($base, ['smtp_port' => 465, 'smtp_secure' => 'ssl']));
mail_test_check($ssl->SMTPSecure === 'ssl' && $ssl->Port === 465, 'Implicit TLS configuration');
$relay = $build(array_replace($base, ['smtp_auth' => 'false', 'smtp_port' => 25, 'smtp_secure' => 'none']));
mail_test_check(!$relay->SMTPAuth && !$relay->SMTPAutoTLS && $relay->SMTPSecure === '', 'Unauthenticated relay configuration');
foreach (['mail', 'sendmail'] as $driver) {
    mail_test_check($build(array_replace($base, ['driver' => $driver]))->Mailer === $driver, 'Host transport configuration');
}
mail_test_check($build(array_replace($base, ['driver' => 'auto']))->Mailer === 'smtp', 'Automatic SMTP selection');
mail_test_check($build(array_replace($base, ['driver' => 'auto', 'smtp_pass' => '']))->Mailer === 'mail', 'Automatic mail fallback');
foreach (['localhost', 'example.devtunnels.ms'] as $hostname) {
    $_SERVER['SERVER_NAME'] = $hostname;
    mail_test_check($build($base)->From === 'sender@example.com', 'Hostname changed sender address');
}
foreach ([['smtp_auth' => 'bad'], ['smtp_secure' => 'bad'], ['smtp_port' => 0], ['smtp_pass' => ''], ['driver' => 'bad']] as $invalid) {
    try {
        $build(array_replace($base, $invalid));
        throw new RuntimeException('Invalid configuration was accepted');
    } catch (InvalidArgumentException $expected) {}
}
mail_test_check(!mail_helper_is_single_recipient("recipient@example.com\r\nBcc:other@example.com"), 'Header injection accepted');
mail_test_check(!send_new_account_email('one@example.com,two@example.com', 'Test', 'User', 'ID'), 'Multiple recipients accepted');

if (getenv('MAILER_TEST_PORT')) {
    foreach (['localhost', 'example.devtunnels.ms'] as $hostname) {
        $_SERVER['SERVER_NAME'] = $hostname;
        mail_test_check(send_new_account_email('recipient@example.com', 'Test', 'User', '24-018-F', $hostname === 'localhost'), 'Account email failed');
    }
    mail_test_check(send_forgot_password_email('recipient@example.com', 'Test', 'User', '123456'), 'OTP email failed');
    mail_test_check(send_temporary_password_email('recipient@example.com', 'Test', 'User', 'TestPassword123!'), 'Temporary-password email failed');
    mail_test_check(send_school_id_password_reset_email('recipient@example.com', 'Test', 'User'), 'School ID reset email failed');
    mail_test_check(send_personal_notification_email('recipient@example.com', 'Test', 'GENERAL', 'Test update', 'Test details'), 'Personal notification email failed');
}
echo "PHPMailer configuration and email-flow checks passed.\n";
