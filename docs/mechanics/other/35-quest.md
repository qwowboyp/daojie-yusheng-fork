# 任务系统

## 共享常量

源文件: `packages/shared/src/constants/gameplay/quest.ts`

```typescript
QUEST_LINE_KEYS = ['main', 'side', 'daily', 'encounter']
QUEST_STATUS_KEYS = ['available', 'active', 'ready', 'completed']
QUEST_OBJECTIVE_TYPE_KEYS = ['kill', 'talk', 'submit_item', 'learn_technique', 'realm_progress', 'realm_stage']
QUEST_CROSS_MAP_NAV_COOLDOWN_TICKS = 1
```

## 任务状态机

```
available → active → ready → completed
                ↑         |
                └─────────┘ (条件不满足时回退)
```

### 状态转换规则

- `available → active`: 玩家接取任务
- `active → ready`: `progress >= required` 且提交物品满足
- `ready → active`: 条件不再满足时回退（如物品被消耗）
- `ready → completed`: 玩家向 NPC 提交

## 进度计算（resolveQuestProgress）

源文件: `packages/server/src/runtime/world/world-runtime-quest-state.service.ts`

| objectiveType | 进度计算方式 |
|---------------|-------------|
| kill | 击杀目标怪物时 +1，上限 = required |
| talk | 与目标 NPC 对话时直接设为 required |
| submit_item | `min(required, 背包中目标物品数量)` |
| learn_technique | 已学会目标功法 → required，否则 0 |
| realm_stage | 境界等级 `realmLv` ≥ `targetRealmLv` → required |
| realm_progress | 境界等级 `realmLv` > `targetRealmLv`（严格大于）→ required |

怪物 `kill` 事件默认只由现有实际贡献参与者推进。队伍采用平均经验模式时，同实例、存活、距怪物不超过 20 格且有伤害或有效治疗/增益支援记录的合格成员也进入同一权威击杀进度入口；队伍贡献模式、跨图、死亡或无参与成员不额外共享任务进度。

## 完成条件

```typescript
canQuestBecomeReady = progress >= required
  && (!requiredItemId || inventoryCount(requiredItemId) >= requiredItemCount)
```

## 任务链

- 每个任务可有 `nextQuestId`，完成后自动接取下一个
- NPC 任务列表按顺序解锁: 前一个未完成则后续不可见

## 可接任务同步（任务分页「可接任務」區塊）

- 服務端權威判定 `collectAvailableQuestsForPlayer(playerId)`（`world-runtime-quest-query.service.ts`）：遍歷 `npcRegistry.listIds()`，對每個 NPC 重用 `resolveAvailableNpcQuestMarkerForPlayer`（鏈序解鎖、前置、境界、主線單一遮蔽、giverNpcId 綁定），每個 NPC 同時最多揭曉一個可接任務——與玩家走到該 NPC 旁看到的內容完全一致。
- 推送走獨立 S2C 事件 `n:s:availableQuests`（`S2C.AvailableQuests`，payload `AvailableQuestsView { quests: QuestRuntimeStateView[] }`，全量替換語義）。payload 僅含 `{id, status:'available'}` 最小欄位，顯示欄位（title/giver/location 等）由客戶端 `resolvePreviewQuests` 從本地任務模板補全。
- 觸發時機為低頻簽名門檻（`world-sync-quest-loot.service.ts`）：`{templateVersion, questRevision, realmLv, questCount}` 任一變化才重算重推；掛點在初始同步（`emitInitialSync`）與每次 delta 後同步（`emitDeltaPostSync`），計量桶 `availableQuestSyncMs/availableQuestSyncCount` 與 questSync 分離。玩家離線清快取（`clearPlayerCache`）。
- 接取仍須走近 NPC 走既有 `C2S.AcceptNpcQuest` 流程（`resolveAdjacentNpc` 鄰近檢查不變）；任務分頁只提供「前往接取」導航。
- 導航：未接取任務走 `resolveNavigationDestination` 的模板 fallback——玩家任務表中找不到且 `getQuestSource` 存在時，以 `{id, status:'available'}` 佔位，`resolveQuestNavigationTarget` 的 available 分支解析 giver NPC 位置（`adjacent: true`）。
- 客戶端 React（`QuestPanel.tsx`）與 legacy DOM（`quest-panel.ts`）雙軌行為一致：每條任務線下「可接任務」折疊區塊（預設展開、樣式沿用已完成折疊頭）、卡片可開詳情彈層、「前往接取」按鈕觸發既有導航 intent。

## 奖励发放

```
1. 在玩家资产串行区内预演扣除提交物品
2. 把普通奖励与灵石奖励统一合入下一版背包快照
3. durable 路径把背包真源、钱包投影与任务状态放入同一事务提交
4. 提交成功后用背包快照刷新运行态，钱包展示由背包中的灵石派生
```

- `spirit_stone` 是背包货币真源：已有同签名灵石堆时直接合并；没有灵石堆时会占用一个背包格，背包不足则任务不能提交。
- 任务提交物品本身若为灵石，钱包投影同样按扣除后的背包数量更新，不能只对奖励做增量累加。
- 普通奖励、灵石、提交物品和任务完成态必须同成同败；数据库提交失败时不提前修改运行态。
