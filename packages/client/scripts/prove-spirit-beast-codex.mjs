/** 正式其他選單 → 圖鑑：無宗門資料，多端圖文、篩選與生命週期。 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withClientBrowserProof, waitFor } from './browser-proof-runtime.mjs';

const output = process.env.WORKSPACE_PROOF_OUTPUT_DIR;
await withClientBrowserProof({ viewport: { width: 1440, height: 900 }, profilePrefix: 'spirit-codex-' }, async (cdp) => {
  await cdp.evaluate(`(async () => {
    const { GUIDED_TOUR_FLOWS } = await import('/src/constants/ui/guided-tour.ts');
    localStorage.setItem('mud:guided-tour:v1', JSON.stringify({ completed: {}, dismissed: Object.fromEntries(GUIDED_TOUR_FLOWS.map(flow => [flow.id, flow.storageVersion])) }));
    location.reload(); return true;
  })()`);
  await waitFor(() => cdp.evaluate(`document.getElementById('game-shell')?.dataset.workspaceMode === 'true'`), '正式導覽');
  await cdp.evaluate(`document.getElementById('game-shell').classList.remove('hidden'); document.getElementById('login-overlay').classList.add('hidden'); true`);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: viewport.width !== 1440 });
    for (const theme of ['light', 'dark']) {
      await cdp.evaluate(`document.documentElement.dataset.colorMode = '${theme}'; document.getElementById('workspace-menu-toggle').click(); true`);
      assert.equal(await cdp.evaluate(`document.querySelectorAll('#workspace-menu [data-workspace-action="spirit-beast-codex"]').length`), 1);
      await cdp.evaluate(`document.querySelector('#workspace-menu [data-workspace-action="spirit-beast-codex"]').click(); true`);
      await waitFor(() => cdp.evaluate(`!document.getElementById('detail-modal').classList.contains('hidden') && document.querySelectorAll('[data-react-panel="spirit-beast-codex"] [data-species-id]').length === 150`), '圖鑑由正式選單開啟');
      assert.equal(await cdp.evaluate(`document.getElementById('workspace-menu').hidden`), true);
      const layout = await cdp.evaluate(`(() => {
        const panel = document.querySelector('[data-react-panel="spirit-beast-codex"]');
        const content = panel.querySelector('.spirit-beast-content');
        const card = document.getElementById('detail-modal-card').getBoundingClientRect();
        const articles = [...panel.querySelectorAll('[data-species-id]')];
        return { bounded: card.left >= -1 && card.right <= innerWidth + 1 && card.top >= -1 && card.bottom <= innerHeight + 1,
          noOverflow: content.scrollWidth <= content.clientWidth + 1, scrollable: content.scrollHeight > content.clientHeight,
          described: articles.every(a => a.querySelector('p') && a.textContent.includes('基礎戰鬥力') && a.querySelector('img').alt),
          controls: [...panel.querySelectorAll('input,select')].every(e => e.getBoundingClientRect().height >= 43.9) };
      })()`);
      assert(layout.bounded && layout.noOverflow && layout.scrollable && layout.described, JSON.stringify({ viewport, theme, layout }));
      if (viewport.width !== 1440) assert(layout.controls, '觸控操作區過小');
      await waitFor(() => cdp.evaluate(`document.querySelector('[data-species-id] img').naturalWidth > 0`), '靈獸圖片');
      if (output) {
        await mkdir(output, { recursive: true });
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
        await writeFile(path.join(output, `codex-${viewport.width}-${theme}.png`), Buffer.from(shot.data, 'base64'));
      }
      await cdp.evaluate(`(() => { const selects = document.querySelectorAll('.spirit-beast-codex-search select'); selects[0].value = 'immortal'; selects[0].dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
      await waitFor(() => cdp.evaluate(`document.querySelectorAll('[data-species-id]').length === 30`), '品級篩選');
      await cdp.evaluate(`(() => { const selects = document.querySelectorAll('.spirit-beast-codex-search select'); selects[1].value = 'fire'; selects[1].dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
      await waitFor(() => cdp.evaluate(`document.querySelectorAll('[data-species-id]').length === 6`), '五行篩選');
      await cdp.evaluate(`(() => { const selects = document.querySelectorAll('.spirit-beast-codex-search select'); selects[2].value = 'mining'; selects[2].dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
      await waitFor(() => cdp.evaluate(`!!document.querySelector('.spirit-beast-empty button')`), '無結果提示');
      await cdp.evaluate(`document.querySelector('.spirit-beast-empty button').click(); true`);
      await waitFor(() => cdp.evaluate(`document.querySelectorAll('[data-species-id]').length === 150`), '清除篩選');
      await cdp.evaluate(`(() => { const input = document.querySelector('.spirit-beast-codex input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '銀鬚尋鐵鼠'); input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
      await waitFor(() => cdp.evaluate(`document.querySelectorAll('[data-species-id]').length === 1 && document.querySelector('[data-species-id]').textContent.includes('銀鬚尋鐵鼠')`), '名稱搜尋');
      await cdp.evaluate(`(() => { const select = document.querySelector('.spirit-beast-parent-finder select'); select.value = [...select.options].find(o => o.text.includes('人品')).value; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
      await waitFor(() => cdp.evaluate(`document.querySelectorAll('.spirit-beast-parent-results li').length > 0`), '融合父母配方');
      await cdp.evaluate(`(async () => { const { detailModalHost } = await import('/src/ui/detail-modal-host.ts'); detailModalHost.close('spirit-beast-codex'); return true; })()`);
      assert.equal(await cdp.evaluate(`document.querySelectorAll('[data-react-panel="spirit-beast-codex"]').length`), 0, '關閉須卸載圖鑑');
    }
  }
  const artwork = await cdp.evaluate(`(async () => { const { SPIRIT_BEAST_CATALOG } = await import('/@fs/' + ${JSON.stringify(path.resolve('packages/shared/src/index.ts').replaceAll('\\', '/'))}); return Promise.all(SPIRIT_BEAST_CATALOG.map(async s => { const image = new Image(); image.src = '/assets/spirit-beasts/species/' + s.id + '-192.webp'; await image.decode(); return image.naturalWidth; })); })()`);
  assert.equal(artwork.length, 150);
  assert(artwork.every(width => width > 0));
});
console.log('spirit beast codex: PASS (150 images, 3 viewports × 2 themes, real navigation, filters, unmount)');
