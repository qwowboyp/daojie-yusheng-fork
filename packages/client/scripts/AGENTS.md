# packages/client/scripts — 客戶端 proof / 生成器腳本

**本目錄：82 檔案（無子目錄）**：prove-* 62、check-* 9、verify-* 4、generate-* 3、其他 4（`browser-proof-runtime.mjs` / `diagnose-floating-hit.mjs` / `i18n-csv.mjs` / `read-panels-css.mjs`）。`.mjs` 80 + `.js` 2；`packages/client/package.json` 64 條 `proof:*` 全部指向此處。建置與 prebuild 鏈概覽屬上層 `packages/client/AGENTS.md`，本文件只寫腳本層規約。

## STRUCTURE

| 角色 | 數量 | 職責 |
|---|---|---|
| prove-* | 62 | 行為 proof；46 檔引用 `browser-proof-runtime.mjs`（起 Vite + 本機 Chrome CDP），其餘純 Node 斷言 |
| check-* | 9 | 靜態契約檢查，直讀 `src/` 不起瀏覽器；2 檔 `.js`：`check-spatial-cache-contracts.js`、`check-client-production-boundaries.js` |
| verify-* | 4 | 獨立驗證器；`verify-player-statistic-history.mjs` 掛 `proof:player-statistic-history`（package.json:63） |
| generate-* | 3 | `generate-item-sources` / `generate-building-catalog` / `generate-i18n`（editor-catalog 不在此目錄，見 WHERE） |
| browser-proof-runtime.mjs | 1（368 行） | 瀏覽器 proof 運行時：臨時 Vite server + 本機 Chrome + CDP + 統一清理 |
| 其他支撐 | 3 | `diagnose-floating-hit.mjs`（掛 `proof:floating-hit`，package.json:51）、`i18n-csv.mjs`（文案 CLI）、`read-panels-css.mjs`（樣式讀取 helper，4 檔消費） |

## WHERE TO LOOK

| 任務 | 位置 |
|---|---|
| proof 接入建置 | `packages/client/package.json` `proof:*`（64 條）；`build`（:60）= `tsc --noEmit` → `proof:description-art-assets` + `proof:building-art-versioned-url` → `vite build` → 其餘 proof 依序守門 |
| 生成器鏈（精確字串） | package.json:57 `prebuild` = `pnpm --dir ../shared build && generate:editor-catalog && generate:item-sources && generate:building-catalog && generate:i18n` |
| editor-catalog 生成 | `scripts/generate-editor-catalog.mjs`（repo 根；`generate:editor-catalog` 以 `../../scripts/...` 引用，package.json:52） |
| 物品來源 / 怪物地點產物 | `generate-item-sources.mjs:54,58` → `src/constants/world/item-sources.generated.json`、`monster-locations.generated.json` |
| 建築目錄產物 | `generate-building-catalog.mjs:10-12` → `src/constants/world/building-catalog.generated.json`（輸入 `packages/server/data/content/building-runtime/buildings.json`） |
| i18n 產物 | `generate-i18n.mjs:17-18`：`src/content/i18n/zh-TW.csv` → `src/constants/ui/i18n.generated.ts` |
| 瀏覽器 proof 契約 / 範例 | `browser-proof-runtime.mjs:222`（`withClientBrowserProof`）；範例 `prove-hud-layout.mjs`、`prove-party-client.mjs` |
| 靜態 TS 檢查寫法 | `check-socket-outbound-gate.mjs:18-30`（`ts.transpileModule` 即時轉譯後斷言） |
| 面板 CSS 整體讀取 | `read-panels-css.mjs:9`（`PANELS_CSS_ORDER` 對齊 `src/main.ts` import 順序） |
| i18n 文案增查改 | `pnpm --filter @mud/client i18n:csv ...`（檔案鎖 30s + 原子替換，`i18n-csv.mjs:16`） |

## CONVENTIONS

- 斷言一律 `node:assert/strict`（73/82 檔）：assert 擲出無人接 = Node 非零退出即失敗；少數明確 `process.exitCode = 1`（`i18n-csv.mjs:355`、`check-terrain-hd-atlases.mjs:105`）、逾時 `process.exit(124)`（`prove-game-workspace.mjs:37`）
- 執行：repo 根 `pnpm --filter @mud/client proof:<name>`；單檔除錯 `node ./scripts/<file>.mjs`
- 瀏覽器 proof 一律 `await withClientBrowserProof({ viewport, profilePrefix }, cb)` 取 `cdp`；運行時自起 vite（port 0，:284）→ 找本機 Chrome（`browser-proof-runtime.mjs:53`，`CHROME_BIN` 最優先，非 Chrome for Testing）→ CDP 命令逾時 45s（:12）
- 清理收口在 `finally`（`browser-proof-runtime.mjs:365-367`）：CDP `Browser.close`（:242）→ SIGTERM/SIGKILL（`stopChild` :169-177）→ 關 vite → 刪暫存 profile；全域 `closeAllClientBrowserProofs()`（:213）。殘留 Chrome 規則見根 AGENTS.md，本目錄由 runtime 統一兌現
- 生成檔比對後才寫、內容相同不落盤（`generate-building-catalog.mjs:41-46`）；`generate:building-catalog` 依 `process.cwd()`（:9），只在 `packages/client` 內執行

## ANTI-PATTERNS

- 禁止繞過 `withClientBrowserProof` 自 spawn Chrome：清理註冊表與 `finally` teardown（`browser-proof-runtime.mjs:15,365`）會漏 → 殘留 Chrome 進程
- 禁止跳過 CDP `Browser.close` 直接殺 Chrome：Windows 殘留 `first_party_sets.db-journal` 句柄 → profile 刪除 EBUSY（`browser-proof-runtime.mjs:240-241`）
- 腳本存在 ≠ 有門禁：10 檔未掛 `proof:*`；`check-terrain-hd-atlases.mjs` 由 `prove-terrain-hd-browser.mjs:39` import、`prove-spirit-beast-panel.mjs` 由 repo 根 `scripts/verify-spirit-beasts.mjs:152` 呼叫，其餘 8 檔（如 `prove-changelog-login-once.mjs`、`verify-content-resolver-batching.mjs`）未見任何 package.json / 倉庫腳本引用，接上 `proof:*` 才進 `build`
- 禁止手改 `src/constants/**/*.generated.*`：下次生成比對覆寫（`generate-building-catalog.mjs:41-46`；`i18n.generated.ts` 上層已列）
- 禁止 proof 內自行 `rm` 暫存 profile 或 kill Chrome：teardown 統一處理，profile 清理失敗僅 warn 不判敗（`browser-proof-runtime.mjs:258-266`）
