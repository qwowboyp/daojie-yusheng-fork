# packages/server/src/runtime — 权威玩法运行时

**本目录：271 文件 / 132,267 行，22 个子域**。服务端权威玩法运行时核心。行为红线见仓库根 AGENTS.md 与 packages/server/AGENTS.md，本文件只补充本目录特有内容。

## WHERE TO LOOK

| 任务 | 位置 |
|---|---|
| 世界 facade | `world/world-runtime.service.ts`（61 refs） |
| 玩家状态 | `player/player-runtime.service.ts`（201 refs，全服最高中心性，12744 行） |
| 地图实例 | `instance/map-instance.runtime.ts`（106 refs，10629 行） |
| 地图模板 | `map/map-template.repository.ts`（100 refs） |
| 战斗执行 | `world/combat/`（21 档：attack-target、skill-dispatch、threat） |
| 命令队列 | `world/command/`（intake / enqueue / router） |
| 读 facade | `world/query/`（10 档：player-view、detail、npc-shop） |
| 后台 worker | `world/worker/`（19 档：flush、retention、checkpoint） |
| 技艺 job | `craft/pipeline/`（strategy 生命周期） |
| 宗门 | `world/world-runtime-sect.service.ts`（14 refs） |
| 通天塔 | `world/world-runtime-tongtian-tower.service.ts` |
| 全局 tick | `tick/world-tick.service.ts` |

## STRUCTURE（子域 | 文件 | 行数）

| 子域 | 文件 | 行数 | 职责 |
|---|---|---|---|
| world/ | 118 | 55,654 | 主战场；内嵌 combat/command/query/worker 四象限 |
| player/ | 25 | 20,486 | 玩家状态真源 |
| instance/ | 9 | 11,926 | 地图实例化/租约/调度（第二大子域） |
| craft/ | 27 | 11,570 | 技艺 job pipeline（含 pipeline/strategies） |
| technique-generation/ | 13 | 5,103 | 功法 AI 生成流水线 |
| market/ | 3 | 4,393 | 市场经济 |
| building/ | 11 | 4,373 | 建筑/阵法/风水/资源点 |
| gm/ | 5 | 3,228 | 运行时 GM 状态 |
| combat/ | 11 | 2,946 | 战斗公式域 |
| map/ | 10 | 2,255 | 地图描述符/瓦片/伤害批处理 |
| party/ | 19 | 2,005 | 队伍 |
| event-bus/ | 4 | 1,277 | 内部事件总线 |
| access/ | 4 | 1,119 | 访问策略评估 |
| redeem/ | 1 | 1,073 | 兑换码 |
| mail/ | 2 | 1,024 | 邮件 |
| social/ | 1 | 907 | 社交 |
| activity/ | 1 | 811 | 活动/签到 |
| chat/ | 1 | 740 | 聊天频道 |
| actor/ | 3 | 475 | Actor 系统 |
| tick/ | 1 | 418 | 全局 tick 编排 |
| worker/ | 1 | 362 | 运行时 worker 抽象 |
| random/ | 1 | 122 | RNG 抽象 |

## world/ 巨档警示（Top-5）

- `world-runtime-formation.service.ts` 3564 行（阵法）
- `world-runtime-sect.service.ts` 3270 行（宗门）
- `world-runtime-combat-action.service.ts` 2998 行（战斗动作）
- `world-runtime-player-skill-dispatch.service.ts` 2986 行（技能调度）
- `world-runtime-loot-container.service.ts` 2551 行（战利品容器）

## ANTI-PATTERNS

- tick 热路径禁止 DB IO、`JSON.stringify`、临时字符串键、每 tick 全表扫描
- 目标解析禁止退化到 `listPlayerSnapshots`（全服 5000 玩家深克隆，N17 规则；证据 `world/combat/world-runtime.attack-target.helpers.ts:136`）
- `getRef*` 调试枚举入口禁止进 tick 热路径（shared `template-registry-types.ts:21`）
- 不可绕过通用技艺 job 骨架另写任务生命周期
- 远处 worldRevision 变化不得重建局部投影（AOI 缓存局部性，world-runtime-aoi-cache-locality-smoke 验证）
