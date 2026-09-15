import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withClientBrowserProof, waitFor } from './browser-proof-runtime.mjs';

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.resolve(clientRoot, '../..', '.runtime/reports/spirit-beast-map-browser');
await mkdir(outputDir, { recursive: true });
const results = [];

async function setupFixture(cdp, mode) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: mode.width, height: mode.height, deviceScaleFactor: 1, mobile: mode.id !== 'desktop', screenWidth: mode.width, screenHeight: mode.height });
  await cdp.setTouchEmulationEnabled(mode.id !== 'desktop');
  const result = await cdp.evaluate(`(async () => {
    window.__spiritBeastProofErrors = [];
    window.__spiritBeastProofConsoleErrors = [];
    window.addEventListener('error', (event) => window.__spiritBeastProofErrors.push(String(event.message || event.error)));
    window.addEventListener('unhandledrejection', (event) => window.__spiritBeastProofErrors.push(String(event.reason)));
    const originalError = console.error.bind(console);
    console.error = (...args) => { window.__spiritBeastProofConsoleErrors.push(args.map(String).join(' ')); originalError(...args); };
    document.body.innerHTML = '<main style="margin:0;background:#18212a;padding:12px"><div id="map-proof" style="width:${mode.width - 24}px;height:${Math.max(300, mode.height - 24)}px"><canvas id="game-canvas" width="${mode.width - 24}" height="${Math.max(300, mode.height - 24)}"></canvas></div></main>';
    const { createMapRuntime } = await import('/src/game-map/runtime/map-runtime.ts');
    const runtime = createMapRuntime();
    const host = document.getElementById('map-proof');
    runtime.attach(host);
    runtime.setViewportSize(${mode.width - 24}, ${Math.max(300, mode.height - 24)}, 1);
    runtime.applyBootstrap({ self: { id: 'self', name: '測試道友', displayName: '測試道友', mapId: 'spirit-proof', instanceId: 'spirit-proof:1', x: 8, y: 6, hp: 100, maxHp: 100, facing: 'down', unlockedMinimapIds: [] } });
    runtime.applyMapStatic({ mapId: 'spirit-proof', tilesOriginX: -8, tilesOriginY: -8,
      tiles: Array.from({ length: 32 }, (_, row) => Array.from({ length: 32 }, (_, column) => ({
        type: '.', walkable: true, terrainType: 'grass',
        surfaceType: row === 14 || column === 16 ? 'road' : null,
        structureType: null, interactableKinds: [],
      }))),
    });
    const delta = { mapInstanceId: 'spirit-proof:1', revision: 1, reset: true, added: [
      { instanceId: 'beast-fan', speciesId: 'spirit_beast.fan.metal.01', ownerPlayerId: 'self', x: 7, y: 6, state: 'idle' },
      { instanceId: 'beast-heaven', speciesId: 'spirit_beast.heaven.water.02', ownerPlayerId: 'self', x: 9, y: 6, state: 'working', buildingId: 'sect_spirit_field' },
      { instanceId: 'beast-immortal', speciesId: 'spirit_beast.immortal.fire.02', ownerPlayerId: 'self', x: 8, y: 4, state: 'waiting' },
    ], updated: [], removed: [] };
    runtime.applySpiritBeastMapDelta(delta);
    const waitUntil = async (predicate, label) => { const deadline = performance.now() + 12000; while (!predicate()) { if (performance.now() > deadline) throw new Error(label); await new Promise((resolve) => setTimeout(resolve, 60)); } };
    await waitUntil(() => { const views = runtime.renderer.spiritBeastViews; return views.size === 3 && [...views.values()].every((view) => view.sprite.texture.width > 1); }, '靈獸 WebP 未載入 Pixi');
    const views = [...runtime.renderer.spiritBeastViews.values()];
    const canvas = document.getElementById('game-canvas');
    const outcome = { visibleViews: views.length, labels: views.map((view) => view.label.text), textures: views.map((view) => view.sprite.texture.width > 1), entityIds: [...runtime.renderer.entities.keys()], canvasPixels: canvas.width * canvas.height, pageErrors: window.__spiritBeastProofErrors, consoleErrors: window.__spiritBeastProofConsoleErrors };
    window.__spiritBeastProofRuntime = runtime;
    return outcome;
  })()`);
  assert.equal(result.visibleViews, 3, `${mode.id} 初始畫面應有三隻不同品級靈獸`);
  assert.deepEqual(result.textures, [true, true, true], `${mode.id} 靈獸 WebP 未成功貼入 Pixi`);
  assert.ok(result.labels.some((label) => /工作中/.test(label)), `${mode.id} 缺少工作中標示`);
  assert.ok(!result.entityIds.includes('beast-heaven'), `${mode.id} 靈獸不得污染 entities`);
  assert.equal(result.pageErrors.length, 0, `${mode.id} pageerror: ${result.pageErrors.join(' | ')}`);
  assert.equal(result.consoleErrors.length, 0, `${mode.id} console.error: ${result.consoleErrors.join(' | ')}`);
  return result;
}

async function exerciseMoveRecallReset(cdp) {
  const outcome = await cdp.evaluate(`(() => {
    const runtime = window.__spiritBeastProofRuntime;
    runtime.applySpiritBeastMapDelta({ mapInstanceId: 'spirit-proof:1', revision: 2, added: [], updated: [{ instanceId: 'beast-heaven', x: 10, y: 7, state: 'working' }], removed: ['beast-immortal'] });
    const moved = runtime.renderer.spiritBeastViews.get('beast-heaven');
    const movedTarget = { x: moved.targetWX, y: moved.targetWY, state: moved.entry.state };
    runtime.applySpiritBeastMapDelta({ mapInstanceId: 'spirit-proof:1', revision: 3, added: [], updated: [], removed: ['beast-fan'] });
    const afterRecall = runtime.renderer.spiritBeastViews.size;
    runtime.reset();
    return { movedTarget, afterRecall, afterReset: runtime.renderer.spiritBeastViews.size, entityCountAfterReset: runtime.renderer.entities.size };
  })()`);
  assert.deepEqual(outcome.movedTarget.state, 'working');
  assert.equal(outcome.afterRecall, 1, '收回後應只保留工作中的靈獸');
  assert.equal(outcome.afterReset, 0, 'reset 後靈獸 layer 必須清空');
  assert.equal(outcome.entityCountAfterReset, 0, 'reset 後既有 entity lifecycle 必須照常清空');
  return outcome;
}

await withClientBrowserProof({ viewport: { width: 1280, height: 900 }, profilePrefix: 'mud-spirit-beast-map-browser-' }, async (cdp) => {
  for (const mode of [
    { id: 'desktop', width: 1280, height: 900 },
    { id: 'phone-portrait', width: 390, height: 844 },
    { id: 'touch-landscape', width: 844, height: 390 },
  ]) {
    try {
      const result = await setupFixture(cdp, mode);
      await cdp.evaluate(`new Promise(resolve => setTimeout(resolve, 800))`);
      const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      await writeFile(path.join(outputDir, `${mode.id}.png`), Buffer.from(screenshot.data, 'base64'));
      results.push({ mode: mode.id, ...result, exercise: await exerciseMoveRecallReset(cdp) });
    } finally {
      await cdp.evaluate('window.__spiritBeastProofRuntime?.reset(); window.__spiritBeastProofRuntime?.destroy(); window.__spiritBeastProofRuntime = null; true');
    }
  }
});
await writeFile(path.join(outputDir, 'result.json'), JSON.stringify({ ok: true, results }, null, 2));
console.log(`SPIRIT_BEAST_MAP_BROWSER_PROOF:PASS screenshots=3 dir=${outputDir}`);
