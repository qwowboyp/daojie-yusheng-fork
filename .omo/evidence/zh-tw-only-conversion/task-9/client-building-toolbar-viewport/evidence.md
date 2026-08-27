# Task-9c: 修復 building-mode-toolbar 視口錨定 + verify:client 全綠

日期：2026-08-20
範圍：packages/client（未觸 server、未 commit）

## 1. 問題

`pnpm verify:client` → `proof:building-material-candidates` 於
`packages/client/scripts/prove-building-material-candidates.mjs:146` 失敗：

```
assert(initial.worldVisibleRatio >= 0.74, '手机端营造模式保留的游戏世界高度不足 74%');
// worldVisibleRatio = toolbarRect.top / window.innerHeight（視口 390x844）
```

實測 `toolbar.top = 287.86, height = 200, ratio = 0.341`。

## 2. 根因

- `#building-mode-toolbar` 是 `#game-stage` 的直接子節點（index.html:239）。
- `.building-mode-toolbar` base 為 `position: absolute`（overlays.css:436），
  offsetParent = `#game-stage`（`position: relative`，overlays.css:204）。
- `bottom` 因此相對**地圖區**而非視口。手機版 proof 量測時（openBuildingPanel 後僅等 2 rAF），
  `#game-shell` 的 `grid-template-rows` 0.25s transition 尚在進行（1.18fr→1fr），
  game-stage 高度 ~491.86px → toolbar 綁在未展開的地圖行底部 → ratio 0.341。
- proof 的斷言以 `window.innerHeight` 為分母，設計意圖就是「視口底部錨定」。

## 3. 修復（CSS）

`packages/client/src/styles/responsive.css`（mobile media query 內，原 :905）：

```diff
       .building-mode-toolbar {
+        /* 手机端锚定视口底部而非 #game-stage（offsetParent），避免工具栏跟随未展开的地图行高，
+           保证营造模式下游戏世界保留高度按 window.innerHeight 计算 */
+        position: fixed;
         left: 4px;
         right: 4px;
         bottom: max(4px, env(safe-area-inset-bottom, 0px));
         width: auto;
         height: min(36dvh, 200px);
         max-height: calc(100% - 12px);
         transform: none;
       }
```

### 為何正確

- `position: fixed` 使 containing block = 視口，`bottom/left/right` 直接錨定視口底部，
  完全擺脫 `#game-stage` 行高與 0.25s grid transition 的時序依賴。
  390x844：top = 844 − 4 − 200 = 640 → ratio = 640/844 ≈ 0.758 ≥ 0.74 ✓
- 祖先鏈（#game-stage → .layout-section → #layout-center → #game-shell）無
  transform/filter/perspective/contain，fixed 不會被重定向；`.layout-section` 的
  `overflow: hidden` 不裁切 fixed 元素。
- `#game-stage` 有 `position: relative; z-index: 1`（stacking context），fixed 子元素仍在
  其中合成，疊層順序無變化。
- **只加在 mobile media query**（`@media (max-width: 920px), …coarse/hover:none` 區塊，
  即 `#game-shell { position: fixed; inset: 0 }` 所在區塊）：桌面 base 維持 absolute
  錨定 game-stage（地圖區底部、不蓋 bottom shell 聊天區）的既有設計，零桌面影響。
- media query 覆寫的 left/right/bottom/width/height/transform 與 fixed 完全相容。

## 4. 串接排除（verify:client 全綠所需，同系列「proof 期望值過期」殘留）

CSS 修好後 chain 依序暴露 4 個後續阻塞，全部是先前 shared/client 轉繁後 proof 期望未對齊，
以及 1 個 Windows 暫態檔鎖：

| 檔案 | 變更 |
|---|---|
| prove-access-policy-editor.mjs:407 | 宗門職位清單期望 → 繁體（shared `sect-types.ts` SECT_MEMBER_ROLE_LABELS 已繁） |
| prove-technique-unification-mobile.mjs:780 | `['内门弟子']` → `['內門弟子']` |
| prove-technique-unification-mobile.mjs:795 | 六維屬性期望 → `體魄/神識/身法/根骨/力道/經脈`（shared ATTR_KEY_LABELS 已繁） |
| verify-technique-preview.mjs:110,111,165,267-275,393 | `/体魄\+/`→`/體魄\+/` 等；hover 構成九項 `自身境界等級…自身陣法等級` → 繁體；`/神识\+9/`→`/神識\+9/` |
| prove-technique-generation-batch.mjs:13-22 | `单部领悟/全部采纳并学习/放弃本批功法/六维权重均衡/功法类型/参悟方式` → 繁體（TechniqueGenerationPanel.tsx 已全繁） |
| browser-proof-runtime.mjs:202 | profile 清理 rm 加 try/catch（EBUSY best-effort，warn 不 fail） |
| prove-inventory-cooldown-visibility.mjs:343 | 自有 inline harness 的 rm 加 maxRetries:5 + try/catch（同上） |

**刻意不改**（對齊實際輸出，實際仍簡體）：
- verify-technique-preview 的 `无属性灵气吸收效率/煞气吸收效率`（來源 `client/src/ui/technique-bonus-summary.ts` 仍簡體）
- `assert.notEqual(summary, '无增益')`（同來源 fallback）
- prove-technique-unification-mobile:793 `凡阶归元功`（fixture 假資料）
- prove-access-policy-editor:417 `#10002 青云剑客`（fixture 假資料）

**範圍外記錄**：`prove-auction-mobile-scroll.mjs:421`、`prove-transmission-status-request-lifecycle.mjs:360`
兩處 inline harness 的無防護 rm 清理不在 build/verify 鏈內，未動（同類 EBUSY 風險存在）。

## 5. 驗證

```
$env:CHROME_BIN = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
pnpm --filter @mud/client proof:building-material-candidates
  → REPAIR_PROOF:ISSUE-000016:PASS / PROOF:BUILDING_MOBILE_COMPACT:PASS，EXIT=0

pnpm verify:client
  → gm-login-autofill ✓ → build:client（tsc --noEmit + vite build + 28 proof）✓
    → technique-preview ✓（覆蓋 30 門帶屬性功法）→ player-statistic-history ✓
  → EXIT=0
```

其他 building-mode proof：全倉唯二引用 `building-mode-toolbar` 的是本 proof 與
`check-high-frequency-ui-continuity.mjs`（靜態 TS 原始碼文字檢查，CSS 無關，
已隨 build 鏈 `proof:ui-continuity` 通過）。

## 6. 變更檔案清單（本任務）

1. packages/client/src/styles/responsive.css（+3 行，唯一 CSS 修復）
2. packages/client/scripts/prove-access-policy-editor.mjs
3. packages/client/scripts/prove-technique-unification-mobile.mjs
4. packages/client/scripts/verify-technique-preview.mjs
5. packages/client/scripts/prove-technique-generation-batch.mjs
6. packages/client/scripts/browser-proof-runtime.mjs
7. packages/client/scripts/prove-inventory-cooldown-visibility.mjs

未 commit（依任務指示）。
