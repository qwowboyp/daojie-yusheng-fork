/** 活動焦點視窗關閉 proof：僅真實地圖畫布可關閉，內部操作、拖曳與阻塞收益不會誤關。 */
import assert from 'node:assert/strict';
import { delay, withClientBrowserProof } from './browser-proof-runtime.mjs';

const DESKTOP = { width: 1280, height: 720 };
const PHONE = { width: 390, height: 844 };

const prepareFixture = String.raw`
  (async () => {
    const originalCanvas = document.getElementById('game-canvas');
    if (!(originalCanvas instanceof HTMLCanvasElement)) throw new Error('主地圖畫布不存在');
    document.getElementById('login-overlay')?.classList.add('hidden');
    const viewportRoot = document.getElementById('app-viewport-root');
    if (viewportRoot instanceof HTMLElement) viewportRoot.style.pointerEvents = 'none';
    originalCanvas.remove();
    const canvas = document.createElement('canvas');
    canvas.id = 'game-canvas';
    document.body.append(canvas);
    Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', display: 'block', zIndex: '0' });
    canvas.style.setProperty('width', '100vw', 'important');
    canvas.style.setProperty('height', '100vh', 'important');
    const modal = document.getElementById('detail-modal');
    if (!(modal instanceof HTMLElement)) throw new Error('詳情彈層不存在');
    modal.style.zIndex = '1';
    const { ActivityPanel } = await import('/src/ui/activity-panel.ts');
    window.__activityDismissProof = { requests: 0, claims: 0 };
    const panel = new ActivityPanel({
      isConnected: () => true,
      socket: {
        sendRequestActivityStatus: () => { window.__activityDismissProof.requests += 1; },
        sendClaimMeritMonthCard: () => { window.__activityDismissProof.claims += 1; },
        sendClaimDailySignIn: () => { window.__activityDismissProof.claims += 1; },
      },
    });
    panel.handleStatus({
      hasRedDot: true,
      monthCard: { active: false, eternal: false, remainingDays: 0, poolTotalMerit: 0, poolRemainingMerit: 0, dailyRewardMerit: 0, offlineMaxHours: 48, heavenlyDaoShopDiscountPercent: 0, dailySignInFixedMeritBonus: 0, itemCount: 0, expireAt: null, canClaimToday: false },
      dailySignIn: { canClaimToday: true, streakDays: 1, totalDays: 1, today: '2026-09-13', lastRewardMerit: null, lastFortune: null, rewardPreview: { expectedRandomMerit: 1, fixedMerit: 0 } },
      invitation: { inviteCode: 'proof', invitePath: '/invite/proof', totalInvitees: 0, qiReachedCount: 0, foundationReachedCount: 0, inviteeReward: { spiritStone: 0, merit: 0 }, stages: [] },
    });
    window.__activityDismissProof.panel = panel;
    return true;
  })()
`;

const openActivity = String.raw`
  (async () => {
    window.__activityDismissProof.panel.open(false);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return !document.getElementById('detail-modal')?.classList.contains('hidden');
  })()
`;

const interactionPoints = String.raw`
  (() => {
    const modal = document.getElementById('detail-modal');
    const card = document.getElementById('detail-modal-card');
    const tab = document.querySelector('.activity-tab');
    const canvas = document.getElementById('game-canvas');
    if (!(modal instanceof HTMLElement) || !(card instanceof HTMLElement) || !(tab instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement)) throw new Error('活動 fixture 結構不完整');
    const cardRect = card.getBoundingClientRect();
    const candidates = [0.08, 0.2, 0.8, 0.92].flatMap((x) => [0.08, 0.2, 0.8, 0.92].map((y) => ({ x: innerWidth * x, y: innerHeight * y })));
    const underlyingAt = (point) => document.elementsFromPoint(point.x, point.y).find((element) => element !== modal && !modal.contains(element));
    const map = candidates.find((point) => (point.x < cardRect.left || point.x > cardRect.right || point.y < cardRect.top || point.y > cardRect.bottom) && underlyingAt(point) === canvas);
    const tabRect = tab.getBoundingClientRect();
    const head = card.querySelector('.ui-modal-head');
    const headRect = head?.getBoundingClientRect();
    if (!map || !headRect) throw new Error('找不到活動真實地圖背景命中點');
    return { map, inner: { x: tabRect.left + tabRect.width / 2, y: tabRect.top + tabRect.height / 2 }, drag: { x: headRect.left + Math.min(80, headRect.width / 2), y: headRect.top + headRect.height / 2 } };
  })()
`;

async function setViewport(cdp, viewport, touch) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: touch, screenWidth: viewport.width, screenHeight: viewport.height });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: touch ? 5 : 1, configuration: touch ? 'mobile' : 'desktop' });
  await delay(60);
}

async function click(cdp, point, touch) {
  if (touch) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1, radiusX: 2, radiusY: 2, force: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  }
  await delay(70);
}

async function assertDismissal(cdp, label, touch) {
  assert.equal(await cdp.evaluate(openActivity), true, `${label}活動未開啟`);
  const points = await cdp.evaluate(interactionPoints);
  await click(cdp, points.inner, touch);
  assert.equal(await cdp.evaluate(`!document.getElementById('detail-modal')?.classList.contains('hidden')`), true, `${label}活動內部點擊誤關閉`);
  await click(cdp, points.map, touch);
  const closed = await cdp.evaluate(`document.getElementById('detail-modal')?.classList.contains('hidden') === true`);
  assert.equal(closed, true, `${label}真實地圖背景點擊未關閉活動`);
}

await withClientBrowserProof({ viewport: DESKTOP, profilePrefix: 'activity-dismiss-proof-' }, async (cdp) => {
  assert.equal(await cdp.evaluate(prepareFixture), true, '活動 proof fixture 未建立');
  await setViewport(cdp, DESKTOP, false);
  await assertDismissal(cdp, '桌面', false);

  assert.equal(await cdp.evaluate(openActivity), true, '桌面拖曳前活動未開啟');
  const desktopPoints = await cdp.evaluate(interactionPoints);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...desktopPoints.drag, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: desktopPoints.drag.x + 80, y: desktopPoints.drag.y + 50, buttons: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: desktopPoints.drag.x + 80, y: desktopPoints.drag.y + 50, button: 'left', clickCount: 1 });
  await delay(70);
  assert.equal(await cdp.evaluate(`!document.getElementById('detail-modal')?.classList.contains('hidden')`), true, '桌面拖曳活動視窗誤關閉');
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await delay(70);
  assert.equal(await cdp.evaluate(`document.getElementById('detail-modal')?.classList.contains('hidden') === true`), true, 'Esc 未關閉活動');

  await setViewport(cdp, PHONE, true);
  await assertDismissal(cdp, '手機直向', true);
});

console.log('activity panel dismiss proof passed');
