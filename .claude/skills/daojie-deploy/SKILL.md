---
name: daojie-deploy
description: 道劫余生（daojie-yusheng-fork）一鍵佈署到正式環境（PVE LXC 192.168.0.191）。當使用者要求「佈署」「部署」「更新線上」「發佈到生產」「更新正式服」「deploy」時使用。執行 scripts/deploy.ps1 完成 git archive → 上傳 → Docker 映像重建 → lxc-deploy.sh → 健康驗證全流程。也適用於佈署前判斷需要重建 server 還是 client 映像。
---

# daojie-deploy

道劫余生正式環境一鍵佈署。核心是一支腳本：`scripts/deploy.ps1`（純 ASCII PowerShell 7，repo 根路徑由腳本位置自動推導）。

## 快速用法

```powershell
# 腳本位置：<repo>/.claude/skills/daojie-deploy/scripts/deploy.ps1

# 常規：同時重建 server + client（最安全，最慢）
pwsh -NoProfile -File .claude/skills/daojie-deploy/scripts/deploy.ps1

# 只改了 packages/client（前端/UI/音檔）→ 只重建 client，省一半時間
pwsh -NoProfile -File .claude/skills/daojie-deploy/scripts/deploy.ps1 -Target client

# 只改了 packages/server → 只重建 server
pwsh -NoProfile -File .claude/skills/daojie-deploy/scripts/deploy.ps1 -Target server

# 佈署特定 commit（預設 HEAD）
pwsh -NoProfile -File .claude/skills/daojie-deploy/scripts/deploy.ps1 -Ref <sha>

# 不執行遠端操作，只驗證環境與 git archive（測試用）
pwsh -NoProfile -File .claude/skills/daojie-deploy/scripts/deploy.ps1 -DryRun
```

**前置條件（腳本外的硬規則）**：先 commit（必要时 push）。`git archive HEAD` 只打包已提交內容，未提交的修改不會上線。遠端原始碼解包到 `/opt/daojie/src`。

## Target 選擇原則

| 變動範圍 | Target |
|---|---|
| `packages/client/**` | `client` |
| `packages/server/**` | `server` |
| `packages/shared/**`、鎖檔、Dockerfile | `both`（兩個映像都吃 shared） |
| 不確定 | `both` |

## 腳本流程（deploy.ps1 內部）

1. 解析 `<RepoRoot>/.env/pve.env` 取 LXC 位址與帳密（該檔 gitignored，嚴禁寫入任何進 git 的檔案）
2. `git archive $Ref` → `daojie-src.tar.gz`（用後即刪）
3. WinSCP（sftp + hostkey 固定指紋）上傳到 LXC `/tmp/`
4. 遠端解包 + `nohup docker build`（依 Target 循序建）→ 輪詢 `/tmp/daojie-build.log`（30 秒一次，逾時 30 分鐘，見到 `ERROR` 即fail並印尾部日誌）
5. `bash /opt/daojie/lxc-deploy.sh`（冪等重建四容器；pgdata/redis-data volume 不動），確認輸出 `DEPLOY_DONE`
6. 本機 curl 驗證 `/health` `/live`（:13001）與首頁（:11921）皆 200；再抓 server 近 3 分鐘 log 的 warn/error（僅提示不擋）

參數：`-Target server|client|both`（預設 both）、`-Ref`（預設 HEAD）、`-DryRun`、`-SkipVerify`、`-RepoRoot`（預設由腳本位置推導 repo 根，跨 clone 可用）。

## 環境照會（排錯用）

| 項目 | 值 |
|---|---|
| LXC | 192.168.0.191（root，密碼在 `.env/pve.env`）；192.168.0.190 被佔用禁用 |
| 網頁入口 | http://192.168.0.191:11921（nginx 反代 `/api`、`/socket.io` → server:13001） |
| 映像 | `daojie-server:lxc`、`daojie-client:lxc`（本地建置） |
| 磁碟紅線 | LXC 僅 30G；映像快取膨脹時在 LXC 跑 `docker system prune` |
| server-data | `/opt/daojie/server-data` owner 必須 `100:101`，否則 GM 備份 EACCES |
| LXC 內無 curl | 驗證一律從本機 curl.exe 打；容器內檢查用 `docker exec` |

## 常見故障

- **build 逾時/失敗**：SSH 進 LXC 看 `/tmp/daojie-build.log` 全文；client 映像 build 內含 proof（chromium），本質就慢（數分鐘），屬正常
- **`DEPLOY_DONE` 未出現**：`docker ps` 看容器狀態，常見是 postgres/redis 未 ready，直接重跑腳本（冪等）
- **首頁 200 但功能異常**：瀏覽器強制刷新（新版 JS chunk hash 變了才會生效）
