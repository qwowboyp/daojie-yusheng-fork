# packages/client — 游戏客户端

**本目录：714 文件（src/ 440）**。Vite + TypeScript + Canvas 2D + DOM UI + React 19 渐进式 UI；地图渲染用 PixiJS。行为红线见仓库根 AGENTS.md，本文件只补充本包特有内容。子目录深导航：`src/react-ui/AGENTS.md`（18 域 React 面板）、`src/game-map/AGENTS.md`（PixiJS 渲染域）。

## OVERVIEW

纯显示/输入/表现层，服务端唯一权威。入口：`index.html` → `src/main.ts`（注入 49 个 CSS）→ `main-app-composition.ts` → `main-frontend-modules.ts`（实例化 30+ panel）。HTML 多入口：`gm.html`、`heaven-gate.html`、`react-ui-prototype.html`。

## STRUCTURE（src/）

| 目录 | 文件 | 职责 |
|---|---|---|
| ui/ | 117 | 旧版 DOM UI（根 80 扁平 + panels/ 33 + panel-system/ 6） |
| react-ui/ | 96 | React 19 新 UI（panels 18 域 + bridge/primitives/stores/hooks/overlays/shell；详见 src/react-ui/AGENTS.md） |
| main-*.ts | 68+ | 主链装配 / state source 拆分文件 |
| constants/ | 40 | 客户端常量 + generated JSON（editor/item-sources/building-catalog） |
| styles/ | 38 | CSS（tokens/base + panels/ 25） |
| game-map/ | 21 | PixiJS 地图渲染域（10 子目录：renderer/camera/viewport/scene/minimap/interaction/projection/runtime/store；详见 src/game-map/AGENTS.md） |
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

- **双轨 UI 并存**：`ui/`（旧 DOM 33 面板）与 `react-ui/`（React 19，18 域全覆盖）渐进式替代；新面板一律 react-ui，挂载由 `react-ui/bridge/panel-flags.ts` 控制
- React 面板成对文件：`XxxPanel.tsx` + `mount-xxx-panel.tsx`
- ui/ 根层 80 文件含 BGM 播放器（bgm-player.ts）、新手引导（guided-tour）、更新日志（changelog-*）、离线收益等 HUD/工作区模块
- **gm.html 顶层 DOM**：`#status-bar` / `#status-toast` 必须放在 `</main>` 前、所有 workspace section 之外，不能嵌套在任何 `<section class="layout-section hidden">` 内（否则被 `.hidden` 切換時 `display:none` 會傳染到子孫，rect 變 0×0 看不見，CSS 屬性正確也救不回來）
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
