# LXC 前端增量發布

本流程供自建 LXC 的 `daojie-client` 使用。建置和測試在乾淨的本機 checkout 完成；生產機只接收需要更新的靜態檔案，不執行 pnpm、Vite、Chromium 或 apk。Postgres、Redis 與遊戲伺服器不參與前端發布。

## 範圍

| 變更 | 分類 | 處理 |
| --- | --- | --- |
| 圖片、圖包 manifest、字型等 public 資源 | assets | 準備並驗證產物，增量傳輸及切換 |
| UI、客戶端程式、前端 catalog 與專用發布工具 | client | 準備並驗證產物，增量傳輸及切換 |
| 伺服器內容、道具屬性／配方／掉落、shared、協議、根建置設定或未知路徑 | full | 前端專用工具拒絕，按實際影響範圍走對應發布流程 |

新增道具圖示或調整展示介面可以走前端流程；新增道具的權威設定不能只發布圖片。分類 `full` 表示需要進一步檢查伺服器與契約，並不表示需要重建資料庫容器。

這一版 `assets` 和 `client` 均執行完整 `pnpm verify:client`，尚未按美術類型裁切本機測試。省下的是生產機的重複建置、工具下載、未變檔案傳輸，以及後續發布的容器重建。

## 首次導入與後續發布

既有 Nginx 把網頁封在映像內。首次 `bootstrap` 必須把資源目錄改為父目錄 bind mount，並重建一次前端容器；遊戲伺服器與資料庫不重建。導入前先保存現行靜態檔案和容器，以免掛載空目錄遮蔽網頁。

後續 `publish` 在獨立候選目錄準備完整版本：依線上 receipt 比對，只上傳新增或變更檔案，驗證完整雜湊後原子切換 `current` 符號連結。不得原地覆寫線上檔案，或直接改動共用 hardlink 的內容。切換失敗時用同樣的比較及交換條件回復上一版，避免覆蓋別人的後續發布。

一般發布不重啟或 reload Nginx，不重啟遊戲伺服器。Nginx 原有的 WebSocket 連線可繼續；瀏覽器 JavaScript 不會像開發模式自動替換模組：現有版本檢查約每 30 秒讀取 `version.json`，偵測新版後會刷新頁面，因此該頁連線仍會短暫重新建立。

## 使用方式

在已提交的乾淨 checkout 執行；`BASE` 必須是目前線上 receipt 記錄的來源提交，不能只憑時間或 `buildId` 猜測。`version.json` 的 buildId 由建置時間產生，提交身分以 receipt 的完整 commit 為準。

```powershell
node scripts/client-release/plan.mjs --base BASE
node scripts/client-release/prepare.mjs --base BASE --output .runtime/client-release-artifacts
```

`prepare` 固定執行 `pnpm verify:client`，前後檢查 Git 狀態，並建立含 `dist/`、Nginx 模板及 receipt 的封包。外層 envelope 記錄封包與 receipt 雜湊。驗證失敗、來源漂移、不安全路徑或不符發布範圍時停止，沒有略過驗證的選項。

以輸出的版本目錄作為 `BUNDLE`。憑證檔留在原工作區，不要複製進發布包：

```powershell
python scripts/client-release/remote_publish.py --mode plan --bundle BUNDLE --env-file X:/workSpace/daojie-yusheng-fork/.env/pve.env --known-hosts KNOWN_HOSTS
# 只有首次導入才使用 bootstrap。
python scripts/client-release/remote_publish.py --mode bootstrap --bundle BUNDLE --expected-image CURRENT_IMAGE_DIGEST --adopt-commit BASE --env-file X:/workSpace/daojie-yusheng-fork/.env/pve.env --known-hosts KNOWN_HOSTS --execute
# 後續使用 publish。
python scripts/client-release/remote_publish.py --mode publish --bundle BUNDLE --env-file X:/workSpace/daojie-yusheng-fork/.env/pve.env --known-hosts KNOWN_HOSTS --execute
```

回復明確指定預期現行版本與目標版本，避免與其他發布互相覆蓋：

```powershell
python scripts/client-release/remote_publish.py --mode rollback --expected-current CURRENT --target PREVIOUS --env-file X:/workSpace/daojie-yusheng-fork/.env/pve.env --known-hosts KNOWN_HOSTS --execute
```

Nginx 模板契約有改動時不得沿用一般 publish；需要重新檢查 runtime 導入流程。腳本不會刪除舊版資源或 Docker 快取，清理須另外確認保留版本與相容期限。

## 快取與一致性

- 舊頁面可能稍後才載入舊版 Vite chunk；候選保留舊的內容雜湊檔案，避免切換後出現 404。
- 圖包 manifest 版本對應不可變圖片快照。相同版本不能對應不同圖檔，避免舊 manifest 配到新圖集格位；更改圖集時須同步更新 manifest 版本。
- 道具圖片網址帶前端 buildId，讓新版頁面取得新版圖片，而不是沿用固定網址的一年快取。
- `version.json`、HTML 與圖包 manifest 維持不可長期快取。每版以來源 commit、buildId、模板雜湊與全部產物雜湊共同辨識。

發布前後核對 `/`、`/version.json`、Socket.IO、`/health`、`/live`、新舊資源，以及 server／Postgres／Redis 容器身分。一般 publish 還需核對 client 容器沒有更換。正式驗證紀錄應分開寫明本機門檻、候選檢查、線上結果與耗時，不把瀏覽器刷新說成無中斷 JS 熱替換。

## 保留的原始碼建置路徑

`packages/client/Dockerfile` 保留完整 source build 作為替代流程。Chromium、Xvfb、pnpm 已拆到不含任何專案 COPY 的 `toolchain` stage，只有其工具版本或上游映像改變時才會重新安裝；修改 `client/package.json` 的 scripts 不再使工具層失效。第一次建立新工具層仍需下載，這與日常靜態發布分開處理。
