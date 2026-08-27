# Fix: verify-technique-preview.mjs 簡體斷言同步為繁體

## 背景

F3 修正已將 `packages/client/src/ui/technique-bonus-summary.ts` 轉為繁體輸出（`無屬性`、`煞氣`、`無增益`、`靈氣`、`氣機`），但 `packages/client/scripts/verify-technique-preview.mjs` 仍以簡體斷言，導致：

```
actual: '體魄+629 / 經脈+629 / 無屬性靈氣吸收效率+10%', expected: /无属性灵气吸收效率\+10%/u
```

## 修改

僅改 `packages/client/scripts/verify-technique-preview.mjs`（唯一斷言 technique-bonus-summary 輸出的腳本；`check-map-render-lifecycle.mjs` 的 `靈氣/氣機` 屬望氣地圖渲染域，非本檔輸出，未動）。

| 替換 | 處數 | 性質 |
|---|---|---|
| `无属性灵气吸收效率` → `無屬性靈氣吸收效率` | 8 | 斷言字面值 + 訊息（L114/115/119/127/132/166/178/179） |
| `煞气吸收效率` → `煞氣吸收效率` | 2 | 斷言字面值（L127/132） |
| `气机` → `氣機` | 6 | 斷言訊息（L120/128/133/153/166/178） |
| `无增益` → `無增益` | 1 | 斷言字面值（L450，`notEqual` 檢查，若不改則永遠不會攔截「全部丟失」） |
| `逸散火属性灵气可感知` → `逸散火属性靈氣可感知` | 1 | 斷言字面值（L152；`属性` 保留簡體，因源檔 L207 仍輸出 `火属性`） |

正則結構未動，僅換中文字元。

## 驗證

```
pnpm --filter @mud/client exec node ./scripts/verify-technique-preview.mjs
```

輸出：`功法属性、系统术法、自创功法模板与技能完整详情验证通过（覆盖 30 门带属性功法）`，**EXIT_CODE=0**。

`rg -n "无属性|煞气|无增益|灵气|气机" packages/client/scripts/verify-technique-preview.mjs` → 無殘留簡體。

## 學習

- 斷言字面值必須以源檔實際輸出為準，不可猜測：源檔 L207 的 `火属性` 仍是簡體，故 `逸散火属性靈氣可感知` 中 `属性` 保留簡體。
- `assert.notEqual(summary, '无增益')` 這類「不等於」斷言若字面值未同步，會靜默失效（`無增益 !== 无增益` 恆真），比 `match` 斷言更危險。
- 同域掃描需區分：`check-map-render-lifecycle.mjs` 的 `靈氣/氣機` 是望氣地圖渲染測試資料，非 technique-bonus-summary 輸出，不可誤改。