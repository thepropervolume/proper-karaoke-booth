#!/usr/bin/env python3
"""Exercise the checked-in release rewrite rules with a disposable Apache server."""

from pathlib import Path
import socket
import subprocess
import tempfile
import time
import unittest
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

HERE = Path(__file__).resolve().parent
MODULES = Path('/usr/lib/apache2/modules')


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


@unittest.skipUnless(Path('/usr/sbin/apache2').is_file() and MODULES.is_dir(), 'Linux Apache required')
class ApacheReleaseTests(unittest.TestCase):
    def test_checked_in_rules_redirect_without_auth_and_keep_notes_readable(self):
        source = (HERE / 'apache.conf').read_text(encoding='utf-8')
        self.assertNotIn('IncludeOptional /etc/apache2/tpv-booth-release-access.conf', source)
        start = source.index('    RewriteMap tpv_latest ')
        end = source.index('\n\n', start)
        rules = source[start:end]
        with tempfile.TemporaryDirectory(prefix='tpv-apache-test-') as scratch:
            root = Path(scratch)
            root.chmod(0o755)
            public = root / 'public'
            public.mkdir(mode=0o755)
            (public / 'v1.2.3').mkdir(mode=0o755)
            (public / 'v1.2.3' / 'Track-1.2.3.apk').write_text('download', encoding='utf-8')
            (public / 'archive/v1.0.0').mkdir(parents=True, mode=0o755)
            (public / 'archive/v1.0.0/index.html').write_text('Archived release notes', encoding='utf-8')
            (public / 'index.html').write_text('Public downloads', encoding='utf-8')
            mapping = public / '.latest.map'
            mapping.write_text('Track.apk /v1.2.3/Track-1.2.3.apk\n', encoding='ascii')
            mapping.chmod(0o644)
            rules = rules.replace('/srv/tpv-booth-releases/public/.latest.map', str(mapping))
            self.assertNotIn('/srv/tpv-booth-releases/', rules)
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]
            module_names = ['mpm_event', 'authz_core', 'authz_host', 'dir', 'rewrite', 'headers']
            loads = '\n'.join(f'LoadModule {name}_module {MODULES / ("mod_" + name + ".so")}' for name in module_names)
            config = root / 'httpd.conf'
            config.write_text(f'''ServerRoot "{root}"
PidFile "{root / 'httpd.pid'}"
DefaultRuntimeDir "{root}"
Listen 127.0.0.1:{port}
ServerName release.thepropervolume.com
{loads}
User nobody
Group nogroup
ErrorLog "{root / 'error.log'}"
LogLevel warn
DocumentRoot "{public}"
DirectoryIndex index.html
RewriteEngine On
{rules}
<Directory "{public}">
    Options None
    AllowOverride None
    Require method GET HEAD
</Directory>
<FilesMatch "^\\.">
    Require all denied
</FilesMatch>
''', encoding='utf-8')
            process = subprocess.Popen(['/usr/sbin/apache2', '-f', str(config), '-X'], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            self.addCleanup(lambda: process.poll() is None and process.terminate())
            self.addCleanup(process.stderr.close)
            client = build_opener(NoRedirect)

            def request(path):
                try:
                    with client.open(Request(f'http://127.0.0.1:{port}{path}', headers={'Host': 'release.thepropervolume.com'}), timeout=2) as response:
                        return response.status, response.headers, response.read()
                except HTTPError as error:
                    return error.code, error.headers, error.read()

            for _ in range(80):
                try:
                    status, _, body = request('/')
                    break
                except URLError:
                    if process.poll() is not None:
                        self.fail(f'Apache failed: {process.stderr.read().decode()}')
                    time.sleep(0.05)
            else:
                self.fail('Apache did not start.')
            self.assertEqual((status, body), (200, b'Public downloads'))
            status, headers, _ = request('/latest/Track.apk')
            self.assertEqual(status, 302)
            redirect = urlsplit(headers['Location'])
            self.assertEqual((redirect.scheme, redirect.hostname, redirect.path),
                             ('http', 'release.thepropervolume.com', '/v1.2.3/Track-1.2.3.apk'))
            self.assertEqual(request('/latest/unknown.apk')[0], 404)
            self.assertEqual(request('/latest/https:%2F%2Fevil.example')[0], 404)
            self.assertEqual(request('/.latest.map')[0], 403)
            self.assertEqual(request('/archive/v1.0.0/')[2], b'Archived release notes')
            process.terminate()
            process.wait(timeout=5)


if __name__ == '__main__':
    unittest.main()
