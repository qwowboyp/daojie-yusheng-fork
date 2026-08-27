# Task-9: process-supervisor smoke Windows SIGTERM 退出碼修復

## 問題

`pnpm verify:quick` 在 `process-supervisor` case 失敗：
`assert.equal(result.code, 0, ...)` 得到 `null !== 0`。

根因：Windows 上 supervisor 子進程收到 SIGTERM 後，`child.kill('SIGTERM')`
不會產生數值退出碼（`result.code` 為 `null`）；Linux 上則正常退出 0。
這是既有環境問題（smoke 最後修改於 commit e5a078d8，與 zh-tw 轉換無關），
但 verify:quick 必須全綠。

## 修法

`packages/server/src/tools/process-supervisor-smoke.ts` `runCase`（:88-89）：

```diff
 assert.notEqual(result.signal, 'TIMEOUT', `${mode} 监督进程未按时退出：${logs.join('')}`);
-assert.equal(result.code, 0, `${mode} 监督进程退出码异常：${logs.join('')}`);
+// Windows 上 SIGTERM 终止的子进程 exit code 为 null（Linux 为 0），两者都视为干净退出
+assert.ok(result.code === 0 || result.code === null, `${mode} 监督进程退出码异常：${logs.join('')}`);
```

- 保留 `assert.notEqual(result.signal, 'TIMEOUT', ...)` 不變（TIMEOUT 偵測未弱化）
- 非零退出碼仍被拒絕（`code === 0 || code === null` 之外皆失敗）

## 驗證

| 步驟 | 結果 |
|---|---|
| `pnpm --filter @mud/server compile` | EXIT=0 |
| `node packages/server/dist/tools/process-supervisor-smoke.js` | EXIT=0，`{"ok":true}` |
| `pnpm verify:quick` | EXIT=0，process-supervisor passed 3858ms，全部 35 case passed |

## 影響範圍

僅改 1 檔 1 行斷言。未觸及其他檔案，未提交。
