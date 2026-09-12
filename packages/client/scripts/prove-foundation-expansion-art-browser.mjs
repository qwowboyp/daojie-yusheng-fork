/** 青霖澤正式圖片解碼、alpha、Canvas/Pixi monsterId 選圖及多端圖示驗證。 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withClientBrowserProof } from './browser-proof-runtime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = async (file) => JSON.parse(await fs.readFile(path.join(root, file), 'utf8'));
const itemArt = await read('docs/artwork/atlases/foundation-qinglin-items-01.json');
const monsterArt = await read('docs/artwork/atlases/foundation-qinglin-monsters-01.json');
const artifacts = path.join(root, 'packages/client/.codex/qinglin-art-proof');
await fs.mkdir(artifacts, { recursive: true });

async function runBrowser(items, monsters, theme) {
  const [{ runtimeImagePack }, { PixiMapRendererAdapter }, { TopdownProjection }, display, { getItemIconSources }] = await Promise.all([
    import('/src/renderer/runtime-image-pack.ts'), import('/src/game-map/renderer/pixi-map-renderer-adapter.ts'),
    import('/src/game-map/projection/topdown-projection.ts'), import('/src/display.ts'), import('/src/content/item-art.ts'),
  ]);
  const expect = (condition, message) => { if (!condition) throw new Error(message); };
  const waitUntil = async (predicate, message) => {
    const until = performance.now() + 12000;
    while (!predicate()) { if (performance.now() > until) throw new Error(message); await new Promise((resolve) => setTimeout(resolve, 60)); }
  };
  const decoded = [];
  for (const record of [...items, ...monsters]) for (const output of record.outputs) {
    const img = new Image(); img.src = '/' + output.path; await img.decode();
    expect(img.naturalWidth === output.size && img.naturalHeight === output.size, record.id + ' 尺寸錯誤');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = output.size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, output.size, output.size).data;
    let transparent = 0, opaque = 0, edgeOpaque = 0;
    for (let y = 0; y < output.size; y++) for (let x = 0; x < output.size; x++) {
      const alpha = pixels[(y * output.size + x) * 4 + 3];
      if (alpha === 0) transparent++;
      if (alpha > 200) opaque++;
      if ((x < 2 || y < 2 || x >= output.size - 2 || y >= output.size - 2) && alpha > 0) edgeOpaque++;
    }
    expect(transparent > output.size ** 2 * .3 && opaque > output.size ** 2 * .04 && edgeOpaque === 0, record.id + ' 透明度或邊緣裁切不合格');
    decoded.push({ id: record.id, size: output.size, transparent, edgeOpaque });
  }
  document.body.innerHTML = '<main id="proof"><h1>青霖澤美術驗證</h1><section id="items"></section><h2>Canvas 正式怪物圖包</h2><section id="canvas"></section><h2>Pixi 正式怪物圖包</h2><section id="pixi"></section></main>';
  const style = document.createElement('style');
  style.textContent = '*{box-sizing:border-box}html,body{min-width:0!important;width:auto!important;height:auto!important;overflow:visible!important;margin:0;padding:0;font:14px system-ui;background:' + (theme === 'light' ? '#f2eadb;color:#302919' : '#191e22;color:#e6eee7') + '}body{display:block!important}#proof{max-width:850px;margin:auto;padding:12px}h1{font-size:22px}h2{font-size:16px}#items{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:8px}figure{margin:0;text-align:center;min-width:0}figure img{width:48px;height:48px;object-fit:contain}figcaption{font-size:11px}section>canvas,section>img{display:block;max-width:100%;height:auto}#items+*{margin-top:20px}@media(max-width:768px),(pointer:coarse) and (max-width:1024px){#items{grid-template-columns:repeat(4,minmax(0,1fr))}figure img{width:40px;height:40px}}';
  document.head.append(style);
  for (const item of items) {
    expect(Boolean(getItemIconSources(item.id)), item.id + ' 缺少正式道具映射');
    const figure = document.createElement('figure');
    const img = document.createElement('img'); img.src = '/' + item.outputs[0].path; img.srcset = '/' + item.outputs[1].path + ' 2x';
    img.alt = item.name; const label = document.createElement('figcaption'); label.textContent = item.name;
    figure.append(img, label); document.getElementById('items').append(figure); await img.decode();
  }
  const width = Math.min(640, innerWidth - 24), height = 260;
  display.setZoom(1); display.updateDisplayMetrics(width, height, 4);
  const cell = display.getCellSize();
  const entities = monsters.map((record, index) => ({ id: 'proof:' + record.id, monsterId: record.id, kind: 'monster', char: '妖',
    color: '#6bb79a', name: record.name, wx: index % 3 * 2, wy: Math.floor(index / 3) * 2, facing: 'right', hp: 100, maxHp: 100 }));
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d'); document.getElementById('canvas').append(canvas);
  const renderCanvas = () => {
    ctx.clearRect(0, 0, width, height);
    return entities.every((entity, index) => runtimeImagePack.drawEntity(ctx, entity, index % 3 * width / 3, Math.floor(index / 3) * 120, 96));
  };
  await waitUntil(renderCanvas, 'Canvas 未載入六隻 monsterId 專屬圖片');
  const host = document.createElement('div'); const pixiCanvas = document.createElement('canvas');
  pixiCanvas.id = 'game-canvas'; pixiCanvas.width = width; pixiCanvas.height = height; host.append(pixiCanvas); document.getElementById('pixi').append(host);
  const adapter = new PixiMapRendererAdapter();
  try {
    adapter.mount(host); adapter.resize(width, height, width, height); adapter.syncDisplayMetrics();
    const tileCache = new Map(), visibleTiles = new Set();
    for (let y = -3; y <= 5; y++) for (let x = -4; x <= 8; x++) {
      const key = x + ',' + y; visibleTiles.add(key);
      tileCache.set(key, { type: 'grass', terrainType: 'grass', walkable: true });
    }
    const scene = { mapMeta: null, player: { id: 'self', x: 2, y: 1, char: '我', mapId: 'proof' },
      terrain: { tileCache, visibleTiles, terrainChunkRevisions: new Map([['0,0', 1]]), visibleTileRevision: 1,
        visibleTileTransitionStartedAt: 0, visibleTileTransitionDurationMs: 0, time: null }, entities, groundPiles: new Map(),
      overlays: { pathCells: [], targeting: null, formationRange: null, senseQi: null, buildPreview: null, fengShui: null, threatArrows: [] } };
    const camera = { x: 2 * cell, y: cell, targetX: 2 * cell, targetY: cell, offsetX: 0, offsetY: 0 };
    const projection = new TopdownProjection();
    const render = () => { adapter.syncScene(scene, null); adapter.render(scene, camera, projection, 1); };
    await waitUntil(() => {
      render();
      return entities.every((entity) => { const view = adapter.entities.get(entity.id); return view?.image.visible && !view.glyph.visible; });
    }, 'Pixi 未顯示六隻 monsterId 專屬圖片');
    const sprites = entities.map((entity) => {
      const view = adapter.entities.get(entity.id); const texture = view.image.texture;
      const label = String(texture.label ?? texture.source?.label ?? texture.source?.resource?.url ?? '');
      expect(label.includes(entity.monsterId), entity.monsterId + ' Pixi 使用了錯誤圖片');
      return { id: entity.monsterId, label, image: view.image.visible, glyph: view.glyph.visible };
    });
    const snapshot = document.createElement('img'); snapshot.src = pixiCanvas.toDataURL('image/png'); await snapshot.decode();
    document.getElementById('pixi').replaceChildren(snapshot);
    expect(document.documentElement.scrollWidth <= innerWidth, '畫面橫向溢出');
    return { decoded, canvasCount: entities.length, sprites, theme, viewport: [innerWidth, innerHeight] };
  } finally { adapter.destroy(); host.remove(); }
}

const results = [];
await withClientBrowserProof({ viewport: { width: 1280, height: 900 }, profilePrefix: 'daojie-qinglin-art-' }, async (cdp) => {
  for (const [name, width, height] of [['desktop', 1280, 900], ['phone', 390, 844], ['landscape', 844, 390]]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: name !== 'desktop' });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: name !== 'desktop' });
    for (const theme of ['light', 'dark']) {
      const result = await cdp.evaluate(`(${runBrowser.toString()})(${JSON.stringify(itemArt.records)},${JSON.stringify(monsterArt.records)},${JSON.stringify(theme)})`);
      assert.equal(result.decoded.length, 38);
      assert.equal(result.sprites.length, 6);
      results.push(result);
      const pageHeight = await cdp.evaluate('Math.max(document.body.scrollHeight,document.documentElement.scrollHeight)');
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: pageHeight, scale: 1 } });
      await fs.writeFile(path.join(artifacts, `${name}-${theme}.png`), Buffer.from(shot.data, 'base64'));
    }
  }
});
await fs.writeFile(path.join(artifacts, 'result.json'), JSON.stringify({ ok: true, results }, null, 2));
console.log('青霖澤 38 張圖片、Canvas/Pixi 專屬怪物、桌面/手機/橫向深淺模式通過');
