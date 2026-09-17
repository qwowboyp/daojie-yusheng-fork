/** 驗證宗門派生界門可作為材料跨圖導航的首段路徑。 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const smokeFiles = [
  'check-production-boundaries.js',
  'world-runtime-sect-navigation-smoke.js',
  'world-runtime-movement-smoke.js',
  'world-runtime-world-access-smoke.js',
  'sect-derived-runtime-state-smoke.js',
  'world-runtime-player-movement-capability-smoke.js',
];

for (const smokeFile of smokeFiles) {
  const result = spawnSync(process.execPath, [path.join('packages', 'server', 'dist', 'tools', smokeFile)], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(JSON.stringify({ ok: true, case: 'sect-material-navigation', smokeFiles }));
