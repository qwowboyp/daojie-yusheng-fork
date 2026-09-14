# LXC 服務端協調發布

正式入口是 `scripts/coordinated-server-release.py`，本機需要 Python 與 Paramiko。只更新 `192.168.0.191` 的 `daojie-server`，保留前端容器、Postgres、Redis 與資料掛載；更新服務端後重新載入既有前端 nginx 的 upstream。

## 候選與證據

候選必須是已提交的完整 SHA，以 `git archive --format=tar <SHA>` 產生未壓縮、無 prefix 的 `source.tar`。在該 archive 的獨立副本執行 `pnpm verify:release:full`，四個 gate（with-db、gm-database-backup-persistence、shadow、gm）都成功才可發布。完整報告格式見 [前端協調發布](client-hot-release.md)；工具會重新產生 canonical archive 並比對 SHA256、大小、提交與完整門禁報告。

先讀取線上狀態，保存四個容器的完整 ID：

```powershell
python scripts/coordinated-server-release.py --mode plan --env-file .env/pve.env --known-hosts <已核對的-known_hosts>
```

以同一候選、證據及讀取到的容器 ID 執行：

```powershell
python scripts/coordinated-server-release.py --mode publish --commit <完整SHA> --source-archive <source.tar> --full-verification <完整門禁報告.json> --expected-current-server <服務端ID> --expected-client <前端ID> --expected-postgres <PostgresID> --expected-redis <RedisID> --env-file .env/pve.env --known-hosts <已核對的-known_hosts> --execute
```

省略 `--execute` 只檢查證據並回傳唯讀計畫。SSH 拒絕未知 host key。憑證檔需要 `LXC_HOST`、`LXC_SSH_USER`、`LXC_SSH_PASSWORD`，不可提交或輸出內容。線上容器 ID 必須完全相符，狀態漂移時停止並重新調查。

工具先建置並核對 OCI revision，再保留舊容器與映像，切換後檢查 `/health`、`/live`、Socket.IO 和受保護容器 ID；失敗會嘗試回復舊服務端。成功後再依前端 runbook 發布相同 SHA 的 client。保留 `/opt/daojie/coordinated-server-releases` 的回復紀錄；不要執行舊的 `lxc-deploy.sh`。

## 回復

協調發布先回復前端，再回復服務端。下列 commit 是要撤回之發布紀錄的 SHA；容器 ID 使用回復前重新查得的當前值：

```powershell
python scripts/coordinated-server-release.py --mode rollback --commit <要撤回的完整SHA> --expected-current-server <當前服務端ID> --expected-client <當前前端ID> --expected-postgres <PostgresID> --expected-redis <RedisID> --env-file .env/pve.env --known-hosts <已核對的-known_hosts> --execute
```

## 維護與來源

`python -B scripts/test_coordinated_server_release.py` 驗證門禁、archive、路徑、CAS 與唯讀模式契約，不連線生產。正式使用前還需執行上述真實唯讀 plan。

此工具於 2026-09-14 從既有 `.runtime/coordinated-server-release.py` 納入版本控制。舊檔 SHA256 為 `be7457507e7f5fb0caab43e27a9fedd0fba558d0e885ffea013ca94fb636c1ab`，與先前協調發布流程相關，但沒有可核對的歷史 Git blob；本次已逐段核對其 archive、四門禁、容器保護、切換與回復契約。納入時將本機 canonical 暫存目錄集中到 `.runtime/releases/`，並加入契約測試。後續一律使用版本控制內的入口。
