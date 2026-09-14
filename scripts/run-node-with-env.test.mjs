import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const runner = fileURLToPath(new URL('./run-node-with-env.mjs', import.meta.url));
test('傳遞環境變數與原樣參數，保留子程序退出碼', () => {
  const result = spawnSync(process.execPath, [runner, 'SPIRIT_RUNNER_TEST=a b;$literal', 'SPIRIT_RUNNER_EMPTY=', '--',
    '-e', 'console.log(JSON.stringify([process.env.SPIRIT_RUNNER_TEST,process.env.SPIRIT_RUNNER_EMPTY,process.argv[1]]));process.exitCode=7',
    'space & value'], { encoding: 'utf8' });
  assert.equal(result.status, 7);
  assert.deepEqual(JSON.parse(result.stdout), ['a b;$literal', '', 'space & value']);
});
test('格式錯誤先拒絕，不執行腳本或輸出傳入值', () => {
  const result = spawnSync(process.execPath, [runner, 'invalid-private-value', '--', '-e', 'console.log("SHOULD_NOT_RUN")'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.doesNotMatch(result.stderr, /private-value|SHOULD_NOT_RUN/);
});
