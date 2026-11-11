<?php
require_once __DIR__ . '/../helpers/email_design_helper.php';
$displayName = trim((string)($firstName ?? '') . ' ' . (string)($lastName ?? '')) ?: 'User';
$passwordGuidance = !empty($usesDefaultPassword) ? '(default: ID number)' : '(provided by your administrator)';
$content = '<p style="margin:0 0 12px;">Hello ' . email_design_escape($displayName) . ',</p>'
    . '<p style="margin:0 0 12px;">Your account is ready. Use the credentials below to sign in to Teacher Attendance.</p>'
    . email_design_panel('Username', $username ?? '', 'Use your School ID or registered email to sign in.')
    . (!empty($temporaryPassword)
        ? email_design_panel('Temporary password', $temporaryPassword, 'Create a new secure password immediately after signing in.', true)
        : email_design_panel('Password', $passwordGuidance))
    . '<p style="margin:0 0 12px;">Follow the instructions shown when you sign in to complete your account setup.</p>'
    . '<p style="margin:0;color:#64748b;font-size:13px;">Welcome to Teacher Attendance.</p>';
echo email_design_render('Account access', 'Your account is ready', $content, 'Your Teacher Attendance account has been created.');
