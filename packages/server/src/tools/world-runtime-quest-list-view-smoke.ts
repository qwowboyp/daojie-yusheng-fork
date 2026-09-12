// @ts-nocheck

const assert = require("node:assert/strict");

const { MapTemplateRepository } = require("../runtime/map/map-template.repository");
const { WorldRuntimeService } = require("../runtime/world/world-runtime.service");
const { WorldRuntimeQuestQueryService } = require("../runtime/world/query/world-runtime-quest-query.service");
/**
 * createQuestQueryService：构建并返回目标对象。
 * @param log 参数说明。
 * @param quests 参数说明。
 * @returns 无返回值，直接更新任务Query服务相关状态。
 */


function createQuestQueryService(log, quests) {
    return new WorldRuntimeQuestQueryService({    
    /**
 * getItemName：读取道具名称。
 * @param itemId 道具 ID。
 * @returns 无返回值，完成道具名称的读取/组装。
 */

        getItemName(itemId) {
            return itemId;
        },        
        /**
 * getTechniqueName：读取功法名称。
 * @param techniqueId technique ID。
 * @returns 无返回值，完成功法名称的读取/组装。
 */

        getTechniqueName(techniqueId) {
            return techniqueId;
        },        
        /**
 * createItem：构建并返回目标对象。
 * @param itemId 道具 ID。
 * @param count 数量。
 * @returns 无返回值，直接更新道具相关状态。
 */

        createItem(itemId, count) {
            return { itemId, count };
        },
    }, {    
    /**
 * getQuestSource：读取任务来源。
 * @returns 无返回值，完成任务来源的读取/组装。
 */

        getQuestSource() {
            return null;
        },        
        /**
 * getNpcLocation：读取NPC位置。
 * @returns 无返回值，完成NPC位置的读取/组装。
 */

        getNpcLocation() {
            return null;
        },        
        /**
 * has：判断ha是否满足条件。
 * @returns 无返回值，完成结果的条件判断。
 */

        has() {
            return false;
        },        
        /**
 * getOrThrow：读取OrThrow。
 * @returns 无返回值，完成OrThrow的读取/组装。
 */

        getOrThrow() {
            return { name: 'ignored' };
        },
    }, {    
    /**
 * listQuests：读取任务并返回结果。
 * @param playerId 玩家 ID。
 * @returns 无返回值，完成任务的读取/组装。
 */

        listQuests(playerId) {
            log.push(['listQuests', playerId]);
            return quests.map((quest) => ({
                ...quest,
                rewards: Array.isArray(quest.rewards) ? quest.rewards.map((reward) => ({ ...reward })) : [],
            }));
        },        
        getPlayer(playerId) {
            log.push(['getPlayer', playerId]);
            return {
                quests: {
                    revision: 1,
                },
            };
        },
        /**
 * getPlayerOrThrow：读取玩家OrThrow。
 * @param playerId 玩家 ID。
 * @returns 无返回值，完成玩家OrThrow的读取/组装。
 */

        getPlayerOrThrow(playerId) {
            log.push(['getPlayerOrThrow', playerId]);
            return {
                quests: {
                    quests: [],
                },
            };
        },
    });
}
/**
 * testQuestQueryServiceBuildQuestListView：读取test任务Query服务Build任务列表视图并返回结果。
 * @returns 无返回值，直接更新test任务Query服务Build任务列表视图相关状态。
 */


function testQuestQueryServiceBuildQuestListView() {
    const log = [];
    const quests = [{ id: 'quest:1', title: '云游初试', rewards: [{ itemId: 'stone', count: 1 }] }];
    const service = createQuestQueryService(log, quests);
    const view = service.buildQuestListView('player:1');
    assert.deepEqual(view, {
        r: 1,
        full: 1,
        quests: [{
            id: 'quest:1',
            title: '云游初试',
            desc: '',
            targetName: '未知目標',
            rewardText: '',
            rewardItemId: '',
            rewardItemIds: [],
            rewards: [{ itemId: 'stone', count: 1, name: '未知物品' }],
        }],
    });
    assert.notEqual(view.quests, quests);
    assert.notEqual(view.quests[0], quests[0]);
    assert.notEqual(view.quests[0].rewards, quests[0].rewards);
    assert.notEqual(view.quests[0].rewards[0], quests[0].rewards[0]);
    assert.deepEqual(log, [['getPlayer', 'player:1'], ['listQuests', 'player:1']]);
}
/**
 * testWorldRuntimeFacadeBuildQuestListView：读取test世界运行态FacadeBuild任务列表视图并返回结果。
 * @returns 无返回值，直接更新test世界运行态FacadeBuild任务列表视图相关状态。
 */


function testWorldRuntimeFacadeBuildQuestListView() {
    const log = [];
    const runtime = {    
    /**
 * getPlayerLocationOrThrow：读取玩家位置OrThrow。
 * @param playerId 玩家 ID。
 * @returns 无返回值，完成玩家位置OrThrow的读取/组装。
 */

        getPlayerLocationOrThrow(playerId) {
            log.push(['getPlayerLocationOrThrow', playerId]);
            return { instanceId: 'instance:1' };
        },        
        /**
 * refreshQuestStates：执行refresh任务状态相关逻辑。
 * @param playerId 玩家 ID。
 * @returns 无返回值，直接更新refresh任务状态相关状态。
 */

        refreshQuestStates(playerId) {
            log.push(['refreshQuestStates', playerId]);
        },
        worldRuntimeReadFacadeService: {        
        /**
 * buildQuestListView：构建并返回目标对象。
 * @param playerId 玩家 ID。
 * @param _input 参数说明。
 * @param deps 运行时依赖。
 * @returns 无返回值，直接更新任务列表视图相关状态。
 */

            buildQuestListView(playerId, _input, deps) {
                log.push(['buildQuestListView', playerId, deps === runtime]);
                return { quests: [{ id: 'quest:2', title: '归宗试炼', rewards: [] }] };
            },
        },
    };
    const view = WorldRuntimeService.prototype.buildQuestListView.call(runtime, 'player:2', {});
    assert.deepEqual(view, {
        quests: [{ id: 'quest:2', title: '归宗试炼', rewards: [] }],
    });
    assert.deepEqual(log, [
        ['buildQuestListView', 'player:2', true],
    ]);
}
/**
 * testQuestQueryServiceBuildNpcQuestsView：读取test任务Query服务BuildNPC任务视图并返回结果。
 * @returns 无返回值，直接更新test任务Query服务BuildNPC任务视图相关状态。
 */


function testQuestQueryServiceBuildNpcQuestsView() {
    const log = [];
    const service = createQuestQueryService(log, []);
    const view = service.buildNpcQuestsView('player:3', 'npc_a', {    
    /**
 * resolveAdjacentNpc：规范化或转换AdjacentNPC。
 * @param playerId 玩家 ID。
 * @param npcId npc ID。
 * @returns 无返回值，直接更新AdjacentNPC相关状态。
 */

        resolveAdjacentNpc(playerId, npcId) {
            log.push(['resolveAdjacentNpc', playerId, npcId]);
            return {
                npcId,
                name: '阿青',
                quests: [],
            };
        },
    });
    assert.deepEqual(view, {
        npcId: 'npc_a',
        npcName: '阿青',
        quests: [],
    });
    assert.deepEqual(log, [
        ['resolveAdjacentNpc', 'player:3', 'npc_a'],
        ['getPlayerOrThrow', 'player:3'],
    ]);
}
/**
 * testWorldRuntimeFacadeBuildNpcQuestsView：构建test世界运行态FacadeBuildNPC任务视图。
 * @returns 无返回值，直接更新test世界运行态FacadeBuildNPC任务视图相关状态。
 */


function testWorldRuntimeFacadeBuildNpcQuestsView() {
    const log = [];
    const runtime = {    
    /**
 * getPlayerLocationOrThrow：读取玩家位置OrThrow。
 * @param playerId 玩家 ID。
 * @returns 无返回值，完成玩家位置OrThrow的读取/组装。
 */

        getPlayerLocationOrThrow(playerId) {
            log.push(['getPlayerLocationOrThrow', playerId]);
            return { instanceId: 'instance:2' };
        },        
        /**
 * refreshQuestStates：执行refresh任务状态相关逻辑。
 * @param playerId 玩家 ID。
 * @returns 无返回值，直接更新refresh任务状态相关状态。
 */

        refreshQuestStates(playerId) {
            log.push(['refreshQuestStates', playerId]);
        },
        worldRuntimeReadFacadeService: {        
        /**
 * buildNpcQuestsView：构建并返回目标对象。
 * @param playerId 玩家 ID。
 * @param npcId npc ID。
 * @param deps 运行时依赖。
 * @returns 无返回值，直接更新NPC任务视图相关状态。
 */

            buildNpcQuestsView(playerId, npcIdInput, deps) {
                const npcId = typeof npcIdInput === 'string' ? npcIdInput.trim() : '';
                if (!npcId) {
                    throw new Error('npcId is required');
                }
                log.push(['buildNpcQuestsView', playerId, npcId, deps === runtime]);
                return { npcId, npcName: '阿青', quests: [] };
            },
        },
    };
    const view = WorldRuntimeService.prototype.buildNpcQuestsView.call(runtime, 'player:4', ' npc_a ');
    assert.deepEqual(view, {
        npcId: 'npc_a',
        npcName: '阿青',
        quests: [],
    });
    assert.deepEqual(log, [
        ['buildNpcQuestsView', 'player:4', 'npc_a', true],
    ]);
    assert.throws(() => WorldRuntimeService.prototype.buildNpcQuestsView.call(runtime, 'player:4', '   '), /npcId is required/);
}

function testContentQuestFilesBindToNpcTemplates() {
    const repository = new MapTemplateRepository();
    repository.loadAll();
    const questSource = repository.getQuestSource('q_intro_south_gate_rollcall');
    assert.ok(questSource, 'content quest should be indexed by quest id');
    assert.equal(questSource.giverNpcId, 'npc_old_gate_guard');
    assert.equal(questSource.giverMapId, 'yunlai_town');
    assert.equal(questSource.quest.title, '初入雲來鎮');
    const totalQuestBindings = repository.list()
        .flatMap((template) => template.npcs)
        .reduce((sum, npc) => sum + npc.quests.length, 0);
    assert.ok(totalQuestBindings > 0, 'content quests should be attached to NPC templates');
}

/**
 * testCollectAvailableQuestsForPlayer：驗證任務分頁「可接任務」的全域收集：
 * 無任務玩家可看到 NPC 鏈上第一個可接任務（帶 giver 導航欄位）；
 * 已有進行中主線任務的玩家會被主線單一遮蔽。
 */
function testCollectAvailableQuestsForPlayer() {
    const questSource = {
        quest: {
            id: 'q_avail_smoke',
            title: '山門試煉',
            desc: '向阿青回報。',
            line: 'main',
            objectiveType: 'talk',
            required: 1,
        },
        giverNpcId: 'npc_a',
        giverNpcName: '阿青',
        giverMapId: 'yunlai_town',
        giverMapName: '雲來鎮',
        giverX: 3,
        giverY: 5,
    };
    const createService = (playerQuests) => new WorldRuntimeQuestQueryService(
        {
            getItemName(itemId) {
                return itemId;
            },
            getTechniqueName(techniqueId) {
                return techniqueId;
            },
            createItem(itemId, count) {
                return { itemId, count };
            },
        },
        {
            questSourceById: new Map([['q_avail_smoke', questSource]]),
            getQuestSource(questId) {
                return questSource.quest.id === questId ? questSource : null;
            },
            getNpcLocation() {
                return null;
            },
            npcRegistry: {
                listIds() {
                    return ['npc_a', 'npc_b'];
                },
                tryGetRef(npcId) {
                    if (npcId === 'npc_a') {
                        // NPC 模板欄位名是 id；quests 是原始任務定義陣列
                        return Object.freeze({ id: 'npc_a', name: '阿青', quests: [{ id: 'q_avail_smoke' }] });
                    }
                    return Object.freeze({ id: 'npc_b', name: '老鐵匠', quests: [] });
                },
            },
        },
        {
            listQuests() {
                return [];
            },
            getPlayer() {
                return null;
            },
            getPlayerOrThrow(playerId) {
                return { quests: { quests: playerQuests }, realm: { realmLv: 1 } };
            },
        },
    );

    const available = createService([]).collectAvailableQuestsForPlayer('player:5');
    assert.equal(available.length, 1, 'fresh player should see one available quest');
    const view = available[0];
    assert.equal(view.id, 'q_avail_smoke');
    assert.equal(view.status, 'available');
    assert.equal(view.giverId, 'npc_a');
    assert.equal(view.giverMapId, 'yunlai_town');
    assert.ok(Number.isInteger(view.giverX) && Number.isInteger(view.giverY), 'available view should carry giver coordinates for navigation');

    const shielded = createService([{ id: 'q_other_main', line: 'main', status: 'active', required: 1, progress: 0 }])
        .collectAvailableQuestsForPlayer('player:6');
    assert.equal(shielded.length, 0, 'player with an in-progress main quest should have main-line availability shielded');
}

testQuestQueryServiceBuildQuestListView();
testWorldRuntimeFacadeBuildQuestListView();
testQuestQueryServiceBuildNpcQuestsView();
testWorldRuntimeFacadeBuildNpcQuestsView();
testContentQuestFilesBindToNpcTemplates();
testCollectAvailableQuestsForPlayer();

console.log(JSON.stringify({ ok: true, case: 'world-runtime-quest-list-view' }, null, 2));
