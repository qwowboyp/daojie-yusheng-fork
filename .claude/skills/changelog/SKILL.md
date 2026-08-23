---
name: changelog
description: 道劫余生的双轨更新日志写入规范（游戏内「岁月史书」面板 + docs/CHANGELOG.md）。当用户要求"写更新日志""更新 changelog""记录本次改动到游戏内日志""岁月史书加条目"或完成一批玩家可见的功能/修复后需要记录时使用。
---

# 道劫余生更新日志（双轨写入）

一次改动写**两个文件**，语言和格式不同，缺一不可：

| 文件 | 受众 | 语言 |
|---|---|---|
| `packages/client/src/constants/ui/changelog.ts` | 游戏内「岁月史书」面板（玩家可见） | **台湾繁体** |
| `docs/CHANGELOG.md` | 仓库文档中心 | **简体中文** |

## changelog.ts（游戏内）

数组最新在顶部。条目类型 `ChangelogEntry`（`updatedAt` / `summary` / `items`，类型从 `../../ui/changelog-data` import）：

```ts
{
  updatedAt: '2026-08-24',
  summary: '一句话摘要，句号结尾，不换行。',
  items: [
    '分类：功能描述 — 细节补充。',   // 分类前缀：新玩法/战斗/头像/界面/地图/音乐/稳定性等
    '分类：另一条改动。',
  ],
},
```

规则：
- 顶部条目与本次同一天 → 新建条目插到最前（历史出现过同日多条并存，不合并旧条目）
- `summary` 概括本次全部内容；`items` 每条一个改动，带分类前缀
- 重点功能条目用 `名称 — 描述` 破折号展开写细节

## docs/CHANGELOG.md

结构：`## YYYY年M月`（月标题）→ `### 分类`（小节）→ `- 条目`，月与月之间 `---` 分隔：

- 当月已存在 → 在该月内追加小节/条目；跨月 → 在文件顶部 `---` 后新建月标题
- 大功能用粗体：`- **全服头像上线** — 描述`
- 小节命名参考：新玩法 / 玩家头像 / 战斗 / 离线挂机 / 装备与强化 / 地图 / 修炼 / 界面改进 / 音乐与音效 / 稳定性

## 写作规则（两轨通用）

1. **玩家视角**：写玩法与体验变化；禁止 commit hash、文件名、表名、docker/env 配置等技术细节
2. 开发期间引入又修掉的 Bug 不写
3. 数字写明单位与范围（如"2MB 内图片""约一分钟内更新"）

## 验证（写完必跑）

```bash
node scripts/check-traditional.mjs --scope client   # 简转繁守门，必须 ok:true
pnpm --filter @mud/client exec tsc --noEmit          # changelog.ts 是代码，必须过编译
```

## 提交与部署

- 提交：`docs(changelog): <摘要>`，两个文件一起；changelog.ts 属代码改动，可单独提交（不违反"纯文档不单独提交"规则）
- 部署：玩家要看到新日志必须重建部署 client；可与后续代码改动合并部署
