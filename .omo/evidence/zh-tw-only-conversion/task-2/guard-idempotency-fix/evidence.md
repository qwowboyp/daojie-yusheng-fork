# Evidence — Guard Idempotency Fix (task-2 / guard-idempotency-fix)

日期：2026-08-19

## 背景

opencc-js `Converter({from:'cn',to:'tw'})` 非幂等：对已是台湾标准的文本再次转换时误转：

| 台湾标准（正确） | opencc cn→tw 再转结果 | 为何错误 |
|---|---|---|
| 濃郁（香氣濃郁） | 濃鬱 | 台灣標準是「濃郁」；「鬱」只用於憂鬱/鬱悶/鬱金香 |
| 馥郁 | 馥鬱 | 同 郁 問題（實測 opencc 目前不動 馥郁，仍按規範掩碼防護） |
| 岩（岩石/岩洞/黃岩） | 巖 | 台灣標準是「岩」（教育部）；「巖」是異體 |

## 根因实测（opencc 行为）

```
浓郁 => 濃郁          （正确）
濃郁 => 濃鬱          （错误再转换）
馥郁 => 馥郁          （opencc 不动，掩码为防御）
馥鬱 => 馥鬱          （幂等）
岩 => 巖              （错误）
岩石 => 岩石          （词内幂等）
黃岩鼉獸 => 黃巖鼉獸   （错误再转换）
憂郁 => 憂鬱          （正确，郁 必须仍被抓）
忧郁 => 憂鬱          （正确）
```

## 修复设计（掩码哨兵法）

- `scripts/lib/tw-vocabulary.mjs`：
  - `TW_PROTECTED_PHRASES = ['濃郁', '馥郁', '岩']`（可扩展）
  - `maskProtected(text)` → `{ text, restore }`：把保护词替换为控制字符哨兵
    `\u0000TW<i>\u0000`（源文本不可能出现；opencc 对非 CJK 控制字符透传），
    restore 闭包把哨兵换回原词。长词优先掩码（防御性，当前条目不重叠）。
  - `applyProtectedMask(text)` → 掩码后文本（守卫用便捷导出）
- `scripts/convert-to-traditional.mjs` `convertText()`：
  mask → applyVocabulary → cn2tw → restore
- `scripts/check-traditional.mjs` `textNeedsConversion()`：
  `const masked = applyProtectedMask(text)` 后再做词级命中 + `cn2tw(masked) !== masked`

不掩码单字「郁」：憂郁/忧郁 仍被守卫抓到。岩 单字掩码安全：简化字与
台湾标准同形，无独立简体变体。

## 验证结果

### 1. 全量守卫（content + maps 目录遍历模式）

```bash
node scripts/check-traditional.mjs packages/server/data/content packages/server/data/maps
```

```json
{
  "ok": true,
  "violations": []
}
```

退出码 0。

### 2. 守卫回归（临时文件）

| 输入 | 期望 | 结果 | 退出码 |
|---|---|---|---|
| `{"a":"浓郁"}`（真实简体） | 违规 | violation，line 1 sample 浓郁 | 1 |
| `{"a":"憂郁"}`（郁 在保护词外） | 违规 | violation，line 1 sample 憂郁 | 1 |
| `{"a":"岩石","b":"濃郁"}`（保护词） | ok | ok:true violations:[] | 0 |

### 3. 转换器回归

- `convertText('浓郁的岩壁')` → `{"text":"濃郁的岩壁","vocabHits":[]}`（兩者皆保护/转换正确）
- `convertText('岩石')` → `{"text":"岩石","vocabHits":[]}`（岩 保护，无变更）
- `convertText('黄岩鼍兽')` → `{"text":"黃岩鼉獸","vocabHits":[]}`（简体真转换仍正确）
- `convertText('忧郁')` → `{"text":"憂鬱","vocabHits":[]}`（郁 未被掩码）
- `node scripts/convert-to-traditional.mjs --dry-run <simp-mix.json>`：
  `浓郁的岩壁 → 濃郁的岩壁`（待轉換 1，dry-run 未寫盤）
- `node scripts/convert-to-traditional.mjs --dry-run <protected.json>`：`[無差異]`

### 4. 已知误报文件 dry-run

```bash
node scripts/convert-to-traditional.mjs --dry-run packages/server/data/content/monsters/厚脉岭.json
```

→ `[無差異] ... 待轉換 0 個`，退出码 0（黃岩鼉獸 不再被误转 黃巖鼉獸）。

## 变更文件（仅 3 个脚本文件，未触碰任何数据文件）

1. `scripts/lib/tw-vocabulary.mjs`（+TW_PROTECTED_PHRASES/maskProtected/applyProtectedMask）
2. `scripts/convert-to-traditional.mjs`（convertText 掩码流程）
3. `scripts/check-traditional.mjs`（textNeedsConversion 掩码检查）

## 回归基线确认

修复前：全量守卫报 4 个误报（筑基期/材料.json 434/610/783 濃郁、厚脉岭.json:4 岩）。
修复后：全量守卫 `{"ok":true,"violations":[]}`，同时真实简体（浓郁/憂郁）仍被拦截。
