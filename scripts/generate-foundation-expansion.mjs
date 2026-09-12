import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildFoundationExpansion, MAP_ID, RESOURCE_NODE_IDS, TECHNIQUE_ID } from './lib/foundation-expansion.mjs';

const require = createRequire(import.meta.url);
const shared = require('../packages/shared/dist/index.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');
const generated = buildFoundationExpansion(shared);
const foundationDirectory = String.fromCodePoint(0x7b51, 0x57fa, 0x671f);
const monsterTechniqueDirectory = String.fromCodePoint(0x5996, 0x517d, 0x4e13, 0x7528);
const artsFileName = `${String.fromCodePoint(0x672f, 0x6cd5)}.json`;
const techniquePath = path.posix.join('packages/server/data/content/techniques', monsterTechniqueDirectory, artsFileName);
const itemPath = path.posix.join('packages/server/data/content/items', foundationDirectory, '青霖澤.json');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function upsertBy(entries, replacements, key) {
  const replacementsByKey = new Map(replacements.map((entry) => [entry[key], entry]));
  const replacedKeys = new Set();
  const merged = entries.map((entry) => {
    const entryKey = entry?.[key];
    const replacement = replacementsByKey.get(entryKey);
    if (!replacement) return entry;
    replacedKeys.add(entryKey);
    return replacement;
  });
  for (const replacement of replacements) {
    if (!replacedKeys.has(replacement[key])) merged.push(replacement);
  }
  return merged;
}

const frost = readJson('packages/server/data/maps/frostblade_abyss.json');
const qinglinPortal = {
  id: 'frostblade_abyss:32,26', targetPortalId: `${MAP_ID}:4,24`, direction: 'two_way',
  x: 32, y: 26, targetMapId: MAP_ID, targetX: 4, targetY: 24,
  kind: 'portal', trigger: 'manual', routeDomain: 'inherit', allowPlayerOverlap: false, hidden: false,
  observeTitle: '青霖澤石棧橋', observeDesc: '寒鐵側洞外修補的古石棧橋通往青霖澤。',
};
frost.portals = upsertBy(frost.portals ?? [], [qinglinPortal], 'id');
const scout = (frost.npcs ?? []).find((npc) => npc.id === 'npc_frostblade_scout');
if (!scout) throw new Error('霜刃淵缺少探淵斥候 npc_frostblade_scout');
scout.shopItems = upsertBy(scout.shopItems ?? [], [{ itemId: 'scroll.qinglin_marsh', price: 180, stockLimit: 1, refreshSeconds: 3600 }], 'itemId');

const resourceNodeDoc = readJson('packages/server/data/content/resource-nodes.json');
resourceNodeDoc.resourceNodes = upsertBy(resourceNodeDoc.resourceNodes ?? [], generated.resourceNodes, 'id');
const techniques = upsertBy(readJson(techniquePath), generated.techniques, 'id');
const forging = upsertBy(readJson('packages/server/data/content/forging/recipes.json'), generated.forging, 'recipeId');
const alchemy = upsertBy(readJson('packages/server/data/content/alchemy/recipes.json'), generated.alchemy, 'recipeId');

const outputs = [
  ['packages/server/data/maps/foundation_qinglin_marsh.json', generated.map],
  ['packages/server/data/maps/frostblade_abyss.json', frost],
  ['packages/server/data/content/monsters/青霖澤.json', generated.monsters],
  [itemPath, generated.items],
  ['packages/server/data/content/resource-nodes.json', resourceNodeDoc],
  [techniquePath, techniques],
  ['packages/server/data/content/forging/recipes.json', forging],
  ['packages/server/data/content/alchemy/recipes.json', alchemy],
];

const changed = [];
for (const [relativePath, value] of outputs) {
  const filePath = path.join(root, relativePath);
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (!fs.existsSync(filePath) || fs.readFileSync(filePath, 'utf8') !== serialized) {
    changed.push(relativePath);
    if (write) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, serialized);
    }
  }
}

console.log(JSON.stringify({ ok: write || changed.length === 0, write, changed, counts: {
  items: generated.items.length, monsters: generated.monsters.length,
  skills: generated.techniques.flatMap((entry) => entry.skills).length,
  forging: generated.forging.length, alchemy: generated.alchemy.length,
  resourceNodes: RESOURCE_NODE_IDS.length,
} }, null, 2));
if (!write && changed.length > 0) process.exitCode = 1;
