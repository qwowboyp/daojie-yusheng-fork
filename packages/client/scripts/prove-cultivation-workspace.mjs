/** 正式修行三分頁：非空資料、窄窗排版、局部更新與技能管理捲動。 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { delay, waitFor, withClientBrowserProof } from './browser-proof-runtime.mjs';

const output = process.env.WORKSPACE_PROOF_OUTPUT_DIR;
const viewports = [
  { name: 'desktop', width: 1440, height: 900, touch: false },
  { name: 'portrait', width: 390, height: 844, touch: true },
  { name: 'landscape', width: 844, height: 390, touch: true },
];

const initialize = String.raw`(async () => {
  document.getElementById('game-shell').classList.remove('hidden');
  document.getElementById('login-overlay').classList.add('hidden');
  const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const calls = [];
  const techniques = Array.from({ length: 18 }, (_, index) => ({
    techId: 'cultivation-proof-' + index,
    name: ['青木長生訣', '離火歸元功', '太陰凝神篇'][index % 3] + '・' + (index + 1),
    desc: '用於修行布局與動態進度驗證的功法。', level: 3, exp: 200, expToNext: 1000,
    realmLv: 31, realm: 0, strengthPercent: 100, grade: 'earth', category: index % 2 ? 'arts' : 'internal',
    skills: [], layers: Array.from({ length: 9 }, (_, level) => ({ level: level + 1, expToNext: 1000 })),
  }));
  const actions = Array.from({ length: 18 }, (_, index) => ({
    id: 'skill:cultivation-' + index, name: ['青木劍氣', '離火焚心', '玄霜護體'][index % 3] + '・' + (index + 1),
    desc: '凝聚靈氣施展招式，檢查技能長列表與操作布局。', type: 'skill',
    techId: techniques[index].techId, techniqueName: techniques[index].name,
    skillEnabled: true, autoBattleEnabled: index < 14, autoBattleOrder: index,
    cooldownLeft: 0, cooldown: 4, qiCost: 10, requiresTarget: false, targetMode: 'self', range: 3,
  }));
  const player = { id: 'cultivation-proof-player', name: '修行布局驗證', realmLv: 31, level: 31,
    realm: { realmLv: 31, progress: 400, progressToNext: 1200 },
    hp: 3000, maxHp: 3000, qi: 2000, numericStats: { maxQi: 3000, skillSlots: 24 },
    foundation: 120000, bodyTraining: { level: 5, exp: 1000, expToNext: 24883 },
    techniques, pendingTechniqueComprehensions: [], inventory: { capacity: 24, items: [] },
    equipment: {}, artifacts: [], autoBattleSkills: actions.map(action => ({ skillId: action.id, enabled: action.autoBattleEnabled, skillEnabled: true })),
  };
  const { TechniquePanel } = await import('/src/ui/panels/technique-panel.ts');
  const { BodyTrainingPanel } = await import('/src/ui/panels/body-training-panel.ts');
  const { ActionPanel } = await import('/src/ui/panels/action-panel.ts');
  const technique = new TechniquePanel();
  technique.setCallbacks(id => calls.push({ kind: 'cultivate', id }));
  const body = new BodyTrainingPanel();
  body.setInfusionHandler(value => calls.push({ kind: 'infuse', value }));
  const action = new ActionPanel();
  action.setCallbacks(id => calls.push({ kind: 'skill', id }));
  const showSection = ActionPanel.prototype.showWorkspaceSection;
  const hideSection = ActionPanel.prototype.hideWorkspaceSection;
  ActionPanel.prototype.showWorkspaceSection = function(section, host) { return showSection.call(action, section, host); };
  ActionPanel.prototype.hideWorkspaceSection = function() { return hideSection.call(action); };
  technique.update(techniques, techniques[0].techId, player);
  body.update(player.bodyTraining, player.foundation);
  action.update(actions, false, false, player);
  window.__cultivationProof = { paint, calls, player, techniques, actions, technique, body, action };
  document.querySelector('[data-workspace-open="cultivation"]').click();
  await paint();
  return true;
})()`;

async function capture(cdp, name) {
  if (!output) return;
  await mkdir(output, { recursive: true });
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(path.join(output, name + '.png'), Buffer.from(screenshot.data, 'base64'));
}

for (const renderer of ['react', 'legacy']) {
  await withClientBrowserProof({ viewport: viewports[0], profilePrefix: 'cultivation-workspace-' }, async cdp => {
    await cdp.evaluate(`(async () => {
      const { GUIDED_TOUR_FLOWS } = await import('/src/constants/ui/guided-tour.ts');
      localStorage.setItem('mud:guided-tour:v1', JSON.stringify({ completed: {}, dismissed: Object.fromEntries(GUIDED_TOUR_FLOWS.map(flow => [flow.id, flow.storageVersion])) }));
      localStorage.setItem('mud:react-panel-flags', JSON.stringify({ technique: ${renderer === 'react'}, 'body-training': ${renderer === 'react'}, action: ${renderer === 'react'} }));
      location.reload(); return true;
    })()`);
    await waitFor(() => cdp.evaluate(`document.readyState === 'complete' && document.getElementById('game-shell')?.dataset.workspaceMode === 'true'`), '修行正式 shell 初始化');
    assert.equal(await cdp.evaluate(initialize), true);
    for (const viewport of viewports) {
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: viewport.touch, maxTouchPoints: 5 });
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, screenWidth: viewport.width, screenHeight: viewport.height, deviceScaleFactor: 1, mobile: false });
      for (const theme of ['light', 'dark']) {
        await cdp.evaluate(`(async () => { const { updateUiColorMode } = await import('/src/ui/ui-style-config.ts'); updateUiColorMode('${theme}'); await window.__cultivationProof.paint(); })()`);
        for (const tab of ['technique', 'body-training', 'skill']) {
          const layout = await cdp.evaluate(`(async () => {
            document.getElementById('workspace-tab-${tab}').click();
            await window.__cultivationProof.paint();
            const workspace = document.getElementById('game-workspace');
            const pane = workspace.querySelector('.workspace-pane.active');
            pane.scrollTop = 0;
            const rect = workspace.getBoundingClientRect();
            const paneRect = pane.getBoundingClientRect();
            const firstCard = pane.querySelector('[data-tech-card], .body-training-card, [data-action-card]')?.getBoundingClientRect();
            return { width: rect.width, height: rect.height, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
              compact: workspace.dataset.compact, overflow: pane.scrollWidth > pane.clientWidth + 1,
              firstCardVisible: firstCard ? Math.min(firstCard.bottom, paneRect.bottom) - Math.max(firstCard.top, paneRect.top) : 0,
              cards: pane.querySelectorAll('[data-tech-card], .body-training-card, [data-action-card]').length,
              text: pane.textContent };
          })()`);
          assert.equal(layout.compact, 'true');
          assert(layout.left >= -1 && layout.top >= -1 && layout.right <= viewport.width + 1 && layout.bottom <= viewport.height + 1, `${renderer}/${viewport.name}/${tab} 視窗越界`);
          assert.equal(layout.overflow, false, `${renderer}/${viewport.name}/${tab} 出現橫向溢出`);
          assert(layout.cards > 0, `${renderer}/${tab} 非空內容沒有掛入`);
          assert(layout.firstCardVisible >= 24, `${renderer}/${viewport.name}/${tab} 首屏只剩工具列`);
          if (!viewport.touch) assert(layout.width <= 650 && layout.height <= 550, '修行仍沿用大型工作窗');
          if (viewport.name === 'portrait') assert(layout.height <= 560, '手機修行工作窗過高');
          if (tab === 'body-training') assert.match(layout.text, /120,?000|12萬/);
          await capture(cdp, `cultivation-${renderer}-${viewport.name}-${theme}-${tab}`);
        }
      }
      const manage = await cdp.evaluate(`(async () => {
        document.querySelector('[data-action-skill-manage-open]').click();
        await window.__cultivationProof.paint();
        const card = document.getElementById('detail-modal-card');
        const list = card.querySelector('.skill-manage-list');
        const rect = card.getBoundingClientRect();
        const body = document.getElementById('detail-modal-body');
        const rowRect = list?.firstElementChild?.getBoundingClientRect();
        const bodyRect = body.getBoundingClientRect();
        return { width: rect.width, height: rect.height, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
          firstRowVisible: rowRect ? Math.min(rowRect.bottom, bodyRect.bottom) - Math.max(rowRect.top, bodyRect.top) : 0,
          batchOpen: card.querySelector('[data-skill-manage-batch-details]').open,
          rows: list?.children.length ?? 0, scrollable: list ? list.scrollHeight > list.clientHeight : false };
      })()`);
      assert(manage.rows > 0, '技能管理未顯示非空列表');
      assert.equal(manage.batchOpen, false, '批次調整不應預設占據首屏');
      assert(manage.firstRowVisible >= 24, `${renderer}/${viewport.name} 技能管理首屏沒有技能內容`);
      assert(manage.left >= -1 && manage.top >= -1 && manage.right <= viewport.width + 1 && manage.bottom <= viewport.height + 1, '技能管理視窗越界');
      if (!viewport.touch) assert(manage.width <= 980 && manage.height <= 650, '技能管理仍強制超大視窗');
      await capture(cdp, `cultivation-${renderer}-${viewport.name}-skill-management`);
      const continuity = await cdp.evaluate(`(async () => {
        const proof = window.__cultivationProof;
        const list = document.querySelector('.skill-manage-list');
        list.scrollTop = Math.min(120, list.scrollHeight - list.clientHeight);
        const before = list.scrollTop;
        proof.actions[0].cooldownLeft = 2;
        proof.action.syncDynamic(proof.actions, false, false, proof.player);
        await proof.paint();
        return { same: list === document.querySelector('.skill-manage-list'), before, after: document.querySelector('.skill-manage-list').scrollTop };
      })()`);
      assert.equal(continuity.same, true, '技能動態更新替換管理列表');
      assert(Math.abs(continuity.before - continuity.after) <= 1, '技能動態更新破壞列表捲動');
      const expanded = await cdp.evaluate(`(async () => {
        document.querySelector('[data-skill-manage-batch-details]').open = true;
        document.querySelector('[data-skill-manage-filter-toggle]').click();
        await window.__cultivationProof.paint();
        const body = document.getElementById('detail-modal-body');
        const list = document.querySelector('.skill-manage-list');
        list.lastElementChild.scrollIntoView({ block: 'end' });
        const row = list.lastElementChild.getBoundingClientRect();
        const rect = body.getBoundingClientRect();
        return { batchOpen: document.querySelector('[data-skill-manage-batch-details]').open,
          scrollable: getComputedStyle(body).overflowY === 'auto',
          lastRowVisible: Math.min(row.bottom, rect.bottom) - Math.max(row.top, rect.top) };
      })()`);
      assert.equal(expanded.batchOpen, true, '技能管理重繪收起批次調整');
      assert.equal(expanded.scrollable, true, '展開控制後正文無法捲動');
      assert(expanded.lastRowVisible >= 24, '展開控制後無法到達技能列表末端');
      await cdp.evaluate(`(() => {
        document.querySelector('[data-skill-manage-batch-details]').open = false;
        document.querySelector('[data-skill-manage-filter-toggle]').click();
        document.querySelector('[data-skill-manage-cancel]').click();
      })()`);
      await delay(40);
    }
  });
}
console.log('cultivation workspace proof: PASS (React/legacy, desktop/mobile, light/dark)');
