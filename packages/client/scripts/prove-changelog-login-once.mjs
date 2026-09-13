/**
 * 史書登入提示 proof：最新版本對每位玩家僅開啟一次，並且 Bootstrap 會在離線收益確認完成後才觸發。
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { withClientBrowserProof } from './browser-proof-runtime.mjs';

const bootstrapSource = await readFile(new URL('../src/main-bootstrap-assembly.ts', import.meta.url), 'utf8');

assert.match(
  bootstrapSource,
  /completeOfflineGainBlockingConfirmation\(\);\s+changelogPanel\?\.openForFirstLoginAfterUpdate\(data\.self\?\.id, options\.windowRef\);/,
  'Bootstrap 必須在離線收益確認成功並關閉阻塞層後，才開啟史書提示',
);

await withClientBrowserProof({
  viewport: { width: 1280, height: 720 },
  profilePrefix: 'changelog-login-once-proof-',
}, async (cdp) => {
  const result = await cdp.evaluate(`(async () => {
    const { ChangelogPanel } = await import('/src/ui/changelog-panel.ts');
    const { getLatestChangelogVersion } = await import('/src/ui/changelog-data.ts');
    const { detailModalHost } = await import('/src/ui/detail-modal-host.ts');
    const offlineGain = await import('/src/ui/offline-gain-modal.ts');
    const version = getLatestChangelogVersion();
    if (!version) throw new Error('測試前提失敗：史書沒有最新版本');
    const playerId = 'changelog-login-proof-player';
    const storageKey = 'mud:changelog-login-seen:v1:' + encodeURIComponent(playerId);
    localStorage.removeItem(storageKey);
    const panel = new ChangelogPanel();

    const firstOpen = panel.openForFirstLoginAfterUpdate(playerId, window);
    const modalOpen = detailModalHost.isOpenFor('changelog-panel');
    const firstStoredVersion = localStorage.getItem(storageKey);
    detailModalHost.close('changelog-panel');

    const repeatedOpen = panel.openForFirstLoginAfterUpdate(playerId, window);
    const rebuiltPanelOpen = new ChangelogPanel().openForFirstLoginAfterUpdate(playerId, window);
    const otherPlayerOpen = panel.openForFirstLoginAfterUpdate('changelog-login-proof-other', window);
    detailModalHost.close('changelog-panel');

    const updatedPlayerId = 'changelog-login-proof-updated';
    const updatedStorageKey = 'mud:changelog-login-seen:v1:' + encodeURIComponent(updatedPlayerId);
    localStorage.setItem(updatedStorageKey, 'older-version');
    const updatedOpen = panel.openForFirstLoginAfterUpdate(updatedPlayerId, window);
    const updatedStoredVersion = localStorage.getItem(updatedStorageKey);
    detailModalHost.close('changelog-panel');

    const unavailableStoragePanel = new ChangelogPanel();
    const unavailableStorage = {
      getItem() { throw new Error('storage unavailable'); },
      setItem() { throw new Error('storage unavailable'); },
    };
    const unavailableFirstOpen = unavailableStoragePanel.openForFirstLoginAfterUpdate('changelog-login-proof-unavailable', unavailableStorage);
    detailModalHost.close('changelog-panel');
    const unavailableRepeatedOpen = unavailableStoragePanel.openForFirstLoginAfterUpdate('changelog-login-proof-unavailable', unavailableStorage);

    const createBlockingReport = (id) => ({
      id,
      playerId: 'offline-changelog-proof-player',
      scope: 'offline',
      durationMs: 3_600_000,
      startedAt: Date.now() - 3_600_000,
      endedAt: Date.now(),
      spiritStones: { gained: 1, lost: 0 },
      progress: [], techniques: [], professions: [], items: [],
    });
    const openBlockingGain = (id, ackSucceeds) => {
      offlineGain.handleOfflineGainReports({ reports: [createBlockingReport(id)], preview: true, blocking: true }, {
        getPlayerId: () => 'offline-changelog-proof-player',
        ackOfflineGainReports: () => ackSucceeds,
        requestOfflineGainReports: () => true,
        showToast: () => {},
        windowRef: window,
      });
      const confirm = document.querySelector('.offline-gain-confirm-btn');
      if (!(confirm instanceof HTMLButtonElement)) throw new Error('離線收益確認按鈕不存在');
      confirm.click();
    };

    const failedPlayerId = 'changelog-login-proof-failed-confirm';
    const failedStorageKey = 'mud:changelog-login-seen:v1:' + encodeURIComponent(failedPlayerId);
    localStorage.removeItem(failedStorageKey);
    offlineGain.resetOfflineGainBlockingConfirmation();
    openBlockingGain('offline-changelog-proof-failed', false);
    const failedConfirmModalOpen = detailModalHost.isOpenFor('offline-gain-reports');
    const failedConfirmChangelogOpen = new ChangelogPanel().openForFirstLoginAfterUpdate(failedPlayerId, window);
    const failedConfirmStoredVersion = localStorage.getItem(failedStorageKey);
    offlineGain.resetOfflineGainBlockingConfirmation();

    const completedPlayerId = 'changelog-login-proof-completed-confirm';
    const completedStorageKey = 'mud:changelog-login-seen:v1:' + encodeURIComponent(completedPlayerId);
    localStorage.removeItem(completedStorageKey);
    openBlockingGain('offline-changelog-proof-completed', true);
    const blockedBeforeCompletion = new ChangelogPanel().openForFirstLoginAfterUpdate(completedPlayerId, window);
    const pendingBeforeCompletion = document.querySelector('.offline-gain-confirm-btn')?.disabled === true;
    offlineGain.completeOfflineGainBlockingConfirmation();
    const closedAfterCompletion = !detailModalHost.isOpenFor('offline-gain-reports');
    const openedAfterCompletion = new ChangelogPanel().openForFirstLoginAfterUpdate(completedPlayerId, window);
    const completedStoredVersion = localStorage.getItem(completedStorageKey);
    detailModalHost.close('changelog-panel');

    return {
      firstOpen, modalOpen, firstStoredVersion, repeatedOpen, rebuiltPanelOpen, otherPlayerOpen,
      updatedOpen, updatedStoredVersion, unavailableFirstOpen, unavailableRepeatedOpen,
      failedConfirmModalOpen, failedConfirmChangelogOpen, failedConfirmStoredVersion,
      blockedBeforeCompletion, pendingBeforeCompletion, closedAfterCompletion,
      openedAfterCompletion, completedStoredVersion, version,
    };
  })()`);

  assert.deepEqual(
    result,
    {
      firstOpen: true,
      modalOpen: true,
      firstStoredVersion: result.version,
      repeatedOpen: false,
      rebuiltPanelOpen: false,
      otherPlayerOpen: true,
      updatedOpen: true,
      updatedStoredVersion: result.version,
      unavailableFirstOpen: true,
      unavailableRepeatedOpen: false,
      failedConfirmModalOpen: true,
      failedConfirmChangelogOpen: false,
      failedConfirmStoredVersion: null,
      blockedBeforeCompletion: false,
      pendingBeforeCompletion: true,
      closedAfterCompletion: true,
      openedAfterCompletion: true,
      completedStoredVersion: result.version,
      version: result.version,
    },
    `史書登入提示去重或版本更新行為錯誤：${JSON.stringify(result)}`,
  );
});

console.log('changelog login-once proof passed');
