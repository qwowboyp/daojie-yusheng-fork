/**
 * 本文件属于世界运行时查询层，负责把权威状态整理为只读视图。
 *
 * 维护时应避免查询路径产生副作用，并控制返回字段，防止高频同步带出完整大对象。
 */
import { Injectable } from '@nestjs/common';
import { RETURN_TO_SPAWN_ACTION_ID, RETURN_TO_SPAWN_COOLDOWN_TICKS, formatDisplayInteger, resolvePlayerFacingContentName } from '@mud/shared';
import { MapTemplateRepository } from '../../map/map-template.repository';
import { PlayerRuntimeService } from '../../player/player-runtime.service';
import { resolveCompiledBuildingDefinition } from '../../building/building-definition-resolution.helpers';
import { WorldRuntimeNpcQuestInteractionQueryService } from './world-runtime-npc-quest-interaction-query.service';
import * as world_runtime_normalization_helpers_1 from '../world-runtime.normalization.helpers';
import * as world_runtime_path_planning_helpers_1 from '../world-runtime.path-planning.helpers';

const {
    compareStableStrings,
} = world_runtime_normalization_helpers_1;

const {
    chebyshevDistance,
} = world_runtime_path_planning_helpers_1;

const STATIC_TOGGLE_CONTEXT_ACTIONS = [{
        id: 'toggle:auto_battle',
        name: '自動戰鬥',
        type: 'toggle',
        desc: '自動追擊附近妖獸並釋放技能，可隨時切換開關。',
    }, {
        id: 'toggle:auto_retaliate',
        name: '自動反擊',
        type: 'toggle',
        desc: '控制被攻擊時是否自動開戰。',
    }, {
        id: 'toggle:auto_battle_stationary',
        name: '原地戰鬥',
        type: 'toggle',
        desc: '控制自動戰鬥時是否原地輸出，還是按射程追擊目標。',
    }, {
        id: 'toggle:allow_aoe_player_hit',
        name: '全體攻擊',
        type: 'toggle',
        desc: '控制群體攻擊是否會誤傷其他玩家。',
    }, {
        id: 'toggle:auto_idle_cultivation',
        name: '閒置自動修煉',
        type: 'toggle',
        desc: '控制角色閒置一段時間後是否自動開始修煉。',
    }, {
        id: 'cultivation:toggle',
        name: '當前修煉',
        type: 'toggle',
        desc: '切換角色修煉狀態；沒有主修時只推進境界修為。',
    }, {
        id: 'toggle:auto_switch_cultivation',
        name: '修滿自動切換',
        type: 'toggle',
        desc: '控制主修功法圓滿後是否自動切到下一門未圓滿功法。',
    }, {
        id: 'sense_qi:toggle',
        name: '感氣視角',
        type: 'toggle',
        desc: '切換感氣視角，觀察地塊靈氣層次與變化。',
    }];
const WANG_QI_COMPASS_ITEM_ID = 'equip.copper_luopan';
const SECT_TEMPLATE_PREFIX = 'sect_domain:';

function resolveStableSectTemplateId(templateId) {
    if (typeof templateId !== 'string' || !templateId.trim().startsWith(SECT_TEMPLATE_PREFIX)) {
        return null;
    }
    const normalized = templateId.trim();
    const body = normalized.slice(SECT_TEMPLATE_PREFIX.length);
    const boundsMatch = /:x-?\d+_-?\d+:y-?\d+_-?\d+$/.exec(body);
    if (boundsMatch) {
        return `${SECT_TEMPLATE_PREFIX}${body.slice(0, boundsMatch.index)}`;
    }
    const radiusMatch = /:r\d+$/.exec(body);
    if (radiusMatch) {
        return `${SECT_TEMPLATE_PREFIX}${body.slice(0, radiusMatch.index)}`;
    }
    return normalized;
}

/** 世界运行时上下文动作查询服务：承接 contextActions 的只读组装。 */
@Injectable()
export class WorldRuntimeContextActionQueryService {
/**
 * templateRepository：template仓储引用。
 */

    templateRepository;
    /**
 * playerRuntimeService：玩家运行态服务引用。
 */

    playerRuntimeService;
    /**
 * worldRuntimeNpcQuestInteractionQueryService：世界运行态NPC任务InteractionQuery服务引用。
 */

    worldRuntimeNpcQuestInteractionQueryService;
    /**
 * 构造器：初始化 当前 实例并建立基础状态。
 * @param templateRepository 参数说明。
 * @param playerRuntimeService 参数说明。
 * @param worldRuntimeNpcQuestInteractionQueryService 参数说明。
 * @returns 无返回值，完成实例初始化。
 */

    constructor(
        templateRepository: MapTemplateRepository,
        playerRuntimeService: PlayerRuntimeService,
        worldRuntimeNpcQuestInteractionQueryService: WorldRuntimeNpcQuestInteractionQueryService,
    ) {
        this.templateRepository = templateRepository;
        this.playerRuntimeService = playerRuntimeService;
        this.worldRuntimeNpcQuestInteractionQueryService = worldRuntimeNpcQuestInteractionQueryService;
    }
    /**
 * buildContextActions：构建并返回目标对象。
 * @param view 参数说明。
 * @returns 无返回值，直接更新上下文Action相关状态。
 */

    buildContextActions(view, deps = null) {
  // 关键分支按状态与边界条件处理，非法路径会被提前拦截。

        const actions = [];
        const player = this.playerRuntimeService.getPlayer(view.playerId);
        const currentTick = typeof deps?.resolveCurrentTickForPlayerId === 'function'
            ? deps.resolveCurrentTickForPlayerId(view.playerId)
            : (Number.isFinite(Number(view?.tick))
                ? Math.max(0, Math.trunc(Number(view.tick)))
                : 0);
        const isTimeChamberInstance = typeof deps?.timeChamberRuntimeService?.isTimeChamberInstance === 'function'
            && deps.timeChamberRuntimeService.isTimeChamberInstance(view?.instance?.instanceId);
        if (!isTimeChamberInstance) {
            actions.push({
                id: 'battle:force_attack',
                name: '強制攻擊',
                type: 'battle',
                desc: '無視自動索敵限制，直接鎖定你選中的目標發起攻擊。',
                cooldownLeft: 0,
                range: Math.max(1, Math.round(player?.attrs.numericStats.viewRange ?? 1)),
                requiresTarget: true,
                targetMode: 'any',
            });
        }
        if (isTimeChamberInstance) {
            actions.push({
                id: 'time_chamber:leave',
                name: '離開密室',
                type: 'travel',
                desc: '返回密室入口所在的外部地圖。',
                cooldownLeft: 0,
            });
        }
        const respawnTargetMapId = typeof player?.respawnTemplateId === 'string' && player.respawnTemplateId.trim()
            ? player.respawnTemplateId.trim()
            : (typeof deps?.resolveDefaultRespawnMapId === 'function' ? deps.resolveDefaultRespawnMapId() : 'yunlai_town');
        let respawnTargetName = '預設復活點';
        if (respawnTargetMapId && this.templateRepository.has(respawnTargetMapId)) {
            respawnTargetName = resolvePlayerFacingContentName(
                respawnTargetMapId,
                '預設復活點',
                this.templateRepository.getOrThrow(respawnTargetMapId).name,
            );
        } else {
            const stableSectTemplateId = resolveStableSectTemplateId(respawnTargetMapId);
            if (stableSectTemplateId && this.templateRepository.has(stableSectTemplateId)) {
                respawnTargetName = this.templateRepository.getOrThrow(stableSectTemplateId).name || '所屬宗門';
            } else if (stableSectTemplateId) {
                respawnTargetName = '所屬宗門';
            }
        }
        const returnReadyTick = normalizeReturnToSpawnReadyTick(player, currentTick);
        const returnCooldownLeft = Math.max(0, returnReadyTick - currentTick);
        actions.push({
            id: RETURN_TO_SPAWN_ACTION_ID,
            name: '遁返',
            type: 'travel',
            desc: `催動歸引靈符，遁返回 ${respawnTargetName}，之後需調息 ${RETURN_TO_SPAWN_COOLDOWN_TICKS} 息。`,
            cooldownLeft: returnCooldownLeft,
        });
        for (const action of STATIC_TOGGLE_CONTEXT_ACTIONS) {
            actions.push({
                id: action.id,
                name: action.name,
                type: action.type,
                desc: action.desc,
                cooldownLeft: 0,
            });
        }
        if (hasEquippedItem(player, WANG_QI_COMPASS_ITEM_ID)) {
            actions.push({
                id: 'wang_qi:toggle',
                name: '望氣',
                type: 'interact',
                desc: '借銅羅盤觀察房間風水，低於平衡偏紅，高於平衡偏綠。',
                cooldownLeft: 0,
            });
        }
        const localFormations = typeof deps?.worldRuntimeFormationService?.listOwnedFormationsAt === 'function'
            ? deps.worldRuntimeFormationService.listOwnedFormationsAt(view.instance.instanceId, view.playerId, view.self.x, view.self.y)
            : [];
        for (const formation of localFormations) {
            const remainingQi = Math.max(0, Math.floor(Number(formation.remainingQiBudget ?? formation.remainingAuraBudget) || 0));
            const remainingStones = Math.max(0, Math.floor(Number(formation.remainingSpiritStoneBudget) || 0));
            const radius = Math.max(1, Math.trunc(Number(formation.radius) || 1));
            const refillStones = Math.max(0, Math.trunc(Number(formation.refillSpiritStoneCount) || 0));
            const refillQi = Math.max(0, Math.trunc(Number(formation.refillQiCost) || 0));
            const qiLabel = formatDisplayInteger(remainingQi);
            actions.push({
                id: `formation:toggle:${formation.id}`,
                name: formation.active ? `關閉：${formation.name}` : `開啟：${formation.name}`,
                type: 'interact',
                desc: `陣眼靈力 ${qiLabel}，靈石 ${formatDisplayInteger(remainingStones)}，半徑 ${formatDisplayInteger(radius)}。`,
                cooldownLeft: 0,
            });
            actions.push({
                id: `formation:refill:${formation.id}`,
                name: `資源補給：${formation.name}`,
                type: 'interact',
                desc: `一次性消耗 ${formatDisplayInteger(refillStones)} 靈石和 ${formatDisplayInteger(refillQi)} 靈力，補給當前陣法資源池。`,
                cooldownLeft: 0,
            });
            const maintaining = player.formationJob
                && Number(player.formationJob.remainingTicks) > 0
                && player.formationJob.formationInstanceId === formation.id;
            actions.push({
                id: maintaining ? `formation:cancel_maintain:${formation.id}` : `formation:maintain:${formation.id}`,
                name: maintaining ? `停止補充：${formation.name}` : `補充靈力：${formation.name}`,
                type: 'interact',
                desc: maintaining
                    ? `停止持續向陣法注入自身靈力。當前陣眼靈力 ${qiLabel}。`
                    : `持續向陣法注入自身靈力，每息獲得陣法技藝經驗。當前陣眼靈力 ${qiLabel}。`,
                cooldownLeft: 0,
            });
        }
        const localBuildings = Array.isArray(view?.localBuildings) ? view.localBuildings : [];
        if (typeof deps?.getInstanceRuntimeOrThrow === 'function') {
            for (const entry of localBuildings) {
                if (chebyshevDistance(view.self.x, view.self.y, entry.x, entry.y) > 1) {
                    continue;
                }
                const sourceInstanceId = typeof entry?.instanceId === 'string' && entry.instanceId.trim()
                    ? entry.instanceId.trim()
                    : view.instance.instanceId;
                const instance = deps.getInstanceRuntimeOrThrow(sourceInstanceId);
                const building = instance?.buildingById?.get?.(entry.id);
                if (!building || building.state !== 'building') {
                    if (building?.defId === 'scripture_platform' && building?.state === 'active') {
                        actions.push(...buildScripturePlatformActions(player, building));
                    }
                    if (isTreasureVaultBuilding(instance, building)) {
                        const buildingName = typeof entry?.name === 'string' && entry.name.trim()
                            ? entry.name.trim()
                            : '寶庫';
                        const encodedBuildingId = encodeURIComponent(building.id);
                        actions.push({
                            id: `treasure_vault:open:${encodedBuildingId}`,
                            name: `打開：${buildingName}`,
                            type: 'interact',
                            desc: '查看附近寶庫，並按建立者設定的權限存取物品。',
                            cooldownLeft: 0,
                        });
                        if (typeof building.ownerPlayerId === 'string' && building.ownerPlayerId.trim() === view.playerId) {
                            actions.push({
                                id: `treasure_vault:permissions:${encodedBuildingId}`,
                                name: `設置權限：${buildingName}`,
                                type: 'interact',
                                desc: '建造者可分別設置寶庫查看與存入、取出的使用權限。',
                                cooldownLeft: 0,
                            });
                        }
                    }
                    if (isTimeChamberBuilding(instance, building)) {
                        const summary = typeof deps?.timeChamberRuntimeService?.getInteractionSummary === 'function'
                            ? deps.timeChamberRuntimeService.getInteractionSummary(instance.meta.instanceId, building.id)
                            : null;
                        const buildingName = typeof summary?.displayName === 'string' && summary.displayName.trim()
                            ? summary.displayName.trim()
                            : typeof entry?.name === 'string' && entry.name.trim()
                                ? entry.name.trim()
                                : '密室';
                        const configuredSpeed = Math.max(1, Math.trunc(Number(summary?.configuredSpeed) || 1));
                        const effectiveSpeed = Math.max(1, Math.trunc(Number(summary?.effectiveSpeed) || 1));
                        const occupancy = Math.max(0, Math.trunc(Number(summary?.occupancy) || 0));
                        const capacity = Math.max(1, Math.trunc(Number(summary?.capacity) || 1));
                        const statusText = `時間流速 ${configuredSpeed} 倍（當前 ${effectiveSpeed} 倍） · 當前人數 ${occupancy}/${capacity}`;
                        const encodedBuildingId = encodeURIComponent(building.id);
                        actions.push({
                            id: `time_chamber:usage:${encodedBuildingId}`,
                            name: `開啟：${buildingName}`,
                            type: 'interact',
                            desc: statusText,
                            cooldownLeft: 0,
                        });
                        if (typeof building.ownerPlayerId === 'string' && building.ownerPlayerId.trim() === view.playerId) {
                            actions.push({
                                id: `time_chamber:management:${encodedBuildingId}`,
                                name: `管理：${buildingName}`,
                                type: 'interact',
                                desc: statusText,
                                cooldownLeft: 0,
                            });
                        }
                    }
                    if (building?.defId === 'technique_refining_table' && building?.state === 'active') {
                        const buildingName = typeof entry?.name === 'string' && entry.name.trim()
                            ? entry.name.trim()
                            : '煉法臺';
                        const encodedBuildingId = encodeURIComponent(building.id);
                        actions.push({
                            id: 'technique_refining:open',
                            name: `煉法：${buildingName}`,
                            type: 'interact',
                            desc: '打開煉法臺，選擇背包內功法書分解為功法殘頁，或抄錄指定層數的功法書。',
                            cooldownLeft: 0,
                        });
                    }
                    if (building?.defId === 'technique_unification_platform' && building?.state === 'active') {
                        const buildingName = typeof entry?.name === 'string' && entry.name.trim()
                            ? entry.name.trim()
                            : '統法臺';
                        const encodedBuildingId = encodeURIComponent(building.id);
                        actions.push({
                            id: `technique_unification:open:${encodedBuildingId}`,
                            name: `參閱法脈：${buildingName}`,
                            type: 'interact',
                            desc: '登臺查閱所承法脈；獲準修訂者可將同階圓滿的自創內功續錄入卷。',
                            cooldownLeft: 0,
                        });
                    }
                    continue;
                }
                const remainingTicks = Math.max(1, Math.trunc(Number(entry?.remainingTicks ?? building.buildRemainingTicks ?? building.buildStrength ?? 1)));
                const buildingName = resolvePlayerFacingContentName(building.defId, '未知建築', entry?.name);
                const sectBuildPermission = typeof deps?.worldRuntimeSectService?.resolveSectInstancePermission === 'function'
                    ? deps.worldRuntimeSectService.resolveSectInstancePermission(
                        view.playerId,
                        instance.meta.instanceId,
                        'building_create',
                    )
                    : null;
                if (sectBuildPermission === false) {
                    continue;
                }
                actions.push({
                    id: `building:start:${building.id}`,
                    name: `開始建造：${buildingName}（餘 ${remainingTicks} 息）`,
                    type: 'interact',
                    desc: `靠近半成品後持續施工，剩餘 ${remainingTicks} 息。`,
                    cooldownLeft: 0,
                });
            }
        }
        if (typeof deps?.worldRuntimeSectService?.buildSectCoreActions === 'function') {
            actions.push(...deps.worldRuntimeSectService.buildSectCoreActions(view, deps));
        }
        if (typeof deps?.worldRuntimeSectService?.buildSectEntranceActions === 'function') {
            actions.push(...deps.worldRuntimeSectService.buildSectEntranceActions(view, deps));
        }
        if (typeof deps?.worldRuntimeTongtianTowerService?.buildContextActions === 'function') {
            actions.push(...deps.worldRuntimeTongtianTowerService.buildContextActions(view, deps));
        }
        for (const portal of view.localPortals) {
            if (portal.trigger !== 'manual'
                || chebyshevDistance(view.self.x, view.self.y, portal.x, portal.y) > 1) {
                continue;
            }
            const targetName = this.templateRepository.has(portal.targetMapId)
                ? this.templateRepository.getOrThrow(portal.targetMapId).name
                : portal.targetMapId;
            actions.push({
                id: 'portal:travel',
                name: `傳送至：${targetName}`,
                type: 'travel',
                desc: `踏入對應界門，前往 ${targetName}。`,
                cooldownLeft: 0,
            });
            if (!actions.some((entry) => entry.id === 'world:migrate')) {
                actions.push({
                    id: 'world:migrate',
                    name: '世界遷移',
                    type: 'interact',
                    desc: '切換當前地圖的虛境/現世，並同步更新後續跨圖的預設分線。',
                    cooldownLeft: 0,
                });
            }
        }
        for (const npc of view.localNpcs) {
            if (chebyshevDistance(view.self.x, view.self.y, npc.x, npc.y) <= 1) {
                actions.push({
                    id: `npc:${npc.npcId}`,
                    name: `交談：${npc.name}`,
                    type: 'interact',
                    desc: npc.dialogue?.trim() ? npc.dialogue.trim() : `與 ${npc.name} 交談。`,
                    cooldownLeft: 0,
                });
            }
            const npcQuestAction = this.worldRuntimeNpcQuestInteractionQueryService.buildNpcQuestContextAction(view, npc);
            if (npcQuestAction) {
                actions.push(npcQuestAction);
            }
            if (!npc.hasShop || chebyshevDistance(view.self.x, view.self.y, npc.x, npc.y) > 1) {
                continue;
            }
            actions.push({
                id: `npc_shop:${npc.npcId}`,
                name: `商店：${npc.name}`,
                type: 'interact',
                desc: `查看 ${npc.name} 當前出售的貨物。`,
                cooldownLeft: 0,
            });
        }
        if (player?.realm?.breakthroughReady) {
            const preview = player.realm.breakthrough;
            actions.push({
                id: 'realm:breakthrough',
                name: `突破至 ${preview?.targetDisplayName ?? '下一境界'}`,
                type: 'breakthrough',
                desc: preview?.blockedReason ?? `當前境界已圓滿，點擊查看 ${preview?.targetDisplayName ?? '下一境界'} 的突破要求。`,
                cooldownLeft: 0,
            });
        }
        appendEquippedContextActions(actions, player);
        actions.sort((left, right) => compareStableStrings(left.id, right.id));
        return actions;
    }
};

function buildScripturePlatformActions(player, building) {
    if (!player) {
        return [];
    }
    const existingTechniqueId = normalizeText(building.scriptureTechniqueId);
    if (existingTechniqueId && Number(building.scriptureRecordedAtTick) > 0) {
        return [{
            id: `scripture:contemplate:${encodeURIComponent(building.id)}`,
            name: '參悟',
            type: 'interact',
            desc: `參悟藏經臺內的${normalizeText(building.scriptureTechniqueName) || '功法'}。`,
            scriptureTechniqueId: existingTechniqueId,
            scriptureTechniqueName: resolvePlayerFacingContentName(existingTechniqueId, '未知功法', building.scriptureTechniqueName),
            scriptureTechniqueRealmLv: Math.max(1, Math.trunc(Number(building.scriptureRealmLv) || 1)),
            scriptureTechniqueGrade: normalizeText(building.scriptureGrade) || undefined,
            scriptureTechniqueCategory: normalizeText(building.scriptureCategory) || undefined,
            cooldownLeft: 0,
        }];
    }
    return [{
        id: `scripture:record:${encodeURIComponent(building.id)}`,
        name: Number(building.scriptureProgress) > 0 ? '繼續錄入' : '錄入',
        type: 'interact',
        desc: '打開藏經臺錄入界面，選擇自身已經練滿的自創功法寫入藏經臺。',
        cooldownLeft: 0,
    }];
}

function normalizeText(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function isTreasureVaultBuilding(instance, building) {
    if (!building || building.state !== 'active') {
        return false;
    }
    const compiled = resolveCompiledBuildingDefinition(instance?.buildingCatalog, building);
    return building.defId === 'treasure_vault'
        || compiled?.id === 'treasure_vault'
        || Math.max(0, Math.trunc(Number(compiled?.treasureVaultCapacity) || 0)) > 0;
}

function isTimeChamberBuilding(instance, building) {
    if (!building || building.state !== 'active') {
        return false;
    }
    const compiled = resolveCompiledBuildingDefinition(instance?.buildingCatalog, building);
    return building.defId === 'time_chamber'
        || compiled?.id === 'time_chamber'
        || compiled?.timeChamberEnabled === true;
}

function appendEquippedContextActions(actions, player) {
    const seen = new Set(actions.map((entry) => entry.id));
    for (const slot of player?.equipment?.slots ?? []) {
        for (const action of slot?.item?.contextActions ?? []) {
            if (!action?.id || seen.has(action.id)) {
                continue;
            }
            actions.push({ ...action, cooldownLeft: Math.max(0, Math.trunc(Number(action.cooldownLeft) || 0)) });
            seen.add(action.id);
        }
    }
}

function hasEquippedItem(player, itemId) {
    return (player?.equipment?.slots ?? []).some((entry) => entry?.item?.itemId === itemId);
}

function normalizeReturnToSpawnReadyTick(player, currentTick) {
    const cooldowns = player?.combat?.cooldownReadyTickBySkillId;
    if (!cooldowns) {
        return 0;
    }
    const actionId = RETURN_TO_SPAWN_ACTION_ID;
    const readyTick = Math.max(0, Math.trunc(Number(cooldowns[actionId] ?? 0)));
    if (readyTick <= 0) {
        return 0;
    }
    const normalizedCurrentTick = Math.max(0, Math.trunc(Number(currentTick) || 0));
    const remainingTicks = readyTick - normalizedCurrentTick;
    if (normalizedCurrentTick <= 0) {
        // 查询路径可能没有地图 tick，只收敛显示值，不清运行时真源。
        return readyTick > RETURN_TO_SPAWN_COOLDOWN_TICKS
            ? RETURN_TO_SPAWN_COOLDOWN_TICKS
            : readyTick;
    }
    if (remainingTicks <= 0 || remainingTicks > RETURN_TO_SPAWN_COOLDOWN_TICKS) {
        delete cooldowns[actionId];
        return 0;
    }
    return readyTick;
}
