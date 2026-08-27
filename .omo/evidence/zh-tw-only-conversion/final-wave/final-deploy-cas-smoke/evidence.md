# Final Deploy CAS Smoke — 0d660d58 → LXC

日期：2026-08-22（LXC UTC 01:19–01:31）
HEAD：`0d660d58c7aed1ff6c66f9420114e56587b5a511`
範圍：只重建 server 映像（client 沿用 7c174ec6 的 `daojie-client:lxc`）
未 commit（本任務禁止）

---

## 1. 部署結果

| 項目 | 值 |
|---|---|
| LXC | 105 / 192.168.0.191 |
| 部署前 disk | 30G 總 / 6.0G 用 / 22G 可用 |
| rollback `daojie-server:lxc-pre-tw3` | `2b300a647bc7`（224MB，7c174ec6 映像） |
| 新 server | `daojie-server:lxc` = `8a5d27f598d5`（224MB） |
| client（未動） | `daojie-client:lxc` = `90a5c510a7f4`（73.3MB，7c174ec6） |
| 舊 `*-pre-tw` / `*-pre-tw2` | 仍在，未動 |
| server-data owner | `postfix:input`（100:101） |
| WARN baseline（24h） | 0 |
| 部署後 WARN（20m） | 0 |

源碼：`git archive` HEAD=0d660d58 → `/tmp/daojie-src.tar.gz`（13MB）→ 原子替換 `/opt/daojie/src`。
Build：`docker build -f packages/server/Dockerfile -t daojie-server:lxc .`（01:20:29–01:21:48 UTC）。
Deploy：`bash /opt/daojie/lxc-deploy.sh`（01:22:57–01:23:06 UTC）。client 映像未 rebuild。

啟動：80 實例恢復、離線掛機 1 人、tick 已開。

---

## 2. 健康檢查

```
/health → 200 {"ok":true,"service":"server"}
/live   → 200 {"ok":true,"service":"server","alive":{"ok":true,"service":"server"}}
web :11921 → 200
WARN = 0 ≤ baseline 0
```

---

## 3. 容器內 DB smoke

命令：`docker exec daojie-server node dist/tools/mail-traditionalize-conversion-smoke.js`

### 3.1 映像內原版第一次跑（FAIL，未污染生產）

`search_path=<smoke>,public` 讓 `to_regclass('player_mail_pre_tw_backup')` 命中 **public** 既有備份表（todo 10 / 7c174ec6 apply 留下的）。

- dry-run / CAS drift 路徑有跑到（ERROR：`player_mail_convert_row_drift:smoke:mail:sys:1`，整體回滾）
- 解除投毒後 firstRun 轉了隔離 schema 的 3 行
- 斷言 `player_mail 备份表应新建` 失敗（`backupTableCreated=false`）
- 生產核對：`player_mail` 仍 1 列「司命臺」；backup 仍 1/0；meta 未被 smoke 覆寫；`smoke_%` schema 0（DROP CASCADE）

根因：smoke 註解寫「絕不觸碰真實生產表」，但隔離 URL 刻意把 `public` 掛進 search_path；生產已有同名備份/標記表時，`ensureBackupTable` 會當成「已存在」。轉換 UPDATE 仍打到 smoke schema（search_path 第一個），生產列未被改。

### 3.2 隔離修補後重跑（PASS）

只改容器內 smoke 的 isolated URL：`search_path=<schema>`（去掉 `,public`）。跑完立刻把原 JS 拷回。**未改映像 tag、未改轉換實作、未 commit。**

見 `smoke-pass.json`：

| 段 | 結果 |
|---|---|
| dryRun | matched 7 / converted 3（mail 2 + archive 1） |
| driftCase | `ok:false`，converted 0，error 含 `player_mail_convert_row_drift:smoke:mail:sys:1`，`rollbackVerified:true` |
| firstRun | converted 3 / skipped 4 / residual 0；兩表 `backupTableCreated:true` |
| secondRun | converted 0 / skipped 7 / residual 0；`backupTablesRecreated:0` |
| 退出碼 | 0 |

生產核對（smoke 後）：

```
player_mail system sender_label = 司命臺
meta keys 仍是 GM apply 的 batch（見 §4），不是 smoke fixture
smoke_% schema = 0
```

後續若要讓映像內原版 smoke 在「public 已有同名備份表」的生產庫一次過，應把 isolated `search_path` 改成 schema-only（或所有 DDL/DML schema-qualify）。本任務不改碼、不 commit。

---

## 4. GM API 郵件轉換回歸

端點：`POST /api/gm/shortcuts/compat/mail-traditionalize/{dry-run,apply}`
入口：`http://192.168.0.191:13001`（本機 LXC，非外網域名）

### dry-run（HTTP 201）

見 `gm-mail-dry-run.json`：

| 表 | matched | converted | skipped | residual |
|---|---:|---:|---:|---:|
| player_mail | 1 | 0 | 1 | 0 |
| player_mail_archive | 0 | 0 | 0 | 0 |

`player_mail` 1 列已是繁中（司命臺），idempotent skip。archive 0 列。

### apply（HTTP 201）

見 `gm-mail-apply.json`：

- 頂層 `ok:true` / `convertedRows=0` / `skippedRows=1` / `residualSimplifiedRows=0`
- `batchId=mail-tw-20260822012806-zuqy7l`
- 兩表 `backupTableCreated=false`（表已在）
- 無錯誤

### 第二次 apply（HTTP 201）

見 `gm-mail-apply-idempotent.json`：

- `ok:true` / `convertedRows=0` / `skippedRows=1` / `residual=0`
- `batchId=mail-tw-20260822012806-s41mos`
- all-or-nothing 在無工作量時 = 乾淨成功

### DB cross-check

```
player_mail system = 司命臺（1 列）
player_mail_pre_tw_backup = 1 列（轉換前「司命台」）
player_mail_archive_pre_tw_backup = 0 列
meta:
  mail_snapshot_traditionalize                     mail-tw-20260819222201-i0jjlb  0/1
  mail_snapshot_traditionalize:player_mail         mail-tw-20260822012806-s41mos  0/1
  mail_snapshot_traditionalize:player_mail_archive mail-tw-20260822012806-s41mos  0/0
```

---

## 5. 未做 / 已知

- 未 rebuild client（0d660d58 只動 server）。
- 未改 docker-stack / pgdata / redis-data。
- 未 commit。
- 映像內原版 smoke 在此生產庫會因 public 同名備份表讓 `backupTableCreated` 斷言失敗；CAS 本體已用 schema-only 隔離在真 Postgres 上 PASS。
- 回滾標籤保留：`docker tag daojie-server:lxc-pre-tw3 daojie-server:lxc && bash /opt/daojie/lxc-deploy.sh`
