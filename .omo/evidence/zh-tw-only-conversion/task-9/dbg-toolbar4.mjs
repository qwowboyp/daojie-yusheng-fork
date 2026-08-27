import { pathToFileURL } from 'node:url';
const rt = pathToFileURL('X:/workSpace/daojie-yusheng-fork/packages/client/scripts/browser-proof-runtime.mjs').href;
const m = await import(rt);
const { withClientBrowserProof } = m;
await withClientBrowserProof({ viewport: { width: 390, height: 844 }, profilePrefix: 'dbg7-' }, async (cdp) => {
  const fixture = `(async () => {
    document.getElementById('login-overlay')?.classList.add('hidden');
    document.getElementById('game-shell')?.classList.remove('hidden');
    const { createMainBuildingFengShuiStateSource } = await import('/src/main-building-fengshui-state-source.ts');
    const player = { playerId: 'p', mapId: 'proof-map', x: 0, y: 0, inventory: { revision: 1, capacity: 200, items: [] } };
    const source = createMainBuildingFengShuiStateSource({
      socket: { sendBuildPlaceIntent(){}, sendBuildDeconstruct(){}, sendRoomSetRole(){}, sendFengShuiObserve(){} },
      setFengShuiOverlay(){}, setBuildPreviewOverlay(){}, getPlayer: () => player, getVisibleTileAt: () => ({}),
      showToast(){}, beginTargeting(){}, cancelTargeting(){}, getInfoRadius: () => 8,
      sidePanel: { getLayoutCollapseState: () => ({leftCollapsed:false,rightCollapsed:false,bottomCollapsed:false}), setLayoutCollapseState(){}, setBuildingModeActive(a){ const s=document.getElementById('game-shell'); if(s) s.dataset.buildingMode=String(a); }, isMobileLayoutActive: () => true },
    });
    window.__p = { source, player };
    source.openBuildingPanel();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return true;
  })()`;
  await cdp.evaluate(fixture);
  const expr = `(() => {
    const toolbar = document.getElementById('building-mode-toolbar');
    if (!toolbar) return { found: false };
    const rc = toolbar.getBoundingClientRect();
    const op = toolbar.offsetParent;
    const opRect = op ? op.getBoundingClientRect() : null;
    const shell = document.getElementById('game-shell');
    const shellRect = shell ? shell.getBoundingClientRect() : null;
    return { found: true, top: rc.top, bottom: rc.bottom, height: rc.height, ih: window.innerHeight,
      offsetParent: op ? (op.id || op.className) : null, opTop: opRect?.top, opBottom: opRect?.bottom,
      shellTop: shellRect?.top, shellBottom: shellRect?.bottom, shellH: shellRect?.height };
  })()`;
  const r = await cdp.evaluate(expr);
  console.log('toolbar:', JSON.stringify(r));
});
