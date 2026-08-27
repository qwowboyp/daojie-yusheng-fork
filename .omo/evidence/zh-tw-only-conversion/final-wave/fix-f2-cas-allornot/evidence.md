# Fix-F2: CAS 漂移全有或全無語義修復

日期：2026-08-22。範圍：`mail-snapshot-traditionalize.ts` + `mail-traditionalize-conversion-smoke.ts`。唯讀驗證（未 compile / 未跑 verify 鏈 / 未 commit）。

## 1. BLOCKER 回顧

F2 rerun（`../F2-code-quality-rerun.md`）：`convertSingleTable()` 遇 CAS `rowCount !== 1` 只 `failedRows++/continue`，外層仍 COMMIT 並回傳 `ok: true` → 併發漂移時兩表部分轉換永久落庫，GM 拿到成功假象。

## 2. 修復內容（throw 點逐項）

檔案：`packages/server/src/gm/compat-conversions/conversions/mail/mail-snapshot-traditionalize.ts`

| # | throw 點 | 位置（修改後行號） | 語義 |
|---|---|---|---|
| 1 | CAS 漂移 | `convertSingleTable()` 內 UPDATE 迴圈（:344-351 附近），`(updated.rowCount ?? 0) !== 1` → `throw new Error('<table>_convert_row_drift:<mailId>（CAS 防漂移：…整體回滾）')` | 訊息含表名 + row id + 漂移上下文；不再 failedRows++/continue |
| 2 | 跳過行位元組驗證失敗 | `verifySkippedRows()` 改簽名丟棄 `result` 參數、回傳 `void`，任一跳過行缺失或 hash 不一致 → `throw new Error('<table>_skip_verify_failed:<mailId>（…整體回滾）')` | 不再 record-and-continue |
| 3 | 殘餘簡體 > 0 | `convertSingleTable()` 尾段回讀後 `residualSimplifiedRows > 0` → `throw new Error('<table>_residual_simplified_rows:<n>（…整體回滾）'` | apply 後不變量違反即拋出 |

外層 `run()` catch（原 :254 區段）：

- `ROLLBACK` 整個事務（兩表資料、事務內 CREATE 的備份表、marker 全部不落庫）
- **新增 `result.ok = false`**（原本型別鎖死 `ok: true` 字面量、失敗也回 true —— blocker 核心）
- `convertedRows = 0`、`failedRows = max(failedRows, 1)`、error message push 進 `result.errors`
- marker 寫入點在拋出點之後（COMMIT 前），失敗路徑結構性不可能寫入

型別：`MailSnapshotTraditionalizeRunResult` 改為 `extends Omit<GmCompatConversionRunResult, 'ok'>` + `ok: boolean`。不改共享基底 `GmCompatConversionRunResult`（28 個其他轉換消費者零影響）；本結果型別消費點僅 conversion 自身 + controller JSON 透傳 + smoke（rg 驗證）。`failedRows` 欄位保留（dry-run 報告與失敗診斷用；成功時 0）。

Dry-run 完全不變：唯讀、無 CAS、分類計數正常回報、`ok` 恆 true。

## 3. Controller 影響確認

`native-gm.controller.ts:1312-1331` 兩端點經 `executeAuditedGmWrite()`（:1944-1979）：

- 轉換失敗現在走 `run()` 內部 catch → 正常 return `ok:false` 結果體（HTTP 200 + 錯誤明細），無半套狀態；controller 層審計記 success:true 但 `gm_audit_log` 的轉換專用審計（`recordAudit`）以 `failedRows === 0` 判 success:false —— 兩層審計語義一致可辨識失敗
- 掃描期 DB 錯誤 / pool 缺失仍 throw → rethrow → Nest 預設 filter 500 + message，無半套狀態
- **controller 零改動**

## 4. Smoke drift 案例設計

檔案：`packages/server/src/tools/mail-traditionalize-conversion-smoke.ts`（插入點：dry-run 斷言之後、第一輪 apply 之前）

**投毒構造（確定性、無併發時序依賴）**：把 `smoke:mail:sys:1` 的 `sender_label` 置為空串 `''`。
掃描期 `normalizeNullableString('')` 歸一化為 `null` 參與 CAS 快照；UPDATE 謂詞
`sender_label IS NOT DISTINCT FROM NULL` 對存儲值 `''` 判 false → 命中 0 行 → 精準命中 throw 點 #1。
這是任務建議的第二種形態：「matches classification but fails the UPDATE predicate」。
真併發漂移（掃描後外部改列）在單進程 smoke 無法無 hook 確定性插入，且謂詞失配的後續行為與併發漂移完全同路徑。

**斷言鏈**：

1. `driftRun.ok === false`、`matchedRows === 7`（掃描照常）、`convertedRows === 0`、`batchId === null`、`tables.length === 0`（拋出點之前的表也不返回 breakdown）
2. `errors` 含 `player_mail_convert_row_drift:smoke:mail:sys:1`
3. **兩表 rollback**：三行待轉行 title/body 回讀仍是簡體原狀（player_mail 已開始的更新也回退）
4. **零殘留**：`to_regclass` 斷言 `player_mail_pre_tw_backup` / `player_mail_archive_pre_tw_backup` / `player_mail_conversion_meta` 三者皆 null（事務內 CREATE TABLE 隨 ROLLBACK 消失 → marker 未寫）
5. 解除投毒（sender_label 還原 `服务器系统`）→ 既有第一輪 apply 全綠（乾淨重跑成功 = 可恢復性）

**residual > 0 路徑未構造（文件化理由）**：殘餘檢測與分類/轉換共用同一 JS 口徑（`hasSimplifiedContent`），成功 UPDATE 寫入的值就是轉換器輸出；要讓「轉換後的值再被判定為簡體」需要保護詞表（濃郁/馥郁/岩/殘卷）之外的新 opencc 非冪等對——無法廉價確定性構造。mid-transaction 插入新簡體行同樣需要併發 hook。該 throw 路徑與 CAS 漂移共用同一外層 catch→rollback 機制，機制已被案例 1 覆蓋。skip-verify 路徑同理（需掃描後外部改列/刪列）。

## 5. 驗證結果

- `pnpm --filter @mud/server exec tsc --noEmit` → **EXIT=0**（唯讀全專案型別檢查；MUST NOT 禁 compile/verify，DB smoke 留 orchestrator 在 LXC 重部署時跑）
- LSP daemon 兩次逾時（平行任務佔用，learnings Task-8 已知問題）→ 以 tsc 全專案檢查兜底
- 生產相容性：現網 player_mail 1 行已轉換（idempotent）、archive 0 行 → 重部署後 GM apply 對空工作集是 no-op 成功（0 pending → 無 UPDATE → 無 throw → marker upsert 照常）

## 6. 未 commit

工作樹保留 2 檔改動待 orchestrator 統一處理。
