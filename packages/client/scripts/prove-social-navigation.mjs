/** 正式 shell：角色社交導覽、飛書未讀狀態與系統緊湊入口。無登入與持久化資料。 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { delay, withClientBrowserProof, waitFor } from './browser-proof-runtime.mjs';

await withClientBrowserProof({ viewport: { width: 1440, height: 900 }, profilePrefix: 'social-navigation-' }, async (cdp) => {
  await cdp.evaluate(`(async () => {
    const { GUIDED_TOUR_FLOWS } = await import('/src/constants/ui/guided-tour.ts');
    localStorage.setItem('mud:guided-tour:v1', JSON.stringify({ completed: {}, dismissed: Object.fromEntries(GUIDED_TOUR_FLOWS.map(flow => [flow.id, flow.storageVersion])) }));
    location.reload(); return true;
  })()`);
  await waitFor(() => cdp.evaluate(`document.getElementById('game-shell')?.dataset.workspaceMode === 'true'`), '導覽初始化');
  await cdp.evaluate(`(async () => {
    document.getElementById('game-shell').classList.remove('hidden');
    document.getElementById('login-overlay').classList.add('hidden');
    const { MailPanel } = await import('/src/ui/mail-panel.ts');
    window.__mailNavigation = new MailPanel({});
    return true;
  })()`);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false });
    for (const theme of ['light', 'dark']) {
      await cdp.evaluate(`(async () => {
        document.documentElement.dataset.colorMode = '${theme}';
        const { detailModalHost } = await import('/src/ui/detail-modal-host.ts');
        detailModalHost.close('mail-panel');
        window.__mailNavigation.updateSummary({ unreadCount: 2, claimableCount: 0, revision: 1 });
        document.querySelector('[data-workspace-open="character"]').click();
        return true;
      })()`);
      await delay(120);
      await cdp.evaluate(`document.getElementById('workspace-tab-social').click(); true`);
      await delay(100);
      const social = await cdp.evaluate(`(() => {
        const tab = document.getElementById('workspace-tab-social');
        const mail = document.querySelector('[data-social-menu="mail"]');
        const dot = getComputedStyle(mail, '::after');
        return { workspace: document.getElementById('game-workspace').dataset.workspace,
          standalone: !!document.querySelector('[data-workspace-open="social"]'), topMail: !!document.getElementById('hud-open-mail'),
          tabUnread: tab.dataset.hasUnread, mailUnread: mail.dataset.hasUnread,
          label: mail.getAttribute('aria-label'), dotColor: dot.backgroundColor, dotWidth: dot.width,
          visible: mail.getBoundingClientRect().height > 0 };
      })()`);
      assert.equal(social.workspace, 'character');
      assert.equal(social.standalone, false);
      assert.equal(social.topMail, false);
      assert.equal(social.tabUnread, 'true');
      assert.equal(social.mailUnread, 'true');
      assert.equal(social.visible, true);
      assert.match(social.label, /2 封未讀/);
      assert.equal(social.dotWidth, '8px');
      assert.notEqual(social.dotColor, 'rgba(0, 0, 0, 0)');
      await cdp.evaluate(`document.getElementById('workspace-tab-attr').click(); window.__mailNavigation.updateSummary({ unreadCount: 0, claimableCount: 0, revision: 2 }); true`);
      await delay(60);
      await cdp.evaluate(`document.getElementById('workspace-tab-social').click(); true`);
      await delay(60);
      assert.equal(await cdp.evaluate(`document.getElementById('workspace-tab-social').dataset.hasUnread`), 'false');
      assert.equal(await cdp.evaluate(`document.querySelector('[data-social-menu="mail"]').dataset.hasUnread`), 'false');
      await cdp.evaluate(`document.querySelector('[data-social-menu="mail"]').click(); true`);
      await delay(100);
      assert.equal(await cdp.evaluate(`!document.getElementById('detail-modal').classList.contains('hidden') && document.getElementById('detail-modal-card').classList.contains('detail-modal--mail')`), true, '飛書入口未開啟正式郵件面板');
      await cdp.evaluate(`(async () => { const { detailModalHost } = await import('/src/ui/detail-modal-host.ts'); detailModalHost.close('mail-panel'); document.querySelector('[data-workspace-open="world"]').click(); return true; })()`);
      await delay(60);
      await waitFor(() => cdp.evaluate(`document.getElementById('game-workspace').dataset.workspace === 'world' && !!document.querySelector('.workspace-shortcuts')`), '世界分頁開啟');
      assert.equal(await cdp.evaluate(`document.querySelector('.workspace-shortcuts').textContent.includes('史書')`), false);
      await cdp.evaluate(`document.querySelector('[data-workspace-open="system"]').click(); true`);
      await delay(100);
      const system = await cdp.evaluate(`(() => {
        const buttons = [...document.querySelectorAll('#workspace-system-content button')].filter(b => !b.hidden);
        return { chronicle: document.querySelector('#workspace-system-content #hud-open-chronicle')?.getBoundingClientRect().height,
          buttons: buttons.map(b => { const r = b.getBoundingClientRect(); return { width: r.width, height: r.height, bounded: r.right <= innerWidth + 1 && r.left >= 0 }; }) };
      })()`);
      assert(system.chronicle >= 43.9, '史書未移入系統與協助：' + JSON.stringify({ viewport, theme, system }));
      for (const button of system.buttons) {
        assert(button.height >= 43.9 && button.height <= 48, '系統按鈕高度不緊湊或觸控區不足');
        assert(button.width < 190 && button.bounded, '系統按鈕過寬或越界');
      }
      if (process.env.WORKSPACE_PROOF_OUTPUT_DIR) {
        await mkdir(process.env.WORKSPACE_PROOF_OUTPUT_DIR, { recursive: true });
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
        await writeFile(path.join(process.env.WORKSPACE_PROOF_OUTPUT_DIR, `system-${viewport.width}-${theme}.png`), Buffer.from(shot.data, 'base64'));
      }
    }
  }
  await cdp.evaluate(`window.__mailNavigation.clear(); true`);
  assert.equal(await cdp.evaluate(`document.querySelector('[data-workspace-open=\"character\"]').dataset.hasUnread`), 'false');
});
console.log('social navigation proof: PASS');
