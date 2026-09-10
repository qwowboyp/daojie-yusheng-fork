/** 共用文字參照與背包確認視窗的正式 Vite + Chrome 圖示驗收。 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { delay, withClientBrowserProof } from './browser-proof-runtime.mjs';

const outputDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.codex/item-reference-dialog-proof');
const modes = [
  { id: 'pc-light', width: 1280, height: 900, mobile: false, color: 'light' },
  { id: 'phone-dark', width: 375, height: 844, mobile: true, color: 'dark' },
];

const fixture = String.raw`
  (async () => {
    const [reactDom, { UiInlineReferenceText }, { renderInlineItemChip }, { renderOfflineGainReports }, { detailModalHost }, { InventoryItemActionDialogController }, { InventoryFormationDialogController }, { getLocalItemTemplate }] = await Promise.all([
      import('/node_modules/.vite/deps/react-dom_client.js'), import('/src/react-ui/primitives/UiInlineReferenceText.tsx'), import('/src/ui/item-inline-tooltip.ts'), import('/src/ui/offline-gain-render.ts'), import('/src/ui/detail-modal-host.ts'), import('/src/ui/panels/inventory-item-action-dialog.ts'), import('/src/ui/panels/inventory-formation-dialog.ts'), import('/src/content/local-templates.ts'),
    ]);
    const createRoot = reactDom.default.createRoot;
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const compact = matchMedia('(max-width: 768px), (pointer: coarse) and (max-width: 1024px)').matches;
    const checks = [];
    const check = async (image, expected, label) => { if (!(image instanceof HTMLImageElement)) throw new Error(label + ' 未產生正式圖片'); await image.decode(); image.scrollIntoView({ block: 'center' }); const box = image.getBoundingClientRect(); checks.push({ label, width: box.width, height: box.height, expected }); };
    document.getElementById('game-shell')?.classList.remove('hidden'); document.getElementById('login-overlay')?.classList.add('hidden');
    const template = getLocalItemTemplate('pill.minor_heal'); if (!template) throw new Error('缺少正式道具模板');
    const item = { ...template, itemId: 'pill.minor_heal', itemInstanceId: 'reference-proof-pill', count: 9 };
    const diskTemplate = getLocalItemTemplate('formation_disk.basic') ?? template;
    const disk = { ...diskTemplate, itemId: diskTemplate.itemId, itemInstanceId: 'reference-proof-disk', count: 1 };
    const reactHost = document.createElement('div'); reactHost.id = 'reference-react-host'; document.body.append(reactHost);
    createRoot(reactHost).render(React.createElement(UiInlineReferenceText, { text: '需要' + item.name, references: [{ kind: 'item', id: item.itemId, label: item.name }] }));
    const legacyHost = document.createElement('div'); legacyHost.id = 'reference-legacy-host'; legacyHost.innerHTML = renderInlineItemChip(item.itemId, { label: item.name, count: 2 }); document.body.append(legacyHost);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await check(reactHost.querySelector('img.item-art--inline'), compact ? 20 : 24, 'React inline'); await check(legacyHost.querySelector('img.item-art--inline'), compact ? 20 : 24, 'legacy inline');
    detailModalHost.open({ ownerId: 'offline-proof', title: '離線收益', renderBody: (body) => { body.innerHTML = renderOfflineGainReports([{ scope: 'offline', startedAt: Date.now() - 60000, endedAt: Date.now(), durationMs: 60000, spiritStones: { gained: 5, lost: 0 }, progress: [], techniques: [], professions: [], items: [{ itemId: item.itemId, itemName: item.name, gained: 2, lost: 0 }] }]); } });
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const offlineImage = document.querySelector('.offline-gain-modal img.item-art'); await check(offlineImage, compact ? 40 : 48, 'offline modal');
    detailModalHost.close('offline-proof');
    const events = [];
    const action = new InventoryItemActionDialogController({ ownerId: 'action-proof', getPlayerRealm: () => null, getPlayerHeavenGate: () => null, getPlayerFoundation: () => 0, getPlayerContextRevision: () => 1, isFormationDisk: () => false, getItemInstanceId: (entry) => entry.itemInstanceId, repairMissingItemInstanceIds() {}, useItem: (...args) => events.push(['use', ...args]), dropItem: (...args) => events.push(['drop', ...args]), destroyItem: (...args) => events.push(['destroy', ...args]), renderParentModal() {}, closeModal() {}, resetParentModalState() {} });
    action.open('drop', 'reference-proof-pill', 2); action.render(item);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const actionInput = document.querySelector('[data-inventory-action-count]'); if (!(actionInput instanceof HTMLInputElement)) throw new Error('drop 確認未產生正式數量輸入'); actionInput.focus(); actionInput.value = '3'; actionInput.dispatchEvent(new Event('input', { bubbles: true }));
    const actionImage = document.querySelector('#detail-modal-body img.item-art--detail'); await check(actionImage, compact ? 64 : 80, 'drop confirm');
    detailModalHost.close('action-proof');
    detailModalHost.open({ ownerId: 'formation-proof', title: '布置陣法', renderBody: (body) => { const formation = new InventoryFormationDialogController({ getInventory: () => ({ capacity: 30, revision: 1, items: [{ itemId: 'spirit_stone', itemInstanceId: 'proof-stone', count: 99999 }] }), getPlayerQi: () => 99999, getFormationSkillLevel: () => 10, resolveDiskMultiplier: () => 1, getItemInstanceId: (entry) => entry?.itemInstanceId ?? '', repairMissingItemInstanceIds() {}, previewRange() {} }); formation.renderBody(body, disk); const controller = new AbortController(); formation.bind(body, disk, controller.signal); } });
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const formationInput = document.querySelector('[data-formation-radius-input]'); if (!(formationInput instanceof HTMLInputElement)) throw new Error('陣法正式數量控制未產生'); formationInput.focus(); formationInput.value = '2'; formationInput.dispatchEvent(new Event('input', { bubbles: true }));
    const formationImage = document.querySelector('#detail-modal-body img.item-art--detail'); await check(formationImage, compact ? 64 : 80, 'formation dialog');
    return { ok: true, focus: document.activeElement === formationInput, events, checks };
  })()
`;

const inspect = String.raw`
  (async () => {
    document.querySelector('[data-guided-tour-skip]')?.click();
    const images = [...document.querySelectorAll('img.item-art')].filter((image) => image.getClientRects().length > 0);
    await Promise.all(images.map((image) => image.decode()));
    const compact = matchMedia('(max-width: 768px), (pointer: coarse) and (max-width: 1024px)').matches;
    const errors = images.flatMap((image) => {
      image.scrollIntoView({ block: 'center', inline: 'nearest' }); const box = image.getBoundingClientRect();
      const expected = image.classList.contains('item-art--detail') ? (compact ? 64 : 80) : image.classList.contains('item-art--inline') ? (compact ? 20 : 24) : (compact ? 40 : 48);
      if (Math.abs(box.width - expected) > 1 || Math.abs(box.height - expected) > 1) return [{ type: 'size', width: box.width, height: box.height, expected }];
      for (let parent = image.parentElement; parent && parent !== document.body; parent = parent.parentElement) { const style = getComputedStyle(parent); const rect = parent.getBoundingClientRect(); if (['hidden', 'clip'].includes(style.overflowY) && (box.top < rect.top - 1 || box.bottom > rect.bottom + 1)) return [{ type: 'clip', owner: parent.className }]; }
      return [];
    });
    return { count: images.length, errors, focus: document.activeElement?.matches('[data-formation-radius-input]') ?? false, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
  })()
`;

await mkdir(outputDir, { recursive: true });
await withClientBrowserProof({ viewport: { width: 1280, height: 900 }, profilePrefix: 'item-reference-dialogs-' }, async (cdp) => {
  const origin = await cdp.evaluate('location.origin');
  for (const mode of modes) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: mode.width, height: mode.height, deviceScaleFactor: 1, mobile: mode.mobile, screenWidth: mode.width, screenHeight: mode.height });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: mode.mobile ? 5 : 1, configuration: mode.mobile ? 'mobile' : 'desktop' });
    await cdp.send('Page.navigate', { url: origin }); await delay(300);
    await cdp.evaluate(`(async()=>{ const { updateUiColorMode }=await import('/src/ui/ui-style-config.ts'); updateUiColorMode(${JSON.stringify(mode.color)}); })()`);
    const fixtureResult = await cdp.evaluate(fixture); assert.equal(fixtureResult.ok, true); assert.equal(fixtureResult.focus, true); assert.deepEqual(fixtureResult.events, []); assert(fixtureResult.checks.every((entry) => Math.abs(entry.width - entry.expected) <= 1 && Math.abs(entry.height - entry.expected) <= 1), `${mode.id} 圖片尺寸錯誤`);
    const result = await cdp.evaluate(inspect); assert(result.count >= 1, `${mode.id} 最終正式視窗沒有圖`); assert.deepEqual(result.errors, [], `${mode.id} 尺寸或裁切`); assert.equal(result.focus, true); assert.equal(result.overflow, false);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true }); await writeFile(path.join(outputDir, `${mode.id}.png`), Buffer.from(shot.data, 'base64'));
  }
});
console.log(`ITEM_REFERENCE_DIALOG_PROOF:PASS dir=${outputDir}`);
