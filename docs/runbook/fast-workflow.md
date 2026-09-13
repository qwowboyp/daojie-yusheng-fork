# 小任務工作流

用於既有介面的局部顯示、按鈕位置、間距和配色修復。協議、資產、持久化、全域狀態與發布仍按根 AGENTS.md 完整驗證。

## 一次定位

```powershell
pnpm workflow:context --surface navigation --files packages/client/src/react-ui/shell/WorkspaceNavigation.tsx
```

只回傳變更總數與本次檔案狀態、相關 AGENTS 路徑、存在的入口和 proof。沒有 surface 時列出所有可用項目；提示是搜尋起點，仍需 CodeGraph 讀本次實際綁定/消費鏈。已取得的來源不要重讀。

## 精準驗證

```powershell
node scripts/workflow.mjs plan --tier ui-small --surface navigation --files packages/client/src/react-ui/shell/WorkspaceNavigation.tsx
pnpm verify:client:focused --surface navigation --files packages/client/src/react-ui/shell/WorkspaceNavigation.tsx
```

執行本次檔案的繁體文案守門、client TypeScript 和 surface 對應現有 proof；可用 `--proof game-workspace social-navigation` 明確選擇。選擇需覆蓋真實操作及桌面/手機/橫向、淺/深色，不能用按鈕標籤代替實際開啟。

- `--files` 必須是本次完整修改範圍，不會把工作樹其他人的改動自動混入。目錄以外、不存在/越界連結、全域 CSS 和非 UI 範圍會被拒絕。
- 只移動入口但同時改了 runtime 綁定、跨面板狀態或全域樣式時，走 `pnpm verify:client`。檔案路徑檢查不能代替人工判定語義風險。
- 新 checkout 先準備依賴與 `pnpm build:shared`；工具缺產物時明確失敗，不偷跑完整建置。shared/內容真源改動不適用此路徑。
- hud/inventory 候選包含人工 fixture，不能推定覆蓋完整面板；context 會標記，check 必須明確 `--proof` 並補本次真實行為證據，否則升級既有門禁。
- 每一步最多 180 秒；失敗立即停止，保留完整日誌及失敗尾段，逾時只終止自身程序樹。預設不自動重試。
- 結果存 `.codex/tmp/workflow/run-*/receipt.json`，含命令、HEAD、本次檔案 fingerprint、耗時和退出碼；它是本地證據，不是正式 release 收據，也不自動快取/跳過其他測試。

## 發布不重新發明

先確認當前候選的發布工具存在。`scripts/client-release` 曾出現在歷史候選，不能只憑 `.runtime` 快照或記憶就當作目前 HEAD 的工具。若有正式 prepare 含完整 `verify:client`，完整門禁交給它跑一次；局部 proof 用於修改期間快速抓錯。不要先完整 verify，再 prepare，再 Docker 重建同一份 client。

原 `verify:client`、build、Docker、完整 release 門禁保留。此工具不修改、推送或發布程式，也不碰 server/Postgres/Redis。

## 效能資料的讀法

2026-09-14 實跑 navigation：繁體守門 0.39 秒、tsc 10.62 秒、game-workspace 29.60 秒、social-navigation 10.21 秒，合計 **50.82 秒，4 項通過**。歷史成功完整 client gate 為 295.51 秒，其中 build 291.15 秒。兩者驗證範圍不同，這是歷史對照，不能宣稱所有任務同等品質加速固定比例。

根規範由完整手冊改成必守邊界和按領域導航，完整內容留 `docs/agent-reference.md`；目的在減少每次載入與重讀，不刪玩法/資料/發布規範。全域 fast-workflow 技能附本機 session 統計器，需調查時才讀，不在每次小任務掃描歷史。

工作流工具回歸：`pnpm verify:workflow`。不必為修改此說明或工具跑全部遊戲 proof。
