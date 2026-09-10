#!/usr/bin/env node
/** 後期內容整合驗證：真實模板載入、可達性、掉落/配方閉環與舊洞府回歸。無 DB 寫入。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const shared = require(path.join(root, 'packages/shared/dist/index.js'));
const { ContentTemplateRepository } = require(path.join(root, 'packages/server/dist/content/content-template.repository.js'));
const { MapTemplateRepository } = require(path.join(root, 'packages/server/dist/runtime/map/map-template.repository.js'));
const { MapInstanceRuntime } = require(path.join(root, 'packages/server/dist/runtime/instance/map-instance.runtime.js'));
const { CraftPanelRuntimeService } = require(path.join(root, 'packages/server/dist/runtime/craft/craft-panel-runtime.service.js'));
const { WorldRuntimeQuestQueryService } = require(path.join(root, 'packages/server/dist/runtime/world/query/world-runtime-quest-query.service.js'));
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const catalog = read('scripts/lib/late-game-story.json');
const prefix = 'packages/server/data/';
const lateItems = read(`${prefix}content/items/後期七境/內容.json`);
const itemSources = read('packages/client/src/constants/world/item-sources.generated.json');
const lateMonsters = read(`${prefix}content/monsters/後期七境.json`);
const monsterById = new Map(lateMonsters.map((monster) => [monster.id, monster]));
const content = new ContentTemplateRepository();
const mapRepo = new MapTemplateRepository();
const warnings = [];
content.logger.warn = (message) => warnings.push(String(message));
content.loadAll();
mapRepo.loadAll();
assert.deepEqual(warnings, [], '內容載入不得忽略任何技能/模板');
const craft = new CraftPanelRuntimeService(content, null, null, null, null);
craft.loadAlchemyCatalog(); craft.loadForgingCatalog();
const loadedRecipes = [...craft.alchemyCatalog, ...craft.forgingCatalog];
const knownRecipeIds = new Set(loadedRecipes.map((r) => r.recipeId));
const ingredientIds = new Set();
for (const kind of ['alchemy', 'forging']) {
  for (const recipe of read(`${prefix}content/${kind}/recipes.json`).filter((r) => /(^|[.])lg_/.test(r.recipeId))) {
    assert.ok(knownRecipeIds.has(recipe.recipeId), `實際製作目錄遺失 ${recipe.recipeId}`);
    assert.ok(content.createItem(recipe.outputItemId, 1), `配方產物 ${recipe.outputItemId}`);
    const main = recipe.mainIngredients;
    assert.ok(main?.length >= 1 && main.length <= 2, `主材數量 ${recipe.recipeId}`);
    const sums = {};
    for (const ingredient of recipe.ingredients) {
      ingredientIds.add(ingredient.itemId);
      const item = content.createItem(ingredient.itemId, 1);
      assert.ok(item, `配方材料 ${ingredient.itemId}`);
      if (ingredient.role === 'aux') for (const [key, value] of Object.entries(item.materialValues?.elements ?? {})) sums[key] = (sums[key] ?? 0) + value * ingredient.count;
    }
    for (const key of ['metal', 'wood', 'water', 'fire', 'earth']) {
      assert.equal(recipe.requiredAuxElements?.[key] ?? 0, sums[key] ?? 0, `標準投料五行不符 ${recipe.recipeId}/${key}`);
    }
  }
}
const mapIds = catalog.realms.flatMap((r) => [r.town.id, ...r.maps.map((m) => m.id)]).concat('lg_ascension_gate');
assert.equal(mapIds.length, 36);
assert.equal(new Set(mapIds).size, 36);
assert.equal(new Set(lateItems.map((a) => a.itemId)).size, lateItems.length);
assert.equal(new Set(lateMonsters.map((a) => a.id)).size, lateMonsters.length);
const sourceIds = new Set();
const report = [];

function flood(template) {
  const { width, height, walkableMask, spawnX, spawnY } = template;
  const visited = new Set([spawnY * width + spawnX]);
  const queue = [...visited];
  for (let at = 0; at < queue.length; at++) {
    const pos = queue[at], x = pos % width, y = Math.floor(pos / width);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy, index = yy * width + xx;
      if (xx < 0 || yy < 0 || xx >= width || yy >= height || !walkableMask[index] || visited.has(index)) continue;
      visited.add(index); queue.push(index);
    }
  }
  return visited;
}
for (const realm of catalog.realms) {
  const town = mapRepo.getOrThrow(realm.town.id);
  assert.equal(town.npcs.length, 8);
  assert.equal(content.createRuntimeMonstersForMap(town.id).length, 0, `${town.id}城鎮不得刷怪`);
  for (const npc of town.npcs) for (const entry of npc.shopItems) {
    sourceIds.add(entry.itemId);
    assert.ok(content.createItem(entry.itemId, 1));
    assert.ok(Number.isSafeInteger(entry.price) && entry.price > 0);
  }
  for (const info of realm.maps) {
    assert.ok(info.description.length >= 60, `${info.name}缺少正式地貌描述`);
    assert.ok(!/原始設計|境界戰場/.test(info.description));
    for (const mob of info.monsters) assert.ok(!/^(地貌尺寸|頭目|名稱|外觀|用途)$/.test(mob.name));
    const map = mapRepo.getOrThrow(info.id);
    const raw = read(`${prefix}maps/${info.id}.json`);
    const document = shared.normalizeEditableMapDocument(raw);
    // format:2 的簡式刷新點從怪物目錄補足編輯器必填顯示欄位。
    for (const spawn of document.monsterSpawns) {
      const template = monsterById.get(spawn.id);
      assert.ok(template, `刷新點無模板 ${spawn.id}`);
      spawn.name = template.name; spawn.char = template.char;
      assert.ok(template.level >= info.startLevel && template.level <= info.startLevel + 2,
        `怪物超出地圖等級帶 ${template.id}`);
    }
    assert.equal(shared.validateEditableMapDocument(document), null, `地圖文件校驗 ${info.id}`);
    const roundtrip = shared.serializeEditableMapDocumentToFormatV2(document);
    assert.deepEqual(roundtrip.mineralNodes, raw.mineralNodes, `${info.id}編輯器不得丟礦脈`);
    assert.equal(map.source.mapLv, info.startLevel);
    assert.ok(map.containers.length >= 2, `${info.id}草藥節點`);
    assert.ok(raw.mineralNodes.length >= 1, `${info.id}礦脈`);
    for (const c of map.containers) {
      assert.equal(c.variant, 'herb', '礦石不可偽裝成採藥容器');
      for (const drop of c.drops ?? []) sourceIds.add(drop.itemId);
    }
    for (const mineral of raw.mineralNodes) {
      sourceIds.add(mineral.itemId);
      assert.equal(content.createItem(mineral.itemId, 1).materialCategory, 'ore');
    }
    const spawns = content.createRuntimeMonstersForMap(info.id);
    const instance = new MapInstanceRuntime({ instanceId: `proof:${info.id}`, template: map, monsterSpawns: spawns,
      kind: 'public', persistent: false, createdAt: 0 });
    assert.equal(instance.listMonsters().length, spawns.length, '所有刷新點均能落圖');
    const monsters = lateMonsters.filter((m) => spawns.some((s) => s.monsterId === m.id));
    assert.ok(monsters.some((m) => m.tier === 'variant'), `${info.id}缺少精英`);
    assert.equal(monsters.filter((m) => m.tier === 'demon_king').length, 1);
    for (const monster of monsters) {
      const runtime = spawns.find((s) => s.monsterId === monster.id);
      assert.equal(runtime.skills.length, monster.skills?.length ?? 0, `技能全部載入 ${monster.id}`);
      if (monster.tier === 'demon_king') assert.ok(runtime.skills.length >= 3);
      for (const key of ['maxHp', 'physAtk', 'spellAtk', 'physDef', 'spellDef', 'hit', 'dodge']) {
        assert.ok(Number.isFinite(runtime.baseNumericStats[key]) && runtime.baseNumericStats[key] > 0, `非有限怪物屬性 ${monster.id}/${key}`);
      }
      for (const drop of monster.drops) {
        sourceIds.add(drop.itemId);
        assert.ok(content.createItem(drop.itemId, 1), `不存在掉落 ${drop.itemId}`);
        assert.ok((drop.chance ?? 1) > 0 && (drop.chance ?? 1) <= 1);
        assert.ok(drop.count >= 1 && drop.count <= 6, '禁止測試型大量掉落');
      }
    }
    report.push({ map: info.name, level: `${info.startLevel}-${info.startLevel + 2}`, monsters: spawns.length,
      boss: info.boss.name, herbNodes: map.containers.length, mineralNodes: raw.mineralNodes.length });
  }
}
for (const id of mapIds) {
  const template = mapRepo.getOrThrow(id), reachable = flood(template);
  for (const p of [...template.portals, ...template.npcs]) assert.ok(reachable.has(p.y * template.width + p.x), `${id}不可達 ${p.id}`);
  for (const p of template.containers) assert.ok(reachable.has(p.y * template.width + p.x), `${id}藥草不可達 ${p.id}`);
  const raw = read(`${prefix}maps/${id}.json`);
  for (const p of raw.mineralNodes ?? []) assert.ok([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => reachable.has((p.y + dy) * template.width + p.x + dx)), `${id}礦脈無站位`);
}
for (const [id, x, y] of [['darksoil_abyss', 28, 50], ['guizang_vein_cavern', 21, 21]]) {
  const template = mapRepo.getOrThrow(id);
  assert.ok(flood(template).has(y * template.width + x), `舊區入口不可達 ${id}`);
}
const graphSeen = new Set(['darksoil_abyss']), graphQueue = [...graphSeen];
for (let i = 0; i < graphQueue.length; i++) for (const portal of mapRepo.getOrThrow(graphQueue[i]).portals) {
  if (graphSeen.has(portal.targetMapId)) continue;
  graphSeen.add(portal.targetMapId); graphQueue.push(portal.targetMapId);
}
for (const id of mapIds) assert.ok(graphSeen.has(id), `築基後路網斷裂 ${id}`);
for (const item of lateItems) {
  assert.ok(content.createItem(item.itemId, 1), `物品未載入 ${item.itemId}`);
  assert.ok(itemSources[item.itemId]?.length, `客戶端缺少取得來源 ${item.name}`);
  if (item.materialCategory === 'herb') {
    assert.ok(itemSources[item.itemId].some((entry) => entry.kind === 'search')
      && !itemSources[item.itemId].some((entry) => entry.kind === 'mining'), `草藥來源不得標成挖礦 ${item.name}`);
  }
  if (item.materialCategory === 'ore') assert.ok(itemSources[item.itemId].some((entry) => entry.kind === 'mining'), `礦石來源 ${item.name}`);
  assert.ok(sourceIds.has(item.itemId) || loadedRecipes.some((r) => r.outputItemId === item.itemId)
    || item.itemId === 'mat.lg_huanling_nameplate', `新物品沒有取得途徑 ${item.name}`);
  if (item.type === 'material' && item.itemId !== 'mat.lg_huanling_nameplate') {
    assert.ok(Object.values(item.materialValues?.elements ?? {}).some((v) => v > 0), `材料無五行用途 ${item.name}`);
  }
}
const huanling = read(`${prefix}content/monsters/破败洞府.json`)[0];
assert.equal(huanling.initialBuffs[0].mainCombatStatsPercent, -120);
assert.ok(huanling.drops.every((d) => d.count <= 2));
assert.ok(mapRepo.getOrThrow(catalog.realms[0].town.id).npcs.some((n) => n.name.includes('祝餘') && n.quests.length > 0));
const quest = mapRepo.getOrThrow(catalog.realms[0].town.id).npcs.flatMap((n) => n.quests)
  .find((q) => q.id === 'q_lg_huanling_old_debt');
assert.equal(quest.requiredItemId, 'mat.lg_huanling_nameplate');
assert.equal(quest.requiredItemCount, 1);
assert.equal(quest.targetMonsterId, huanling.id);
for (const [progress, count, expected] of [[0, 1, false], [1, 0, false], [1, 1, true]]) {
  const query = { playerRuntimeService: { getInventoryCountByItemId: () => count } };
  assert.equal(WorldRuntimeQuestQueryService.prototype.canQuestBecomeReady.call(query, 'proof', { ...quest, progress }), expected,
    '喚靈任務必須同時完成擊殺與持有名牌');
}
assert.equal(quest.reward[0].count, 2);
assert.deepEqual(warnings, []);
const result = { ok: true, maps: mapIds.length, towns: 7, npcs: 56, items: lateItems.length,
  monsters: lateMonsters.length, recipes: loadedRecipes.filter((r) => /(^|[.])lg_/.test(r.recipeId)).length,
  databaseWrites: 0, report };
fs.mkdirSync(path.join(root, '.runtime/late-game'), { recursive: true });
fs.writeFileSync(path.join(root, '.runtime/late-game/content-proof.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
