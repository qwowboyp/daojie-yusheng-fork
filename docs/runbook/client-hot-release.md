# LXC 前端增量發布

本流程供自建 LXC 的 `daojie-client` 使用。建置和測試在乾淨的本機 checkout 完成；生產機只接收需要更新的靜態檔案，不執行 pnpm、Vite、Chromium 或 apk。Postgres、Redis 與遊戲伺服器不參與前端發布。

## 範圍

| 變更 | 分類 | 處理 |
| --- | --- | --- |
| 圖片、圖包 manifest、字型等 public 資源 | assets | 準備並驗證產物，增量傳輸及切換 |
| UI、客戶端程式、前端 catalog 與專用發布工具 | client | 準備並驗證產物，增量傳輸及切換 |
| 伺服器內容、道具屬性／配方／掉落、shared、協議、根建置設定或未知路徑 | full | 預設拒絕；只有完成本節的 full gate、同 commit 服務端先行替換與線上 revision 核對後，才允許協調切換靜態前端 |

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

## Full-stack 協調發布

這條路徑只負責在服務端已安全更新後切換靜態前端，不會替換 server、Postgres 或 Redis。`--coordinated-full` 不是略過分類或門禁的開關；它必須搭配由同一份 canonical source archive 跑完 `pnpm verify:release:full` 所產生的證據。原本的 `pnpm verify:client`、完整產物 manifest、bundle envelope、CAS、Nginx 契約、不可變圖包、保留舊 chunk、線上 hash 與回復機制仍全部執行。

先從最終乾淨 commit 建立不含工作目錄變更、無 prefix、未壓縮的 canonical archive。full gate 必須在這份 archive 解開的隔離 checkout 執行：

```powershell
$FULL_COMMIT = git rev-parse HEAD
git archive --format=tar --output C:/release-evidence/source.tar $FULL_COMMIT
# 在 source.tar 解開的隔離環境執行，保留開始與完成 UTC 時間及各頂層 gate 結果。
pnpm verify:release:full
```

`full-verification.json` 與 `source.tar` 放在同一目錄，schema 固定如下。`gates` 必須完整、同順序且全部為 0；不得把手動宣告 `verified: true` 當成證據。

```json
{
  "schemaVersion": 1,
  "kind": "daojie-full-release-verification",
  "commit": "0123456789abcdef0123456789abcdef01234567",
  "command": "pnpm verify:release:full",
  "exitCode": 0,
  "startedAt": "2026-09-13T00:00:00.000Z",
  "completedAt": "2026-09-13T00:30:00.000Z",
  "sourceArchive": {
    "path": "source.tar",
    "bytes": 12345678,
    "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  },
  "gates": [
    { "label": "with-db", "exitCode": 0 },
    { "label": "gm-database-backup-persistence", "exitCode": 0 },
    { "label": "shadow", "exitCode": 0 },
    { "label": "gm", "exitCode": 0 }
  ]
}
```

準備工具會重新產生 `git archive --format=tar HEAD`，要求 bytes 與 SHA-256 均等於 report 指向的實際 `source.tar`，並要求 report commit 等於當前 HEAD。成功後 receipt 會保留 report SHA-256、source archive SHA-256、四個 gate 和 `server-before-client` 順序：

```powershell
node scripts/client-release/plan.mjs --base LIVE_RECEIPT_COMMIT
node scripts/client-release/prepare.mjs `
  --base LIVE_RECEIPT_COMMIT `
  --baseline-manifest LIVE_RECEIPT_JSON `
  --output .runtime/client-release-artifacts `
  --coordinated-full `
  --full-verification C:/release-evidence/full-verification.json
```

服務端必須由同一份 `source.tar` 建置，且 Docker build 必須明確傳入完整 commit，讓最終映像的 `org.opencontainers.image.revision` 等於 receipt commit：

```bash
FULL_COMMIT=0123456789abcdef0123456789abcdef01234567
docker build --build-arg BUILD_CACHEBUST="$FULL_COMMIT" -f packages/server/Dockerfile -t "daojie-server:full-$FULL_COMMIT" .
```

由部署程序只替換 `daojie-server`，保留既有 client bind mount、Postgres、Redis、網路、環境變數與資料 volume；不可執行會重建四個容器並移除 hot-static 掛載的舊 `lxc-deploy.sh`。先驗證服務端 `/health`、`/live` 和新舊前端對新版服務端的必要相容路徑，再規劃與發布前端：

```powershell
python scripts/client-release/remote_publish.py --mode plan --bundle BUNDLE --env-file ENV_FILE --known-hosts KNOWN_HOSTS
python scripts/client-release/remote_publish.py --mode publish --bundle BUNDLE --expected-current CURRENT_ARTIFACT --env-file ENV_FILE --known-hosts KNOWN_HOSTS --execute
```

`plan` 會顯示 `classification: full` 與 `coordinatedServerCommit`。真正 publish 前，遠端工具會從執行中 server 容器解析其不可變 image ID，再讀該 image 的 OCI revision；revision 不等於 receipt commit、server 未運行，或 `/health`／`/live` 未就緒時都拒絕切換前端。`receipt.baseCommit == current receipt.commit` 的 live-base 條件不變，不能用 adopt 或拆成兩份 receipt 繞過。

若前端切換後需回復，先以精確 CAS 將 client 回復到上一個 artifact，再按服務端既有 server-only 回復流程還原前一個 immutable image；每一步都重新檢查 `/`、`version.json`、Socket.IO、`/health`、`/live` 與三個受保護容器身分。

## 快取與一致性

- 舊頁面可能稍後才載入舊版 Vite chunk；候選保留舊的內容雜湊檔案，避免切換後出現 404。
- 圖包 manifest 版本對應不可變圖片快照。相同版本不能對應不同圖檔，避免舊 manifest 配到新圖集格位；更改圖集時須同步更新 manifest 版本。
- 道具圖片網址帶前端 buildId，讓新版頁面取得新版圖片，而不是沿用固定網址的一年快取。
- `version.json`、HTML 與圖包 manifest 維持不可長期快取。每版以來源 commit、buildId、模板雜湊與全部產物雜湊共同辨識。

發布前後核對 `/`、`/version.json`、Socket.IO、`/health`、`/live`、新舊資源，以及 server／Postgres／Redis 容器身分。一般 publish 還需核對 client 容器沒有更換。正式驗證紀錄應分開寫明本機門檻、候選檢查、線上結果與耗時，不把瀏覽器刷新說成無中斷 JS 熱替換。

## 保留的原始碼建置路徑

`packages/client/Dockerfile` 保留完整 source build 作為替代流程。Chromium、Xvfb、pnpm 已拆到不含任何專案 COPY 的 `toolchain` stage，只有其工具版本或上游映像改變時才會重新安裝；修改 `client/package.json` 的 scripts 不再使工具層失效。第一次建立新工具層仍需下載，這與日常靜態發布分開處理。
