/** 純讀取靈獸重製 proof；固定與 285d04618 的非名稱資料比較。 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const runner = fileURLToPath(new URL('./refresh-spirit-beast-redesign.mjs', import.meta.url));
const result = spawnSync(process.execPath, [runner, 'verify'], { cwd: new URL('..', import.meta.url), stdio: 'inherit', windowsHide: true });
process.exitCode = result.status ?? 1;
