# 靈獸系統驗證與發布

首次本機驗證日期：2026-09-14，使用專用本機 PostgreSQL。正式發布於 2026-09-15 完成，兩階段證據分別記錄如下。

## 正式發布結果

- 生產來源提交：`6c58de7f5a80e1dad6d6b1b779f41040078e3a1d`。
- `pnpm verify:release:full` 四段全部退出 0：with-db、GM 備份還原、shadow、GM；總耗時 1,370.426 秒。
- 前端 prepare 內的 `pnpm verify:client` 通過，耗時 372.697 秒；產物 `client-6c58de7f5a80-b2deabcc67b0`，buildId `b2deabcc67b0`。
- 服務端先更新，再原子切換前端。線上 `/`、`/version.json`、服務端 JSON `/health`／`/live` 與 Socket.IO 檢查通過，服務端 OCI revision 與發布提交一致。
- 線上內容核對：150 種靈獸、30 種物品、14 種設施；362 個靈獸專用素材 HTTP 雜湊全部符合收據。新增美術來源仍為 AGY。
- 前端、Postgres、Redis 容器身分與發布前一致。保留前端 `client-9bda22f631b1-4792c4845dbb` 與前一版服務端的回復資料。

證據集中於 `.runtime/releases/spirit-beast-6c58de7f5a80/`：`full-verification.json`、`full-final.log`、`full-timing.json`、前端 receipt、`server-publish.json`、`client-publish.json`、`live-verification.json`。前端驗證 timing 另保留於 `.runtime/reports/spirit-beast-final-client/`。

發布期間另修正兩個既有測試問題：手動 ledger 認領前等待背景 consumer 停止；GM 測試選擇合法速度並在 finally 還原原設定。GM 上限邊界在同一 QA DB 連跑兩輪，均驗證 `10 → 9 → 10` 且退出 0。沒有放寬正式速度上限、測試逾時或斷言。各輪失敗與耗時檢討見 [發布流程檢討](../../runbook/spirit-release-workflow-review.md)。

正式上線後，已清除本次遠端 QA 的三個容器、專用資料卷、網路與 `/opt/daojie/qa/spirit-beast-3ef5` 目錄，保留共享 QA 工具映像與生產回復資料。Git worktree 登記已移除；實體 `.runtime/worktrees/spirit-beast-release-aa73/` 因 Windows 長路徑未完全刪除，後續清理遭自動審核以策略限制拒絕，故保留殘留並停止刪除嘗試。沒有程序仍引用此 worktree。較早的本機 fixture 清理限制列於本頁末尾。

## 已通過

- 150 種靈獸、30 種新增物品、14 種設施及 2,325 組融合配對的內容一致性檢查。
- shared/server 編譯、靈獸規則與機率、養成素材限制、工作分配、孵化恢復、人工技藝生命週期。
- 真實建築放置入口：關閉面板仍能發現新工程，重複放置請求不重建工單。
- 真實 DB：素材交易、重複請求、升星失敗保留主體、工位存取、獨立裝備實例、強化、種植及收成。
- `verify:quick`、`verify:building`、client 驗證，以及連接真實資料庫的協議驗證。
- 地圖狀態與 Pixi 瀏覽器驗證、React 面板互動驗證；包含桌面明暗色、手機直向及觸控橫向模擬。
- 工作流與測試資料庫防誤連測試共 16 項。
- 原有 GM 備份還原及獨立刷盤 worker 的真實 DB 驗證。

靈獸不加入碰撞實體；玩家與其他靈獸可以穿越。地圖插值只影響顯示，世界仍由服務端每息推進。

## 首次驗證記錄與發布修正

`fac19d245` 首次本機驗證的完整 server with-db 套件共有 174 個案例。修正本機 PostgreSQL/Git 工具的 PATH 後，GM 備份還原單獨重跑通過；當時合計 173 項通過，`redeem-code` 案例因簡繁文案不一致而逾時：

- [兌換碼測試](../../../packages/server/src/tools/redeem-code-smoke.ts#L239) 原先期待簡體文案：`兑换码无效或已过期`。
- [服務實際回傳繁體文案](../../../packages/server/src/runtime/redeem/redeem-code-runtime.service.ts#L359)：`兌換碼無效或已過期`。

首次功能提交保留了這個既有失敗，未將完整 with-db 或完整發布門禁標記為通過。使用者後續授權正式發布後，已將該測試的預期文案精準對齊現行繁體回應，保留原有失敗回應、請求身份與獎勵不重發斷言。發布仍須重新通過正式門禁；不能以首次本機證據代替發布收據。

正式門禁另發現 `world-sync.service.ts` 增至 293 行，超過既有 250 行邊界。已將靈獸 AOI 游標與差量、待送通知抽出獨立模組，主服務降至 242 行，沒有調高門檻。新增差量不重送、視野進出、工位清除、跨圖重置、離線游標清理及 EventBus 通知去重測試，並納入 server smoke 套件。舊候選的失敗紀錄保留，正式發布須以修正候選重新完成完整門禁。

## 可重複執行

入口與本機 DB 準備方式見 [系統文件](README.md#美術及驗證)。完整日誌、結果 JSON、編譯指紋及程序紀錄位於 `.runtime/reports/spirit-beasts-verification/`；瀏覽器畫面位於 `.runtime/reports/spirit-beast-client-browser/` 與 `.runtime/reports/spirit-beast-map-browser/`。

首次本機驗證沒有執行生產部署、shadow/full 環境驗收、實體 iPhone/Safari 測試或 5,000 人負載測試；後續正式發布以對應發布收據為準。

本機測試 PostgreSQL 已透過 `pg_ctl` 停止，確認沒有殘留的 fixture 程序。自動審核以策略限制拒絕刪除 `.runtime/builds/spirit-beast-test-db/` 及 `.runtime/reports/spirit-beasts-design-20260914/db-fixture.env`；保留這些未入 Git 的暫存與原有環境檔 ACL，沒有改用其他方式刪除。
