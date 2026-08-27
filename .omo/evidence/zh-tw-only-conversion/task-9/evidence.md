# Task-9 證據：修復 ConfigModule 讀取 `.env` 目錄導致 EISDIR 啟動崩潰

## 根因

`packages/server/src/app.module.ts:273` 使用 `ConfigModule.forRoot({ isGlobal: true })`。
NestJS ConfigModule 預設會讀取 repo 根目錄的 `.env` **檔案**，但本環境 `.env` 是**目錄**
（存放使用者憑證 `.env/pve.env`、`.env/istoreos.env`、`.env/nas.env`，gitignored）。
把目錄當檔案讀取會拋 `EISDIR: illegal operation on a directory, read`，導致
verify:quick smoke 套件（runtime/session 案例）啟動崩潰。

## 修復

```diff
@@ app.module.ts:273 @@
-    ConfigModule.forRoot({ isGlobal: true }),
+    // envFilePath: [] 表示不讀 .env 檔案（本環境 .env 是目錄，讀取會 EISDIR）；
+    // 環境變數一律由 process.env 注入（verify 鏈 / load-local-runtime-env 負責）。
+    ConfigModule.forRoot({ isGlobal: true, envFilePath: [] }),
```

`envFilePath: []` = 空陣列表示不載入任何 env 檔案，環境變數完全來自 `process.env`
（verify 鏈以 `SERVER_SKIP_LOCAL_ENV_AUTOLOAD: '1'` + process.env 注入）。

## 驗證

### 1. 編譯

```
pnpm --filter @mud/server compile
EXIT=0
```

### 2. 啟動 smoke（runtime 案例，模擬 verify 鏈 env）

```
SERVER_SKIP_LOCAL_ENV_AUTOLOAD=1 node packages/server/dist/tools/run-stable-smoke-suite.js --case runtime
{
  "ok": true,
  "url": "http://127.0.0.1:57368",
  "playerId": "p_752e57ab-f575-454d-9895-16503f93874f",
  "events": ["initSession","mapEnter","worldDelta","selfDelta","panelDelta",...]
}
EXIT=0
```

伺服器乾淨啟動，session 初始化、進圖、world/self/panel delta 正常流動，無 EISDIR 崩潰。

### 3. 修復確認

```
rg -n "envFilePath" packages/server/src/app.module.ts
→ 命中 envFilePath: []
```

## 補充說明

- 啟動日誌中的 `[启动配置] 无法读取本地环境变量文件，已跳过：path=...\.env code=EISDIR`
  來自 `packages/server/src/config/load-local-runtime-env.ts:106`，是**設計上的優雅跳過**
  （console.warn + return null，非崩潰），且受 `SERVER_SKIP_LOCAL_ENV_AUTOLOAD` 門控；
  verify 鏈設為 '1' 時完全不觸發。此機制不在本次修復範圍（MUST NOT 限制不得改動）。
- 未刪除 / 未改名 `.env` 目錄（使用者憑證）。
- 未改動 docker-stack 檔案。
- 未 commit。
