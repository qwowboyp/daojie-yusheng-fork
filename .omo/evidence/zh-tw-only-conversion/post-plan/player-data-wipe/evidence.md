# LXC 玩家帳號 / 角色資料清檔證據

日期：2026-08-22  
目標：`192.168.0.191`（LXC 105 `daojie`，自建 <10 人私服）  
資料庫：`daojie_yusheng`（`docker exec daojie-postgres psql -U mud`）  
**未提交 git。憑證已遮罩。**

## 結論

- 清檔前完整 `pg_dump` + Redis RDB 已落地，`gzip -t` 通過。
- 唯一舊帳 `qwowboyp`（`user_id=7aca12c0-6941-42d7-b614-26b5b55a39e0`，`player_no=1`）及全部玩家域資料已清空。
- 系統 / 審計 / 地圖實例結構保留。
- 兩張 conversion 備份表已 DROP。
- `/health` + `/live` = 200；瀏覽器註冊新帳可進世界、HUD 載入；測試帳已再清掉，DB 回到 0 玩家。

## Phase A：備份（刪除前）

磁碟：`/opt` 30G，已用 6.0G，可用 22G（22%）。紅線未觸。

| 檔案 | 大小 | 校驗 |
|---|---|---|
| `/opt/daojie/backups/daojie_yusheng-pre-wipe-20260822-085813.sql.gz` | 44K | `gzip -t` PASS（清檔後複驗仍 PASS） |
| `/opt/daojie/backups/redis-pre-wipe-20260822-085813.rdb` | 89B | `docker exec daojie-redis redis-cli SAVE` OK + `docker cp` PASS |

44K 合理：當時只有 1 個帳號。

### 回滾（未執行）

```bash
gunzip -c /opt/daojie/backups/daojie_yusheng-pre-wipe-20260822-085813.sql.gz \
  | docker exec -i daojie-postgres psql -U mud -d daojie_yusheng
```

Redis（若需要）：把 `redis-pre-wipe-20260822-085813.rdb` 覆回容器 `/data/dump.rdb` 後重啟 `daojie-redis`。當時 keyspace 為空，通常不必回滾 Redis。

## Phase B：清檔前表分類

共 113 張 public 表。唯一玩家帳：`qwowboyp` / 顯示名「老」。

### 刪除（player-scoped）— 清檔前列數

| 表 | before |
|---|---:|
| server_player_auth | 1 |
| server_player_identity | 1 |
| player_identity | 1 |
| player_inventory_item | 15 |
| player_profession_state | 8 |
| player_counters | 3 |
| player_flush_ledger | 3 |
| player_quest_progress | 2 |
| player_statistic_day_total | 2 |
| player_mail | 1 |
| player_mail_attachment | 2 |
| player_mail_counter | 1 |
| player_mail_pre_tw_backup | 1（後 DROP） |
| player_mail_archive_pre_tw_backup | 0（後 DROP） |
| player_artifact_slot | 1 |
| player_attr_state | 1 |
| player_auto_battle_skill | 1 |
| player_body_training_state | 1 |
| player_combat_preferences | 1 |
| player_daily_sign_in | 1 |
| player_daily_sign_in_claim | 1 |
| player_map_unlock | 1 |
| player_offline_gain_session | 1 |
| player_position_checkpoint | 1 |
| player_presence | 1 |
| player_progression_core | 1 |
| player_recovery_watermark | 1 |
| player_sect_membership | 1 |
| player_session_route | 1 |
| player_technique_activity_queue | 1 |
| player_technique_state | 1 |
| player_vitals | 1 |
| player_wallet | 1 |
| player_world_anchor | 1 |
| durable_operation_log | 3（玩家 mail-claim / quest / sign-in） |
| outbox_event | 3（同上，status=delivered） |
| outbox_consumer_dedupe | 3 |
| 其餘 player_* / server_market_* / server_chat_message / server_sect / generated_technique / technique_generation_job | 0 |

其餘 0 列的 player 表同樣 TRUNCATE，避免殘留約束 / 序號。

### 保留（system / audit / world）

| 表 | before | after | 理由 |
|---|---:|---:|---|
| gm_audit_log | 16 | 16 | GM 審計 |
| player_mail_conversion_meta | 3 | 3 | 簡繁轉換審計 |
| asset_audit_log | 4 | 4 | 資產審計 |
| instance_catalog | 80 | 80 | 地圖實例目錄 |
| instance_checkpoint | 80 | 80 | 地圖檢查點 |
| instance_recovery_watermark | 80 | 80 | 地圖水位 |
| instance_flush_ledger | 82 | 83 | 地圖刷盤帳本（重啟多寫 1 列，系統行為） |
| instance_container_state | 4 | 4 | 雲來鎮世界容器（客棧行李等），非玩家帳 |
| instance_container_timer | 4 | 4 | 同上 |
| instance_container_entry | 1 | 1 | 同上 |
| instance_monster_runtime_state | 3 | 3 | 世界怪物 runtime |
| scheduler_runtime_state | 1 | 1 | 調度器 |
| server_db_backup_metadata | 29 | 29 | DB 備份元資料 |
| server_gm_auth | 1 | 1 | GM 登入 |
| server_gm_runtime_flag | 3 | 3 | GM runtime flag |
| server_redeem_code* / server_registration_activation_code / server_ai_provider_config / server_gm_config / server_gm_secrets / node_registry / dead_letter_event | 0 | 0 | 系統結構 |

## Phase C：刪除

1. `docker stop daojie-server`（避免熱路徑回寫）
2. 單次交易 `TRUNCATE ... RESTART IDENTITY CASCADE`（上列 player-scoped 表，顯式清單，非全庫）
3. `DROP TABLE player_mail_pre_tw_backup, player_mail_archive_pre_tw_backup`
4. `setval('server_player_auth_player_no_seq', 1, false)`（下一號從 1）

第一次腳本用 `docker exec` 沒加 `-i`，heredoc 沒進 psql，資料未動。改 `docker exec -i < wipe.sql` 後成功。

清檔後立刻核對：auth=0、inventory=0、mail=0、presence=0；gm_audit=16、mail_meta=3、instance_catalog=80；兩張 backup 表 `to_regclass` = NULL。表數 113 → 111。

## Phase D：Runtime

Redis 清檔前 `DBSIZE=0`，`KEYS '*'` 空。仍執行 `FLUSHDB`（OK）。keyspace 當時只有 runtime/online 態，無兌換碼 / session secret。

`docker start daojie-server`。LXC 無 `curl`，本機驗：

- `GET http://192.168.0.191:13001/health` → **200** `{"ok":true,"service":"server"}`
- `GET http://192.168.0.191:13001/live` → **200**
- `GET http://192.168.0.191:11921/` → **200**

啟動日誌：`主线玩家鉴权存储已就绪：已加载 0 个账号`。  
`WARN` 僅出現在 `docker stop` 當下（`调度器状态持久化失败：timeout exceeded when trying to connect`），屬舊行程關閉，新 generation 無新 WARN/ERROR。

## Phase E：E2E 與再清理

瀏覽器 `http://192.168.0.191:11921`：

1. 登入頁可用（`wipe-login-before.png`）
2. 註冊拋棄帳 `wipeprobe01` / 角色 `WipeProbe` / 顯示名 `W`
3. 進世界：雲來鎮、背包 2/200（《青木劍訣》、回春散）、六維 HUD（`wipe-hud-after-register.png`）
4. 測試帳 `user_id=a7874288-ba82-4647-a4ca-e12a0e67e2aa`，`player_no=1`

第一次只 TRUNCATE、沒停 server：在線 session 把 `player_statistic_day_total` 刷回 1 列。改為關瀏覽器 → `docker stop` → 再 TRUNCATE → `FLUSHDB` → `docker start`。

最終玩家域列數：除 `player_mail_conversion_meta=3`（保留）外全部 **0**。auth=0。

登入頁清檔後仍可用（`wipe-login-after.png`）。health/live 再驗 200。

## 截圖

- `wipe-login-before.png` — 清檔後、註冊前登入頁
- `wipe-hud-after-register.png` — 新帳進世界 HUD
- `wipe-login-after.png` — 刪測試帳後登入頁

## 未做

- 未動 `pgdata` volume 結構、docker-stack、content 檔、`gm_audit_log`
- 未把憑證寫進任何會進 git 的檔
- 未 git commit
