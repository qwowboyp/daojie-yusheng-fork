# F3 — Real Manual QA Report（zh-tw-only-conversion）

> Approval Gate 驗收報告
> 日期：2026-08-20（UTC+8）
> 驗證對象：生產 LXC（192.168.0.191）已部署版本
> 測試帳號：`qwowboyp`（密碼已於 todo 10 重置為 `TwTest2026#Pass`）
> 驗證方式：agent-browser（Chrome for Testing headless）實機操作 + GM API 只讀查詢 + check-traditional guard

---

## Verdict：❌ REJECT

**理由**：玩家可見 UI 仍存在簡體中文殘留。雖然登入頁、背包、狀態欄、功法、設置等主要面板均已繁中，且 GM 郵件 DB 轉換正確，但**發現 4 處玩家可見簡體殘留**（其中 shared 層為系統性漏掃），違反「actual user-facing behavior is all-traditional (zh-TW) Chinese」的驗收標準。

---

## 1. Health Check ✅

| 端點 | 結果 |
|---|---|
| `http://192.168.0.191:13001/health` | **200** |
| `http://192.168.0.191:13001/live` | **200** |

## 2. Web Entry（http://192.168.0.191:11921）✅

登入頁可達，透過 agent-browser 開啟並截圖。

## 3. Login Page ✅ 全繁中

| 元素 | 實際文字 | 判定 |
|---|---|---|
| 標題 | 道劫餘生 | ✅ |
| Tab 1 | 登入 | ✅ |
| Tab 2 | 註冊 | ✅ |
| 輸入框 1 | 輸入賬號或角色名（placeholder）| ✅ 賬 非 账 |
| 輸入框 2 | 輸入密碼 | ✅ 密碼 非 密码 |
| 按鈕 | 登入 | ✅ |

視覺確認（look_at OCR）：所有文字均為繁體，未殘留任何簡體字符。

## 4. Login Flow ✅

- 登出後重新登入 `qwowboyp` / `TwTest2026#Pass` → 成功進入世界
- 錯誤訊息驗證：輸入不存在帳號 → **「使用者不存在」**（繁中，server native-player-auth 轉換生效）
- 登出訊息：**「已退出登入」**（繁中）
- 離線收益彈窗出現（見 §8 問題 1）

## 5. In-Game Panels ✅（主要面板已繁中）

| 面板 | 抽樣文字 | 判定 |
|---|---|---|
| 狀態欄 | 境界 / 境界修為 (1.5万/1.5万) / 生命值 149/149 / 靈力 74/74 | ✅ |
| 六維 | 體魄 11 / 神識 11 / 身法 11 / 根骨 11 / 力道 11 / 經脈 11 | ✅ |
| 背包 | 一鍵整理 / 一鍵丟棄 / 全部 / 裝備 / 材料 / 功法書 / 消耗品 / 任務物 | ✅ |
| 背包物品 | 回春散 / 靈石 / 功德 / 月露草 / 翠竹心 / 澤鱗 / 藥煙輕袍 / 採氣木墜 / 越溝快靴 / 斷碑紋劍 / 《分光步》 | ✅ |
| 功法 | 術法 / 內功 / 神通 / 秘術 / 未圓滿 / 已圓滿 / 當前沒有未圓滿的功法 | ✅ |
| 設置 | 賬號：qwowboyp / 賬號管理 / 兌換碼 / UI / 性能 / 資源重載 / 收支統計 / 顯示名稱 / 角色名稱 / 修改密碼 | ✅ |
| 突破面板 | 突破至 易筋 / 鍛骨 · 核心要求 / 六維總屬性達到 111 / 確認突破 | ✅ |
| 地圖訊息 | 雲來鎮 / 虛境 / 武道起點 / 當前階段鍛骨 · 凡俗 | ✅ |
| 行動欄 | 交互 / 技能 1/6 / 開關 / 行動 | ✅ |

## 6. GM Mail Conversion ✅

```sql
SELECT mail_id, sender_type, title, sender_label FROM player_mail WHERE sender_type='system'
```

結果（GM API diagnostics/query）：
```json
{"mail_id":"mail:p_7aca12c0-...:msz9ye2r:1:0","sender_type":"system","title":null,"sender_label":"司命臺"}
```

- **sender_label = 司命臺**（繁中）✅
- 1 筆 system mail 轉換成功，residual = 0（todo 10 apply 後維持）
- 證據：`gm-mail-db-check.json`

## 7. Screenshot Evidence ✅

存放於 `.omo/evidence/zh-tw-only-conversion/final-wave/`：

| 檔案 | 內容 |
|---|---|
| `login-page.png` | 登入頁（全繁中） |
| `in-game-state.png` | 遊戲主畫面（HUD 狀態欄） |
| `in-game-inventory.png` | 背包面板 |
| `technique-panel.png` | 功法面板 |
| `settings-panel.png` | 設置面板 |
| `status-bar.png` | 狀態欄特寫 |
| `offline-gain-modal.png` | 離線收益彈窗（非阻塞模式，繁中） |
| `gm-mail-db-check.json` | GM 郵件 DB 查詢結果 |

---

## 8. 發現的問題（REJECT 依據）

### 問題 1：offline-gain-modal.ts:401 硬編碼簡體（玩家可見，阻塞模式必現）

```ts
${blocking ? '<div class="offline-gain-blocking-note">确认前角色仍保持离线挂机，收益会自动刷新。</div>' : ''}
```

- **位置**：`packages/client/src/ui/offline-gain-modal.ts:401`
- **實際顯示**：登入有離線收益且需阻塞確認時，彈窗底部顯示「确认前角色仍保持离线挂机，收益会自动刷新。」
- **實測證據**：DOM body text 抓到「确认前角色仍保持离线挂机，收益会自动刷新。」（登入流程中）
- **guard 盲點**：此字串位於 template literal 內嵌 `${...}` 表達式，check-traditional.mjs 的 source 模式只掃 StringLiteral 與 NoSubstitutionTemplateLiteral，**掃不到**（該檔單獨跑 guard 回 `ok:true`）
- **root cause**：todo 5 轉換漏掉此檔（不在 whitelist），且 guard 無法覆蓋此語法

### 問題 2：shared/src/value.ts 70+ 處簡體屬性標籤（玩家可見，系統性）

- **位置**：`packages/shared/src/value.ts:474-519`（NUMERIC_STAT_LABELS / ATTR_LABELS）
- **違規示例**（guard 確認）：`体魄` `神识` `经脉` `最大灵力` `命中` `闪避` `暴击` `暴伤` `灵力回复` `生命回复` `冷却速度` `灵气消耗减免` `灵气强度` `境界修为倍率` `功法经验倍率` `境界修炼效率` `功法修炼效率` `视野范围` `额外射程` `额外范围` `每回合行动次数`，以及 line 724-828 的觸發時機標籤（`修炼中` `装备时` `攻击后` `击杀后` 等）與 line 695/699（`行增伤` `行减伤`）
- **玩家影響**：經 `client/src/domain-labels.ts` 匯出，顯示於屬性面板 tooltip、物品 tooltip、狀態預覽（stat-preview.ts:96/105 拼接「行增伤/行减伤」）
- **guard 狀態**：`check-traditional.mjs packages/shared/src/value.ts --mode source` → `ok:false`，70+ violations
- **root cause**：**shared 層只有 3 檔在 whitelist**（labels.ts / storage.ts / sect-types.ts），199 檔的 shared/src 其餘全漏掃

### 問題 3：shared/src/constants/gameplay/realm.ts 80+ 處簡體境界描述（玩家可見）

- **位置**：`packages/shared/src/constants/gameplay/realm.ts:242-622`
- **違規示例**（guard 確認）：`筋骨未开，仍在江湖门槛之外，只能以勤练夯实根基。` `淬体境` `锻骨境` `通脉境` `练气前期` `筑基前期` `金丹后期` `元婴化神` `炼虚合道` `合体圆满` `大乘初成` `渡劫飞升` 及全部境界描述文字
- **玩家影響**：境界突破、屬性面板、境界列表顯示
- **guard 狀態**：`ok:false`，80+ violations
- **root cause**：同問題 2，shared 層 whitelist 嚴重不足

### 問題 4：client/src/ui/stat-preview.ts:96/105 簡體

- `lines.push(...'行增伤'...)` / `'行减伤'`
- 屬性預覽（stat preview）玩家可見
- 此檔也不在 whitelist（59 個 client ui/ 檔漏掃之列）

### 問題 5（低風險）：npc-quest-modal.ts:486-494 i18n fallback 簡體

- `t('quest.detail.guide', undefined, '相关引导')` 等 4 處 fallback 簡體
- zh-TW.csv 已覆蓋這些 key（相關引導 / 打開引導 / 打開這個任務關聯的操作引導...），實際顯示繁中
- 但若 key 未來缺失，fallback 會顯示簡體 → 隱患

### 問題 6（低風險）：client/src/ui/panels/gm-panel.ts 簡體

- `机器人` `暂无 GM 数据` `在线玩家` `内存占用` 等
- 屬計劃已知例外（GM 面板保留簡化，learnings 記錄）→ 不算違規

---

## 9. 統計彙整

| 項目 | 結果 |
|---|---|
| whitelist 內 318 檔 guard | ✅ 全通過 |
| whitelist 外 client ui/ 檔 | **59 檔未納入掃描**（其中 offline-gain-modal / stat-preview 有玩家可見簡體） |
| whitelist 外 shared 檔 | **196 檔未納入掃描**（value.ts / realm.ts 有大量玩家可見簡體） |
| 玩家可見簡體殘留 | 至少 4 處檔案來源（>150 個字串） |

## 10. 建議（修復方向）

1. **將 shared/src 全部納入 guard 掃描**（或至少 value.ts / realm.ts / qi.ts / technique-*.ts 等含玩家可見字串的檔），跑 `convert-to-traditional.mjs --mode source` 補轉
2. **offline-gain-modal.ts:401** 改用 i18n key（zh-TW.csv 已有繁中模板可循），並強化 check-traditional.mjs 覆蓋 template literal 內嵌字串
3. **stat-preview.ts / npc-quest-modal.ts** fallback 字串轉繁
4. 補轉後重跑 verify:quick + verify:client + 全量 guard，重新部署 LXC，再做一次 F3 回歸

---

## 11. 結論

**❌ REJECT** — 主要登入/背包/功法/設置面板繁中化成功、GM 郵件轉換正確、登入流程順暢；但 shared 層系統性漏掃導致 150+ 個玩家可見簡體字串（屬性標籤、境界描述）殘留，且離線收益阻塞彈窗有硬編碼簡體。**不滿足「all-traditional user-facing behavior」驗收標準**。

需修復後重新部署並回歸驗證。
