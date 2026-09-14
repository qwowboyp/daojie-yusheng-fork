# 道劫余生 Agent 執行規範

全程中文，玩家文案用臺灣繁體。`packages/*` 是唯一生產主線；完成本次要求、保留他人改動，不順手擴張玩法或重構。功能/修復完整完成後自動精準提交中文 Conventional Commits；純文件隨程式變更提交。推送/發布沿用使用者已授權範圍。

## 圖片生成工具（使用者長期要求）

- 本專案所有圖片生成與生成式修改一律使用 AGY CLI，涵蓋武器、防具、功法、材料、怪物、角色、場景、貼圖與其他圖片，以節省 Codex 圖片生成額度。
- 使用 `agy-imagegen` 技能，位置：`C:/Users/code_base_new/.agents/skills/agy-imagegen/SKILL.md`。若會話技能清單尚未顯示，直接讀取此檔；其他機器找不到時回報缺失。
- 以 `agy --print` 一次性任務呼叫，要求實際產出圖檔並核對檔案與畫面。AGY 失敗時先查明原因，不自行切換 Codex imagegen 或其他圖片供應商；使用者明確變更要求時除外。
- 裁切、縮放、格式轉換等本地後處理沿用既有工具；批量與單張依素材用途選擇，並遵守以下道具圖集規則。

## 精準工作路徑

- 按鈕位置、間距、配色與單面板修復由主代理直接做：鎖定本次完整範圍→修改→匹配風險的驗證→提交。不預設規劃文件、全庫搜尋、開代理或發布流程。
- `node scripts/workflow.mjs context --surface navigation --files <本次檔案...>` 一次取得狀態摘要、入口、規範和 proof；提示檢查路徑存在，不代替依賴分析。無 surface 時列出可用項目。
- 有 `.codegraph/` 時先用 `codegraph_explore`（具體檔案/符號，maxFiles 1–3）或 `codegraph explore`，否則 `rg`。缺哪段才補查，已提供的來源不重讀；不擅自建索引。
- 獨立讀取批次執行，完整日誌落盤，讀退出碼/耗時/摘要/失敗尾段。有效且未受變更影響的檢查不重跑。長程序正常等待 30–60 秒，不反覆短間隔查進度。
- 使用者允許按需委派，但只限可獨立交付、主代理同時有有用工作的子任務。通常 1 個、最多 3 個；明確證據、相關鏈路、檔案所有權和驗收，`fork_turns="none"`，不傳完整歷史。搜尋只讀；寫入不覆蓋他人；子代理不再委派。具名角色用當次工具設定；通用 spawn 才讀 `~/.codex/agents/<角色>.toml`，Luna 至少 high、高風險向上升級。獨立 Git/部署用對應專員。

## 按需載入領域規範

已注入的 AGENTS.md 不重讀。完整原規範在 [docs/agent-reference.md](docs/agent-reference.md)，只查本次領域段落；不要每次載入整份附錄。

| 任務 | 開工前讀 |
| --- | --- |
| UI | `packages/client/AGENTS.md`；React/地圖再讀其子級規範 |
| 玩法、技藝、資產或資料流 | 對應 `docs/mechanics/` + 附錄 §3–11、§14–15 受影響段落 |
| server/shared/config-editor | 對應 package AGENTS.md，維持契約真源 |
| 美術 | `docs/artwork/README.md` + 附錄美術規則，實看 items-05/04/07 圖集和裁切圖 |
| 發布/線上診斷 | 附錄 §0.5 + 經確認存在的發布工具 README，確認線上版本與授權 |
| 驗證/工作流腳本 | `scripts/AGENTS.md`，不因此載入遊戲全部機制 |

mechanics：core-loop 移動/tick/AOI；combat 戰鬥/怪物/掉落；growth 屬性/修煉/功法/buff/離線；technique 技藝；building-env 建築/風水；equipment-items 背包/裝備；economy 市場/飛書/社交；other 其餘玩法。

## 必守邊界

- 服務端唯一權威，世界 tick 保持 1Hz；socket 收意圖，不直接改世界。移動表現/metadata 不改 tick 語義。AOI/協議最小資料、最小範圍、增量同步，靜態詳情不進高頻包。
- 熱路徑禁止 JSON 序列化、字串簽名、臨時字串鍵、每 tick 全表掃描；配置/schema 啟動預解析。設計口徑 8C/16GB/30Mbps、5000 玩家、10000 地圖；現有 LXC 4C/4GB 不代表此負載已驗收。
- 持久資料以 DB 為真源，tick 外受控 flush/outbox/worker；資產/交易/位置/GM 變更考慮冪等、併發、恢复、回讀、審計。持久化測試自動清理。技藝統一 job 生命週期和單活躍互斥，所有入口成立。
- shared schema、編輯器、loader、client catalog 同一契約；格式遷移集中 GM 一鍵轉換目錄，禁止 runtime lazy 相容。通知傳 key + 變數，前端組文，不新增後端中文拼接通知。
- UI 局部 patch，保持焦點、捲動、選取、輸入、展開。覆蓋淺/深色、桌面、手機、觸控橫向；按鈕移動驗證真實綁定、去重及可開啟。插值只影響顯示，每幀避免全量查詢與短命物件。
- 道具批量採最多 36 件 6×6 透明圖集與 stable itemId 格位，裁成 96/192 WebP，獨立外形且無跨格殘片；保留合格資產，不重啟逐件大型原圖策略。
- TypeScript 不寫 CommonJS；禁止無充分單行理由的 ts-ignore/expect-error/nocheck。env 預設生產友善；非必要不改 docker-stack，除非使用者要求。憑證不輸出、不入 Git。
- 優化前確認實際產生→傳輸→消費、副作用、頻率、Worker/快取是否接入、重連/跨圖恢復；不憑名稱猜測。範圍按問題收斂，不為局部 CSS 做全後端調查。

## 驗證分級

| 變更 | 必要驗證 |
| --- | --- |
| 純文件 | diff/連結，不跑遊戲建置 |
| 局部工作流工具 | 契約測試 + 一次真實流程，不跑整套遊戲 proof |
| 局部 UI 顯示/樣式/位置，無協議/資產/生命週期變更 | `node scripts/workflow.mjs check --tier ui-small --surface <名稱> --files <完整本次範圍>`：文案、client tsc、對應既有 proof，僅屬本地驗證 |
| client 全域樣式/裝配/狀態/網路/跨面板、覆蓋不足或風險不明 | `pnpm verify:client` |
| 小型 server | `pnpm verify:quick` |
| 建築/風水機制 | quick + `pnpm verify:building` |
| shared/protocol | `pnpm build:shared` + `pnpm audit:protocol` + 受影響消費端 |
| DB/持久化 | `pnpm verify:release:with-db` |
| 完整發布 | `pnpm verify:release:full`；阻礙明示，不稱完整通過 |

精準 UI 分級依實際差異，不只看副檔名；提供完整本次範圍，全域 token/base、shared、網路/runtime 不得冒用。proof 須覆蓋本次行為和多端要求；不足則補最小行為驗證或升級，不修改他人的失敗 proof。局部收據供引用，不是自動略過正式門禁的快取。

## 發布與程序收尾

先確認發布工具在當前候選中存在。可用 client prepare 若含完整 verify，就在乾淨候選執行一次，不在前後重跑。不能把 `.runtime` 舊快照或記憶路徑當現行工具，也不臨時重寫部署；需恢復歷史工具時先核對 exact commit/範圍/契約。只有前端門禁通過就明示前端範圍，不稱全棧驗收。

生產是 LXC `192.168.0.191`，非舊 Swarm；禁用 `.190`、禁在 PVE host 裝服務。前端發布保留 server/Postgres/Redis、rollback；核對 runtime hash、`/`、`/version.json`、Socket.IO、`/health`、`/live`，不以時間已過推定完成。

瀏覽器 proof 在 finally/browser.close 關閉；殘留先盤點 PID/所屬，只終止本任務程序樹，禁止全殺共享 Chrome。模擬不等於實機 iPhone/Safari 或 5000 人壓測。
