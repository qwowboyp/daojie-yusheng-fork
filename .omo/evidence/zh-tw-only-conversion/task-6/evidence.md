# Task-6 Evidence — 拆除雙語轉換層（收斂單一 zh-TW）

日期：2026-08-19 · 計畫：zh-tw-only-conversion · 未提交（依 MUST NOT）

## 目標

拆除雙語轉換層（catalog / overrides / 語言切換 UI / locale 常數），收斂單一 locale zh-TW，解鎖 client typecheck（原 `i18n.ts:31` TS7053）。

## 變更清單

### (e) shared 常數 — `packages/shared/src/constants/ui/storage.ts`
- `SUPPORTED_LOCALES = ['zh-TW'] as const`（原含 zh-CN）
- `DEFAULT_CLIENT_LOCALE = 'zh-TW'`
- 刪除 `LANGUAGE_STORAGE_KEY`
- rg 確認僅 `language-preferences.ts` 使用該 key；既有玩家 localStorage `zh-CN` 殘留自然落到預設 zh-TW，無需遷移

### (a) 目錄生成器 — 刪除
- `scripts/generate-content-name-catalog.mjs`（刪除）
- `packages/client/src/constants/world/content-name-catalog.generated.json`（刪除）
- `packages/client/package.json:41` `generate:content-name-catalog` script（刪除）
- prebuild 鏈移除該段（現為 shared → editor-catalog → item-sources → building-catalog → i18n）

### (b) content-name-locale.ts — 簡化（87 → 43 行）
- 移除 catalog import + `lookupTwValue` + `ContentNameCatalog` interface
- `resolveContentDisplayName` 直接回傳 fallback（server 已發繁中）
- `resolveNoticeTokenValue` 回傳 `String(value)`
- 刪除 `isTraditionalChineseLocale`（rg 確認 0 call sites）
- 導出函式簽名穩定（`item-display-name.ts` / `structured-notice-display.ts` 消費端零改動）

### (c) 語言切換 UI — 移除
- `settings-panel.ts`：刪除 :444-457 handlers + :814-828 語言區段（含 import）
- `SettingsPanel.tsx`：刪除 :533-543 `handleLanguageChange` + :602-623 JSX（含 import）
- `zh-TW.csv`：刪除 7 個 `settings.language.*` keys（:1870-1876）
- `generate:i18n` 重生成 → `i18n.generated.ts` 3960 條（原 3967）

### (d) language-preferences.ts — 收斂（94 → 17 行）
- `getLanguagePreference()` 恆回 `'zh-TW'`（`DEFAULT_CLIENT_LOCALE`）
- `initializeLanguagePreference()` 為 no-op 回 `'zh-TW'`（`main.ts:53,60` 保留調用不需改）
- 刪除 localStorage 讀寫、切換事件、`SUPPORTED_LOCALES` re-export、`ClientLocale` 型別 re-export 保留（i18n.ts 依賴）

### proof 期望值同步（todo 5 轉繁後過期，build/verify 鏈必要修正）
build 鏈 5 檔 + verify 鏈 1 檔的簡中斷言對齊實際繁中 UI：
- `prove-building-material-candidates.mjs`：aria-label 4 值繁中
- `prove-access-policy-editor.mjs`：模式/按鈕/狀態文本繁中（fixture 假資料如「青云剑客」保持簡中）
- `prove-party-client.mjs`：僅隊長提示/友傷說明/自動匹配/隊長離線繁中
- `prove-technique-unification-mobile.mjs`：統法臺/強度/頁碼/總覽/權限等繁中（fixture 名「太玄归一真经」保持簡中；shared `SECT_MEMBER_ROLE_LABELS` 簡中保持）
- `prove-technique-generation-batch.mjs`：批量領悟/確認批量領悟繁中（面板源碼混雜，單部領悟仍簡中）
- `verify-technique-preview.mjs`：server content 文本繁中；shared label（体魄/经脉/无属性灵气）+ bonus-summary 輸出簡中保持

## 驗證結果

| 步驟 | 結果 |
|---|---|
| `pnpm build:shared` | ✅ exit 0（8 條 check-*.cjs 全過） |
| `pnpm --filter @mud/client build` | ✅ exit 0（tsc + vite + 30+ proofs） |
| `pnpm verify:client` | ✅ exit 0（gm-login-autofill → build:client → technique-preview → statistic-history） |
| rg zero-hits | ✅ `content-name-catalog|zh-TW.overrides|LANGUAGE_STORAGE_KEY|settings.language` in packages 零命中 |
| CSV check | ✅ `{"ok":true,"violations":[]}` |
| bundle size | 10.79 → 10.45 MB（−0.34 MB / −3.1%） |
| catalog in dist | ✅ 0 命中（不再單獨成 chunk） |

### Bundle 證據
- before：235 files / 11,310,994 bytes / 10.79 MB（build 前 dist 為 todo 5 舊版）
- after：235 files / 10,961,225 bytes / 10.45 MB
- 檔案數不變（catalog 本就內聯進 main-panels chunk，本次直接移除內容）

## 環境注意
- `proof:floating-hit` 需本機 Chrome：`$env:CHROME_BIN = "C:\Program Files\Google\Chrome\Application\chrome.exe"`（browser-proof-runtime.mjs 只認 CHROME_BIN + Linux 路徑）
- 每次 build/verify 都需設 CHROME_BIN，否則 fail

## 偏差報告
- 無 MUST NOT 違反：未動 server、未動 editor-catalog/item-sources/building-catalog 生成器、保留 t()/hasI18nKey/applyStaticI18n、未提交
- proof 腳本修改屬「todo 5 轉繁後過期期望值」的必要同步，非新增行為變化
