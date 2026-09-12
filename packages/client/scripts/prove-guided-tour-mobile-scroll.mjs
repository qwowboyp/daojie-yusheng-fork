/**
 * 手机端运行时导览卡片滚动可达性 proof。
 *
 * 通过正式 GuidedTour 控制器验证长文案不会超出视口，底部操作可滚动到达，且切换步骤后回到顶部。
 */
import assert from 'node:assert/strict';
import { delay, withClientBrowserProof } from './browser-proof-runtime.mjs';

const VIEWPORT = { width: 390, height: 844 };

const initializeGuidedTourExpression = String.raw`
  (async () => {
    const { GuidedTour } = await import('/src/ui/guided-tour.ts');
    const { GUIDED_TOUR_FLOWS } = await import('/src/constants/ui/guided-tour.ts');
    const target = document.createElement('button');
    target.id = 'guided-tour-mobile-scroll-target';
    target.type = 'button';
    target.textContent = '导览目标';
    Object.assign(target.style, {
      position: 'fixed',
      left: '156px',
      top: '24px',
      width: '78px',
      height: '40px',
      zIndex: '1',
    });
    document.body.append(target);

    const longBody = Array.from(
      { length: 80 },
      (_, index) => '这是用于验证手机端长导览内容滚动路径的第 ' + (index + 1) + ' 段说明。',
    ).join('');
    const flow = {
      id: 'guided-tour-mobile-scroll-proof',
      storageVersion: 1,
      autoStart: false,
      titleKey: 'proof.guided-tour.flow.title',
      titleFallback: '手机导览滚动检查',
      steps: [1, 2].map((stepNumber) => ({
        id: 'long-step-' + stepNumber,
        targetSelector: '#guided-tour-mobile-scroll-target',
        titleKey: 'proof.guided-tour.step.' + stepNumber + '.title',
        titleFallback: '长内容步骤 ' + stepNumber,
        bodyKey: 'proof.guided-tour.step.' + stepNumber + '.body',
        bodyFallback: longBody,
        placement: 'bottom',
      })),
    };
    const tour = new GuidedTour({
      documentRef: document,
      windowRef: window,
      controls: {
        switchTab: () => {},
        setLayoutCollapsed: () => {},
        isMobileLayoutActive: () => true,
      },
      flows: [flow],
    });
    tour.initialize();
    tour.start(flow.id, { force: true });
    window.__guidedTourMobileScrollProof = tour;
    await new Promise((resolve) => setTimeout(resolve, 320));
    const step = (flowId, stepId) => GUIDED_TOUR_FLOWS.find((entry) => entry.id === flowId)?.steps.find((entry) => entry.id === stepId);
    const preparesWorkspaceTab = (flowId, stepId, tab) => {
      const entry = step(flowId, stepId);
      return entry?.prepare?.some((action) => action.type === 'switch-tab' && action.tabName === tab) === true;
    };
    const targetsWorkspaceTab = (flowId, stepId, tab) => {
      const entry = step(flowId, stepId);
      return entry?.targetSelector.includes('#workspace-tab-' + tab)
        && entry.targetSelector.includes('[data-action-tab="' + tab + '"]');
    };
    const routing = {
      observe: targetsWorkspaceTab('observe-guide', 'observe-utility-tab', 'utility')
        && preparesWorkspaceTab('observe-guide', 'observe-utility-tab', 'utility')
        && preparesWorkspaceTab('observe-guide', 'observe-button', 'utility'),
      senseQi: targetsWorkspaceTab('sense-qi-guide', 'sense-qi-toggle-tab', 'toggle')
        && preparesWorkspaceTab('sense-qi-guide', 'sense-qi-toggle-tab', 'toggle')
        && preparesWorkspaceTab('sense-qi-guide', 'sense-qi-card', 'toggle'),
      cultivation: targetsWorkspaceTab('cultivation-guide', 'cultivation-toggle-tab', 'toggle')
        && preparesWorkspaceTab('cultivation-guide', 'cultivation-toggle-tab', 'toggle')
        && preparesWorkspaceTab('cultivation-guide', 'cultivation-toggle-card', 'toggle')
        && preparesWorkspaceTab('cultivation-guide', 'cultivation-auto-card', 'toggle'),
      forceAttack: targetsWorkspaceTab('force-attack-guide', 'force-attack-utility-tab', 'utility')
        && preparesWorkspaceTab('force-attack-guide', 'force-attack-utility-tab', 'utility')
        && preparesWorkspaceTab('force-attack-guide', 'force-attack-button', 'utility'),
      mining: targetsWorkspaceTab('mining-guide', 'mining-skill-tab', 'skill')
        && preparesWorkspaceTab('mining-guide', 'mining-skill-tab', 'skill')
        && preparesWorkspaceTab('mining-guide', 'mining-button', 'skill'),
    };
    return { title: document.querySelector('.guided-tour-card-title')?.textContent?.trim() ?? '', routing };
  })()
`;

const measureGuidedTourExpression = String.raw`
  (() => {
    const card = document.querySelector('.guided-tour-card');
    const title = document.querySelector('.guided-tour-card-title');
    const nextButton = document.querySelector('[data-guided-tour-next]');
    if (!(card instanceof HTMLElement)
      || !(title instanceof HTMLElement)
      || !(nextButton instanceof HTMLElement)) {
      throw new Error('运行时导览滚动 proof 结构不完整');
    }
    const cardRect = card.getBoundingClientRect();
    const nextRect = nextButton.getBoundingClientRect();
    const style = getComputedStyle(card);
    return {
      viewportHeight: innerHeight,
      cardTop: cardRect.top,
      cardBottom: cardRect.bottom,
      cardClientHeight: card.clientHeight,
      cardScrollHeight: card.scrollHeight,
      cardScrollTop: card.scrollTop,
      overflowY: style.overflowY,
      horizontalOverflow: card.scrollWidth > card.clientWidth + 1,
      title: title.textContent?.trim() ?? '',
      nextVisible: nextRect.top >= cardRect.top - 1
        && nextRect.bottom <= cardRect.bottom + 1
        && nextRect.bottom <= innerHeight + 1,
    };
  })()
`;

await withClientBrowserProof({ viewport: VIEWPORT, profilePrefix: 'guided-tour-mobile-scroll-proof-' }, async (cdp) => {
  const initialized = await cdp.evaluate(initializeGuidedTourExpression);
  assert.equal(initialized.title, '长内容步骤 1', '未打开正式运行时导览步骤');
  assert.deepEqual(initialized.routing, {
    observe: true, senseQi: true, cultivation: true, forceAttack: true, mining: true,
  }, `workspace 導覽未在目標出現前切到正確分頁：${JSON.stringify(initialized.routing)}`);

  const initial = await cdp.evaluate(measureGuidedTourExpression);
  assert(initial.cardTop >= 0 && initial.cardBottom <= initial.viewportHeight, `导览卡片超出手机视口：${JSON.stringify(initial)}`);
  assert.equal(initial.horizontalOverflow, false, '导览卡片出现横向溢出');
  assert.match(initial.overflowY, /auto|scroll/, '长导览卡片没有纵向滚动容器');
  assert(initial.cardScrollHeight > initial.cardClientHeight + 1, '长导览内容没有形成有效滚动范围');
  assert.equal(initial.nextVisible, false, '长导览底部按钮应由滚动路径到达');

  await cdp.evaluate(`document.querySelector('.guided-tour-card').scrollTop = document.querySelector('.guided-tour-card').scrollHeight`);
  await delay(80);
  const scrolled = await cdp.evaluate(measureGuidedTourExpression);
  assert.equal(scrolled.nextVisible, true, '导览卡片滚动到底后操作按钮仍不可达');

  await cdp.evaluate(`document.querySelector('[data-guided-tour-next]').click()`);
  await delay(320);
  const nextStep = await cdp.evaluate(measureGuidedTourExpression);
  assert.equal(nextStep.title, '长内容步骤 2', '导览未进入下一步骤');
  assert(nextStep.cardScrollTop <= 1, `导览切换步骤后没有回到顶部：${JSON.stringify(nextStep)}`);

  await cdp.evaluate(`document.documentElement.dataset.colorMode = 'dark'`);
  await delay(50);
  const darkMode = await cdp.evaluate(measureGuidedTourExpression);
  assert(darkMode.cardTop >= 0 && darkMode.cardBottom <= darkMode.viewportHeight, '深色模式导览卡片超出手机视口');
});

console.log('guided tour mobile scroll proof passed');
