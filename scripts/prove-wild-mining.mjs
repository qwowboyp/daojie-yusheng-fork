/** Focused regression coverage for wild mining and the shared facility context. Run after server tsc. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
for (const name of ['world-runtime-force-attack-mining', 'world-runtime-mining-job', 'world-runtime-damageable-tile', 'spirit-beast-facility-pipeline']) {
  const result = spawnSync(process.execPath, [`packages/server/dist/tools/${name}-smoke.js`], {
    cwd: root, stdio: 'inherit', windowsHide: true,
    env: { ...process.env, SERVER_SKIP_LOCAL_ENV_AUTOLOAD: '1' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
