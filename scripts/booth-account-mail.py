#!/usr/bin/env python3
"""Private loopback-only Google Workspace mail adapter for Booth account links."""
import hmac
import json
import os
from pathlib import Path
import re
import smtplib
import socket
import ssl
from email.message import EmailMessage
from http.server import BaseHTTPRequestHandler, HTTPServer

SMTP_HOST = 'smtp-relay.gmail.com'
SMTP_PORT = 587
BASE_URL = 'https://queue.thepropervolume.com/app/?account=1#accountLink='
EMAIL = re.compile(r"[a-zA-Z0-9.!#$%&'*+/=?^_\x60{|}~-]{1,64}@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+", re.ASCII)
TOKEN = re.compile(r'[A-Za-z0-9_-]{43}', re.ASCII)
MESSAGES = {
    'register': ('Verify your Booth account', 'Verify this email to create your Karaoke Booth account.'),
    'signin': ('Sign in to Karaoke Booth', 'Use this link to sign in to Karaoke Booth.'),
    'reset': ('Reset your Booth password', 'Use this link to set a new Karaoke Booth password.'),
}


class WorkspaceRelay(smtplib.SMTP):
    def _get_socket(self, host, port, timeout):
        # Google Workspace authorizes the server's IPv4 address. STARTTLS still
        # verifies the real host name before any recipient or message is sent.
        destination = socket.getaddrinfo(host, port, socket.AF_INET, socket.SOCK_STREAM)[0][4]
        return socket.create_connection(destination, timeout)


def deliver(recipient, purpose, proof, sender, envelope):
    title, action = MESSAGES[purpose]
    message = EmailMessage()
    message['From'] = f'The Proper Volume <{sender}>'
    message['To'] = recipient
    message['Subject'] = title
    message.set_content(f'{action}\n\n{BASE_URL}{proof}\n\nThe link expires in 30 minutes. '
                        'If you did not request it, you can ignore this message.')
    with WorkspaceRelay(SMTP_HOST, SMTP_PORT, local_hostname='queue.thepropervolume.com', timeout=5) as smtp:
        smtp.starttls(context=ssl.create_default_context())
        smtp.send_message(message, envelope, [recipient])


def main():
    directory = Path(os.environ['CREDENTIALS_DIRECTORY'])
    with (directory / 'mail.json').open(encoding='utf-8') as file:
        config = json.load(file)
    secret = (directory / 'mail.token').read_text(encoding='ascii').strip()
    sender, envelope = config['sender'], config['envelope']
    if not TOKEN.fullmatch(secret) or any(not isinstance(address, str) or len(address) > 254
                                         or not EMAIL.fullmatch(address)
                                         or not address.endswith('@thepropervolume.com')
                                         for address in (sender, envelope)):
        raise SystemExit('Invalid Booth mail configuration.')

    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            self.request.settimeout(5)
            super().setup()

        def answer(self, status):
            self.close_connection = True
            self.send_response(status)
            self.send_header('Content-Length', '0')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()

        def do_POST(self):
            headers = self.headers
            authorization = headers.get_all('Authorization') or []
            if self.path != '/send' or len(authorization) != 1 or not authorization[0].isascii() \
                    or not hmac.compare_digest(authorization[0], 'Bearer ' + secret):
                self.answer(403)
                return
            size = headers.get('Content-Length', '')
            if headers.get('Content-Type') != 'application/json' or headers.get('Transfer-Encoding') \
                    or not size.isascii() or not size.isdecimal() or len(size) > 4 or not 0 < int(size) <= 1024:
                self.answer(400)
                return
            try:
                request = json.loads(self.rfile.read(int(size)))
                target, purpose, token = request['email'], request['purpose'], request['token']
                if not isinstance(target, str) or len(target) > 254 or not EMAIL.fullmatch(target) \
                        or not isinstance(purpose, str) or purpose not in MESSAGES \
                        or not isinstance(token, str) or not TOKEN.fullmatch(token):
                    raise ValueError('Invalid mail request.')
            except (KeyError, ValueError, TypeError):
                self.answer(400)
                return
            try:
                deliver(target, purpose, token, sender, envelope)
            except (OSError, smtplib.SMTPException):
                self.answer(503)
                return
            self.answer(204)

        def log_message(self, *_):
            pass

    with HTTPServer(('127.0.0.1', 8769), Handler) as server:
        server.serve_forever()


if __name__ == '__main__':
    main()