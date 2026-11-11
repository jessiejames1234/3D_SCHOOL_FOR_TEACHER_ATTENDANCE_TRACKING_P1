"""Receive test mail on loopback; never contact an external SMTP server."""
import argparse
from email import policy
from email.parser import BytesParser
import os
from pathlib import Path
import socketserver
import subprocess
import threading


class Receiver(socketserver.StreamRequestHandler):
    def reply(self, value):
        self.wfile.write(value + b"\r\n")
        self.wfile.flush()

    def handle(self):
        self.connection.settimeout(10)
        self.reply(b"220 localhost test receiver")
        while line := self.rfile.readline():
            command = line.split(b" ", 1)[0].strip().upper()
            if command in (b"EHLO", b"HELO"):
                self.reply(b"250 localhost")
            elif command in (b"MAIL", b"RCPT", b"RSET", b"NOOP"):
                self.reply(b"250 OK")
            elif command == b"DATA":
                self.reply(b"354 End with dot")
                body = []
                while chunk := self.rfile.readline():
                    if chunk == b".\r\n":
                        break
                    body.append(chunk[1:] if chunk.startswith(b"..") else chunk)
                self.server.messages.append(b"".join(body))
                self.reply(b"250 Accepted locally")
            elif command == b"QUIT":
                self.reply(b"221 Bye")
                break
            else:
                self.reply(b"502 Unsupported test command")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--php", default="php")
    args = parser.parse_args()
    with socketserver.ThreadingTCPServer(("127.0.0.1", 0), Receiver) as server:
        server.messages = []
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        env = os.environ.copy()
        env.update({
            "MAILER_TEST_PORT": str(server.server_address[1]),
            "MAIL_DRIVER": "smtp", "MAIL_SMTP_HOST": "127.0.0.1",
            "MAIL_SMTP_PORT": str(server.server_address[1]),
            "MAIL_SMTP_SECURE": "none", "MAIL_SMTP_AUTH": "false",
            "MAIL_SMTP_USER": "sender@example.com", "MAIL_SMTP_PASS": "test-only",
            "MAIL_FROM_EMAIL": "sender@example.com", "MAIL_FROM_NAME": "Test",
        })
        try:
            result = subprocess.run([args.php, str(Path(__file__).with_name("mail_helper_test.php"))],
                                    env=env, capture_output=True, text=True, timeout=30)
        finally:
            server.shutdown()
            thread.join(timeout=5)
        if result.returncode:
            raise SystemExit(result.stdout + result.stderr)
        if len(server.messages) != 6:
            raise SystemExit(f"Expected 6 local emails, received {len(server.messages)}")
        messages = [BytesParser(policy=policy.default).parsebytes(raw) for raw in server.messages]
        for message in messages:
            if message["From"].addresses[0].addr_spec != "sender@example.com":
                raise SystemExit("Sender changed between localhost and tunnel")
            if message["To"].addresses[0].addr_spec != "recipient@example.com":
                raise SystemExit("Incorrect recipient")
            if not message.get_body(preferencelist=("html",)) or not message.get_body(preferencelist=("plain",)):
                raise SystemExit("Missing HTML or plain-text body")
        if "default: ID number" not in messages[0].get_body(preferencelist=("html",)).get_content():
            raise SystemExit("Missing default-password account guidance")
        if "provided by your administrator" not in messages[1].get_body(preferencelist=("html",)).get_content():
            raise SystemExit("Missing custom-password account guidance")
        print(result.stdout.strip())
        print("6 emails received by local SMTP, including localhost and dev-tunnel hostnames.")


if __name__ == "__main__":
    main()
