"""Exercise real release ingestion and promotion in a scratch Linux filesystem."""

import hashlib
import importlib.util
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
        for directory in ('incoming', 'public', 'code/scripts'):
            (self.root / directory).mkdir(parents=True)
        for file in ('release-command.py', 'publish-release.mjs'):
            shutil.copyfile(DEPLOY / file, self.code / file)
        for file in ('scripts/release-artifacts.mjs', 'scripts/render-downloads.mjs'):
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
        if scope in ('android', 'ios'):
            for item in artifacts:
                item['bytes'] = len(files[item['file']])
            kind = 'debug-apk-and-unsigned-aab' if scope == 'android' else 'unsigned-ios-simulator'
            files[f'{prefix}-build.json'] = encoded(dict(version=version, platform=scope, sourceCommit=commit, kind=kind,
                sourceHasUncommittedChanges=False, sourceRevisionChangedDuringBuild=False, artifacts=artifacts))
            return files
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
        fixtures = {scope: self.fixture(scope) for scope in ('win', 'linux', 'mac', 'android', 'ios', 'planning')}
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
        self.assertEqual(len(records), 32)
        self.assertIn(f'./v{VERSION}/'.encode(), public_index.read_bytes())
        for page in (public_index, version_path / 'index.html'):
            document = page.read_text(encoding='utf-8')
            self.assertIn('href="/assets/releases.css"', document)
            self.assertIn('src="/assets/karaoke-booth.png"', document)
            self.assertIn('href="/">All downloads</a>', document)
        self.assertTrue(version_path.stat().st_mode & 0o001)
        for item in records:
            self.assertEqual(digest((version_path / item['file']).read_bytes()), item['sha256'])
        previous_index = public_index.read_bytes()
        self.command(publish)
        self.command(publish.replace(COMMIT, 'c' * 40), success=False)
        self.assertEqual(public_index.read_bytes(), previous_index)

    def test_new_version_links_to_earlier_release_without_modifying_its_files(self):
        def promote(version, commit, run):
            for scope in ('win', 'linux', 'mac', 'android', 'ios', 'planning'):
                self.command(f'upload {version} {commit} {run} 1 {scope}', archive(self.fixture(scope, version, commit)))
            self.command(f'publish {version} {commit} {run} 1 {SPEC}')

        promote(VERSION, COMMIT, 103)
        archived = self.public / f'v{VERSION}'
        archived_files = {file.name: digest(file.read_bytes()) for file in archived.iterdir()}
        next_version = '0.10.0'
        promote(next_version, 'd' * 40, 104)

        latest_page = (self.public / 'index.html').read_text(encoding='utf8')
        self.assertIn(f'href="./v{VERSION}/">Version {VERSION}</a>', latest_page)
        self.assertIn('href="./latest/Proper-Karaoke-Booth-windows-x64-setup.exe"', latest_page)
        self.assertEqual({file.name: digest(file.read_bytes()) for file in archived.iterdir()}, archived_files)

    def test_pruning_archives_public_metadata_and_notes_and_keeps_latest_aliases(self):
        for number in range(7):
            version, commit, run = f'0.9.{number}', f'{number + 1:040x}', 200 + number
            for scope in ('win', 'linux', 'mac', 'android', 'ios', 'planning'):
                self.command(f'upload {version} {commit} {run} 1 {scope}', archive(self.fixture(scope, version, commit)))
            self.command(f'publish {version} {commit} {run} 1 {SPEC}')
            if number == 0:
                (self.public / 'v0.9.0' / 'release-notes.md').write_text('Notes <safe> & preserved', encoding='utf8')
                # Historic published notes may be recovered from GitHub before
                # the first retention run, without altering the original release.
                spec = importlib.util.spec_from_file_location('publisher', self.code / 'release-command.py')
                publisher = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(publisher)
                with tempfile.TemporaryDirectory(dir=self.incoming) as temp:
                    publisher.archive_release(self.public, version, Path(temp))
                saved = self.public / 'archive/v0.9.0'
                (saved / 'GITHUB_RELEASE_NOTES.md').write_text('Exact GitHub notes', encoding='utf8')
                publisher.write_archive_page(saved, version, publisher.manifest_for(saved, version))
                # Simulate a retained archive previously created with the private umask.
                saved.chmod(0o700)
                saved.parent.chmod(0o700)
        self.assertFalse((self.public / 'v0.9.0').exists())
        self.assertEqual(sorted(path.name for path in self.public.glob('v*') if path.is_dir()), [f'v0.9.{n}' for n in range(2, 7)])
        saved = self.public / 'archive/v0.9.0'
        self.assertEqual(saved.stat().st_mode & 0o777, 0o755)
        self.assertEqual(saved.parent.stat().st_mode & 0o777, 0o755)
        self.assertEqual((saved.parent / 'v0.9.1').stat().st_mode & 0o777, 0o755)
        self.assertEqual((saved / 'release-notes.md').read_text(encoding='utf8'), 'Notes <safe> & preserved')
        self.assertEqual((saved / 'GITHUB_RELEASE_NOTES.md').read_text(encoding='utf8'), 'Exact GitHub notes')
        archived_page = (saved / 'index.html').read_text(encoding='utf8')
        self.assertIn('href="/assets/releases.css"', archived_page)
        self.assertIn('src="/assets/karaoke-booth.png"', archived_page)
        self.assertIn('Notes &lt;safe&gt; &amp; preserved', archived_page)
        self.assertIn('Exact GitHub notes', archived_page)
        self.assertNotIn('.exe"', archived_page)
        self.assertTrue((saved / 'original-download-page.html.txt').exists())
        page = (self.public / 'index.html').read_text(encoding='utf8')
        self.assertIn('./archive/v0.9.0/', page)
        self.assertNotIn('href="./v0.9.0/"', page)
        alias = (self.public / '.latest.map').read_text(encoding='ascii')
        self.assertIn('Proper-Karaoke-Booth-windows-x64-setup.exe /v0.9.6/Proper-Karaoke-Booth-0.9.6-windows-x64-setup.exe', alias)
        self.assertIn('Proper-Karaoke-Booth-android-debug.apk /v0.9.6/Proper-Karaoke-Booth-0.9.6-android-debug.apk', alias)
        self.assertIn('release-manifest.json /v0.9.6/release-manifest.json', alias)

    def test_invalid_existing_release_metadata_prevents_pruning(self):
        for number in range(5):
            version, commit, run = f'0.8.{number}', chr(97 + number) * 40, 300 + number
            for scope in ('win', 'linux', 'mac', 'android', 'ios', 'planning'):
                self.command(f'upload {version} {commit} {run} 1 {scope}', archive(self.fixture(scope, version, commit)))
            self.command(f'publish {version} {commit} {run} 1 {SPEC}')
        # Simulate a pre-existing damaged version. Publication must preserve it.
        bad = self.public / 'v0.8.0' / 'release-manifest.json'
        bad.chmod(0o644)
        bad.write_text('{}')
        for scope in ('win', 'linux', 'mac', 'android', 'ios', 'planning'):
            self.command(f'upload 0.8.5 {"f" * 40} 305 1 {scope}', archive(self.fixture(scope, '0.8.5', 'f' * 40)))
        self.command(f'publish 0.8.5 {"f" * 40} 305 1 {SPEC}', success=False)
        self.assertTrue((self.public / 'v0.8.0').exists())
        self.assertFalse((self.public / 'v0.8.5').exists())


if __name__ == '__main__':
    unittest.main()
