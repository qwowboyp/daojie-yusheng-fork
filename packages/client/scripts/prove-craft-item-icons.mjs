/**
 * 煉丹、煉器與強化的正式 Vite + Chrome 道具圖片驗收。
 * fixture 僅注入服務端同步形狀；DOM、互動與增量 patch 全走 CraftWorkbenchModal。
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { delay, withClientBrowserProof } from './browser-proof-runtime.mjs';

const ARTIFACT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.codex/craft-item-icon-proof');
const MODES = [
  { id: 'desktop-light', width: 1280, height: 900, mobile: false, colorMode: 'light' },
  { id: 'desktop-dark', width: 1280, height: 900, mobile: false, colorMode: 'dark' },
  { id: 'mobile-375-light', width: 375, height: 812, mobile: true, colorMode: 'light' },
  { id: 'mobile-390-dark', width: 390, height: 844, mobile: true, colorMode: 'dark' },
  { id: 'mobile-landscape-light', width: 844, height: 375, mobile: true, colorMode: 'light' },
  { id: 'mobile-landscape-dark', width: 844, height: 375, mobile: true, colorMode: 'dark' },
];
const SURFACES = [
  'alchemy', 'alchemy-queue', 'alchemy-confirm',
  'forging', 'forging-queue', 'enhancement', 'enhancement-job', 'enhancement-picker',
  'enhancement-history', 'enhancement-history-session', 'enhancement-history-detail', 'alchemy-preset', 'alchemy-picker',
];
const modeFilter = process.argv.find((value) => value.startsWith('--mode='))?.slice(7) || process.env.CRAFT_PROOF_MODE;
const surfaceFilter = process.argv.find((value) => value.startsWith('--surface='))?.slice(10) || process.env.CRAFT_PROOF_SURFACE;
const ACTIVE_MODES = modeFilter ? MODES.filter((mode) => mode.id === modeFilter) : MODES;
const ACTIVE_SURFACES = surfaceFilter ? SURFACES.filter((surface) => surface === surfaceFilter) : SURFACES;

const mountFixture = String.raw`
  (async () => {
    const { CraftWorkbenchModal } = await import('/src/ui/craft-workbench-modal.ts');
    const { getItemIconSources } = await import('/src/content/item-art.ts');
    const { getLocalItemTemplate } = await import('/src/content/local-templates.ts');
    document.getElementById('game-shell')?.classList.remove('hidden');
    document.getElementById('login-overlay')?.classList.add('hidden');
    const ids = ['spirit_stone', 'pill.minor_heal', 'equip.copper_building_hammer', 'mat.moondew_grass', 'mat.red_flame_leaf', 'black_iron_chunk'];
    const missing = ids.filter((id) => !getItemIconSources(id));
    if (missing.length > 0) throw new Error('craft proof 圖片映射缺少：' + missing.join(', '));
    const item = (itemId, count, itemInstanceId, patch = {}) => ({ ...(getLocalItemTemplate(itemId) ?? {}), itemId, count, itemInstanceId, ...patch });
    const elements = { metal: 1, wood: 3, water: 1, fire: 0, earth: 1 };
    const inventory = { capacity: 40, revision: 1, items: [
      item('spirit_stone', 99999, 'craft-spirit'),
      item('pill.minor_heal', 20, 'craft-pill'),
      item('mat.moondew_grass', 99, 'craft-moondew', { materialValues: { elements, level: 1, grade: 'mortal' } }),
      item('mat.red_flame_leaf', 99, 'craft-redleaf', { materialValues: { elements: { ...elements, fire: 4 }, level: 1, grade: 'mortal' } }),
      item('black_iron_chunk', 99, 'craft-iron', { materialValues: { elements: { ...elements, metal: 5 }, level: 1, grade: 'mortal' } }),
      item('equip.copper_building_hammer', 2, 'craft-hammer', { type: 'equipment', equipSlot: 'weapon', enhanceLevel: 1, level: 3, grade: 'mortal' }),
    ] };
    const ingredient = (itemId, name, role, count = 2) => ({ itemId, name, role, count, level: 1, grade: 'mortal', powerPerUnit: 10 });
    const alchemyRecipe = {
      recipeId: 'proof-alchemy', outputItemId: 'pill.minor_heal', outputName: '小還丹', category: 'recovery',
      outputCount: 1, outputLevel: 1, baseBrewTicks: 8, level: 1, grade: 'mortal', fullPower: 30,
      mainIngredients: [{ itemId: 'mat.moondew_grass', name: '月露草', count: 2 }], requiredAuxElements: elements,
      ingredients: [ingredient('mat.moondew_grass', '月露草', 'main'), ingredient('mat.red_flame_leaf', '赤焰葉', 'aux')],
    };
    const forgingRecipe = {
      recipeId: 'proof-forging', outputItemId: 'equip.copper_building_hammer', outputName: '銅鑄造鎚', category: 'weapon',
      outputCount: 1, outputLevel: 1, baseBrewTicks: 10, level: 1, grade: 'mortal', fullPower: 30,
      mainIngredients: [{ itemId: 'black_iron_chunk', name: '黑鐵塊', count: 2 }], requiredAuxElements: elements,
      ingredients: [ingredient('black_iron_chunk', '黑鐵塊', 'main'), ingredient('mat.red_flame_leaf', '赤焰葉', 'aux')],
    };
    const alchemyAlternate = { ...alchemyRecipe, recipeId: 'proof-alchemy-alt', outputItemId: 'spirit_stone', outputName: '靈石' };
    const preset = { presetId: 'craft-proof-preset', recipeId: alchemyRecipe.recipeId, name: '回春丹方',
      ingredients: [{ itemId: 'mat.moondew_grass', count: 2 }, { itemId: 'mat.red_flame_leaf', count: 1 }], updatedAt: Date.now() };
    const alchemyJob = (kind, recipe, remainingTicks = 7) => ({
      jobRunId: 'craft-proof-' + kind, jobType: kind, jobVersion: 1, recipeId: recipe.recipeId,
      outputItemId: recipe.outputItemId, outputCount: 1, quantity: 3, completedCount: 0, successCount: 0, failureCount: 0,
      ingredients: recipe.ingredients.map(({ itemId, count }) => ({ itemId, count })), phase: 'brewing', preparationTicks: 1,
      batchBrewTicks: 8, currentBatchRemainingTicks: remainingTicks, pausedTicks: 0, spiritStoneCost: 12,
      totalTicks: 24, remainingTicks, workTotalTicks: 24, workRemainingTicks: remainingTicks,
      interruptWaitRemainingTicks: 0, interruptState: null, successRate: 0.85, exactRecipe: true, startedAt: Date.now(),
    });
    const hammer = item('equip.copper_building_hammer', 1, 'craft-hammer', { type: 'equipment', equipSlot: 'weapon', enhanceLevel: 1, level: 3, grade: 'mortal', name: '銅鑄造鎚' });
    const candidate = {
      ref: { source: 'inventory', itemInstanceId: 'craft-hammer' }, item: hammer, currentLevel: 1, nextLevel: 2,
      spiritStoneCost: 80, successRate: 0.72, durationTicks: 10,
      materials: [{ itemId: 'black_iron_chunk', name: '黑鐵塊', count: 3, ownedCount: 99 }],
      allowSelfProtection: true, protectionItemId: 'pill.minor_heal', protectionItemName: '小還丹',
      protectionCandidates: [{ ref: { source: 'inventory', itemInstanceId: 'craft-pill' }, item: item('pill.minor_heal', 20, 'craft-pill', { name: '小還丹' }) }],
    };
    const enhancementJob = (remainingTicks = 7) => ({
      jobRunId: 'craft-proof-enhancement', jobType: 'enhancement', jobVersion: 1, target: candidate.ref, item: hammer,
      targetItemId: hammer.itemId, targetItemName: '銅鑄造鎚', targetItemLevel: 3, currentLevel: 1, targetLevel: 2,
      desiredTargetLevel: 4, spiritStoneCost: 80, materials: [{ itemId: 'black_iron_chunk', count: 3 }],
      protectionUsed: true, protectionStartLevel: 3, protectionItemId: 'pill.minor_heal', protectionItemName: '小還丹',
      phase: 'enhancing', pausedTicks: 0, successRate: 0.72, totalTicks: 10, remainingTicks,
      workTotalTicks: 10, workRemainingTicks: remainingTicks, interruptWaitRemainingTicks: 0, interruptState: null,
      startedAt: Date.now(), roleEnhancementLevel: 4, totalSpeedRate: 1.2,
    });
    const record = { itemId: hammer.itemId, itemName: '銅鑄造鎚', highestLevel: 3,
      levels: [{ targetLevel: 2, successCount: 1, failureCount: 1 }, { targetLevel: 3, successCount: 1, failureCount: 0 }],
      actionStartedAt: Date.now() - 60000, actionEndedAt: Date.now(), startLevel: 1, initialTargetLevel: 2,
      desiredTargetLevel: 3, protectionStartLevel: 3, status: 'completed' };
    const createModal = () => {
      const next = new CraftWorkbenchModal();
      next.setCallbacks({
        onRequestAlchemy() {}, onRequestForging() {}, onRequestEnhancement() {}, onStartAlchemy() {}, onStartForging() {},
        onStartEnhancement() {}, onCancelAlchemy() {}, onCancelForging() {}, onCancelEnhancement() {}, onCancelQueueItem() {},
      });
      next.syncInventory(inventory);
      return next;
    };
    const modal = createModal();
    window.__craftItemProof = {
      modal, inventory, getItemIconSources, alchemyRecipe, alchemyAlternate, forgingRecipe, alchemyJob, candidate, enhancementJob, record,
      panel(kind, recipe, job = null) { return { kind, catalogVersion: 1, catalog: kind === 'alchemy' ? [recipe, alchemyAlternate] : [recipe], state: { presets: kind === 'alchemy' ? [preset, { ...preset, presetId: 'craft-proof-preset-alt', recipeId: alchemyAlternate.recipeId }] : [], job, queue: [] } }; },
      enhancementPanel(job = null) { return { state: { enhancementSkillLevel: 4, candidates: [candidate], records: [record], job, queue: [] } }; },
      resetModal() { this.modal = createModal(); },
    };
    return { mounted: true, mapped: ids.every((id) => Boolean(getItemIconSources(id))) };
  })()
`;

const configureMode = (mode) => String.raw`
  (async () => {
    const { updateUiColorMode } = await import('/src/ui/ui-style-config.ts');
    updateUiColorMode(${JSON.stringify(mode.colorMode)}); window.dispatchEvent(new Event('resize'));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { mode: document.documentElement.dataset.colorMode, scheme: document.documentElement.style.colorScheme };
  })()
`;

const openSurface = (surface) => String.raw`
  (async () => {
    document.querySelector('[data-confirm-modal-backdrop="true"]')?.click();
    const detailModal = document.getElementById('detail-modal');
    if (detailModal instanceof HTMLElement && !detailModal.classList.contains('hidden')) detailModal.click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => setTimeout(resolve, 80));
    const p = window.__craftItemProof; const modal = p.modal; const surface = ${JSON.stringify(surface)};
    const openAlchemy = (kind, recipe, job = null) => { kind === 'alchemy' ? modal.openAlchemy() : modal.openForging();
      kind === 'alchemy' ? modal.updateAlchemy(p.panel(kind, recipe, job)) : modal.updateForging(p.panel(kind, recipe, job)); };
    if (surface.startsWith('alchemy')) openAlchemy('alchemy', p.alchemyRecipe, surface === 'alchemy-queue' ? p.alchemyJob('alchemy', p.alchemyRecipe) : null);
    else if (surface.startsWith('forging')) openAlchemy('forging', p.forgingRecipe, surface === 'forging-queue' ? p.alchemyJob('forging', p.forgingRecipe) : null);
    else { modal.openEnhancement(); modal.updateEnhancement(p.enhancementPanel(surface === 'enhancement-job' ? p.enhancementJob() : null)); }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (surface.startsWith('alchemy') && surface !== 'alchemy') {
      document.querySelector('.alchemy-recipe-item[data-recipe-id="proof-alchemy"]')?.click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    let actionDebug = null;
    if (surface === 'alchemy-confirm') {
      document.querySelector('[data-craft-action="alchemy-switch-tab"][data-tab="full"]')?.click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const start = document.querySelector('[data-craft-action="alchemy-start-full"]');
      actionDebug = { found: Boolean(start), disabled: start instanceof HTMLButtonElement ? start.disabled : null, text: start?.textContent?.trim() ?? '',
        actions: [...document.querySelectorAll('[data-craft-action]')].map((node) => node.getAttribute('data-craft-action')).slice(-12),
        activeTab: modal.activeAlchemyTab, job: modal.alchemyPanel?.state?.job?.jobRunId ?? null };
      start?.click();
    }
    if (surface === 'alchemy-picker') {
      document.querySelector('[data-craft-action="alchemy-switch-tab"][data-tab="simple"]')?.click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      document.querySelector('[data-craft-action="alchemy-open-material-picker"]')?.click();
    }
    if (surface === 'alchemy-preset') {
      document.querySelector('[data-craft-action="alchemy-switch-tab"][data-tab="simple"]')?.click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const trigger = document.querySelector('[data-craft-action="alchemy-open-preset-picker"]');
      actionDebug = { found: Boolean(trigger), text: trigger?.textContent?.trim() ?? '', activeTab: modal.activeAlchemyTab };
      trigger?.click();
    }
    if (surface === 'enhancement') document.querySelector('[data-enhancement-toggle-protection-inline="1"]')?.click();
    if (surface === 'enhancement-picker') document.querySelector('[data-enhancement-open-picker="1"]')?.click();
    if (surface.startsWith('enhancement-history')) {
      document.querySelector('[data-enhancement-open-history="1"]')?.click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      if (surface !== 'enhancement-history') document.querySelector('[data-enhancement-history-item]')?.click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      if (surface === 'enhancement-history-detail') document.querySelector('[data-enhancement-history-session]')?.click();
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    document.querySelector('.guided-tour-layer')?.classList.add('hidden');
    const confirm = document.querySelector('.confirm-modal-layer:not(.hidden) .confirm-modal-body');
    const root = confirm ?? document.querySelector('#detail-modal-body');
    if (!(root instanceof HTMLElement)) throw new Error(surface + ' 正式 craft root 未掛載');
    return { confirm: Boolean(confirm), actionDebug, title: document.querySelector('.confirm-modal-layer:not(.hidden) .confirm-modal-title')?.textContent?.trim()
      ?? document.getElementById('detail-modal-title')?.textContent?.trim() ?? '' };
  })()
`;

const measureSurface = (surface) => String.raw`
  (async () => {
    const surface = ${JSON.stringify(surface)};
    const root = document.querySelector('.confirm-modal-layer:not(.hidden) .confirm-modal-body') ?? document.querySelector('#detail-modal-body');
    if (!(root instanceof HTMLElement)) throw new Error(surface + ' 沒有正式 root');
    const images = [...root.querySelectorAll('img.item-art')].filter((img) => img.getClientRects().length > 0);
    for (const img of images) {
      img.scrollIntoView({ block: 'center', inline: 'nearest' });
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await Promise.race([
        img.decode(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('道具圖片 decode 逾時：' + (img.currentSrc || img.src))), 5000)),
      ]);
    }
    const compact = matchMedia('(max-width: 768px), (pointer: coarse) and (max-width: 1024px)').matches;
    const metrics = images.map((img) => { const rect = img.getBoundingClientRect(); const expected = img.classList.contains('item-art--detail') ? (compact ? 64 : 80)
      : img.classList.contains('item-art--inline') ? (compact ? 20 : 24) : (compact ? 40 : 48);
      return { src: img.currentSrc, naturalWidth: img.naturalWidth, width: rect.width, height: rect.height, expected, classes: img.className,
        parent: img.parentElement?.className ?? '', owner: img.parentElement?.parentElement?.className ?? '' }; });
    const controls = [...root.querySelectorAll('input, select, textarea')].filter((control) => { const rect = control.getBoundingClientRect(); const style = getComputedStyle(control); return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; });
    const controlMetrics = controls.map((control) => { const rect = control.getBoundingClientRect(); return { tag: control.tagName, type: control.getAttribute('type') ?? '', className: control.className, width: rect.width, height: rect.height }; });
    const controlOverlaps = images.flatMap((img) => { const a = img.getBoundingClientRect(); return controls.filter((control) => { const b = control.getBoundingClientRect(); return Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1; }).map((control) => ({ image: img.currentSrc, control: control.className || control.tagName })); });
    const clipped = images.flatMap((img) => {
      const box = img.getBoundingClientRect();
      for (let owner = img.parentElement; owner && owner !== root.parentElement; owner = owner.parentElement) {
        const style = getComputedStyle(owner); const clipX = ['hidden', 'clip'].includes(style.overflowX); const clipY = ['hidden', 'clip'].includes(style.overflowY);
        if (!clipX && !clipY) continue; const rect = owner.getBoundingClientRect();
        if ((clipX && (box.left < rect.left - 1.5 || box.right > rect.right + 1.5)) || (clipY && (box.top < rect.top - 1.5 || box.bottom > rect.bottom + 1.5)))
          return [{ src: img.currentSrc, owner: owner.className, image: box.toJSON(), clip: rect.toJSON() }];
      }
      return [];
    });
    const contexts = {
      recipe: root.querySelectorAll('.alchemy-recipe-item img.item-art').length,
      detail: root.querySelectorAll('.alchemy-detail-title img.item-art--detail, .enhancement-summary-title img.item-art--detail').length,
      material: root.querySelectorAll('.alchemy-material-row img.item-art, .alchemy-ingredient-row img.item-art, .enhancement-material-row img.item-art').length,
      job: root.querySelectorAll('.alchemy-job-card img.item-art, [data-enhancement-job-key] img.item-art').length,
      confirm: root.closest('.confirm-modal-layer') ? root.querySelectorAll('img.item-art').length : 0,
      picker: root.querySelectorAll('.alchemy-material-picker-row img.item-art, [data-enhancement-picker-target] img.item-art').length,
      target: root.querySelectorAll('.enhancement-target-slot img.item-art').length,
      protection: root.querySelectorAll('.enhancement-protection-option img.item-art').length,
      history: root.querySelectorAll('[data-enhancement-history-item] img.item-art').length,
      historySession: root.querySelectorAll('.enhancement-history-list-modal--sessions img.item-art--detail').length,
      historyDetail: root.querySelectorAll('.enhancement-history-detail > .item-art-reference img.item-art--detail').length,
      preset: root.querySelectorAll('.alchemy-preset-picker-material-row img.item-art').length,
      queue: root.querySelectorAll('.craft-queue-item img.item-art').length,
    };
    const overflow = root.scrollWidth > root.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1;
    const overflowing = [...root.querySelectorAll('*')].filter((node) => node instanceof HTMLElement && node.scrollWidth > node.clientWidth + 2)
      .slice(0, 8).map((node) => ({ className: node.className, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }));
    const enhancementRows = [...root.querySelectorAll('.enhancement-material-row')].map((row) => {
      const style = getComputedStyle(row); const rect = row.getBoundingClientRect(); const summary = row.parentElement; const summaryRect = summary?.getBoundingClientRect();
      const ancestors = []; for (let owner = row.parentElement; owner && ancestors.length < 5; owner = owner.parentElement) { const ownerStyle = getComputedStyle(owner); ancestors.push({ className: owner.className, rect: owner.getBoundingClientRect().toJSON(), display: ownerStyle.display, width: ownerStyle.width, minWidth: ownerStyle.minWidth, gridTemplateColumns: ownerStyle.gridTemplateColumns, overflowX: ownerStyle.overflowX }); }
      return { rect: rect.toJSON(), display: style.display, gridTemplateColumns: style.gridTemplateColumns, width: style.width,
        ancestors,
        summary: summary ? { className: summary.className, rect: summaryRect?.toJSON(), display: getComputedStyle(summary).display, gridTemplateColumns: getComputedStyle(summary).gridTemplateColumns } : null,
        children: [...row.children].map((child) => { const childStyle = getComputedStyle(child); const childRect = child.getBoundingClientRect(); return { className: child.className, text: child.textContent?.trim().slice(0, 40), rect: childRect.toJSON(), width: childStyle.width, minWidth: childStyle.minWidth, flex: childStyle.flex, gridColumn: childStyle.gridColumn }; }),
      };
    });
    return { count: images.length, totalImages: root.querySelectorAll('img.item-art').length, rootClass: root.className, rootText: root.textContent?.trim().slice(0, 160) ?? '', metrics, clipped, contexts, overflow,
      overflowSize: { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth }, overflowing, controlMetrics, controlOverlaps,
      enhancementRows,
      jobKey: root.querySelector('[data-alchemy-job-card]')?.getAttribute('data-alchemy-job-key') ?? '',
    };
  })()
`;

const verifyPatch = (surface) => String.raw`
  (() => {
    const p = window.__craftItemProof; const surface = ${JSON.stringify(surface)};
    if (surface === 'alchemy-confirm') {
      const root = document.querySelector('.confirm-modal-layer:not(.hidden) .confirm-modal-body'); const input = root?.querySelector('[data-alchemy-confirm-quantity="true"]');
      const image = root?.querySelector('img.item-art'); if (!(input instanceof HTMLInputElement) || !(image instanceof HTMLImageElement)) throw new Error('正式煉丹確認數量或圖片不存在');
      input.focus(); input.value = '3'; input.dispatchEvent(new Event('input', { bubbles: true }));
      return { sameImage: image === root.querySelector('img.item-art'), focused: document.activeElement === input, value: input.value };
    }
    if (surface === 'alchemy-job') {
      const image = document.querySelector('[data-alchemy-job-card="true"] img.item-art');
      p.modal.updateAlchemy({ kind: 'alchemy', catalogVersion: 1, state: null, statePatch: { job: p.alchemyJob('alchemy', p.alchemyRecipe, 5) } });
      return { sameImage: image === document.querySelector('[data-alchemy-job-card="true"] img.item-art'), value: document.querySelector('[data-alchemy-work-fill="true"]')?.style.width ?? '' };
    }
    if (surface === 'enhancement-job') {
      const image = document.querySelector('[data-enhancement-job-key] img.item-art--detail');
      p.modal.updateEnhancement({ state: null, statePatch: { job: p.enhancementJob(5) } });
      return { sameImage: image === document.querySelector('[data-enhancement-job-key] img.item-art--detail'), value: document.querySelector('[data-enhancement-work-fill="true"]')?.style.width ?? '' };
    }
    if (surface === 'alchemy-queue' || surface === 'forging-queue') {
      const kind = surface.startsWith('alchemy') ? 'alchemy' : 'forging'; const recipe = kind === 'alchemy' ? p.alchemyRecipe : p.forgingRecipe;
      const image = document.querySelector('.craft-queue-item.active img.item-art');
      const patch = { kind, catalogVersion: 1, state: null, statePatch: { job: p.alchemyJob(kind, recipe, 5) } };
      kind === 'alchemy' ? p.modal.updateAlchemy(patch) : p.modal.updateForging(patch);
      return { sameImage: image === document.querySelector('.craft-queue-item.active img.item-art'), value: document.querySelector('.craft-queue-item.active .craft-queue-progress-fill')?.style.width ?? document.querySelector('.craft-queue-item.active')?.textContent ?? '' };
    }
    return null;
  })()
`;

function assertSurface(result, surface, mode) {
  if (result.count === 0) console.error('CRAFT_ITEM_PROOF_EMPTY', mode, surface, JSON.stringify(result));
  assert(result.count > 0, `${mode}/${surface}沒有正式道具圖片`);
  for (const image of result.metrics) {
    if (Math.abs(image.width - image.expected) > 1 || Math.abs(image.height - image.expected) > 1) console.error('CRAFT_ITEM_PROOF_SIZE', mode, surface, JSON.stringify({ image, enhancementRows: result.enhancementRows }));
    assert(image.naturalWidth > 0, `${mode}/${surface}圖片 decode 後沒有像素`);
    assert(Math.abs(image.width - image.expected) <= 1 && Math.abs(image.height - image.expected) <= 1,
      `${mode}/${surface}圖片 ${image.width}x${image.height}，預期 ${image.expected}`);
  }
  assert.deepEqual(result.clipped, [], `${mode}/${surface}圖片被 hidden/clip 祖先裁切`);
  assert.deepEqual(result.controlOverlaps, [], `${mode}/${surface}圖片遮擋重要輸入`);
  for (const control of result.controlMetrics) {
    const nativeToggle = control.type === 'radio' || control.type === 'checkbox';
    assert(nativeToggle ? control.width > 0 && control.height > 0 : control.width >= 40 && control.height >= 24,
      `${mode}/${surface}重要輸入被擠壓：${JSON.stringify(control)}`);
  }
  assert.equal(result.overflow, false, `${mode}/${surface}發生水平溢出 ${JSON.stringify({ size: result.overflowSize, nodes: result.overflowing })}`);
  const c = result.contexts;
  if (surface === 'alchemy' || surface === 'forging') assert(c.recipe > 0 && c.detail > 0 && c.material > 0, `${mode}/${surface}未覆蓋配方、產物詳情與材料`);
  if (surface.endsWith('-job')) assert(c.job > 0, `${mode}/${surface}未覆蓋活躍 job：${JSON.stringify(result)}`);
  if (surface === 'alchemy-confirm') assert(c.confirm > 0, `${mode}/${surface}確認摘要缺少產物圖片`);
  if (surface === 'alchemy-picker' || surface === 'enhancement-picker') assert(c.picker > 0, `${mode}/${surface}picker 沒有道具圖片`);
  if (surface === 'enhancement') assert(c.target > 0 && c.detail > 0 && c.material > 0 && c.protection > 0, `${mode}/${surface}未覆蓋目標、材料或保護物`);
  if (surface === 'enhancement-history') assert(c.history > 0, `${mode}/${surface}歷史列表沒有道具圖片`);
  if (surface === 'enhancement-history-session') assert(c.historySession > 0, `${mode}/${surface}歷史場次標頭沒有詳情圖片`);
  if (surface === 'enhancement-history-detail') assert(c.historyDetail > 0, `${mode}/${surface}歷史詳情沒有詳情圖片`);
  if (surface === 'alchemy-preset' && c.preset === 0) console.error('CRAFT_ITEM_PROOF_PRESET', mode, JSON.stringify(result));
  if (surface === 'alchemy-preset') assert(c.preset > 0, `${mode}/${surface}預設詳情缺少材料圖片`);
  if (surface.endsWith('-queue')) assert(c.queue > 0, `${mode}/${surface}統一任務佇列缺少產物圖片`);
}

async function capture(cdp, name) {
  await cdp.evaluate(`(async () => { const root = document.querySelector('.confirm-modal-layer:not(.hidden) .confirm-modal-body') ?? document.querySelector('#detail-modal-body');
    const image = root?.querySelector('img.item-art--detail') ?? root?.querySelector('img.item-art'); if (image instanceof HTMLImageElement) { await image.decode(); image.scrollIntoView({block:'center',inline:'nearest'}); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); } })()`);
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  await writeFile(path.join(ARTIFACT_DIR, `${name}.png`), Buffer.from(result.data, 'base64'));
}

async function clickImage(cdp, selector, index, mobile) {
  const point = await cdp.evaluate(`(() => { const node = [...document.querySelectorAll(${JSON.stringify(selector)})][${index}]; if (!(node instanceof HTMLImageElement)) throw new Error('正式可點圖片不存在: ' + ${JSON.stringify(selector)}); node.scrollIntoView({ block: 'center', inline: 'center' }); const r = node.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (mobile) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y, radiusX: 2, radiusY: 2, force: 1, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  }
  await delay(80);
}

async function verifyImageInteraction(cdp, surface, mobile) {
  if (surface === 'alchemy') {
    await clickImage(cdp, '.alchemy-recipe-item img.item-art', 1, mobile);
    assert.equal(await cdp.evaluate(`document.querySelector('.alchemy-recipe-item.active')?.getAttribute('data-recipe-id') ?? ''`), 'proof-alchemy-alt', `${mobile ? 'touch' : 'click'}點配方圖片未切換正式配方`);
  } else if (surface === 'alchemy-picker') {
    const before = await cdp.evaluate(`document.querySelector('#detail-modal-body')?.textContent ?? ''`);
    await clickImage(cdp, '.confirm-modal-layer:not(.hidden) [data-alchemy-material-add] img.item-art', 0, mobile);
    const after = await cdp.evaluate(`document.querySelector('#detail-modal-body')?.textContent ?? ''`);
    assert.notEqual(after, before, `${mobile ? 'touch' : 'click'}點材料圖片未觸發正式投料`);
  } else if (surface === 'enhancement-picker') {
    await clickImage(cdp, '.confirm-modal-layer:not(.hidden) [data-enhancement-picker-target] img.item-art', 0, mobile);
    assert.equal(await cdp.evaluate(`Boolean(document.querySelector('.confirm-modal-layer:not(.hidden)'))`), false, `${mobile ? 'touch' : 'click'}點強化目標圖片未完成正式選擇`);
  }
}

await mkdir(ARTIFACT_DIR, { recursive: true });
let screenshots = 0;
await withClientBrowserProof({ viewport: { width: 1280, height: 900 }, profilePrefix: 'craft-item-icons-' }, async (cdp) => {
  assert.deepEqual(await cdp.evaluate(mountFixture), { mounted: true, mapped: true });
  for (const mode of ACTIVE_MODES) {
    await cdp.evaluate(`window.__craftItemProof.resetModal()`);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: mode.width, height: mode.height, deviceScaleFactor: 1, mobile: mode.mobile, screenWidth: mode.width, screenHeight: mode.height });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: mode.mobile ? 5 : 1, configuration: mode.mobile ? 'mobile' : 'desktop' });
    assert.deepEqual(await cdp.evaluate(configureMode(mode)), { mode: mode.colorMode, scheme: mode.colorMode });
    await delay(50);
    for (const surface of ACTIVE_SURFACES) {
      await cdp.evaluate(`window.__craftItemProof.resetModal()`);
      if (surfaceFilter) console.error('CRAFT_ITEM_PROOF_STAGE', mode.id, surface, 'open');
      const opened = await cdp.evaluate(openSurface(surface));
      if (['alchemy-confirm', 'alchemy-picker', 'alchemy-preset', 'enhancement-picker', 'enhancement-history', 'enhancement-history-session', 'enhancement-history-detail'].includes(surface) && !opened.confirm) console.error('CRAFT_ITEM_PROOF_OPEN', mode.id, surface, JSON.stringify(opened));
      if (surfaceFilter) console.error('CRAFT_ITEM_PROOF_STAGE', mode.id, surface, 'measure');
      assertSurface(await cdp.evaluate(measureSurface(surface)), surface, mode.id);
      if (['alchemy-confirm', 'alchemy-queue', 'forging-queue', 'enhancement-job'].includes(surface)) {
        const patched = await cdp.evaluate(verifyPatch(surface));
        assert.equal(patched.sameImage, true, `${mode.id}/${surface}正式 patch 重建圖片`);
        if (surface === 'alchemy-confirm') assert.deepEqual(patched, { sameImage: true, focused: true, value: '3' }, `${mode.id}/${surface}數量 patch 遺失圖片、焦點或值`);
        else { assert.equal(patched.sameImage, true, `${mode.id}/${surface}正式 patch 重建圖片`); assert.notEqual(patched.value, '', `${mode.id}/${surface}進度沒有局部更新`); }
      }
      if (surfaceFilter) console.error('CRAFT_ITEM_PROOF_STAGE', mode.id, surface, 'capture');
      await capture(cdp, `${mode.id}-${surface}`); screenshots += 1;
      await verifyImageInteraction(cdp, surface, mode.mobile);
    }
  }
});
console.log(`CRAFT_ITEM_ICONS_PROOF:PASS screenshots=${screenshots} dir=${ARTIFACT_DIR}`);
