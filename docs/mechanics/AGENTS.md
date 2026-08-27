# docs/mechanics — 游戏机制文档库

**本目录：46 个机制文档 + README.md，8 大子类**。这是「涉及游戏系统必先读」的强制入口（仓库根 AGENTS.md 规定：改代码前必读对应机制文档）。

## STRUCTURE

| 子类 | 档数 | 内容 | 编号 |
|---|---|---|---|
| core-loop/ | 4 | tick 调度、AOI 同步、移动寻路、地图地形 | — |
| combat/ | 6 | 战斗数值/流程/伤害/仇恨/怪物 AI/刷新掉落 | 00, 05–09（从 00 起跳有跳号） |
| growth/ | 6 | 属性/境界/灵气/功法技能/buff/离线收益 | 10–15 连续 |
| technique/ | 9 | 炼丹/锻造/强化/建筑制作/技艺经验 | 16, 16a, 17, 17a, 18, 21, 22 + 2 无编号参考档 |
| building-env/ | 3 | 建筑/风水/灵气场 | 23–25 |
| equipment-items/ | 4 | 装备/背包/阵法/存储 | 26–28 + 1 无编号迁移档 |
| economy/ | 6 | 市场/邮件/宗门/排行榜/道友社交/组队 | 29–34 |
| other/ | 8 | 通天塔/NPC 商店/任务/兑换码/自动化/GM/Actor/访问策略 | 33–40 |

## 编号规范

- 全域流水号跨子类连续配置；字母后缀（16a / 17a）表子版本
- **已知冲突**：economy/33、economy/34 与 other/33、other/34 编号重复；新增文档避免沿用冲突编号，建议从 41 起跳
- 无编号档案属设计参考类（craft-effect-stats-design.md、craft-fivephase-reference.md、storage-architecture-migration.md）

## CONVENTIONS

- 新增游戏系统机制文档：放入对应子类、沿流水号、文件名格式 `NN-主题.md`
- 涉及战斗/成长/技艺等系统改动时，改代码前必读对应文档
- 文档与实现漂移时，以实现为准并回填文档
