/**
 * 用途：驗證宗門核心的 runtime portal 能參與跨圖導航，且不會外洩到其他實例。
 */
import assert from 'node:assert/strict';

import { Direction } from '@mud/shared';

import { MapInstanceRuntime } from '../runtime/instance/map-instance.runtime';
import { MapTemplateRepository } from '../runtime/map/map-template.repository';
import { WorldRuntimeNavigationService } from '../runtime/world/world-runtime-navigation.service';
import { WorldRuntimeSectService } from '../runtime/world/world-runtime-sect.service';
import { installSmokeTimeout } from './smoke-timeout';

installSmokeTimeout(__filename);

const PLAYER_ID = 'player:sect-navigation-smoke';
const SECT_ID = 'sect:navigation-smoke';
const SECT_TEMPLATE_ID = `sect_domain:${SECT_ID}`;
const SECT_INSTANCE_ID = `sect:${SECT_ID}:main`;
const COLD_TIDE_MAP_ID = 'cold_tide_marsh';
const COLD_TIDE_INSTANCE_ID = 'real:sect-navigation-cold-tide';
const RELAY_MAP_ID = 'sect_navigation_relay';
const RELAY_INSTANCE_ID = 'real:sect-navigation-relay';
const ABYSS_MAP_ID = 'darksoil_abyss';
const ABYSS_INSTANCE_ID = 'real:sect-navigation-darksoil';
const DESTINATION = { mapId: ABYSS_MAP_ID, x: 47, y: 40 };

function createMapDocument(
  id: string,
  name: string,
  width: number,
  height: number,
  portals: Array<Record<string, unknown>> = [],
): Record<string, unknown> {
  return {
    id,
    name,
    width,
    height,
    routeDomain: 'system',
    tiles: Array.from({ length: height }, () => '.'.repeat(width)),
    spawnPoint: { x: 0, y: 0 },
    portals,
    npcs: [],
    monsters: [],
    safeZones: [],
    landmarks: [],
    containers: [],
    auras: [],
  };
}

function createPortal(x: number, y: number, targetMapId: string, targetX = 0, targetY = 0): Record<string, unknown> {
  return {
    id: `smoke:${x},${y}->${targetMapId}`,
    x,
    y,
    targetMapId,
    targetX,
    targetY,
    direction: 'two_way',
    kind: 'portal',
    trigger: 'manual',
    routeDomain: 'inherit',
    hidden: false,
    allowPlayerOverlap: false,
  };
}

function createInstance(instanceId: string, template: any, kind: 'public' | 'sect'): MapInstanceRuntime {
  return new MapInstanceRuntime({
    instanceId,
    template,
    monsterSpawns: [],
    kind,
    persistent: false,
    createdAt: Date.now(),
    displayName: template.name,
    linePreset: 'peaceful',
    lineIndex: 1,
    instanceOrigin: 'smoke',
    defaultEntry: kind === 'public',
    canDamageTile: false,
    ownerSectId: kind === 'sect' ? SECT_ID : undefined,
  });
}

function createSectDocument(): Record<string, unknown> {
  const now = Date.now();
  return {
    sectId: SECT_ID,
    name: '測試宗門',
    mark: '測',
    founderPlayerId: PLAYER_ID,
    leaderPlayerId: PLAYER_ID,
    status: 'active',
    entranceInstanceId: COLD_TIDE_INSTANCE_ID,
    entranceTemplateId: COLD_TIDE_MAP_ID,
    entranceX: 1,
    entranceY: 1,
    sectInstanceId: SECT_INSTANCE_ID,
    sectTemplateId: SECT_TEMPLATE_ID,
    coreX: 0,
    coreY: 0,
    expansionRadius: 2,
    mapMinX: -2,
    mapMaxX: 2,
    mapMinY: -2,
    mapMaxY: 2,
    members: [{ playerId: PLAYER_ID, name: '測試修士', roleId: 'leader', joinedAt: now }],
    rolePermissions: undefined,
    createdAt: now,
    updatedAt: now,
  };
}

function createNavigationDeps(active: { instance: MapInstanceRuntime }) {
  return {
    getPlayerLocationOrThrow(playerId: string) {
      assert.equal(playerId, PLAYER_ID);
      return { playerId, instanceId: active.instance.meta.instanceId };
    },
    getInstanceRuntimeOrThrow(instanceId: string) {
      assert.equal(instanceId, active.instance.meta.instanceId);
      return active.instance;
    },
    resolveCurrentTickForPlayerId() {
      return 0;
    },
  };
}

function pointIntent() {
  return {
    kind: 'point' as const,
    mapId: DESTINATION.mapId,
    x: DESTINATION.x,
    y: DESTINATION.y,
    allowNearestReachable: false,
    clientPathHint: null,
  };
}

function main(): void {
  const templateRepository = new MapTemplateRepository();
  templateRepository.registerRuntimeMapTemplate(createMapDocument(
    COLD_TIDE_MAP_ID,
    '寒潮澤',
    4,
    3,
    [createPortal(3, 1, RELAY_MAP_ID, 0, 1)],
  ));
  templateRepository.registerRuntimeMapTemplate(createMapDocument(
    RELAY_MAP_ID,
    '中繼地圖',
    4,
    3,
    [createPortal(3, 1, ABYSS_MAP_ID, 0, 1)],
  ));
  templateRepository.registerRuntimeMapTemplate(createMapDocument(
    ABYSS_MAP_ID,
    '玄壤深淵',
    48,
    41,
  ));

  const coldTideInstance = createInstance(COLD_TIDE_INSTANCE_ID, templateRepository.getOrThrow(COLD_TIDE_MAP_ID), 'public');
  const relayInstance = createInstance(RELAY_INSTANCE_ID, templateRepository.getOrThrow(RELAY_MAP_ID), 'public');
  const abyssInstance = createInstance(ABYSS_INSTANCE_ID, templateRepository.getOrThrow(ABYSS_MAP_ID), 'public');
  const sectService = new WorldRuntimeSectService({}, templateRepository, {});
  const sect = createSectDocument();
  const sectInstance = sectService.ensureSectRuntimeInstance(sect, {
    getInstanceRuntime() {
      return null;
    },
    createInstance(request: { instanceId: string; templateId: string; kind: 'sect' }) {
      return createInstance(request.instanceId, templateRepository.getOrThrow(request.templateId), request.kind);
    },
  });
  assert.ok(sectInstance, '宗門執行實例必須建立');
  const sectTemplate = sectInstance.template;
  const otherSectInstance = createInstance('sect:other-instance-with-same-template', sectTemplate, 'sect');

  assert.deepEqual(sectTemplate.portals, [], '宗門模板不能偷放核心出口');
  assert.equal(sectInstance.isInBounds(1, 0), true, '真宗門建立路徑必須初始化核心鄰格');
  assert.equal(sectInstance.isWalkable(1, 0, PLAYER_ID), true, '宗門核心鄰格必須可行走');
  sectService.attachSectPortals(sect, coldTideInstance, sectInstance);
  const corePortal = sectInstance.listAllPortals().find((portal: any) => portal.kind === 'sect_core');
  assert.deepEqual(
    { x: corePortal?.x, y: corePortal?.y, targetMapId: corePortal?.targetMapId, trigger: corePortal?.trigger },
    { x: 0, y: 0, targetMapId: COLD_TIDE_MAP_ID, trigger: 'manual' },
    '宗門核心必須以 runtime portal 指回公開入口',
  );

  sectInstance.connectPlayer({
    playerId: PLAYER_ID,
    sessionId: 'session:sect-navigation-smoke',
    preferredX: 1,
    preferredY: 0,
  });

  const player = { playerId: PLAYER_ID, templateId: sectTemplate.id, x: 1, y: 0, hp: 100 };
  const navigation = new WorldRuntimeNavigationService(templateRepository, {
    getPlayer(playerId: string) {
      assert.equal(playerId, PLAYER_ID);
      return player;
    },
    getPlayerOrThrow(playerId: string) {
      assert.equal(playerId, PLAYER_ID);
      return player;
    },
  });
  const active = { instance: sectInstance };
  const deps = createNavigationDeps(active);
  const intent = pointIntent();
  navigation.navigationIntents.set(PLAYER_ID, intent);

  assert.deepEqual(
    navigation.findMapRoute(sectTemplate.id, ABYSS_MAP_ID, sectInstance.listAllPortals()),
    [sectTemplate.id, COLD_TIDE_MAP_ID, RELAY_MAP_ID, ABYSS_MAP_ID],
    '首段必須使用宗門實例完整 portal，後段沿用靜態路網',
  );
  assert.deepEqual(
    navigation.getLegacyNavigationPath(PLAYER_ID, deps),
    [[0, 0]],
    '預覽必須導向宗門核心 runtime portal',
  );
  assert.deepEqual(
    navigation.resolveNavigationStep(PLAYER_ID, intent, deps),
    { kind: 'move', direction: Direction.West, maxSteps: 1, path: [{ x: 0, y: 0 }] },
    '首步必須實際走向宗門核心',
  );

  player.x = 0;
  player.y = 0;
  assert.deepEqual(
    navigation.resolveNavigationStep(PLAYER_ID, intent, deps),
    { kind: 'portal' },
    '抵達宗門核心後必須觸發 manual portal',
  );
  navigation.handleTransfer({
    playerId: PLAYER_ID,
    sourceMapId: sectTemplate.id,
    fromInstanceId: SECT_INSTANCE_ID,
    targetMapId: COLD_TIDE_MAP_ID,
    targetInstanceId: COLD_TIDE_INSTANCE_ID,
    reason: 'manual_portal',
  }, {
    getInstanceRuntime(instanceId: string) {
      return instanceId === COLD_TIDE_INSTANCE_ID ? coldTideInstance : null;
    },
    queuePlayerNotice() {},
  });
  assert.equal(navigation.navigationIntents.get(PLAYER_ID), intent, '通過宗門核心 portal 後必須保留原跨圖目的');

  active.instance = coldTideInstance;
  player.templateId = COLD_TIDE_MAP_ID;
  player.x = 1;
  player.y = 1;
  assert.deepEqual(
    navigation.findMapRoute(COLD_TIDE_MAP_ID, ABYSS_MAP_ID),
    [COLD_TIDE_MAP_ID, RELAY_MAP_ID, ABYSS_MAP_ID],
    '一般靜態地圖導航維持既有路網',
  );
  assert.deepEqual(
    navigation.resolveNavigationStep(PLAYER_ID, intent, deps),
    { kind: 'move', direction: Direction.East, maxSteps: 2, path: [{ x: 2, y: 1 }, { x: 3, y: 1 }] },
    '跨出宗門後仍須繼續前往下一個靜態 portal',
  );

  active.instance = relayInstance;
  player.templateId = RELAY_MAP_ID;
  player.x = 3;
  player.y = 1;
  assert.deepEqual(
    navigation.resolveNavigationStep(PLAYER_ID, intent, deps),
    { kind: 'portal' },
    '中繼地圖抵達 portal 後必須繼續跨圖',
  );

  active.instance = abyssInstance;
  player.templateId = ABYSS_MAP_ID;
  player.x = DESTINATION.x;
  player.y = DESTINATION.y;
  assert.deepEqual(navigation.resolveNavigationStep(PLAYER_ID, intent, deps), { kind: 'done' }, '五行脈晶目的地必須可完成導航');

  player.templateId = sectTemplate.id;
  player.x = 0;
  player.y = 0;
  active.instance = otherSectInstance;
  assert.equal(otherSectInstance.listAllPortals().length, 0, '另一個同模板實例不得帶入宗門出口');
  assert.equal(navigation.findMapRoute(sectTemplate.id, ABYSS_MAP_ID, otherSectInstance.listAllPortals()), null);
  assert.throws(
    () => navigation.resolveNavigationStep(PLAYER_ID, intent, deps),
    /無法規劃前往 玄壤深淵 的跨圖路線/u,
    '缺少 runtime 出口時不得借用其他實例的宗門路線',
  );

  sect.entranceInstanceId = RELAY_INSTANCE_ID;
  sect.entranceTemplateId = RELAY_MAP_ID;
  sect.entranceX = 0;
  sect.entranceY = 1;
  sectService.attachSectPortals(sect, relayInstance, sectInstance);
  assert.deepEqual(
    navigation.findMapRoute(sectTemplate.id, ABYSS_MAP_ID, sectInstance.listAllPortals()),
    [sectTemplate.id, RELAY_MAP_ID, ABYSS_MAP_ID],
    '遷宗重掛 runtime 出口後，首段路線必須立即更新',
  );

  console.log(JSON.stringify({ ok: true, route: [sectTemplate.id, COLD_TIDE_MAP_ID, RELAY_MAP_ID, ABYSS_MAP_ID], destination: DESTINATION }, null, 2));
}

void Promise.resolve().then(main).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
