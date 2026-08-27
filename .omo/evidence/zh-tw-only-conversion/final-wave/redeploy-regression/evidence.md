# Redeploy Regression — 7c174ec6 → LXC

日期：2026-08-22（LXC UTC 00:26–00:33）
範圍：Final Wave 修復後重部署 + 雙表郵件轉換 + 線上回歸
HEAD：`7c174ec65c0be560e7d84e14e726d4178b7efda6`
未 commit（本任務禁止）

---

## 1. 部署結果

| 項目 | 值 |
|---|---|
| LXC | 105 / 192.168.0.191 |
| 部署前 disk | 30G 總 / 5.8G 用 / 23G 可用（未 prune） |
| rollback `*-pre-tw2` | server `9bebfd301c98`（224MB）、client `bebb05a9b12d`（73.3MB） |
| 新 server | `daojie-server:lxc` = `2b300a647bc7`（224MB） |
| 新 client | `daojie-client:lxc` = `90a5c510a7f4`（73.3MB） |
| 舊 `*-pre-tw` | 仍在，未動 |
| server-data owner | `postfix:input`（100:101） |
| WARN baseline（24h） | 0 |
| 部署後 WARN（10m） | 0 |

源碼抽查（解包後、build 前）：
- `value.ts`：`constitution: '體魄'` / `spirit: '神識'` / `meridians: '經脈'`
- `display-number.ts`：`suffix: '億'` / `suffix: '萬'`
- mail conversion：`player_mail_archive` 雙表管線 + `player_mail_archive_pre_tw_backup`

---

## 2. 健康檢查

```
/health → 200 {"ok":true,"service":"server"}
/live   → 200 {"ok":true,"service":"server","alive":{"ok":true,"service":"server"}}
web :11921 → 200（33268 bytes）
WARN = 0 ≤ baseline 0
啟動：80 實例恢復、離線掛機 1 人、tick 已開
```

---

## 3. GM 郵件雙表轉換

新代碼回傳 `tables[]`。生產 `player_mail_archive` **0 列**（自用服從未封存郵件），故 archive 無 pending 簡體——不是漏掃。

### dry-run

見 `gm-mail-dry-run.json`：

| 表 | matched | converted | skipped | residual |
|---|---:|---:|---:|---:|
| player_mail | 1 | 0 | 1 | 0 |
| player_mail_archive | 0 | 0 | 0 | 0 |

`player_mail` 1 列已是 todo 10 轉過的繁中（司命臺），故 skipped。

### apply

見 `gm-mail-apply.json`：
- 頂層 `convertedRows=0` / `skippedRows=1` / `residualSimplifiedRows=0`
- `player_mail_archive_pre_tw_backup` **首次建立**（`backupTableCreated=true`）
- 新 per-table marker：`mail_snapshot_traditionalize:player_mail` / `:player_mail_archive`
- 舊聚合 key `mail_snapshot_traditionalize` 仍在（無害歷史）

### 冪等第二次 apply

見 `gm-mail-apply-idempotent.json`：
- `convertedRows=0` / `skippedRows=1` / `residual=0`
- `backupTableCreated=false`

### DB cross-check

```
player_mail_archive GROUP BY sender_type → 0 rows
player_mail system sender_label = 司命臺
backup tables: player_mail_pre_tw_backup + player_mail_archive_pre_tw_backup
meta keys: 舊聚合 + 兩條 per-table
```

---

## 4. 線上回歸（http://192.168.0.191:11921，帳號 qwowboyp，未重設密碼）

| 檔案 | 驗證 |
|---|---|
| `01-login-page.png` | 登入頁全繁中；標題「道劫餘生」書法字 |
| `02-after-login.png` / `03-offline-gain-modal.png` | 離線收益阻塞註記「確認前角色仍保持**離線掛機**，收益會自動刷新。」（非「离线挂机」） |
| `04-in-game.png` | 進世界（含新手引導 overlay） |
| `05-in-game-clean.png` | 狀態欄 **境界修為 (1.5萬/1.5萬)**；六維 **體魄/神識/身法/根骨/力道/經脈**；境界 **鍛骨 · 骨沉如鐵** |
| `06-combat-stats.png` | 鬥法：**閃避 / 暴擊 / 免爆 / 暴擊傷害 / 每回合行動次數** |
| `07-item-tooltip.png` | 點選斷碑紋劍後背包高亮（hover tooltip 被百科 modal 擋住，屬性改由 05/06 驗證） |
| `08-encyclopedia.png` | 百科全繁中 |
| `09-realm-table.png` | 境界表：淬體境 / 鍛骨境 / 練氣前期 / 築基前期 / 金丹後期 / 煉虛 / 合體 / 飛昇 |
| `10-realm-desc-search.png` | 百科搜「筋骨」無條目（描述不在百科索引）；狀態欄已顯示「骨沉如鐵」 |

DOM body 原文：`境界修為 (1.5萬/1.5萬)` —— **無「万」**。

---

## 5. 書法字（task-7）

截圖另存：`.omo/evidence/zh-tw-only-conversion/task-7/brush-sample.png`（與 01-login-page 同一幀）。
判定見 task-7/evidence.md 追加段：**acceptable**。

---

## 6. 未做 / 已知

- `player_mail_archive` 生產為空，雙表管線有跑通（建 backup + per-table marker），但沒有「archive pending → converted」的真實列。
- 物品 hover tooltip 被百科 modal 擋住，未另截 tooltip 層。
- 未 commit、未改 docker-stack / pgdata / redis-data。
- 未重設 qwowboyp 密碼（原 `TwTest2026#Pass` 可登入）。
