# 靈獸系統本機驗證

日期：2026-09-14。驗證使用專用本機 PostgreSQL，沒有操作生產資料庫或發布服務。

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

## 完整門禁的既有阻礙

完整 server with-db 套件共有 174 個案例。修正本機 PostgreSQL/Git 工具的 PATH 後，GM 備份還原單獨重跑通過；合計 173 項通過，剩下既有 `redeem-code` 案例因簡繁文案不一致而逾時：

- [測試期待簡體文案](../../../packages/server/src/tools/redeem-code-smoke.ts#L239)：`兑换码无效或已过期`。
- [服務實際回傳繁體文案](../../../packages/server/src/runtime/redeem/redeem-code-runtime.service.ts#L359)：`兌換碼無效或已過期`。

這兩個來源均未由本次任務修改；依專案規範保留其他範圍的失敗 proof。因此不將完整 with-db 或完整發布門禁標記為通過。另行執行的 GM 備份還原、刷盤及 protocol with-db 均有獨立通過紀錄。

## 可重複執行

入口與本機 DB 準備方式見 [系統文件](README.md#美術及驗證)。完整日誌、結果 JSON、編譯指紋及程序紀錄位於 `.runtime/reports/spirit-beasts-verification/`；瀏覽器畫面位於 `.runtime/reports/spirit-beast-client-browser/` 與 `.runtime/reports/spirit-beast-map-browser/`。

本次沒有執行生產部署、shadow/full 環境驗收、實體 iPhone/Safari 測試或 5,000 人負載測試。

本機測試 PostgreSQL 已透過 `pg_ctl` 停止，確認沒有殘留的 fixture 程序。自動審核以策略限制拒絕刪除 `.runtime/builds/spirit-beast-test-db/` 及 `.runtime/reports/spirit-beasts-design-20260914/db-fixture.env`；保留這些未入 Git 的暫存與原有環境檔 ACL，沒有改用其他方式刪除。
