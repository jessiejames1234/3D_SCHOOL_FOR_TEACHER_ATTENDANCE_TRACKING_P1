# Email setup

All application emails use PHPMailer: password-reset OTPs, account creation,
temporary passwords, School ID resets, and personal system notifications.
Configure `api/config/mail.php` or the environment variables below. Existing
SMTP settings continue to work. Include `api/vendor` when uploading the project,
or run `composer install --no-dev` inside `api` on the server.

## Save responses and email processing

Account creation/import and personal notification emails are deferred until
after the JSON response. This includes Class Schedule creation/import/edits,
attendance alerts, leave approval, substitute assignment, attendance-edit
decisions, and tardiness policy notifications. Website notifications are still
saved immediately. The response describes an email as `pending`, not `sent`;
pending email does not count as a delivery failure or show a warning alert.

`helpers/deferred_email_helper.php` holds callbacks in request memory.
`helpers/functions.php` finishes the response before running them. PHP-FPM
uses `fastcgi_finish_request()`. Apache/XAMPP uses an uncompressed response
with an exact Content-Length and flushes it before sending mail. Reverse
proxies must allow early responses (`X-Accel-Buffering: no` is included).
CLI attendance workers continue sending synchronously.

No database migration, cron job, or `.env` change is needed. PHP continues
working after the response; this is not a persistent queue and cannot retry
mail lost to a process crash, server restart, or hosting timeout.

Failures go to the configured PHP error log (normally
`api/logs/php-errors.log`). Failed account email delivery also retains the
`send_account_email_failed` system log entry. No later browser alert is sent.

Password-reset OTPs and admin Settings School ID resets stay synchronous.
OTP privacy/rate-limit/verification rules are unchanged. Admin reset requires
SMTP acceptance before changing the password; if submission fails, its error
response is returned and the existing password remains unchanged. SMTP
acceptance does not guarantee final inbox delivery.

Verification on Windows/XAMPP, using only isolated Apache and loopback SMTP:

```powershell
python api/tests/run_deferred_email_test.py
python api/tests/run_mail_helper_test.py --php C:/xampp/php/php.exe
C:/xampp/php/php.exe api/tests/schedule_notification_test.php
```

## Localhost and dev tunnels

Use the same authenticated SMTP account for both. Email is sent by PHP on the
server, so the site's hostname does not select the email server or sender.
Use a real sender authorized by your email provider, not a localhost or tunnel
address. The existing configuration remains the default when variables are unset.

| Variable | Example | Meaning |
| --- | --- | --- |
| `MAIL_DRIVER` | `smtp` | `smtp`, `mail`, `sendmail`, or `auto` |
| `MAIL_SMTP_HOST` | `smtp.gmail.com` | Provider's SMTP host |
| `MAIL_SMTP_PORT` | `587` | Provider's SMTP port |
| `MAIL_SMTP_SECURE` | `tls` | `tls`/`starttls`, `ssl`/`smtps`, or `none` |
| `MAIL_SMTP_AUTH` | `true` | `true`, `false`, or `auto` |
| `MAIL_SMTP_USER` | `sender@example.com` | SMTP account |
| `MAIL_SMTP_PASS` | provider credential | Password or app password |
| `MAIL_FROM_EMAIL` | `sender@example.com` | Authorized sender address |
| `MAIL_FROM_NAME` | `Teacher Attendance` | Sender display name |
| `MAIL_SMTP_TIMEOUT` | `15` | Connection timeout in seconds |

For Gmail, use an app password when the account supports it. Providers requiring
OAuth need additional authentication setup; SMTP password support is not universal.
Keep certificate verification enabled. Explicit `none` disables automatic TLS
and is intended for hosting relays that specifically require an unencrypted local
connection. It is not the default for authenticated external SMTP.

`auto` uses SMTP when host, username, and password are populated, otherwise PHP's
mail transport. Set `MAIL_DRIVER=smtp` explicitly for an unauthenticated relay.
A failed SMTP send returns failure; it does not silently retry with PHP mail.

## Hosting

Hosting still requires configuration and a delivery test. PHP must meet this
project's Composer requirements (currently PHP 8.2+), and encrypted SMTP requires
OpenSSL and outbound connections permitted by the hosting provider. No library
can guarantee delivery on every host without those requirements.

Use the provider's host, port, encryption, authentication, and authorized sender.
If the host provides PHP mail, choose `MAIL_DRIVER=mail`. If it provides a working
sendmail installation, choose `MAIL_DRIVER=sendmail`.

For GoDaddy cPanel, the current documented relay setup is `MAIL_DRIVER=smtp`,
`MAIL_SMTP_HOST=localhost`, `MAIL_SMTP_PORT=25`, `MAIL_SMTP_AUTH=false`, and
`MAIL_SMTP_SECURE=none`. Set `MAIL_FROM_EMAIL` to a mailbox on a domain you control
and configure the required SPF record. Other GoDaddy plans may differ; verify
[the hosting instructions](https://www.godaddy.com/en-ph/help/send-form-mail-using-an-smtp-relay-server-953).
Merge SPF changes with an existing record rather than adding a second SPF record.

## Verification

Run `python api/tests/run_mail_helper_test.py --php C:\xampp\php\php.exe` from
the project root. It verifies configuration and sends all email types into a
temporary SMTP server on loopback. It does not contact real email providers.
Passing this test verifies message generation and SMTP transport; it does not
verify an external provider's credentials or inbox delivery.

After deployment, create a test account or request a password reset using your
own address. Check inbox/spam and server logs. Mail errors are recorded with the
`[mail_helper]` prefix; SMTP debug output is disabled so credentials and reset
messages are not exposed through protocol logs.
