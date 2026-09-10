/** 已盤點次要道具入口的正式 Vite + Chrome 圖示驗收。 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { delay, withClientBrowserProof } from './browser-proof-runtime.mjs';

const ARTIFACT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.codex/secondary-item-icon-proof');
const MODES = [
  { id: 'pc-light', width: 1280, height: 900, mobile: false, colorMode: 'light' },
  { id: 'phone-375-dark', width: 375, height: 844, mobile: true, colorMode: 'dark' },
  { id: 'touch-landscape-dark', width: 844, height: 375, mobile: true, colorMode: 'dark' },
];

const setup = (react) => String.raw`
  (async () => {
    document.getElementById('login-overlay')?.classList.add('hidden');
    document.getElementById('game-shell')?.classList.remove('hidden');
    document.getElementById('hud')?.classList.remove('hidden');
    const { getLocalItemTemplate } = await import('/src/content/local-templates.ts');
    const item = (itemId, count, itemInstanceId, extra = {}) => ({ ...(getLocalItemTemplate(itemId) ?? {}), itemId, count, itemInstanceId, ...extra });
    const pill = item('pill.minor_heal', 7, 'proof-pill', { name: '小還丹', type: 'consumable', desc: '驗收道具' });
    const sword = item('equip.copper_building_hammer', 1, 'proof-sword', { name: '銅鑄造鎚', type: 'equipment', equipSlot: 'weapon', level: 3, grade: 'mortal' });
    const inventory = { capacity: 40, revision: 1, items: [pill, sword] };
    window.__secondaryIconProof = { item, pill, sword, inventory };
    return true;
  })()
`;

const openLegacy = String.raw`
  (async () => {
    const p = window.__secondaryIconProof;
    const [{ LootPanel }, { MailPanel }, { EquipmentPanel }, { NpcShopModal }, { InventoryBulkDiscardDialogController }] = await Promise.all([
      import('/src/ui/panels/loot-panel.ts'), import('/src/ui/mail-panel.ts'), import('/src/ui/panels/equipment-panel.ts'),
      import('/src/ui/npc-shop-modal.ts'), import('/src/ui/panels/inventory-bulk-discard-dialog.ts'),
    ]);
    const loot = new LootPanel();
    loot.update({ tileX: 1, tileY: 2, title: '戰利品', sources: [{ sourceId: 'proof-source', kind: 'ground', items: [{ itemKey: 'proof-pill', item: p.pill }] }] });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const lootImage = document.querySelector('.loot-shell .inventory-cell-name img.item-art--list');
    if (!(lootImage instanceof HTMLImageElement)) throw new Error('legacy loot 沒有正式圖片');

    const mailSocket = { sendRequestMailSummary() {}, sendRequestMailPage() {}, sendRequestMailDetail() {}, sendMarkMailRead() {}, sendClaimMailAttachments() {}, sendDeleteMail() {} };
    const mail = new MailPanel(mailSocket);
    mail.open();
    mail.updateSummary({ unreadCount: 1, claimableCount: 1, revision: 1 });
    // 正式 updatePage 的回包序號守衛已由 mail 專屬 proof 覆蓋；此處只提供已選詳情給圖示表面驗收。
    mail.selectedMailId = 'proof-mail';
    mail.updateDetail({ mailId: 'proof-mail', senderLabel: '系統', createdAt: Date.now(), args: [], fallbackTitle: '驗收郵件', fallbackBody: '附件', attachments: [{ itemId: p.pill.itemId, count: 7 }], read: true, claimed: false });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const mailImage = document.querySelector('.mail-attachment-item-name img.item-art--list');
    if (!(mailImage instanceof HTMLImageElement)) throw new Error('legacy mail 沒有正式圖片');

    const equipment = new EquipmentPanel();
    equipment.update({ weapon: p.sword, head: null, body: null, legs: null, accessory: null, technique_alchemy: null, technique_forging: null, technique_enhancement: null, technique_mining: null, technique_building: null }, { slots: [{ slot: 'artifact_1', unlocked: true, enabled: true, qi: 10, maxQi: 20, item: p.sword }] });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const equipImage = document.querySelector('#pane-equipment .equip-slot-item img.item-art--list');
    if (!(equipImage instanceof HTMLImageElement)) throw new Error('legacy equipment 沒有正式圖片: ' + document.querySelector('#pane-equipment')?.innerHTML.slice(0, 300));

    const npc = new NpcShopModal(); npc.setCallbacks({ onRequestShop() {}, onBuyItem() {} }); npc.open('proof-npc');
    npc.updateShop({ npcId: 'proof-npc', shop: { npcId: 'proof-npc', npcName: '驗收商人', currencyItemId: 'spirit_stone', currencyItemName: '靈石', items: [{ itemId: p.pill.itemId, item: p.pill, unitPrice: 5, remainingQuantity: 99 }] } });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const shopImage = document.querySelector('[data-npc-shop-list] img.item-art--list');
    if (!(shopImage instanceof HTMLImageElement)) throw new Error('legacy npc shop 沒有正式圖片');

    const discard = new InventoryBulkDiscardDialogController({ ownerId: 'proof-discard', getInventory: () => p.inventory, getItemInstanceId: (entry) => entry.itemInstanceId, dropItems() {}, closeModal() {}, resetParentModalState() {} });
    discard.open('all');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    document.querySelector('[data-bulk-discard-toggle]')?.click(); document.querySelector('[data-bulk-discard-next]')?.click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const discardImage = document.querySelector('.inventory-bulk-discard-list--confirm img.item-art--list');
    if (!(discardImage instanceof HTMLImageElement)) throw new Error('bulk discard 確認頁沒有正式圖片');
    return { legacy: true };
  })()
`;

const openReact = String.raw`
  (async () => {
    const p = window.__secondaryIconProof;
    const [{ LootPanel }, { MailPanel }, { EquipmentPanel }] = await Promise.all([
      import('/src/ui/panels/loot-panel.ts'), import('/src/ui/mail-panel.ts'), import('/src/ui/panels/equipment-panel.ts'),
    ]);
    const loot = new LootPanel(); loot.update({ tileX: 1, tileY: 2, title: 'React 戰利品', sources: [{ sourceId: 'react-source', kind: 'ground', items: [{ itemKey: 'proof-pill', item: p.pill }] }] });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (!(document.querySelector('[data-react-panel="loot"] .inventory-cell-name img.item-art') instanceof HTMLImageElement)) throw new Error('React loot 沒有正式圖片');
    const socket = { sendRequestMailSummary() {}, sendRequestMailPage() {}, sendRequestMailDetail() {}, sendMarkMailRead() {}, sendClaimMailAttachments() {}, sendDeleteMail() {} };
    const mail = new MailPanel(socket); mail.open();
    const { syncReactMailPanelState } = await import('/src/react-ui/panels/mail/mount-mail-panel.tsx');
    syncReactMailPanelState({ summary: { unreadCount: 1, claimableCount: 1, revision: 1 }, pageData: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1, filter: 'all' }, detail: { mailId: 'react-mail', senderLabel: '系統', createdAt: Date.now(), args: [], fallbackTitle: 'React 郵件', fallbackBody: '附件', attachments: [{ itemId: p.pill.itemId, count: 7 }], read: true, claimed: false }, statusMessage: '', selectedMailId: 'react-mail', selectedMailIds: [], attachmentPage: 1 });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (!(document.querySelector('[data-react-panel="mail"] .mail-attachment-item-name img.item-art') instanceof HTMLImageElement)) throw new Error('React mail 沒有正式圖片');
    const equipment = new EquipmentPanel(); equipment.update({ weapon: p.sword, head: null, body: null, legs: null, accessory: null, technique_alchemy: null, technique_forging: null, technique_enhancement: null, technique_mining: null, technique_building: null }, { slots: [{ slot: 'artifact_1', unlocked: true, enabled: true, qi: 10, maxQi: 20, item: p.sword }] });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (!(document.querySelector('#pane-equipment [data-react-panel="equipment"] img.item-art') instanceof HTMLImageElement)) throw new Error('React equipment 沒有正式圖片');
    return { react: true };
  })()
`;

const inspect = String.raw`
  (async () => {
    document.querySelector('[data-guided-tour-skip]')?.click();
    const images = [...document.querySelectorAll('img.item-art')].filter((image) => image.getClientRects().length > 0);
    await Promise.all(images.map((image) => image.decode()));
    const compact = matchMedia('(max-width: 768px), (pointer: coarse) and (max-width: 1024px)').matches;
    const bad = images.flatMap((image) => {
      image.scrollIntoView({ block: 'center', inline: 'nearest' });
      const box = image.getBoundingClientRect(); const expected = image.classList.contains('item-art--detail') ? (compact ? 64 : 80) : (compact ? 40 : 48);
      for (let node = image.parentElement; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node); const rect = node.getBoundingClientRect();
        if ((['hidden', 'clip'].includes(style.overflowX) && (box.left < rect.left - 1 || box.right > rect.right + 1)) || (['hidden', 'clip'].includes(style.overflowY) && (box.top < rect.top - 1 || box.bottom > rect.bottom + 1))) return [{ owner: node.className, width: box.width, height: box.height, expected }];
      }
      return Math.abs(box.width - expected) > 1 || Math.abs(box.height - expected) > 1 ? [{ owner: 'size', width: box.width, height: box.height, expected }] : [];
    });
    const input = document.querySelector('[data-npc-shop-quantity]');
    if (input instanceof HTMLInputElement) { input.focus(); input.value = '2'; input.dispatchEvent(new Event('input', { bubbles: true })); }
    const button = document.querySelector('[data-bulk-discard-back], [data-npc-shop-item]')
      ?? [...document.querySelectorAll('button')].find((candidate) => candidate.getClientRects().length > 0 && !candidate.disabled);
    if (button instanceof HTMLElement) { button.focus(); }
    return { count: images.length, bad, overflow: document.documentElement.scrollWidth > innerWidth + 1, focus: document.activeElement?.tagName ?? '' };
  })()
`;

async function capture(cdp, name) {
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  await writeFile(path.join(ARTIFACT_DIR, `${name}.png`), Buffer.from(result.data, 'base64'));
}

await mkdir(ARTIFACT_DIR, { recursive: true });
let screenshots = 0;
await withClientBrowserProof({ viewport: { width: 1280, height: 900 }, profilePrefix: 'secondary-item-icons-' }, async (cdp) => {
  const origin = await cdp.evaluate('location.origin');
  for (const mode of MODES) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: mode.width, height: mode.height, deviceScaleFactor: 1, mobile: mode.mobile, screenWidth: mode.width, screenHeight: mode.height });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: mode.mobile ? 5 : 1, configuration: mode.mobile ? 'mobile' : 'desktop' });
    for (const [label, opener] of [['legacy', openLegacy], ['react', openReact]]) {
      await cdp.send('Page.navigate', { url: `${origin}/${label === 'react' ? '?react-ui=1&react-panel=all' : ''}` });
      for (let attempt = 0; attempt < 80; attempt += 1) {
        if (await cdp.evaluate(`document.readyState === 'complete' && Boolean(document.getElementById('detail-modal-body'))`)) break;
        await delay(50);
      }
      await cdp.evaluate(setup(label === 'react'));
      await cdp.evaluate(`(async()=>{ const { updateUiColorMode }=await import('/src/ui/ui-style-config.ts'); updateUiColorMode(${JSON.stringify(mode.colorMode)}); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); })()`);
      assert.deepEqual(await cdp.evaluate(opener), { [label]: true }, `${mode.id}/${label} fixture 未完成`);
      const result = await cdp.evaluate(inspect);
      assert(result.count > 0, `${mode.id}/${label}沒有可見正式圖片`);
      assert.deepEqual(result.bad, [], `${mode.id}/${label}圖片尺寸或裁切：${JSON.stringify(result.bad)}`);
      assert.equal(result.overflow, false, `${mode.id}/${label}發生水平溢出`);
      assert.equal(result.focus, 'BUTTON', `${mode.id}/${label}重要按鈕焦點遺失`);
      await capture(cdp, `${mode.id}-${label}`); screenshots += 1;
      await delay(40);
    }
  }
});
console.log(`SECONDARY_ITEM_ICON_PROOF:PASS screenshots=${screenshots} dir=${ARTIFACT_DIR}`);
