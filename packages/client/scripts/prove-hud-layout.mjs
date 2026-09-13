import assert from 'node:assert/strict';
import { withClientBrowserProof } from './browser-proof-runtime.mjs';

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
