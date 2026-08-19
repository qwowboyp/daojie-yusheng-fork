/**
 * 本文件属于世界运行时查询层，负责把权威状态整理为只读视图。
 *
 * 维护时应避免查询路径产生副作用，并控制返回字段，防止高频同步带出完整大对象。
 */
/** 观察构建工具：生成可见度、结论与实体观察详情。 */

import { DEFAULT_PLAYER_REALM_STAGE, ELEMENT_KEY_LABELS, MONSTER_TIER_LABELS, PLAYER_REALM_NUMERIC_TEMPLATES, cloneNumericRatioDivisors, cloneNumericStats, formatDisplayCurrentMax, formatDisplayInteger, resolvePlayerFacingContentName } from '@mud/shared';
import { resolveCombatDamage } from '../../combat/combat-pipeline-compose';
import { REAL_WORLD_MONSTER_KILL_DROP_RATE_KILL_EQUIVALENT_MULTIPLIER } from '../../../constants/gameplay/real-world';
import { isRealPublicWorldInstance } from '../world-runtime.normalization.helpers';

/** 观察失真阈值：低于该比例时使用模糊文案。 */
const OBSERVATION_BLIND_RATIO = 0.2;

/** 观察完整阈值：到达该比例时显示完整信息。 */
const OBSERVATION_FULL_RATIO = 1.2;
/** 生成地块默认战斗属性快照。 */
export function createTileCombatAttributes() {
    return {
        constitution: 0,
        spirit: 0,
        perception: 0,
        talent: 0,
        strength: 0,
        meridians: 0,
    };
}
/** 生成可用于战斗计算的地块数值面板。 */
export function createTileCombatNumericStats(maxHp) {
    return {
        ...cloneNumericStats(PLAYER_REALM_NUMERIC_TEMPLATES[DEFAULT_PLAYER_REALM_STAGE].stats),
        maxHp,
        maxQi: 0,
        physAtk: 0,
        spellAtk: 0,
        physDef: 0,
        spellDef: 0,
        hit: 0,
        dodge: 0,
        crit: 0,
        antiCrit: 0,
        critDamage: 0,
        breakPower: 0,
        resolvePower: 0,
        maxQiOutputPerTick: 0,
        qiRegenRate: 0,
        hpRegenRate: 0,
        cooldownSpeed: 0,
        auraCostReduce: 0,
        auraPowerRate: 0,
        playerExpRate: 0,
        techniqueExpRate: 0,
        realmExpPerTick: 0,
        techniqueExpPerTick: 0,
        lootRate: 0,
        rareLootRate: 0,
        viewRange: 0,
        moveSpeed: 0,
        extraAggroRate: 0,
        elementDamageBonus: {
            metal: 0,
            wood: 0,
            water: 0,
            fire: 0,
            earth: 0,
        },
        elementDamageReduce: {
            metal: 0,
            wood: 0,
            water: 0,
            fire: 0,
            earth: 0,
        },
    };
}
/** 复用境界模板创建地块比率分母系数。 */
export function createTileCombatRatioDivisors() {
    return cloneNumericRatioDivisors(PLAYER_REALM_NUMERIC_TEMPLATES[DEFAULT_PLAYER_REALM_STAGE].ratioDivisors);
}
/** 按命中、闪避、暴击与减伤规则输出真实伤害值。 */
export function computeResolvedDamage(baseDamage, damageKind, attackerStats, attackerRatios, targetStats, targetRatios) {
  // 关键分支按状态与边界条件处理，非法路径会被提前拦截。

    return resolveCombatDamage({
        attackerStats,
        attackerRatios,
        attackerRealmLv: 1,
        attackerCombatExp: 0,
        targetStats,
        targetRatios,
        targetRealmLv: 1,
        targetCombatExp: 0,
        baseDamage,
        damageKind,
    });
}
/** 生成中文的伤害明细字符串。 */
export function formatCombatDamageBreakdown(rawDamage, actualDamage, damageKind, element = undefined) {
    return `原始 ${formatDisplayInteger(Math.max(0, Math.round(rawDamage)))} - 實際 ${formatDisplayInteger(Math.max(0, Math.round(actualDamage)))} - ${formatCombatDamageType(damageKind, element)}`;
}
/** 提取玩家需要直接看见的战斗判定标签。 */
export function getCombatResolutionLabels(resolution) {
    const labels = [];
    if (resolution?.dodged) {
        labels.push('閃避');
    }
    if (resolution?.broken) {
        labels.push('破招');
    }
    if (resolution?.resolved) {
        labels.push('拆招');
    }
    if (resolution?.crit) {
        labels.push('暴擊');
    }
    return labels;
}
/** 生成战斗判定结果文案，避免 0 伤害被误读成没有结算。 */
export function formatCombatResolutionOutcome(resolution, damageKind, element = undefined) {
    const labels = getCombatResolutionLabels(resolution);
    if (resolution?.dodged) {
        return labels.length > 0
            ? `被閃避，未造成傷害（${labels.join('、')}）`
            : '被閃避，未造成傷害';
    }
    const suffix = labels.length > 0 ? `（${labels.join('、')}）` : '';
    return `造成 ${formatCombatDamageBreakdown(resolution?.rawDamage ?? 0, resolution?.damage ?? 0, damageKind, element)} 傷害${suffix}`;
}
/** 地图浮字使用短标签，日志里再展示完整伤害明细。 */
export function formatCombatResolutionFloatText(resolution) {
    const labels = getCombatResolutionLabels(resolution);
    return labels.join(' · ');
}
/** 按最高优先级挑选判定浮字颜色。 */
export function getCombatResolutionFloatColor(resolution, fallbackColor) {
    if (resolution?.dodged) {
        return '#7dd3fc';
    }
    if (resolution?.crit) {
        return '#facc15';
    }
    if (resolution?.broken) {
        return '#fb923c';
    }
    if (resolution?.resolved) {
        return '#67e8f9';
    }
    return fallbackColor;
}
/** 生成带生命值后缀的目标标签，客户端解析 ‹hp/maxHp› 后缀渲染为胶囊内 HP 信息。 */
export function formatTargetLabelWithHp(name: string, hp: number, maxHp: number): string {
    return `${name}‹${Math.max(0, Math.round(hp))}/${Math.max(1, Math.round(maxHp))}›`;
}
/** 构建结构化战斗消息payload。 */
export function buildCombatNoticePayload(opts: {
    caster: string;
    target: string;
    targetHp?: number;
    targetMaxHp?: number;
    skill: string;
    resolution?: { rawDamage?: number; damage?: number; damageKind?: string; element?: string; dodged?: boolean; crit?: boolean; broken?: boolean; resolved?: boolean; heal?: number };
    formationResolution?: { rawDamage: number; damage: number; damageKind?: string; element?: string; auraDamage: number };
    killed?: boolean;
    /** 通用效果列表：支持 heal / buff / debuff 等扩展类型。 */
    effects?: Array<{ type: string; [key: string]: unknown }>;
}): unknown {
    const payload: Record<string, unknown> = {
        caster: opts.caster,
        target: opts.target,
        skill: opts.skill,
    };
    if (opts.targetHp != null) payload.targetHp = Math.max(0, Math.round(opts.targetHp));
    if (opts.targetMaxHp != null) payload.targetMaxHp = Math.max(1, Math.round(opts.targetMaxHp));
    if (opts.killed) payload.killed = true;
    if (opts.resolution) {
        const r = opts.resolution;
        const res: Record<string, unknown> = {
            rawDamage: Math.max(0, Math.round(Number(r.rawDamage) || 0)),
            damage: Math.max(0, Math.round(Number(r.damage) || 0)),
            damageKind: r.damageKind ?? 'spell',
        };
        if (r.element) res.element = r.element;
        if (r.dodged) res.dodged = true;
        if (r.crit) res.crit = true;
        if (r.broken) res.broken = true;
        if (r.resolved) res.resolved = true;
        if (r.heal) res.heal = Math.max(0, Math.round(Number(r.heal) || 0));
        payload.resolution = res;
    }
    if (opts.formationResolution) {
        const f = opts.formationResolution;
        const res: Record<string, unknown> = {
            rawDamage: Math.max(0, Math.round(Number(f.rawDamage) || 0)),
            damage: Math.max(0, Math.round(Number(f.damage) || 0)),
            damageKind: f.damageKind ?? 'spell',
            auraDamage: Math.max(0, Number(f.auraDamage) || 0),
        };
        if (f.element) res.element = f.element;
        payload.formationResolution = res;
    }
    if (Array.isArray(opts.effects) && opts.effects.length > 0) {
        payload.effects = opts.effects;
    }
    return payload;
}
/** 生成“攻击/施展技能”类的动作描述语句。 */
export function formatCombatActionClause(casterLabel, targetLabel, actionLabel) {
    return actionLabel === '攻擊'
        ? `${casterLabel}對${targetLabel}發起攻擊`
        : `${casterLabel}對${targetLabel}施展${actionLabel}`;
}
/** 生成伤害类型文本（物理/法术+元素）。 */
export function formatCombatDamageType(damageKind, element) {

    const elementLabel = element ? `${ELEMENT_KEY_LABELS[element] ?? element}行` : '';
    return damageKind === 'physical' ? `${elementLabel}物理` : `${elementLabel}法術`;
}
/** 浅拷贝只读展示用 Buff，避免运行时引用污染。 */
export function cloneVisibleBuff(source) {
    return {
        buffId: source.buffId,
        name: source.name,
        desc: source.desc,
        shortMark: source.shortMark,
        category: source.category,
        visibility: source.visibility,
        remainingTicks: source.remainingTicks,
        duration: source.duration,
        stacks: source.stacks,
        maxStacks: source.maxStacks,
        sourceSkillId: source.sourceSkillId,
        sourceSkillName: source.sourceSkillName,
        realmLv: source.realmLv,
        color: source.color,
        attrs: source.attrs ? { ...source.attrs } : undefined,
        attrMode: source.attrMode,
        stats: source.stats ? { ...source.stats } : undefined,
        statMode: source.statMode,
        qiProjection: source.qiProjection ? source.qiProjection.map((entry) => ({ ...entry })) : undefined,
        infiniteDuration: source.infiniteDuration,
        presentationScale: source.presentationScale,
    };
}
/** 观察展示数值归一化，缺失或非有限值按 0 展示。 */
function normalizeObservationNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
}
/** 观察清晰度分母归一化，缺失或非有限值按 1 处理，避免 NaN 误判为完整洞察。 */
function normalizeObservationSpirit(value) {
    const numeric = normalizeObservationNumber(value);
    return Math.max(1, Math.round(numeric));
}
/** 输出整数展示文本，保持观察面板与主线口径一致。 */
function formatWholeObservation(value) {
    return formatDisplayInteger(Math.max(0, normalizeObservationNumber(value)));
}
/** 输出百分比展示文本，供速率类属性复用。 */
function formatRateObservation(value) {
    const percent = normalizeObservationNumber(value) / 100;
    return `${percent.toFixed(percent % 1 === 0 ? 0 : percent % 0.1 === 0 ? 1 : 2)}%`;
}
/** 输出暴伤展示文本，沿用主线 200% 基底口径。 */
function formatCritDamageObservation(value) {
    const total = 200 + Math.max(0, normalizeObservationNumber(value)) / 10;
    return `${total.toFixed(total % 1 === 0 ? 0 : total % 0.1 === 0 ? 1 : 2)}%`;
}
/** 构建观察面板属性行，恢复与 main 一致的可见属性集合。 */
function buildObservationLineSpecs(snapshot, includeResources) {
    const lines = [];
    if (includeResources) {
        lines.push(
            { threshold: 0.18, label: '生命', value: formatCurrentMaxObservation(snapshot.hp, snapshot.maxHp) },
            { threshold: 0.24, label: '靈力', value: formatCurrentMaxObservation(snapshot.qi, snapshot.maxQi) },
        );
    }
    lines.push(
        { threshold: 0.32, label: '物理攻擊', value: formatWholeObservation(snapshot.stats.physAtk) },
        { threshold: 0.36, label: '物理防禦', value: formatWholeObservation(snapshot.stats.physDef) },
        { threshold: 0.4, label: '法術攻擊', value: formatWholeObservation(snapshot.stats.spellAtk) },
        { threshold: 0.44, label: '法術防禦', value: formatWholeObservation(snapshot.stats.spellDef) },
        { threshold: 0.52, label: '命中', value: formatWholeObservation(snapshot.stats.hit) },
        { threshold: 0.56, label: '閃避', value: formatWholeObservation(snapshot.stats.dodge) },
        { threshold: 0.62, label: '暴擊', value: formatWholeObservation(snapshot.stats.crit) },
        { threshold: 0.66, label: '免爆', value: formatWholeObservation(snapshot.stats.antiCrit) },
        { threshold: 0.7, label: '暴擊傷害', value: formatCritDamageObservation(snapshot.stats.critDamage) },
        { threshold: 0.76, label: '破招', value: formatWholeObservation(snapshot.stats.breakPower) },
        { threshold: 0.8, label: '化解', value: formatWholeObservation(snapshot.stats.resolvePower) },
        { threshold: 0.84, label: '最大靈力輸出速率', value: `${formatWholeObservation(snapshot.stats.maxQiOutputPerTick)} / 息` },
        { threshold: 0.87, label: '靈力回覆', value: `${formatWholeObservation(snapshot.stats.qiRegenRate)} / 息` },
        { threshold: 0.89, label: '生命回覆', value: `${formatWholeObservation(snapshot.stats.hpRegenRate)} / 息` },
    );
    if (snapshot.realmLabel) {
        lines.push({ threshold: 0.9, label: '境界', value: snapshot.realmLabel });
    }
    if (snapshot.attrs) {
        lines.push(
            { threshold: 0.92, label: '體魄', value: formatWholeObservation(snapshot.attrs.constitution) },
            { threshold: 0.94, label: '神識', value: formatWholeObservation(snapshot.attrs.spirit) },
            { threshold: 0.96, label: '身法', value: formatWholeObservation(snapshot.attrs.perception) },
            { threshold: 0.98, label: '根骨', value: formatWholeObservation(snapshot.attrs.talent) },
            { threshold: 0.99, label: '力道', value: formatWholeObservation(snapshot.attrs.strength) },
            { threshold: 1, label: '經脈', value: formatWholeObservation(snapshot.attrs.meridians) },
        );
    }
    return lines;
}
/** 构建玩家观察面板的属性项与可见度信息。 */
export function buildPlayerObservation(viewerSpirit, target, selfView = false) {
    return buildObservationInsight(viewerSpirit, target.attrs.finalAttrs.spirit, buildObservationLineSpecs({
        hp: target.hp,
        maxHp: target.maxHp,
        qi: target.qi,
        maxQi: target.maxQi,
        stats: target.attrs.numericStats,
        attrs: target.attrs.finalAttrs,
        realmLabel: target.realm?.displayName,
    }, true), selfView);
}
/** 构建妖兽观察面板的属性项与清晰度。 */
export function buildMonsterObservation(viewerSpirit, monster) {
    return buildObservationInsight(viewerSpirit, monster.attrs.spirit, [
        ...buildObservationLineSpecs({
            hp: monster.hp,
            maxHp: monster.maxHp,
            qi: monster.qi,
            maxQi: monster.maxQi ?? monster.numericStats.maxQi,
            stats: monster.numericStats,
            attrs: monster.attrs,
        }, true),
        { threshold: 0.28, label: '血脈層次', value: MONSTER_TIER_LABELS[monster.tier] ?? '凡血' },
        { threshold: 0.9, label: '境界', value: `等級 ${monster.level}` },
    ]);
}
/** 生成妖兽战利品预览列表与命中概率。 */
export function buildMonsterLootPreview(contentTemplateRepository, viewer, monster, instance = null) {

    const dropTable = contentTemplateRepository?.monsterDropsByMonsterId?.get(monster.monsterId) ?? [];

    const lootRate = viewer?.attrs?.numericStats?.lootRate ?? 0;

    const rareLootRate = viewer?.attrs?.numericStats?.rareLootRate ?? 0;

    const killEquivalentMultiplier = isRealPublicWorldInstance(instance)
        ? REAL_WORLD_MONSTER_KILL_DROP_RATE_KILL_EQUIVALENT_MULTIPLIER
        : 1;

    const entries = dropTable
        .map((drop) => ({
        itemId: drop.itemId,
        name: drop.name,
        type: drop.type,
        count: drop.count,
        chance: resolveObservedDropChance(drop.chance, lootRate, rareLootRate, killEquivalentMultiplier),
    }))
        .sort((left, right) => right.chance - left.chance || compareStableText(left.itemId, right.itemId));
    return {
        entries,
        emptyText: entries.length > 0 ? undefined : '此獠身上暫未看出穩定掉落。',
    };
}
/** 依据观看者掉率属性，调整可见掉落概率。 */
export function resolveObservedDropChance(baseChanceInput, lootRateBonus, rareLootRateBonus, killEquivalentMultiplier = 1) {
  // 关键分支按状态与边界条件处理，非法路径会被提前拦截。

    const baseChance = typeof baseChanceInput === 'number' ? Math.max(0, Math.min(1, baseChanceInput)) : 1;
    if (baseChance <= 0) {
        return 0;
    }

    const totalRateBonus = (Number.isFinite(lootRateBonus) ? lootRateBonus : 0)
        + (baseChance <= 0.001 ? (Number.isFinite(rareLootRateBonus) ? rareLootRateBonus : 0) : 0);

    const baseKillEquivalent = totalRateBonus >= 0
        ? 1 + totalRateBonus / 10000
        : 1 / (1 + Math.abs(totalRateBonus) / 10000);
    const killEquivalent = Number.isFinite(killEquivalentMultiplier) && killEquivalentMultiplier > 0
        ? baseKillEquivalent * killEquivalentMultiplier
        : baseKillEquivalent;
    if (killEquivalent <= 0) {
        return 0;
    }
    return 1 - Math.pow(1 - baseChance, killEquivalent);
}
/** 稳定文本比较，给可复现的排序行为。 */
export function compareStableText(left, right) {
  // 关键分支按状态与边界条件处理，非法路径会被提前拦截。

    if (left === right) {
        return 0;
    }
    return left < right ? -1 : 1;
}
/** 生成 NPC 可见信息中的身份、商铺与任务指示。 */
export function buildNpcObservation(npc) {
  // 关键分支按状态与边界条件处理，非法路径会被提前拦截。

    const lines = [
        { label: '身份', value: npc.role ?? '尋常人物' },
        { label: '商號', value: npc.hasShop ? '經營貨鋪' : '暫無營生' },
    ];
    if (typeof npc.dialogue === 'string' && npc.dialogue.trim()) {
        lines.push({ label: '話語', value: npc.dialogue.trim() });
    }
    if (npc.quests.length > 0) {
        lines.push({ label: '委託', value: `可交互 ${npc.quests.length} 項` });
    }
    return {
        clarity: 'clear',
        verdict: npc.quests.length > 0
            ? '對方似乎正等著與來客交談，身上帶著幾分未了的委託氣息。'
            : npc.hasShop
                ? '對方神色沉穩，像是久經往來的買賣人。'
                : '對方氣機平和，看不出明顯敵意。',
        lines,
    };
}
/** 生成传送点实体详情：类型、触发方式、目标坐标。 */
export function buildPortalTileEntityDetail(portal, targetMapName) {

    const destination = targetMapName
        ? `${targetMapName} (${portal.targetX}, ${portal.targetY})`
        : `${portal.targetMapId} (${portal.targetX}, ${portal.targetY})`;
    return {
        id: buildPortalId(portal),
        name: buildPortalDisplayName(portal, targetMapName),
        kind: 'portal',
        observation: {
            clarity: 'clear',

            verdict: portal.trigger === 'auto'
                ? '此地靈路與空間縫隙已經貫通，踏入其中便會立刻被牽引離去。'
                : '此地靈路穩定卻未主動張開，需要你親自觸動才能穿行。',
            lines: [
                { label: '類型', value: buildPortalKindLabel(portal.kind) },
                { label: '方向', value: portal.direction === 'one_way' ? '單向' : '雙向' },
                { label: '觸發', value: portal.trigger === 'auto' ? '踏入即觸發' : '需要主動使用' },
                { label: '去向', value: destination },
            ],
        },
    };
}
/** 生成地面堆叠物实体详情与摘要文案。 */
export function buildGroundTileEntityDetail(groundPile) {

    const totalCount = groundPile.items.reduce((sum, entry) => sum + Math.max(0, Math.round(entry.count ?? 0)), 0);

    const previews = groundPile.items
        .slice(0, 3)
        .map((entry) => `${resolvePlayerFacingContentName(entry.itemId, '未知物品', entry.name)} x${Math.max(0, Math.round(entry.count ?? 0))}`);

    const remainingKinds = Math.max(0, groundPile.items.length - previews.length);

    const previewText = remainingKinds > 0
        ? `${previews.join('、')} 等 ${groundPile.items.length} 類`
        : previews.join('、');
    return {
        id: groundPile.sourceId,

        name: groundPile.items.length === 1
            ? resolvePlayerFacingContentName(groundPile.items[0]?.itemId, '未知物品', groundPile.items[0]?.name)
            : `散落物品堆 (${groundPile.items.length})`,
        kind: 'ground',
        observation: {
            clarity: 'clear',

            verdict: groundPile.items.length === 1
                ? '地上靜靜躺著一件可拾取之物。'
                : '地上散落著幾樣可拾取之物，像是剛被人匆忙遺落。',
            lines: [
                { label: '種類', value: `${groundPile.items.length} 類` },
                { label: '總量', value: `${totalCount} 件` },
                { label: '可見', value: previewText || '暫無可辨之物' },
            ],
        },
    };
}
/** 生成容器实体详情与搜索状态。 */
export function buildContainerTileEntityDetail(container) {
    return {
        id: `container:${container.id}`,
        name: container.name,
        kind: 'container',
        observation: {
            clarity: 'clear',
            verdict: container.desc?.trim() || `這處${container.name}可以搜索，翻找後或許會有收穫。`,
            lines: [
                { label: '類別', value: '可搜索陳設' },
                { label: '名稱', value: container.name },
                { label: '搜索階次', value: String(container.grade) },
            ],
        },
    };
}
/** 生成建筑实体详情与基础状态。 */
export function buildBuildingTileEntityDetail(building, compiled) {
    const name = resolvePlayerFacingContentName(building?.defId, '未知建築', building?.name, compiled?.name);
    const maxHp = Math.max(1, Math.trunc(Number(building?.maxHp ?? compiled?.maxHp ?? 1) || 1));
    const hp = Math.max(0, Math.min(maxHp, Math.trunc(Number(building?.hp ?? maxHp) || maxHp)));
    const lines = [
        { label: '類別', value: '建築' },
        { label: '名稱', value: name },
        { label: '狀態', value: buildBuildingStateLabel(building?.state) },
        { label: '生命', value: formatCurrentMaxObservation(hp, maxHp) },
    ];
    if (typeof building?.scriptureTechniqueId === 'string' && building.scriptureTechniqueId.trim()) {
        lines.push({
            label: '藏書',
            value: resolvePlayerFacingContentName(
                building.scriptureTechniqueId,
                '未知功法',
                building.scriptureTechniqueName,
            ),
        });
    }
    return {
        id: building.id,
        name,
        kind: 'building',
        hp,
        maxHp,
        observation: {
            clarity: 'clear',
            verdict: `此處立有${name}。`,
            lines,
        },
    };
}
/** 构建可见度层级文本与详情条目。 */
export function buildObservationInsight(viewerSpirit, targetSpirit, lines, selfView = false) {

    const progress = selfView ? 1 : computeObservationProgress(viewerSpirit, targetSpirit);
    return {
        clarity: resolveObservationClarity(progress),
        verdict: buildObservationVerdict(progress, selfView),
        lines: lines.map((line) => ({
            label: line.label,

            value: progress >= line.threshold ? line.value : '???',
        })),
    };
}
/** 计算观察进度百分比，用于盲/朦/清晰分级。 */
export function computeObservationProgress(viewerSpirit, targetSpirit) {
  // 关键分支按状态与边界条件处理，非法路径会被提前拦截。

    const normalizedViewer = normalizeObservationSpirit(viewerSpirit);

    const normalizedTarget = normalizeObservationSpirit(targetSpirit);

    const ratio = normalizedViewer / normalizedTarget;
    if (ratio <= OBSERVATION_BLIND_RATIO) {
        return 0;
    }
    if (ratio >= OBSERVATION_FULL_RATIO) {
        return 1;
    }
    return Math.max(0, Math.min(1, (ratio - OBSERVATION_BLIND_RATIO) / (OBSERVATION_FULL_RATIO - OBSERVATION_BLIND_RATIO)));
}
/** 根据进度返回 clarity 分层（veiled/blurred/partial/clear/complete）。 */
export function resolveObservationClarity(progress) {
  // 关键分支按状态与边界条件处理，非法路径会被提前拦截。

    if (progress <= 0) {
        return 'veiled';
    }
    if (progress < 0.34) {
        return 'blurred';
    }
    if (progress < 0.68) {
        return 'partial';
    }
    if (progress < 1) {
        return 'clear';
    }
    return 'complete';
}
/** 按 clarity 生成结论文案。 */
export function buildObservationVerdict(progress, selfView) {
  // 关键分支按状态与边界条件处理，非法路径会被提前拦截。

    if (selfView) {
        return '神識內照，經絡與底蘊盡現。';
    }
    if (progress <= 0) {
        return '對方氣機晦暗難明，暫時看不透。';
    }
    if (progress < 0.34) {
        return '只能勉強分辨出些許輪廓。';
    }
    if (progress < 0.68) {
        return '已能看出部分深淺，但仍有遮掩。';
    }
    if (progress < 1) {
        return '大致能辨明其底蘊與強弱。';
    }
    return '對方虛實已盡收眼底。';
}
/** 输出“当前值/最大值”数值文本。 */
export function formatCurrentMaxObservation(current, max) {
    return formatDisplayCurrentMax(Math.max(0, normalizeObservationNumber(current)), Math.max(0, normalizeObservationNumber(max)));
}
function buildBuildingStateLabel(state) {
    switch (state) {
        case 'planned':
            return '規劃中';
        case 'building':
            return '建造中';
        case 'active':
            return '已啟用';
        case 'damaged':
            return '受損';
        case 'destroyed':
            return '已毀壞';
        case 'deconstructing':
            return '拆除中';
        default:
            return '建築';
    }
}
/** 组合可读的传送点显示名。 */
export function buildPortalDisplayName(portal, targetMapName) {

    const base = buildPortalKindLabel(portal.kind);
    return targetMapName ? `${base} · ${targetMapName}` : base;
}
/** 将传送点类型映射为界面标签。 */
export function buildPortalKindLabel(kind) {
    switch (kind) {
        case 'stairs':
            return '樓梯';
        case 'door':
            return '門扉';
        case 'cave':
            return '洞口';
        case 'gate':
            return '關隘';
        default:
            return '傳送陣';
    }
}
/** 读取显式传送点 ID，兼容旧坐标 ID。 */
export function buildPortalId(portalOrX, y = undefined) {
    if (portalOrX && typeof portalOrX === 'object') {
        const explicit = typeof portalOrX.id === 'string' ? portalOrX.id.trim() : '';
        return explicit || `${portalOrX.x}:${portalOrX.y}`;
    }
    return `${portalOrX}:${y}`;
}
