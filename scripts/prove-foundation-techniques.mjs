#!/usr/bin/env node
/** 以實際 ContentTemplateRepository 與坊市服務驗證築基功法內容；不寫入資料庫。 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { applyFoundationTechniqueDrops, buildFoundationTechniques, FOUNDATION_TECHNIQUE_PREFIX, LEGACY_BOOK_DROPS } from './lib/foundation-techniques.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const loadSharp = () => {
  const bundled = process.env.CODEX_BUNDLED_NODE_MODULES
    ?? path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
  try { return require('sharp'); } catch { return createRequire(path.join(bundled, 'package.json'))('sharp'); }
};
const sharp = loadSharp();
const sha256 = (content) => crypto.createHash('sha256').update(content).digest('hex');
const shared = require(path.join(root, 'packages/shared/dist/index.js'));
const { ContentTemplateRepository } = require(path.join(root, 'packages/server/dist/content/content-template.repository.js'));
const { MarketRuntimeService } = require(path.join(root, 'packages/server/dist/runtime/market/market-runtime.service.js'));
const { PlayerCombatService } = require(path.join(root, 'packages/server/dist/runtime/combat/player-combat.service.js'));
const { PlayerRuntimeService } = require(path.join(root, 'packages/server/dist/runtime/player/player-runtime.service.js'));
const { PlayerAttributesService } = require(path.join(root, 'packages/server/dist/runtime/player/player-attributes.service.js'));
const { setCombatRngForTesting, resetCombatRngForTesting } = require(path.join(root, 'packages/server/dist/runtime/combat/combat-resolution.helpers.js'));
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const data = 'packages/server/data/content';
const built = buildFoundationTechniques(shared);
const generatedMonsters = new Map(Object.values(built.maps).map(({ file }) => [file, read(`${data}/monsters/${file}`)]));
const managedBookIds = new Set([...built.books.map((book) => book.itemId), ...LEGACY_BOOK_DROPS.map((drop) => drop.itemId)]);
const nonManagedDropsBefore = snapshotNonManagedDrops(generatedMonsters, managedBookIds);
const acquisition = applyFoundationTechniqueDrops(generatedMonsters, built.books);
assert.deepEqual(snapshotNonManagedDrops(generatedMonsters, managedBookIds), nonManagedDropsBefore, '生成器不得改寫非本批功法書掉落');
const diskTechniques = read(`${data}/techniques/筑基期/玩家功法.json`);
const diskBooks = read(`${data}/items/筑基期/书籍.json`);
assert.deepEqual(diskTechniques, built.techniques, '正式築基功法未由生成器同步');
assert.deepEqual(diskBooks, built.books, '正式築基書籍未由生成器同步');
for (const [file, expected] of generatedMonsters) assert.deepEqual(read(`${data}/monsters/${file}`), expected, `${file}掉落未由生成器同步`);

const warnings = [];
const content = new ContentTemplateRepository();
content.logger.warn = (message) => warnings.push(String(message));
content.loadAll();
assert.deepEqual(warnings, [], '內容載入不得忽略模板');
assert.equal(diskTechniques.length, 12);
assert.equal(diskBooks.length, 12);
assert.equal(new Set(diskTechniques.map((item) => item.id)).size, 12, '功法 ID 重複');
assert.deepEqual(Object.fromEntries(['internal', 'arts', 'secret', 'divine'].map((category) => [category,
  diskTechniques.filter((item) => item.category === category).length])), { internal: 3, arts: 3, secret: 3, divine: 3 });
for (const [index, raw] of diskTechniques.entries()) {
  const template = content.techniqueTemplates.get(raw.id);
  assert.ok(template, `真實模板缺少 ${raw.id}`);
  assert.equal(template.layers.length, raw.maxLayer, `${raw.id}滿層展開不完整`);
  assert.ok(template.layers.every((layer, layerIndex) => layer.level === layerIndex + 1), `${raw.id}層級不連續`);
  assert.equal(raw.realmLv, index + 31, `${raw.id}境界不連續`);
  assert.equal(raw.id, `${FOUNDATION_TECHNIQUE_PREFIX}${index + 1}`);
  const book = diskBooks[index];
  assert.equal(book.itemId, `book.${raw.id}`);
  assert.equal(book.learnTechniqueId, raw.id);
  assert.equal(Object.hasOwn(book, 'learnTechniqueMaxLevel'), false, `${book.itemId}全卷不得誤設學習上限`);
  assert.ok(content.createItem(book.itemId, 1), `書籍未載入 ${book.itemId}`);
  if (raw.category === 'internal') {
    assert.equal(template.skills.length, 0, `${raw.id}內功不得有主動技能`);
    const expected = shared.calcInternalTechniqueAttrTotalByBudgetPercent(raw.grade, raw.realmLv, raw.budgetPercent);
    const actual = Object.values(shared.calcTechniqueAttrValues(template.layers.length, template.layers)).reduce((sum, value) => sum + Number(value), 0);
    assert.ok(Math.abs(actual - expected) <= Math.max(3, expected * 0.01), `${raw.id}未使用共用內功預算`);
  } else {
    assert.equal(template.skills.length, 1, `${raw.id}必須有唯一技能`);
    assert.ok(template.skills[0].cost >= 0 && Number.isFinite(template.skills[0].cost), `${raw.id}耗靈非法`);
  }
}
assert.equal(content.techniqueTemplates.get('ningqi_chengji').maxLayer, 49, '既有凝氣成基法不得變更');
assert.equal(content.techniqueTemplates.get('xuesha_huanling_jue').maxLayer, 9, '既有血煞喚靈決不得變更');
for (const legacy of LEGACY_BOOK_DROPS) {
  const drops = content.monsterDropsByMonsterId.get(legacy.monsterId) ?? [];
  assert.ok(drops.some((drop) => drop.itemId === legacy.itemId && drop.chance === legacy.chance), `既有天階掉落缺少 ${legacy.monsterId}/${legacy.itemId}`);
}
for (const entry of acquisition) {
  assert.ok(entry.sources.length > 0, `${entry.techniqueId}沒有掉落來源`);
  for (const source of entry.sources) {
    const runtime = content.createRuntimeMonstersForMap(entry.mapId);
    assert.ok(runtime.some((monster) => monster.monsterId === source.monsterId), `${entry.techniqueId}來源未在${entry.mapName}刷新`);
    const drops = content.monsterDropsByMonsterId.get(source.monsterId) ?? [];
    assert.ok(drops.some((drop) => drop.itemId === entry.bookId && drop.chance === source.chance), `${entry.bookId}掉落未載入 ${source.monsterId}`);
  }
}
const market = new MarketRuntimeService(content);
assert.equal(market.openOrders.length, 0, '零掛單目錄前提不成立');
const catalog = new Map(market.buildMarketListingEntries().map((entry) => [entry.itemId, entry]));
for (const book of diskBooks) {
  const row = catalog.get(book.itemId);
  assert.ok(row, `坊市零掛單目錄遺失 ${book.itemId}`);
  assert.equal(row.sellQuantity, 0); assert.equal(row.buyQuantity, 0);
  assert.equal(market.resolveMarketItemForBuy({ itemKey: row.itemKey })?.learnTechniqueId, book.learnTechniqueId);
}
const balance = proveBalance(content);
const artwork = await proveArtwork(diskBooks);
const buffCatalog = proveSharedBuffCatalog(diskTechniques);
const learningCaps = diskTechniques.map((raw) => {
  const template = content.techniqueTemplates.get(raw.id);
  assert.equal(shared.normalizeTechniqueLearnMaxLevel(undefined, template.layers, 1), undefined, `${raw.id}全卷不得變為殘卷上限`);
  assert.equal(shared.normalizeTechniqueLearnMaxLevel(1, template.layers, 1), 1, `${raw.id}一層殘卷上限失效`);
  return { id: raw.id, fullVolumeCap: template.maxLayer, residualCap: 1 };
});
console.log(JSON.stringify({ ok: true, techniques: diskTechniques.length, books: diskBooks.length, categories: 4,
  zeroOrderCatalog: true, reachableDropSources: acquisition.reduce((count, item) => count + item.sources.length, 0), balance, artwork, buffCatalog, learningCaps, databaseWrites: 0 }));

function proveSharedBuffCatalog(techniques) {
  const catalog = read('packages/client/src/constants/world/editor-catalog.generated.json');
  const sharedIds = ['lg.manual.wayfinding', 'lg.manual.breath', 'lg.manual.contemplation', 'lg.manual.divine_guard'];
  const forbiddenUniversalFields = ['stats', 'attrs', 'sourceSkillId', 'sourceSkillName'];
  for (const buffId of sharedIds) {
    const entry = catalog.buffs?.find((buff) => buff.buffId === buffId);
    assert.ok(entry, `編輯器 buff 目錄遺失 ${buffId}`);
    assert.ok(typeof entry.name === 'string' && entry.name.length > 0, `${buffId}缺少共用名稱`);
    assert.ok(typeof entry.category === 'string' && entry.category.length > 0, `${buffId}缺少共用分類`);
    for (const field of forbiddenUniversalFields) assert.equal(Object.hasOwn(entry, field), false, `${buffId}不得把單一來源 ${field} 寫入全域目錄`);
  }
  const catalogTechniques = new Map((catalog.techniques ?? []).map((template) => [template.id, template]));
  for (const technique of techniques) {
    const generated = catalogTechniques.get(technique.id);
    assert.ok(generated, `編輯器功法目錄遺失 ${technique.id}`);
    assert.deepEqual(generated.skills?.map((skill) => skill.effects), technique.skills?.map((skill) => skill.effects),
      `${technique.id}原始技能效果不得因共用 buff 目錄消歧而變更`);
  }
  return { sharedBuffIds: sharedIds, sourceSpecificFieldsOmitted: forbiddenUniversalFields, foundationEffectsPreserved: techniques.length };
}

async function proveArtwork(books) {
  const metadataPath = path.join(root, 'docs/artwork/atlases/foundation-manuals-01.json');
  const metadata = read('docs/artwork/atlases/foundation-manuals-01.json');
  const records = metadata.records ?? [], expectedIds = books.map((book) => book.itemId);
  assert.equal(metadata.columns, 4); assert.equal(metadata.rows, 3);
  assert.equal(metadata.items?.length, 12, '圖集項目數錯誤'); assert.equal(records.length, 12, '圖集記錄數錯誤');
  assert.deepEqual(records.map((record) => record.id), expectedIds, '圖集 ID 順序錯誤');
  assert.equal(new Set(records.map((record) => record.cropSha256)).size, 12, '裁切 hash 必須一圖一物');
  const atlasFile = path.join(root, 'docs/artwork/atlases/foundation-manuals-01.webp');
  const atlasBytes = fs.readFileSync(atlasFile), atlasMetadata = await sharp(atlasBytes).metadata(), atlasStats = await sharp(atlasBytes).stats();
  assert.equal(atlasMetadata.format, 'webp'); assert.equal(atlasMetadata.width, metadata.dimensions[0]); assert.equal(atlasMetadata.height, metadata.dimensions[1]);
  assert.ok(atlasMetadata.hasAlpha && atlasStats.channels[3]?.min === 0 && atlasStats.channels[3]?.max >= 200, '圖集必須保留透明 alpha');
  const icons = read('packages/client/src/constants/world/item-art.generated.json');
  const outputHashes = new Set();
  for (const [index, record] of records.entries()) {
    assert.equal(record.cell?.col, index % 4, `${record.id}欄位錯誤`); assert.equal(record.cell?.row, Math.floor(index / 4), `${record.id}列位錯誤`);
    assert.equal(metadata.items[index]?.id, record.id, `${record.id}圖集格位對應錯誤`);
    assert.equal(record.sourceSha256, metadata.sourceSha256, `${record.id}來源 hash 不符`);
    assert.equal(record.extraction?.method, 'connected-alpha-components', `${record.id}裁切方法錯誤`);
    assert.ok(record.extraction?.width > 0 && record.extraction?.height > 0, `${record.id}裁切範圍錯誤`);
    const stem = `/assets/item-icons/v1/${record.id}`;
    assert.equal(icons[record.id], stem, `${record.id}圖示映射錯誤`);
    for (const size of [96, 192]) {
      const output = record.outputs?.find((entry) => entry.size === size);
      assert.ok(output, `${record.id}缺少 ${size} 產物 metadata`);
      const file = path.join(root, 'packages/client/public', `${stem}-${size}.webp`), bytes = fs.readFileSync(file), image = await sharp(bytes).metadata();
      assert.equal(image.format, 'webp'); assert.equal(image.width, size); assert.equal(image.height, size);
      assert.equal(sha256(bytes), output.sha256, `${record.id}/${size} hash 不符`); assert.equal(bytes.length, output.bytes, `${record.id}/${size} bytes 不符`);
      outputHashes.add(output.sha256);
    }
  }
  assert.equal(outputHashes.size, 24, '24 個正式圖示不得重複');
  return { atlas: path.relative(root, atlasFile), metadata: path.relative(root, metadataPath), items: records.length, outputFiles: outputHashes.size, transparentSource: true };
}

function proveBalance(contentRepository) {
  const combat = new PlayerCombatService({});
  const rows = [];
  setCombatRngForTesting(() => 0.999999);
  try {
    for (const id of ['foundation_manual_2', 'foundation_manual_6', 'foundation_manual_10', 'foundation_manual_4', 'foundation_manual_8', 'foundation_manual_12']) {
      const template = contentRepository.techniqueTemplates.get(id), skill = template.skills[0];
      const entry = executeSkill(combat, template, 1), full = executeSkill(combat, template, template.maxLayer);
      assert.ok(full.totalRawDamage >= entry.totalRawDamage && full.totalHeal >= entry.totalHeal, `${id}滿層效果倒退`);
      rows.push({ id, cooldown: skill.cooldown, entryDamage: entry.totalRawDamage / 1_000_000, fullDamage: full.totalRawDamage / 1_000_000,
        fullHealRatio: full.totalHeal / 1_000_000, targetBuffDurations: full.targetBuffs.map((buff) => buff.duration),
        targetBuffStats: skill.effects.filter((effect) => effect.type === 'buff' && effect.target === 'target').map((effect) => effect.stats) });
    }
  } finally { resetCombatRngForTesting(); }
  const arts = rows.slice(0, 3);
  for (const row of arts) assert.ok(row.fullDamage >= 2.8 && row.fullDamage <= 3.25, `${row.id}滿層法術效率越界`);
  assert.deepEqual([arts[0].targetBuffDurations[0], arts[0].targetBuffStats[0]], [3, { moveSpeed: -20 }], '霜刃減速幅度或時間錯誤');
  assert.deepEqual([arts[1].targetBuffDurations[0], arts[1].targetBuffStats[0]], [2, { moveSpeed: -45 }], '藤火控場幅度或時間錯誤');
  assert.deepEqual(rows.slice(3).map((row) => row.cooldown), [240, 420, 300], '神通長冷卻契約錯誤');
  assert.ok(Math.abs(rows[3].fullHealRatio - 0.05) < 1e-6 && rows[3].fullDamage === 0, '玄龜護元治療取整錯誤');
  assert.ok(Math.abs(rows[4].fullDamage - 4.4) < 1e-6 && rows[4].fullDamage * 3 <= 13.200001 && rows[4].fullHealRatio === 0,
    `焚林照夜範圍傷害錯誤：${rows[4].fullDamage}`);
  assert.equal(rows[5].fullDamage, 0, '五行鎮脈不得兼作爆發傷害');
  const secrets = ['foundation_manual_3', 'foundation_manual_7', 'foundation_manual_11'].map((id) => contentRepository.techniqueTemplates.get(id));
  const secretEffects = secrets.map((template) => template.skills[0].effects[0]);
  assert.deepEqual(secretEffects.map((effect) => effect.duration), [45, 18, 50], '秘術持續時間錯誤');
  assert.deepEqual(secretEffects.map((effect) => effect.stats), [{ viewRange: 1 }, { maxQiOutputPerTick: 8 }, { techniqueExpRate: 400 }], '秘術取整或百分點錯誤');
  const attributes = new PlayerAttributesService();
  const player = makeBuffPlayer(attributes);
  attributes.recalculate(player, 'initialization');
  const runtime = { getPlayerOrThrow: () => player, playerAttributesService: attributes, bumpPersistentRevision: (target) => { target.persistentRevision += 1; } };
  const apply = (effect, skillId) => PlayerRuntimeService.prototype.applyTemporaryBuff.call(runtime, 'proof', { ...effect, sourceSkillId: skillId, remainingTicks: effect.duration + 1 });
  apply(secretEffects[0], secrets[0].skills[0].id);
  apply({ ...secretEffects[0], stats: { moveSpeed: 1 } }, 'lg.manual.replacement');
  assert.equal(player.buffs.buffs.length, 1, '跨境共用 buffId 不得疊加');
  assert.equal(player.buffs.buffs[0].sourceSkillId, 'lg.manual.replacement', '跨境施放必須更新來源原型');
  return { arts, divine: rows.slice(3), secrets: secretEffects.map((effect) => ({ duration: effect.duration, stats: effect.stats })), crossRealmBuffStacks: player.buffs.buffs.length };
}

function makeCombatant(realmLv, target = false) {
  const base = shared.PLAYER_REALM_NUMERIC_TEMPLATES[shared.DEFAULT_PLAYER_REALM_STAGE];
  const numericStats = shared.cloneNumericStats(base.stats);
  Object.assign(numericStats, { maxHp: 1_000_000, maxQi: 1e15, physAtk: target ? 0 : 1_000_000, spellAtk: target ? 0 : 1_000_000,
    physDef: target ? 0 : 1_000_000, spellDef: 0, hit: 1e15, dodge: 0, crit: 0, antiCrit: 1e15, breakPower: 0, resolvePower: 1e15, maxQiOutputPerTick: 1e15 });
  return { playerId: target ? 'target' : 'caster', hp: 1_000_000, maxHp: 1_000_000, qi: 1e15, maxQi: 1e15, combatAttackIntensity: 10,
    realm: { realmLv }, attrs: { numericStats, ratioDivisors: shared.cloneNumericRatioDivisors(base.ratioDivisors), revision: 1 }, buffs: { buffs: [], revision: 0 }, techniques: { techniques: [] }, combat: { cooldownReadyTickBySkillId: {} }, craftSkills: {} };
}

function executeSkill(combat, template, level) {
  return combat.executeResolvedSkillCast(makeCombatant(template.realmLv), makeCombatant(template.realmLv, true), { skill: template.skills[0], level, readyTick: 0 }, 1, template.skills[0].range,
    {}, { skipResourceAndCooldown: true, skipRangeValidation: true, targetCount: template.skills[0].targeting?.maxTargets ?? 1 });
}

function makeBuffPlayer(attributes) {
  return { playerId: 'proof', persistentRevision: 1, selfRevision: 1, luck: 0, fengShuiLuck: 0,
    realm: { stage: shared.DEFAULT_PLAYER_REALM_STAGE, realmLv: 42 }, hp: 100, maxHp: 100, qi: 0, maxQi: 0, attrs: attributes.createInitialState(),
    equipment: { revision: 1, slots: [] }, techniques: { revision: 1, techniques: [], cultivatingTechId: null }, buffs: { revision: 1, buffs: [] }, runtimeBonuses: [],
    bodyTraining: { level: 0, exp: 0, expToNext: 0 }, combat: { cultivationActive: false }, spiritualRoots: null, dirtyDomains: new Set() };
}

function snapshotNonManagedDrops(monstersByFile, managedIds) {
  return Object.fromEntries([...monstersByFile.entries()].map(([file, monsters]) => [file, monsters.map((monster) => ({
    id: monster.id,
    drops: (monster.drops ?? []).filter((drop) => !managedIds.has(drop.itemId)),
  }))]));
}
