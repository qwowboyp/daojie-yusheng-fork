import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const checks = [
  { executable: 'node', argv: ['--test', 'scripts/scoped-source-verification.test.mjs'], cwd: repoRoot },
  { executable: 'node', argv: ['scripts/client-release/check-client-release.mjs'], cwd: repoRoot },
  { executable: 'python', argv: ['-B', '-X', 'utf8', 'test_preflight.py'], cwd: path.join(repoRoot, 'scripts', 'client-release') },
  {
    executable: 'python',
    argv: ['-B', '-X', 'utf8', '-m', 'unittest', 'test_remote_release.ReceiptValidationTests'],
    cwd: path.join(repoRoot, 'scripts', 'client-release'),
  },
];

for (const check of checks) {
  const result = spawnSync(check.executable, check.argv, {
    cwd: check.cwd,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

process.stdout.write('client release contracts passed\n');
