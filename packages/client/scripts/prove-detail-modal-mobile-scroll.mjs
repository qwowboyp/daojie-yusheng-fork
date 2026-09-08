/**
 * 手机端详情弹层滚动可达性 proof。
 *
 * 通过正式 ActionPanel 和 detailModalHost 验证固定高度弹层在窄屏下存在连续的纵向滚动路径。
 */
import assert from 'node:assert/strict';
import { delay, withClientBrowserProof } from './browser-proof-runtime.mjs';

const VIEWPORT = { width: 390, height: 844 };
const SHORT_VIEWPORT = { width: 390, height: 640 };
const BODY_CONSTRAINED_VARIANTS = [
  'detail-modal--inventory-bulk-discard',
  'detail-modal--attr-special',
  'detail-modal--technique',
  'detail-modal--technique-generation',
  'detail-modal--market',
  'detail-modal--skill-management',
  'detail-modal--sect-management',
  'detail-modal--skill-preset',
  'detail-modal--targeting-plan',
  'detail-modal--combat-settings',
  'detail-modal--leaderboard',
  'detail-modal--tutorial',
  'detail-modal--mail',
  'detail-modal--craft',
  'detail-modal--alchemy',
  'detail-modal--enhancement',
  'detail-modal--auto-pill-picker',
  'detail-modal--auto-pill-condition',
];

function buildMeasureExpression(targetSelector) {
  return String.raw`
    (() => {
      const card = document.getElementById('detail-modal-card');
      const body = document.getElementById('detail-modal-body');
      const target = document.querySelector(${JSON.stringify(targetSelector)});
      if (!(card instanceof HTMLElement)
        || !(body instanceof HTMLElement)
        || !(target instanceof HTMLElement)) {
        throw new Error('详情弹层滚动 proof 结构不完整');
      }
      const bodyRect = body.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      let scrollHost = null;
      let current = target.parentElement;
      while (current instanceof HTMLElement) {
        const overflowY = getComputedStyle(current).overflowY;
        if ((overflowY === 'auto' || overflowY === 'scroll')
          && current.scrollHeight > current.clientHeight + 1) {
          scrollHost = current;
          break;
        }
        if (current === body) break;
        current = current.parentElement;
      }
      return {
        viewportHeight: innerHeight,
        cardTop: cardRect.top,
        cardBottom: cardRect.bottom,
        cardOverflowY: getComputedStyle(card).overflowY,
        bodyOverflowY: getComputedStyle(body).overflowY,
        bodyClientHeight: body.clientHeight,
        bodyScrollHeight: body.scrollHeight,
        bodyScrollTop: body.scrollTop,
        targetTop: targetRect.top,
        targetBottom: targetRect.bottom,
        targetVisible: targetRect.top >= bodyRect.top - 1 && targetRect.bottom <= bodyRect.bottom + 1,
        scrollHostFound: scrollHost instanceof HTMLElement,
        scrollHostLabel: scrollHost instanceof HTMLElement
          ? (scrollHost.id || scrollHost.className || scrollHost.tagName)
          : '',
        scrollHostClientHeight: scrollHost instanceof HTMLElement ? scrollHost.clientHeight : 0,
        scrollHostScrollHeight: scrollHost instanceof HTMLElement ? scrollHost.scrollHeight : 0,
        horizontalOverflow: card.scrollWidth > card.clientWidth + 1,
      };
    })()
  `;
}

function buildScrollExpression(targetSelector) {
  return String.raw`
    (() => {
      const body = document.getElementById('detail-modal-body');
      const target = document.querySelector(${JSON.stringify(targetSelector)});
      if (!(body instanceof HTMLElement) || !(target instanceof HTMLElement)) {
        throw new Error('详情弹层滚动目标不存在');
      }
      let current = target.parentElement;
      while (current instanceof HTMLElement) {
        const overflowY = getComputedStyle(current).overflowY;
        if ((overflowY === 'auto' || overflowY === 'scroll')
          && current.scrollHeight > current.clientHeight + 1) {
          current.scrollTop = current.scrollHeight;
          return true;
        }
        if (current === body) break;
        current = current.parentElement;
      }
      return false;
    })()
  `;
}

const measureSkillPresetLayoutExpression = String.raw`
  (() => {
    const card = document.getElementById('detail-modal-card');
    const body = document.getElementById('detail-modal-body');
    const hero = document.querySelector('.skill-preset-hero');
    const layout = document.querySelector('.skill-preset-layout');
    const heroCards = Array.from(document.querySelectorAll('.skill-preset-hero > .skill-preset-card'));
    const layoutCards = Array.from(document.querySelectorAll('.skill-preset-layout > *'));
    const cards = [...heroCards, ...layoutCards];
    const buttons = Array.from(document.querySelectorAll('.skill-preset-shell .small-btn'));
    if (!(card instanceof HTMLElement)
      || !(body instanceof HTMLElement)
      || !(hero instanceof HTMLElement)
      || !(layout instanceof HTMLElement)
      || heroCards.some((item) => !(item instanceof HTMLElement))
      || layoutCards.some((item) => !(item instanceof HTMLElement))
      || buttons.some((item) => !(item instanceof HTMLElement))) {
      throw new Error('技能方案移动端布局 proof 结构不完整');
    }
    const heroRect = hero.getBoundingClientRect();
    const layoutRect = layout.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    const getGap = (items) => {
      if (items.length < 2) return Number.POSITIVE_INFINITY;
      return items[1].getBoundingClientRect().top - items[0].getBoundingClientRect().bottom;
    };
    const overflowingCards = cards
      .filter((item) => item.scrollHeight > item.clientHeight + 1)
      .map((item) => item.className);
    const childOverflowCards = cards
      .filter((item) => {
        const itemRect = item.getBoundingClientRect();
        return Array.from(item.children).some((child) => child.getBoundingClientRect().bottom > itemRect.bottom + 1);
      })
      .map((item) => item.className);
    const buttonRects = buttons.map((button) => button.getBoundingClientRect());
    return {
      cardZoom: Number.parseFloat(getComputedStyle(card).zoom || '1'),
      heroLayoutGap: layoutRect.top - heroRect.bottom,
      heroCardGap: getGap(heroCards),
      layoutCardGap: getGap(layoutCards),
      overflowingCards,
      childOverflowCards,
      minButtonHeight: Math.min(...buttonRects.map((rect) => rect.height)),
      buttonsOutsideBody: buttonRects.filter((rect) => rect.left < bodyRect.left - 1 || rect.right > bodyRect.right + 1).length,
    };
  })()
`;

function assertSkillPresetLayout(layout, label) {
  assert.equal(layout.cardZoom, 1, `${label}不应通过 zoom 压缩触控界面：${JSON.stringify(layout)}`);
  assert(layout.heroLayoutGap >= -1, `${label}顶部卡片与下方布局发生重叠：${JSON.stringify(layout)}`);
  assert(layout.heroCardGap >= -1, `${label}顶部两张卡片发生重叠：${JSON.stringify(layout)}`);
  assert(layout.layoutCardGap >= -1, `${label}列表与导入卡片发生重叠：${JSON.stringify(layout)}`);
  assert.deepEqual(layout.overflowingCards, [], `${label}卡片内容超出自身高度：${JSON.stringify(layout)}`);
  assert.deepEqual(layout.childOverflowCards, [], `${label}卡片子内容越过边界：${JSON.stringify(layout)}`);
  assert(layout.minButtonHeight >= 43.5, `${label}按钮实际触控高度不足 44px：${JSON.stringify(layout)}`);
  assert.equal(layout.buttonsOutsideBody, 0, `${label}按钮超出正文横向边界：${JSON.stringify(layout)}`);
}

async function assertTargetReachable(cdp, { label, targetSelector, requireScroll = true }) {
  const initial = await cdp.evaluate(buildMeasureExpression(targetSelector));
  assert(initial.cardTop >= 0 && initial.cardBottom <= initial.viewportHeight, `${label}弹层超出手机安全视口`);
  assert.equal(initial.horizontalOverflow, false, `${label}弹层出现横向溢出`);
  if (initial.targetVisible && !requireScroll) {
    return initial;
  }
  assert.equal(
    initial.scrollHostFound,
    true,
    `${label}底部内容不可见且没有纵向滚动容器：${JSON.stringify(initial)}`,
  );
  assert(
    initial.scrollHostScrollHeight > initial.scrollHostClientHeight + 1,
    `${label}滚动容器没有形成有效滚动范围`,
  );
  assert.equal(await cdp.evaluate(buildScrollExpression(targetSelector)), true, `${label}未找到可推进的滚动容器`);
  await delay(80);
  const scrolled = await cdp.evaluate(buildMeasureExpression(targetSelector));
  assert.equal(scrolled.targetVisible, true, `${label}滚动到底后底部内容仍不可达`);
  return scrolled;
}

const initializeActionPanelExpression = String.raw`
  (async () => {
    const { ActionPanel } = await import('/src/ui/panels/action-panel.ts');
    const panel = new ActionPanel();
    panel.skillPresets = Array.from({ length: 12 }, (_, index) => ({
      id: 'mobile-scroll-preset-' + index,
      name: '手机方案 ' + (index + 1),
      skills: [{ skillId: 'proof-skill-' + index, enabled: index % 2 === 0, skillEnabled: true }],
    }));
    panel.selectedSkillPresetId = panel.skillPresets[0].id;
    window.__detailModalMobileScrollPanel = panel;
    return {
      hasCombatSettings: Boolean(panel.combatSettings),
      hasSkillManagement: Boolean(panel.skillMgmt),
    };
  })()
`;

const openTargetingPlanExpression = String.raw`
  (async () => {
    window.__detailModalMobileScrollPanel.combatSettings.openTargetingPlanModal();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return document.getElementById('detail-modal-title')?.textContent?.trim() ?? '';
  })()
`;

const openSkillPresetExpression = String.raw`
  (async () => {
    window.__detailModalMobileScrollPanel.skillMgmt.openSkillPresetModal();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return document.getElementById('detail-modal-title')?.textContent?.trim() ?? '';
  })()
`;

const openEmptySkillPresetExpression = String.raw`
  (async () => {
    const panel = window.__detailModalMobileScrollPanel;
    panel.skillPresets = [];
    panel.selectedSkillPresetId = null;
    panel.skillPresetNameDraft = '';
    panel.skillPresetImportText = '';
    panel.skillMgmt.openSkillPresetModal();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return document.getElementById('detail-modal-title')?.textContent?.trim() ?? '';
  })()
`;

const openCombatSettingsExpression = String.raw`
  (async () => {
    window.__detailModalMobileScrollPanel.combatSettings.openCombatSettingsModal();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return document.getElementById('detail-modal-title')?.textContent?.trim() ?? '';
  })()
`;

function buildOpenFallbackVariantExpression(variant) {
  return String.raw`
    (async () => {
      const { detailModalHost } = await import('/src/ui/detail-modal-host.ts');
      detailModalHost.open({
        ownerId: 'mobile-scroll-proof-' + ${JSON.stringify(variant)},
        variantClass: ${JSON.stringify(variant)},
        title: '移动端滚动检查',
        bodyHtml: '<div class="ui-list">'
          + Array.from({ length: 60 }, (_, index) => '<div class="ui-list-row" data-modal-proof-row="' + index + '"><span>检查项 ' + (index + 1) + '</span></div>').join('')
          + '</div>',
      });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return document.getElementById('detail-modal-card')?.className ?? '';
    })()
  `;
}

function assertDesktopWindowFrame(frame, label) {
  assert.equal(frame.desktopWindow, 'true', `${label}未启用桌面窗口控制器`);
  assert.equal(frame.resizeGrip, true, `${label}缺少右下角缩放控制器`);
  assert(frame.card.left >= -1 && frame.card.top >= -1, `${label}拖曳后超出视口左上：${JSON.stringify(frame)}`);
  assert(frame.card.right <= DESKTOP_VIEWPORT.width + 1 && frame.card.bottom <= DESKTOP_VIEWPORT.height + 1,
    `${label}拖曳后超出桌面视口：${JSON.stringify(frame)}`);
  for (const [name, rect] of Object.entries(frame.regions)) {
    assert(rect.width > 0 && rect.height > 0, `${label}${name}没有可操作区域：${JSON.stringify(frame)}`);
    assert(rect.left >= frame.card.left - 1 && rect.right <= frame.card.right + 1,
      `${label}${name}离开窗口横向边界：${JSON.stringify(frame)}`);
    assert(rect.top >= -1 && rect.bottom <= DESKTOP_VIEWPORT.height + 1,
      `${label}${name}离开桌面视口：${JSON.stringify(frame)}`);
  }
}

async function dragWithMouse(cdp, pointer) {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: pointer.startX, y: pointer.startY, button: 'left', clickCount: 1,
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: pointer.targetX, y: pointer.targetY, button: 'left', buttons: 1,
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: pointer.targetX, y: pointer.targetY, button: 'left', clickCount: 1,
  });
  await delay(80);
}

const DESKTOP_VIEWPORT = { width: 1440, height: 900 };

const desktopDetailBodyHtml = String.raw`<button type="button" class="small-btn" data-desktop-detail-action="true">執行檢查動作</button>
  <div class="ui-list">${Array.from({ length: 70 }, (_, index) => `<div class="ui-list-row">桌面詳情內容 ${index + 1}</div>`).join('')}</div>`;

const openDesktopDetailFixtureExpression = String.raw`
  (async () => {
    const { detailModalHost } = await import('/src/ui/detail-modal-host.ts');
    window.__desktopDetailActionCount = 0;
    detailModalHost.open({
      ownerId: 'desktop-window-proof-detail',
      title: '桌面視窗詳情驗證標題',
      bodyHtml: ${JSON.stringify(desktopDetailBodyHtml)},
    });
    document.querySelector('[data-desktop-detail-action="true"]')?.addEventListener('click', () => {
      window.__desktopDetailActionCount += 1;
    });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const body = document.getElementById('detail-modal-body');
    if (body instanceof HTMLElement) body.scrollTop = 0;
    return document.getElementById('detail-modal-card')?.dataset.desktopWindow ?? '';
  })()
`;

const desktopDetailDragPointerExpression = String.raw`
  (() => {
    const card = document.getElementById('detail-modal-card');
    const head = card?.querySelector('.ui-modal-head');
    if (!(card instanceof HTMLElement) || !(head instanceof HTMLElement)) throw new Error('桌面詳情拖曳標題列不存在');
    const rect = head.getBoundingClientRect();
    return { startX: rect.left + Math.min(80, rect.width / 2), startY: rect.top + rect.height / 2,
      targetX: rect.left + Math.min(80, rect.width / 2) + 90, targetY: rect.top + rect.height / 2 + 54 };
  })()
`;

const desktopDetailMinimumResizePointerExpression = String.raw`
  (() => {
    const card = document.getElementById('detail-modal-card');
    const grip = card?.querySelector('.desktop-window-resize');
    if (!(card instanceof HTMLElement) || !(grip instanceof HTMLButtonElement)) throw new Error('桌面詳情縮放控制器不存在');
    const cardRect = card.getBoundingClientRect();
    const gripRect = grip.getBoundingClientRect();
    return { startX: gripRect.left + gripRect.width / 2, startY: gripRect.top + gripRect.height / 2,
      targetX: cardRect.left + 48, targetY: cardRect.top + 72 };
  })()
`;

const measureDesktopDetailExpression = String.raw`
  (() => {
    const card = document.getElementById('detail-modal-card');
    const title = document.getElementById('detail-modal-title');
    const body = document.getElementById('detail-modal-body');
    const action = document.querySelector('[data-desktop-detail-action="true"]');
    const grip = card?.querySelector('.desktop-window-resize');
    if (!(card instanceof HTMLElement) || !(title instanceof HTMLElement) || !(body instanceof HTMLElement)
      || !(action instanceof HTMLButtonElement)) throw new Error('桌面詳情 fixture 結構不完整');
    const serialise = (element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const actionRect = serialise(action);
    return {
      desktopWindow: card.dataset.desktopWindow ?? '',
      resizeGrip: grip instanceof HTMLButtonElement,
      card: serialise(card),
      regions: { title: serialise(title), body: serialise(body), action: actionRect },
      actionHit: document.elementFromPoint(actionRect.left + actionRect.width / 2, actionRect.top + actionRect.height / 2) === action,
      styleWidth: Number.parseFloat(card.style.width),
      styleHeight: Number.parseFloat(card.style.height),
    };
  })()
`;

const desktopDetailPatchExpression = String.raw`
  (async () => {
    const { detailModalHost } = await import('/src/ui/detail-modal-host.ts');
    const card = document.getElementById('detail-modal-card');
    const body = document.getElementById('detail-modal-body');
    if (!(card instanceof HTMLElement) || !(body instanceof HTMLElement)) throw new Error('桌面詳情 patch fixture 不完整');
    body.scrollTop = Math.min(160, Math.max(0, body.scrollHeight - body.clientHeight));
    const before = card.getBoundingClientRect();
    const beforeScrollTop = body.scrollTop;
    const patched = detailModalHost.patch({
      ownerId: 'desktop-window-proof-detail',
      bodyHtml: ${JSON.stringify(desktopDetailBodyHtml)},
    });
    const after = card.getBoundingClientRect();
    return { patched, beforeLeft: before.left, beforeTop: before.top, afterLeft: after.left, afterTop: after.top,
      beforeScrollTop, afterScrollTop: body.scrollTop };
  })()
`;

const closeDesktopDetailFixtureExpression = String.raw`
  (async () => {
    const { detailModalHost } = await import('/src/ui/detail-modal-host.ts');
    detailModalHost.close('desktop-window-proof-detail');
  })()
`;

const openDesktopConfirmFixtureExpression = String.raw`
  (async () => {
    const { confirmModalHost } = await import('/src/ui/confirm-modal-host.ts');
    window.__desktopConfirmCancelCount = 0;
    confirmModalHost.open({
      ownerId: 'desktop-window-proof-confirm',
      title: '桌面確認視窗驗證標題',
      subtitle: '保留正式取消語意',
      bodyHtml: '<p>確認視窗正文內容需在最小尺寸下仍可閱讀。</p>',
      onClose: () => { window.__desktopConfirmCancelCount += 1; },
    });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return document.querySelector('.confirm-modal-card')?.dataset.desktopWindow ?? '';
  })()
`;

const desktopConfirmDragPointerExpression = String.raw`
  (() => {
    const card = document.querySelector('.confirm-modal-card');
    const head = card?.querySelector('.ui-modal-head');
    if (!(card instanceof HTMLElement) || !(head instanceof HTMLElement)) throw new Error('桌面確認拖曳標題列不存在');
    const rect = head.getBoundingClientRect();
    return { startX: rect.left + Math.min(72, rect.width / 2), startY: rect.top + rect.height / 2,
      targetX: rect.left + Math.min(72, rect.width / 2) - 70, targetY: rect.top + rect.height / 2 + 44 };
  })()
`;

const desktopConfirmMinimumResizePointerExpression = String.raw`
  (() => {
    const card = document.querySelector('.confirm-modal-card');
    const grip = card?.querySelector('.desktop-window-resize');
    if (!(card instanceof HTMLElement) || !(grip instanceof HTMLButtonElement)) throw new Error('桌面確認縮放控制器不存在');
    const cardRect = card.getBoundingClientRect();
    const gripRect = grip.getBoundingClientRect();
    return { startX: gripRect.left + gripRect.width / 2, startY: gripRect.top + gripRect.height / 2,
      targetX: cardRect.left + 42, targetY: cardRect.top + 62 };
  })()
`;

const measureDesktopConfirmExpression = String.raw`
  (() => {
    const card = document.querySelector('.confirm-modal-card');
    const title = document.querySelector('.confirm-modal-title');
    const body = document.querySelector('.confirm-modal-body');
    const cancel = document.querySelector('[data-confirm-modal-cancel="true"]');
    const grip = card?.querySelector('.desktop-window-resize');
    if (!(card instanceof HTMLElement) || !(title instanceof HTMLElement) || !(body instanceof HTMLElement)
      || !(cancel instanceof HTMLButtonElement)) throw new Error('桌面確認 fixture 結構不完整');
    const serialise = (element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const cancelRect = serialise(cancel);
    return {
      desktopWindow: card.dataset.desktopWindow ?? '',
      resizeGrip: grip instanceof HTMLButtonElement,
      card: serialise(card),
      regions: { title: serialise(title), body: serialise(body), action: cancelRect },
      actionHit: document.elementFromPoint(cancelRect.left + cancelRect.width / 2, cancelRect.top + cancelRect.height / 2) === cancel,
      styleWidth: Number.parseFloat(card.style.width),
      styleHeight: Number.parseFloat(card.style.height),
      cancelX: cancelRect.left + cancelRect.width / 2,
      cancelY: cancelRect.top + cancelRect.height / 2,
    };
  })()
`;

await withClientBrowserProof({ viewport: VIEWPORT, profilePrefix: 'detail-modal-mobile-scroll-proof-' }, async (cdp) => {
  const initialized = await cdp.evaluate(initializeActionPanelExpression);
  assert.equal(initialized.hasCombatSettings, true, '未加载正式战斗设置子面板');
  assert.equal(initialized.hasSkillManagement, true, '未加载正式技能方案子面板');

  assert.equal(await cdp.evaluate(openTargetingPlanExpression), '索敵方案', '未打開正式索敵方案彈層');
  await assertTargetReachable(cdp, {
    label: '索敌方案',
    targetSelector: '[data-targeting-plan-mode]:last-of-type',
  });

  assert.equal(await cdp.evaluate(openSkillPresetExpression), '技能方案', '未打开正式技能方案弹层');
  await assertTargetReachable(cdp, {
    label: '技能方案',
    targetSelector: '[data-skill-preset-import-clear]',
  });

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: SHORT_VIEWPORT.width,
    height: SHORT_VIEWPORT.height,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: SHORT_VIEWPORT.width,
    screenHeight: SHORT_VIEWPORT.height,
  });
  await delay(50);
  assert.equal(await cdp.evaluate(openEmptySkillPresetExpression), '技能方案', '未打开短视口空技能方案弹层');
  assertSkillPresetLayout(await cdp.evaluate(measureSkillPresetLayoutExpression), '短视口技能方案');
  await cdp.evaluate(`document.documentElement.dataset.colorMode = 'dark'`);
  await delay(50);
  assertSkillPresetLayout(await cdp.evaluate(measureSkillPresetLayoutExpression), '短视口深色技能方案');
  await cdp.evaluate(`document.documentElement.dataset.colorMode = 'light'`);
  await delay(50);
  await assertTargetReachable(cdp, {
    label: '短视口技能方案',
    targetSelector: '[data-skill-preset-import-clear]',
  });
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: VIEWPORT.width,
    screenHeight: VIEWPORT.height,
  });
  await delay(50);

  assert.equal(await cdp.evaluate(openCombatSettingsExpression), '戰鬥設置', '未打開正式戰鬥設置彈層');
  const combatSettings = await assertTargetReachable(cdp, {
    label: '战斗设置',
    targetSelector: '[data-auto-pill-open-slot-conditions="7"]',
  });
  assert.match(combatSettings.scrollHostLabel, /auto-pill-slot-grid/, '战斗设置应保留内部列表滚动路径');

  for (const variant of BODY_CONSTRAINED_VARIANTS) {
    const cardClass = await cdp.evaluate(buildOpenFallbackVariantExpression(variant));
    assert.match(cardClass, new RegExp(`\\b${variant}\\b`), `${variant} 未应用到正式弹层卡片`);
    await assertTargetReachable(cdp, {
      label: variant,
      targetSelector: '[data-modal-proof-row="59"]',
    });
  }

  await cdp.evaluate(`document.documentElement.dataset.colorMode = 'dark'`);
  await delay(50);
  await assertTargetReachable(cdp, {
    label: '深色模式详情弹层',
    targetSelector: '[data-modal-proof-row="59"]',
    requireScroll: false,
  });

  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 5 });
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: DESKTOP_VIEWPORT.width,
    height: DESKTOP_VIEWPORT.height,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: DESKTOP_VIEWPORT.width,
    screenHeight: DESKTOP_VIEWPORT.height,
  });
  await delay(80);

  assert.equal(await cdp.evaluate(openDesktopDetailFixtureExpression), 'true', '正式詳情 host 未啟用桌面窗口控制器');
  await dragWithMouse(cdp, await cdp.evaluate(desktopDetailDragPointerExpression));
  await dragWithMouse(cdp, await cdp.evaluate(desktopDetailMinimumResizePointerExpression));
  const detailFrame = await cdp.evaluate(measureDesktopDetailExpression);
  assertDesktopWindowFrame(detailFrame, '正式詳情視窗');
  assert(detailFrame.styleWidth >= 360 && detailFrame.styleHeight >= 320,
    `正式詳情視窗未遵守最小尺寸：${JSON.stringify(detailFrame)}`);
  assert.equal(detailFrame.actionHit, true, '正式詳情視窗最小尺寸時正文動作不可點擊');
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: detailFrame.regions.action.left + detailFrame.regions.action.width / 2,
    y: detailFrame.regions.action.top + detailFrame.regions.action.height / 2, button: 'left', clickCount: 1,
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: detailFrame.regions.action.left + detailFrame.regions.action.width / 2,
    y: detailFrame.regions.action.top + detailFrame.regions.action.height / 2, button: 'left', clickCount: 1,
  });
  assert.equal(await cdp.evaluate('window.__desktopDetailActionCount'), 1, '正式詳情視窗正文動作未觸發');
  const detailPatch = await cdp.evaluate(desktopDetailPatchExpression);
  assert.equal(detailPatch.patched, true, '正式詳情 host patch 被拒絕');
  assert(Math.abs(detailPatch.beforeLeft - detailPatch.afterLeft) < 1 && Math.abs(detailPatch.beforeTop - detailPatch.afterTop) < 1,
    `正式詳情 patch 重設視窗位置：${JSON.stringify(detailPatch)}`);
  assert.equal(detailPatch.afterScrollTop, detailPatch.beforeScrollTop,
    `正式詳情 patch 重設正文捲動位置：${JSON.stringify(detailPatch)}`);
  await cdp.evaluate(closeDesktopDetailFixtureExpression);

  assert.equal(await cdp.evaluate(openDesktopConfirmFixtureExpression), 'true', '正式確認 host 未啟用桌面窗口控制器');
  await dragWithMouse(cdp, await cdp.evaluate(desktopConfirmDragPointerExpression));
  await dragWithMouse(cdp, await cdp.evaluate(desktopConfirmMinimumResizePointerExpression));
  const confirmFrame = await cdp.evaluate(measureDesktopConfirmExpression);
  assertDesktopWindowFrame(confirmFrame, '正式確認視窗');
  assert(confirmFrame.styleWidth >= 320 && confirmFrame.styleHeight >= 220,
    `正式確認視窗未遵守最小尺寸：${JSON.stringify(confirmFrame)}`);
  assert.equal(confirmFrame.actionHit, true, '正式確認視窗最小尺寸時取消動作不可點擊');
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: confirmFrame.cancelX, y: confirmFrame.cancelY, button: 'left', clickCount: 1,
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: confirmFrame.cancelX, y: confirmFrame.cancelY, button: 'left', clickCount: 1,
  });
  assert.equal(await cdp.evaluate('window.__desktopConfirmCancelCount'), 1, '正式確認視窗取消回呼未恰好觸發一次');
});

console.log('detail modal mobile and desktop window proof passed');
