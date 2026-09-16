/** 宗門設施的真實建築投影 → 附近互動回歸；僅使用記憶體，不連線資料庫。 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../packages/server/package.json', import.meta.url));
const { SPIRIT_BEAST_FACILITIES } = require('@mud/shared');
const { compileBuildingDefinitions } = require('../server/dist/runtime/building/building-content.repository.js');
const { MapTemplateRepository } = require('../server/dist/runtime/map/map-template.repository.js');
const { MapInstanceRuntime } = require('../server/dist/runtime/instance/map-instance.runtime.js');
const { WorldRuntimeContextActionQueryService } = require('../server/dist/runtime/world/query/world-runtime-context-action-query.service.js');
const definitions = JSON.parse(readFileSync(new URL('../packages/server/data/content/building-runtime/buildings.json', import.meta.url), 'utf8'));
const catalog = compileBuildingDefinitions(definitions);
const facilityPrefix = 'spirit_beast:facility:';

test('既有設施人工工作共用採礦及製作生命週期', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../packages/server/dist/tools/spirit-beast-facility-pipeline-smoke.js', import.meta.url))], {
    encoding: 'utf8',
    env: { ...process.env, SERVER_SKIP_LOCAL_ENV_AUTOLOAD: '1' },
    timeout: 30_000, // 純記憶體回歸最長等待三十秒，避免阻塞發布驗證。
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

function fixture() {
  const templates = new MapTemplateRepository();
  templates.registerRuntimeMapTemplate({
    id: 'sect_facility_interactions', name: '設施互動驗證', width: 9, height: 9,
    routeDomain: 'system', tiles: Array(9).fill('.........'),
    spawnPoint: { x: 0, y: 0 }, portals: [], npcs: [], monsters: [], safeZones: [],
    landmarks: [], containers: [], auras: [],
  });
  const instance = new MapInstanceRuntime({
    instanceId: 'sect:facility-proof:main', template: templates.getOrThrow('sect_facility_interactions'),
    monsterSpawns: [], kind: 'sect', persistent: true, createdAt: 0,
    displayName: '設施互動驗證', instanceOrigin: 'smoke', defaultEntry: true, canDamageTile: true,
  });
  instance.configureBuildingRuntime(catalog, []);
  const player = { playerId: 'player:facility-proof', attrs: { numericStats: { viewRange: 7 } }, equipment: { slots: [] } };
  const service = new WorldRuntimeContextActionQueryService(
    templates, { getPlayer: () => player }, { buildNpcQuestContextAction: () => null },
  );
  const query = (x = 3, y = 3, canBuild = true) => service.buildContextActions({
    playerId: player.playerId, self: { x, y }, instance: instance.meta,
    localBuildings: instance.collectLocalBuildings(x, y, 7), localPortals: [], localNpcs: [],
  }, {
    getInstanceRuntimeOrThrow: () => instance,
    worldRuntimeSectService: { resolveSectInstancePermission: () => canBuild },
  });
  const place = (defId, x, y, state = 'active') => {
    const buildingId = `building:${defId}:${x}:${y}`;
    assert.equal(instance.placeBuildingInstance({ buildingId, defId, x, y, state, ownerPlayerId: player.playerId }).ok, true);
    return buildingId;
  };
  return { instance, query, place };
}

for (const defId of Object.keys(SPIRIT_BEAST_FACILITIES)) {
  test(`完工 ${defId} 在同格及相鄰格都有獨立操作入口`, () => {
    // Given：使用正式建築定義及實例投影。
    const { instance, query, place } = fixture();
    const id = place(defId, 3, 3);
    assert.ok(instance.collectLocalBuildings(3, 3, 2).some((entry) => entry.id === id));
    // When：同格／斜向相鄰查詢。
    for (const actions of [query(), query(4, 4)]) {
      // Then：只產生一個指向該設施的互動，而非重新施工。
      assert.equal(actions.filter((entry) => entry.id === `${facilityPrefix}${encodeURIComponent(id)}` && entry.type === 'interact').length, 1);
      assert.equal(actions.some((entry) => entry.id === `building:start:${id}`), false);
    }
  });
}

test('玄鐵礦場旁的靈石礦場與靈田不會互相遮蔽入口', () => {
  const { query, place } = fixture();
  const ids = [place('sect_iron_mine', 3, 3), place('sect_spirit_stone_mine', 2, 3), place('sect_spirit_field', 3, 2)];
  const actions = query();
  assert.deepEqual(actions.filter((entry) => entry.id.startsWith(facilityPrefix)).map((entry) => entry.id).sort(),
    ids.map((id) => `${facilityPrefix}${encodeURIComponent(id)}`).sort());
});

test('相鄰兩座未完工設施保留投影及施工入口，不開放生產', () => {
  const { instance, query, place } = fixture();
  const ids = [place('spirit_incubator_metal', 2, 3, 'building'), place('spirit_incubator_wood', 3, 2, 'building')];
  const actions = query();
  for (const id of ids) {
    assert.ok(instance.collectLocalBuildings(3, 3, 2).find((entry) => entry.id === id)?.remainingTicks > 0);
    assert.equal(actions.filter((entry) => entry.id === `building:start:${id}`).length, 1);
  }
  assert.equal(actions.some((entry) => entry.id.startsWith(facilityPrefix)), false);
});

test('遠處設施不提供近身操作，無施工權限者不提供施工入口', () => {
  const { query, place } = fixture();
  place('sect_iron_mine', 6, 6);
  place('spirit_incubator_metal', 2, 3, 'building');
  const actions = query(3, 3, false);
  assert.equal(actions.some((entry) => entry.id.startsWith(facilityPrefix) || entry.id.startsWith('building:start:')), false);
});
