/** 實際 MapRuntime canvas 的觸控雙指縮放與輸入回歸 proof。 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { delay, withClientBrowserProof, waitFor } from './browser-proof-runtime.mjs';

const PHONE = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };
const DESKTOP = { width: 1440, height: 900 };
const OUTPUT_DIR = path.resolve(process.cwd(), '.runtime', 'map-pinch-zoom-proof');

const fixtureExpression = String.raw`
  (async () => {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.margin = '0';
    const { createMapRuntime } = await import('/src/game-map/runtime/map-runtime.ts');
    const { createMainUiStateSource } = await import('/src/main-ui-state-source.ts');
    const { bindMainMapInteractions } = await import('/src/main-map-interaction-bindings.ts');
    const { bindZoomControls } = await import('/src/main-ui-helpers.ts');
    const { getCellSize, getZoom } = await import('/src/display.ts');
    const host = document.createElement('div');
    host.id = 'map-pinch-zoom-proof-host';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#17251b;overflow:hidden;';
    const mapCanvas = document.createElement('canvas');
    mapCanvas.id = 'game-canvas';
    host.append(mapCanvas);
    document.body.append(host);
    const runtime = createMapRuntime();
    const targets = [];
    const zooms = [];
    let renderCount = 0;
    runtime.setRenderFrameObserver(() => { renderCount += 1; });
    const zoomSlider = document.createElement('input');
    zoomSlider.type = 'range'; zoomSlider.min = '0.5'; zoomSlider.max = '4'; zoomSlider.step = '0.01';
    const zoomLevelEl = document.createElement('output');
    host.append(zoomSlider, zoomLevelEl);
    const runtimeSetZoom = runtime.setZoom.bind(runtime);
    runtime.setZoom = (level) => { zooms.push(level); runtimeSetZoom(level); };
    runtime.attach(host);
    const tiles = Array.from({ length: 25 }, () => Array.from({ length: 25 }, () => ({
      type: 'grass', terrainType: 'cold_bog', surfaceType: null, walkable: true,
      blocksSight: false, aura: 0, occupiedBy: null, modifiedAt: null,
    })));
    const player = { id: 'pinch-proof-player', mapId: 'pinch-proof-map', name: '縮放驗證者', x: 12, y: 12, viewRange: 10 };
    const bootstrap = {
      self: player,
      mapMeta: { id: player.mapId, name: '雙指縮放驗證圖', width: 25, height: 25, mapLv: 1 },
      viewRadius: 12,
      tiles,
      players: [], monsters: [], npcs: [], buildings: [], groundItems: [],
    };
    runtime.applyBootstrap(bootstrap);
    runtime.setViewportSize(innerWidth, innerHeight, devicePixelRatio || 1);
    const uiStateSource = createMainUiStateSource({
      hud: { update: () => {} }, worldPanel: { update: () => {}, clear: () => {} }, mapRuntime: runtime,
      zoomSlider, zoomLevelEl, mapNameEl: null, resizeCanvas: () => {}, documentRef: document,
      showToastEl: null, getPlayer: () => player,
    });
    bindMainMapInteractions({
      applyZoomChange: (level) => uiStateSource.applyZoomChange(level), mapRuntime: runtime,
      planPathTo: (target) => targets.push({ x: target.x, y: target.y, zoom: getZoom() }), findObservedEntityAt: () => null, hasBlockingFormationBoundaryAt: () => false,
      getPendingTargetedAction: () => null, setPendingTargetedActionHover: () => {}, resolveCurrentTargetingRange: () => 0,
      isPointInsideCurrentMap: () => true, getVisibleTileAt: () => tiles[12]?.[12] ?? null, showToast: () => {}, showObserveModal: () => {},
      hasPendingBuildPlacementTargeting: () => false, setPendingBuildPlacementHover: () => {}, confirmBuildPlacementTarget: () => false,
      confirmBuildDeconstructTarget: () => false, cancelPendingBuildPlacementTargeting: () => {}, cancelTargeting: () => {},
      getPlayer: () => player, sendAction: () => {}, resetLootPanelManualCloseSuppression: () => {}, sendCastSkill: () => {},
      hasAffectableTargetInArea: () => false, resolveTargetRefForAction: () => null, getCurrentActionDef: () => null,
      isWithinDisplayedMemoryBounds: () => true, getKnownTileAt: () => tiles[12]?.[12] ?? null, handleNpcClickTarget: () => false,
      handlePortalClickTarget: () => false, isCellReachableForCurrentPlayer: () => true, clearCurrentPath: () => {},
      syncTargetingOverlay: () => {}, syncSenseQiOverlay: () => {}, setHoveredMapTile: () => {},
    });
    bindZoomControls({
      zoomSlider, zoomResetBtn: null, zoomWheelTarget: host, minZoom: 0.5, maxZoom: 4,
      getZoom, applyZoomChange: (level) => uiStateSource.applyZoomChange(level), showToast: () => {},
    });
    const canvas = host.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('MapRuntime 未建立真實 canvas');
    const pointers = [];
    canvas.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'touch') pointers.push(event.pointerId);
    });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    window.__mapPinchZoomProof = {
      runtime, host, canvas, targets, zooms, pointers, getZoom, bootstrap: () => runtime.applyBootstrap(bootstrap), setZoom: (level) => uiStateSource.applyZoomChange(level),
      point: () => { const rect = canvas.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; },
      cellSize: () => getCellSize(),
      state: () => ({ zoom: getZoom(), targets: targets.slice(), zooms: zooms.slice(), pointerIds: pointers.slice(), renderCount, slider: zoomSlider.value, label: zoomLevelEl.textContent, storedZoom: localStorage.getItem('mud:map-zoom'), rect: canvas.getBoundingClientRect().toJSON() }),
    };
    return window.__mapPinchZoomProof.state();
  })()
`;

async function setViewport(cdp, viewport, dark = false) {
  const beforeRender = await cdp.evaluate('window.__mapPinchZoomProof.state().renderCount');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false,
    screenWidth: viewport.width, screenHeight: viewport.height,
  });
  await cdp.evaluate(`(() => {
    document.documentElement.dataset.theme = ${JSON.stringify(dark ? 'dark' : 'light')};
    window.__mapPinchZoomProof.runtime.setViewportSize(innerWidth, innerHeight, devicePixelRatio || 1);
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`);
  await waitFor(
    () => cdp.evaluate(`window.__mapPinchZoomProof.state().renderCount > ${beforeRender}`),
    `${viewport.width}x${viewport.height} 視口後 MapRuntime 真實繪製`,
  );
}

async function touch(cdp, type, points) {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map(({ x, y, id }) => ({ x, y, id, radiusX: 2, radiusY: 2, force: 1 })),
  });
  await delay(24);
}

async function tap(cdp, point, id = 1) {
  await touch(cdp, 'touchStart', [{ ...point, id }]);
  await touch(cdp, 'touchEnd', []);
}

async function settle(cdp) {
  await cdp.evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
}

async function capture(cdp, name) {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const rect = await cdp.evaluate('window.__mapPinchZoomProof.canvas.getBoundingClientRect().toJSON()');
  const image = await cdp.send('Page.captureScreenshot', {
    format: 'png', fromSurface: true, captureBeyondViewport: false,
    clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 },
  });
  await writeFile(path.join(OUTPUT_DIR, name), Buffer.from(image.data, 'base64'));
}

function assertInRange(value, min, max, label) {
  assert(value >= min && value <= max, `${label} 超出範圍：${value}，預期 ${min}..${max}`);
}

await withClientBrowserProof({ viewport: PHONE, profilePrefix: 'mud-map-pinch-proof-' }, async (cdp) => {
  // display 的格子尺寸為單例；隔離原頁面 runtime，避免兩張地圖互相覆寫視口派生值。
  await cdp.send('Network.enable');
  await cdp.send('Network.setBlockedURLs', { urls: ['*/src/main.ts*'] });
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitFor(() => cdp.evaluate("document.readyState === 'complete' && Boolean(document.getElementById('detail-modal-body'))"), '隔離地圖 proof 頁面');
  await cdp.evaluate(fixtureExpression);
  await waitFor(() => cdp.evaluate(`Boolean(window.__mapPinchZoomProof?.canvas) && window.__mapPinchZoomProof.state().rect.width > 0`), 'MapRuntime 觸控 fixture');
  await setViewport(cdp, PHONE);
  const point = await cdp.evaluate('window.__mapPinchZoomProof.point()');

  // 先以中心格取得真實反投影基準，再確認縮放後點同一畫布座標仍命中該格。
  await cdp.evaluate('window.__mapPinchZoomProof.setZoom(2); window.__mapPinchZoomProof.targets.length = 0; window.__mapPinchZoomProof.zooms.length = 0;');
  await tap(cdp, point);
  const baselineTarget = await cdp.evaluate('window.__mapPinchZoomProof.targets.at(-1)');
  assert.deepEqual({ x: baselineTarget.x, y: baselineTarget.y }, { x: 12, y: 12 }, '縮放前中心格反投影錯誤');
  const cellSize = await cdp.evaluate('window.__mapPinchZoomProof.cellSize()');
  await tap(cdp, { x: point.x + cellSize, y: point.y }, 2);
  const adjacentTarget = await cdp.evaluate('window.__mapPinchZoomProof.targets.at(-1)');
  assert.deepEqual({ x: adjacentTarget.x, y: adjacentTarget.y }, { x: 13, y: 12 }, '縮放前相鄰格反投影錯誤');
  await cdp.evaluate('window.__mapPinchZoomProof.targets.length = 1;');

  const left = { x: point.x - 50, y: point.y, id: 11 };
  const right = { x: point.x + 50, y: point.y, id: 12 };
  await touch(cdp, 'touchStart', [left]);
  await touch(cdp, 'touchStart', [left, right]);
  await touch(cdp, 'touchMove', [left, { ...right, x: point.x + 180 }]);
  await settle(cdp);
  const enlarged = await cdp.evaluate('window.__mapPinchZoomProof.state()');
  assert(enlarged.zoom > 2, `雙指撐開未放大：${enlarged.zoom}`);
  assert.equal(enlarged.slider, String(enlarged.zoom), '正式縮放滑桿未同步雙指倍率');
  assert.match(enlarged.label, new RegExp(`x${enlarged.zoom}`), '正式縮放倍率標籤未同步雙指倍率');
  assert.equal(enlarged.storedZoom, String(enlarged.zoom), '正式縮放倍率未持久化到 localStorage');
  assert.equal(enlarged.targets.length, 1, '雙指縮放錯誤觸發地圖點擊');
  await touch(cdp, 'touchEnd', []);

  await cdp.evaluate('window.__mapPinchZoomProof.setZoom(2); window.__mapPinchZoomProof.zooms.length = 0;');
  await cdp.evaluate(`(() => {
    const { canvas, runtime } = window.__mapPinchZoomProof;
    const emit = (type, pointerId, clientX) => canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'touch', pointerId, clientX, clientY: ${point.y} }));
    emit('pointerdown', 81, ${left.x}); emit('pointerdown', 82, ${right.x}); emit('pointermove', 82, ${point.x + 170});
    runtime.reset(); window.__mapPinchZoomProof.bootstrap();
  })()`);
  await settle(cdp);
  assert.equal(await cdp.evaluate('window.__mapPinchZoomProof.zooms.length'), 0, 'reset 未清除待處理雙指縮放 rAF');
  await tap(cdp, point, 13);
  const enlargedTarget = await cdp.evaluate('window.__mapPinchZoomProof.targets.at(-1)');
  assert.deepEqual({ x: enlargedTarget.x, y: enlargedTarget.y }, { x: 12, y: 12 }, '縮放後中心格反投影錯誤');

  await cdp.evaluate('window.__mapPinchZoomProof.setZoom(3.9); window.__mapPinchZoomProof.zooms.length = 0;');
  await touch(cdp, 'touchStart', [left]);
  await touch(cdp, 'touchStart', [left, right]);
  await touch(cdp, 'touchMove', [left, { ...right, x: point.x + 900 }]);
  await touch(cdp, 'touchEnd', []);
  const maximum = await cdp.evaluate('window.__mapPinchZoomProof.state().zoom');
  assertInRange(maximum, 0.5, 4, '放大上限');
  assert.equal(maximum, 4, '雙指放大未箝至最大縮放');

  await cdp.evaluate('window.__mapPinchZoomProof.setZoom(0.6);');
  await touch(cdp, 'touchStart', [left]);
  await touch(cdp, 'touchStart', [left, right]);
  await touch(cdp, 'touchMove', [left, { ...right, x: left.x + 1 }]);
  await touch(cdp, 'touchEnd', []);
  const minimum = await cdp.evaluate('window.__mapPinchZoomProof.state().zoom');
  assertInRange(minimum, 0.5, 4, '縮小下限');
  assert.equal(minimum, 0.5, '雙指縮小未箝至最小縮放');

  // 第一指放開後，剩餘手指移動不得延續上一組距離比例，也不得被當作 tap。
  await cdp.evaluate('window.__mapPinchZoomProof.setZoom(2); window.__mapPinchZoomProof.targets.length = 0;');
  await touch(cdp, 'touchStart', [left]);
  await touch(cdp, 'touchStart', [left, right]);
  await touch(cdp, 'touchEnd', [right]);
  const afterFirstRelease = await cdp.evaluate('window.__mapPinchZoomProof.state().zoom');
  await touch(cdp, 'touchMove', [{ ...right, x: right.x + 160 }]);
  await settle(cdp);
  assert.equal(await cdp.evaluate('window.__mapPinchZoomProof.state().zoom'), afterFirstRelease, '剩餘單指錯誤延續雙指縮放');
  await touch(cdp, 'touchEnd', []);
  assert.equal(await cdp.evaluate('window.__mapPinchZoomProof.targets.length'), 0, '放開第一指後殘餘指錯誤觸發點擊');
  await tap(cdp, point, 14);
  assert.equal(await cdp.evaluate('window.__mapPinchZoomProof.targets.length'), 1, '雙指結束後下一次單指 tap 失效');

  await cdp.evaluate('window.__mapPinchZoomProof.targets.length = 0;');
  await touch(cdp, 'touchStart', [{ ...point, id: 21 }]);
  await touch(cdp, 'touchMove', [{ x: point.x + 24, y: point.y, id: 21 }]);
  await touch(cdp, 'touchEnd', []);
  assert.equal(await cdp.evaluate('window.__mapPinchZoomProof.targets.length'), 0, '超過 tap slop 的拖曳錯誤點擊地圖');

  // CDP 真正取消後再補上 event-based lifecycle 邊界：pointercancel、lost capture、blur、reset、detach 都不可殘留手勢。
  for (const mode of ['touchCancel', 'lostpointercapture', 'blur', 'reset', 'detach']) {
    await cdp.evaluate('window.__mapPinchZoomProof.targets.length = 0; window.__mapPinchZoomProof.setZoom(2);');
    await touch(cdp, 'touchStart', [{ ...point, id: 30 }]);
    if (mode === 'touchCancel') {
      await touch(cdp, 'touchCancel', []);
    } else if (mode === 'lostpointercapture') {
      await cdp.evaluate(`(() => { const p = window.__mapPinchZoomProof.pointers.at(-1); window.__mapPinchZoomProof.canvas.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true, pointerType: 'touch', pointerId: p, clientX: ${point.x}, clientY: ${point.y} })); })()`);
      await touch(cdp, 'touchEnd', []);
    } else if (mode === 'blur') {
      await cdp.evaluate('window.dispatchEvent(new Event("blur"))');
      await touch(cdp, 'touchEnd', []);
    } else if (mode === 'reset') {
      await cdp.evaluate('window.__mapPinchZoomProof.runtime.reset(); window.__mapPinchZoomProof.bootstrap()');
      await touch(cdp, 'touchEnd', []);
    } else {
      await cdp.evaluate('window.__mapPinchZoomProof.runtime.detach(); window.__mapPinchZoomProof.runtime.attach(window.__mapPinchZoomProof.host); window.__mapPinchZoomProof.runtime.setViewportSize(innerWidth, innerHeight, devicePixelRatio || 1);');
      await touch(cdp, 'touchEnd', []);
    }
    await settle(cdp);
    assert.equal(await cdp.evaluate('window.__mapPinchZoomProof.targets.length'), 0, `${mode} 後殘留觸控點擊`);
    await tap(cdp, await cdp.evaluate('window.__mapPinchZoomProof.point()'), 31);
    assert.equal(await cdp.evaluate('window.__mapPinchZoomProof.targets.length'), 1, `${mode} 清理後下一次 tap 失效`);
  }

  await cdp.evaluate('window.__mapPinchZoomProof.setZoom(2); window.__mapPinchZoomProof.zooms.length = 0;');
  await touch(cdp, 'touchStart', [left]);
  await touch(cdp, 'touchStart', [left, right]);
  await touch(cdp, 'touchStart', [left, right, { x: point.x, y: point.y + 90, id: 43 }]);
  await settle(cdp);
  assert.equal(await cdp.evaluate('window.__mapPinchZoomProof.zooms.length'), 0, '第三指加入時縮放發生跳變');
  await touch(cdp, 'touchEnd', [left, right]);
  await settle(cdp);
  assert.equal(await cdp.evaluate('window.__mapPinchZoomProof.zooms.length'), 0, '第三指放開回到雙指時縮放發生跳變');
  await touch(cdp, 'touchEnd', []);

  await setViewport(cdp, LANDSCAPE, true);
  const landscapePoint = await cdp.evaluate('window.__mapPinchZoomProof.point()');
  const landscapeLeft = { x: landscapePoint.x - 50, y: landscapePoint.y, id: 51 };
  const landscapeRight = { x: landscapePoint.x + 50, y: landscapePoint.y, id: 52 };
  await cdp.evaluate('window.__mapPinchZoomProof.setZoom(2);');
  await touch(cdp, 'touchStart', [landscapeLeft]);
  await touch(cdp, 'touchStart', [landscapeLeft, landscapeRight]);
  await touch(cdp, 'touchMove', [landscapeLeft, { ...landscapeRight, x: landscapePoint.x + 150 }]);
  await touch(cdp, 'touchEnd', []);
  assert(await cdp.evaluate('window.__mapPinchZoomProof.state().zoom') > 2, '橫向觸控視口雙指縮放未生效');
  await capture(cdp, 'landscape-dark.png');
  await setViewport(cdp, DESKTOP);
  const desktopPoint = await cdp.evaluate('window.__mapPinchZoomProof.point()');
  await cdp.evaluate('window.__mapPinchZoomProof.setZoom(2);');
  const beforeWheel = await cdp.evaluate('window.__mapPinchZoomProof.state().zoom');
  const beforeDesktop = await cdp.evaluate('window.__mapPinchZoomProof.targets.length');
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: desktopPoint.x, y: desktopPoint.y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: desktopPoint.x, y: desktopPoint.y, button: 'left', buttons: 0, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: desktopPoint.x, y: desktopPoint.y, deltaX: 0, deltaY: 120 });
  await settle(cdp);
  assert.equal(await cdp.evaluate('window.__mapPinchZoomProof.targets.length'), beforeDesktop + 1, '桌面左鍵地圖點擊退化');
  assert(await cdp.evaluate('window.__mapPinchZoomProof.state().zoom') < beforeWheel, '桌面 wheel 未經正式縮放綁定改變倍率');
  await setViewport(cdp, PHONE);
  await capture(cdp, 'phone-light.png');
});

console.log(`map pinch zoom proof: PASS (${OUTPUT_DIR})`);
