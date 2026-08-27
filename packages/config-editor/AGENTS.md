# packages/config-editor — 内容配置编辑器

**本目录：57 文件（src/ 45）**。React 19 + Vite + Tailwind v4 + Radix UI。行为红线见仓库根 AGENTS.md，本文件只补充本包特有内容。

## OVERVIEW

内容生产工具，与游戏客户端共用 `@mud/shared`。入口：`index.html` → `src/main.tsx` → `app/App.tsx`（HashRouter + lazy 5 页）。本地 `local-api.cjs` 桥接内容 JSON 读写与可选托管游戏服。

## STRUCTURE

| 位置 | 文件 | 职责 |
|---|---|---|
| src/app/ | 9 | App.tsx + router(HashRouter) / shell / theme / header |
| src/pages/ | 5 | maps / monsters / techniques / files / service 五大编辑域 |
| src/ui/ | 21 | Radix 封装（Button / Dialog / Tabs / Toast / Select...） |
| src/lib/ | 5 | api.ts / cn.ts / format.ts / request-generation.ts |
| src/types/ | 1 | 本地 API DTO |
| src/styles/ | 3 | tokens.css / index.css / gm-editor-compat.css |
| lib/ | 1 | atomic-json-file.cjs（原子写入） |
| scripts/ | 3 | request-generation-smoke / built-css-assets / content-contract |

## WHERE TO LOOK

| 任务 | 位置 |
|---|---|
| 编辑页 | `src/pages/<maps|monsters|techniques|files|service>/` |
| 请求生成 | `src/lib/request-generation.ts`、`use-request-generation.ts` |
| 本地 API | `src/lib/api.ts`（本地 DTO + `@mud/shared`） |
| 桥接服务 | `local-api.cjs`（读写内容 JSON、require shared/dist） |
| 原子写入 | `lib/atomic-json-file.cjs` |

## CONVENTIONS

- prebuild 先 `pnpm --dir ../shared build`
- vite alias：`@mud/shared` → shared/src；publicDir 指向 client/public
- 主题：`src/app/theme/ThemeProvider.tsx`（useTheme），明暗两套
- 验证：build = tsc + vite build + request-generation-smoke + built-css-assets + content-contract

## ANTI-PATTERNS

- 地图 ID 不允许在编辑器内直接修改（local-api.cjs 强制）
- 保存类请求不得复用「取消旧请求」语义（lib/request-generation.ts）
- 部分平台不允许目录句柄：rename 原子完成后不得误报失败
- 不在运行时解析编辑器临时格式；契约由 shared schema 统一（根 AGENTS.md §10）
