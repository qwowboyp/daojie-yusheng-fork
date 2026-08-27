# F3 — Real Manual QA Rerun（zh-tw-only-conversion）

> Approval Gate 複驗報告
> 日期：2026-08-22（UTC+8）
> 驗證對象：生產 LXC `192.168.0.191`，redeploy commit `7c174ec6`
> 測試帳號：`qwowboyp`（密碼沿用既有測試密，未重設）
> 驗證方式：agent-browser 實機操作 + DOM/a11y 原文 + 線上 JS bundle 字串掃描 + GM diagnostics 只讀 SQL
> 截圖目錄：`.omo/evidence/zh-tw-only-conversion/final-wave/F3-rerun/`

---

## Verdict：APPROVE

上一輪 REJECT 的 6 個 blocker 在本輪實機全部通過。先前已 PASS 的登入／背包／功法／設置表面仍為繁中。GM 郵件雙表 residual = 0，`sender_label` = 司命臺。

---

## 1. Health Check

| 端點 | 結果 |
|---|---|
| `http://192.168.0.191:13001/health` | **200** `{"ok":true,"service":"server"}` |
| `http://192.168.0.191:13001/live` | **200** `{"ok":true,"service":"server","alive":{"ok":true,"service":"server"}}` |
| `http://192.168.0.191:11921/` | 可達，登入頁載入成功 |

## 2. Login Flow

- 入口：`http://192.168.0.191:11921`
- 帳號 `qwowboyp` 登入成功，出現離線收益阻塞彈窗後點「確認收取」進入世界
- 未重設密碼

登入頁 a11y / 截圖（`01-login-page.png`）：

| 元素 | 實際文字 | 判定 |
|---|---|---|
| Tab | 登入 / 註冊 | PASS |
| 標籤 | 賬號 / 角色名、密碼 | PASS（賬 非 账） |
| placeholder | 輸入賬號或角色名、輸入密碼 | PASS |
| 按鈕 | 登入 | PASS |

---

## 3. 上一輪 REJECT blocker 複驗

### Blocker 1 — offline-gain-modal 阻塞註記

**判定：PASS**

登入後立即出現阻塞離線收益彈窗。DOM `get text body` 原文：

> 確認前角色仍保持離線掛機，收益會自動刷新。

同時可見：標題「離線掛機收益」、頂欄「確認後將結算雲端離線收益並進入遊戲」、按鈕「確認收取」。

- 截圖：`03-offline-gain-modal.png`、`02-after-login.png`
- 線上 `main-BNz2Pujt.js`：`確認前角色仍保持離線掛機` = 1；簡體「确认前角色仍保持离线挂机」= 0

### Blocker 2 — 屬性標籤 體魄／神識／經脈／閃避／暴擊

**判定：PASS**

六維面板 a11y name（多次 snapshot 穩定出現）：

> 六維輪圖刻度 20**體魄**11**神識**11身法11根骨11力道11**經脈**11…根基00悟性0幸運

鬥法面板 a11y name：

> 鬥法數值…命中14**閃避**14**暴擊**14免爆200%暴擊傷害14破招14化解1每回合行動次數

特殊屬性面板：視野範圍／境界修為／功法經驗／每息境界修為／掉落增幅／23.73萬 — 全繁中。

- 截圖：`07-six-dim.png`、`06-combat-stats.png`、`08-special-stats.png`
- 線上 `shared-DmraMtRk.js` 顯示表：`constitution:"體魄",spirit:"神識",…meridians:"經脈"`
- 簡體「体魄／神识／经脉」只出現在 **輸入別名表** `[["体魄","constitution"],["神识","spirit"],["经脉","meridians"],…]`，不是玩家可見標籤（接受：玩家／舊輸入相容）
- 線上 `main-BNz2Pujt.js` 有 2 處「闪避」，位於戰鬥 log **解析 regex**（`结果 (?<result>闪避)|(?<dodgeResult>被闪避，未造成伤害)`），顯示 fallback 是「閃避」。玩家可見鬥法標籤是繁中

### Blocker 3 — 境界名／描述

**判定：PASS**

百科「境界表」`get text` 全文（`10-realm-table.png` + DOM）：

| 抽樣 | 實際 |
|---|---|
| 淬體境 | Lv.6 大境界 **淬體境** |
| 鍛骨境 | Lv.9 大境界 **鍛骨境** |
| 練氣 | 練氣一層／練氣前期／練氣中期／練氣後期／練氣巔峰／練氣大圓滿 |
| 築基 | 半步築基／築基一層／築基前期…築基大圓滿 |
| 飛昇 | 半步飛昇／**飛昇** |

HUD 現況：鍛骨 lv3、骨沉如鐵、突破 · 易筋。

線上 `shared-DmraMtRk.js`：`name:"淬體境"`、`narrative:"以氣血反覆淬洗皮肉，凡軀漸能承載更重勁力。"`、`筋骨未開`；簡體「淬体／锻骨境／练气／筑基／飞升」= 0。

### Blocker 4 — stat-preview 行增傷／行減傷

**判定：PASS**（部署包字串 + 零簡體殘留）

本帳號當前裝備沒有元素增傷／減傷，tooltip 無法在實機打出「行增傷」那一行。改驗 **已部署 client**：

| bundle | 行增傷 | 行減傷 | 行增伤 | 行减伤 |
|---|---:|---:|---:|---:|
| `main-panels-DUnxhVZ0.js` | 1（`${Ze(l)}行增傷`） | 1 | 0 | 0 |
| `shared-DmraMtRk.js` | 0 | 0 | 0 | 0 |

上一輪硬編碼簡體已不在線上包。

### Blocker 5 — npc-quest-modal fallbacks

**判定：PASS**

點開主線「斷道舊事」詳情，DOM 原文：

> **相關引導**
> 打開這個任務關聯的操作引導，不會改變任務進度。
> **打開引導**

a11y：`button "打開引導"`。

- 截圖：`14-quests.png`、`15-quest-detail.png`（詳情下半「相關引導」在捲動區，DOM 已抓到）
- 線上 fallback：`l("quest.detail.guide",void 0,"相關引導")`、`l("quest.action.open-guide",void 0,"打開引導")`；「相关引导」= 0

### Blocker 6 — display-number 萬／億

**判定：PASS**

HUD DOM 原文：`境界修為 (1.5萬/1.5萬)`。特殊屬性：`23.73萬`。

線上 `shared-DmraMtRk.js`：`{value:1e8,suffix:"億"},{value:1e4,suffix:"萬"}`。簡體「万／亿」在 shared／main-panels／catalog 顯示路徑 = 0。

- 截圖：`04-in-game.png`、`05-in-game-clean.png`、`08-special-stats.png`

---

## 4. GM 郵件 DB

只讀查詢（LXC GM diagnostics，`192.168.0.191:13001`）：

| 檢查 | 結果 |
|---|---|
| `player_mail` system `sender_label` | **司命臺**（1 列） |
| `player_mail` 簡體字掃描 | **0 列** |
| `player_mail_archive` 列數 | **0** |
| `player_mail_archive` 簡體字掃描 | **0** |
| `player_mail_conversion_meta` residual | player_mail **0**；player_mail_archive **0** |

證據：`F3-rerun/gm-mail-player.json`、`gm-mail-archive.json`、`gm-mail-conversion-meta.json`、`gm-mail-residual-scan.json`。

---

## 5. 先前已 PASS 表面複驗

| 表面 | 抽樣 | 判定 |
|---|---|---|
| 登入頁 | 登入／註冊／賬號／密碼 | PASS `01-login-page.png` |
| 背包 | 一鍵整理／一鍵丟棄／全部／裝備／材料／功法書／消耗品／任務物；物品名回春散／靈石／功德／月露草／翠竹心／澤鱗／藥煙輕袍／採氣木墜／越溝快靴／斷碑紋劍／《分光步》 | PASS `11-inventory.png` |
| 功法 | 術法／內功／神通／秘術／未圓滿／已圓滿／當前沒有未圓滿的功法 | PASS `12-technique.png` |
| 設置 | 賬號：qwowboyp／賬號管理／兌換碼／資源重載／收支統計／顯示名稱／角色名稱／修改密碼／當前密碼／新密碼 | PASS `13-settings.png` |
| 任務簿 | 主線／支線／日常／奇遇／斷道舊事／進行中／前往目標 | PASS `14-quests.png` |
| 地圖情報 | 雲來鎮／虛境／武道起點／當前階段鍛骨 · 凡俗 | PASS |

書法標題：沿用 task-7 `brush-sample.png`，本輪不重做。

---

## 6. 截圖清單

| 檔案 | 內容 |
|---|---|
| `01-login-page.png` | 登入頁 |
| `02-after-login.png` | 登入後離線彈窗 |
| `03-offline-gain-modal.png` | 離線收益阻塞註記 |
| `04-in-game.png` | 進世界（含新手引導） |
| `05-in-game-clean.png` | 關引導後主畫面 |
| `06-combat-stats.png` | 鬥法數值 |
| `07-six-dim.png` | 六維輪圖 |
| `08-special-stats.png` | 特殊屬性（含 萬） |
| `09-encyclopedia.png` | 百科 |
| `10-realm-table.png` | 境界表 |
| `11-inventory.png` | 背包 一鍵整理／一鍵丟棄 |
| `12-technique.png` | 功法 |
| `13-settings.png` | 設置 |
| `14-quests.png` | 任務簿 |
| `15-quest-detail.png` | 任務詳情 |

---

## 7. 非違規（計劃已接受）

- GM 面板簡體（本輪未當成玩家表面）
- HTML 靜態 fallback 仍是簡體（`登录`／`注册`／`账号`），runtime i18n（`zh-TW.csv`）覆寫後實機顯示繁中
- shared 輸入別名表保留簡體鍵（体魄／神识／经脉），只做解析、不當顯示標籤
- 戰鬥 log regex 仍能吃舊簡體「闪避」；顯示 fallback 是「閃避」
- 離線收益舊 session 物品名（本輪彈窗為「本次沒有收支變化」，未觸發）
- 玩家自填：角色名「老爸爸」、顯示名「老」

---

## 8. 結論

6 個上一輪 REJECT blocker 在 7c174ec6 重部署後的 LXC 實機均已修復。玩家可見登入、離線收益、狀態欄、六維、鬥法、境界表、背包、功法、設置、任務詳情均為繁體中文。郵件雙表 residual = 0。

VERDICT: APPROVE
