# 炼丹系统

## 核心常量

源文件: `packages/shared/src/constants/gameplay/craft.ts`, `packages/server/src/runtime/craft/craft-panel-runtime.service.ts`

| 常量 | 值 | 说明 | 源文件 |
|------|-----|------|--------|
| ALCHEMY_FURNACE_OUTPUT_COUNT | 6 | 炼丹单次制作产出倍率 | craft.ts |
| ALCHEMY_MAX_PRESET_COUNT | 24 | 预设最大数量 | craft-panel-runtime.service.ts |
| ALCHEMY_INTERRUPT_PAUSE_TICKS | 10 | 被打断暂停息数 | craft-panel-runtime.service.ts |

## 炼丹成功率公式

源文件: `packages/shared/src/alchemy.ts`, `packages/shared/src/craft-success.ts`

炼丹基础成功率使用五行匹配公式，详见 `docs/mechanics/technique/16a-fivephase-craft-formula.md`。旧的 `powerRatio = submittedPower / recipe.fullPower` 不再作为基础成功率。

### 1. 等级修正（赔率空间）

```typescript
levelModifier = (targetLevel > skillLevel)
  ? (targetLevel - skillLevel) × ln(0.9)      // 减益
  : (targetLevel < skillLevel)
    ? (skillLevel - targetLevel) × ln(1/0.98)  // 增益
    : 0
```

### 2. 最终成功率（赔率空间渐近修正）

```typescript
adjustedRate = applyAsymptoticSuccessModifier(baseRate, levelModifier + toolSuccessModifier)

// 基础成功率为 100% 且总修正为负时，不能因为满值直接免疫低等级惩罚:
//   adjustedRate = e^(levelModifier + toolSuccessModifier)
// 例如炼丹等级 10 炼目标等级 20，若没有工具/幸运抵消，则 100% → 0.9^10 ≈ 34.87%

// 赔率变换:
// modifier > 0 (增益):
//   result = (rate × cap) / (rate + (cap - rate) × e^(-modifier))
// modifier < 0 (减益):
//   result = (rate × e^modifier × cap) / ((cap - rate) + rate × e^modifier)
```

## 炼丹耗时公式

源文件: `packages/shared/src/alchemy.ts`, `packages/shared/src/craft-duration.ts`

```typescript
// 1. 基础炼制时间
brewTicks = 按自定义投料材料总数相对标准配方材料总数修正 baseBrewTicks

// 2. 速度修正
speedRate = (recipeLevel > alchemyLevel) ? -0.1 × (recipeLevel - alchemyLevel)
          : (recipeLevel < alchemyLevel) ? +0.02 × (alchemyLevel - recipeLevel)
          : 0
speedRate += toolSpeedRate  // 工具/设施加速

// 3. 耗时因子
durationFactor = (speedRate >= 0) ? 1/(1+speedRate) : 1+|speedRate|

// 4. 最终单批耗时
adjustedBrewTicks = max(1, ceil(brewTicks × durationFactor))

// 5. 总耗时
totalTicks = adjustedBrewTicks × quantity
```

材料数量修正规则详见 `docs/mechanics/technique/16a-fivephase-craft-formula.md`。

## 灵石消耗

```typescript
alchemySpiritStoneCost = recipeLevel × quantity  // consumesSpiritStone=true时
```

## 单次炼制批量

开始制作时不再用当前材料/灵石反推 `maxQuantity`。`quantity` 只决定 job 总批次数和总耗时；服务端在开始前只校验一次“单批材料 + 单批灵石”是否满足，实际资源在每批完成结算前再次校验并扣除一批。

不设置额外固定批数上限。若后续批次完成结算时材料或灵石不足，该 job 会停止，不产出该批，也不会继续吞掉后续队列项的材料。

## 产出数量

```typescript
batchOutputCount = outputCount × furnaceOutputCount
// 锻造/buff类: furnaceOutputCount = 1
// 普通炼丹: furnaceOutputCount = ALCHEMY_FURNACE_OUTPUT_COUNT (6)
```

## 执行流程

```
startAlchemy:
  1. 校验配方存在 → 校验投料合法性 → 校验数量
  2. 检查是否有活跃任务（有则入队列）
  3. 检查单批材料充足 → 检查单批灵石充足（只校验，不扣除）
  4. 计算 batchBrewTicks/totalTicks/successRate/batchOutputCount
  5. 创建 job (phase='brewing')

tickAlchemy:
  1. phase='paused' → 只推进 interruptWaitRemainingTicks / pausedTicks，不改实际工作进度
  2. phase='brewing' → remainingTicks/workRemainingTicks/currentBatchRemainingTicks -= 1
  3. 单批完成前再次检查并扣除一批材料/灵石
  4. 单批资源不足 → 停止当前 job，不产出该批
  5. 单批资源扣除成功 → 逐件判定成功(Math.random() < successRate)
  6. 产出强制入背包（可合并则直接合并，满包且不可合并也不落地）→ 计算技能经验 → 判断是否全部完成
  7. 全部完成 → 启动队列下一项
```

取消当前炼丹 job 时只清理任务；未完成批次由于尚未扣除资源，不再执行材料或灵石退还。

## 境界增益丹與神行丹

`scripts/generate-realm-pill-content.mjs` 是築基至飛昇的境界丹藥內容真源。每境有六種戰鬥增益丹：破軍、玄元、金剛、玄甲、明瞳、幻影；各自覆蓋物攻/暴擊、法攻/靈力輸出、物防/化解、法防/抗暴、命中/破招、閃避/移速的既有數值面板欄位。它們一律使用 `category: 'buff'` 配方，不含立即生命或靈力回復。

築基至渡劫的六種增益丹按前、中、後段各兩種（大境起始等級、加四級、加八級），飛昇六種均為 127 級。丹方與產物使用相同等級。

每境另有一顆 `useBehavior: 'shenxing_travel'`、配方分類 `special` 的神行丹，由該大境起始等級開放。其冷卻由 shared 的 `SHENXING_PILL_TIERS` 真源裁定，築基 1800 秒，每大境減半並向上取整至一秒息制；內容資料不自行重複冷卻常數。各品階共用冷卻，離線依到期時間繼續推進。

客戶端使用丹藥時只請求目的地；確認後由服務端 tick 重新校驗丹藥、境界、共享冷卻、地圖白名單及可站立落點。白名單僅允許正式系統城鎮與野外，目的地等級不得超過丹藥大境上限。扣除一枚丹藥、傳送座標及冷卻使用同一筆持久化結算；取消選單不扣物，同一請求重送不重複消耗。

結算期間保留來源格與目的格，玩家暫離地圖執行期以免等待資料庫時繼續移動或戰鬥。確定提交失敗時回復來源；提交結果不確定或提交後掛接失敗時清除會話及執行期快取，下次登入由資料庫恢復，不能把舊快照補寫回去。

所有 63 張丹方都只使用對應境界正式地圖的草藥容器或礦脈可採材料。飛昇關新增雲階蘭與摺星晶，經 `resourceNodeGroups` 實際布點，不能以渡劫怪物掉落替代。`scripts/prove-realm-pill-content.mjs` 驗證丹方材料來源、五行值、內容載入與坊市零掛單目錄。

## 面板表现约束

- 炼丹表现为直接进行的制作 job，不再展示准备、开炉、炉火稳定等阶段。
- 实际制作进度只按 `workTotalTicks/workRemainingTicks` 计算。
- 攻击、移动、手动开始修炼等打断只显示独立等待条，不改变实际制作进度。
- 当前 job 和队列项必须能在统一技艺任务列表中直接取消。
