/** 從服務端正式靈獸內容產出 shared catalog、物品及宗門建築；預設只檢查。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');
const content = JSON.parse(fs.readFileSync(path.join(root, 'packages/server/data/content/spirit-beasts/catalog.json'), 'utf8'));
assert.equal(content.version, 1);
assert.equal(content.species.length, 150);
assert.equal(new Set(content.species.map((entry) => entry.id)).size, 150);
const elements = [['metal', '金'], ['wood', '木'], ['water', '水'], ['fire', '火'], ['earth', '土']];
const changes = [];
function emit(relativePath, text) {
  const absolute = path.join(root, relativePath);
  if (fs.existsSync(absolute) && fs.readFileSync(absolute, 'utf8') === text) return;
  changes.push(relativePath);
  if (write) {
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, text, 'utf8');
  }
}
const generated = [
  '/** 由 scripts/generate-spirit-beast-content.mjs 產生；真源為 server/data/content/spirit-beasts/catalog.json。 */',
  "import type { SpiritBeastContent, SpiritBeastSpecies, SpiritBeastSeedDefinition } from './spirit-beast-types';",
  'export const SPIRIT_BEAST_CATALOG: SpiritBeastSpecies[] = [',
  ...content.species.map((entry) => `  ${JSON.stringify(entry)},`), '];',
  'export const SPIRIT_BEAST_SEEDS: SpiritBeastSeedDefinition[] = [',
  ...content.seeds.map((entry) => `  ${JSON.stringify(entry)},`), '];',
  'export const SPIRIT_BEAST_CONTENT: SpiritBeastContent = { version: 1, species: SPIRIT_BEAST_CATALOG, seeds: SPIRIT_BEAST_SEEDS };',
  'const speciesById = new Map(SPIRIT_BEAST_CATALOG.map((entry) => [entry.id, entry]));',
  'export function getSpiritBeastSpecies(id: string): SpiritBeastSpecies | undefined { return speciesById.get(id); }', '',
].join('\n');
emit('packages/shared/src/spirit-beast-catalog.generated.ts', generated);

const items = [];
for (const [element, name] of elements) for (let star = 1; star <= 5; star += 1) {
  items.push({ itemId: `spirit_egg.${element}.star${star}`, name: `${name}行靈蛋（${star}星）`,
    type: 'material', grade: 'heaven', level: 1, materialCategory: 'exotic',
    desc: `${star}星${name}行靈蛋，可投入宗門五行孵蛋器。星級提高孵出高品靈獸的機率。`, tags: ['靈蛋', '宗門靈獸'] });
}
for (const seed of content.seeds) items.push({ itemId: seed.itemId, name: seed.name, type: 'material', grade: 'yellow',
  level: seed.requiredLevel, materialCategory: 'herb', desc: `播入宗門靈田，生長3600息後可收割30份${seed.outputName}。取消已播作物不返還種子。`, tags: ['種子', '宗門種植'] });
emit('packages/server/data/content/items/靈獸系統/材料.json', JSON.stringify(items, null, 2) + '\n');

const definitions = [];
function building(id, name, element, buildTicks, materials) {
  definitions.push({ id, name, visual: { layer: 'furniture' },
    placement: { layer: 'facility', footprint: [{ dx: 0, dy: 0 }], requireSectLand: true },
    topology: { blocksMove: false },
    fengShui: { elementVector: { [element]: 12 }, traits: ['facility.spirit_beast'], stability: 5 },
    economy: { buildTicks, durabilityMultiplier: 80, maxHp: 120, cost: materials } });
}
const basic = [{ itemId: 'wood', count: 8 }, { itemId: 'stone', count: 8 }, { itemId: 'metal', count: 4 }];
for (const [element, name] of elements) building(`spirit_incubator_${element}`, `${name}行孵蛋器`, element, 1800, basic);
for (const [id, name, element] of [
  ['sect_iron_mine', '玄鐵礦場', 'metal'], ['sect_spirit_stone_mine', '靈石礦場', 'earth'],
  ['sect_spirit_field', '靈田', 'wood'], ['sect_forging_station', '煉器臺', 'fire'],
  ['sect_enhancement_station', '強化臺', 'metal'], ['sect_alchemy_station', '宗門煉丹爐', 'fire'],
  ['spirit_egg_enhancement_station', '靈蛋強化臺', 'metal'],
  ['spirit_beast_cultivation_station', '靈獸培養臺', 'wood'], ['spirit_beast_fusion_station', '靈獸融合臺', 'earth'],
]) building(id, name, element, 1800, basic);
const buildingPath = 'packages/server/data/content/building-runtime/buildings.json';
const existing = JSON.parse(fs.readFileSync(path.join(root, buildingPath), 'utf8'));
const ours = new Set(definitions.map((entry) => entry.id));
const preserved = existing.filter((entry) => !ours.has(entry.id));
const next = [...preserved, ...definitions];
if (JSON.stringify(existing) !== JSON.stringify(next)) emit(buildingPath, JSON.stringify(next, null, 2) + '\n');
console.log(JSON.stringify({ mode: write ? 'write' : 'check', species: content.species.length, seeds: content.seeds.length, itemTemplates: items.length, buildings: definitions.length, changedFiles: changes }));
if (changes.length && !write) process.exitCode = 1;
