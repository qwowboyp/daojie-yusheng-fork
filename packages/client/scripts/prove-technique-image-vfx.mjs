/** 功法圖片特效的真實瀏覽器 proof：Canvas 與 Pixi 必須共用圖集、pose 與生命週期邊界。 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitFor, withClientBrowserProof } from './browser-proof-runtime.mjs';

const MARKER = 'REPAIR_PROOF:TECHNIQUE_IMAGE_VFX:PASS';
const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactDir = process.env.VFX_PROOF_ARTIFACT_DIR
  ? path.resolve(process.env.VFX_PROOF_ARTIFACT_DIR)
  : path.join(clientRoot, '.codex', 'vfx-proof');
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

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
  const layout = await cdp.evaluate(`({ width: innerWidth, height: document.documentElement.scrollHeight, overflow: document.documentElement.scrollWidth > innerWidth })`);
  assert.equal(layout.overflow, false, `${name} 不可橫向溢出`);
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: layout.width, height: layout.height, scale: 1 },
  });
  await writeFile(path.join(artifactDir, name), Buffer.from(result.data, 'base64'));
}

const runProofExpression = (vitePixiUrl) => `
  (async () => {
    const spriteSheet = await import('/src/renderer/cast-burst-sprite-sheet.ts');
    const particles = await import('/src/renderer/cast-burst-particles.ts');
    const canvasModule = await import('/src/renderer/canvas-combat-effect-runtime.ts');
    const display = await import('/src/display.ts');
    const pixiBurst = await import('/src/game-map/renderer/pixi-cast-burst.ts');
    const pixiRuntimeModule = await import('/src/game-map/renderer/pixi-combat-effect-runtime.ts');
    // 與正式 renderer 同一個 Vite 預綁定 URL，不能另載一份 Pixi（會重複註冊 extension）。
    const pixi = await import('${vitePixiUrl}');
    const variants = ['single', 'aoe', 'line', 'heal', 'buff_self', 'buff_debuff', 'tile', 'vortex', 'chain', 'barrage'];
    const now = performance.now();
    const effectFor = (variant, tier, ordinal = 0) => ({
      type: 'cast_burst', variant, tier, x: -3 + ordinal, y: -1, toX: 3 + ordinal, toY: variant === 'line' ? 2 : -1,
      damageKind: 'spell', element: 'fire',
    });
    const pose = () => ({ frame: 0, accentFrame: 10, x: 0, y: 0, rotation: 0, width: 0, height: 0, alpha: 0, accentWidth: 0, accentHeight: 0, accentAlpha: 0, accentRotation: 0 });
    const forms = variants.map((variant, index) => {
      const burst = particles.createCastBurstEffect(effectFor(variant, undefined, index), now);
      const nextPose = pose();
      const aliveAtZero = particles.resolveCastBurstSpritePose(burst, now, 64, nextPose);
      const aliveAtMiddle = particles.resolveCastBurstSpritePose(burst, now + burst.duration * 0.5, 64, nextPose);
      const expiredAtBoundary = particles.resolveCastBurstSpritePose(burst, now + burst.duration, 64, nextPose);
      return { variant, frame: nextPose.frame, aliveAtZero, aliveAtMiddle, expiredAtBoundary, pose: nextPose };
    });
    const divine = particles.createCastBurstEffect(effectFor('line', 'divine'), now);
    const secret = particles.createCastBurstEffect(effectFor('vortex', 'secret'), now);
    const line = particles.createCastBurstEffect(effectFor('line'), now);
    const chain = particles.createCastBurstEffect(effectFor('chain'), now);
    const linePose = pose(); const chainPose = pose();
    particles.resolveCastBurstSpritePose(line, now + line.duration * 0.5, 64, linePose);
    particles.resolveCastBurstSpritePose(chain, now + chain.duration * 0.5, 64, chainPose);

    // 在 Image request 層注入一次失敗，驗證五秒退避期間不會逐幀重請。
    const retrySheet = await import('/src/renderer/cast-burst-sprite-sheet.ts?vfx-retry-proof');
    const srcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    let blockRequest = true; let requestCount = 0;
    Object.defineProperty(HTMLImageElement.prototype, 'src', { configurable: true, get: srcDescriptor.get, set(value) {
      if (blockRequest && String(value).includes('technique-cast-v1.webp')) { requestCount += 1; queueMicrotask(() => this.onerror?.(new Event('error'))); return; }
      requestCount += String(value).includes('technique-cast-v1.webp') ? 1 : 0;
      return srcDescriptor.set.call(this, value);
    } });
    const retry = { firstRejected: false, noRetryDuringBackoff: false, secondLoaded: false };
    try {
      try { await retrySheet.loadCastBurstSpriteSheet(); } catch { retry.firstRejected = true; }
      try { await retrySheet.loadCastBurstSpriteSheet(); } catch { /* 同一被拒絕 promise 屬預期退避。 */ }
      retry.noRetryDuringBackoff = requestCount === 1;
      await new Promise((resolve) => setTimeout(resolve, retrySheet.CAST_BURST_RETRY_DELAY_MS + 80));
      blockRequest = false;
      const retryImage = await retrySheet.loadCastBurstSpriteSheet();
      retry.secondLoaded = retryImage.naturalWidth === 1536 && retryImage.naturalHeight === 1024;
    } finally { Object.defineProperty(HTMLImageElement.prototype, 'src', srcDescriptor); }
    const image = await spriteSheet.loadCastBurstSpriteSheet();

    // 以正式 display API 初始化；隔離的測試文件不會被登入頁隱藏地圖重設成 1px。
    display.setZoom(1);
    display.updateDisplayMetrics(384, 384, 7);
    const cellSize = display.getCellSize();
    if (cellSize < 16) throw new Error('測試地圖 cellSize 不可退化成單像素');
    const camera = { x: cellSize * 0.5, y: cellSize * 0.5, offsetX: 0, offsetY: 0 };
    const realNow = performance.now.bind(performance);
    const atTime = (time, action) => {
      const previous = Object.getOwnPropertyDescriptor(performance, 'now');
      Object.defineProperty(performance, 'now', { configurable: true, value: () => time });
      try { return action(); } finally {
        if (previous) Object.defineProperty(performance, 'now', previous);
        else delete performance.now;
      }
    };
    // 在任何 Canvas 著色幀暖機前，觀測正式 runtime 同幀 32 burst 的首次成本。
    const coldRuntime = new canvasModule.CanvasCombatEffectRuntime();
    const coldCanvas = document.createElement('canvas'); coldCanvas.width = 160; coldCanvas.height = 160;
    for (let index = 0; index < 32; index += 1) {
      coldRuntime.addCastBurst({ ...effectFor(variants[index % variants.length], index > 23 ? (index % 2 ? 'divine' : 'secret') : undefined), x: 0, y: 0, toX: 0, toY: 0 });
    }
    const coldFrameAt = realNow();
    for (const burst of coldRuntime.castBursts) burst.createdAt = coldFrameAt - burst.duration * 0.45;
    const coldStarted = realNow();
    atTime(coldFrameAt, () => coldRuntime.renderCastBursts(coldCanvas.getContext('2d'), camera));
    const coldCanvas32Ms = realNow() - coldStarted;
    const coldCanvas32Count = coldRuntime.castBursts.length;
    coldRuntime.reset();

    const white = spriteSheet.getTintedCastBurstFrame(0, '#ffffff');
    const tinted = spriteSheet.getTintedCastBurstFrame(0, '#e85d2a');
    if (!white || !tinted) throw new Error('圖集載入完成後必須可取得 Canvas 切圖');
    const tintCanvas = document.createElement('canvas'); tintCanvas.width = 384; tintCanvas.height = 341;
    const tintContext = tintCanvas.getContext('2d');
    tintContext.drawImage(tinted, 0, 0);
    const whiteCanvas = document.createElement('canvas'); whiteCanvas.width = 384; whiteCanvas.height = 341;
    const whiteContext = whiteCanvas.getContext('2d'); whiteContext.drawImage(white, 0, 0);
    const tintPixels = tintContext.getImageData(0, 0, 384, 341).data;
    const whitePixels = whiteContext.getImageData(0, 0, 384, 341).data;
    let exactFrameRects = true; let noNeighborBleed = true;
    for (let frame = 0; frame < particles.CAST_BURST_FRAME_COUNT; frame += 1) {
      const rect = spriteSheet.getCastBurstFrameRect(frame);
      exactFrameRects &&= rect.width === 384 && rect.x === (frame % 4) * 384
        && rect.y >= 0 && rect.y + rect.height <= 1024;
      const cropped = document.createElement('canvas'); cropped.width = rect.width; cropped.height = rect.height;
      const cropContext = cropped.getContext('2d'); cropContext.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
      const frameCanvas = spriteSheet.getTintedCastBurstFrame(frame, '#ffffff');
      if (!frameCanvas) throw new Error('每個圖集格都必須可切出 Canvas 著色幀');
      const cropAlpha = cropContext.getImageData(0, 0, rect.width, rect.height).data;
      const frameAlpha = frameCanvas.getContext('2d').getImageData(0, 0, rect.width, rect.height).data;
      for (let offset = 3; offset < cropAlpha.length; offset += 4) {
        if (cropAlpha[offset] !== frameAlpha[offset]) { noNeighborBleed = false; break; }
      }
    }
    let coloredPixels = 0; let luminanceSamples = 0; let preservesLuminance = true; let lowBrightness = false; let highBrightness = false;
    for (let offset = 0; offset < tintPixels.length; offset += 4) {
      if (tintPixels[offset + 3] < 180 || whitePixels[offset + 3] < 180) continue;
      coloredPixels += 1;
      const whiteSpread = Math.max(whitePixels[offset], whitePixels[offset + 1], whitePixels[offset + 2]) - Math.min(whitePixels[offset], whitePixels[offset + 1], whitePixels[offset + 2]);
      const whiteLuminance = (whitePixels[offset] + whitePixels[offset + 1] + whitePixels[offset + 2]) / 3;
      const tintedLuminance = 0.2126 * tintPixels[offset] + 0.7152 * tintPixels[offset + 1] + 0.0722 * tintPixels[offset + 2];
      if (whiteSpread < 5 && whiteLuminance > 16) {
        luminanceSamples += 1;
        if (whiteLuminance < 80) lowBrightness = true;
        if (whiteLuminance > 160) highBrightness = true;
        const expected = [whitePixels[offset] * 232 / 255, whitePixels[offset + 1] * 93 / 255, whitePixels[offset + 2] * 42 / 255];
        if (Math.abs(tintPixels[offset] - expected[0]) > 3 || Math.abs(tintPixels[offset + 1] - expected[1]) > 3 || Math.abs(tintPixels[offset + 2] - expected[2]) > 3 || tintedLuminance < whiteLuminance * 0.05) preservesLuminance = false;
      }
    }

    const app = new pixi.Application();
    await app.init({ width: 160, height: 160, backgroundAlpha: 0, antialias: true, autoStart: false });
    try {
    const layer = new pixi.Container(); app.stage.addChild(layer);
    const pixiBurstEntry = pixiBurst.createPixiCastBurstEffect(effectFor('line', 'divine'), now, layer);
    const pixiLoaded = await (async () => {
      const deadline = realNow() + 10_000;
      while (realNow() < deadline) {
        pixiBurst.updatePixiCastBurstEffect(pixiBurstEntry, now + pixiBurstEntry.duration * 0.45, cellSize);
        if (pixiBurstEntry.primary.texture.label?.startsWith('technique-cast:')) return true;
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      return false;
    })();
    const pixiTint = pixiBurstEntry.primary.tint;
    const pixiAccentTint = pixiBurstEntry.accent.tint;
    const sharedSource = pixiBurstEntry.primary.texture.source;
    pixiBurst.destroyPixiCastBurstEffect(pixiBurstEntry);
    const reusable = pixiBurst.createPixiCastBurstEffect(effectFor('chain', 'secret'), now, layer);
    pixiBurst.updatePixiCastBurstEffect(reusable, now + reusable.duration * 0.45, cellSize);
    const textureReused = reusable.primary.texture.source === sharedSource && !sharedSource.destroyed;
    pixiBurst.destroyPixiCastBurstEffect(reusable);

    const pixiRuntime = new pixiRuntimeModule.PixiCombatEffectRuntime(layer);
    let pixiAtZero; let pixiAfterZeroUpdate;
    atTime(now, () => {
      for (let index = 0; index < 33; index += 1) pixiRuntime.enqueue(effectFor('single', undefined, index));
      pixiAtZero = pixiRuntime.castBurstCount;
      pixiRuntime.update();
      pixiAfterZeroUpdate = pixiRuntime.castBurstCount;
    });
    pixiRuntime.reset();
    const pixiReset = pixiRuntime.castBurstCount;

    const canvasRuntime = new canvasModule.CanvasCombatEffectRuntime();
    const lifecycleCanvas = document.createElement('canvas'); lifecycleCanvas.width = 160; lifecycleCanvas.height = 160;
    let canvasAtZero; let canvasAfterZeroRender;
    atTime(now, () => {
      for (const variant of variants) canvasRuntime.addCastBurst(effectFor(variant));
      canvasAtZero = canvasRuntime.castBursts.length;
      canvasRuntime.renderCastBursts(lifecycleCanvas.getContext('2d'), camera);
      canvasAfterZeroRender = canvasRuntime.castBursts.length;
    });
    for (let index = 0; index < 33; index += 1) canvasRuntime.addCastBurst(effectFor('aoe', undefined, index));
    const canvasCapped = canvasRuntime.castBursts.length;
    canvasRuntime.reset();
    const canvasReset = canvasRuntime.castBursts.length;

    // 只分析透明特效圖層，背景由 CSS 提供，避免把不透明背景誤當成渲染成功。
    const coverage = (pixels, width, height) => {
      let count = 0; let minX = width; let minY = height; let maxX = -1; let maxY = -1;
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
        if (pixels[(y * width + x) * 4 + 3] <= 10) continue;
        count += 1; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      return { count, ratio: count / (width * height), width: maxX - minX + 1, height: maxY - minY + 1,
        unclipped: minX > 0 && minY > 0 && maxX < width - 1 && maxY < height - 1 };
    };
    const style = document.createElement('style');
    style.textContent = ':root{color-scheme:light;--page:#edf1f5;--surface:#f8fafc;--ink:#172538;--line:#a5b3c4}body[data-theme="dark"]{color-scheme:dark;--page:#101b2b;--surface:#17253a;--ink:#edf4ff;--line:#586980}*{box-sizing:border-box}body{margin:0;background:var(--page);color:var(--ink);font:15px/1.5 sans-serif}main{max-width:1104px;margin:auto;padding:16px}h1{font-size:22px;margin:0 0 4px}p{margin:0 0 16px}.grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}.card{border:1px solid var(--line);background:var(--surface);border-radius:6px;padding:4px;display:grid;justify-items:center;gap:4px}.card h2{font-size:14px;margin:0}.card canvas{display:block;width:160px;height:160px}.card small{font-size:12px;color:var(--ink)}@media(max-width:700px){main{padding:12px}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}h1{font-size:20px}}';
    document.head.append(style);
    const host = document.createElement('main'); host.id = 'technique-image-vfx-proof';
    const title = document.createElement('h1'); title.textContent = '功法施放圖片特效';
    const subtitle = document.createElement('p'); subtitle.textContent = '十種形態＋神通、秘法｜正式色票與 45% 動畫幀｜每格 ' + cellSize + 'px';
    const grid = document.createElement('div'); grid.className = 'grid';
    const labels = ['單體', '範圍', '直線', '治療', '自身增益', '減益', '地面', '漩渦', '連鎖', '彈幕', '神通・直線', '秘法・漩渦'];
    const cases = [...variants.map((variant) => ({ variant })), { variant: 'line', tier: 'divine' }, { variant: 'vortex', tier: 'secret' }];
    const renderCoverage = [];
    for (let index = 0; index < cases.length; index += 1) {
      const { variant, tier } = cases[index];
      const directed = variant === 'line' || variant === 'chain' || variant === 'barrage';
      const visual = { ...effectFor(variant, tier), x: directed ? -1 : 0, y: 0, toX: directed ? 1 : 0, toY: 0 };
      const burst = particles.createCastBurstEffect(visual, now);
      const frameAt = now + burst.duration * 0.45;
      const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 160;
      const context = canvas.getContext('2d');
      const runtime = new canvasModule.CanvasCombatEffectRuntime();
      atTime(now, () => runtime.addCastBurst(visual));
      atTime(frameAt, () => runtime.renderCastBursts(context, camera));
      const canvasCoverage = coverage(context.getImageData(0, 0, 160, 160).data, 160, 160);
      runtime.reset();

      layer.position.set(80 - camera.x, 80 - camera.y);
      const entry = pixiBurst.createPixiCastBurstEffect(visual, now, layer);
      pixiBurst.updatePixiCastBurstEffect(entry, frameAt, cellSize);
      app.renderer.render({ container: app.stage });
      // 同步複製實際 WebGL 畫布；raw extract 的預乘 alpha RGB 不能直接 putImageData。
      const pixiCanvas = document.createElement('canvas'); pixiCanvas.width = 160; pixiCanvas.height = 160;
      const pixiContext = pixiCanvas.getContext('2d'); pixiContext.drawImage(app.canvas, 0, 0);
      const pixiCoverage = coverage(pixiContext.getImageData(0, 0, 160, 160).data, 160, 160);
      // 明確指定畫布 frame，extract 不再隨 stage bounds 裁切；複製後才銷毀 Sprite。
      const extracted = await app.renderer.extract.pixels({ target: app.stage, frame: new pixi.Rectangle(0, 0, 160, 160) });
      if (extracted.width !== 160 || extracted.height !== 160) throw new Error('Pixi extract 尺寸與顯示畫布不同');
      const extractedCoverage = coverage(extracted.pixels, extracted.width, extracted.height);
      if (Math.abs(extractedCoverage.count - pixiCoverage.count) > 100) throw new Error('Pixi 擷取與畫布的 alpha 覆蓋不一致');
      renderCoverage.push({ variant, tier, color: burst.color, canvas: canvasCoverage, pixi: pixiCoverage });
      pixiBurst.destroyPixiCastBurstEffect(entry);

      const card = document.createElement('section'); card.className = 'card';
      const label = document.createElement('h2'); label.textContent = labels[index];
      const canvasLabel = document.createElement('small'); canvasLabel.textContent = 'Canvas 2D';
      const pixiLabel = document.createElement('small'); pixiLabel.textContent = 'Pixi Sprite';
      card.append(label, canvasLabel, canvas, pixiLabel, pixiCanvas); grid.append(card);
    }
    host.append(title, subtitle, grid); document.body.append(host);

    return {
      forms, divineDuration: divine.duration, secretDuration: secret.duration, baseDuration: particles.CAST_BURST_DURATION_MS,
      linePose, chainPose, retry, coloredPixels, luminanceSamples, lowBrightness, highBrightness, preservesLuminance,
      exactFrameRects, noNeighborBleed,
      pixiLoaded, pixiTint, pixiAccentTint, textureReused, pixiAtZero, pixiAfterZeroUpdate, pixiReset,
      canvasAtZero, canvasAfterZeroRender, canvasCapped, canvasReset, cellSize, renderCoverage, coldCanvas32Ms, coldCanvas32Count,
    };
    } finally { app.destroy({ removeView: true }); }
  })()
`;

await withClientBrowserProof({ viewport: DESKTOP, profilePrefix: 'mud-technique-image-vfx-' }, async (cdp) => {
  // 在 harness 啟動 Vite 並完成頁面載入後才讀取本輪依賴版本，支援沒有舊快取的工作樹。
  const viteMetadata = JSON.parse(await readFile(path.join(clientRoot, 'node_modules/.vite/deps/_metadata.json'), 'utf8'));
  const vitePixiUrl = `/node_modules/.vite/deps/pixi__js.js?v=${viteMetadata.browserHash}`;
  // Blob 文件保留 Vite 同源模組載入能力，但不執行登入頁與其背景地圖 resize。
  const proofUrl = await cdp.evaluate(`URL.createObjectURL(new Blob(['<!doctype html><html><head><base href="' + location.origin + '/"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>'], { type: 'text/html' }))`);
  await cdp.send('Page.navigate', { url: proofUrl });
  await waitFor(() => cdp.evaluate(`document.readyState === 'complete' && location.protocol === 'blob:'`), '獨立特效驗收文件');
  const result = await cdp.evaluate(runProofExpression(vitePixiUrl));

  assert.equal(result.forms.length, 10, '十種施放形態必須都有圖片 pose');
  for (let index = 0; index < result.forms.length; index += 1) {
    const form = result.forms[index];
    assert.equal(form.frame, index, `${form.variant} 必須對應獨立圖集格`);
    assert.equal(form.aliveAtZero, true, `${form.variant} 在 t=0 即使 alpha 為 0 仍不可過期`);
    assert.equal(form.aliveAtMiddle, true, `${form.variant} 在時長中段不可過期`);
    assert.equal(form.expiredAtBoundary, false, `${form.variant} 在時長邊界必須過期`);
  }
  assert.equal(result.divineDuration, result.baseDuration * 1.6, '神通時長倍率錯誤');
  assert.equal(result.secretDuration, result.baseDuration * 1.6, '秘法時長倍率錯誤');
  assert(result.linePose.rotation > 0 && result.linePose.width > result.linePose.height, 'line 必須沿起終點方向拉伸');
  assert(result.chainPose.x > -2.5 * 64 && result.chainPose.x < 3.5 * 64, 'chain 中段位置必須位於起終點之間');
  assert.equal(result.retry.firstRejected, true, '圖集載入失敗必須可觀測');
  assert.equal(result.retry.noRetryDuringBackoff, true, '五秒退避內不得重複請求圖集');
  assert.equal(result.retry.secondLoaded, true, '圖集載入失敗後必須可重試');
  assert(result.coloredPixels > 0 && result.luminanceSamples > 0 && result.lowBrightness && result.highBrightness, '切圖必須保留至少兩種亮度的透明像素');
  assert.equal(result.exactFrameRects, true, '12 格圖集切圖矩形必須完整落在 1536x1024 素材內');
  assert.equal(result.noNeighborBleed, true, 'Canvas 切圖 alpha 必須與原圖同格一致，不得滲入相鄰格');
  assert.equal(result.preservesLuminance, true, 'Canvas 著色不得把灰階亮度壓成黑色');
  assert.equal(result.pixiLoaded, true, 'Pixi 必須取得共用圖集幀');
  assert.equal(result.pixiTint, 0xffe9a8, '神通 Pixi tint 必須與共用色票一致');
  assert.equal(result.pixiAccentTint, 0xfff8e1, '神通 Pixi accent tint 必須與共用色票一致');
  assert.equal(result.textureReused, true, '釋放事件 Sprite 不得銷毀共用圖集 Texture');
  assert(result.cellSize >= 16, '正式 display metrics 必須初始化');
  assert.equal(result.renderCoverage.length, 12, '十二組實際渲染必須全部驗收');
  console.log('Render coverage: ' + JSON.stringify(result.renderCoverage));
  for (const item of result.renderCoverage) for (const renderer of ['canvas', 'pixi']) {
    const pixels = item[renderer];
    const label = renderer + ':' + item.variant + ':' + (item.tier ?? 'base');
    assert(pixels.count >= 100 && pixels.ratio >= 0.004 && pixels.ratio < 0.6, label + ' 必須有足量透明圖層像素');
    assert(pixels.width >= 20 && pixels.height >= 12, label + ' 不可退化成 tiny 像素');
    assert.equal(pixels.unclipped, true, label + ' 不可碰到畫布邊緣而裁切');
  }
  assert.equal(result.coldCanvas32Count, 32, '冷快取首次 Canvas 繪製必須包含 32 個 burst');
  assert(Number.isFinite(result.coldCanvas32Ms) && result.coldCanvas32Ms >= 0, '冷快取成本必須可觀測');
  console.log('Canvas cold tint 32 bursts: ' + result.coldCanvas32Ms.toFixed(1) + 'ms; cellSize=' + result.cellSize);
  assert.equal(result.pixiAtZero, 32, 'Pixi 事件上限必須是 32');
  assert.equal(result.pixiAfterZeroUpdate, 32, 'Pixi t=0 update 不得移除有效事件');
  assert.equal(result.pixiReset, 0, 'Pixi 跨圖 reset 必須清空事件');
  assert.equal(result.canvasAtZero, 10, 'Canvas 十種形態必須全部入隊');
  assert.equal(result.canvasAfterZeroRender, 10, 'Canvas t=0 render 不得移除有效事件');
  assert.equal(result.canvasCapped, 32, 'Canvas 事件上限必須是 32');
  assert.equal(result.canvasReset, 0, 'Canvas 跨圖 reset 必須清空事件');

  await capture(cdp, 'desktop-light.png');
  await cdp.evaluate(`document.body.dataset.theme = 'dark'`);
  await capture(cdp, 'desktop-dark.png');
  await setViewport(cdp, PHONE);
  await capture(cdp, 'phone-dark.png');
  await cdp.evaluate(`document.body.dataset.theme = 'light'`);
  await capture(cdp, 'phone-light.png');
});

console.log(`${MARKER} screenshots=${artifactDir}`);
