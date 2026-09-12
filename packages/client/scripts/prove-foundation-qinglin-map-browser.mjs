/** 用正式服務端地圖模板輸出驗證青霖澤地貌、採集點與頭目在 Canvas/Pixi 的顯示。 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { withClientBrowserProof } from './browser-proof-runtime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const { MapTemplateRepository } = require(path.join(root, 'packages/server/dist/runtime/map/map-template.repository.js'));
const { composeTileTypeFromLayers } = require(path.join(root, 'packages/shared/dist/index.js'));
const repo = new MapTemplateRepository(); repo.loadAll();
const template = repo.getOrThrow('foundation_qinglin_marsh');
const document = JSON.parse(await fs.readFile(path.join(root, 'packages/server/data/maps/foundation_qinglin_marsh.json'), 'utf8'));
const monsters = JSON.parse(await fs.readFile(path.join(root, 'packages/server/data/content/monsters/青霖澤.json'), 'utf8'));
const data = { width: template.width, height: template.height, tiles: [], entities: [] };
for (let y = 0; y < template.height; y++) for (let x = 0; x < template.width; x++) data.tiles.push([`${x},${y}`, {
  type: composeTileTypeFromLayers(template.terrainRows[y][x], template.surfaceRows[y][x], template.structureRows[y][x]), terrainType: template.terrainRows[y][x],
  surfaceType: template.surfaceRows[y][x], structureType: template.structureRows[y][x],
  walkable: template.walkableMask[y * template.width + x] === 1,
}]);
data.entities = document.monsterSpawns.map(([x, y, id]) => {
  const monster = monsters.find((entry) => entry.id === id);
  assert.ok(monster);
  return { id: `proof:${id}`, monsterId: id, name: monster.name, char: monster.char, color: monster.color,
    kind: 'monster', monsterTier: monster.tier, wx: x, wy: y, facing: 'E', hp: 100, maxHp: 100 };
}).concat(template.containers.map((container) => ({ id: container.id, name: container.name, char: container.char,
  color: container.color, kind: 'container', wx: container.x, wy: container.y })));
const dir = path.join(root, 'packages/client/.codex/qinglin-map-proof'); await fs.mkdir(dir, { recursive: true });

async function drawMap(data, point, theme) {
  const [{ TextRenderer }, { runtimeImagePack }, { PixiMapRendererAdapter }, { TopdownProjection }, display, { resolveMapBgmSrcForMap }] = await Promise.all([
    import('/src/renderer/text.ts'), import('/src/renderer/runtime-image-pack.ts'),
    import('/src/game-map/renderer/pixi-map-renderer-adapter.ts'), import('/src/game-map/projection/topdown-projection.ts'),
    import('/src/display.ts'), import('/src/constants/bgm/map-bgm-config.ts'),
  ]);
  const expect = (value, message) => { if (!value) throw new Error(message); };
  const waitUntil = async (predicate, message) => {
    const deadline = performance.now() + 12000;
    while (!predicate()) { if (performance.now() > deadline) throw new Error(message); await new Promise((resolve) => setTimeout(resolve, 80)); }
  };
  const bgm = resolveMapBgmSrcForMap('foundation_qinglin_marsh');
  expect(bgm === '/bgm/cold-tide-marsh.mp3' && (await fetch(bgm, { method: 'HEAD' })).ok, '青霖澤既有 BGM 來源無效');
  document.body.innerHTML = '<main id="proof"><h1>青霖澤 · ' + point.name + '</h1><p>正式地圖模板與圖包；顯示整圖輪廓及局部場景。</p><section id="overview"></section><div class="pair"><section id="canvas"><h2>Canvas</h2></section><section id="pixi"><h2>Pixi</h2></section></div></main>';
  const style = document.createElement('style');
  style.textContent = '*{box-sizing:border-box}html,body{width:auto!important;min-width:0!important;height:auto!important;overflow:visible!important;margin:0;background:' + (theme === 'dark' ? '#151d21;color:#e7eee9' : '#ede7d7;color:#27362d') + ';font:14px system-ui}body{display:block!important}#proof{max-width:1100px;margin:auto;padding:12px}h1{font-size:22px}h2{font-size:16px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}canvas,img{display:block;max-width:100%;height:auto}#overview canvas{max-height:400px;width:auto;margin:0 auto}section{min-width:0}@media(max-width:768px),(pointer:coarse) and (max-width:1024px){.pair{grid-template-columns:1fr}#overview canvas{max-height:280px}}';
  document.head.append(style);
  const tiles = new Map(data.tiles), visibleTiles = new Set(tiles.keys());
  const overview = document.createElement('canvas'); overview.width = data.width * 12; overview.height = data.height * 12;
  const overviewContext = overview.getContext('2d'); document.getElementById('overview').append(overview);
  const drawOverview = () => {
    let drawn = 0;
    for (const [key, tile] of tiles) { const [x, y] = key.split(',').map(Number); if (runtimeImagePack.drawTile(overviewContext, tile, x * 12, y * 12, 12)) drawn++; }
    return drawn === data.tiles.length;
  };
  await waitUntil(drawOverview, '青霖澤整圖有地塊未載入圖片');
  overviewContext.strokeStyle = '#fdd964'; overviewContext.lineWidth = 2;
  overviewContext.strokeRect((point.x - 4) * 12, (point.y - 4) * 12, 9 * 12, 9 * 12);
  const width = innerWidth > 1024 ? 520 : Math.min(640, innerWidth - 24), height = 360;
  display.setZoom(1); display.updateDisplayMetrics(width, height, 4);
  const cell = display.getCellSize();
  const camera = { x: point.x * cell, y: point.y * cell, targetX: point.x * cell, targetY: point.y * cell, offsetX: 0, offsetY: 0 };
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; document.getElementById('canvas').append(canvas);
  const renderer = new TextRenderer(); renderer.init(canvas); renderer.updateEntities(data.entities);
  const drawCanvas = () => { renderer.renderWorld(camera, tiles, visibleTiles, 1, 0, 0, point.x, point.y, data.width, data.height, null); renderer.renderEntities(camera, 1, 'self', point.x, point.y, '我'); };
  const probe = document.createElement('canvas'); probe.width = probe.height = 96;
  await waitUntil(() => data.entities.every((entity) => runtimeImagePack.drawEntity(probe.getContext('2d'), entity, 0, 0, 96)), '採集或怪物圖片未接入 Canvas');
  drawCanvas();
  const host = document.createElement('div'), pixiCanvas = document.createElement('canvas');
  pixiCanvas.id = 'game-canvas'; pixiCanvas.width = width; pixiCanvas.height = height; host.append(pixiCanvas); document.getElementById('pixi').append(host);
  const adapter = new PixiMapRendererAdapter();
  try {
    adapter.mount(host); adapter.resize(width, height, width, height); adapter.syncDisplayMetrics();
    const scene = { mapMeta: null, player: { id: 'self', x: point.x, y: point.y, char: '我', mapId: 'foundation_qinglin_marsh' },
      terrain: { tileCache: tiles, visibleTiles, terrainChunkRevisions: new Map([['0,0', 1]]), visibleTileRevision: 1, visibleTileTransitionStartedAt: 0, visibleTileTransitionDurationMs: 0, time: null },
      entities: data.entities, groundPiles: new Map(), overlays: { pathCells: [], targeting: null, formationRange: null, senseQi: null, buildPreview: null, fengShui: null, threatArrows: [] } };
    const projection = new TopdownProjection();
    const render = () => { adapter.syncScene(scene, null); adapter.render(scene, camera, projection, 1); };
    await waitUntil(() => { render(); return data.entities.every((entity) => { const view = adapter.entities.get(entity.id); return view?.image.visible && !view.glyph.visible; }); }, '採集或怪物圖片未接入 Pixi');
    const visible = data.entities.filter((entity) => adapter.entities.get(entity.id).root.visible);
    expect(visible.length > 0, '場景中沒有可見實體');
    if (point.name === '蛟潭') expect(visible.some((entity) => entity.monsterId === 'm_qinglin_dragon_lord'), '蛟潭畫面看不到頭目');
    if (point.name === '北岸藥圃') expect(visible.some((entity) => entity.kind === 'container'), '藥圃畫面看不到採集點');
    const image = document.createElement('img'); image.src = pixiCanvas.toDataURL('image/png'); await image.decode(); host.replaceWith(image);
    expect(document.documentElement.scrollWidth <= innerWidth, '地圖證據頁橫向溢出');
    return { point, viewport: [innerWidth, innerHeight], cell, tiles: tiles.size, images: data.entities.length, visible: visible.map((entity) => entity.name), bgm };
  } finally { adapter.destroy(); host.remove(); }
}

const results = [];
await withClientBrowserProof({ viewport: { width: 1280, height: 900 }, profilePrefix: 'daojie-qinglin-map-' }, async (cdp) => {
  for (const mode of [
    { name: 'desktop', width: 1280, height: 900, point: { name: '蛟潭', x: 40, y: 24 } },
    { name: 'phone', width: 390, height: 844, point: { name: '北岸藥圃', x: 17, y: 8 } },
    { name: 'landscape', width: 844, height: 390, point: { name: '棧橋入口', x: 9, y: 24 } },
  ]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: mode.width, height: mode.height, deviceScaleFactor: 1, mobile: mode.name !== 'desktop' });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: mode.name !== 'desktop' });
    for (const theme of ['light', 'dark']) {
      results.push(await cdp.evaluate(`(${drawMap.toString()})(${JSON.stringify(data)},${JSON.stringify(mode.point)},${JSON.stringify(theme)})`));
      const height = await cdp.evaluate('Math.max(document.body.scrollHeight,document.documentElement.scrollHeight)');
      const image = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: mode.width, height, scale: 1 } });
      await fs.writeFile(path.join(dir, `${mode.name}-${theme}.png`), Buffer.from(image.data, 'base64'));
    }
  }
});
await fs.writeFile(path.join(dir, 'result.json'), JSON.stringify({ ok: true, results }, null, 2));
console.log('青霖澤正式地貌、採集點與頭目 Canvas/Pixi 六種視窗模式驗證通過');
