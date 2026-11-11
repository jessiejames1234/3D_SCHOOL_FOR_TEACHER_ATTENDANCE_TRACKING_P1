<?php
require_once __DIR__ . '/../helpers/email_design_helper.php';
$displayName = trim((string)($firstName ?? '') . ' ' . (string)($lastName ?? '')) ?: 'User';
$content = '<p style="margin:0 0 12px;">Hello ' . email_design_escape($displayName) . ',</p>'
    . '<p style="margin:0 0 12px;">Use this one-time code to continue your password reset.</p>'
    . email_design_panel('Verification code', $otp ?? '', 'This code expires in 2 minutes. Do not share it with anyone.', true)
    . '<p style="margin:0;color:#64748b;font-size:13px;">If you did not request a password reset, you can ignore this email.</p>';
echo email_design_render('Account security', 'Reset your password', $content, 'Your password reset code expires in 2 minutes.');
