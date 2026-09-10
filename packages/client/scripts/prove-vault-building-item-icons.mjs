/**
 * 以正式營造 state source 與 TreasureVaultModal 驗證新增道具圖片入口。
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { delay, withClientBrowserProof } from './browser-proof-runtime.mjs';

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactDir = path.join(clientRoot, '.codex', 'vault-building-item-icons-proof');
const modes = [
  { id: 'desktop-light', width: 1280, height: 900, mobile: false, colorMode: 'light' },
  { id: 'desktop-dark', width: 1280, height: 900, mobile: false, colorMode: 'dark' },
  { id: 'portrait-light', width: 375, height: 812, mobile: true, colorMode: 'light' },
  { id: 'landscape-dark', width: 844, height: 390, mobile: true, colorMode: 'dark' },
];

const mountFixture = String.raw`
  (async () => {
    window.__vaultBuildingIconProof?.buildingSource?.clear();
    window.__vaultBuildingIconProof?.vault?.clear();
    document.querySelectorAll('.treasure-vault-modal-layer, .treasure-vault-deposit-picker-layer').forEach((node) => node.remove());
    document.getElementById('login-overlay')?.classList.add('hidden');
    document.getElementById('game-shell')?.classList.remove('hidden');
    document.querySelector('.guided-tour-layer')?.classList.add('hidden');

    const [{ createMainBuildingFengShuiStateSource }, { TreasureVaultModal }] = await Promise.all([
      import('/src/main-building-fengshui-state-source.ts'),
      import('/src/ui/panels/social-panel.ts'),
    ]);
    const materialIds = [
      'black_iron_chunk', 'crystal_dust', 'wolf_fang', 'demon_wolf_bone',
      'mine_signal_core', 'blood_feather', 'rune_shard', 'serpent_gall',
      'valley_core', 'bandit_insignia', 'spirit_iron_fragment', 'mantis_blade',
    ];
    const materialNames = [
      '玄鐵礦塊', '晶塵', '狼牙', '妖狼骨', '礦脈訊號核心', '血羽',
      '符文碎片', '蛇膽', '谷地核心', '山賊徽記', '靈鐵碎片', '螳螂刃',
    ];
    const buildingMaterials = materialIds.map((itemId, index) => ({
      itemId,
      itemInstanceId: 'material-instance-' + index,
      name: materialNames[index],
      desc: '營造材料驗收',
      type: 'material',
      count: index + 3,
      materialCategory: 'ore',
      tags: ['石材', '金屬', '礦石', '礦材'],
    }));
    const player = {
      playerId: 'player-vault-building-icon-proof',
      mapId: 'proof-map',
      x: 0,
      y: 0,
      buildingSkill: { level: 1 },
      inventory: { revision: 1, capacity: 200, items: buildingMaterials },
    };
    const buildingSource = createMainBuildingFengShuiStateSource({
      socket: {
        sendBuildPlaceIntent() {},
        sendBuildDeconstruct() {},
        sendRoomSetRole() {},
        sendFengShuiObserve() {},
      },
      setFengShuiOverlay() {},
      setBuildPreviewOverlay() {},
      getPlayer: () => player,
      getVisibleTileAt: () => ({}),
      showToast() {},
      beginTargeting() {},
      cancelTargeting() {},
      getInfoRadius: () => 8,
      sidePanel: {
        getLayoutCollapseState: () => ({ leftCollapsed: false, rightCollapsed: false, bottomCollapsed: false }),
        setLayoutCollapseState() {},
        setBuildingModeActive(active) {
          const shell = document.getElementById('game-shell');
          if (shell) shell.dataset.buildingMode = String(active);
        },
        isMobileLayoutActive: () => matchMedia('(max-width: 920px), ((max-width: 1180px) and (pointer: coarse)), ((max-width: 1180px) and (hover: none))').matches,
      },
    });

    const vaultItemIds = ['black_iron_chunk', 'crystal_dust', 'wolf_fang', 'blood_feather', 'rune_shard', 'serpent_gall'];
    const makeItem = (index, stored) => ({
      itemId: vaultItemIds[index % vaultItemIds.length],
      itemInstanceId: index === 0 ? 'boar_tusk' : 'inventory-instance-' + index,
      ...(stored ? { storageItemId: index === 0 ? 'book.cloud_blade' : 'vault-storage-' + index, slotIndex: index } : {}),
      name: '驗收物品 ' + (index + 1),
      desc: '寶庫圖片驗收物品',
      type: index >= 33 ? 'equipment' : 'material',
      count: (index * 7) % 19 + 2,
      level: index % 5 + 1,
      materialCategory: 'ore',
      tags: ['礦材'],
    });
    const vaultItems = Array.from({ length: 36 }, (_, index) => makeItem(index, true));
    const inventoryItems = Array.from({ length: 36 }, (_, index) => makeItem(index, false));
    const vaultDetail = {
      instanceId: 'proof-instance',
      buildingId: 'proof-vault-building',
      buildingName: '驗收寶庫',
      ownerPlayerId: player.playerId,
      ownerName: '驗收玩家',
      accessPolicyResource: { resourceType: 'treasure_vault', resourceId: 'proof-vault-building' },
      effectivePermissions: { view: true, deposit: true, withdraw: true },
      items: vaultItems,
      capacity: 100,
      revision: 1,
    };
    const events = { deposits: [], withdrawals: [], organizes: 0 };
    const vault = new TreasureVaultModal();
    vault.setCallbacks({
      onDeposit(items) { events.deposits.push(items); },
      onWithdraw(storageItemId, count) { events.withdrawals.push({ storageItemId, count }); },
      onOrganize() { events.organizes += 1; },
      onPermissionsSaved() {},
      onRename() {},
    });
    vault.setCurrentPlayer(player.playerId, inventoryItems);
    window.__vaultBuildingIconProof = {
      buildingSource,
      player,
      vault,
      vaultDetail,
      inventoryItems,
      events,
      refs: {},
    };
    buildingSource.openBuildingPanel();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const wall = document.querySelector('.building-mode-item[data-def-id="stone_wall"]');
    if (wall instanceof HTMLButtonElement && !wall.classList.contains('active')) wall.click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return true;
  })()
`;

const configureMode = (mode) => String.raw`
  (async () => {
    const { updateUiColorMode } = await import('/src/ui/ui-style-config.ts');
    updateUiColorMode(${JSON.stringify(mode.colorMode)});
    window.dispatchEvent(new Event('resize'));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      colorMode: document.documentElement.dataset.colorMode,
      compact: matchMedia('(max-width: 768px), (pointer: coarse) and (max-width: 1024px)').matches,
    };
  })()
`;

const measureImages = (rootSelector, expectedSize, detail = false) => String.raw`
  (async () => {
    const root = document.querySelector(${JSON.stringify(rootSelector)});
    if (!(root instanceof HTMLElement)) throw new Error('找不到正式驗收根節點：' + ${JSON.stringify(rootSelector)});
    const selector = ${JSON.stringify(detail ? 'img.item-art--detail' : 'img.item-art:not(.item-art--detail)')};
    const images = [...root.querySelectorAll(selector)].filter((image) => image instanceof HTMLImageElement && image.getClientRects().length > 0);
    images.forEach((image) => { image.loading = 'eager'; });
    await Promise.all(images.map((image) => image.decode()));
    const sourceUrls = new Set(images.flatMap((image) => [
      image.getAttribute('src') ?? '',
      ...(image.getAttribute('srcset') ?? '').split(',').map((candidate) => candidate.trim().split(/\s+/)[0] ?? ''),
    ]).filter(Boolean));
    const decodedSources = await Promise.all([...sourceUrls].map(async (src) => {
      const probe = new Image();
      probe.src = src;
      await probe.decode();
      return { src: probe.src, naturalWidth: probe.naturalWidth, naturalHeight: probe.naturalHeight };
    }));
    const metrics = images.map((image) => {
      const rect = image.getBoundingClientRect();
      const owner = image.closest('.building-mode-material-card, .inventory-cell, .item-art-reference');
      const ownerRect = owner?.getBoundingClientRect();
      return {
        src: image.currentSrc,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        width: rect.width,
        height: rect.height,
        objectFit: getComputedStyle(image).objectFit,
        cssWidth: getComputedStyle(image).width,
        ownerWidth: ownerRect?.width ?? null,
        ownerHeight: ownerRect?.height ?? null,
        withinOwner: !ownerRect || (rect.left >= ownerRect.left - 1 && rect.right <= ownerRect.right + 1 && rect.top >= ownerRect.top - 1 && rect.bottom <= ownerRect.bottom + 1),
      };
    });
    return {
      count: images.length,
      metrics,
      decodedSources,
      expectedSize: ${expectedSize},
      horizontalOverflow: root.scrollWidth > root.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1,
    };
  })()
`;

const verifyBuildingPatch = String.raw`
  (async () => {
    const proof = window.__vaultBuildingIconProof;
    const grid = document.querySelector('.building-mode-material-grid');
    const card = document.querySelector('.building-mode-material-card[data-item-id="black_iron_chunk"]');
    const image = card?.querySelector('img.item-art');
    const strength = document.querySelector('[data-action="build-strength"]');
    if (!(grid instanceof HTMLElement) || !(card instanceof HTMLElement) || !(image instanceof HTMLImageElement) || !(strength instanceof HTMLInputElement)) {
      throw new Error('正式營造材料卡或輸入不存在');
    }
    image.dataset.proofIdentity = 'building-black-iron';
    const maxScroll = Math.max(0, grid.scrollHeight - grid.clientHeight);
    grid.scrollTop = maxScroll;
    strength.focus({ preventScroll: true });
    strength.value = '77';
    proof.refs.buildingCard = card;
    proof.refs.buildingImage = image;
    proof.player.inventory = {
      ...proof.player.inventory,
      revision: proof.player.inventory.revision + 1,
      items: proof.player.inventory.items.map((item) => item.itemId === 'black_iron_chunk' ? { ...item, count: item.count + 1 } : item),
    };
    await new Promise((resolve) => setTimeout(resolve, 140));
    const nextCard = document.querySelector('.building-mode-material-card[data-item-id="black_iron_chunk"]');
    const nextImage = nextCard?.querySelector('img.item-art');
    return {
      candidateCount: document.querySelectorAll('.building-mode-material-card[data-item-id]').length,
      sameCard: nextCard === card,
      sameImage: nextImage === image,
      imageMarker: nextImage?.dataset.proofIdentity ?? '',
      focused: document.activeElement === strength,
      inputValue: strength.value,
      scrollTop: grid.scrollTop,
      expectedScrollTop: maxScroll,
      stableSrc: nextImage?.currentSrc ?? '',
    };
  })()
`;

const revealBuildingMaterials = String.raw`
  (() => {
    const grid = document.querySelector('.building-mode-material-grid');
    const image = grid?.querySelector('img.item-art');
    if (!(grid instanceof HTMLElement) || !(image instanceof HTMLImageElement)) throw new Error('營造材料圖片區不存在');
    grid.scrollTop = 0;
    grid.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const rect = image.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
  })()
`;

const openVault = String.raw`
  (async () => {
    const proof = window.__vaultBuildingIconProof;
    proof.buildingSource.clear();
    proof.vault.showDetail(proof.vaultDetail);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return !document.querySelector('.treasure-vault-modal-layer')?.classList.contains('hidden');
  })()
`;

const verifyVaultSort = String.raw`
  (() => {
    const proof = window.__vaultBuildingIconProof;
    const grid = document.querySelector('.treasure-vault-inventory-grid');
    const row = document.querySelector('[data-vault-row="true"][data-storage-item-id="book.cloud_blade"]');
    const image = row?.querySelector('img.item-art');
    const sort = document.querySelector('[data-vault-item-sort]');
    if (!(grid instanceof HTMLElement) || !(row instanceof HTMLElement) || !(image instanceof HTMLImageElement) || !(sort instanceof HTMLSelectElement)) {
      throw new Error('正式寶庫主格或排序不存在');
    }
    image.dataset.proofIdentity = 'vault-main-black-iron';
    const maxScroll = Math.max(0, grid.scrollHeight - grid.clientHeight);
    grid.scrollTop = maxScroll;
    sort.focus({ preventScroll: true });
    proof.refs.vaultMainImage = image;
    sort.value = 'count';
    sort.dispatchEvent(new Event('change', { bubbles: true }));
    const nextRow = document.querySelector('[data-vault-row="true"][data-storage-item-id="book.cloud_blade"]');
    const nextImage = nextRow?.querySelector('img.item-art');
    return {
      sameImage: nextImage === image,
      marker: nextImage?.dataset.proofIdentity ?? '',
      focused: document.activeElement === sort,
      sortValue: sort.value,
      scrollTop: grid.scrollTop,
      expectedScrollTop: maxScroll,
      stableSrc: nextImage?.currentSrc ?? '',
    };
  })()
`;

const openVaultDetail = String.raw`
  (async () => {
    const row = document.querySelector('[data-vault-row="true"][data-storage-item-id="book.cloud_blade"]');
    if (!(row instanceof HTMLButtonElement)) throw new Error('指定寶庫主格不存在');
    row.click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      open: !document.getElementById('detail-modal')?.classList.contains('hidden'),
      title: document.getElementById('detail-modal-title')?.textContent?.trim() ?? '',
    };
  })()
`;

const openDepositPicker = String.raw`
  (async () => {
    const close = document.getElementById('detail-modal-close');
    if (close instanceof HTMLButtonElement && !document.getElementById('detail-modal')?.classList.contains('hidden')) close.click();
    const button = document.querySelector('[data-vault-action="open-deposit-picker"]');
    if (!(button instanceof HTMLButtonElement)) throw new Error('正式批量放入入口不存在');
    button.click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return !document.querySelector('.treasure-vault-deposit-picker-layer')?.classList.contains('hidden');
  })()
`;

const verifyDepositQuantityPatch = String.raw`
  (() => {
    const proof = window.__vaultBuildingIconProof;
    const grid = document.querySelector('.treasure-vault-deposit-grid');
    const entry = document.querySelector('[data-vault-deposit-entry][data-item-instance-id="boar_tusk"]');
    const toggle = entry?.querySelector('[data-vault-deposit-action="toggle"]');
    if (!(grid instanceof HTMLElement) || !(entry instanceof HTMLElement) || !(toggle instanceof HTMLButtonElement)) {
      throw new Error('正式批量放入第一格不存在');
    }
    toggle.click();
    const input = entry.querySelector('[data-vault-deposit-count]');
    const image = entry.querySelector('img.item-art');
    if (!(input instanceof HTMLInputElement) || !(image instanceof HTMLImageElement)) throw new Error('批量數量輸入或圖片不存在');
    image.dataset.proofIdentity = 'vault-deposit-black-iron';
    const maxScroll = Math.max(0, grid.scrollHeight - grid.clientHeight);
    grid.scrollTop = maxScroll;
    input.focus({ preventScroll: true });
    input.value = '2';
    const selectionBefore = input.selectionStart;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const nextEntry = document.querySelector('[data-vault-deposit-entry][data-item-instance-id="boar_tusk"]');
    const nextInput = nextEntry?.querySelector('[data-vault-deposit-count]');
    const nextImage = nextEntry?.querySelector('img.item-art');
    proof.refs.depositImage = image;
    proof.refs.depositInput = input;
    return {
      sameImage: nextImage === image,
      sameInput: nextInput === input,
      marker: nextImage?.dataset.proofIdentity ?? '',
      focused: document.activeElement === input,
      value: input.value,
      inputType: input.type,
      selectionBefore,
      selectionAfter: input.selectionStart,
      scrollTop: grid.scrollTop,
      expectedScrollTop: maxScroll,
      stableSrc: nextImage?.currentSrc ?? '',
      selectedCount: document.querySelector('[data-vault-deposit-selected-count]')?.textContent?.trim() ?? '',
    };
  })()
`;

const verifyDepositNavigationAndConfirm = String.raw`
  (async () => {
    const click = (selector) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLButtonElement)) throw new Error('找不到批量放入控制：' + selector);
      element.click();
    };
    click('[data-vault-deposit-action="page"][data-vault-deposit-page="next"]');
    const nextPage = document.querySelector('.inventory-pagination-status')?.textContent?.trim() ?? '';
    click('[data-vault-deposit-action="page"][data-vault-deposit-page="prev"]');
    click('[data-vault-deposit-action="filter"][data-vault-deposit-filter="material"]');
    const materialCount = document.querySelectorAll('[data-vault-deposit-entry]').length;
    const sort = document.querySelector('[data-vault-deposit-sort]');
    if (!(sort instanceof HTMLSelectElement)) throw new Error('批量放入排序不存在');
    sort.value = 'count';
    sort.dispatchEvent(new Event('change', { bubbles: true }));
    const sortValue = document.querySelector('[data-vault-deposit-sort]')?.value ?? '';
    const confirm = document.querySelector('[data-vault-deposit-action="confirm"]');
    if (!(confirm instanceof HTMLButtonElement) || confirm.disabled) throw new Error('批量放入確認不可用');
    confirm.click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return {
      nextPage,
      materialCount,
      sortValue,
      depositCalls: window.__vaultBuildingIconProof.events.deposits,
    };
  })()
`;

function assertImages(result, label, expectedSize, minimumCount) {
  assert(result.count >= minimumCount, `${label}正式入口缺少圖片`);
  assert.equal(result.horizontalOverflow, false, `${label}產生水平溢出`);
  assert(result.decodedSources.some((source) => /-96\.webp$/.test(source.src)), `${label}沒有decode 96來源`);
  assert(result.decodedSources.some((source) => /-192\.webp$/.test(source.src)), `${label}沒有decode 192來源`);
  for (const source of result.decodedSources) {
    assert(source.naturalWidth > 0 && source.naturalHeight === source.naturalWidth, `${label}src/srcset來源decode或裁切異常：${source.src}`);
  }
  for (const metric of result.metrics) {
    assert(metric.naturalWidth > 0, `${label}圖片decode後沒有像素：${metric.src}`);
    assert(metric.naturalHeight === metric.naturalWidth, `${label}圖片不是正方形：${metric.src}`);
    assert(Math.abs(Number.parseFloat(metric.cssWidth) - expectedSize) <= 1, `${label}圖片CSS預留尺寸${metric.cssWidth}，預期${expectedSize}px`);
    assert(metric.width > 0 && Math.abs(metric.width - metric.height) <= 1, `${label}圖片可見方框異常：${metric.width}x${metric.height}`);
    assert.equal(metric.objectFit, 'contain', `${label}圖片未使用contain裁切策略`);
    assert.equal(metric.withinOwner, true, `${label}圖片跨出卡片範圍`);
  }
}

async function capture(cdp, name) {
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  await writeFile(path.join(artifactDir, `${name}.png`), Buffer.from(result.data, 'base64'));
}

await mkdir(artifactDir, { recursive: true });
let screenshotCount = 0;
await withClientBrowserProof({ viewport: { width: 1280, height: 900 }, profilePrefix: 'vault-building-item-icons-' }, async (cdp) => {
  for (const mode of modes) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: mode.width,
      height: mode.height,
      deviceScaleFactor: 1,
      mobile: mode.mobile,
      screenWidth: mode.width,
      screenHeight: mode.height,
    });
    await cdp.send('Emulation.setTouchEmulationEnabled', {
      enabled: mode.mobile,
      maxTouchPoints: mode.mobile ? 5 : 1,
      configuration: mode.mobile ? 'mobile' : 'desktop',
    });
    const configured = await cdp.evaluate(configureMode(mode));
    assert.equal(configured.colorMode, mode.colorMode, `${mode.id}主題未切換`);
    assert.equal(configured.compact, mode.mobile, `${mode.id}道具圖尺寸媒體條件錯誤`);
    assert.equal(await cdp.evaluate(mountFixture), true, `${mode.id}未能掛載正式 fixture`);
    await delay(80);

    const listSize = mode.mobile ? 40 : 48;
    const detailSize = mode.mobile ? 64 : 80;
    assertImages(await cdp.evaluate(measureImages('#building-mode-toolbar', listSize)), `${mode.id}/營造材料`, listSize, 3);
    const buildingPatch = await cdp.evaluate(verifyBuildingPatch);
    assert(buildingPatch.candidateCount >= 3, `${mode.id}營造材料候選不足`);
    assert.equal(buildingPatch.sameCard, true, `${mode.id}材料數量更新重建既有卡片`);
    assert.equal(buildingPatch.sameImage, true, `${mode.id}材料數量更新重建既有圖片`);
    assert.equal(buildingPatch.imageMarker, 'building-black-iron', `${mode.id}材料圖片節點身份遺失`);
    assert.equal(buildingPatch.focused, true, `${mode.id}材料更新打斷建造強度焦點`);
    assert.equal(buildingPatch.inputValue, '77', `${mode.id}材料更新覆蓋未提交輸入`);
    assert(Math.abs(buildingPatch.scrollTop - buildingPatch.expectedScrollTop) <= 1, `${mode.id}材料更新改變捲動位置`);
    assert.match(buildingPatch.stableSrc, /\/black_iron_chunk-(96|192)\.webp$/, `${mode.id}材料圖片未按candidate.itemId選擇`);
    assert.equal(await cdp.evaluate(revealBuildingMaterials), true, `${mode.id}營造材料圖片未進入可視區`);
    await capture(cdp, `${mode.id}-building-materials`); screenshotCount += 1;

    assert.equal(await cdp.evaluate(openVault), true, `${mode.id}正式寶庫未開啟`);
    assertImages(await cdp.evaluate(measureImages('.treasure-vault-modal-layer', listSize)), `${mode.id}/寶庫主格`, listSize, 30);
    const vaultSort = await cdp.evaluate(verifyVaultSort);
    assert.equal(vaultSort.sameImage, true, `${mode.id}寶庫排序重建圖片節點`);
    assert.equal(vaultSort.marker, 'vault-main-black-iron', `${mode.id}寶庫排序遺失圖片節點身份`);
    assert.equal(vaultSort.focused, true, `${mode.id}寶庫排序遺失排序焦點`);
    assert.equal(vaultSort.sortValue, 'count', `${mode.id}寶庫排序未生效`);
    assert(Math.abs(vaultSort.scrollTop - vaultSort.expectedScrollTop) <= 1, `${mode.id}寶庫排序改變網格捲動`);
    assert.match(vaultSort.stableSrc, /\/black_iron_chunk-(96|192)\.webp$/, `${mode.id}寶庫主格錯用storageItemId選圖`);
    await capture(cdp, `${mode.id}-vault-grid`); screenshotCount += 1;

    const openedDetail = await cdp.evaluate(openVaultDetail);
    assert.equal(openedDetail.open, true, `${mode.id}寶庫詳情未開啟`);
    assert.equal(openedDetail.title, '驗收物品 1', `${mode.id}寶庫詳情物品錯誤`);
    const detailImages = await cdp.evaluate(measureImages('#detail-modal-body', detailSize, true));
    assertImages(detailImages, `${mode.id}/寶庫詳情`, detailSize, 1);
    assert.match(detailImages.metrics[0].src, /\/black_iron_chunk-(96|192)\.webp$/, `${mode.id}寶庫詳情錯用storageItemId選圖`);
    await capture(cdp, `${mode.id}-vault-detail`); screenshotCount += 1;

    assert.equal(await cdp.evaluate(openDepositPicker), true, `${mode.id}批量放入未開啟`);
    assertImages(await cdp.evaluate(measureImages('.treasure-vault-deposit-picker-layer', listSize)), `${mode.id}/批量放入`, listSize, 30);
    const quantityPatch = await cdp.evaluate(verifyDepositQuantityPatch);
    assert.equal(quantityPatch.sameImage, true, `${mode.id}數量patch重建圖片`);
    assert.equal(quantityPatch.sameInput, true, `${mode.id}數量patch重建輸入`);
    assert.equal(quantityPatch.marker, 'vault-deposit-black-iron', `${mode.id}數量patch遺失圖片節點身份`);
    assert.equal(quantityPatch.focused, true, `${mode.id}數量patch遺失輸入焦點`);
    assert.equal(quantityPatch.value, '2', `${mode.id}數量patch覆蓋輸入值`);
    assert.equal(quantityPatch.inputType, 'number', `${mode.id}數量控制不再使用正式number input`);
    assert.equal(quantityPatch.selectionBefore, null, `${mode.id}number input不應偽造文字選區`);
    assert.equal(quantityPatch.selectionAfter, null, `${mode.id}數量patch改變number input選區語義`);
    assert(Math.abs(quantityPatch.scrollTop - quantityPatch.expectedScrollTop) <= 1, `${mode.id}數量patch改變捲動位置`);
    assert.match(quantityPatch.stableSrc, /\/black_iron_chunk-(96|192)\.webp$/, `${mode.id}批量放入錯用inventoryInstanceId選圖`);
    assert.equal(quantityPatch.selectedCount, 'x1', `${mode.id}批量選取數量未更新`);
    await capture(cdp, `${mode.id}-vault-deposit`); screenshotCount += 1;

    const navigation = await cdp.evaluate(verifyDepositNavigationAndConfirm);
    assert.equal(navigation.nextPage, '第 2/2 頁', `${mode.id}批量放入切頁失效`);
    assert(navigation.materialCount > 0, `${mode.id}批量放入材料篩選無結果`);
    assert.equal(navigation.sortValue, 'count', `${mode.id}批量放入排序失效`);
    assert.equal(navigation.depositCalls.length, 1, `${mode.id}批量放入未送出一次回呼`);
    assert.deepEqual(navigation.depositCalls[0], [{ itemInstanceId: 'boar_tusk', count: 2 }], `${mode.id}批量放入混淆itemId與instanceId或數量`);
    await cdp.evaluate(`window.__vaultBuildingIconProof.vault.clear()`);
  }
});

console.log(`VAULT_BUILDING_ITEM_ICONS_PROOF:PASS screenshots=${screenshotCount} dir=${artifactDir}`);
