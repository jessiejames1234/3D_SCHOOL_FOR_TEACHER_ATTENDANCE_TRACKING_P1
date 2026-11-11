"""Test real Apache/PHP responses with delayed loopback SMTP; no real mail or DB."""
import argparse
import json
from pathlib import Path
import socket
import socketserver
import subprocess
import tempfile
import threading
import time
import urllib.request

from run_mail_helper_test import Receiver


class SlowReceiver(Receiver):
    def reply(self, value):
        if value == b"250 Accepted locally":
            time.sleep(2.5)
            if self.server.reject:
                value = b"550 Test delivery rejected"
        super().reply(value)


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--xampp", default="C:/xampp")
    args = parser.parse_args()
    project = Path(__file__).resolve().parents[2]
    scratch = project / ".codex-tmp"
    scratch.mkdir(exist_ok=True)
    xampp = Path(args.xampp).as_posix()
    with tempfile.TemporaryDirectory(prefix="deferred-mail-", dir=scratch) as directory:
        root = Path(directory)
        root_posix = root.as_posix()
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            http_port = sock.getsockname()[1]
        with socketserver.ThreadingTCPServer(("127.0.0.1", 0), SlowReceiver) as smtp:
            smtp.messages = []
            smtp.reject = False
            thread = threading.Thread(target=smtp.serve_forever, daemon=True)
            thread.start()
            settings = {
                "MAIL_DRIVER": "smtp", "MAIL_SMTP_HOST": "127.0.0.1",
                "MAIL_SMTP_PORT": str(smtp.server_address[1]),
                "MAIL_SMTP_SECURE": "none", "MAIL_SMTP_AUTH": "false",
                "MAIL_SMTP_USER": "", "MAIL_SMTP_PASS": "",
                "MAIL_FROM_EMAIL": "sender@example.com", "MAIL_FROM_NAME": "Test",
            }
            php_env = "\n".join("putenv(" + json.dumps(k + "=" + v) + ");" for k, v in settings.items())
            fixture = """<?php
ini_set('display_errors', '0');
ini_set('log_errors', '1');
ini_set('error_log', __DIR__ . '/errors.log');
ob_start(); ob_start(); // Nested buffers must not delay or corrupt JSON.
ENVIRONMENT
require_once PROJECT . '/api/helpers/functions.php';
require_once PROJECT . '/api/helpers/personal_notification_helper.php';
class TestResult { function fetch_assoc() { return ['first_name'=>'Test', 'email'=>'recipient@example.com']; } }
class TestStatement {
    function bind_param($types, &$value) {}
    function execute() {}
    function get_result() { return new TestResult(); }
    function close() {}
}
class TestDatabase { function prepare($sql) { return new TestStatement(); } }
$mode = $_GET['mode'] ?? 'notification';
if ($mode === 'notification') {
    $result = personal_notif_send_general_update(new TestDatabase(), 7, 'Schedule saved', 'Test class schedule');
    app_defer_email(static function () { file_put_contents(__DIR__ . '/done', 'done'); });
    json_response(['ok'=>true, 'email_notification'=>$result]);
}
if ($mode === 'otp') $sent = send_forgot_password_email('recipient@example.com', 'Test', 'User', '123456');
else $sent = send_school_id_password_reset_email('recipient@example.com', 'Test', 'User');
json_response(['sent'=>$sent]);
""".replace("ENVIRONMENT", php_env).replace("PROJECT", json.dumps(project.as_posix()))
            (root / "index.php").write_text(fixture, encoding="utf-8")
            config = f'''ServerRoot "{xampp}/apache"
Listen 127.0.0.1:{http_port}
ServerName localhost
PidFile "{root_posix}/apache.pid"
ErrorLog "{root_posix}/apache-errors.log"
LoadModule authz_core_module modules/mod_authz_core.so
LoadModule env_module modules/mod_env.so
LoadModule mime_module modules/mod_mime.so
LoadModule filter_module modules/mod_filter.so
LoadModule deflate_module modules/mod_deflate.so
LoadFile "{xampp}/php/php8ts.dll"
LoadFile "{xampp}/php/libpq.dll"
LoadFile "{xampp}/php/libsqlite3.dll"
LoadModule php_module "{xampp}/php/php8apache2_4.dll"
PHPINIDir "{xampp}/php"
DocumentRoot "{root_posix}"
<Directory />
AllowOverride None
</Directory>
<Directory "{root_posix}">
Require all granted
AllowOverride None
</Directory>
<FilesMatch "\\.php$">
SetHandler application/x-httpd-php
</FilesMatch>
AddOutputFilterByType DEFLATE application/json
'''
            config_path = root / "httpd.conf"
            config_path.write_text(config, encoding="utf-8")
            command = [f"{xampp}/apache/bin/httpd.exe", "-f", str(config_path)]
            flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            subprocess.run(command + ["-t"], check=True, capture_output=True, creationflags=flags)
            apache = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=flags)
            try:
                deadline = time.monotonic() + 10
                while True:
                    try:
                        with socket.create_connection(("127.0.0.1", http_port), timeout=.2):
                            break
                    except OSError:
                        check(time.monotonic() < deadline, "Isolated Apache did not start")
                        time.sleep(.1)
                url = f"http://127.0.0.1:{http_port}/index.php"
                def request(mode):
                    started = time.monotonic()
                    req = urllib.request.Request(url + "?mode=" + mode, headers={"Accept-Encoding": "gzip"})
                    with urllib.request.urlopen(req, timeout=10) as response:
                        return json.loads(response.read()), time.monotonic() - started
                for reject in (False, True):
                    smtp.reject = reject
                    done = root / "done"
                    done.unlink(missing_ok=True)
                    result, elapsed = request("notification")
                    check(result["ok"] and result["email_notification"]["pending"], "Pending save response incorrect")
                    check(elapsed < 1.5, f"Response waited for email: {elapsed:.2f}s")
                    check(not done.exists(), "Email finished before response")
                    deadline = time.monotonic() + 8
                    while not done.exists():
                        check(time.monotonic() < deadline, "Deferred email did not complete")
                        time.sleep(.05)
                    if reject:
                        check("[personal_notification] failed user_id=7" in (root / "errors.log").read_text(), "Email failure was not logged")
                    print(f"Notification {'failure' if reject else 'success'}: response {elapsed:.3f}s, email completed separately")
                for mode in ("otp", "admin"):
                    result, elapsed = request(mode)
                    check(result["sent"] is False and elapsed >= 2.5, f"{mode} stopped waiting for SMTP failure")
                    print(f"{mode}: waited for mail result and reported rejection")
            except Exception:
                for filename in ('errors.log', 'apache-errors.log'):
                    if (root / filename).exists():
                        print((root / filename).read_text(errors='replace'), flush=True)
                raise
            finally:
                # Stop only this isolated test server and its child process.
                subprocess.run(['taskkill', '/PID', str(apache.pid), '/T', '/F'], capture_output=True, creationflags=flags)
                apache.wait(timeout=10)
                smtp.shutdown()
                thread.join(timeout=5)


if __name__ == "__main__":
    main()
