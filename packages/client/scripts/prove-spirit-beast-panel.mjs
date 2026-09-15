import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { delay, waitFor, withClientBrowserProof } from './browser-proof-runtime.mjs';

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactDir = path.resolve(clientRoot, '../..', '.runtime/reports/spirit-beast-client-browser');
const sharedSourceUrl = '/@fs/' + path.resolve(clientRoot, '../shared/src/index.ts').replaceAll('\\', '/');

const mountFixture = String.raw`
  (async () => {
    window.__spiritBeastProofErrors = [];
    window.addEventListener('error', (event) => window.__spiritBeastProofErrors.push(String(event.error?.stack || event.message)), { once: false });
    window.addEventListener('unhandledrejection', (event) => window.__spiritBeastProofErrors.push(String(event.reason?.stack || event.reason)), { once: false });
    const shared = await import(${JSON.stringify(sharedSourceUrl)});
    const model = await import('/src/react-ui/panels/spirit-beast/spirit-beast-panel-model.ts');
    const mount = await import('/src/react-ui/panels/spirit-beast/mount-spirit-beast-panel.tsx');
    const catalog = shared.SPIRIT_BEAST_CATALOG;
    const byId = (id) => catalog.find((entry) => entry.id === id);
    const owner = 'proof-owner';
    const beast = (instanceId, speciesId, star, extra = {}) => {
      const species = byId(speciesId);
      return {
        instanceId, ownerPlayerId: owner, speciesId, star, baseCombatPower: species.baseCombatPowerMin,
        state: 'stored', protected: false, revision: 4, summonedSectId: null, instanceMapId: null,
        name: species.name, grade: species.grade, element: species.element,
        masteries: shared.computeSpiritBeastMasteries(species, star), effectiveSpeed: shared.computeSpiritBeastSpeed(species, star),
        combatPower: shared.computeSpiritBeastCombatPower(species.baseCombatPowerMin, star), canManage: true, ...extra,
      };
    };
    const target = beast('beast-target', 'spirit_beast.human.metal.01', 3);
    const materials = Array.from({ length: 10 }, (_, index) => beast('beast-mat-' + index, 'spirit_beast.human.' + ['metal','wood','water','fire','earth'][index % 5] + '.0' + ((index % 6) + 1), 3));
    const fusionLeft = beast('fusion-left', 'spirit_beast.human.fire.01', 3);
    const fusionRight = beast('fusion-right', 'spirit_beast.human.fire.02', 3);
    const wrongStarFusion = beast('fusion-wrong-star', 'spirit_beast.human.fire.03', 4);
    const immortalFusion = beast('fusion-immortal', 'spirit_beast.immortal.fire.01', 3);
    const activeBeast = beast('active-beast', 'spirit_beast.fan.earth.01', 2, { state: 'idle', summonedSectId: 'proof-sect' });
    const fiveStar = beast('five-star-target', 'spirit_beast.heaven.water.01', 5);
    const outsider = beast('outsider', 'spirit_beast.human.metal.02', 3, { ownerPlayerId: 'someone-else' });
    const readyBeast = beast('ready-beast', 'spirit_beast.heaven.wood.01', 2, { state: 'locked' });
    const item = (itemKey, itemId, name, count, extra = {}) => ({ itemKey, itemId, name, count, ...extra });
    const facility = (kind, buildingId, extra = {}) => ({
      buildingId, buildingDefId: buildingId, name: extra.name || buildingId, kind, x: 10, y: 12,
      enabled: true, revision: 7, canOperate: true, canDeposit: true, canWithdraw: true,
      input: [], output: [], orders: [], ...extra,
    });
    const view = {
      revision: 31, sectId: 'proof-sect', ownerPlayerId: owner,
      beasts: [target, ...materials, fusionLeft, fusionRight, wrongStarFusion, immortalFusion, activeBeast, fiveStar, outsider],
      facilities: [
        facility('incubator', 'spirit_incubator_metal', { name: '庚金孵蛋器', element: 'metal', hatch: { hatchId: 'ready-hatch', ownerPlayerId: owner, buildingId: 'spirit_incubator_metal', element: 'wood', eggStar: 2, state: 'ready', workTotalTicks: 2400, workRemainingTicks: 0, speedMultiplier: 1.5, offspring: readyBeast } }),
        facility('incubator', 'spirit_incubator_wood', { name: '青木孵蛋器', element: 'wood', hatch: { hatchId: 'busy-hatch', ownerPlayerId: owner, buildingId: 'spirit_incubator_wood', element: 'water', eggStar: 1, state: 'incubating', workTotalTicks: 1800, workRemainingTicks: 900, speedMultiplier: 2 } }),
        facility('incubator', 'spirit_incubator_water', { name: '玄水孵蛋器', element: 'water' }),
        facility('incubator', 'spirit_incubator_fire', { name: '離火孵蛋器', element: 'fire' }),
        facility('incubator', 'spirit_incubator_earth', { name: '厚土孵蛋器', element: 'earth' }),
        facility('iron_mine', 'sect_iron_mine', { name: '玄鐵礦場', output: [item('iron-output', 'black_iron_chunk', '玄鐵礦塊', 6)], outputSpiritStones: 8 }),
        facility('spirit_stone_mine', 'sect_spirit_stone_mine', { name: '宗門靈石礦', orders: [{ orderId: 'manual-order', buildingId: 'sect_spirit_stone_mine', ownerPlayerId: owner, skill: 'mining', action: 'mine_spirit_stone', quantity: 1, completedCount: 0, state: 'running', workerKind: 'player', workTotalTicks: 600, workRemainingTicks: 480, revision: 2 }] }),
        facility('field', 'sect_spirit_field', { name: '宗門靈田', plannedSeedItemId: 'seed.returnspring_leaf', repeatPlanting: true, crop: { cycleId: 'crop-one', seedItemId: 'seed.returnspring_leaf', outputItemId: 'mat.returnspring_leaf', name: '回春葉', growthTotalTicks: 3600, growthRemainingTicks: 1700, wateredCount: 1, wateringRequired: 2, state: 'needs_water' } }),
        facility('forging', 'sect_forging_station', { name: '宗門煉器臺', orders: [{ orderId: 'forge-order', buildingId: 'sect_forging_station', ownerPlayerId: owner, skill: 'forging', action: 'craft', recipeId: 'forge.sword', quantity: 2, completedCount: 0, state: 'queued', workerKind: 'spirit_beast', workerId: 'fusion-left', revision: 3 }] }),
        facility('enhancement', 'sect_enhancement_station', { name: '宗門強化臺', output: [item('stored-sword', 'weapon.proof_sword', '青鋒劍', 1, { type: 'equipment', enhancementLevel: 4 })] }),
        facility('alchemy', 'sect_alchemy_station', { name: '宗門煉丹爐' }),
        facility('egg_enhancement', 'spirit_egg_enhancement_station', { name: '靈蛋強化臺' }),
        facility('cultivation', 'spirit_beast_cultivation_station', { name: '靈獸培養臺' }),
        facility('fusion', 'spirit_beast_fusion_station', { name: '靈獸融合臺' }),
      ],
      eggs: [
        { itemKey: 'egg-stack-fire', itemId: 'spirit_egg.fire.star2', name: '二星火靈蛋', element: 'fire', star: 2, count: 10 },
        { itemKey: 'egg-uuid-fire', itemId: 'spirit_egg.fire.star2', name: '二星火靈蛋', element: 'fire', star: 2, count: 1 },
        { itemKey: 'egg-earth', itemId: 'spirit_egg.earth.star3', name: '三星土靈蛋', element: 'earth', star: 3, count: 2 },
        { itemKey: 'egg-wood', itemId: 'spirit_egg.wood.star1', name: '一星木靈蛋', element: 'wood', star: 1, count: 3 },
      ],
      inventory: [
        item('inv-iron', 'black_iron_chunk', '玄鐵礦塊', 12, { type: 'material' }),
        item('inv-herb', 'mat.returnspring_leaf', '回春葉', 20, { type: 'material' }),
        item('inv-stones', 'spirit_stone', '靈石', 900, { type: 'material' }),
        item('equip-sword', 'weapon.proof_sword', '青鋒劍', 1, { type: 'equipment', enhancementLevel: 4 }),
      ],
      craftOptions: [
        { facilityKind: 'forging', recipeId: 'forge.sword', name: '青鋒劍', outputItemId: 'weapon.proof_sword', requiredLevel: 10, baseWorkTicks: 60, materials: [{ itemId: 'black_iron_chunk', name: '玄鐵礦塊', count: 2 }], spiritStoneCost: 30 },
        { facilityKind: 'alchemy', recipeId: 'alchemy.spring', name: '回春丹', outputItemId: 'pill.spring', requiredLevel: 1, baseWorkTicks: 30, materials: [{ itemId: 'mat.returnspring_leaf', name: '回春葉', count: 3 }], spiritStoneCost: 10 },
      ],
      plantingSkill: { level: 22, exp: 35, expToNext: 80 }, warehouseCapacity: 300,
      summonLimit: 3, sectSummonLimit: 30, summonedCount: 0, sectSummonedCount: 2,
      fertilizerEnabled: false, canManage: true,
    };
    for (const egg of view.eggs) egg.revision = 2;
    for (const station of view.facilities) if (station.hatch) station.hatch.revision = 4001;
    for (const [kind, skill, action] of [['field', 'planting', 'water'], ['enhancement', 'enhancement', 'enhance'], ['alchemy', 'alchemy', 'craft']]) {
      const station = view.facilities.find((entry) => entry.kind === kind);
      station.orders.push({ orderId: kind + '-available', buildingId: station.buildingId, ownerPlayerId: owner, skill, action, quantity: 1, completedCount: 0, state: 'queued', revision: 1 });
    }
    const old = document.getElementById('spirit-beast-proof-shell');
    old?.remove();
    const shell = document.createElement('section');
    shell.id = 'spirit-beast-proof-shell';
    shell.style.cssText = 'position:fixed;inset:12px;z-index:2147483000;background:var(--surface-base);padding:12px;border:1px solid var(--border-strong);border-radius:8px;overflow:hidden;';
    const body = document.createElement('div'); body.style.height = '100%'; shell.append(body); document.body.append(shell);
    const commands = [];
    model.setSpiritBeastCallbacks({ onRequest: () => {}, onCommand: (command) => commands.push(command) });
    model.spiritBeastStore.patchState({ view, loading: false, pending: [], error: null, result: null, fusionPreviewReceipt: null });
    mount.mountReactSpiritBeastPanel(body);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    window.__spiritBeastProof = { shared, model, mount, shell, body, view, commands, target, materials, fusionLeft, fusionRight };
    return true;
  })()
`;

async function capture(cdp, name) {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  await writeFile(path.join(artifactDir, `${name}.png`), Buffer.from(shot.data, 'base64'));
}

await mkdir(artifactDir, { recursive: true });

await withClientBrowserProof({ viewport: { width: 1280, height: 900 }, profilePrefix: 'spirit-beast-panel-', initialTouch: false }, async (cdp) => {
  assert.equal(await cdp.evaluate(mountFixture), true, '正式靈獸 React 面板 fixture 未掛載');
  await waitFor(() => cdp.evaluate(`document.querySelectorAll('#spirit-beast-proof-shell [data-spirit-beast-tab]').length === 6`), '靈獸分頁');
  const initial = await cdp.evaluate(`(async () => { const shell=document.getElementById('spirit-beast-proof-shell'); const images=[...shell.querySelectorAll('img')]; await Promise.all(images.map((img)=>img.decode())); return { tabs:shell.querySelectorAll('[data-spirit-beast-tab]').length, cards:shell.querySelectorAll('[data-spirit-beast-id]').length, badImages:images.filter((img)=>!img.naturalWidth).map((img)=>img.src), overflow:shell.scrollWidth>shell.clientWidth+1 }; })()`);
  assert.equal(initial.tabs, 6, '核心分頁入口不完整');
  assert(initial.cards >= 14, '我的靈獸 fixture 未完整呈現');
  assert.deepEqual(initial.badImages, [], '正式靈獸圖無法解碼');
  assert.equal(initial.overflow, false, '桌面初始面板水平溢出');

  // 工作、孵化、培養、融合及圖鑑互動在同一正式掛載中執行。
  const interactionResult = await cdp.evaluate(`(async () => {
    const proof=window.__spiritBeastProof, root=proof.shell;
    const click=(scope,text)=>{const button=[...scope.querySelectorAll('button')].find((entry)=>entry.textContent.includes(text));if(!button)throw new Error('找不到 '+text);button.click();return button;};
    const set=(el,value)=>{if(!el)throw new Error('缺少表單');const prototype=el instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(el,String(value));el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};
    const frame=()=>new Promise((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const tab=async(id)=>{root.querySelector('[data-spirit-beast-tab="'+id+'"]').click();await frame();};
    const firstStored=root.querySelector('[data-spirit-beast-id="beast-target"]');click(firstStored,'收藏保護');click(firstStored,'召喚');click(root.querySelector('[data-spirit-beast-id="active-beast"]'),'收回');
    await tab('work');
    const iron=root.querySelector('[data-facility-kind="iron_mine"]'), stone=root.querySelector('[data-facility-kind="spirit_stone_mine"]'), forge=root.querySelector('[data-facility-kind="forging"]'), enhance=root.querySelector('[data-facility-kind="enhancement"]'), field=root.querySelector('[data-facility-kind="field"]');
    click(iron,'停止自動採集');click(iron,'親自採集');click(stone,'停止親自工作');click(forge,'親自煉器');click(enhance,'親自強化');click(root.querySelector('[data-facility-kind="alchemy"]'),'親自煉丹');click(forge,'取消排程');
    const forgeForm=forge.querySelector('[data-craft-kind="forging"]');forgeForm.open=true;await frame();set(forgeForm.querySelector('select'),'forge.sword');const fn=forgeForm.querySelectorAll('input[type=number]');set(fn[0],3);click(forgeForm,'加入排程');
    const enhanceForm=enhance.querySelector('[data-craft-kind="enhancement"]');enhanceForm.open=true;await frame();set(enhanceForm.querySelector('select'),'stored-sword');const en=enhanceForm.querySelectorAll('input[type=number]');set(en[0],7);set(en[1],5);set(en[2],500);click(enhanceForm,'加入排程');
    const alchemy=root.querySelector('[data-facility-kind="alchemy"]'),alchemyForm=alchemy.querySelector('[data-craft-kind="alchemy"]');alchemyForm.open=true;await frame();set(alchemyForm.querySelector('select'),'alchemy.spring');click(alchemyForm,'加入排程');
    const deposit=iron.querySelector('[data-transfer-mode=deposit]');deposit.open=true;await frame();set(deposit.querySelector('[aria-label="玄鐵礦塊數量"]'),2);set(deposit.querySelector('[aria-label="靈石數量"]'),40);click(deposit,'確認放入');
    const withdraw=iron.querySelector('[data-transfer-mode=withdraw]');withdraw.open=true;await frame();set(withdraw.querySelector('[aria-label="玄鐵礦塊數量"]'),3);set(withdraw.querySelector('[aria-label="靈石數量"]'),5);click(withdraw,'確認領取');
    click(root.querySelector('.spirit-beast-seed-shop'),'購買');click(field,'儲存計畫');click(field,'取消本輪種植');click(field,'親自澆水');
    const content=root.querySelector('.spirit-beast-content'), focusInput=deposit.querySelector('[aria-label="玄鐵礦塊數量"]');focusInput.dataset.proofNode='keep';focusInput.focus({preventScroll:true});content.scrollTop=Math.min(120,Math.max(0,content.scrollHeight-content.clientHeight));const beforeScroll=content.scrollTop;
    proof.model.spiritBeastStore.patchState({view:{...proof.model.spiritBeastStore.getState().view,facilities:proof.view.facilities.map((entry)=>entry.kind==='iron_mine'?{...entry,output:[{...entry.output[0],count:7}]}:entry)}});await frame();const afterInput=root.querySelector('[data-proof-node=keep]');const continuity={sameNode:afterInput===focusInput,focused:document.activeElement===focusInput,value:focusInput.value,scroll:content.scrollTop,beforeScroll};
    await tab('incubation');const fire=root.querySelector('[data-incubator-element=fire]');set(fire.querySelector('select'),'egg-earth');await frame();const crossElementSpeed=fire.textContent.includes('2.00 倍');click(fire,'開始孵化');click(root.querySelector('[data-incubator-element=wood]'),'取消孵化');click(root.querySelector('[data-incubator-element=metal]'),'收養靈獸');
    const eggSection=root.querySelector('#spirit-beast-egg-enhance-title').closest('section');set(eggSection.querySelector('select'),'egg-stack-fire');await frame();const eggCounts=eggSection.querySelectorAll('fieldset input[type=number]');set(eggCounts[0],9);set(eggCounts[1],1);await frame();click(eggSection,'確認強化');
    await tab('growth');const growth=root.querySelector('#spirit-beast-growth-title').closest('section'), growthSelect=growth.querySelector('select');const excluded={five:![...growthSelect.options].some((o)=>o.value==='five-star-target'),outsider:![...growthSelect.options].some((o)=>o.value==='outsider')};set(growthSelect,'beast-target');await frame();[...growth.querySelectorAll('fieldset input[type=checkbox]')].slice(0,10).forEach((box)=>box.click());await frame();click(growth,'確認培養');
    await tab('fusion');const fusion=root.querySelector('#spirit-beast-fusion-title').closest('section'), selects=fusion.querySelectorAll('select');const fusionExcluded={wrongStar:![...selects[0].options].some((o)=>o.value==='fusion-wrong-star'),immortal:![...selects[0].options].some((o)=>o.value==='fusion-immortal')};set(selects[0],'fusion-left');await frame();set(selects[1],'fusion-right');await frame();click(fusion,'查看融合結果');await frame();const previewCommand=[...proof.commands].reverse().find((command)=>command.action==='preview_fusion');const preview=proof.shared.previewSpiritBeastFusion(proof.fusionLeft,proof.fusionRight,proof.shared.SPIRIT_BEAST_CATALOG);proof.model.spiritBeastStore.patchState({view:{...proof.model.spiritBeastStore.getState().view,fusionPreview:preview},fusionPreviewReceipt:{requestId:previewCommand.requestId,revision:proof.view.revision}});await frame();const previewReady=Boolean(fusion.querySelector('[data-fusion-preview-ready=true]')),previewStarText=fusion.querySelector('.spirit-beast-fusion-preview span')?.textContent||'';click(fusion,'確認融合');
    await tab('codex');const codexCount=root.querySelectorAll('[data-species-id]').length;const finder=root.querySelector('#spirit-beast-parent-title').closest('section'),targetSelect=finder.querySelector('select');set(targetSelect,'spirit_beast.immortal.fire.01');await frame();const parentCount=finder.querySelectorAll('.spirit-beast-parent-results li').length;const pairText=finder.textContent.includes('1860 組');
    return {commands:proof.commands,continuity,crossElementSpeed,excluded,fusionExcluded,previewReady,previewStarText,previewStar:preview?.star,codexCount,parentCount,pairText,tabs:[...root.querySelectorAll('[data-spirit-beast-tab]')].map((entry)=>entry.dataset.spiritBeastTab),errors:window.__spiritBeastProofErrors};
  })()`);
  const actions = new Set(interactionResult.commands.map((command) => command.action));
  for (const action of ['summon','recall','protect','incubate','cancel_incubation','adopt','enhance_egg','cultivate','preview_fusion','fuse','set_mine_enabled','set_crop_plan','cancel_crop','deposit','withdraw','queue_craft','cancel_order','manual_work','cancel_manual_work','buy_seed']) assert(actions.has(action), `未送出 ${action} payload`);
  assert(interactionResult.commands.some((command) => command.action === 'manual_work' && command.workAction === 'mine'), '人工礦場 payload 未使用 mine');
  for (const [action, revision] of [['incubate', 2], ['adopt', 4001], ['enhance_egg', 2]]) assert(interactionResult.commands.some((command) => command.action === action && command.expectedRevision === revision), `${action} 必須傳入蛋或孵化進度的 revision，不能傳建築或面板版本`);
  for (const buildingId of ['sect_forging_station', 'sect_alchemy_station', 'sect_enhancement_station']) assert(interactionResult.commands.some((command) => command.action === 'manual_work' && command.workAction === 'craft' && command.buildingId === buildingId), `${buildingId} 缺少親自工作入口`);
  assert(interactionResult.commands.some((command) => command.action === 'queue_craft' && command.recipeId === 'forge.sword' && command.quantity === 3 && command.maxAttempts === undefined && command.maxSpiritStones === undefined), '煉器排程名稱選項／批量／預算 payload 錯誤');
  assert(interactionResult.commands.some((command) => command.action === 'queue_craft' && command.targetItemKey === 'stored-sword' && command.targetEnhancementLevel === 7 && command.maxAttempts === 5 && command.maxSpiritStones === 500), '強化目標／批量預算 payload 錯誤');
  assert(interactionResult.commands.some((command) => command.action === 'queue_craft' && command.recipeId === 'alchemy.spring'), '煉丹排程未由名稱選單送出 recipeId');
  assert(interactionResult.commands.some((command) => command.action === 'deposit' && command.entries[0]?.itemKey === 'inv-iron' && command.entries[0]?.count === 2 && command.spiritStones === 40), '放入材料與靈石 payload 錯誤');
  assert(interactionResult.commands.some((command) => command.action === 'withdraw' && command.entries[0]?.itemKey === 'iron-output' && command.entries[0]?.count === 3 && command.spiritStones === 5), '領取產物與靈石 payload 錯誤');
  assert(interactionResult.commands.some((command) => command.action === 'enhance_egg' && command.materials.some((entry) => entry.itemKey === 'egg-stack-fire' && entry.count === 9) && command.materials.some((entry) => entry.itemKey === 'egg-uuid-fire' && entry.count === 1)), '靈蛋聚合堆疊／單顆 UUID 素材 payload 錯誤');
  assert.deepEqual(interactionResult.continuity, { sameNode: true, focused: true, value: '2', scroll: interactionResult.continuity.beforeScroll, beforeScroll: interactionResult.continuity.beforeScroll }, '快照 patch 未保留表單節點、焦點、值或捲動');
  assert.equal(interactionResult.crossElementSpeed, true, '跨五行靈蛋未顯示 shared 孵化速度');
  assert.deepEqual(interactionResult.excluded, { five: true, outsider: true }, '培養主獸未排除五星或他人靈獸');
  assert.deepEqual(interactionResult.fusionExcluded, { wrongStar: true, immortal: true }, '融合候選未排除非精確三星或仙品靈獸');
  assert.equal(interactionResult.previewReady, true, '權威融合預覽未綁定 requestId／parents／revision');
  assert.equal(interactionResult.previewStar, 1, '融合預覽必須為一星靈獸');
  assert.match(interactionResult.previewStarText, /^.+・.+行・★$/, '融合預覽未精確顯示一星');
  assert(interactionResult.commands.some((command) => command.action === 'preview_fusion' && command.beastIds[0] === 'fusion-left' && command.beastIds[1] === 'fusion-right'), '三星融合預覽 payload 錯誤');
  assert(interactionResult.commands.some((command) => command.action === 'fuse' && command.beastIds[0] === 'fusion-left' && command.beastIds[1] === 'fusion-right'), '三星確認融合 payload 錯誤');
  assert.equal(interactionResult.codexCount, 150, '圖鑑未完整呈現 150 種靈獸');
  assert(interactionResult.parentCount > 0 && interactionResult.pairText, '依目標查父母未走完整 1860 組配方');
  assert.deepEqual(interactionResult.errors, [], '靈獸面板出現瀏覽器執行錯誤');

  const modes = [
    { id: 'desktop-dark-beasts', width: 1280, height: 900, mobile: false, theme: 'dark', tab: 'beasts' },
    { id: 'desktop-light-work', width: 1280, height: 720, mobile: false, theme: 'light', tab: 'work' },
    { id: 'mobile-portrait-incubation', width: 390, height: 844, mobile: true, theme: 'dark', tab: 'incubation' },
    { id: 'touch-landscape-codex', width: 844, height: 390, mobile: true, theme: 'light', tab: 'codex' },
  ];
  for (const mode of modes) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: mode.width, height: mode.height, deviceScaleFactor: 1, mobile: mode.mobile, screenWidth: mode.width, screenHeight: mode.height });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: mode.mobile, maxTouchPoints: mode.mobile ? 5 : 1 });
    const layout = await cdp.evaluate(`(async()=>{document.documentElement.dataset.colorMode=${JSON.stringify(mode.theme)};const shell=document.getElementById('spirit-beast-proof-shell');shell.querySelector('[data-spirit-beast-tab=${mode.tab}]').click();await new Promise((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const content=shell.querySelector('.spirit-beast-content');return{rootOverflow:shell.scrollWidth>shell.clientWidth+1,contentOverflow:content.scrollWidth>content.clientWidth+1,scrollable:content.scrollHeight>content.clientHeight,active:content.dataset.spiritBeastActiveTab,theme:document.documentElement.dataset.colorMode,minTouch:Math.min(...[...shell.querySelectorAll('button,select,input,summary')].filter((el)=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0}).map((el)=>el.getBoundingClientRect().height))};})()`);
    assert.equal(layout.rootOverflow, false, `${mode.id} 外框水平溢出`);
    assert.equal(layout.contentOverflow, false, `${mode.id} 內容水平溢出`);
    assert.equal(layout.active, mode.tab, `${mode.id} 分頁未開啟`);
    assert.equal(layout.theme, mode.theme, `${mode.id} 主題未套用`);
    if (mode.mobile) assert(layout.minTouch >= 38, `${mode.id} 可見控制過小：${layout.minTouch}`);
    const brokenImages = await cdp.evaluate(`(async()=>{const shell=document.getElementById('spirit-beast-proof-shell'),bounds=shell.getBoundingClientRect(),images=[...shell.querySelectorAll('img')].filter((img)=>{const rect=img.getBoundingClientRect();return rect.width>0&&rect.height>0&&rect.bottom>=bounds.top&&rect.top<=bounds.bottom;});await Promise.allSettled(images.map((img)=>Promise.race([img.decode(),new Promise((resolve)=>setTimeout(resolve,5000))])));return images.filter((img)=>!img.naturalWidth).map((img)=>img.src);})()`);
    assert.deepEqual(brokenImages, [], `${mode.id} 靈獸或工位圖片無法解碼`);
    await capture(cdp, mode.id);
  }

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false, screenWidth: 1280, screenHeight: 800 });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 });
  const plantingOverview = await cdp.evaluate(`(async()=>{const proof=window.__spiritBeastProof;proof.shell.hidden=true;document.getElementById('game-shell')?.classList.remove('hidden');document.getElementById('login-overlay')?.classList.add('hidden');document.querySelector('[data-workspace-open="character"]')?.click();await new Promise((resolve)=>requestAnimationFrame(resolve));document.getElementById('workspace-tab-attr')?.click();document.getElementById('pane-attr')?.classList.add('active');const {AttrPanel}=await import('/src/ui/panels/attr-panel.ts');const panel=new AttrPanel();const attrs={constitution:10,spirit:10,perception:10,talent:10,strength:10,meridians:10};panel.update({baseAttrs:attrs,bonuses:[],finalAttrs:attrs,plantingSkill:{level:22,exp:35,expToNext:80}});await new Promise((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));document.querySelector('#pane-attr [data-attr-tab=craft]')?.click();await new Promise((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const row=document.querySelector('#pane-attr [data-guided-tour-craft-skill=planting]');const rect=row?.getBoundingClientRect();return{text:row?.textContent||'',visible:Boolean(rect&&rect.width>0&&rect.height>0),level:row?.querySelector('.attr-craft-level')?.textContent||''};})()`);
  assert.equal(plantingOverview.visible, true, '種植技藝未進入玩家技藝總覽真實可見路徑');
  assert.match(plantingOverview.text, /種植/, '種植技藝標籤未顯示');
  assert.equal(plantingOverview.level, 'LV 22', '種植技藝等級未由 player 狀態投影');

  const controllerResult = await cdp.evaluate(`(async()=>{const proof=window.__spiritBeastProof;const shared=proof.shared;const controller=await import('/src/react-ui/panels/spirit-beast/spirit-beast-panel-controller.ts');const handlers=new Map(),sent=[];controller.createSpiritBeastPanelController({on:(event,handler)=>handlers.set(event,handler),emitEvent:(event,payload)=>sent.push({event,payload})});proof.model.spiritBeastStore.patchState({view:proof.view,pending:['keep-request'],fusionPreviewReceipt:null,result:null,error:null});handlers.get(shared.S2C.SpiritBeastPanel)({...proof.view});const pendingAfterPanel=proof.model.spiritBeastStore.getState().pending;handlers.get(shared.S2C.SpiritBeastCommandResult)({requestId:'unknown',ok:false,revision:31,reasonKey:'raw_secret_reason'});const unknownIgnored=proof.model.spiritBeastStore.getState().error===null;const requestId=proof.model.sendSpiritBeastCommand({action:'preview_fusion',buildingId:'spirit_beast_fusion_station',beastIds:['fusion-left','fusion-right'],expectedRevision:31});const preview=shared.previewSpiritBeastFusion(proof.fusionLeft,proof.fusionRight,shared.SPIRIT_BEAST_CATALOG);handlers.get(shared.S2C.SpiritBeastCommandResult)({requestId,ok:true,revision:31,fusionPreview:preview});const merged=proof.model.spiritBeastStore.getState();const previewMerged=merged.view.fusionPreview?.speciesId===preview.speciesId,receipt=merged.fusionPreviewReceipt;handlers.get(shared.S2C.SpiritBeastPanel)({...proof.view,revision:32});const stale=proof.model.spiritBeastStore.getState();return{pendingAfterPanel,unknownIgnored,previewMerged,receipt,staleCleared:!stale.view.fusionPreview&&stale.fusionPreviewReceipt===null,pending:stale.pending};})()`);
  assert.deepEqual(controllerResult.pendingAfterPanel, ['keep-request'], 'Panel 快照清除了未完成 requestId');
  assert.equal(controllerResult.unknownIgnored, true, '未知 requestId 結果污染面板錯誤');
  assert.equal(controllerResult.previewMerged, true, 'command result 的 fusionPreview 未合併入 view');
  assert(controllerResult.receipt?.requestId && controllerResult.receipt.revision === 31, '融合預覽 receipt 未綁 requestId/revision');
  assert.equal(controllerResult.staleCleared, true, '較新快照未清除過期融合預覽');
  assert.deepEqual(controllerResult.pending, ['keep-request'], 'command result 移除了其他 requestId');
  console.log('SPIRIT_BEAST_PANEL_BROWSER_ASSERTIONS:PASS screenshots=4');
});

console.log(`SPIRIT_BEAST_PANEL_BROWSER_PROOF:PASS screenshots=4 dir=${artifactDir}`);
