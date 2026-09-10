/** 地塊 HD：正式 runtime Canvas/Pixi 場景與 atlas alpha 的 Chrome proof。 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitFor, withClientBrowserProof } from './browser-proof-runtime.mjs';

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactDir = path.join(clientRoot, '.codex', 'terrain-hd-proof');
const desktop = { width: 1280, height: 920 };
const phone = { width: 390, height: 844 };

async function setViewport(cdp, viewport) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false, screenWidth: viewport.width, screenHeight: viewport.height });
}

async function capture(cdp, name) {
  await mkdir(artifactDir, { recursive: true });
  // Vite 頁面可能遺留全域 height/overflow；待 viewport 和兩個 layout frame 安定後才量全文。
  await cdp.evaluate(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  const layout = await cdp.evaluate(`(() => {
    const root = document.documentElement;
    const body = document.body;
    const sectionBottoms = [...document.querySelectorAll('#proof > section')].map((section) => Math.ceil(section.getBoundingClientRect().bottom + scrollY));
    const height = Math.max(root.scrollHeight, body.scrollHeight, ...sectionBottoms);
    const offenders = [...document.querySelectorAll('*')].filter((element) => element.scrollWidth > element.clientWidth + 1).slice(0, 5).map((element) => ({ tag: element.tagName, id: element.id, className: element.className, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
    return { width: innerWidth, height, viewportHeight: innerHeight, scrollHeight: height, sectionBottoms, offenders, overflow: root.scrollWidth > innerWidth || body.scrollWidth > innerWidth };
  })()`);
  assert.equal(layout.overflow, false, `${name} 不可橫向溢出：${JSON.stringify(layout.offenders)}`);
  assert.ok(layout.scrollHeight > layout.viewportHeight, `${name} 必須是可驗證的全文長頁`);
  assert.ok(layout.sectionBottoms.length === 3 && layout.sectionBottoms.every((bottom) => bottom <= layout.height), `${name} 必須包含所有 Canvas、樣本與 Pixi section`);
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: layout.width, height: layout.height, scale: 1 } });
  await writeFile(path.join(artifactDir, name), Buffer.from(screenshot.data, 'base64'));
}

const expression = `
  (async () => {
    const [{ checkTerrainHdAtlasesInBrowser, TERRAIN_HD_STEMS }, { runtimeImagePack }, { PixiMapRendererAdapter }, { TopdownProjection }, display] = await Promise.all([
      import('/scripts/check-terrain-hd-atlases.mjs'), import('/src/renderer/runtime-image-pack.ts'),
      import('/src/game-map/renderer/pixi-map-renderer-adapter.ts'), import('/src/game-map/projection/topdown-projection.ts'), import('/src/display.ts'),
    ]);
    const atlas = await checkTerrainHdAtlasesInBrowser();
    const manifest = await (await fetch('/assets/runtime-image-packs/default/manifest.json', { cache: 'no-store' })).json();
    const tileKeys = Object.entries(manifest.tiles).filter(([, entry]) => typeof entry?.src === 'string' && entry.src.startsWith('tiles/')).map(([key]) => key);
    if (tileKeys.length !== TERRAIN_HD_STEMS.length) throw new Error('29 個正式 dual-grid tile manifest 項目必須完整');
    const tile = (key) => { const [layer, type] = key.split(':'); return { type: '.', walkable: true, terrainType: 'grass', surfaceType: null, structureType: null, interactableKinds: [], [layer + 'Type']: type }; };
    const readiness = document.createElement('canvas'); readiness.width = 64; readiness.height = 64; const readinessContext = readiness.getContext('2d');
    let runtimeReady = false; for (let attempt = 0; attempt < 150; attempt += 1) { if (tileKeys.every((key) => runtimeImagePack.drawTile(readinessContext, tile(key), 0, 0, 64))) { runtimeReady = true; break; } await new Promise((resolve) => setTimeout(resolve, 40)); }
    if (!runtimeReady) throw new Error('RuntimeImagePack 未能載入全部 29 張正式 atlas');
    const make = (keys, choose) => Array.from({ length: 6 }, (_, y) => Array.from({ length: 6 }, (_, x) => tile(keys[choose(x, y)])));
    const scenes = [
      ['草地與水岸', make(['terrain:grass', 'terrain:water'], (x, y) => x > 1 && y > 0 && y < 5 ? 1 : 0)],
      ['草地、土徑與石路', make(['terrain:grass', 'surface:trail', 'surface:road'], (x, y) => y === 3 ? 2 : x === 2 ? 1 : 0)],
      ['牆、門與窗', make(['surface:floor', 'structure:wall', 'structure:door', 'structure:window'], (x, y) => y === 0 && x === 3 ? 3 : y === 5 && x === 3 ? 2 : x === 0 || y === 0 || x === 5 || y === 5 ? 1 : 0)],
      ['森林與礦石', make(['terrain:grass', 'structure:tree', 'structure:bamboo', 'structure:stone', 'structure:spirit_ore', 'structure:black_iron_ore'], (x, y) => (x < 2 ? 0 : x < 4 ? 1 : 2) + (y < 3 ? 0 : 3))],
      ['雲地與樓梯', make(['terrain:cloud_floor', 'terrain:cloud', 'terrain:void', 'surface:stone_stairs'], (x, y) => y === 4 ? 3 : x < 2 ? 0 : x < 4 ? 1 : 2)],
    ];
    document.body.innerHTML = '<main id="proof"><h1>地塊 HD atlas：正式 Runtime Canvas / Pixi 證明</h1><p>29 張 1024px RGBA lossless WebP atlas；32px、64px 格與混合地圖。Chrome 模擬桌面／手機，不代表實體 Safari。</p><section id="maps"></section><section><h2>29 種材質完整格</h2><div id="samples"></div></section><section><h2>Pixi 正式 adapter 混合場景</h2><div id="pixi"></div></section></main>';
    const style = document.createElement('style'); style.textContent = '*{box-sizing:border-box}html,body{width:auto!important;min-width:0!important;height:auto!important;min-height:100%;overflow:visible!important;margin:0;font:14px/1.45 system-ui,"Microsoft JhengHei",sans-serif}body{display:block!important;padding:18px;background:#101719;color:#e5eeee}#proof,#proof *{min-width:0}#proof{display:block;max-width:1180px;margin:auto;overflow-wrap:anywhere}h1{margin:0;font-size:24px}h2{font-size:17px;margin:16px 0 8px}p{color:#b6c7c8}.maps{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.card{min-width:0;padding:10px;background:#1a2629;border:1px solid #385054;border-radius:10px}.card h3{font-size:14px;margin:0 0 7px}.card canvas{display:block;max-width:100%;height:auto;border-radius:4px}#samples{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}.sample{min-width:0;padding:6px;background:#1a2629;border-radius:8px}.sample b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.sample canvas{display:inline-block;margin:4px 5px 0 0;border-radius:3px}.sample canvas.sample-32{width:32px;height:32px}.sample canvas.sample-64{width:64px;height:64px}#proof #game-canvas.pixi-canvas{display:block;width:100%!important;max-width:720px!important;height:auto!important;border:1px solid #385054;border-radius:8px}body[data-proof-theme="light"]{background:#edf4f1;color:#182427}body[data-proof-theme="light"] p{color:#496369}body[data-proof-theme="light"] .card,body[data-proof-theme="light"] .sample{background:#ffffff;border-color:#9db6b9}@media(max-width:768px){body{padding:8px}h1{font-size:19px}.maps{grid-template-columns:1fr}.card{padding:8px}#samples{grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}.sample{padding:4px}.sample b{font-size:9px}}'; document.head.append(style);
    display.setZoom(1); display.updateDisplayMetrics(640, 420, 4); const cellSize = display.getCellSize(); if (cellSize < 32) throw new Error('地塊 proof 單格過小');
    const mapsHost = document.getElementById('maps'); mapsHost.className = 'maps'; const rendered = [];
    for (const size of [32, 64]) for (const [name, rows] of scenes) {
      const tileCache = new Map(); for (let y = 0; y < 6; y += 1) for (let x = 0; x < 6; x += 1) tileCache.set(x + ',' + y, rows[y][x]);
      const result = document.createElement('canvas'); result.width = 6 * size; result.height = 6 * size; const resultContext = result.getContext('2d');
      for (let y = 0; y < 6; y += 1) for (let x = 0; x < 6; x += 1) runtimeImagePack.drawTile(resultContext, rows[y][x], x * size, y * size, size);
      const drewEdges = runtimeImagePack.drawDualGridTiles(resultContext, { startGX: 0, startGY: 0, endGX: 5, endGY: 5, edgeStartGX: 0, edgeStartGY: 0, edgeEndGX: 5, edgeEndGY: 5, cellSize: size, offsetX: 0, offsetY: 0, tileAt: (x, y) => tileCache.get(x + ',' + y) ?? null }); if (!drewEdges) throw new Error('RuntimeImagePack.drawDualGridTiles 未繪製混合場景');
      const frame = document.createElement('article'); frame.className = 'card'; frame.innerHTML = '<h3>' + name + ' · ' + size + 'px</h3>'; frame.append(result); mapsHost.append(frame); rendered.push({ name, size, nonEmpty: resultContext.getImageData(0, 0, result.width, result.height).data.some((value, index) => index % 4 === 3 && value > 0) });
    }
    if (!rendered.every((entry) => entry.nonEmpty)) throw new Error('Canvas 正式 runtime 地塊場景不可漏圖');
    const sampleHost = document.getElementById('samples'); for (const key of tileKeys) { const cell = document.createElement('div'); cell.className = 'sample'; const label = document.createElement('b'); label.textContent = key + ' · 32/64px'; cell.append(label); for (const size of [32, 64]) { const sample = document.createElement('canvas'); sample.className = 'sample-' + size; sample.width = size; sample.height = size; const context = sample.getContext('2d'); if (!runtimeImagePack.drawTile(context, tile(key), 0, 0, size)) throw new Error('RuntimeImagePack 32/64px sample 漏圖：' + key); cell.append(sample); } sampleHost.append(cell); }
    const pixiHost = document.getElementById('pixi'); const pixiCanvas = document.createElement('canvas'); pixiCanvas.id = 'game-canvas'; pixiCanvas.width = 720; pixiCanvas.height = 420; pixiCanvas.className = 'pixi-canvas'; pixiHost.append(pixiCanvas);
    const pixiRows = scenes[3][1]; const tileCache = new Map(); const visibleTiles = new Set(); for (let y = -2; y <= 7; y += 1) for (let x = -3; x <= 10; x += 1) { const key = x + ',' + y; tileCache.set(key, pixiRows[Math.max(0, Math.min(5, y))][Math.max(0, Math.min(5, x))]); visibleTiles.add(key); }
    const adapter = new PixiMapRendererAdapter(); adapter.mount(pixiHost); adapter.resize(720, 420, 720, 420); adapter.syncDisplayMetrics(); const pixiCamera = { x: 2.5 * cellSize, y: 2.5 * cellSize, targetX: 2.5 * cellSize, targetY: 2.5 * cellSize, offsetX: 0, offsetY: 0 };
    const scene = { mapMeta: null, player: { id: 'self', x: 2.5, y: 2.5, char: '我', mapId: 'terrain-hd-proof' }, terrain: { tileCache, visibleTiles, terrainChunkRevisions: new Map([['0,0', 1]]), visibleTileRevision: 1, visibleTileTransitionStartedAt: 0, visibleTileTransitionDurationMs: 0, time: null }, entities: [], groundPiles: new Map(), overlays: { pathCells: [], targeting: null, formationRange: null, senseQi: null, buildPreview: null, fengShui: null, threatArrows: [] } };
    const projection = new TopdownProjection(); await new Promise((resolve) => setTimeout(resolve, 350)); adapter.syncScene(scene, null); adapter.render(scene, pixiCamera, projection, 1); await new Promise((resolve) => setTimeout(resolve, 800)); adapter.render(scene, pixiCamera, projection, 1);
    const pixiChunkCount = adapter.terrainChunks.size; const pixiSpriteCount = Array.from(adapter.terrainChunks.values()).reduce((total, chunk) => total + chunk.spriteContainer.children.length, 0); if (pixiChunkCount === 0 || pixiSpriteCount === 0) throw new Error('Pixi 正式 adapter 未建立 atlas terrain sprite');
    const snapshot = await createImageBitmap(pixiCanvas); const pixelsCanvas = document.createElement('canvas'); pixelsCanvas.width = pixiCanvas.width; pixelsCanvas.height = pixiCanvas.height; const pixelsContext = pixelsCanvas.getContext('2d', { willReadFrequently: true }); pixelsContext.drawImage(snapshot, 0, 0); snapshot.close(); const pixiPixels = pixelsContext.getImageData(0, 0, pixelsCanvas.width, pixelsCanvas.height).data; let pixiVisiblePixels = 0; for (let index = 0; index < pixiPixels.length; index += 16) if (pixiPixels[index + 3] > 0 && (pixiPixels[index] !== 26 || pixiPixels[index + 1] !== 24 || pixiPixels[index + 2] !== 22)) pixiVisiblePixels += 1; if (pixiVisiblePixels < 100) throw new Error('Pixi canvas snapshot 未含足夠正式地塊像素');
    window.__terrainHdSetTheme = (theme) => { if (theme !== 'light' && theme !== 'dark') throw new Error('未知 proof theme'); document.documentElement.dataset.colorMode = theme; document.body.dataset.proofTheme = theme; return theme; }; window.__terrainHdSetTheme('dark'); window.__terrainHdCleanup = () => { adapter.destroy(); pixiCanvas.remove(); }; window.__terrainHdProof = { ready: true, atlas, tileCount: tileKeys.length, scenes: rendered.length, pixiChunkCount, pixiSpriteCount, pixiVisiblePixels, screenshots: ['desktop-dark-terrain-hd.png', 'mobile-dark-terrain-hd.png', 'desktop-light-terrain-hd.png', 'mobile-light-terrain-hd.png'], browser: 'Chrome 模擬，未覆蓋實體 Safari' }; return window.__terrainHdProof;
  })()
`;

export async function runTerrainHdBrowserProof() {
  let result;
  await withClientBrowserProof({ viewport: desktop, profilePrefix: 'daojie-terrain-hd-' }, async (cdp) => {
    result = await cdp.evaluate(expression); assert.equal(result.ready, true); assert.equal(result.atlas.atlasCount, 29); assert.ok(result.atlas.manifestVersion >= 6); assert.equal(result.tileCount, 29); assert.ok(result.pixiSpriteCount > 0);
    await waitFor(() => cdp.evaluate(`window.__terrainHdProof?.ready === true`), '地塊 HD proof 畫面');
    for (const theme of ['dark', 'light']) {
      await cdp.evaluate(`window.__terrainHdSetTheme?.('${theme}')`); await setViewport(cdp, desktop); await capture(cdp, `desktop-${theme}-terrain-hd.png`);
      await setViewport(cdp, phone); await capture(cdp, `mobile-${theme}-terrain-hd.png`);
    }
    await cdp.evaluate('window.__terrainHdCleanup?.()');
  });
  await mkdir(artifactDir, { recursive: true }); await writeFile(path.join(artifactDir, 'terrain-hd-proof.json'), `${JSON.stringify(result, null, 2)}\n`); return result;
}

if (process.argv[1]?.endsWith('prove-terrain-hd-browser.mjs')) runTerrainHdBrowserProof().then(() => console.log('地塊 HD atlas、Canvas 與 Pixi Chrome proof 通過')).catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : error); process.exitCode = 1; });
