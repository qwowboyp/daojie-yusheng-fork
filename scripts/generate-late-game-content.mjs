#!/usr/bin/env node
/** 將後期故事目錄建成正式內容；預設僅檢查，--write 才更新本機檔案。 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildLateGameMaps } from './lib/late-game-maps.mjs';
import { buildLateGameEncounters } from './lib/late-game-encounters.mjs';
import { convertJsonValue, loadExcludeFields } from './convert-to-traditional.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const shared = require(path.join(root, 'packages/shared/dist/index.js'));
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const data = 'packages/server/data';
const catalog = read('scripts/lib/late-game-story.json');
if (catalog.realms.length !== 7 || catalog.realms.some((r) => r.maps.length !== 4)) {
  throw new Error('後期故事目錄必須包含七境、每境四圖，禁止發布不完整批次。');
}
const encounters = buildLateGameEncounters(catalog, shared);
const layout = buildLateGameMaps(catalog, encounters);
const output = new Map();
const excludedFields = loadExcludeFields();
const put = (relative, value) => output.set(relative,
  `${JSON.stringify(convertJsonValue(value, { excludedFields }), null, 2)}\n`);
for (const map of layout.finalize()) put(`${data}/maps/${map.id}.json`, map);
put(`${data}/content/items/後期七境/內容.json`, encounters.items);
put(`${data}/content/monsters/後期七境.json`, encounters.monsters);
put(`${data}/content/techniques/妖兽专用/後期七境.json`, encounters.techniques);
for (const kind of ['forging', 'alchemy']) {
  const relative = `${data}/content/${kind}/recipes.json`;
  const original = read(relative).filter((entry) => !/(^|[.])lg_/.test(entry.recipeId));
  put(relative, [...original, ...encounters[kind]]);
}

const nodes = read(`${data}/content/resource-nodes.json`);
nodes.resourceNodes = nodes.resourceNodes.filter((entry) => !entry.id.startsWith('lg_') && !entry.id.startsWith('landmark.lg_'));
nodes.resourceNodes.push(...Object.values(encounters.mapContent).flatMap((entry) => entry.herbNodeTemplates ?? []));
put(`${data}/content/resource-nodes.json`, nodes);

const abyss = read(`${data}/maps/darksoil_abyss.json`);
abyss.portals = abyss.portals.filter((entry) => entry.id !== layout.entrance.id);
abyss.portals.push(layout.entrance);
const crack = abyss.landmarks.find((entry) => entry.id === 'lm_darksoil_abyss_floor');
crack.desc = '封緘已退的深淵裂縫，熱風捲著灰燼從殘階下方湧出。沿階可抵金丹期薪盡坡，也可循殘階攀返。建議境界等級 43，先到燼燈坊補給再向劫火帶深入。';
const veteran = abyss.npcs.find((entry) => entry.id === 'npc_darksoil_veteran');
veteran.dialogue = '礦脈廳與蘑菇洞通向中央大廳，地龍與噬脈獸守在下方。正南的深淵裂縫已經開了，殘階下是金丹修士走的薪盡坡。若根基已穩，就循燈火去燼燈坊；別把那邊的灰影當成這裡的小妖。';
put(`${data}/maps/darksoil_abyss.json`, abyss);

const manor = read(`${data}/maps/ruined_cavern_manor.json`);
manor.description = '喚靈真人早年誤入劫火帶，被殘火反噬後退回舊府。倒塌書架間留著焦黑診簿，丹室殘陣至今引來游離魂火。此地是金丹期喚靈支線的舊址，燼燈坊大夫祝餘仍記著那筆未結的診帳。';
manor.landmarks = [
  { id: 'lg_huanling_medical_ledger', name: '焦邊診簿', x: 4, y: 8, desc: '殘頁寫著燼燈坊與祝餘的名字，末筆停在「劫火入脈」。若想知道此地主人的來歷，可帶著他的名牌去問祝餘。' },
  { id: 'lg_huanling_broken_formation', name: '裂丹殘陣', x: 12, y: 4, desc: '裂開的陣盤對著舊丹室。喚靈真人仍會施展環形、直線與定點法術，進退時留意地上的預警。' },
];
manor.safeZones = [{ x: 3, y: 9, radius: 1 }];
for (const p of manor.portals) { p.hidden = false; p.trigger = 'manual'; p.observeTitle = '返回歸藏脈窟'; }
put(`${data}/maps/ruined_cavern_manor.json`, manor);
const cavern = read(`${data}/maps/guizang_vein_cavern.json`);
for (const p of cavern.portals.filter((entry) => entry.targetMapId === manor.id)) {
  p.hidden = false; p.trigger = 'manual'; p.observeTitle = '喚靈洞府隙門';
  p.observeDesc = '裂縫通向重傷的喚靈真人舊府，內有金丹餘威。建議境界等級 43，可在燼燈坊向祝餘打聽來歷。';
}
put(`${data}/maps/guizang_vein_cavern.json`, cavern);

const oldBoss = read(`${data}/content/monsters/破败洞府.json`);
const huanling = oldBoss.find((entry) => entry.id === 'm_huanling_zhenren');
Object.assign(huanling, encounters.huanlingStats);
huanling.expMultiplier = shared.getDefaultMonsterExpMultiplier('demon_king');
huanling.aggroRange = 4;
huanling.respawnSec = 300;
huanling.initialBuffs[0].mainCombatStatsPercent = -120;
huanling.initialBuffs[0].desc = '劫火舊傷未癒，主要戰鬥屬性受壓；殘存金丹仍能驅使喚靈法術。';
const nameplate = { itemId: 'mat.lg_huanling_nameplate', name: '喚靈真人名牌', type: 'material', grade: 'heaven', level: 43,
  desc: '劫火燒黑的舊名牌，背面刻著祝餘的診記。可交回燼燈坊了卻舊帳，也可作火行煉製輔材。',
  materialCategory: 'exotic', materialValues: { elements: { fire: 80, earth: 40 } }, tags: ['異材'] };
encounters.items.push(nameplate);
put(`${data}/content/items/後期七境/內容.json`, encounters.items);
huanling.drops = [
  { itemId: nameplate.itemId, name: nameplate.name, type: 'material', count: 1 },
  { itemId: 'pill.ningxiang', name: '凝相丹', type: 'consumable', count: 1, chance: 0.15 },
  { itemId: 'book.xuesha_huanling_jue', name: '《血煞喚靈決》', type: 'skill_book', count: 1, chance: 0.02 },
];
put(`${data}/content/monsters/破败洞府.json`, oldBoss);
const healer = catalog.realms[0].town.npcs.find((npc) => npc.name.includes('祝餘'));
if (!healer) throw new Error('喚靈支線缺少祝餘，請核對故事目錄。');
const townId = catalog.realms[0].town.id;
put(`${data}/content/quests/後期_喚靈.json`, { quests: [{ id: 'q_lg_huanling_old_debt', title: '喚靈舊帳',
  line: 'side', chapter: '金丹·喚靈', story: '祝餘的舊診簿上，有一筆三十年沒畫掉的帳。病人已退入歸藏脈窟後的洞府，殘火與魂聲卻仍不肯散。',
  desc: '循歸藏脈窟隙門進入破敗洞府，擊敗喚靈真人，將名牌交回燼燈坊祝餘。',
  objectiveType: 'kill', objectiveText: '擊敗喚靈真人並取回名牌', targetMonsterId: huanling.id,
  targetMapId: manor.id, targetName: huanling.name, targetCount: 1, required: 1,
  requiredItemId: nameplate.itemId, requiredItemCount: 1,
  giverMapId: townId, giverNpcId: healer.id, submitMapId: townId, submitNpcId: healer.id,
  reward: [{ itemId: 'pill.ningxiang', name: '凝相丹', type: 'consumable', count: 2 }],
}] });

const writing = process.argv.includes('--write');
const changed = [];
for (const [relative, content] of output) {
  const filename = path.join(root, relative);
  if (fs.existsSync(filename) && fs.readFileSync(filename, 'utf8') === content) continue;
  changed.push(relative);
  if (writing) { fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, content); }
}
console.log(JSON.stringify({ ok: writing || changed.length === 0, mode: writing ? 'write' : 'check', maps: layout.maps.length,
  items: encounters.items.length, monsters: encounters.monsters.length, techniques: encounters.techniques.length, changed }, null, 2));
if (!writing && changed.length) process.exitCode = 1;
