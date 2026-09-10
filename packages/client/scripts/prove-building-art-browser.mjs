/** 自建建築圖片的真實 Vite + Chrome Canvas/Pixi 解碼與預覽證明。 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitFor, withClientBrowserProof } from './browser-proof-runtime.mjs';

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactDir = path.join(clientRoot, '.codex', 'building-art-proof');
const desktop = { width: 1280, height: 920 };
const phone = { width: 390, height: 844 };

async function setViewport(cdp, viewport) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
  });
}

async function capture(cdp, name) {
  await mkdir(artifactDir, { recursive: true });
  await cdp.evaluate(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  const layout = await cdp.evaluate(`(() => {
    const root = document.documentElement; const body = document.body;
    const sectionBottoms = [...document.querySelectorAll('#proof > section')].map((section) => Math.ceil(section.getBoundingClientRect().bottom + scrollY));
    const height = Math.max(root.scrollHeight, body.scrollHeight, ...sectionBottoms);
    return { width: innerWidth, height, viewportHeight: innerHeight, scrollHeight: height, sectionBottoms, overflow: root.scrollWidth > innerWidth || body.scrollWidth > innerWidth };
  })()`);
  assert.equal(layout.overflow, false, `${name} 不可橫向溢出`);
  assert.ok(layout.scrollHeight > layout.viewportHeight, `${name} 必須是可驗證的全文長頁`);
  assert.ok(layout.sectionBottoms.length === 3 && layout.sectionBottoms.every((bottom) => bottom <= layout.height), `${name} 必須包含建造圖、正式與拆除場景`);
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: layout.width, height: layout.height, scale: 1 },
  });
  await writeFile(path.join(artifactDir, name), Buffer.from(result.data, 'base64'));
}

const runExpression = `
  (async () => {
    const [{ TextRenderer }, { runtimeImagePack }, { TileSpriteCache }, { PixiMapRendererAdapter }, { TopdownProjection }, display] = await Promise.all([
      import('/src/renderer/text.ts'),
      import('/src/renderer/runtime-image-pack.ts'),
      import('/src/renderer/tile-sprite-cache.ts'),
      import('/src/game-map/renderer/pixi-map-renderer-adapter.ts'),
      import('/src/game-map/projection/topdown-projection.ts'),
      import('/src/display.ts'),
    ]);
    const ids = [
      'stone_wall', 'wooden_door', 'wooden_window', 'plain_floor',
      'scripture_platform', 'treasure_vault', 'technique_refining_table',
      'technique_unification_platform', 'time_chamber', 'meditation_mat',
    ];
    const labels = ['石牆', '木門', '木窗', '樸素地板', '藏經臺', '藏寶庫', '煉器臺', '合道臺', '時光室', '蒲團'];
    const decoded = await Promise.all(ids.flatMap((id) => [96, 192].map(async (size) => {
      const image = new Image();
      image.src = '/assets/building-art/v1/' + id + '-icon-' + size + '.webp';
      await image.decode();
      return image.naturalWidth === size && image.naturalHeight === size;
    })).concat(ids.map(async (id) => {
      const image = new Image();
      image.src = '/assets/building-art/v1/' + id + '-ground-256.webp';
      await image.decode();
      return image.naturalWidth === 256 && image.naturalHeight === 256;
    })));
    if (!decoded.every(Boolean)) throw new Error('30 個建築 WebP 必須由 Chrome 解碼成預期尺寸');

    document.body.innerHTML = '<main id="proof"><h1>自建建築圖片實機渲染證明</h1><p class="note">十種完成圖、合法／非法預覽，以及建築身份清除後的實際畫面。</p><section class="catalog"><h2>建造面板圖示（96 / 192 srcset）</h2><div class="icons">' + ids.map((id, index) => '<figure><img src="/assets/building-art/v1/' + id + '-icon-96.webp" srcset="/assets/building-art/v1/' + id + '-icon-192.webp 2x" alt=""><figcaption>' + labels[index] + '</figcaption></figure>').join('') + '</div></section><section class="pair"><article><h2>Canvas 正式 runtime-image pack</h2><div id="canvas-built"></div></article><article><h2>Pixi 正式 adapter</h2><div id="pixi-built"></div></article></section><section class="pair cleared"><article><h2>Canvas：null／拆除後</h2><div id="canvas-cleared"></div></article><article><h2>Pixi：null／拆除後</h2><div id="pixi-cleared"></div></article></section><p class="legend"><i class="ok"></i>合法預覽 <i class="bad"></i>非法預覽；圖片限制在單格內，高亮仍在最上層。</p></main>';
    const style = document.createElement('style');
    style.textContent = '*{box-sizing:border-box}html,body{width:auto!important;min-width:0!important;height:auto!important;min-height:100%;overflow:visible!important;margin:0;background:#11100f;color:#eee;font:14px system-ui}body{display:block!important;padding:18px}#proof,#proof *{min-width:0}#proof{display:block;max-width:1180px;margin:auto}h1{margin:0 0 4px;font-size:24px}h2{margin:0 0 8px;font-size:16px}.note{margin:0 0 14px;color:#bcb4a8}.catalog,.pair article{background:#1c1a17;border:1px solid #4b4439;border-radius:12px;padding:12px}.icons{display:grid;grid-template-columns:repeat(10,minmax(0,1fr));gap:7px}.icons figure{margin:0;min-width:0;text-align:center;background:#27231d;border-radius:8px;padding:5px}.icons img{display:block;width:100%;aspect-ratio:1;object-fit:contain}.icons figcaption{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}.pair img{display:block;width:100%;height:auto;background:#1a1816;border-radius:8px}.cleared img{max-height:180px;object-fit:cover;object-position:center}.legend{margin:10px 2px}.legend i{display:inline-block;width:12px;height:12px;margin:0 4px 0 10px;border:2px solid}.legend .ok{background:#16a34a55;border-color:#22c55e}.legend .bad{background:#dc262655;border-color:#f87171}@media(max-width:768px),(pointer:coarse) and (max-width:1024px){body{padding:8px}h1{font-size:19px}.icons{grid-template-columns:repeat(5,minmax(0,1fr));gap:4px}.icons figure{padding:3px}.icons figcaption{font-size:9px}.pair{grid-template-columns:1fr;gap:8px}.catalog,.pair article{padding:8px}.pair img{max-height:245px;object-fit:cover;object-position:center}.cleared img{max-height:120px}}';
    document.head.append(style);

    display.setZoom(1);
    display.updateDisplayMetrics(640, 420, 4);
    const cellSize = display.getCellSize();
    if (cellSize < 32) throw new Error('proof 單格不可縮成不可辨識尺寸');
    const camera = { x: 2.5 * cellSize, y: 2 * cellSize, targetX: 2.5 * cellSize, targetY: 2 * cellSize, offsetX: 0, offsetY: 0 };
    const tileCache = new Map();
    const visibleTiles = new Set();
    const structureIds = ids.slice(0, 4);
    for (let y = -2; y <= 6; y += 1) for (let x = -4; x <= 9; x += 1) {
      const key = x + ',' + y;
      visibleTiles.add(key);
      tileCache.set(key, { type: 'floor', walkable: true, surfaceType: 'floor' });
    }
    tileCache.set('0,0', { type: 'floor', walkable: false, surfaceType: 'floor', structureType: 'wall', buildingDefId: structureIds[0] });
    tileCache.set('1,0', { type: 'floor', walkable: true, surfaceType: 'floor', structureType: 'door', buildingDefId: structureIds[1] });
    tileCache.set('2,0', { type: 'floor', walkable: false, surfaceType: 'floor', structureType: 'window', buildingDefId: structureIds[2] });
    tileCache.set('3,0', { type: 'floor', walkable: true, surfaceType: 'floor', buildingDefId: structureIds[3] });
    const entities = ids.slice(4).map((id, index) => ({ id: 'proof:' + id, wx: index, wy: 2, char: '建', color: '#d6bc82', name: labels[index + 4], kind: 'building', buildingDefId: id }));
    const preview = { defId: 'time_chamber', imageKey: 'building:time_chamber', originX: 4, originY: 4, cells: [{ x: 4, y: 4, ok: true }, { x: 5, y: 4, ok: false }] };
    const toImage = async (canvas, targetId, alt) => {
      const image = document.createElement('img');
      image.src = canvas.toDataURL('image/png'); image.alt = alt;
      await image.decode();
      document.getElementById(targetId).replaceChildren(image);
    };

    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 420;
    const text = new TextRenderer(); text.init(canvas); text.setBuildPreviewOverlay(preview); text.updateEntities(entities);
    const drawCanvas = (revision) => { text.renderWorld(camera, tileCache, visibleTiles, revision, 0, 0, 2.5, 2, 8, 6, null); text.renderEntities(camera, 1, 'self', 2.5, 2, '我'); };
    drawCanvas(1);
    await new Promise((resolve) => setTimeout(resolve, 700));
    drawCanvas(1);
    await new Promise((resolve) => setTimeout(resolve, 700));
    drawCanvas(1);
    const floorTile = { type: 'floor', walkable: true, surfaceType: 'floor' };
    const underlayRegression = [];
    for (const [buildingDefId, structureType] of [['stone_wall', 'wall'], ['wooden_door', 'door'], ['wooden_window', 'window']]) {
      const buildingTile = { ...floorTile, walkable: structureType === 'door', structureType, buildingDefId };
      const floorCanvas = document.createElement('canvas'); floorCanvas.width = 64; floorCanvas.height = 64;
      const buildingCanvas = document.createElement('canvas'); buildingCanvas.width = 64; buildingCanvas.height = 64;
      if (!runtimeImagePack.drawTile(floorCanvas.getContext('2d'), floorTile, 0, 0, 64) || !runtimeImagePack.drawTile(buildingCanvas.getContext('2d'), buildingTile, 0, 0, 64)) throw new Error('Canvas runtime-image pack 未繪製底圖或建築：' + buildingDefId);
      const floorPixels = floorCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, 64, 64).data;
      const buildingPixels = buildingCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, 64, 64).data;
      for (let index = 3; index < buildingPixels.length; index += 4) if (buildingPixels[index] !== 255) throw new Error('透明建築繪製後不得露出 Canvas：' + buildingDefId);
      const cornerPoints = []; for (const baseX of [0, 56]) for (const baseY of [0, 56]) for (let dy = 0; dy < 8; dy += 1) for (let dx = 0; dx < 8; dx += 1) cornerPoints.push([baseX + dx, baseY + dy]);
      const transparentCorner = cornerPoints.find(([x, y]) => { const index = (y * 64 + x) * 4; return [0, 1, 2, 3].every((channel) => buildingPixels[index + channel] === floorPixels[index + channel]); });
      if (!transparentCorner) throw new Error('透明角落未保留 surface:floor 底圖：' + buildingDefId);
      underlayRegression.push({ buildingDefId, transparentCorner, alpha: buildingPixels[(transparentCorner[1] * 64 + transparentCorner[0]) * 4 + 3] });
    }
    const spriteCache = new TileSpriteCache(); const cacheRevision = runtimeImagePack.getRevision();
    const cachedWall = spriteCache.getTileSprite({ ...floorTile, structureType: 'wall', buildingDefId: 'stone_wall' }, 64, cacheRevision);
    const cachedDoor = spriteCache.getTileSprite({ ...floorTile, structureType: 'wall', buildingDefId: 'wooden_door' }, 64, cacheRevision);
    const cachedNatural = spriteCache.getTileSprite({ ...floorTile, structureType: 'wall' }, 64, cacheRevision);
    if (cachedWall.canvas === cachedDoor.canvas || cachedWall.canvas === cachedNatural.canvas || cachedDoor.canvas === cachedNatural.canvas) throw new Error('TileSpriteCache 不得讓不同 buildingDefId 或拆除後自然層共用舊 canvas');
    await toImage(canvas, 'canvas-built', 'Canvas 十種建築與合法非法預覽');
    const builtTileCache = new Map(tileCache);
    for (const key of ['0,0','1,0','2,0','3,0']) tileCache.set(key, { type: 'floor', walkable: true, surfaceType: 'floor' });
    text.setBuildPreviewOverlay(null); text.updateEntities([]); drawCanvas(2);
    if (text.entities.size !== 0 || text.buildPreviewCellByKey.size !== 0) throw new Error('Canvas null 清除後不得保留建築實體或預覽 cell');
    await toImage(canvas, 'canvas-cleared', 'Canvas 建築身份清除後無殘影');

    const pixiHost = document.createElement('div');
    const pixiCanvas = document.createElement('canvas'); pixiCanvas.id = 'game-canvas'; pixiCanvas.width = 640; pixiCanvas.height = 420; pixiHost.append(pixiCanvas); document.body.append(pixiHost);
    const adapter = new PixiMapRendererAdapter(); adapter.mount(pixiHost); adapter.resize(640, 420, 640, 420); adapter.syncDisplayMetrics();
    const baseScene = {
      mapMeta: null,
      player: { id: 'self', x: 2.5, y: 2, char: '我', mapId: 'proof' },
      terrain: { tileCache: builtTileCache, visibleTiles, terrainChunkRevisions: new Map([['0,0', 1]]), visibleTileRevision: 1, visibleTileTransitionStartedAt: 0, visibleTileTransitionDurationMs: 0, time: null },
      entities,
      groundPiles: new Map(),
      overlays: { pathCells: [], targeting: null, formationRange: null, senseQi: null, buildPreview: preview, fengShui: null, threatArrows: [] },
    };
    const projection = new TopdownProjection();
    const renderPixi = (scene) => { adapter.syncScene(scene, null); adapter.render(scene, camera, projection, 1); };
    await new Promise((resolve) => setTimeout(resolve, 400)); renderPixi(baseScene); await new Promise((resolve) => setTimeout(resolve, 900)); renderPixi(baseScene);
    const pixiChunk = adapter.terrainChunks.get('0,0'); if (!pixiChunk) throw new Error('Pixi 建築 proof 未建立 0,0 terrain chunk');
    const sourceLabel = (sprite) => String(sprite.texture?.label ?? sprite.texture?.source?.label ?? sprite.texture?.source?.resource?.url ?? '');
    const pixiUnderlayRegression = [];
    for (const [x, buildingDefId] of [[0, 'stone_wall'], [1, 'wooden_door'], [2, 'wooden_window']]) {
      const cellSprites = pixiChunk.spriteContainer.children.filter((sprite) => Math.round(sprite.position.x) === x * cellSize && Math.round(sprite.position.y) === 0);
      const labelsAtCell = cellSprites.map(sourceLabel);
      if (cellSprites.length < 2 || !labelsAtCell.some((label) => label.includes('floor')) || !labelsAtCell.some((label) => label.includes(buildingDefId))) throw new Error('Pixi 必須在 surface:floor 上疊建築 sprite：' + buildingDefId + '；' + labelsAtCell.join('|'));
      pixiUnderlayRegression.push({ buildingDefId, spriteCount: cellSprites.length, labels: labelsAtCell });
    }
    const pixiSnapshot = await createImageBitmap(pixiCanvas); const pixelCanvas = document.createElement('canvas'); pixelCanvas.width = pixiCanvas.width; pixelCanvas.height = pixiCanvas.height; const pixelContext = pixelCanvas.getContext('2d', { willReadFrequently: true }); pixelContext.drawImage(pixiSnapshot, 0, 0); pixiSnapshot.close();
    const pixiPixels = pixelContext.getImageData(0, 0, pixelCanvas.width, pixelCanvas.height).data; const pixiPixelEvidence = pixiUnderlayRegression.map((entry, index) => { const sprite = pixiChunk.spriteContainer.children.find((child) => Math.round(child.position.x) === index * cellSize && Math.round(child.position.y) === 0); const point = sprite.getGlobalPosition(); const startX = Math.max(0, Math.floor(point.x)); const startY = Math.max(0, Math.floor(point.y)); const colors = new Set(); for (let y = startY; y < Math.min(startY + 8, pixelCanvas.height); y += 1) for (let x = startX; x < Math.min(startX + 8, pixelCanvas.width); x += 1) { const offset = (y * pixelCanvas.width + x) * 4; if (pixiPixels[offset + 3] > 0) colors.add(pixiPixels.slice(offset, offset + 4).join(',')); } if (colors.size < 2) throw new Error('Pixi 建築透明角落不可退化為單色洞：' + entry.buildingDefId); return { buildingDefId: entry.buildingDefId, sampledColors: colors.size }; });
    await toImage(pixiCanvas, 'pixi-built', 'Pixi 十種建築與合法非法預覽');
    const clearedScene = { ...baseScene, terrain: { ...baseScene.terrain, tileCache, visibleTileRevision: 2, terrainChunkRevisions: new Map([['0,0', 2]]) }, entities: [], overlays: { ...baseScene.overlays, buildPreview: null } };
    renderPixi(clearedScene); await new Promise((resolve) => setTimeout(resolve, 80)); renderPixi(clearedScene);
    const residualPixiBuilding = Array.from(adapter.entities.values()).some((view) => Boolean(view.anim.buildingDefId));
    if (residualPixiBuilding || adapter.buildPreviewLayer.children.length !== 0) throw new Error('Pixi null 清除後不得保留建築實體或預覽 sprite');
    await toImage(pixiCanvas, 'pixi-cleared', 'Pixi 建築身份清除後無殘影');
    adapter.destroy(); pixiHost.remove();

    const proofImages = Array.from(document.querySelectorAll('#proof img'));
    await Promise.all(proofImages.map((image) => image.decode()));
    const samples = proofImages.map((image) => ({ complete: image.complete, width: image.naturalWidth, height: image.naturalHeight }));
    if (!samples.every((entry) => entry.complete && entry.width > 0 && entry.height > 0)) throw new Error('所有證據圖必須完成解碼');
    window.__buildingArtBrowserProof = { ready: true, decoded: decoded.length, cellSize, samples, underlayRegression, pixiUnderlayRegression, pixiPixelEvidence };
    return window.__buildingArtBrowserProof;
  })()
`;

await withClientBrowserProof({ viewport: desktop, profilePrefix: 'daojie-building-art-' }, async (cdp) => {
  const result = await cdp.evaluate(runExpression);
  assert.equal(result.ready, true);
  assert.equal(result.decoded, 30, 'Chrome 必須解碼全部 30 個 WebP');
  assert.ok(result.cellSize >= 32, '建築地圖圖必須維持可辨識單格尺寸');
  assert.equal(result.underlayRegression.length, 3, 'Canvas 必須驗證三種透明建築的底圖');
  assert.equal(result.pixiUnderlayRegression.length, 3, 'Pixi 必須驗證三種透明建築的雙層 sprite');
  await waitFor(() => cdp.evaluate(`window.__buildingArtBrowserProof?.ready === true`), '建築圖片 proof 畫面');
  await capture(cdp, 'desktop-building-art.png');
  await setViewport(cdp, phone);
  await cdp.evaluate(`document.body.offsetHeight`);
  await capture(cdp, 'mobile-building-art.png');
});

console.log('自建建築 Canvas/Pixi、合法/非法預覽與清除後無殘影 Chrome 證明通過');
