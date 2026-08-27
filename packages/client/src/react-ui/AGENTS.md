# packages/client/src/react-ui — React 19 新 UI

**本目录：96 文件**。React 19 渐进式新 UI；与 `ui/`（旧 DOM 33 面板）双轨并存，**新面板一律写这里**。行为红线见 packages/client/AGENTS.md 与仓库根 AGENTS.md。

## STRUCTURE

| 位置 | 职责 |
|---|---|
| panels/ | 18 域面板（action / attr / body-training / changelog / chat / craft / equipment / gm / inventory / loot / mail / market / quest / settings / technique / technique-generation / tutorial / world） |
| bridge/ | 挂载闸门：panel-flags.ts 控制新旧面板切换、react-ui-bridge.ts、feature-flag.ts |
| primitives/ | 基础组件 |
| stores/ hooks/ | 状态与副作用 |
| overlays/ | DetailModalLayer / ToastLayer / TooltipLayer / overlay-store |
| shell/ | HudStatus / MapMinimapShell / SidePanelControls |
| styles/ | foundation.css 独立样式基础 |
| prototype/ + prototype-main.tsx | 独立原型 app（react-ui-prototype.html 入口，仅 dev；start-react-ui-prototype.sh 启动） |

## CONVENTIONS

- 面板成对文件：`XxxPanel.tsx` + `mount-xxx-panel.tsx`（18 域全部遵循）
- 挂载由 `bridge/panel-flags.ts` 控制（渐进式迁移闸门）
- 迁移现状：React 已覆盖全部 18 个业务面板域；equipment / inventory / market / craft / technique 5 域的 legacy 多文件实现仍在 `ui/`；体积迁移约 30%

## WHERE TO LOOK

| 任务 | 位置 |
|---|---|
| 新面板 | `panels/<name>/` |
| 面板切换 | `bridge/panel-flags.ts` |
| 浮层 | `overlays/` |
| HUD 壳 | `shell/` |

## ANTI-PATTERNS

- 禁止整面板全量刷新；React 面板用 keyed patch（高频 HP/Qi 走 keyed patch）
- 高频更新不得打断焦点、滚动、选区、展开态（继承 client 红线）
- 新增面板必须走 panel-flags 闸门挂载，不得绕过 bridge 直接 mount
