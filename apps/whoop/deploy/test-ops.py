"""Exercise deployment failure paths with isolated paths and command doubles."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).parent


class OperationsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.env = dict(os.environ, PATH=f"{self.bin}:{os.environ['PATH']}", TEST_ROOT=str(self.root))
        stub = self.bin / "stub"
        stub.write_text('''#!/usr/bin/env python3
import os, pathlib, sys
root = pathlib.Path(os.environ['TEST_ROOT'])
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
with (root / 'commands').open('a') as log: log.write(name + ' ' + ' '.join(args) + '\\n')
if name == 'docker':
    if os.environ.get('DB_FAIL') == '1' and any('DELETE FROM heartbeat' in arg for arg in args): sys.exit(1)
    print('0')
elif name == 'systemctl' and args[:1] == ['restart']:
    marker = root / 'restarted'
    if not marker.exists():
        marker.touch()
        if os.environ.get('RESTART_FAIL') == '1': sys.exit(1)
elif name == 'curl' and os.environ.get('NOT_READY') == '1': sys.exit(1)
elif name == 'stat': print(str(os.getuid()) + ':600' if '%u:%a' in args else '0')
elif name == 'age': pathlib.Path(args[args.index('-o') + 1]).touch()
elif name == 'timeout':
    if args[2] == 'rsync' and os.environ.get('TRANSFER_TIMEOUT') == '1': sys.exit(124)
    if args[2] == 'docker' and os.environ.get('DB_TIMEOUT') == '1': sys.exit(124)
    if args[2].endswith('gallant-alert') and os.environ.get('ALERT_TIMEOUT') == '1': sys.exit(124)
    os.execvp(args[2], args[2:])
elif name == 'install' and args[0] == '-d': pathlib.Path(args[-1]).mkdir(parents=True, exist_ok=True)
''')
        stub.chmod(0o755)
        for name in ['id', 'pnpm', 'chown', 'chmod', 'runuser', 'docker', 'systemctl', 'curl', 'sleep', 'stat', 'timeout', 'install', 'node', 'age', 'rsync']:
            (self.bin / name).symlink_to(stub)
        (self.root / 'etc').mkdir()
        for name in ['gallant-dashboard.env', 'gallant-postgres.env']:
            (self.root / 'etc' / name).touch()
        self.app = self.root / 'opt/gallant-dashboard'
        self.release = self.app / 'releases/new'
        self.previous = self.app / 'releases/previous'
        for release in [self.release, self.previous]:
            for relative in ['dist/server/server/main.js', 'dist/server/server/worker.js', 'dist/web/index.html', 'deploy/share-policy-v1']:
                path = release / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.touch()
            backup = release / 'deploy/backup.sh'
            backup.write_text('#!/bin/sh\nexit 0\n')
            backup.chmod(0o755)
        (self.app / 'current').symlink_to(self.previous)
        self.ops = self.root / 'var/lib/gallant-ops'
        self.ops.mkdir(parents=True)
        (self.ops / 'restore-success').touch()
        backups = self.root / 'var/backups/gallant'
        backups.mkdir(parents=True)
        (backups / 'gallant-test.dump').touch()
        alert = self.root / 'etc/gallant-alert'
        alert.write_text('#!/bin/sh\ncat >> "$TEST_ROOT/delivered"\n')
        alert.chmod(0o755)

    def run_script(self, name, **env):
        script = self.root / name
        text = (SOURCE / name).read_text()
        for prefix in ['/opt/gallant-dashboard', '/etc', '/var']:
            text = text.replace(prefix, str(self.root) + prefix)
        script.write_text(text)
        args = [str(self.release)] if name == 'activate.sh' else [str(self.root / 'var/backups/gallant/gallant-test.dump')] if name == 'offsite.sh' else []
        return subprocess.run(['bash', str(script), *args], env=dict(self.env, **env), capture_output=True, text=True, timeout=10)

    def test_backup_timeout_does_not_publish_partial_dump(self):
        result = self.run_script('backup.sh', DB_TIMEOUT='1')
        self.assertEqual(result.returncode, 124, result.stderr)
        self.assertEqual([p.name for p in (self.root / 'var/backups/gallant').iterdir()], ['gallant-test.dump'])

    def test_backup_bounds_database_lock_wait_and_verifies_dump(self):
        result = self.run_script('backup.sh')
        self.assertEqual(result.returncode, 0, result.stderr)
        log = (self.root / 'commands').read_text()
        self.assertIn('--lock-wait-timeout=60s', log)
        self.assertIn('timeout --kill-after=10s 20m docker exec', log)
        self.assertIn('pg_restore --list', log)

    def test_restart_failure_rolls_back(self):
        result = self.run_script('activate.sh', RESTART_FAIL='1')
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertEqual((self.app / 'current').resolve(), self.previous)

    def test_missing_worker_rejected_before_switch(self):
        (self.release / 'dist/server/server/worker.js').unlink()
        self.assertNotEqual(self.run_script('activate.sh').returncode, 0)
        self.assertEqual((self.app / 'current').resolve(), self.previous)

    def test_old_heartbeat_is_removed_before_restart_and_readiness(self):
        result = self.run_script('activate.sh')
        self.assertEqual(result.returncode, 0, result.stderr)
        log = (self.root / 'commands').read_text()
        self.assertLess(log.index('systemctl stop gallant-worker'), log.index('DELETE FROM heartbeat'))
        self.assertLess(log.index('DELETE FROM heartbeat'), log.index('systemctl restart gallant-web'))
        self.assertLess(log.index('systemctl restart gallant-web'), log.index('curl'))
        self.assertEqual((self.app / 'current').resolve(), self.release)

    def test_readiness_failure_rolls_back(self):
        self.assertEqual(self.run_script('activate.sh', NOT_READY='1').returncode, 1)
        self.assertEqual((self.app / 'current').resolve(), self.previous)

    def test_failed_heartbeat_reset_rolls_back(self):
        self.assertEqual(self.run_script('activate.sh', DB_FAIL='1').returncode, 1)
        self.assertEqual((self.app / 'current').resolve(), self.previous)

    def test_database_timeout_still_delivers_alert(self):
        result = self.run_script('monitor.sh', DB_TIMEOUT='1')
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn('Unable to check synchronization health', (self.root / 'delivered').read_text())
        self.assertIn('timeout --kill-after=2s 10s docker', (self.root / 'commands').read_text())

    def test_delivery_timeout_preserves_status_for_retry(self):
        (self.ops / 'status').write_text('Healthy\n')
        result = self.run_script('monitor.sh', DB_TIMEOUT='1', ALERT_TIMEOUT='1')
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertEqual((self.ops / 'status').read_text(), 'Healthy\n')
        self.assertFalse((self.root / 'delivered').exists())
        self.run_script('monitor.sh', DB_TIMEOUT='1')
        self.assertIn('Unable to check synchronization health', (self.root / 'delivered').read_text())
        self.assertIn('Unable to check synchronization health', (self.ops / 'status').read_text())

    def test_offsite_timeout_does_not_record_success_and_can_retry(self):
        config = self.root / 'etc/gallant-backup-offsite.env'
        config.write_text('BACKUP_HOST=backup@example.test\nBACKUP_DIR=/backups\nBACKUP_RECIPIENT=test-recipient\n')
        config.chmod(0o600)
        result = self.run_script('offsite.sh', TRANSFER_TIMEOUT='1')
        self.assertEqual(result.returncode, 124, result.stderr)
        self.assertFalse((self.ops / 'offsite-success').exists())
        log = (self.root / 'commands').read_text()
        self.assertIn('timeout --kill-after=10s 15m rsync --timeout=120', log)
        age_args = next(line.split() for line in log.splitlines() if line.startswith('age '))
        self.assertFalse(Path(age_args[age_args.index('-o') + 1]).parent.exists())
        result = self.run_script('offsite.sh')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.ops / 'offsite-success').exists())


if __name__ == '__main__':
    unittest.main()
