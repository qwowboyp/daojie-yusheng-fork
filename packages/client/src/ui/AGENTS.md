# packages/client/src/ui — 舊版 DOM UI

**本目錄：127 檔案（根 88 + panels/ 33 + panel-system/ 6）**。舊版 DOM 面板與 HUD；新面板一律寫 react-ui（見 `packages/client/src/react-ui/AGENTS.md`），本目錄只維護既有面板。行為紅線見 packages/client/AGENTS.md 與倉庫根 AGENTS.md。

## STRUCTURE

| 位置 | 職責 |
|---|---|
| 根 · HUD/常駐 | hud.ts（狀態條，優先委派 React HUD）、party-hud.ts、minimap.ts、chat.ts、bgm-player.ts / sfx-player.ts |
| 根 · 佈局宿主 | side-panel.ts（1,277 行，workspace 與多組 tab 單例）、desktop-window.ts、floating-list-panel.ts、workspace-modal-panel.ts、social-/party-workspace-panel.ts、detail-modal-host.ts、confirm-modal-host.ts |
| 根 · craft 7 檔 | craft-workbench-modal.ts + alchemy / enhancement / transmission / queue views + catalog-cache / realm-tabs（craft 域無 panels/ 檔，全在此） |
| 根 · 離線/引導 | offline-gain-{modal,render,confirmation-state,refresh-state}.ts、guided-tour.ts + guided-tour-events.ts、changelog-{panel,data}.ts、tutorial-panel.ts |
| 根 · 共用基元 | ui-primitives.ts、ui-modal-frame.ts、selection-preserver.ts、responsive-viewport.ts、item-display.ts、i18n.ts |
| 根 · 其他 | npc-shop/quest-modal、time-chamber-*、heaven-gate-modal、access-policy-* 4 檔、login / auth-api、technique-* 3 檔、equipment-* 3 檔 |
| panels/ 33 | 面板主檔（action / attr / body-training / equipment / gm / inventory / loot / market / party / quest / settings / social / technique / world 14 主檔）+ 子模組：action- 5、inventory- 5、market- 5、technique-constellation-canvas、party/sect/world 各 1 |
| panel-system/ 6 | bootstrap.ts（createClientPanelSystem）、registry.ts（19 PanelId 註冊表）、store.ts、types.ts、capability.ts、layout-profiles.ts |

## WHERE TO LOOK

| 任務 | 位置 |
|---|---|
| HUD 狀態 / HP/Qi | `ui/hud.ts`（lastSignatures 簽名短路） |
| workspace 切換、tab 持久化 | `ui/side-panel.ts`（`[data-tab-group]`、activeTabs 記憶） |
| 面板系統啟動與註冊 | `ui/panel-system/bootstrap.ts`（registry 19 id、capabilities/layout/store） |
| 隊伍 HUD 局部更新 | `ui/party-hud.ts` |
| innerHTML 重寫保持選區/捲動 | `ui/selection-preserver.ts`（preserveSelection） |
| 彈層宿主 / modal 骨架 | `ui/detail-modal-host.ts`、`ui/ui-modal-frame.ts` |
| 新手引導 / 更新日誌 / 離線收益 | `ui/guided-tour.ts`、`ui/changelog-panel.ts`、`ui/offline-gain-modal.ts` |
| BGM 與地圖切換配樂 | `ui/bgm-player.ts` |
| 斷點、手機 UI、座標縮放 | `ui/responsive-viewport.ts`、`ui/mobile-surface.ts` |
| craft 工坊 / 市集面板 | `ui/craft-workbench-modal.ts`、`ui/panels/market-panel.ts`（185KB 最大檔） |

## CONVENTIONS

- **panel-system 啟動序**：`main-frontend-modules.ts:82` → `createClientPanelSystem`（bootstrap.ts:37）建 capabilities → layout profile → registry（19 個 PanelId，types.ts:7-26）→ store → capabilityMonitor.start()。registry 定義 templateKind（embedded/modal/hud/floating）、rootSelector、defaultPlacement、preservesInteractionState
- **keyed patch 實作**：hud.ts:136 `lastSignatures` 記錄最後寫入值，text/width 相同即短路（hud.ts:326-344）；party-hud.ts:111-124 用 `dataset.partyHudSignature` 比對成員。同款 signature 模式共 9 檔（minimap / responsive-viewport / craft-transmission-view / technique-panel / equipment-panel 等）
- **狀態流不直連網路**：socket → `main-*-state-source.ts` → 呼叫面板方法（main-inventory-state-source.ts:133 `setCallbacks`、main-ui-state-source.ts:334 `hud.update`）
- **workspace/section 切換**：SidePanel 單例管 workspace 定義表與焦點還原（side-panel.ts:445-451）、tab 別名映射（348-352）、activeTabs 持久化（593-596）；聊天摺疊只切 dataset/hidden（413-420）
- **選區/捲動保持**：innerHTML 重寫一律包 `preserveSelection`（selection-preserver.ts:147），同 root 記錄 scrollTop/scrollLeft
- **ui/ 內的 React 閘門**：兩處 `isReactPanelEnabled`：side-panel.ts:464（workspace-navigation）、item-source-links.ts:7（item-sources）；hud.ts:145 `mountReactHudStatus` 成功則委派 React，169-172 回退 DOM 寫入
- **5 域 legacy 多檔仍在本目錄**（react-ui 已覆蓋，此處只維護）：equipment = equipment-panel-layout / -shortcuts / -tooltip + panels/equipment-panel；inventory = panels/inventory-panel + 5 個 dialog/state 檔；market = panels/market-panel + auction/browse/transmission-view、trade-dialog、panel-types；craft = 根層 7 檔；technique = panels/technique-panel + constellation-canvas + 根層 3 檔

## ANTI-PATTERNS

- 禁止 signature 短路外直接覆寫 textContent / style.width（hud.ts:338-344 的 setText 為正例；繞過會重觸發朗讀與 CSS 過渡）
- 禁止繞過 panel-flags 啟用 workspace DOM（side-panel.ts:464 是唯一閘門）
- innerHTML / replaceChildren 重寫不包 preserveSelection 即丟失選區與捲動（selection-preserver.ts:147-153）
- 禁止重建 #chat-panel / workspace 節點；切換只改 dataset、hidden、aria-hidden（side-panel.ts:413-420、440-443）
- PanelSystemStore.patchState 禁止欄位無變化仍 emit（store.ts:119-124 已有 hasChanges 守衛，勿移除）
- 隊伍成員禁止全列重建；走 party-hud.ts:119 的 dataset 簽名比對
