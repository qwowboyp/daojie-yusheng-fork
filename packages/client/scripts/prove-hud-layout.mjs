import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withClientBrowserProof, waitFor } from './browser-proof-runtime.mjs';

const VIEWPORT = { width: 1200, height: 800 };

await withClientBrowserProof({ viewport: VIEWPORT, profilePrefix: 'hud-layout-proof-' }, async (cdp) => {
  const result = await cdp.evaluate(`
    (async () => {
      const { bindDesktopWindow } = await import('/src/ui/desktop-window.ts');
      const storageKey = 'hud-layout-proof';
      localStorage.setItem('desktop-window:' + storageKey, JSON.stringify({ left: 9999, top: 9999, width: 999, height: 777 }));
      const hud = document.createElement('section');
      hud.id = 'hud-layout-proof';
      hud.style.cssText = 'position:fixed;left:12px;top:12px;width:300px;height:auto;min-height:0;padding:8px;border:1px solid #000;background:#fff;box-sizing:border-box;';
      hud.innerHTML = '<div class="hud-identity" style="height:32px">角色 LV30 (14, 22)</div><div class="hud-summary-details" style="display:none;height:160px">展開內容</div>';
      document.body.appendChild(hud);
      const controller = bindDesktopWindow(hud, { storageKey, handleSelector: '.hud-identity', minWidth: 260, minHeight: 140, resizable: false });
      const initial = hud.getBoundingClientRect();
      const details = hud.querySelector('.hud-summary-details');
      details.style.display = 'block';
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const expandedHeight = hud.getBoundingClientRect().height;
      details.style.display = 'none';
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const collapsedHeight = hud.getBoundingClientRect().height;
      const handle = hud.querySelector('.hud-identity');
      handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 41, clientX: 900, clientY: 700 }));
      hud.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 41, clientX: -500, clientY: -500 }));
      hud.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 41, clientX: -500, clientY: -500 }));
      const dragged = hud.getBoundingClientRect();
      const saved = JSON.parse(localStorage.getItem('desktop-window:' + storageKey) ?? '{}');
      const resizeGripCount = hud.querySelectorAll('.desktop-window-resize').length;
      controller.destroy();
      hud.remove();
      return {
        initial: { left: initial.left, top: initial.top, width: initial.width, height: initial.height },
        expandedHeight,
        collapsedHeight,
        dragged: { left: dragged.left, top: dragged.top },
        saved,
        resizeGripCount,
      };
    })()
  `);

  assert.equal(result.resizeGripCount, 0, '禁調整大小的 HUD 仍插入 resize grip');
  assert.equal(Math.round(result.initial.width), 300, `HUD 錯誤套用舊寬度：${result.initial.width}`);
  assert(result.initial.left <= VIEWPORT.width - result.initial.width - 8, `舊 HUD 位置未受右界夾制：${result.initial.left}`);
  assert(result.initial.top <= VIEWPORT.height - result.initial.height - 8, `舊 HUD 位置未受下界夾制：${result.initial.top}`);
  assert(result.expandedHeight > result.collapsedHeight, 'HUD 展收仍受既有高度鎖定');
  assert(result.dragged.left >= 8 && result.dragged.top >= 8, `HUD 拖動未受視口邊界夾制：${JSON.stringify(result.dragged)}`);
  assert.deepEqual(Object.keys(result.saved).sort(), ['left', 'top'], `禁調整大小 HUD 儲存了尺寸：${JSON.stringify(result.saved)}`);
});

// 正式 HUD：角色名與顯示圖示使用不同資料，避免同名 fixture 掩蓋欄位誤用。
await withClientBrowserProof({ viewport: VIEWPORT, profilePrefix: 'hud-identity-proof-' }, async (cdp) => {
  await cdp.evaluate(`(async () => {
    const { GUIDED_TOUR_FLOWS } = await import('/src/constants/ui/guided-tour.ts');
    localStorage.setItem('mud:guided-tour:v1', JSON.stringify({ completed: {}, dismissed: Object.fromEntries(GUIDED_TOUR_FLOWS.map(flow => [flow.id, flow.storageVersion])) }));
    location.reload(); return true;
  })()`);
  await waitFor(() => cdp.evaluate(`document.getElementById('game-shell')?.dataset.workspaceMode === 'true'`), '正式工作區初始化');
  await cdp.evaluate(`(async () => {
    const { HUD } = await import('/src/ui/hud.ts');
    const { createMainUiStateSource } = await import('/src/main-ui-state-source.ts');
    document.getElementById('game-shell').classList.remove('hidden');
    document.getElementById('login-overlay').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    const player = { id: 'hud-identity-proof', name: '清風道人', displayName: '仙',
      realmLv: 30, realm: { realmLv: 30, displayName: '半步築基', progress: 660, progressToNext: 1000 },
      x: 14, y: 22, hp: 68, maxHp: 100, qi: 6, numericStats: { maxQi: 40 },
      boneAgeBaseYears: 15, lifeElapsedTicks: 856800, lifespanYears: 900, techniques: [] };
    const hud = new HUD();
    const mapNameEl = document.querySelector('#map-map-name .map-map-name-text');
    const source = createMainUiStateSource({ hud: { update() {} }, getPlayer: () => player,
      mapRuntime: { getMapMeta: () => ({ name: '厚脈嶺', mapLv: 19 }) }, mapNameEl });
    const update = () => { source.refreshHudChrome(); hud.update(player, { titleLabel: '初登仙門' }); };
    window.__hudIdentityProof = { player, source, mapNameEl, update };
    update(); return true;
  })()`);
  for (const viewport of [VIEWPORT, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false });
    for (const theme of ['light', 'dark']) {
      await cdp.evaluate(`document.documentElement.dataset.colorMode = '${theme}'; window.__hudIdentityProof.update(); true`);
      await cdp.evaluate(`(() => { const toggle = document.querySelector('.hud-expand-toggle'); if (toggle.getAttribute('aria-expanded') !== 'true') toggle.click(); return true; })()`);
      await waitFor(() => cdp.evaluate(`document.getElementById('hud-age-lifespan')?.textContent === '15載119日/900載'`), '歲壽更新');
      const result = await cdp.evaluate(`(() => {
        const main = document.querySelector('.hud-realm-main');
        const map = document.querySelector('#map-map-name .map-map-name-text');
        const rect = map.getBoundingClientRect();
        return { name: document.querySelector('.hud-name-text').textContent,
          summary: main.textContent.replace(/\\s+/g, ' ').trim(), titleWeight: getComputedStyle(document.getElementById('hud-title')).fontWeight,
          hudHasCoordinates: Boolean(document.querySelector('#hud #hud-pos')),
          summaryClipped: main.scrollWidth > main.clientWidth + 1,
          map: map.textContent, mapClipped: map.scrollWidth > map.clientWidth + 1 || map.scrollHeight > map.clientHeight + 1,
          mapInBounds: rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= innerWidth,
          hasProfile: Boolean(document.getElementById('pane-profile') || document.getElementById('workspace-profile-content')) };
      })()`);
      assert.equal(result.name, '清風道人');
      assert.equal(result.summary, '半步築基 初登仙門 15載119日/900載');
      assert(Number(result.titleWeight) >= 700, '稱號應清楚加粗');
      assert.equal(result.hudHasCoordinates, false);
      assert.equal(result.hasProfile, false);
      assert.equal(result.summaryClipped, false, JSON.stringify({ viewport, theme, result }));
      assert.equal(result.map, '厚脈嶺 練氣一層 LV19 (14, 22)');
      assert.equal(result.mapClipped, false);
      assert.equal(result.mapInBounds, true);
      const moved = await cdp.evaluate(`(() => {
        const proof = window.__hudIdentityProof;
        proof.player.x = 26; proof.player.y = 31; proof.update();
        const result = { text: proof.mapNameEl.textContent, sameNode: proof.mapNameEl === document.querySelector('#map-map-name .map-map-name-text') };
        proof.player.x = 14; proof.player.y = 22; proof.update(); return result;
      })()`);
      assert.deepEqual(moved, { text: '厚脈嶺 練氣一層 LV19 (26, 31)', sameNode: true });
      if (process.env.WORKSPACE_PROOF_OUTPUT_DIR) {
        await mkdir(process.env.WORKSPACE_PROOF_OUTPUT_DIR, { recursive: true });
        const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
        await writeFile(path.join(process.env.WORKSPACE_PROOF_OUTPUT_DIR, `hud-identity-${viewport.width}-${theme}.png`), Buffer.from(screenshot.data, 'base64'));
      }
      // 手機沿用既有展開 HUD 時收起地圖標籤的規則；收合後確認座標實際可見。
      await cdp.evaluate(`document.querySelector('.hud-expand-toggle').click(); true`);
      await waitFor(() => cdp.evaluate(`getComputedStyle(document.querySelector('#map-map-name .map-map-name-text')).visibility === 'visible'`), '收合後地圖座標可見');
      if (process.env.WORKSPACE_PROOF_OUTPUT_DIR) {
        const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
        await writeFile(path.join(process.env.WORKSPACE_PROOF_OUTPUT_DIR, `hud-map-${viewport.width}-${theme}.png`), Buffer.from(screenshot.data, 'base64'));
      }
    }
  }
});
console.log('HUD identity/layout proof: PASS (role name, title order, live coordinates, desktop/portrait/landscape, light/dark)');
