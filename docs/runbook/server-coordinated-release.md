# LXC 服務端協調發布

正式入口是 `scripts/coordinated-server-release.py`，本機需要 Python 與 Paramiko。只更新 `192.168.0.191` 的 `daojie-server`，保留前端容器、Postgres、Redis 與資料掛載；更新服務端後重新載入既有前端 nginx 的 upstream。

## 候選與證據

候選必須是已提交的完整 SHA，且服務端與前端使用同一份無 prefix、未壓縮的 canonical `source.tar`。一般跨域發布仍使用 `pnpm verify:release:full` 的四門禁報告；使用者明確要求只測當次完整差異時，可用 `scripts/scoped-source-verification.mjs` 在該 archive 的乾淨副本固定執行 frozen install、shared/server TypeScript 與明確選定的純讀 proof。scoped 報告綁定 base、commit、完整變更路徑、各命令 UTC 時間／exit code 及 archive SHA256，不能標記成 full PASS，也不能沿用其他 commit 的報告。

```powershell
node scripts/scoped-source-verification.mjs --base <線上完整SHA> --commit <候選完整SHA> --output .runtime/releases/<本次證據> --proof scripts/prove-spirit-beast-redesign.mjs
```

工具會重新產生 canonical archive，比對 SHA256、大小與提交；scoped 模式還會以 Git 重算 base..commit 完整路徑。缺 proof、未知模式、失敗命令或 scope 漂移均拒絕發布。完整報告與前端收據格式見 [前端協調發布](client-hot-release.md)。

先讀取線上狀態，保存四個容器的完整 ID：

```powershell
python scripts/coordinated-server-release.py --mode plan --env-file .env/pve.env --known-hosts <已核對的-known_hosts>
```

以同一候選、證據及讀取到的容器 ID 執行：

```powershell
python scripts/coordinated-server-release.py --mode publish --commit <完整SHA> --source-archive <source.tar> --scoped-verification <scoped-verification.json> --expected-current-server <服務端ID> --expected-client <前端ID> --expected-postgres <PostgresID> --expected-redis <RedisID> --env-file .env/pve.env --known-hosts <已核對的-known_hosts> --execute
```

執行完整四門禁時把 `--scoped-verification` 換回 `--full-verification <完整門禁報告.json>`；兩者互斥且只接受一份。

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
