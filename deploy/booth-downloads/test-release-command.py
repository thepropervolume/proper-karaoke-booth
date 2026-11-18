"""Exercise real release ingestion and promotion in a scratch Linux filesystem."""

import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest


DEPLOY = Path(__file__).resolve().parent
REPO = DEPLOY.parents[1]
NODE = os.environ.get('TPV_TEST_NODE') or shutil.which('node')
VERSION, COMMIT, SPEC = '0.9.1', 'a' * 40, 'b' * 64


def digest(value):
    return hashlib.sha256(value).hexdigest()


def encoded(value):
    return json.dumps(value).encode()


def archive(files):
    result = io.BytesIO()
    with tarfile.open(fileobj=result, mode='w', format=tarfile.USTAR_FORMAT) as bundle:
        for name, data in files.items():
            member = tarfile.TarInfo(name)
            member.size = len(data)
            bundle.addfile(member, io.BytesIO(data))
    return result.getvalue()


@unittest.skipUnless(sys.platform.startswith('linux') and NODE, 'Linux and Node.js required')
class ReleaseCommandTests(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory(prefix='tpv-release-command-test-')
        self.addCleanup(scratch.cleanup)
        self.root = Path(scratch.name)
        self.incoming = self.root / 'incoming'
        self.public = self.root / 'public'
        self.code = self.root / 'code'
        for directory in ('incoming', 'public', 'code/scripts', 'code/assets/branding/web'):
            (self.root / directory).mkdir(parents=True)
        for file in ('release-command.py', 'publish-release.mjs'):
            shutil.copyfile(DEPLOY / file, self.code / file)
        for file in ('scripts/release-artifacts.mjs', 'scripts/render-downloads.mjs', 'assets/branding/web/icon-180.png'):
            shutil.copyfile(REPO / file, self.code / file)

    def command(self, args, data=b'', success=True):
        result = subprocess.run(
            [sys.executable, self.code / 'release-command.py', '--state', self.root, '--node', NODE],
            env=dict(os.environ, SSH_ORIGINAL_COMMAND=args), input=data, capture_output=True, timeout=30,
        )
        self.assertEqual(result.returncode == 0, success, result.stderr.decode())
        return result

    def fixture(self, scope, version=VERSION, commit=COMMIT):
        names = json.loads(subprocess.check_output(
            [NODE, self.code / 'publish-release.mjs', 'names', version, scope], text=True,
        ))
        files = {file: f'Synthetic {file}'.encode() for file in names if not file.endswith(('.json', '.txt'))}
        artifacts = [{'file': file, 'sha256': digest(data)} for file, data in files.items()]
        if scope == 'planning':
            files['planning-build.json'] = encoded(dict(version=version, sourceCommit=commit, sourceSha256=SPEC, artifacts=artifacts))
            return files
        prefix = f'Proper-Karaoke-Booth-{version}-{scope}'
        architectures = ['arm64', 'x64'] if scope == 'mac' else ['x64']
        build = encoded(dict(version=version, platform=scope, sourceCommit=commit, architectures=architectures,
                             sourceHasUncommittedChanges=False, sourceRevisionChangedDuringBuild=False, artifacts=artifacts))
        identity = dict(version=version, sourceCommit=commit, buildReceiptSha256=digest(build))
        files[f'{prefix}-build.json'] = build
        files[f'{prefix}-SHA256SUMS.txt'] = ''.join(f"{item['sha256']}  {item['file']}\n" for item in artifacts).encode()
        files[f'{prefix}-ci-verification.json'] = encoded(dict(identity, passed=True, platform=scope))
        if scope == 'mac':
            packages = [dict(architecture=arch, diskImageVerified=True, matchingDmgAndZip=True,
                             nativeLaunch=arch == 'arm64', cliWithoutNode=arch == 'arm64') for arch in architectures]
            files[f'{prefix}-verification.json'] = encoded(dict(identity, packages=packages))
        return files

    def test_rejects_command_injection_traversal_and_incomplete_upload(self):
        upload = f'upload {VERSION} {COMMIT} 101 1 planning'
        self.command(upload + ' ; id', success=False)
        self.command(upload, archive({'../../public/private': b'do not publish'}), success=False)
        self.command(upload, archive({'planning-build.json': b'{}'}), success=False)
        self.assertFalse(any(self.incoming.glob('*/planning')))
        self.assertEqual(list(self.public.iterdir()), [])

    def test_requires_one_complete_attempt_and_preserves_published_bytes(self):
        fixtures = {scope: self.fixture(scope) for scope in ('win', 'linux', 'mac', 'planning')}
        publish = f'publish {VERSION} {COMMIT} 102 2 {SPEC}'
        for scope, files in fixtures.items():
            attempt = 1 if scope == 'linux' else 2
            self.command(f'upload {VERSION} {COMMIT} 102 {attempt} {scope}', archive(files))
        self.command(publish, success=False)
        self.assertEqual(list(self.public.iterdir()), [])
        self.command(f'upload {VERSION} {COMMIT} 102 2 linux', archive(fixtures['linux']))
        self.command(publish)
        version_path = self.public / f'v{VERSION}'
        public_index = self.public / 'index.html'
        records = json.loads((version_path / 'release-manifest.json').read_bytes())['artifacts']
        self.assertEqual(len(records), 26)
        self.assertIn(f'./v{VERSION}/'.encode(), public_index.read_bytes())
        self.assertTrue(version_path.stat().st_mode & 0o001)
        for item in records:
            self.assertEqual(digest((version_path / item['file']).read_bytes()), item['sha256'])
        previous_index = public_index.read_bytes()
        self.command(publish)
        self.command(publish.replace(COMMIT, 'c' * 40), success=False)
        self.assertEqual(public_index.read_bytes(), previous_index)

    def test_new_version_links_to_earlier_release_without_modifying_its_files(self):
        def promote(version, commit, run):
            for scope in ('win', 'linux', 'mac', 'planning'):
                self.command(f'upload {version} {commit} {run} 1 {scope}', archive(self.fixture(scope, version, commit)))
            self.command(f'publish {version} {commit} {run} 1 {SPEC}')

        promote(VERSION, COMMIT, 103)
        archived = self.public / f'v{VERSION}'
        archived_files = {file.name: digest(file.read_bytes()) for file in archived.iterdir()}
        next_version = '0.10.0'
        promote(next_version, 'd' * 40, 104)

        latest_page = (self.public / 'index.html').read_text(encoding='utf8')
        self.assertIn(f'href="./v{VERSION}/">Version {VERSION}</a>', latest_page)
        self.assertIn(f'href="./v{next_version}/Proper-Karaoke-Booth-{next_version}-windows-x64-setup.exe"', latest_page)
        self.assertEqual({file.name: digest(file.read_bytes()) for file in archived.iterdir()}, archived_files)


if __name__ == '__main__':
    unittest.main()
