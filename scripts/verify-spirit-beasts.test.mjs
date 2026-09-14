import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const runner = fileURLToPath(new URL('./verify-spirit-beasts.mjs', import.meta.url));
const bootstrap = fileURLToPath(new URL('./prepare-spirit-beast-test-db.mjs', import.meta.url));
const secret = 'do-not-print-this-password';
for (const [name, value] of [
  ['invalid URL', secret],
  ['remote host', `postgres://user:${secret}@192.0.2.1/test_spirit`],
  ['ordinary database', `postgres://user:${secret}@127.0.0.1/game`],
  ['non-PostgreSQL protocol', `https://user:${secret}@127.0.0.1/test_spirit`],
]) {
  for (const [entry, args] of [[runner, ['--with-db']], [bootstrap, []]]) {
  test(`${entry === runner ? '驗證器' : '初始化器'}拒絕 ${name} 並隱藏憑證`, () => {
    const result = spawnSync(process.execPath, [entry, ...args], {
      encoding: 'utf8', timeout: 10000, windowsHide: true,
      env: { ...process.env, SPIRIT_BEAST_TEST_ENV: '', SERVER_DATABASE_URL: value,
        DATABASE_URL: '', DATABASE_POOLER_URL: '', SERVER_DATABASE_POOLER_URL: '' },
    });
    assert.equal(result.status, 1);
    assert.equal(result.error, undefined);
    const output = result.stdout + result.stderr;
    assert.equal(output.includes(secret), false);
    assert.equal(output.includes('"label":"content"'), false, '拒絕時不可開始編譯或資料庫案例');
  });
  }
}
