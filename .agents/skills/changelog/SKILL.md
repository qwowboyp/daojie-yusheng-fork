---
name: changelog
description: 道劫余生的雙軌更新日誌寫入規範（遊戲內「歲月史書」面板 + docs/CHANGELOG.md）。當使用者要求「寫更新日誌」「更新 changelog」「記錄本次改動到遊戲內日誌」「歲月史書加條目」或完成一批玩家可見的功能/修復後需要記錄時使用。
---

# 道劫余生更新日誌（雙軌寫入）

一次改動寫**兩個檔案**，格式不同、缺一不可，**一律台灣繁體**：

| 檔案 | 受眾 | 語言 |
|---|---|---|
| `packages/client/src/constants/ui/changelog.ts` | 遊戲內「歲月史書」面板（玩家可見） | 台灣繁體 |
| `docs/CHANGELOG.md` | 倉庫文檔中心 | 台灣繁體 |

## changelog.ts（遊戲內）

陣列最新在最前。條目類型 `ChangelogEntry`（`updatedAt` / `summary` / `items`，類型從 `../../ui/changelog-data` import）：

```ts
{
  updatedAt: '2026-08-24',
  summary: '一句話摘要，句號結尾，不換行。',
  items: [
    '分類：功能描述 — 細節補充。',   // 分類前綴：新玩法/戰鬥/頭像/介面/地圖/音樂/穩定性等
    '分類：另一條改動。',
  ],
},
```

規則：
- 頂部條目與本次同一天 → 新建條目插到最前（歷史出現過同日多條並存，不合併舊條目）
- `summary` 概括本次全部內容；`items` 每條一個改動，帶分類前綴
- 重點功能條目用 `名稱 — 描述` 破折號展開寫細節

## docs/CHANGELOG.md

結構：`## YYYY年M月`（月標題）→ `### 分類`（小節）→ `- 條目`，月與月之間 `---` 分隔：

- 當月已存在 → 在該月內追加小節/條目；跨月 → 在檔案頂部 `---` 後新建月標題
- 大功能用粗體：`- **全服頭像上線** — 描述`
- 小節命名參考：新玩法 / 玩家頭像 / 戰鬥 / 離線掛機 / 裝備與強化 / 地圖 / 修煉 / 介面改進 / 音樂與音效 / 穩定性

## 寫作規則（兩軌通用）

1. **一律台灣繁體**：用詞對齊台灣慣用（伺服器/介面/設定/支援/滑鼠/圖示/預設/資訊/紀錄），不用簡體詞彙
2. **玩家視角**：寫玩法與體驗變化；禁止 commit hash、檔名、表名、docker/env 配置等技術細節
3. 開發期間引入又修掉的 Bug 不寫
4. 數字寫明單位與範圍（如「2MB 內圖片」「約一分鐘內更新」）

## 驗證（寫完必跑）

```bash
node scripts/check-traditional.mjs --scope client        # 簡轉繁守門，必須 ok:true
node scripts/check-traditional.mjs docs/CHANGELOG.md     # docs 檔逐檔驗證
pnpm --filter @mud/client exec tsc --noEmit              # changelog.ts 是程式碼，必須過編譯
```

## 提交與部署

- 提交：`docs(changelog): <摘要>`，兩個檔案一起；changelog.ts 屬程式碼改動，可單獨提交（不違反「純文檔不單獨提交」規則）
- 部署：玩家要看到新日誌必須重建部署 client；可與後續程式碼改動合併部署
