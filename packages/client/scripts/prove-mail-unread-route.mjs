/** 飛書未讀沿角色、社交、飛書入口提示；不污染其它，更新保留焦點與節點。 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withClientBrowserProof, waitFor } from './browser-proof-runtime.mjs';

await withClientBrowserProof({ viewport: { width: 1440, height: 900 }, profilePrefix: 'mail-unread-route-' }, async (cdp) => {
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
    window.__routeMail = new MailPanel({});
    return true;
  })()`);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: viewport.width < 1000, maxTouchPoints: 5 });
    for (const theme of ['light', 'dark']) {
      await cdp.evaluate(`(() => {
        document.documentElement.dataset.colorMode = '${theme}';
        document.querySelector('.workspace-close')?.click();
        window.__routeMail.updateSummary({ unreadCount: 2, claimableCount: 0, revision: 1 });
        document.getElementById('workspace-menu-toggle').click();
        return true;
      })()`);
      await waitFor(() => cdp.evaluate(`!document.getElementById('workspace-menu').hidden && document.querySelector('[data-workspace-open="character"]').dataset.hasUnread === 'true'`), '角色未讀提示');
      const menu = await cdp.evaluate(`(() => {
        const other = document.getElementById('workspace-menu-toggle');
        const role = document.querySelector('[data-workspace-open="character"]');
        const r = role.getBoundingClientRect();
        return { otherUnread: other.dataset.hasUnread, otherLabel: other.getAttribute('aria-label'),
          dot: getComputedStyle(role, '::after').width, visible: r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= innerWidth + 1 };
      })()`);
      assert.notEqual(menu.otherUnread, 'true');
      assert.equal(menu.otherLabel, '其它');
      assert(Number.parseFloat(menu.dot) > 0, '角色入口必須顯示未讀紅點');
      assert.equal(menu.visible, true);
      await cdp.evaluate(`document.querySelector('[data-workspace-open="character"]').click(); true`);
      await waitFor(() => cdp.evaluate(`!!document.getElementById('workspace-tab-social')`), '社交分頁');
      await cdp.evaluate(`document.getElementById('workspace-tab-social').click(); true`);
      await waitFor(() => cdp.evaluate(`document.querySelector('[data-social-menu="mail"]')?.getBoundingClientRect().height > 0`), '飛書入口');
      const route = await cdp.evaluate(`(() => {
        window.__routeTab = document.getElementById('workspace-tab-social');
        window.__routeButton = document.querySelector('[data-social-menu="mail"]');
        window.__routeButton.focus();
        return [window.__routeTab, window.__routeButton].map(node => ({ unread: node.dataset.hasUnread, dot: getComputedStyle(node, '::after').width, label: node.getAttribute('aria-label') }));
      })()`);
      for (const node of route) { assert.equal(node.unread, 'true'); assert.equal(node.dot, '8px'); }
      assert.match(route[1].label, /2 封未讀/);
      if (process.env.WORKSPACE_PROOF_OUTPUT_DIR) {
        await mkdir(process.env.WORKSPACE_PROOF_OUTPUT_DIR, { recursive: true });
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
        await writeFile(path.join(process.env.WORKSPACE_PROOF_OUTPUT_DIR, `mail-route-${viewport.width}-${theme}.png`), Buffer.from(shot.data, 'base64'));
      }
      await cdp.evaluate(`window.__routeMail.updateSummary({ unreadCount: 0, claimableCount: 0, revision: 2 }); true`);
      await waitFor(() => cdp.evaluate(`window.__routeTab.dataset.hasUnread === 'false'`), '已讀清除提示');
      assert.equal(await cdp.evaluate(`(() => {
        const role = document.querySelector('[data-workspace-open="character"]');
        return role.dataset.hasUnread === 'false' && window.__routeButton.dataset.hasUnread === 'false'
          && document.activeElement === window.__routeButton
          && document.getElementById('workspace-tab-social') === window.__routeTab
          && document.querySelector('[data-social-menu="mail"]') === window.__routeButton;
      })()`), true, '已讀更新須保留節點與焦點，並清除三層提示');
      await cdp.evaluate(`window.__routeMail.updateSummary({ unreadCount: 3, claimableCount: 0, revision: 3 }); true`);
      await waitFor(() => cdp.evaluate(`window.__routeTab.dataset.hasUnread === 'true'`), '新飛書提示');
      await cdp.evaluate(`window.__routeMail.clear(); true`);
      await waitFor(() => cdp.evaluate(`window.__routeTab.dataset.hasUnread === 'false' && window.__routeButton.dataset.hasUnread === 'false' && document.querySelector('[data-workspace-open="character"]').dataset.hasUnread === 'false'`), '登出清除三層提示');
    }
  }
});
console.log('mail unread route proof: PASS (6 viewport/theme cases)');
