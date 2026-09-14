#!/usr/bin/env node
/** 以相同 Node 執行檔啟動腳本，跨平台傳入臨時環境變數，不經 shell。 */
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const separator = args.indexOf('--');
if (separator < 0 || !args[separator + 1]) {
  console.error('用法：node scripts/run-node-with-env.mjs KEY=value ... -- script.js [args...]');
  process.exit(2);
}
const env = { ...process.env };
for (const assignment of args.slice(0, separator)) {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(assignment);
  if (!match) {
    console.error('環境變數參數必須是 KEY=value');
    process.exit(2);
  }
  env[match[1]] = match[2];
}
const child = spawn(process.execPath, args.slice(separator + 1), {
  env, stdio: 'inherit', windowsHide: true,
});
child.once('error', () => { console.error('無法啟動 Node 子程序'); process.exitCode = 1; });
child.once('close', (code) => { process.exitCode = code ?? 1; });
