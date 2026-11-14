"""Exercise deployment safety without networking or building the application."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('deploy-web.sh').resolve()

MOCK = '''#!/usr/bin/env python3
import json, os, pathlib, sys
name = pathlib.Path(sys.argv[0]).name
with open(os.environ['MOCK_LOG'], 'a') as log:
    log.write(json.dumps([name, *sys.argv[1:]]) + '\\n')
if name == 'pnpm':
    output = pathlib.Path(sys.argv[sys.argv.index('--output-dir') + 1])
    (output / 'index.html').write_text('test')
    bundle = output / '_expo/static/js/web'
    bundle.mkdir(parents=True)
    (bundle / 'app.js').write_text('https://api.3spinningplates.com')
if name == os.environ.get('MOCK_FAIL'):
    print('mock failed', file=sys.stderr)
    sys.exit(42)
if name == 'ssh' and any('backup=' in arg for arg in sys.argv):
    print('/var/www/3plates.backup-test')
'''


class DeploySafety(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        for name in ('pnpm', 'ssh', 'rsync', 'curl'):
            executable = self.bin / name
            executable.write_text(MOCK)
            executable.chmod(0o755)
        self.log = self.root / 'calls'
        self.env = {
            'PATH': str(self.bin) + os.pathsep + os.defpath,
            'WEB_EXPORT_DIR': str(self.root / 'new output'),
            'MOCK_LOG': str(self.log),
            'SSH_TIMEOUT_RETRIES': '0',
        }

    def run_deploy(self, **env):
        return subprocess.run(['bash', str(SCRIPT)], env={**self.env, **env},
                              capture_output=True, text=True)

    def test_existing_export_directory_is_never_deleted(self):
        marker = self.root / 'keep'
        marker.write_text('keep')
        result = self.run_deploy(WEB_EXPORT_DIR=str(self.root))
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(marker.read_text(), 'keep')
        self.assertFalse(self.log.exists())

    def test_export_symlink_is_rejected(self):
        link = self.root / 'link'
        link.symlink_to(self.root, target_is_directory=True)
        self.assertNotEqual(self.run_deploy(WEB_EXPORT_DIR=str(link)).returncode, 0)
        self.assertTrue(link.is_symlink())
        self.assertFalse(self.log.exists())

    def test_remote_shell_injection_and_root_are_rejected(self):
        for remote in ('/', '/var/www/../..', '/var/www/$(touch injected)', '/var/www/test;echo bad'):
            with self.subTest(remote=remote):
                self.assertNotEqual(self.run_deploy(REMOTE_WEB_DIR=remote).returncode, 0)
                self.assertFalse(self.log.exists())

    def test_upload_failure_stops_before_http_check(self):
        result = self.run_deploy(MOCK_FAIL='rsync')
        self.assertEqual(result.returncode, 42, result.stderr)
        calls = self.log.read_text()
        self.assertNotIn('"curl"', calls)
        self.assertIn('"exit"', calls)

    def test_success_uses_checked_shared_connection(self):
        result = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / 'new output').stat().st_mode & 0o777, 0o755)
        calls = self.log.read_text()
        self.assertIn('ControlPath=', calls)
        self.assertIn('"check"', calls)
        self.assertIn('"exit"', calls)
        self.assertIn('"curl"', calls)


if __name__ == '__main__':
    unittest.main()
