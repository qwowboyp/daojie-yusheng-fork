# packages/client — 游戏客户端

**本目录：708 文件（src/ 437）**。Vite + TypeScript + Canvas 2D + DOM UI + React 19 渐进式 UI；地图渲染用 PixiJS。行为红线见仓库根 AGENTS.md，本文件只补充本包特有内容。

## OVERVIEW

纯显示/输入/表现层，服务端唯一权威。入口：`index.html` → `src/main.ts`（注入 49 个 CSS）→ `main-app-composition.ts` → `main-frontend-modules.ts`（实例化 30+ panel）。HTML 多入口：`gm.html`、`heaven-gate.html`、`react-ui-prototype.html`。

## STRUCTURE（src/）

| 目录 | 文件 | 职责 |
|---|---|---|
| ui/ | 115 | 旧版 DOM UI（根 80 扁平 + panels/ 33 + panel-system/ 6） |
| react-ui/ | 96 | React 19 新 UI（panels/primitives/stores/hooks/overlays/bridge） |
| main-*.ts | 68+ | 主链装配 / state source 拆分文件 |
| constants/ | 40 | 客户端常量 + generated JSON（editor/item-sources/building-catalog） |
| styles/ | 38 | CSS（tokens/base + panels/ 25） |
| game-map/ | 21 | PixiJS 地图渲染域（renderer/camera/viewport/minimap/scene） |
| network/ | 16 | Socket.IO 收发（socket.ts 为主） |
| renderer/ | 10 | 共享 Canvas/Pixi 图集 / 字体缓存 |
| gm/ | 5 | GM 工具（gm*.ts 大文件在 src/ 根层） |
| input/ debug/ utils/ runtime/ content/ | | 小支撑层 |

## WHERE TO LOOK

| 任务 | 位置 |
|---|---|
| 入口 / 装配 | `src/main.ts`、`main-app-composition.ts`、`main-frontend-modules.ts` |
| Socket 收发 | `network/socket.ts`（26 refs，六路 sender） |
| 旧版面板 | `ui/panels/*.ts`（33 个） |
| React 面板 | `react-ui/panels/<name>/`（XxxPanel.tsx + mount-xxx-panel.tsx 成对） |
| 地图渲染 | `game-map/renderer/pixi-*.ts`（11 个） |
| 地图运行时 | `game-map/runtime/map-runtime.ts` |
| 样式 token | `styles/tokens.css` |
| GM 工具 | `src/gm.ts`（609KB）、`gm-map-editor.ts`、`gm-world-viewer.ts` |
| 协议事件注册 | `network/socket-event-registry.ts`、`socket-server-events.ts` |

## CONVENTIONS

- **双轨 UI 并存**：`ui/`（旧 DOM）与 `react-ui/`（React 19）渐进式替代；新面板优先 react-ui，挂载由 `react-ui/bridge/panel-flags.ts` 控制
- React 面板成对文件：`XxxPanel.tsx` + `mount-xxx-panel.tsx`
- **构建**：`build` = `tsc --noEmit` + `vite build` + 30+ `proof:*` 守门
- prebuild 依序：shared → editor-catalog → item-sources → building-catalog → i18n
- manualChunks 拆包：vendor / shared / main-panels / world-{editor-catalog,item-sources,monster-locations}
- 验证：`pnpm verify:client`（gm-login-autofill → build:client → technique-preview → statistic-history）
- outbound 权限：`network/socket-send-access-policy.ts` 控制

## ANTI-PATTERNS

- 禁止整页/整面板全量刷新；一律局部 patch（高频 HP/Qi 走 keyed patch）
- 不打断焦点、滚动、选区、展开态、当前输入
- 每帧避免全量解析协议、重复全图查询、大量短命对象
- `i18n.generated.ts` 为生成文件，不手改
- 表现插值/预测不污染服务端权威坐标或结算结果
