/** 正式 ChatUI 戰報排版：結構化 payload、方向語意、響應式與捲動連續性 proof。 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withClientBrowserProof } from './browser-proof-runtime.mjs';

const MARKER = 'REPAIR_PROOF:COMBAT_LOG_PRESENTATION:PASS';
const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 產物是人工查閱用的執行輸出；不得加入提交。
const artifactDir = process.env.COMBAT_LOG_PROOF_ARTIFACT_DIR
  ? path.resolve(process.env.COMBAT_LOG_PROOF_ARTIFACT_DIR)
  : path.resolve(clientRoot, '..', '..', 'test-results', 'combat-log-presentation');

const modes = [
  { id: 'desktop-light', width: 1280, height: 800, mobile: false, colorMode: 'light' },
  { id: 'desktop-dark', width: 1280, height: 800, mobile: false, colorMode: 'dark' },
  { id: 'phone-light', width: 375, height: 844, mobile: true, colorMode: 'light' },
  { id: 'phone-dark', width: 375, height: 844, mobile: true, colorMode: 'dark' },
  { id: 'landscape-light', width: 844, height: 390, mobile: true, colorMode: 'light' },
  { id: 'landscape-dark', width: 844, height: 390, mobile: true, colorMode: 'dark' },
];

async function setMode(cdp, mode, { textScale = 1, reduceMotion = false } = {}) {
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
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduceMotion ? 'reduce' : 'no-preference' }] });
  await cdp.evaluate(`document.documentElement.dataset.colorMode = ${JSON.stringify(mode.colorMode)}; document.documentElement.style.fontSize = ${JSON.stringify(`${textScale * 100}%`)};`);
}

async function capture(cdp, name) {
  await cdp.evaluate(`document.querySelector('[data-chat-pane="combat"] .chat-log')?.scrollTo({ top: 0 });`);
  await cdp.evaluate(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png', fromSurface: true, captureBeyondViewport: false,
  });
  await writeFile(path.join(artifactDir, `${name}.png`), Buffer.from(result.data, 'base64'));
}

const mountAndExercise = String.raw`
  (async () => {
    const buildPanel = () => {
      document.querySelector('#combat-proof-host')?.remove();
      document.getElementById('chat-panel')?.remove();
      for (const child of Array.from(document.body.children)) child.style.display = 'none';
      const host = document.createElement('main');
      host.id = 'combat-proof-host';
      host.style.cssText = 'position:fixed;inset:0;isolation:isolate;overflow:hidden;padding:12px;background:var(--surface-base);color:var(--ink-dark);box-sizing:border-box;';
      const panel = document.createElement('section');
      panel.id = 'chat-panel';
      panel.className = 'chat-panel';
      panel.innerHTML = '<div class="section-tabs chat-tabs">'
        + '<button data-chat-fixed-channel="system" data-chat-unread-host="system" type="button">系統</button>'
        + '<button data-chat-fixed-channel="combat" data-chat-unread-host="combat" type="button">戰報</button>'
        + ['channel-1', 'channel-2', 'channel-3'].map((slot) => '<div class="chat-channel-slot" data-chat-slot-host="' + slot + '" data-chat-unread-host="' + slot + '"><button class="tab-btn chat-channel-main" data-chat-slot-activate="' + slot + '" type="button">附近</button><select data-chat-slot-select="' + slot + '"><option value="nearby">附近</option><option value="world">世界</option><option value="grudge">恩怨</option><option value="sect">宗門</option><option value="party">隊伍</option></select></div>').join('')
        + '</div><div class="chat-log-stack">'
        + ['system', 'combat', 'grudge', 'nearby', 'world', 'sect', 'party'].map((channel) => '<div data-chat-pane="' + channel + '"><div class="chat-log"></div></div>').join('')
        + '</div><div class="chat-compose"><input id="chat-input"><button id="chat-send" type="button">發送</button></div>';
      host.appendChild(panel);
      document.body.appendChild(host);
    };
    buildPanel();
    const { ChatUI } = await import('/src/ui/chat.ts');
    const chat = new ChatUI();
    chat.setPersistenceScope('combat-proof-player|map-proof|instance-proof|sect-proof');
    chat.setLogbookVisible(true);
    document.querySelector('[data-chat-fixed-channel="combat"]')?.click();
    const combatPane = document.querySelector('[data-chat-pane="combat"]');
    combatPane.classList.add('active');
    combatPane.style.display = 'block';
    const proofLog = document.querySelector('[data-chat-pane="combat"] .chat-log');
    proofLog.style.height = 'calc(100dvh - 130px)';
    proofLog.style.maxHeight = 'calc(100dvh - 130px)';
    proofLog.style.overflowY = 'auto';
    const add = async (id, combat, extra = {}) => {
      const added = await chat.addMessage('結構化戰報 proof', undefined, 'combat', { id, at: 1_790_000_000_000 + Number(id.replace(/\D/g, '') || 0), combat, ...extra });
      const currentLog = document.querySelector('[data-chat-pane="combat"] .chat-log');
      currentLog.scrollTop = currentLog.scrollHeight;
      return added;
    };
    const hit = (caster, target, damage, extra = {}) => ({ caster, target, skill: '赤霄劍訣', resolution: { rawDamage: damage + 25, damage, damageKind: 'physical', element: 'fire', ...extra } });
    await add('combat-01', hit('你', '青狼', 128));
    await add('combat-02', hit('青狼', '你', 77));
    await add('combat-03', hit('你', '影狼', 0, { dodged: true }));
    await add('combat-04', hit('影狼', '你', 0, { dodged: true }));
    await add('combat-05', hit('野修甲', '青狼', 0));
    await add('combat-06', { ...hit('你', '玄甲傀儡', 666, { crit: true, broken: true, resolved: true }), effects: [{ type: 'buff', category: 'buff', name: '護體靈光' }, { type: 'debuff', name: '灼魂' }] });
    await add('combat-07', { caster: '你', target: '自身', skill: '凝神訣', effects: [{ type: 'buff', category: 'buff', name: '靜心' }] });
    await add('combat-08', { caster: '毒霧妖', target: '你', skill: '蝕骨霧', effects: [{ type: 'debuff', name: '蝕骨' }] });
    await add('combat-09', { caster: '你', target: '自身', skill: '回春術', effects: [{ type: 'heal', amount: 88 }] });
    await add('combat-10', { caster: '你', target: '自身', skill: '凝神訣', effects: [{ type: 'buff', name: '未知狀態' }] });
    await add('combat-10c', { caster: '道友乙', target: '你', skill: '回春術', effects: [{ type: 'heal', amount: 55 }, { type: 'buff', category: 'buff', name: '回春護佑' }] });
    await add('combat-10b', hit('野修甲', '青狼', 53));
    const aoeGroup = [hit('你', '狼群', 314), hit('你', '狼王', 271), hit('狼王', '你', 119)];
    for (let index = 0; index < 28; index += 1) aoeGroup.push(hit('你', '演練傀儡' + index, index + 1));
    await add('combat-11', aoeGroup[0], { combatGroup: aoeGroup });
    await add('combat-12', { caster: '陣靈', target: '你', skill: '五行陣', formationResolution: { rawDamage: 312, damage: 245, damageKind: 'spell', element: 'water', auraDamage: 18 } });
    await add('combat-13', { caster: '你', target: '群狼', skill: '萬劍訣', summary: { enemy: { targetCount: 6, hitCount: 5, totalDamage: 1550, defeatedCount: 2 } } });
    await chat.addMessage('擊殺通知 proof', undefined, 'combat', { id: 'combat-kill', at: 1_790_000_000_099, structuredGroup: [
      { key: 'notice.combat.killed-batch', vars: { targetList: '青狼、狼王', count: 3, extraCount: 1 } },
    ] });

    const log = document.querySelector('[data-chat-pane="combat"] .chat-log');
    // 以長記錄底部留白模擬玩家回看歷史，驗證增量追加不會搶走既有捲動位置。
    log.style.paddingBlockEnd = '600px';
    const firstLine = log.querySelector('[data-chat-message-id="combat-01"]');
    const firstRow = firstLine?.querySelector('.chat-combat-row');
    log.scrollTop = Math.max(1, Math.floor(log.scrollHeight / 3));
    const manualScrollTop = log.scrollTop;
    await chat.addMessage('結構化戰報 proof', undefined, 'combat', { id: 'manual-scroll', at: 1_790_000_000_100, combat: hit('你', '捲動守衛', 404) });
    const afterManualScrollTop = log.scrollTop;
    const rows = Array.from(log.querySelectorAll('.chat-combat-row'));
    const damagePills = Array.from(log.querySelectorAll('.chat-combat-amount'));
    const tooltipCandidate = damagePills.find((element) => element.dataset.chatDamageTooltipTitle && element.dataset.chatDamageTooltipLines);
    if (tooltipCandidate) tooltipCandidate.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 41 }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      rowCount: rows.length,
      rowDirections: rows.map((row) => row.dataset.direction),
      directionTexts: rows.map((row) => row.querySelector('.chat-combat-direction')?.textContent?.trim() ?? ''),
      actorTexts: rows.filter((row) => row.querySelector('.chat-combat-actors')).map((row) => row.querySelector('.chat-combat-actors')?.textContent?.trim() ?? ''),
      resultTexts: rows.map((row) => row.querySelector('.chat-combat-result')?.textContent?.trim() ?? ''),
      times: Array.from(log.querySelectorAll('.chat-combat-time')).map((time) => ({ text: time.textContent?.trim() ?? '', title: time.getAttribute('title') ?? '' })),
      effects: Array.from(log.querySelectorAll('.chat-combat-effect')).map((element) => ({ className: element.className, text: element.textContent?.trim() ?? '' })),
      tooltipCount: damagePills.filter((element) => element.dataset.chatDamageTooltipTitle && element.dataset.chatDamageTooltipLines).length,
      damageCounts: rows.map((row) => row.querySelectorAll('.chat-combat-amount').length),
      multiEffect: { damages: log.querySelector('[data-chat-message-id="combat-06"]')?.querySelectorAll('.chat-combat-amount').length ?? 0, effects: Array.from(log.querySelectorAll('[data-chat-message-id="combat-06"] .chat-combat-effect')).map((effect) => effect.textContent?.trim() ?? '') },
      incomingEffects: { direction: log.querySelector('[data-chat-message-id="combat-10c"] .chat-combat-row')?.dataset.direction ?? '', label: log.querySelector('[data-chat-message-id="combat-10c"] .chat-combat-direction')?.textContent?.trim() ?? '', effects: Array.from(log.querySelectorAll('[data-chat-message-id="combat-10c"] .chat-combat-effect')).map((effect) => effect.textContent?.trim() ?? '') },
      formationText: log.querySelector('[data-chat-message-id="combat-12"]')?.textContent?.trim() ?? '',
      killedText: log.querySelector('[data-chat-message-id="combat-kill"]')?.textContent?.trim() ?? '',
      killedDirection: log.querySelector('[data-chat-message-id="combat-kill"] .chat-combat-row')?.dataset.direction ?? '',
      preservedIdentity: firstLine === log.querySelector('[data-chat-message-id="combat-01"]') && firstRow === log.querySelector('[data-chat-message-id="combat-01"] .chat-combat-row'),
      contrastSamples: (() => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const context = canvas.getContext('2d', { willReadFrequently: true });
        const rgba = (value) => { context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1); const pixel = context.getImageData(0, 0, 1, 1).data; return [pixel[0], pixel[1], pixel[2], pixel[3] / 255]; };
        const mix = (front, back) => [...[0, 1, 2].map((index) => front[index] * front[3] + back[index] * (1 - front[3])), front[3] + back[3] * (1 - front[3])];
        const lum = (rgb) => rgb.slice(0, 3).map((channel) => { const value = channel / 255; return value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
        const backgroundFor = (element) => { const path = []; for (let cursor = element; cursor; cursor = cursor.parentElement) path.push(cursor); let background = rgba(getComputedStyle(document.documentElement).backgroundColor); for (const ancestor of path.reverse()) background = mix(rgba(getComputedStyle(ancestor).backgroundColor), background); return background; };
        return Array.from(log.querySelectorAll('.chat-combat-direction, .chat-combat-actors, .chat-combat-result, .chat-combat-amount, .chat-combat-time, .chat-skill-pill, .chat-combat-effect-label, .chat-combat-effect-name')).map((element) => { const foreground = rgba(getComputedStyle(element).color); const background = backgroundFor(element); return (Math.max(lum(foreground), lum(background)) + .05) / (Math.min(lum(foreground), lum(background)) + .05); });
      })(),
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth,
      manualScrollTop,
      afterManualScrollTop,
      touchTooltipVisible: Boolean(document.querySelector('[role="tooltip"]:not(.hidden), .floating-tooltip:not(.hidden)')),
      logHeight: log.scrollHeight,
      logClientHeight: log.clientHeight,
      viewportHeight: innerHeight,
    };
  })()
`;

await mkdir(artifactDir, { recursive: true });
let screenshots = 0;
const contrastMins = [];
await withClientBrowserProof({ viewport: { width: 1280, height: 800 }, profilePrefix: 'combat-log-presentation-' }, async (cdp) => {
  for (const mode of modes) {
    await setMode(cdp, mode);
    const result = await cdp.evaluate(mountAndExercise);
    assert.ok(result.rowCount >= 46, `${mode.id} 未將每個 combat payload 渲染為戰報列（目前 ${result.rowCount}）`);
    assert.deepEqual(new Set(result.rowDirections), new Set(['outgoing', 'incoming', 'self', 'other']), `${mode.id} 缺少混合施法者方向判定`);
    for (const direction of ['出手', '受擊', '自身', '戰況']) assert.ok(result.directionTexts.includes(direction), `${mode.id} 缺少方向文字 ${direction}`);
    assert.ok(result.actorTexts.every((text) => text.includes('→')), `${mode.id} 演員欄必須顯示 caster → target`);
    for (const resultText of ['命中', '你閃避', '對方閃避']) assert.ok(result.resultTexts.includes(resultText), `${mode.id} 缺少結果語意 ${resultText}`);
    assert.ok(result.times.every(({ text, title }) => text.length > 0 && title.length > text.length), `${mode.id} 短時間與完整日期 title 缺失`);
    for (const effect of ['增益', '減益', '治療', '狀態']) assert.ok(result.effects.some((entry) => entry.text.includes(effect)), `${mode.id} 缺少 ${effect} effect 語意`);
    for (const style of ['buff', 'debuff', 'heal']) assert.ok(result.effects.some((entry) => entry.className.includes(`chat-combat-effect--${style}`)), `${mode.id} 缺少 ${style} effect class`);
    assert.ok(result.tooltipCount >= 5, `${mode.id} 傷害 tooltip contract 遺失`);
    assert.ok(result.damageCounts.every((count) => count <= 1), `${mode.id} 傷害加多 effects 時重複輸出傷害`);
    assert.deepEqual(result.multiEffect, { damages: 1, effects: ['增益護體靈光', '減益灼魂'] }, `${mode.id} 傷害加兩種 effects 未保持單一傷害與雙效果`);
    assert.equal(result.incomingEffects.direction, 'incoming', `${mode.id} incoming 純效果方向錯誤`);
    assert.equal(result.incomingEffects.label, '受術', `${mode.id} incoming 純效果未以受術語意呈現`);
    assert.ok(result.incomingEffects.effects.some((text) => text.includes('治療+55') && text.includes('生命')) && result.incomingEffects.effects.some((text) => text.includes('增益回春護佑')), `${mode.id} incoming 純效果缺少治療或正面效果`);
    assert.match(result.formationText, /削減靈力 18/, `${mode.id} formationResolution 未顯示削減靈力`);
    assert.equal(result.killedDirection, 'outgoing', `${mode.id} killed-batch 方向錯誤`);
    assert.match(result.killedText, /青狼.*狼王.*另 1 個目標/, `${mode.id} killed-batch targetList/extraCount 未渲染`);
    assert.doesNotMatch(result.killedText, /擊殺通知 proof/, `${mode.id} killed-batch 回退到原始文字`);
    assert.equal(result.preservedIdentity, true, `${mode.id} 追加訊息重建既有戰報 DOM`);
    assert.equal(result.horizontalOverflow, false, `${mode.id} 戰報橫向溢出`);
    assert.ok(Math.abs(result.afterManualScrollTop - result.manualScrollTop) <= 1, `${mode.id} 手動閱讀歷史時新訊息跳回底部`);
    assert.ok(result.logHeight > result.logClientHeight, `${mode.id} fixture 未產生可驗證捲動範圍（${result.logHeight}/${result.logClientHeight}）`);
    assert.ok(result.contrastSamples.length > 0 && result.contrastSamples.every((value) => value >= 4.5), `${mode.id} CSS 文字與實際背景對比不足：${result.contrastSamples.join(',')}`);
    contrastMins.push([mode.id, Number(Math.min(...result.contrastSamples).toFixed(2))]);
    await capture(cdp, mode.id);
    screenshots += 1;
  }
  for (const accessibility of [
    { id: 'phone-text-125', mode: modes[2], textScale: 1.25, reduceMotion: false },
    { id: 'landscape-text-200', mode: modes[4], textScale: 2, reduceMotion: false },
    { id: 'phone-reduced-motion', mode: modes[3], textScale: 1, reduceMotion: true },
  ]) {
    await setMode(cdp, accessibility.mode, accessibility);
    const result = await cdp.evaluate(mountAndExercise);
    assert.equal(result.horizontalOverflow, false, `${accessibility.id} 戰報橫向溢出`);
    assert.ok(result.contrastSamples.every((value) => value >= 4.5), `${accessibility.id} 文字對比不足：${result.contrastSamples.join(',')}`);
    contrastMins.push([accessibility.id, Number(Math.min(...result.contrastSamples).toFixed(2))]);
  }
});

console.log(`${MARKER} screenshots=${screenshots} contrastMins=${JSON.stringify(contrastMins)} dir=${artifactDir}`);
