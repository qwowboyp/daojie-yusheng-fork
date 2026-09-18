---
name: daojie-deploy
description: 道劫余生（daojie-yusheng-fork）一鍵佈署到正式環境（PVE LXC 192.168.0.191）。當使用者要求「佈署」「部署」「更新線上」「發佈到生產」「更新正式服」「deploy」時使用。前端日常發布走 scripts/client-release/deploy.ps1 熱靜態管線；伺服器發布走 scripts/coordinated-server-release.py（plan / publish / rollback）。`.claude/skills/daojie-deploy/scripts/deploy.ps1` 內的 `-Target client` 仍轉入 hot-static 入口；`-Target server` / `-Target both` / 預設 target 已加 fail-closed 守衛，會以 `unsafe-legacy-deploy-disabled` 立即拒絕。也適用於佈署前判斷要走熱發布還是走伺服器協調發布。
---

# daojie-deploy

道劫余生正式環境一鍵佈署。前端日常發布的唯一入口是 `scripts/client-release/deploy.ps1`（熱靜態；預設 `publish`）。`.claude/skills/daojie-deploy/scripts/deploy.ps1 -Target client` 會在讀憑證與打包原始碼之前轉入該入口，**不會**自動退回完整 source archive / Docker 重建。**伺服器發布**不再透過這個 legacy 腳本：請改用 `scripts/coordinated-server-release.py`（plan / publish / rollback，預設走 `--scoped-verification`）。legacy 腳本對 `-Target server` / `-Target both` / 預設 target 已加 fail-closed 守衛，會在讀憑證、打包、上傳、WinSCP、Docker build、`/opt/daojie/lxc-deploy.sh` 之前以 `unsafe-legacy-deploy-disabled` 立即拒絕；`-Mode` 與 `-AllowClientSourceBuildRecovery` 等 recovery flag 也無法繞過。

## 前端日常發布（canonical）

```powershell
# 唯一入口：<repo>/scripts/client-release/deploy.ps1
# 必須給至少一個 -Proof，以及明確的 trusted -KnownHosts。禁止 -SkipVerify。

# 後續日常 publish（預設 Mode）
pwsh -NoProfile -File scripts/client-release/deploy.ps1 -Proof release-contracts -KnownHosts KNOWN_HOSTS

# 等價：舊 router 的 -Target client 轉入同一入口，同樣需要 Proof 與 KnownHosts
pwsh -NoProfile -File .claude/skills/daojie-deploy/scripts/deploy.ps1 -Target client -Proof release-contracts -KnownHosts KNOWN_HOSTS

# 憑證無關、無副作用的計畫（不讀 .env、不 SSH、不建置、不建輸出目錄）
pwsh -NoProfile -File scripts/client-release/deploy.ps1 -Proof release-contracts -KnownHosts KNOWN_HOSTS -DryRun
```

**沒有自動 fallback。** `publish` / `bootstrap` 缺熱靜態狀態時會失敗並印出 bootstrap 範例，不會改走 Docker 重建。

一次性導入（線上尚無 hot-static `current`）才用 bootstrap，必須給完整 40 hex `-AdoptCommit` 與 `sha256:` `-ExpectedImage`：

```powershell
pwsh -NoProfile -File scripts/client-release/deploy.ps1 -Mode bootstrap -Proof release-contracts -KnownHosts KNOWN_HOSTS -AdoptCommit <40-hex> -ExpectedImage sha256:<64-hex>
```

極少見的完整 client source-build 復原必須同時寫明 Mode 與授權，**禁止自動選取**：

```powershell
pwsh -NoProfile -File scripts/client-release/deploy.ps1 -Mode recovery-source-build
```

細節見 `docs/runbook/client-hot-release.md`。產物固定在專案 `.runtime/releases/`。`-Ref` 必須等於乾淨 checkout 的 HEAD。

## 伺服器發布（fail-closed; uses coordinated-server-release.py）

`scripts/coordinated-server-release.py` 是伺服器（含共享 schema / 鎖檔 / Dockerfile 變更）的唯一入口。legacy `.claude/skills/daojie-deploy/scripts/deploy.ps1` 對 `-Target server` / `-Target both` / 預設 target 已加 fail-closed 守衛，**不再可用**；任何呼叫會立刻在讀憑證、打包、上傳、WinSCP、Docker build、`/opt/daojie/lxc-deploy.sh` 之前印 `unsafe-legacy-deploy-disabled` 並以 exit 64 拒絕。`-Mode` 與 `-AllowClientSourceBuildRecovery` 等 recovery flag 也無法繞過。

```powershell
# 規劃（只讀本地 + LXC 狀態，不讀憑證、不改環境）
python scripts/coordinated-server-release.py --mode plan --env-file .env/pve.env --known-hosts <已核對的-known_hosts>

# 發布（必須先規劃；--execute 真的改 LXC 狀態）。
# 證據二選一：--scoped-verification <scoped-verification.json> 或 --full-verification <完整門禁報告.json>，
# 兩者互斥且各自只接受一份。需四個容器完整 ID（先用 plan 取得）。
python scripts/coordinated-server-release.py --mode publish --commit <完整SHA> --source-archive <source.tar> --scoped-verification <scoped-verification.json> --expected-current-server <服務端ID> --expected-client <前端ID> --expected-postgres <PostgresID> --expected-redis <RedisID> --env-file .env/pve.env --known-hosts <已核對的-known_hosts> --execute

# 回滾（保留 client 熱靜態，只動 server / 共享容器；--commit 要撤回的發布紀錄 SHA）
python scripts/coordinated-server-release.py --mode rollback --commit <要撤回的完整SHA> --expected-current-server <當前服務端ID> --expected-client <當前前端ID> --expected-postgres <PostgresID> --expected-redis <RedisID> --env-file .env/pve.env --known-hosts <已核對的-known_hosts> --execute
```

**前置條件（腳本外的硬規則）**：先 commit（必要时 push）。`git archive` 只打包已提交內容，未提交的修改不會上線。遠端原始碼解包到 `/opt/daojie/src`。細節與 2026-09 bind-mount 還原事件見 `docs/runbook/server-coordinated-release.md`。

## Target 選擇原則

| 變動範圍 | 入口 |
|---|---|
| `packages/client/**`、前端靜態 | `scripts/client-release/deploy.ps1`（或 `.claude/skills/daojie-deploy/scripts/deploy.ps1 -Target client`，轉入同一熱靜態入口） |
| `packages/server/**` | `scripts/coordinated-server-release.py plan / publish / rollback` |
| `packages/shared/**`、鎖檔、Dockerfile | `scripts/coordinated-server-release.py`（共享 schema 變更需要走 server 協調發布） |
| 不確定 | 先 `plan` 看影響範圍再選入口 |

## legacy 腳本流程（保留為不可達歷史參考；server/both/default 已被守衛攔截）

> 下列步驟仍以註解形式存在於 `.claude/skills/daojie-deploy/scripts/deploy.ps1`，但因為守衛在讀憑證、打包、上傳、WinSCP、Docker build、`/opt/daojie/lxc-deploy.sh` 之前就會拒絕，所以這些步驟在 `-Target server` / `-Target both` / 預設 target 已經**無法觸發**。`-Target client` 在讀憑證前就已經轉入 canonical hot-static wrapper，也不會跑到這些步驟。保留註解僅為了不破壞既有 review / runbook 引用。

1. 解析 `<RepoRoot>/.env/pve.env` 取 LXC 位址與帳密（該檔 gitignored，嚴禁寫入任何進 git 的檔案）
2. `git archive $Ref` → `daojie-src.tar.gz`（用後即刪）
3. WinSCP（sftp + hostkey 固定指紋）上傳到 LXC `/tmp/`
4. 遠端解包 + `nohup docker build`（`DOCKER_BUILDKIT=1`，依 Target 循序建）→ 輪詢 `/tmp/daojie-build.log`（30 秒一次，逾時 30 分鐘）。成功判定同時認舊式 `Successfully tagged daojie-*:lxc` 與 BuildKit 的 `naming to docker.io/library/daojie-*:lxc`
5. `bash /opt/daojie/lxc-deploy.sh`（冪等重建四容器；pgdata/redis-data volume 不動），確認輸出 `DEPLOY_DONE`。腳本尾段在新容器起來後自動 `docker image prune -f` + `docker builder prune -f`（只清 dangling，不動 tagged 映像與 named cache mount）
6. 本機再跑一次同樣的 prune 並印 `df` / `docker system df`（best-effort，失敗不擋佈署）；接著 curl 驗證 `/health` `/live`（:13001）與首頁（:11921）皆 200；再抓 server 近 3 分鐘 log 的 warn/error（僅提示不擋）

參數（legacy）：`-Target server|client|both`（預設 both，**但 server/both/default 都會被守衛拒絕**）、`-Ref`（預設 HEAD）、`-DryRun`、`-SkipVerify`、`-RepoRoot`。日常 `-Target client` 在守衛前轉入 canonical wrapper；完整 client Docker 重建只接受 `scripts/client-release/deploy.ps1 -Mode recovery-source-build` 加上內部 `-AllowClientSourceBuildRecovery`，不會自動選。`scripts/client-release/check-deploy-entrypoint.mjs` 對 legacy 入口的結構性斷言已改為斷言守衛存在並優先於 env / archive / docker / lxc-deploy.sh。

## 環境照會（排錯用）

| 項目 | 值 |
|---|---|
| LXC | 192.168.0.191（root，密碼在 `.env/pve.env`）；192.168.0.190 被佔用禁用 |
| 網頁入口 | http://192.168.0.191:11921（nginx 反代 `/api`、`/socket.io` → server:13001） |
| 映像 | `daojie-server:lxc`、`daojie-client:lxc`（本地建置） |
| 磁碟紅線 | LXC 僅 30G；每次佈署切換容器後自動清懸空映像／dangling build cache。仍告急才手動 `docker system prune`（不要加 `-a`，會刪掉仍 tagged 的映像） |
| server-data | `/opt/daojie/server-data` owner 必須 `100:101`，否則 GM 備份 EACCES |
| LXC 內無 curl | 驗證一律從本機 curl.exe 打；容器內檢查用 `docker exec` |

## 常見故障

- **build 逾時/失敗**：SSH 進 LXC 看 `/tmp/daojie-build.log` 全文；client 映像 build 內含 proof（chromium），本質就慢（數分鐘），屬正常。BuildKit 不會印 `Successfully tagged`，輪詢已同時認 `naming to docker.io/library/daojie-*:lxc`
- **`DEPLOY_DONE` 未出現**：`docker ps` 看容器狀態，常見是 postgres/redis 未 ready，直接重跑腳本（冪等）
- **首頁 200 但功能異常**：瀏覽器強制刷新（新版 JS chunk hash 變了才會生效）
