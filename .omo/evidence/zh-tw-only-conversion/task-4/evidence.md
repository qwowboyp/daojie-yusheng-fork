# Task-4 Evidence — 補齊 6 個 i18n 通知 key

日期：2026-08-20

## 目標
server 已引用但 client CSV 缺漏的 6 個 `notice.*` key，補進 `packages/client/src/content/i18n/zh-TW.csv`，避免 client fallback 顯示原始 key 名。

## 新增 6 行（category 通知）

| key | zh-TW | CSV 行號 |
|---|---|---|
| notice.item.open-panel | 已開啟功法領悟面板 | 2633 |
| notice.combat.low-priority | 低優先度 | 2473 |
| notice.technique.activity-complete | 技藝活動已完成 | 2720 |
| notice.test | 測試通知 | 2718 |
| notice.inventory.destroyed | 物品已銷毀 | 2634 |
| notice.inventory.sorted | 背包已整理 | 2635 |

## 驗證

### 1. 無重複 key（rg 各恰 1 hit）
```
2473:notice.combat.low-priority,通知,低優先度,
2633:notice.item.open-panel,通知,已開啟功法領悟面板,
2634:notice.inventory.destroyed,通知,物品已銷毀,
2635:notice.inventory.sorted,通知,背包已整理,
2718:notice.test,通知,測試通知,
2720:notice.technique.activity-complete,通知,技藝活動已完成,
```

### 2. generate:i18n 成功，key 數 3966（原 3960）
```
已生成 packages\client\src\constants\ui\i18n.generated.ts（3966 条 × zh-TW）
```

### 3. 6 key 出現在 i18n.generated.ts
```
1965:  "notice.combat.low-priority": "低優先度",
2111:  "notice.inventory.destroyed": "物品已銷毀",
2112:  "notice.inventory.sorted": "背包已整理",
2116:  "notice.item.open-panel": "已開啟功法領悟面板",
2211:  "notice.technique.activity-complete": "技藝活動已完成",
2212:  "notice.test": "測試通知",
```

### 4. guard 通過
```
{
  "ok": true,
  "violations": []
}
```

## 插入位置
- `notice.item.open-panel`：notice.item.* 區塊（item.used 之後）
- `notice.inventory.destroyed` / `notice.inventory.sorted`：item 與 loot 區塊之間
- `notice.combat.low-priority`：notice.combat.* 區塊（killed-batch 之後）
- `notice.test`：notice.system.cooldown 之後
- `notice.technique.activity-complete`：notice.technique-aggregation.overlap 之後

## 未提交
依指示不 commit。
