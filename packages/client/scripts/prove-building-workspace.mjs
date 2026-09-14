/** 背包營造分頁：嵌入內容、尺寸連續、分頁狀態與進地圖放置。 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withClientBrowserProof, waitFor } from './browser-proof-runtime.mjs';

const paint = String.raw`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`;
const outputDirectory = process.env.WORKSPACE_PROOF_OUTPUT_DIR;
const viewports = [
  { name: 'desktop', width: 1440, height: 900, touch: false },
  { name: 'portrait', width: 390, height: 844, touch: true },
  { name: 'landscape', width: 844, height: 390, touch: true },
];

async function capture(cdp, name) {
  if (!outputDirectory) return;
  await mkdir(outputDirectory, { recursive: true });
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(path.join(outputDirectory, `${name}.png`), Buffer.from(screenshot.data, 'base64'));
}

for (const viewport of viewports) {
  for (const theme of ['light', 'dark']) {
await withClientBrowserProof({ viewport, profilePrefix: `building-workspace-${viewport.name}-${theme}-` }, async (cdp) => {
  await waitFor(
    () => cdp.evaluate(`document.readyState === 'complete' && document.getElementById('game-shell')?.dataset.workspaceMode === 'true'`),
    '營造工作區正式 shell 初始化',
  );
  const initial = await cdp.evaluate(String.raw`(async () => {
    document.getElementById('game-shell')?.classList.remove('hidden');
    document.getElementById('login-overlay')?.classList.add('hidden');
    const { updateUiColorMode } = await import('/src/ui/ui-style-config.ts');
    updateUiColorMode('${theme}');
    const { createMainBuildingFengShuiStateSource } = await import('/src/main-building-fengshui-state-source.ts');
    const player = {
      id: 'building-workspace-proof', mapId: 'starter_village', x: 12, y: 12,
      buildingSkill: { level: 4 },
      inventory: { revision: 1, items: [
        ...Array.from({ length: 24 }, (_, index) => ({ itemId: 'proof-stone-' + index, name: '驗證石料 ' + (index + 1), type: 'material', count: 9 + index, tags: ['石材'] })),
        { itemId: 'proof-wood', name: '靈杉木', type: 'material', count: 12, tags: ['木材'] },
      ] },
    };
    const mapEvents = [];
    const mapStage = document.getElementById('game-stage');
    mapStage?.addEventListener('pointerdown', () => mapEvents.push('pointerdown'));
    let source;
    const closeWorkspace = () => {
      document.querySelector('#game-workspace .workspace-close')?.click();
      source.hideBuildingWorkspace();
    };
    source = createMainBuildingFengShuiStateSource({
      socket: { sendBuildPlaceIntent: payload => mapEvents.push({ kind: 'place', payload }), sendBuildDeconstructIntent: payload => mapEvents.push({ kind: 'deconstruct', payload }) },
      setFengShuiOverlay: () => {}, setBuildPreviewOverlay: () => {}, getVisibleTileAt: () => ({}), getPlayer: () => player,
      showToast: (message, kind) => mapEvents.push({ kind: 'toast', message, level: kind }),
      beginTargeting: (actionId, actionName, targetMode, range) => mapEvents.push({ kind: 'targeting', actionId, actionName, targetMode, range }),
      cancelTargeting: () => mapEvents.push({ kind: 'cancel' }), getInfoRadius: () => 6,
      sidePanel: { getLayoutCollapseState: () => ({}), setLayoutCollapseState: () => {}, setBuildingModeActive: () => {}, isMobileLayoutActive: () => false },
    });
    document.querySelector('[data-workspace-open="items"]')?.click();
    await ${paint};
    const workspace = document.getElementById('game-workspace');
    const inventoryRect = workspace.getBoundingClientRect();
    document.getElementById('workspace-tab-building')?.click();
    await ${paint};
    const host = document.getElementById('workspace-building');
    source.showBuildingWorkspace(host, closeWorkspace);
    await ${paint};
    const buildingRect = workspace.getBoundingClientRect();
    window.__buildingWorkspaceProof = { source, closeWorkspace, mapEvents, host, workspace, inventoryRect, buildingRect };
    return {
      embedded: host.querySelector('#building-mode-toolbar') !== null,
      workspaceVisible: workspace.getClientRects().length > 0,
      sameWidth: Math.abs(inventoryRect.width - buildingRect.width),
      sameHeight: Math.abs(inventoryRect.height - buildingRect.height),
      compact: workspace.dataset.compact,
      categoryTabs: host.querySelectorAll('.building-mode-tab').length,
      materialCards: host.querySelectorAll('.building-mode-material-card').length,
      materialVisible: host.querySelector('.building-mode-material-card')?.getBoundingClientRect().height ?? 0,
      contentScrollable: host.querySelector('.building-mode-content')?.scrollHeight > host.querySelector('.building-mode-content')?.clientHeight,
      bottomActionVisible: host.querySelector('[data-action="place"]')?.getBoundingClientRect().height ?? 0,
      workspaceBounds: (() => { const rect = workspace.getBoundingClientRect(); return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }; })(),
    };
  })()`);
  assert.equal(initial.embedded, true, '營造內容沒有嵌入背包營造分頁');
  assert.equal(initial.workspaceVisible, true, '切到營造後背包工作窗被關閉');
  assert(initial.sameWidth <= 1 && initial.sameHeight <= 1, '背包與營造分頁切換改變工作窗尺寸');
  assert.notEqual(initial.compact, 'true', '營造分頁仍被標示為 compact');
  assert(initial.categoryTabs >= 3 && initial.materialCards >= 2, '營造分類或背包材料沒有實際渲染');
  assert(initial.materialVisible >= 20, '營造材料沒有可見內容');
  assert(initial.bottomActionVisible >= 20, '營造底部操作按鈕不可見');
  assert(initial.workspaceBounds.left >= -1 && initial.workspaceBounds.top >= -1
    && initial.workspaceBounds.right <= viewport.width + 1 && initial.workspaceBounds.bottom <= viewport.height + 1,
  `${viewport.name}/${theme} 營造工作窗越界`);
  await capture(cdp, `building-workspace-${viewport.name}-${theme}-embedded`);

  const continuity = await cdp.evaluate(String.raw`(async () => {
    const proof = window.__buildingWorkspaceProof;
    const host = proof.host;
    const firstMaterial = host.querySelector('.building-mode-material-card[data-action="select-material"]');
    firstMaterial?.click();
    await ${paint};
    const selectedBefore = host.querySelectorAll('.building-mode-material-card.active').length;
    const scrollHost = host.querySelector('.building-mode-content');
    const contentScrollable = scrollHost.scrollHeight > scrollHost.clientHeight;
    scrollHost.scrollTop = Math.min(80, scrollHost.scrollHeight - scrollHost.clientHeight);
    const contentScrollTop = scrollHost.scrollTop;
    proof.source.hideBuildingWorkspace();
    proof.source.showBuildingWorkspace(host, proof.closeWorkspace);
    await ${paint};
    const selectedAfter = host.querySelectorAll('.building-mode-material-card.active').length;
    host.querySelector('[data-category="floor"]')?.click();
    await ${paint};
    proof.source.hideBuildingWorkspace();
    proof.source.showBuildingWorkspace(host, proof.closeWorkspace);
    await ${paint};
    return {
      selectedBefore, selectedAfter,
      contentScrollable, contentScrollTop,
      floorActive: host.querySelector('.building-mode-tab.active')?.dataset.category,
      toolbarEmbedded: host.querySelector('#building-mode-toolbar') !== null,
    };
  })()`);
  assert(continuity.selectedAfter > 0, `營造材料選擇沒有在返回分頁後恢復：${JSON.stringify(continuity)}`);
  if (viewport.name === 'landscape') {
    assert(continuity.contentScrollable && continuity.contentScrollTop > 0, `橫向觸控營造內容不可捲動：${JSON.stringify(continuity)}`);
  }
  assert.equal(continuity.floorActive, 'floor', '切換分頁後營造分類沒有保留');
  assert.equal(continuity.toolbarEmbedded, true, '返回營造分頁後內容沒有重新嵌入');

  const placement = await cdp.evaluate(String.raw`(async () => {
    const proof = window.__buildingWorkspaceProof;
    const host = proof.host;
    host.querySelector('[data-category="structure"]')?.click();
    await ${paint};
    host.querySelector('.building-mode-material-card[data-action="select-material"]')?.click();
    await ${paint};
    proof.source.hideBuildingWorkspace();
    proof.source.showBuildingWorkspace(host, proof.closeWorkspace);
    await ${paint};
    const placeButton = host.querySelector('[data-action="place"]');
    const placeDisabled = placeButton?.disabled ?? null;
    placeButton?.click();
    await ${paint};
    const stage = document.getElementById('game-stage');
    stage?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    return {
      workspaceHidden: document.getElementById('game-workspace')?.hidden === true,
      toolbarOnMap: document.getElementById('building-mode-toolbar')?.parentElement === document.getElementById('game-shell'),
      placeDisabled,
      targeting: proof.mapEvents.find(event => event.kind === 'targeting')?.actionId ?? null,
      mapPointerEvents: proof.mapEvents.filter(event => event === 'pointerdown').length,
    };
  })()`);
  assert.equal(placement.workspaceHidden, true, `選擇位置後工作窗沒有關閉：${JSON.stringify(placement)}`);
  assert.equal(placement.toolbarOnMap, true, '進入地圖選點後營造工具沒有回到地圖層');
  assert.equal(placement.targeting, 'building:place', '選擇位置沒有進入建造目標模式');
  assert(placement.mapPointerEvents > 0, '工作窗關閉後地圖沒有接收操作');
  await capture(cdp, `building-workspace-${viewport.name}-${theme}-map-placement`);
  const exit = await cdp.evaluate(String.raw`(async () => {
    const proof = window.__buildingWorkspaceProof;
    document.querySelector('#building-mode-toolbar [data-action="exit"]').click();
    document.querySelector('[data-workspace-open="items"]').click();
    document.getElementById('workspace-tab-building').click();
    proof.source.showBuildingWorkspace(proof.host, proof.closeWorkspace);
    await ${paint};
    proof.host.querySelector('[data-action="exit"]').click();
    await ${paint};
    const closed = proof.workspace.classList.contains('hidden');
    document.querySelector('[data-workspace-open="items"]').click();
    proof.source.showBuildingWorkspace(proof.host, proof.closeWorkspace);
    await ${paint};
    const reopened = proof.host.querySelectorAll('.building-mode-item').length > 0;
    proof.closeWorkspace();
    return { closed, reopened };
  })()`);
  assert.equal(exit.closed, true, '退出嵌入營造後留下空白工作窗');
  assert.equal(exit.reopened, true, '退出後重新開啟營造沒有內容');
});
  }
}

console.log('building workspace proof: PASS (desktop/portrait/landscape, light/dark, embedded, continuity, map placement)');
