# 移动与寻路系统

## 核心常量

| 常量 | 值 | 源文件 |
|------|-----|--------|
| MOVE_POINT_UNIT | 100 | `packages/shared/src/constants/gameplay/terrain.ts` |
| BASE_MOVE_POINTS_PER_TICK | 100 | 同上 |
| MAX_STORED_MOVE_POINTS | 100 | 同上 |
| MOVE_SPEED_SOFT_CAP | 500 | 同上，妖兽等通用曲线 |
| MOVE_SPEED_SOFT_CAP_LOG_GAIN | 300 | 同上，妖兽等通用曲线 |
| PLAYER_MOVE_SPEED_SOFT_CAP | 1000 | 同上，玩家专用曲线 |
| PLAYER_MOVE_SPEED_SOFT_CAP_LOG_GAIN | 600 | 同上，玩家专用曲线 |

## 移动公式

### 有效移速（软上限衰减）

```ts
getEffectiveMoveSpeed(moveSpeed): // 妖兽等通用曲线
  if raw ≤ SOFT_CAP(500): return raw
  if raw > SOFT_CAP: return 500 + 300 × log₂(raw / 500)

getEffectivePlayerMoveSpeed(moveSpeed):
  if raw ≤ SOFT_CAP(1000): return raw
  if raw > SOFT_CAP: return 1000 + 600 × log₂(raw / 1000)
```

例如玩家原始移速为 `300000` 时，有效移速约为 `5937`；同值妖兽仍按通用曲线得到约 `3269`，不会因玩家高身法调整同步增强追击能力。高端移速仍按对数增长，单次连续移动同时继续受最多 20 步的运行时硬上限约束，避免高身法玩家把逐格占位与 AOI 成本无限放大。

### 每 tick 移动点数

```ts
getMovePointsPerTick(moveSpeed):
  return max(1, round(100 + max(0, moveSpeed)))
```

> 注：调用方通常先调用 `getEffectiveMoveSpeed(rawMoveSpeed)` 做软上限衰减，再将结果传入此函数。

### 最大可存储移动点数

```ts
getMaxStoredMovePoints(moveSpeed, requiredMovePoints):
  return max(100, getMovePointsPerTick(moveSpeed), requiredMovePoints)
```

### 移动消耗判定

每次移动消耗 = 目标地块的 TILE_TRAVERSAL_COST。当累积移动点数 ≥ 地块代价时可移动一格。

## 地形移动代价

### 玩家移動的毫秒補給

玩家正式線路改由 `100ms` 活動子步推進，點數公式及地塊代價維持原值：

```ts
新增移動點數 = getMovePointsPerTick(有效移速) * instance.tickSpeed * 經過毫秒 / 1000
```

點數保留小數餘量，普通平地基礎移速仍為每秒 `200 / 100 = 2` 格，權威位置約每 `500ms` 前進一格；客戶端收到該段時長後逐幀線性插值。慢速地形仍需累積足夠點數，不能把「子步更頻繁」當成「每子步免費走一格」。閒置後只允許有限預存；慢幀只補最近一秒的有界移動預算，不一次追趕長時間斷線移動。

普通 `1x` 實例維持每秒最多 `20` 格的上限；時間密室按實例倍率折算，單次路徑命令仍最多 `20` 格。高速子步遇到路徑終點或自動傳送門就截斷，不因一個子步可走多格而越過目標。

新增移動、轉向、停止仍走伺服器命令／導航真源。客戶端插值只影響顯示，不參與攻擊距離、占位、地形消耗或跨图裁定。此階段未引入客戶端位置預測，戰鬥與怪物 AI 仍維持原邏輯息。

| 地形 | 代价 | 地形 | 代价 |
|------|------|------|------|
| road | 30 | trail | 50 |
| grass | 80 | cloud_floor | 90 |
| veranda | 90 | floor/door/portal/stairs/stone_stairs | 100 |
| hill | 120 | mud | 200 |
| swamp | 300 | cold_bog | 360 |
| wall/window/cliff/water/cloud/void | 400 | tree/bamboo/stone | 400 |
| spirit_ore/black_iron_ore/broken_sword_heap | 400 | house_eave/house_corner/screen_wall | 400 |
| molten_pool | 800 | — | — |

> 代价 400 的地形通常不可行走（被阻挡），仅在特殊情况下可穿越。

## 玩家静态障碍忽略能力

服务端移动裁定以玩家当前移动能力为入口。装备、法宝、Buff、技能等都只是能力来源，最终都应聚合到玩家能力后再被移动系统消费。

玩家拥有“忽略静态障碍”移动能力时，可以覆盖静态地形的不可移动判定，但不改变全局 `isWalkable`。地图边界、动态阻挡、NPC/玩家占位仍是硬规则；妖兽占位对玩家移动为例外（见下节“妖兽穿越”）。

当前内置来源“巡天飞剑”在对应法宝槽已解锁、启用并装备后，为玩家提供忽略静态障碍能力。移动裁定只检查玩家是否拥有该能力，不在移动时读取物品或扣除法宝灵力，也不以当前法宝灵力是否为空作为移动门槛；法宝灵力消耗由玩家 tick 的法宝运行时统一持续扣除。穿越不可移动静态地块时，按基础单步移动消耗 `MOVE_POINT_UNIT = 100` 扣除移动点数。

## 寻路参数

| 常量 | 值 | 源文件 |
|------|-----|--------|
| PATHFINDING_MIN_STEP_COST | 1 | `packages/shared/src/constants/gameplay/navigation.ts` |
| PATHFINDING_PLAYER_MAX_TARGET_DISTANCE | 96（曼哈顿距离） | 同上 |
| PATHFINDING_PLAYER_MAX_EXPANDED_NODES | 16384 | 同上 |
| PATHFINDING_PLAYER_MAX_PATH_LENGTH | 16384 | 同上 |
| PATHFINDING_REPATH_MAX_EXPANDED_NODES | 16384 | 同上 |
| PATHFINDING_REPATH_MAX_PATH_LENGTH | 16384 | 同上 |
| PATHFINDING_BOT_MAX_EXPANDED_NODES | 512 | 同上 |
| PATHFINDING_BOT_MAX_PATH_LENGTH | 24 | 同上 |
| PATHFINDING_APPROACH_MAX_EXPANDED_NODES | 1024 | 同上 |
| PATHFINDING_APPROACH_MAX_PATH_LENGTH | 32 | 同上 |

## A* 寻路

- 使用 A* 算法，启发函数为曼哈顿距离
- 代价函数 = TILE_TRAVERSAL_COST（地形代价）
- 最小步进代价 = 1（用于启发函数归一化）
- 路径重算：当路径被阻挡时触发 repath，参数与首次寻路相同
- 同一调度帧的多玩家寻路按地图实例聚合为有界批任务后提交到 Encoding Worker Pool；每批只共享一份只读静态网格，动态阻挡按玩家传稀疏 cell index，并限制寻路批次的 Worker 并发数，为 AOI/FOV 编码保留容量。
- 静态网格优先放入 `SharedArrayBuffer`，同实例多批和多个 Worker 共享只读字节，不按玩家结构化克隆整张地图；回收后仍按稳定玩家顺序物化命令。
- 单次调度只物化固定上限的导航意图，超出部分保留到后续帧并按全局/实例作用域轮转，不能因玩家分散在大量实例而形成无界 Worker 队列，也不能长期只服务 Map 前部玩家。
- Worker 静态网格缓存以 `instanceId` 隔离，并使用只在可行走性/移动代价变化时推进的 static pathing revision 失效；同模板不同实例不共用网格。
- 玩家、妖兽、NPC 与阵法边界等动态阻挡进入每次任务独立的 `blocked` 掩码，不得固化进共享静态网格；宗门成员等通行权限按玩家计算。玩家导航链路的掩码构建固定携带 `ignoreMonsters: true`（见下节），妖兽坐标不进入玩家 A* 掩码。

## 妖兽穿越（2026-08 起）

玩家移动可穿越存活妖兽占位，规则边界：

- **规划层**：玩家寻路掩码构建跳过妖兽格（NPC、其他玩家、阵法边界照旧阻挡），A* 可规划穿过妖兽的路径。
- **執行層**：玩家子步先驗證包含妖獸格的完整路段，直到下一個合法停靠格；累積足夠點數後一次提交該段的占位變更。
- **停靠不變式**：每個子步結束時都不得停在妖獸格。點數不足時在原合法格等待，不先踏入妖獸格、扣點再回退；路段被阻擋時也不部分提交無法停靠的路段。
- **终点规则**：目的格被妖兽占用时不允许重叠——玩家停在妖兽相邻格，寻路到达判定由逐步执行校验保证。
- 客户端路径预览本就不含动态阻挡掩码，此改动后两端裁定一致。
- 妖兽自身 AI 寻路仍视其他妖兽与玩家为阻挡，互不影响。

## 占位规则

- 使用 `Uint32Array` occupancy 按 cellIndex 存储占位 handle
- `INVALID_OCCUPANCY = 0` 表示空闲
- 移动前检查：`occupancy[nextTileIndex] !== INVALID_OCCUPANCY` → 阻止移动
- 玩家不可重叠，服务端保证占位检测；玩家与存活妖兽不可在停靠时重叠（穿越为瞬时态）
- 建筑放置也检查占位冲突

## 相关源文件

- `packages/shared/src/constants/gameplay/terrain.ts` — 地形常量
- `packages/shared/src/constants/gameplay/navigation.ts` — 寻路常量
- `packages/shared/src/terrain.ts` — 移动公式
- `packages/server/src/runtime/instance/map-instance.runtime.ts` — 占位管理
