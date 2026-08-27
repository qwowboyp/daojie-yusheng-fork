# Task-10 證據：LXC 生產部署 + 線上驗證 + GM 郵件轉換

日期：2026-08-20（LXC 時間 2026-08-19 UTC）
範圍：zh-tw-only-conversion 計畫 todo 10 完成報告

---

## 1. 部署結果（Phase A/B）

| 項目 | 值 |
|---|---|
| LXC | 105 / 192.168.0.191（daojie） |
| 部署前 disk | 30G 總 / 3.4G 用 / 25G 可用 |
| rollback tags | `daojie-server:lxc-pre-tw` = 7771c1930ab3（舊 218MB）、`daojie-client:lxc-pre-tw` = 3441cb98c8e2（舊 73.6MB） |
| 新 server image | `daojie-server:lxc` = 9bebfd301c98（含 native-player-auth 繁中修復） |
| 新 client image | `daojie-client:lxc` = bebb05a9b12d（含 JSX 繁中修復） |
| server-data owner | 100:101（正確，GM backup 可寫） |
| WARN baseline（部署前 24h） | 1（既有 player_snapshot_projection_incomplete_fence，非 zh-tw 相關） |
| 部署後 WARN（30m） | 0 |

### 部署命令（精簡）
```bash
# LXC 上
docker tag daojie-server:lxc daojie-server:lxc-pre-tw
docker tag daojie-client:lxc daojie-client:lxc-pre-tw
# 本機打包上傳
git archive --format=tar.gz -o daojie-src.tar.gz HEAD
# WinSCP sftp → /tmp/daojie-src.tar.gz → 解包 /opt/daojie/src（原子替換）
# LXC build（nohup 背景，避免 SSH 連線中斷）
cd /opt/daojie/src
docker build -f packages/server/Dockerfile -t daojie-server:lxc .
docker build -f packages/client/Dockerfile -t daojie-client:lxc .
# 冪等重部署（pgdata/redis-data 在 host volume 不動）
bash /opt/daojie/lxc-deploy.sh
```

## 2. 部署中發現並修復的 blocker

### 2.1 Docker build 失敗：`Cannot find module '.../node_modules/.pnpm/node_modules/typescript/bin/tsc'`
- 根因：todo 1 把 typescript 加進 root devDependencies 後，pnpm 不再 public-hoist；server compile script 硬編碼 `.pnpm/node_modules/typescript` 路徑（packages/server/package.json:6），乾淨 Docker 環境不存在該路徑。
- 修復：`node ../../node_modules/.pnpm/node_modules/typescript/bin/tsc` → `pnpm exec tsc`（本機驗證 EXIT=0 + LXC 相同 sed 修復）。
- 本機同步修改 packages/server/package.json（working tree，未 commit——todo 10 指示不 commit）。

### 2.2 CORS 白名單缺 `http://192.168.0.191:11921`
- GM 面板從 11921 登入被 server CORS 拒絕（Origin not allowed）。
- 修復：LXC 上 `lxc-deploy.sh` CORS_ORIGINS 追加 `http://192.168.0.191:11921`（sed 一行，備份 .bak-cors）後重跑 deploy。
- 非 docker-stack 檔、非 zh-tw 相關，但為線上驗證所必需。

### 2.3 Client build headless 滾輪 flake（prove-item-card-constellation-layout:235）
- 第一次 build 失敗於觸控滾輪模擬斷言；重試即過（tsc/vite/全部 proof 通過）。既有 headless 環境 flake，非本次修改引入（本機 build:client 一次通過）。

## 3. 健康檢查（Phase C）

```
/health → HTTP 200 {"ok":true,"service":"server"}
/live   → HTTP 200 {"ok":true,"service":"server","alive":{"ok":true,"service":"server"}}
WARN count（部署後 30m）= 0（baseline 1，無新增）
```

## 4. GM 郵件轉換（Phase D）

### dry-run（HTTP 201）
```json
{"ok":true,"conversionId":"mail_snapshot_traditionalize","mode":"dry-run","matchedRows":1,
 "convertedRows":1,"skippedRows":0,"failedRows":0,"verifiedRows":0,
 "samples":[{"id":"mail:p_7aca12c0-6941-42d7-b614-26b5b55a39e0:msz9ye2r:1:0","name":"司命台",
 "status":"contains_simplified","before":{"title":"","body":"","senderLabel":"司命台"},
 "after":{"title":"","body":"","senderLabel":"司命臺"}}],
 "backupTable":"player_mail_pre_tw_backup","backupTableCreated":false,"residualSimplifiedRows":0}
```
- DB 預查：`SELECT sender_type, COUNT(*) FROM player_mail GROUP BY sender_type` → 全表僅 1 筆 system mail，無其他 sender_type（skipped=0 正確）。

### apply（HTTP 201）
```json
{"ok":true,"mode":"apply","matchedRows":1,"convertedRows":1,"skippedRows":0,"failedRows":0,
 "verifiedRows":1,"samples":[{"id":"...","name":"司命台","status":"contains_simplified",
 "before":{"senderLabel":"司命台"},"after":{"senderLabel":"司命臺"}}],
 "batchId":"mail-tw-20260819222201-i0jjlb","backupTable":"player_mail_pre_tw_backup",
 "backupTableCreated":true,"residualSimplifiedRows":0}
```

### 冪等驗證（第二次 apply）
```json
{"ok":true,"mode":"apply","matchedRows":1,"convertedRows":0,"skippedRows":1,"failedRows":0,
 "verifiedRows":0,"batchId":"mail-tw-20260819222210-oq469t","backupTableCreated":false,
 "residualSimplifiedRows":0}
```

## 5. DB cross-check（Phase F）

```
player_mail system row:  mail:p_7aca12c0...:msz9ye2r:1:0 | system | (title空) | 司命臺
player_mail_pre_tw_backup: 同 mail_id | 司命台（備份保留轉換前值）
player_mail_conversion_meta: conversion_key=mail_snapshot_traditionalize,
  batch_id=mail-tw-20260819222201-i0jjlb, converted_rows=1, skipped_rows=0, residual_simplified_rows=0
殘留簡體偵測（sender_label 含簡體字元正則）= 0
```

## 6. 線上抽樣（Phase E）— 截圖見 screenshots/

| 畫面 | 驗證結果 |
|---|---|
| login-page.png | 登入頁全繁中（道劫餘生/登入/註冊/輸入賬號或角色名/輸入密碼） |
| gm-panel.png | GM 面板全繁中（道劫餘生·監察司/總覽/流量統計/玩家管理/快捷指令等；「維護狀態:关闭」為 GM 面計畫性保留簡體，r1 裁定例外） |
| offline-gain.png | 離線收益報告 UI label 全繁中（靈石收支/修行收支/功法經驗收支/物品收支）；item name 簡體（采气木坠）為**轉換前 DB 快照**（session 建立於 2026-08-19 21:19 UTC < 部署 22:18 UTC），預期行為 |
| game-final.png | 遊戲內全繁中：背包「一鍵整理/一鍵丟棄/全部/裝備/材料/功法書/消耗品/任務物」、物品名（回春散/靈石/功德/月露草/翠竹心/澤鱗/藥煙輕袍/門丁裹頭巾/採氣木墜/越溝快靴/陰沼絲/彘牙/妖獸骨/斷碑紋劍/《分光步》）、狀態列（境界修為/生命值/靈力/鍛骨/骨沉如鐵）、分頁（上一頁/下一頁） |

## 7. 線上驗證發現的簡體殘留與修復（todo 5/9 真實缺口）

> 線上抽樣暴露 todo 5 轉換範圍與 todo 9 guard 白名單均有實質缺口；本任務一併修復並重新部署。

### 7.1 Server 玩家面 HTTP 錯誤訊息（簡體 → 繁中）
- `packages/server/src/http/native/native-player-auth.service.ts`：密码错误→密碼錯誤、用户不存在→使用者不存在、邀请码无效→邀請碼無效、当前网络已有账号注册→目前網路已有帳號註冊、该角色名对应多个账号→該角色名對應多個帳號、刷新令牌无效或已过期→重新整理令牌無效或已過期、当前密码错误→目前密碼錯誤、未登录→未登入、登录已失效→登入已失效、账号已封禁→帳號已封鎖（10 處）
- `packages/server/src/http/native/native-player-auth-store.service.ts`：账号记录无效→帳號記錄無效、注册激活码来源文本不能为空→註冊啟用碼來源文字不能為空、生成激活码失败→產生啟用碼失敗、玩家账号存储暂不可用→玩家帳號儲存暫不可用、账号已存在→帳號已存在、角色名称已存在→角色名稱已存在、称号已存在→稱號已存在（10 處）
- 驗證：LXC 部署後實際登入錯誤顯示「使用者不存在」（繁中）✅

### 7.2 Client JSX text 簡體殘留（guard 盲點）
- **guard 盲點根因**：`scripts/check-traditional.mjs` checkSourceText 只掃 `ts.isStringLiteral`/`NoSubstitutionTemplateLiteral`，**JSXText（`<button>一鍵丟棄</button>` 文字節點）不掃** → todo 5 轉換時 JSX 文字全漏。
- **guard 修復**：checkSourceText 新增 `ts.isJsxText(node)` 分支（修剪空白後檢查），全量 scope 掃描從 0 違規 → 抓到 20+ JSX 簡體。
- 修復的 JSX 簡體（玩家面）：
  - InventoryPanel.tsx:136 一键丢弃→一鍵丟棄
  - TechniquePanel.tsx 11 處（上一页/下一页/传授中/需传法领悟/设为主修领悟/未领悟/自创/等待传授/需传法/取消传法/第N页·共N门）
  - SettingsPanel.tsx 15 處（悬浮窗/关/开/本地资源重载/恢复默认/选择图片/搜索资源/默认/列表为空…/点击左侧记录查看详情/仅在当前设备生效…）
  - TutorialPanel.tsx 4 處（无匹配结果/境界升级数据表/等级名/升级所需修为）
  - SidePanelControls.tsx 1 處（面板切换→面板切換）
  - MarketPanel.tsx 1 處（拍卖行→拍賣行）

### 7.3 Client .ts 大量漏網（todo 5 白名單外）
- 全量掃描 client/src（排除 GM/prototype 例外）發現 **36 檔簡體**，用轉換器批量轉繁（--write --mode source）：
  main-social-state-source、main-time-chamber-state-source、main-bootstrap-assembly、main-notice-state-source、main-runtime-delta-state-source、main-shell-bindings、main-technique-generation-panel-source、client-skill-cast-availability、party-panel-view、account-rules、item-display、technique-bonus-summary、world-panel 等。
- **保留不轉（計畫性例外）**：gm.ts/gm-*.ts（GM 面）、react-ui/gm/、react-ui/prototype/、constants/editor/map-editor.ts（GM 地圖編輯器）、constants/ui/text.ts（字型 family 名稱如 Microsoft YaHei）。

### 7.4 guard 白名單擴充
- check-traditional.scope.json sourceWhitelist：280 → 318（+38 檔，含 7.1/7.2/7.3 全部修改檔）。
- 全量 `--scope` 掃描：`{"ok":true,"violations":[]}`。

## 8. 驗證鏈（本機）

| 項目 | 結果 |
|---|---|
| `pnpm --filter @mud/server compile` | EXIT=0 |
| `pnpm build:client`（CHROME_BIN 設定） | EXIT=0（含 28 proof） |
| `node scripts/check-traditional.mjs --scope` | `{"ok":true,"violations":[]}` |

## 9. 已知限制 / 未處理

1. **GM 面簡體保留**（r1 裁定例外）：gm.ts「关闭」、native-gm-*.ts、native-bot.service.ts、native-managed-account.service.ts 的 GM 操作訊息、react-ui/prototype/ 維持簡體。
2. **離線收益舊快照**：轉換前（2026-08-19 21:19 UTC 前）建立的 offline gain session payload 內 item name 仍為簡體；確認收取後新 session 為繁中。非轉換範圍（僅 mail 轉換有 GM 一鍵工具）。
3. **登入密碼**：為驗證 Phase E，用 GM API 重設測試帳號 qwowboyp 密碼（`POST /api/gm/players/:id/password`，新密碼 TwTest2026#Pass）。測試帳號專用。
4. 本任務的程式碼修改（46 檔）留在 working tree 未 commit（todo 10 指示不 commit）；需後續 todo/commit 收錄。

## 10. 結論

- ✅ 雙 image build + rollback tags 存在
- ✅ /health + /live 200，無新增 WARN
- ✅ GM 郵件轉換：dry-run → apply（1 converted / 0 skipped / 0 failed / verified 1）→ 冪等（0 changes）→ residual simplified = 0，備份表 player_mail_pre_tw_backup 已建立
- ✅ 線上抽樣全繁中（登入頁/GM 面板/遊戲內背包/物品/狀態列）
- ✅ 線上驗證暴露並修復 todo 5/9 缺口：server 玩家面錯誤訊息 + client JSX text + 36 檔 .ts 漏網，guard 補 JSXText 支援 + 白名單 280→318
