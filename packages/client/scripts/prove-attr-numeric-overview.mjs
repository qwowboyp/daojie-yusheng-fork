/** 屬性數值總覽：確認 React/legacy 都不再繪製雷達，且窄螢幕可讀。 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { waitFor, withClientBrowserProof } from './browser-proof-runtime.mjs';

const viewports = [
  { name: 'desktop', width: 1440, height: 900, touch: false },
  { name: 'portrait', width: 390, height: 844, touch: true },
  { name: 'narrow', width: 320, height: 640, touch: true },
  { name: 'landscape', width: 844, height: 390, touch: true },
];

const output = process.env.WORKSPACE_PROOF_OUTPUT_DIR;

async function capture(cdp, name) {
  if (!output) return;
  await mkdir(output, { recursive: true });
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(path.join(output, `${name}.png`), Buffer.from(screenshot.data, 'base64'));
}

const initialize = String.raw`(async () => {
  const { AttrPanel } = await import('/src/ui/panels/attr-panel.ts');
  document.getElementById('game-shell')?.classList.remove('hidden');
  document.getElementById('login-overlay')?.classList.add('hidden');
  document.querySelector('[data-workspace-open="character"]')?.click();
  await new Promise(resolve => requestAnimationFrame(resolve));
  document.getElementById('workspace-tab-attr')?.click();
  await new Promise(resolve => requestAnimationFrame(resolve));
  document.getElementById('pane-attr').classList.add('active');
  const panel = new AttrPanel();
  const attrs = { constitution: 18, spirit: 21, perception: 15, talent: 16, strength: 23, meridians: 19 };
  const stats = {
    maxHp: 860, maxQi: 430, physAtk: 130, spellAtk: 124, physDef: 80, spellDef: 76,
    hit: 50, dodge: 35, crit: 18, antiCrit: 12, critDamage: 0, breakPower: 24, resolvePower: 17,
    maxQiOutputPerTick: 20, qiRegenRate: 12, hpRegenRate: 8, cooldownSpeed: 0, auraCostReduce: 0,
    auraPowerRate: 0, playerExpRate: 0, techniqueExpRate: 0, realmExpPerTick: 5, techniqueExpPerTick: 5,
    lootRate: 0, rareLootRate: 0, moveSpeed: 100, viewRange: 8, actionsPerTurn: 1,
    elementDamageBonus: { metal: 80, wood: 70, water: 60, fire: 50, earth: 40 },
    elementDamageReduce: { metal: 15, wood: 14, water: 13, fire: 12, earth: 11 },
  };
  panel.update({
    baseAttrs: attrs, finalAttrs: attrs, bonuses: [{ source: 'heaven-gate', label: '靈根', attrs: {} }],
    numericStats: stats,
    ratioDivisors: { elementDamageReduce: { metal: 100, wood: 100, water: 100, fire: 100, earth: 100 }, cooldownSpeed: 100 },
    specialStats: { foundation: 100, rootFoundation: 20, bodyTrainingLevel: 0, combatExp: 0, comprehension: 3, luck: 2 },
  });
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return true;
})()`;

for (const renderer of ['react', 'legacy']) {
  await withClientBrowserProof({ viewport: viewports[0], profilePrefix: `attr-numeric-${renderer}-` }, async (cdp) => {
    await cdp.evaluate(`localStorage.setItem('mud:react-panel-flags', JSON.stringify({ attr: ${renderer === 'react'} })); location.reload(); true`);
    await waitFor(() => cdp.evaluate(`document.readyState === 'complete' && document.getElementById('game-shell')?.dataset.workspaceMode === 'true'`), `${renderer} 工作區初始化`);
    assert.equal(await cdp.evaluate(initialize), true);
    for (const viewport of viewports) {
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: viewport.touch, maxTouchPoints: 5 });
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, screenWidth: viewport.width, screenHeight: viewport.height, deviceScaleFactor: 1, mobile: false });
      for (const theme of ['light', 'dark']) {
        await cdp.evaluate(`(async () => {
          const { updateUiColorMode } = await import('/src/ui/ui-style-config.ts');
          updateUiColorMode('${theme}');
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        })()`);
        // 等待正式工作區完成響應式布局；不強制改寫可見性或重送開啟操作。
        await waitFor(() => cdp.evaluate(`(() => {
          const overview = document.querySelector('#pane-attr [data-attr-pane="numeric"]');
          if (!overview) return false;
          const rect = overview.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight;
        })()`), `${renderer}/${viewport.name}/${theme} 數值頁可見`, 3000);
        const result = await cdp.evaluate(`(() => {
          const root = document.getElementById('pane-attr');
          const overview = root.querySelector('[data-attr-pane="numeric"]');
          const sections = [...overview.querySelectorAll('[data-attr-section]')].map(node => node.dataset.attrSection);
          const overviewRect = overview.getBoundingClientRect();
          const attributeGrid = overview.querySelector('[data-attr-section="attributes"] .attr-grid');
          const cards = [...overview.querySelectorAll('.attr-mini')];
          const visibleCards = cards.filter(node => { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight; });
          const scrollHost = [overview, ...function* () { for (let node = overview.parentElement; node; node = node.parentElement) yield node; }()]
            .find(node => node.scrollHeight > node.clientHeight + 1 && ['auto', 'scroll'].includes(getComputedStyle(node).overflowY));
          return { tabs: [...root.querySelectorAll('[data-attr-tab]')].map(node => node.textContent?.trim()), sections,
            radarCount: root.querySelectorAll('svg.attr-radar, [data-pane-kind="radar"]').length,
            text: overview.textContent, overflow: root.scrollWidth > root.clientWidth + 1,
            labels: [...overview.querySelectorAll('.attr-mini-label')].filter(node => getComputedStyle(node).display !== 'none').length,
            visible: overviewRect.width > 0 && overviewRect.height > 0 && overviewRect.bottom > 0 && overviewRect.top < innerHeight,
            visibleCards: visibleCards.length, scrollable: Boolean(scrollHost), gridColumns: getComputedStyle(attributeGrid).gridTemplateColumns };
        })()`);
        assert.deepEqual(result.tabs, ['數值', '鬥法', '靈力', '特殊', '技藝'], `${renderer}/${viewport.name}/${theme} 頁籤未收斂`);
        assert.deepEqual(result.sections, ['attributes', 'roots', 'veins'], `${renderer}/${viewport.name}/${theme} 數值分段遺失`);
        assert.equal(result.radarCount, 0, `${renderer}/${viewport.name}/${theme} 仍繪製雷達`);
        assert.match(result.text, /六維[\s\S]*金靈根[\s\S]*無屬性靈氣/, `${renderer}/${viewport.name}/${theme} 真實數值未完整保留`);
        assert.equal(result.overflow, false, `${renderer}/${viewport.name}/${theme} 屬性面板橫向溢出`);
        assert(result.labels > 0, `${renderer}/${viewport.name}/${theme} 數值卡片沒有可讀標籤`);
        assert.equal(result.visible, true, `${renderer}/${viewport.name}/${theme} 數值頁未實際顯示`);
        assert(result.visibleCards > 0, `${renderer}/${viewport.name}/${theme} 數值頁首屏沒有可見卡片`);
        if (viewport.touch) {
          assert.equal(result.scrollable, true, `${renderer}/${viewport.name}/${theme} 長數值頁無法捲動`);
        }
        if (viewport.width <= 390) {
          assert.equal(result.gridColumns.trim().split(/\s+/).length, 2, `${renderer}/${viewport.name}/${theme} 數值卡片未維持兩欄`);
        }
        if (renderer === 'react' && theme === 'light' && (viewport.name === 'desktop' || viewport.name === 'portrait' || viewport.name === 'narrow')) {
          await capture(cdp, `attr-numeric-${viewport.name}`);
        }
      }
    }
  });
}

console.log('attr numeric overview proof: PASS (React/legacy, desktop/mobile, light/dark)');
