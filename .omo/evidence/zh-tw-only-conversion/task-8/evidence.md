# Task-8 Evidence — GM 系統郵件簡轉繁一鍵相容轉換（雙表修復）

**日期：** 2026-08-22
**性質：** F1 REJECT 修復（Todo 8 補齊 `player_mail_archive`）+ F2 次要項修復
**狀態：** 代碼完成，唯讀驗證通過；待 orchestrator 統一 verify + LXC 重部署後線上複驗

## 1. F1 缺口與修復摘要

F1（`.omo/evidence/zh-tw-only-conversion/final-wave/F1-plan-compliance.md` Todo 8 FAIL）指出：
`MailSnapshotTraditionalizeConversion` 只操作 `player_mail`，`loadMailRows` / `ensureBackupTable` /
殘留掃描全部單表，違反計畫 Scope:29 與 Todo 8:170-173「`player_mail` **及** `player_mail_archive`
都要轉換」。

本次修復：以**表描述符驅動的雙表管線**重構，兩張表共用同一套檢測、轉換、CAS、skip-hash、
殘留回讀、冪等標記邏輯。

## 2. 轉換設計（雙表）

### 2.1 表描述符（mail-snapshot-traditionalize.ts）

```ts
interface MailTableDescriptor {
  tableName: string;
  backupTable: string;
  hasUpdatedAtColumn: boolean; // archive 表只有 archived_at，UPDATE 不得觸碰時間戳列
}

const MAIL_TABLE_DESCRIPTORS = [
  { tableName: 'player_mail',        backupTable: 'player_mail_pre_tw_backup',        hasUpdatedAtColumn: true },
  { tableName: 'player_mail_archive', backupTable: 'player_mail_archive_pre_tw_backup', hasUpdatedAtColumn: false },
];
```

關鍵 schema 事實：`player_mail_archive`（mail-persistence.service.ts:1116-1137）與 `player_mail`
欄位同形，但**沒有 `updated_at`**——只有 `archived_at timestamptz NOT NULL DEFAULT now()`。
UPDATE 語句按 `hasUpdatedAtColumn` 條件拼裝 `updated_at = NOW()` 子句，archive 表 UPDATE
完全不觸碰任何時間戳列。

### 2.2 單事務雙表管線

`run()` 流程（apply 模式，單 PostgreSQL 事務覆蓋兩表，任一表拋錯整體 ROLLBACK）：

1. 預掃描兩表（dry-run 與 apply 共用同一 JS 檢測口徑：詞級 VOCABULARY_CN_TO_TW +
   opencc cn→tw 兩段式，保護詞哨兵掩碼）
2. 逐表執行 `convertSingleTable()`：
   - 建獨立備份表（`to_regclass` 已存在則跳過，冪等）
   - 分類：非 system 行 → skip（byte-hash 基線）；已台灣標準 system 行 → skip；
     含簡體 system 行 → pending
   - 逐行 CAS UPDATE（`WHERE mail_id=? AND sender_type='system' AND title IS NOT DISTINCT FROM ?...`）
   - 跳過行回讀字節級 hash 驗證
   - 殘留簡體 system 行回讀計數（必須為 0）
3. 聚合：`convertedRows` / `residualSimplifiedRows` 取逐表實際值之和（CAS 漂移會讓實際低於掃描預估）
4. 逐表寫轉換標記：`player_mail_conversion_meta`，
   `conversion_key = mail_snapshot_traditionalize:<table>`（每表一條，ON CONFLICT upsert 冪等），
   同一次 apply 共用同一 batchId
5. 審計：gm_audit_log 的 after payload 含逐表 breakdown

### 2.3 結果負載

`MailSnapshotTraditionalizeRunResult` 新增：

- `tables: MailSnapshotTraditionalizeTableResult[]` —— 逐表明細
  （tableName / backupTable / backupTableCreated / matchedRows / convertedRows / skippedRows /
  residualSimplifiedRows）；dry-run 也給出 breakdown（backupTableCreated=false、residual=0）
- 頂層 `matchedRows` / `convertedRows` / `skippedRows` / `failedRows` / `verifiedRows` /
  `residualSimplifiedRows` 為雙表聚合
- 移除舊單表欄位 `backupTable` / `backupTableCreated`（由 tables[] 取代；唯一消費方是本檔
  recordAudit/writeConversionMarker 與 smoke，均已同步）
- sample id 加表名前綴（`<table>:<mail_id>`），防兩表 mail_id 撞號混淆
- 錯誤碼加表名前綴：`<table>_convert_row_drift:<id>`、`<table>_skip_verify_failed:<id>`、
  `<table>_skip_rows_not_byte_identical:<n>`、`<table>_residual_simplified_rows:<n>`

## 3. F2 次要項修復

| 項目 | 修復 |
| --- | --- |
| 原 :209 註解宣稱 CAS 漂移「失敗回滾全部」 | 改為「漂移行記為失敗並繼續處理後續行，其餘成功行隨事務一併提交」——與實際行為一致（註解保持簡中，符合計畫 Must NOT #3） |
| `normalizeSafeInteger` 死碼 | 已刪除（檔內零引用、未 export）；`normalizeRequiredString` / `normalizeNullableString` 有使用，保留 |

## 4. Smoke 擴充（mail-traditionalize-conversion-smoke.ts）

註冊不變：smoke-suite.ts:259 `mail-traditionalize-conversion`（standalone，persistence case 名單
:392/:436）。隔離與自清理機制不變：獨占 schema `smoke_<pid>_<ts>` + search_path 注入 +
finally DROP SCHEMA CASCADE，真實生產表零接觸。

Fixture 擴充為雙表 7 行：

| 表 | 行 | sender_type | 期望 |
| --- | --- | --- | --- |
| player_mail | sys:1 / sys:2 | system（簡體） | 轉換（詞級+字級精確斷言） |
| player_mail | sys:3 | system（已繁） | skip byte-identical |
| player_mail | user:1 | player | skip byte-identical |
| player_mail_archive | arch:sys:1 | system（簡體） | 轉換（歷史郵件歸檔通知→歷史郵件歸檔通知 繁體） |
| player_mail_archive | arch:sys:2 | system（已繁） | skip byte-identical |
| player_mail_archive | arch:user:1 | player | skip byte-identical |

斷言覆蓋：

1. dry-run：matched=7 / converted=3 / 雙表 breakdown（archive converted=1），只報數不改庫
2. 首輪 apply：converted=3 / skipped=4 / failed=0 / residual=0；逐表 breakdown
   （player_mail {4,2,2}、archive {3,1,2}）；兩張備份表均新建
3. 轉換內容精確斷言（title/body/sender_label，兩表分別回讀）
4. 跳過行字節級 hash 前後一致（兩表的 skip 行都驗證）
5. archive 表 `archived_at` 轉換前後 ISO 字串完全一致（時間戳列不被觸碰的專屬斷言）
6. 兩張備份表行數（4 / 3）
7. 標記表恰 2 條逐表 key，converted_rows 分別 2/1、residual 均 0、共用同一 batchId
8. 二輪冪等：converted=0 / skipped=7 / residual=0 / 兩表 backupTableCreated=false / 標記仍 2 條
9. metadata_jsonb 不被改動（兩表各抽一行）

## 5. Nest 接線點（既有，無需改動）

- Provider 註冊：`packages/server/src/http/native-http.registry.ts:47`（import）、`:96`（providers 清單）
- Controller 注入：`packages/server/src/http/native/native-gm.controller.ts:294`
- 成對端點（既有）：
  - `POST /api/gm/shortcuts/compat/mail-traditionalize/dry-run`（native-gm.controller.ts:1312）
  - `POST /api/gm/shortcuts/compat/mail-traditionalize/apply`（native-gm.controller.ts:1320）
- Controller 直接透傳 conversion result，新 `tables[]` 欄位自動隨 JSON 下發，GM API 可直接讀逐表明細

## 6. 詞彙一致性 smoke（未動）

`packages/server/src/tools/tw-vocabulary-consistency-smoke.ts` 本輪零修改（F1 未列缺口）。
註冊於 smoke-suite.ts:260 `tw-vocabulary-consistency`。

## 7. 驗證結果

| 驗證 | 結果 |
| --- | --- |
| `pnpm --filter @mud/server exec tsc --noEmit` | **EXIT=0**（唯讀，未跑 compile 防 dist 衝突） |
| LSP diagnostics | daemon 忙碌逾時（平行任務佔用）；tsc 全專案型別檢查已涵蓋兩改動檔 |
| with-db smoke 實跑 | 由 orchestrator 統一執行 `verify:release:with-db`（本機無 Postgres，MUST NOT 提前跑 compile/verify 鏈） |

## 8. 待辦交接（orchestrator）

- 生產環境已跑過單表版（player_mail 1 行已轉、`player_mail_pre_tw_backup` 已存在、
  舊 marker key `mail_snapshot_traditionalize` 留存為歷史記錄）。新版部署後在 LXC 重跑
  dry-run 應顯示 **archive 表 pending 行**；apply 後逐表 residual=0、二次 apply 冪等 0 轉換。
- 新 marker key 為 `mail_snapshot_traditionalize:player_mail` 與
  `mail_snapshot_traditionalize:player_mail_archive`；舊聚合 key 不再寫入（歷史行無害）。
