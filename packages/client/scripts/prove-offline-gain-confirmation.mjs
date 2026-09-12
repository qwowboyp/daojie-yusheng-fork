/**
 * 離線收益確認層 proof：頂部收取、遮罩收取與既有 ACK / Bootstrap 去重語義。
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { delay, withClientBrowserProof } from './browser-proof-runtime.mjs';

const DESKTOP = { width: 1280, height: 720 };
const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };
const outputDir = process.env.WORKSPACE_PROOF_OUTPUT_DIR
  ? path.resolve(process.env.WORKSPACE_PROOF_OUTPUT_DIR)
  : null;

function buildOpenExpression({ count = 24, ackSucceeds = true, prefix = 'offline-proof' } = {}) {
  return String.raw`
    (async () => {
      const modal = await import('/src/ui/offline-gain-modal.ts');
      const now = Date.now();
      const reports = Array.from({ length: ${count} }, (_, index) => ({
        id: ${JSON.stringify(prefix)} + '-' + index,
        playerId: 'offline-proof-player',
        scope: 'offline',
        durationMs: 3_600_000,
        startedAt: now - (index + 1) * 3_600_000,
        endedAt: now - index * 3_600_000,
        spiritStones: { gained: index + 1, lost: 0 },
        progress: [], techniques: [], professions: [], items: [],
      }));
      window.__offlineGainProof = {
        modal,
        ackCalls: 0,
        requests: 0,
        open() {
          modal.handleOfflineGainReports({ reports, preview: true, blocking: true }, {
            getPlayerId: () => 'offline-proof-player',
            ackOfflineGainReports: () => {
              this.ackCalls += 1;
              return ${ackSucceeds};
            },
            requestOfflineGainReports: () => { this.requests += 1; return true; },
            showToast: () => {},
            windowRef: window,
          });
        },
      };
      window.__offlineGainProof.open();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return reports.length;
    })()
  `;
}

const measureExpression = String.raw`
  (() => {
    const body = document.getElementById('detail-modal-body');
    const confirm = document.querySelector('.offline-gain-confirm-btn');
    const card = document.getElementById('detail-modal-card');
    if (!(body instanceof HTMLElement) || !(confirm instanceof HTMLElement) || !(card instanceof HTMLElement)) {
      throw new Error('離線收益確認層結構不完整');
    }
    const bodyRect = body.getBoundingClientRect();
    const confirmRect = confirm.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    return {
      bodyScrollHeight: body.scrollHeight,
      bodyClientHeight: body.clientHeight,
      bodyTop: bodyRect.top,
      bodyBottom: bodyRect.bottom,
      confirmTop: confirmRect.top,
      confirmBottom: confirmRect.bottom,
      confirmHeight: confirmRect.height,
      cardTop: cardRect.top,
      cardBottom: cardRect.bottom,
      visible: confirmRect.top >= bodyRect.top - 1 && confirmRect.bottom <= bodyRect.bottom + 1,
      horizontalOverflow: card.scrollWidth > card.clientWidth + 1,
    };
  })()
`;

const scrollToEndExpression = String.raw`
  (() => {
    const body = document.getElementById('detail-modal-body');
    if (!(body instanceof HTMLElement)) throw new Error('離線收益正文不存在');
    body.scrollTop = body.scrollHeight;
    return body.scrollTop;
  })()
`;

async function setViewport(cdp, viewport, touch) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: touch,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', {
    enabled: touch,
    maxTouchPoints: touch ? 5 : 1,
    configuration: touch ? 'mobile' : 'desktop',
  });
  await delay(60);
}

function assertTopConfirm(layout, label) {
  assert.equal(layout.visible, true, `${label}頂部確認按鈕不可見：${JSON.stringify(layout)}`);
  assert(layout.confirmHeight >= 43.5, `${label}確認按鈕觸控高度不足 44px：${JSON.stringify(layout)}`);
  assert.equal(layout.horizontalOverflow, false, `${label}離線收益彈層出現橫向溢出`);
}

async function setTheme(cdp, theme) {
  await cdp.evaluate(`(async () => {
    const { updateUiColorMode } = await import('/src/ui/ui-style-config.ts');
    updateUiColorMode(${JSON.stringify(theme)});
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`);
}

async function capture(cdp, name) {
  if (!outputDir) return;
  await mkdir(outputDir, { recursive: true });
  const screenshot = await cdp.send('Page.captureScreenshot', {
    format: 'png', fromSurface: true, captureBeyondViewport: false,
  });
  await writeFile(path.join(outputDir, name), Buffer.from(screenshot.data, 'base64'));
}

const interactionPointsExpression = String.raw`
  (() => {
    const modal = document.getElementById('detail-modal');
    const card = document.getElementById('detail-modal-card');
    const row = document.querySelector('.offline-gain-row');
    if (!(modal instanceof HTMLElement) || !(card instanceof HTMLElement) || !(row instanceof HTMLElement)) {
      throw new Error('離線收益真實點擊目標不存在');
    }
    const modalRect = modal.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const candidates = [
      { x: modalRect.left + 8, y: modalRect.top + 8 },
      { x: modalRect.right - 8, y: modalRect.top + 8 },
      { x: modalRect.left + 8, y: modalRect.bottom - 8 },
      { x: modalRect.right - 8, y: modalRect.bottom - 8 },
    ];
    const backdrop = candidates.find((point) => document.elementFromPoint(point.x, point.y) === modal);
    const rowRect = row.getBoundingClientRect();
    const inner = { x: rowRect.left + rowRect.width / 2, y: rowRect.top + rowRect.height / 2 };
    const innerHit = document.elementFromPoint(inner.x, inner.y);
    if (!backdrop || !row.contains(innerHit)) {
      throw new Error('離線收益命中點不正確：' + JSON.stringify({ modalRect, cardRect, backdrop, inner, innerHit: innerHit?.className ?? innerHit?.tagName }));
    }
    return { backdrop, inner };
  })()
`;

async function clickPoint(cdp, point, touch) {
  if (touch) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: point.x, y: point.y, radiusX: 2, radiusY: 2, force: 1, id: 1 }],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1,
    });
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1,
    });
  }
  await delay(80);
}

async function assertRealInputConfirmation(cdp, label, touch) {
  await cdp.evaluate(`(() => {
    const body = document.getElementById('detail-modal-body');
    if (body instanceof HTMLElement) body.scrollTop = 0;
  })()`);
  await delay(40);
  const points = await cdp.evaluate(interactionPointsExpression);
  await clickPoint(cdp, points.inner, touch);
  assert.equal(await cdp.evaluate('window.__offlineGainProof.ackCalls'), 0, `${label}內文點擊誤觸確認`);
  await clickPoint(cdp, points.backdrop, touch);
  await clickPoint(cdp, points.backdrop, touch);
  const result = await cdp.evaluate(`({
    ackCalls: window.__offlineGainProof.ackCalls,
    pending: document.querySelector('.offline-gain-confirm-btn')?.disabled === true,
  })`);
  assert.deepEqual(result, { ackCalls: 1, pending: true }, `${label}背景真實點擊未沿用 pending 去重`);
}

await withClientBrowserProof({ viewport: DESKTOP, profilePrefix: 'offline-gain-confirm-proof-' }, async (cdp) => {
  const modes = [
    { label: '桌面', viewport: DESKTOP, touch: false },
    { label: '手機直向', viewport: PORTRAIT, touch: true },
    { label: '觸控橫向', viewport: LANDSCAPE, touch: true },
  ];
  for (const mode of modes) {
    await setViewport(cdp, mode.viewport, mode.touch);
    for (const theme of ['light', 'dark']) {
      await setTheme(cdp, theme);
      assert.equal(await cdp.evaluate(buildOpenExpression({ prefix: `offline-proof-${mode.label}-${theme}` })), 24, `${mode.label}/${theme}未建立長離線收益預覽`);
      const top = await cdp.evaluate(measureExpression);
      assert(top.bodyScrollHeight > top.bodyClientHeight + 1, `${mode.label}/${theme}長收益未形成捲動內容`);
      assertTopConfirm(top, `${mode.label}/${theme}初始`);
      await capture(cdp, `offline-gain-${mode.label}-${theme}-top.png`);
      await cdp.evaluate(scrollToEndExpression);
      assertTopConfirm(await cdp.evaluate(measureExpression), `${mode.label}/${theme}捲動到底`);
      await capture(cdp, `offline-gain-${mode.label}-${theme}-bottom.png`);
      if (theme === 'light') {
        await assertRealInputConfirmation(cdp, mode.label, mode.touch);
      }
      await cdp.evaluate(`window.__offlineGainProof.modal.resetOfflineGainBlockingConfirmation(); true`);
    }
  }

  await setViewport(cdp, DESKTOP, false);
  await setTheme(cdp, 'light');
  assert.equal(await cdp.evaluate(buildOpenExpression()), 24, '重送測試未建立長收益預覽');
  await assertRealInputConfirmation(cdp, '桌面重送前', false);

  const reDelivery = await cdp.evaluate(`(() => {
    window.__offlineGainProof.open();
    return { ackCalls: window.__offlineGainProof.ackCalls, pending: document.querySelector('.offline-gain-confirm-btn')?.disabled === true };
  })()`);
  assert.deepEqual(reDelivery, { ackCalls: 1, pending: true }, '重連重送預覽破壞確認中的去重狀態');
  await cdp.evaluate(`window.__offlineGainProof.modal.completeOfflineGainBlockingConfirmation(); true`);
  const stalePreview = await cdp.evaluate(`(() => {
    window.__offlineGainProof.open();
    return document.querySelector('.offline-gain-confirm-btn') !== null;
  })()`);
  assert.equal(stalePreview, false, 'ACK 後的舊預覽仍重新開啟確認層');

  await cdp.evaluate(`window.__offlineGainProof.modal.resetOfflineGainBlockingConfirmation(); true`);
  assert.equal(await cdp.evaluate(buildOpenExpression({ ackSucceeds: false, prefix: 'offline-proof-failed' })), 24, '失敗 ACK 測試未建立預覽');
  const failedAck = await cdp.evaluate(`(() => {
    document.getElementById('detail-modal')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return {
      ackCalls: window.__offlineGainProof.ackCalls,
      modalOpen: !document.getElementById('detail-modal')?.classList.contains('hidden'),
      pending: document.querySelector('.offline-gain-confirm-btn')?.disabled === true,
    };
  })()`);
  assert.deepEqual(failedAck, { ackCalls: 1, modalOpen: true, pending: false }, 'ACK 發送失敗時不應關閉或鎖住確認層');
});

console.log('offline gain confirmation proof passed');
