/** 用途：驗證資料驅動地圖礦脈的格式、內容引用與地塊掉落覆寫。 */
import assert from 'node:assert/strict';

import {
  computeCraftSkillExpGain,
  MINING_EXP_BASE_ACTION_TICKS,
  normalizeEditableMapDocument,
  serializeEditableMapDocumentToFormatV2,
  TileType,
  validateEditableMapDocument,
  type GmMapDocument,
  type GmMapMineralNodeRecord,
} from '@mud/shared';
import { MapInstanceRuntime } from '../runtime/instance/map-instance.runtime';
import { MapTemplateRepository } from '../runtime/map/map-template.repository';
import { applyMiningExpForTileDamage, applyMiningExpForTileDamageBatch } from '../runtime/world/combat/tile-drop.helpers';
import { WorldRuntimeDetailQueryService } from '../runtime/world/query/world-runtime-detail-query.service';
import { installSmokeTimeout } from './smoke-timeout';

installSmokeTimeout(__filename);

type MineralNodeSmokeDocument = GmMapDocument & {
  mineralNodes: GmMapMineralNodeRecord[];
};

type RuntimeMapTemplate = ReturnType<MapTemplateRepository['registerRuntimeMapTemplate']>;

function createDocument(overrides: Partial<MineralNodeSmokeDocument> = {}): MineralNodeSmokeDocument {
  return {
    id: 'mineral-node-smoke-map',
    name: '礦脈 Smoke',
    width: 3,
    height: 1,
    routeDomain: 'system',
    mapLv: 1,
    tiles: ['.铁.'],
    portals: [],
    spawnPoint: { x: 0, y: 0 },
    npcs: [],
    monsterSpawns: [],
    mineralNodes: [{
      x: 1,
      y: 0,
      name: '煙晶礦脈',
      itemId: 'spirit_stone',
      level: 29,
      damageChanceBps: 10_000,
      destroyCount: 3,
    }],
    ...overrides,
  };
}

function createInstance(template: RuntimeMapTemplate): MapInstanceRuntime {
  return new MapInstanceRuntime({
    instanceId: 'instance:mineral-node-smoke',
    template,
    monsterSpawns: [],
    kind: 'public',
    persistent: false,
    createdAt: Date.now(),
    displayName: template.name,
    linePreset: 'peaceful',
    lineIndex: 1,
    instanceOrigin: 'smoke',
    defaultEntry: true,
    supportsPvp: false,
    canDamageTile: true,
  });
}

function testConfiguredDropsAndSerialization(): void {
  const normalized = normalizeEditableMapDocument(createDocument());
  assert.equal(validateEditableMapDocument(normalized), null);
  const roundTrip = normalizeEditableMapDocument(serializeEditableMapDocumentToFormatV2(normalized));
  assert.deepEqual(roundTrip.mineralNodes, normalized.mineralNodes);

  const repository = new MapTemplateRepository();
  const template = repository.registerRuntimeMapTemplate(normalized);
  assert.equal(template.mineralNodeByTile.get(1)?.itemId, 'spirit_stone');

  const instance = createInstance(template);
  const state = instance.getTileCombatState(1, 0);
  assert.equal(state?.targetName, '煙晶礦脈');
  assert.equal(state?.miningLevel, 29);
  const result = instance.damageTile(1, 0, state.maxHp);
  assert.equal(result?.destroyed, true);
  assert.deepEqual(result?.tileDrops, [
    { itemId: 'spirit_stone', count: 1, reason: 'damage' },
    { itemId: 'spirit_stone', count: 3, reason: 'destroy' },
  ]);
  assert.equal(result?.tileDrops.some((drop) => drop.itemId === 'black_iron_chunk'), false);
}

function testConfiguredMiningLevelFeedsExperienceAndInspection(): void {
  const repository = new MapTemplateRepository();
  const template = repository.registerRuntimeMapTemplate(createDocument());
  const instance = createInstance(template);
  const playerRuntimeService = {
    playerProgressionService: {
      getRealmRuntimeExpToNext(level: number) {
        return level * 10_000;
      },
    },
  };
  const createAttacker = () => ({
    realmLv: 200,
    realm: { realmLv: 200 },
    miningSkill: { level: 200, exp: 0, expToNext: Number.MAX_SAFE_INTEGER },
  });
  const expectedGain = (targetLevel: number) => computeCraftSkillExpGain({
    playerRealmLevel: 200,
    skillLevel: 200,
    targetLevel,
    baseActionTicks: MINING_EXP_BASE_ACTION_TICKS,
    getExpToNextByLevel: (level) => level * 10_000,
    successCount: 1,
    failureCount: 0,
    successMultiplier: 1,
  }).finalGain;

  const legacyAttacker = createAttacker();
  const legacy = applyMiningExpForTileDamage({
    attacker: legacyAttacker,
    tileType: TileType.BlackIronOre,
    appliedDamage: 1,
    playerRuntimeService,
  });
  assert.equal(legacy.gained, expectedGain(11));

  const customLevel43Attacker = createAttacker();
  const customLevel43 = applyMiningExpForTileDamage({
    attacker: customLevel43Attacker,
    tileType: TileType.BlackIronOre,
    miningLevel: 43,
    appliedDamage: 1,
    playerRuntimeService,
  });
  assert.equal(customLevel43.gained, expectedGain(43));

  const customLevel126Attacker = createAttacker();
  const customLevel126 = applyMiningExpForTileDamageBatch({
    attacker: customLevel126Attacker,
    entries: [{ tileType: TileType.BlackIronOre, miningLevel: 126, appliedDamage: 1 }],
    playerRuntimeService,
  });
  assert.equal(customLevel126.gained, expectedGain(126));
  assert.equal(customLevel126.hitCount, 1);

  const detailService = new WorldRuntimeDetailQueryService(
    {} as never,
    {
      has() {
        return false;
      },
      getOrThrow() {
        throw new Error('unexpected template lookup');
      },
    } as never,
    {
      getPlayer() {
        return null;
      },
    } as never,
    {} as never,
  );
  const detail = detailService.buildTileDetail({
    view: {
      self: { x: 0, y: 0 },
      visibleTileIndices: [1],
      instance: { width: template.width, height: template.height },
      localNpcs: [],
      localMonsters: [],
      visiblePlayers: [],
      localPortals: [],
      localGroundPiles: [],
    },
    viewer: {
      playerId: 'player:mineral-node-smoke',
      attrs: { numericStats: { viewRange: 8 }, finalAttrs: { spirit: 100 } },
    },
    location: { instanceId: 'instance:mineral-node-smoke' },
    instance,
  } as never, { x: 1, y: 0 });
  assert.equal(detail.targetName, '煙晶礦脈');
  assert.equal(detail.miningLevel, 29);
}

function testOrdinaryOreKeepsLegacyDrops(): void {
  const repository = new MapTemplateRepository();
  const template = repository.registerRuntimeMapTemplate(createDocument({
    id: 'ordinary-ore-smoke-map',
    mineralNodes: [],
  }));
  const instance = createInstance(template);
  const state = instance.getTileCombatState(1, 0);
  assert.equal(state?.mineralNode, null);
  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    const result = instance.damageTile(1, 0, state.maxHp);
    assert.deepEqual(result?.tileDrops, [
      { itemId: 'black_iron_chunk', count: 1, reason: 'damage' },
      { itemId: 'black_iron_chunk', count: 1, reason: 'destroy' },
    ]);
  } finally {
    Math.random = originalRandom;
  }
}

function testInvalidMineralNodesAreRejected(): void {
  assert.match(
    validateEditableMapDocument(normalizeEditableMapDocument(createDocument({ mineralNodes: [{ ...createDocument().mineralNodes[0], x: 3 }] }))) ?? '',
    /越界/,
  );
  assert.match(
    validateEditableMapDocument(normalizeEditableMapDocument(createDocument({ mineralNodes: [{ ...createDocument().mineralNodes[0], x: 0 }] }))) ?? '',
    /玄鐵礦/,
  );
  assert.match(
    validateEditableMapDocument(normalizeEditableMapDocument(createDocument({ mineralNodes: [createDocument().mineralNodes[0], createDocument().mineralNodes[0]] }))) ?? '',
    /重複/,
  );
  assert.match(
    validateEditableMapDocument(normalizeEditableMapDocument(createDocument({ mineralNodes: [{ ...createDocument().mineralNodes[0], damageChanceBps: 10_001 }] }))) ?? '',
    /0 到 10000/,
  );
  const repository = new MapTemplateRepository();
  assert.throws(
    () => repository.registerRuntimeMapTemplate(createDocument({
      id: 'invalid-item-mineral-node-smoke-map',
      mineralNodes: [{ ...createDocument().mineralNodes[0], itemId: 'missing.mineral.item' }],
    })),
    /掉落物品不存在/,
  );
}

function testFormatV2ExistingTerrainCharactersValidate(): void {
  for (const terrain of ['寒', '熔']) {
    const normalized = normalizeEditableMapDocument({
      format: 2,
      id: `format-v2-${terrain}-smoke-map`,
      name: '既有地形字元 Smoke',
      width: 2,
      height: 1,
      routeDomain: 'system',
      terrain: [`${terrain}地`],
      structure: ['..'],
      spawnPoint: { x: 1, y: 0 },
      portals: [],
      npcs: [],
      monsterSpawns: [],
    });
    assert.equal(validateEditableMapDocument(normalized), null);
  }
}

function main(): void {
  testConfiguredDropsAndSerialization();
  testConfiguredMiningLevelFeedsExperienceAndInspection();
  testOrdinaryOreKeepsLegacyDrops();
  testInvalidMineralNodesAreRejected();
  testFormatV2ExistingTerrainCharactersValidate();
  console.log(JSON.stringify({
    ok: true,
    case: 'map-mineral-node',
    answers: '自訂礦脈以座標索引覆寫玄鐵礦掉落，保留舊礦脈規則並拒絕格式或內容引用錯誤。',
  }, null, 2));
}

void main();
