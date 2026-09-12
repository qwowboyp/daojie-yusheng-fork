---
name: agy-image-gen
description: 道劫余生專用：呼叫外部 Antigravity CLI（agy）的 Gemini agent 生成遊戲美術圖片（道具圖集、功法書、裝備、材料、建築圖示）。當使用者要求「用 agy 生圖」「呼叫外部 agent 生成圖片」「用 Gemini 畫圖」「生成道具圖／圖集／美術素材」且需要實際產出圖片檔時使用。預設模型 gemini-3.8-flash-medium。內含 scratch 落檔坑、旗標順序坑、風格錨定提示詞模板與生成後驗證流程。
---

# agy-image-gen

以 `agy`（Antigravity CLI）驅動外部 Gemini agent 生成本專案美術。美術規範以 `docs/artwork/README.md` 為準（開工前必讀），本技能只負責 agy 調用層的實測知識。

## 環境（2026-09-12 實測）

| 項目 | 值 |
|---|---|
| 執行檔 | `C:\Users\code_base_new\AppData\Local\agy\bin\agy.exe`（已在 PATH），v1.2.1 |
| 預設模型 | `gemini-3.8-flash-medium`（使用者指定） |
| 認證 | 快取憑證已登入；報 `authentication required` 時請使用者互動式跑一次 `agy` 登入 |
| 自訂 agent | 未配置（`agy agents` 為空），`--agent` 暫不使用；日後配置後可用 `agy agents` 查清單 |
| stdout | v1.2.1 在 pwsh 子程序下正常（v1.0.x 空 stdout 坑已修）；成功判準一律用檔案存在，絕不信 stdout |

## 標準調用

```powershell
# 1) 先進到目標輸出目錄（agy 的 workspace = cwd）
Set-Location <輸出目錄>

# 2) --model 必須在 -p 之前，放後面會被靜默吞掉、退回預設模型
agy --model gemini-3.8-flash-medium -p "<提示詞>" --print-timeout 10m
```

- 生圖耗時 1–5 分鐘：bash 工具 `timeout` 給 ≥ 660000，`--print-timeout` 給 ≥ 10m（預設 5m 不夠）
- workspace 內讀寫自動允許，不需要 `--dangerously-skip-permissions`（shell 指令才會被 Ask，headless 下 soft-deny）
- 預設無狀態，每次都要下完整提示詞；要接續修正同一張圖用 `agy -c -p "..."`（續最近對話）
- 要結構化回報（如格位配置 JSON）可加 `--output-format json` 或 `--json-schema <schema檔>`

## ⛔ 落檔坑（實測必中，最重要）

**agy 生成的圖片會落在 scratch 目錄，可能不落在 cwd**，即使提示詞寫「save to current directory」且回應聲稱已存到該處：

```
%USERPROFILE%\.gemini\antigravity-cli\scratch\<檔名>
```

實測兩次：一次 cwd 與 scratch 都有檔；一次只有 scratch 有、cwd 沒有，且 agent 回應**虛報成功**（詳細描述了圖片內容與「已存路徑」）。因此每次調用後必做：

```powershell
# 1) 驗證目標路徑
Test-Path "<目標檔案>"

# 2) 沒有 → 全盤查檔名（es.exe 最快）
es.exe <檔名> -n 5

# 3) 在 scratch 找到 → 移到目標位置
Move-Item "$env:USERPROFILE\.gemini\antigravity-cli\scratch\<檔名>" "<目標路徑>"
```

目標路徑與 scratch 都沒有檔案 → 才判定生成失敗，重跑。

## 提示詞模板（風格錨定，實測驗證通過）

**未加約束的提示詞實測會跑版**：3D 厚塗渲染、複合裝飾（流蘇／寶石／金雕）、光暈溢出裁切框、單格塞多件。生成本專案圖片必須套以下模板（英文提詞較穩定），負面清單不可省略：

### 圖集模板（批量道具預設）

```text
Generate ONE sprite-sheet image using your image generation tool.
It is a {COLS}x{ROWS} grid atlas of {N} distinct xianxia game item icons,
one item per cell: {ITEM_LIST - 每件一行簡述，附格位}.
STRICT STYLE RULES: hand-painted 2D game icon style, clean bold outlines,
oblique 3/4 view, flat colors with simple cel shading. NOT 3D render.
NOT thick oil painting. NO photorealism. NO decorative tassels, NO gemstone
inlays, NO ornate gold filigree. Each cell: exactly ONE item, centered at
about 64 percent of the cell, with roughly 18 percent transparent padding
on all four sides; no glow or particles extending beyond the item silhouette.
FULLY TRANSPARENT background (true alpha channel), absolutely NO text,
NO grid lines, NO borders, NO watermark, NO checkerboard pattern painted
into the image. Save as {FILENAME}.png. Reply with the exact saved file path.
```

### 單件模板（修補個別失敗圖示用）

把開頭 grid 段換成 `It is a single xianxia game item icon: {描述}`，其餘 STRICT STYLE RULES 與負面清單**全部保留**。

### 模板變數對照專案規範

- `{COLS}x{ROWS}`：預設 6×6（每張最多 36 件）；長型武器可調格數與留白
- `{ITEM_LIST}`：先排好 stable itemId ↔ 格位對照再提詞；道具名與介紹取自 `packages/server/data/content/items/` 模板
- 功法書：一致斜視角古冊，靠封面意象／主色／材質／適量靈氣效果區分，不改載體
- 風格對照：功法看 `docs/artwork/atlases/items-05.webp`；武器防具飾品看 `items-04.webp`、`items-07.webp`，並對照裁切後正式圖示
- 已完成且合格的單張素材保留沿用；僅使用者明確要求或修補個別失敗圖示時才單件生成
- 大型原圖放 `assets/generated/`（git 忽略），不進正式包

## 生成後驗證（強制，缺一不可）

1. **檔案存在**：目標路徑 `Test-Path`（見落檔坑，含 scratch 退救）
2. **視覺檢查**：用 look_at 檢查——手繪 2D 風格、單格單道具、輪廓完整、無鄰格殘片、無截斷、無文字／格線／浮水印、光效未溢出、與既有圖集風格一致
3. **alpha 實查**：生成器輸出的棋盤格像素不等於透明背景，必須以 node／sharp 腳本檢查實際 alpha 通道與每格透明留白
4. 不合格 → 帶著具體缺陷描述重提詞再生成（或 `agy -c` 接續修正），確認合格才入庫

## 入庫銜接（非本技能職責，僅提示）

裁切輸出 96px／192px 透明 WebP、記錄 `cell`／`extraction`／雜湊、匯入與驗證，全部照 `docs/artwork/README.md` 既有流程（如 `scripts/import-late-game-unique-icons.mjs`、`node scripts/prove-late-game-unique-icons.mjs`、`check-description-art-assets.mjs`）。

## 常見故障

| 症狀 | 處置 |
|---|---|
| `authentication required` | 請使用者互動式跑一次 `agy` 登入；無頭環境可設 `ANTIGRAVITY_TOKEN` / `ANTIGRAVITY_API_KEY` |
| 模型不生效 | `--model` 必須放在 `-p` 之前 |
| 回應正常但目標路徑沒檔案 | 見「落檔坑」——先查 scratch 再判定失敗 |
| 逾時 | 加大 `--print-timeout` 與 bash 工具 timeout |
| 風格跑版 | 檢查提示詞是否漏了 STRICT STYLE RULES 負面清單或格位描述 |
| stdout 空字串但 exit 0 | 舊版（v1.0.x）坑；升級 agy，或改 `--output-format json` 落檔驗證 |
