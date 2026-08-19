/**
 * 本文件负责服务端侧的权威运行、网络、持久化或运维辅助逻辑，是生产主线的一部分。
 *
 * 维护时要保持鉴权、恢复、幂等和数据真源边界清晰，避免把冷路径工具或查询逻辑卷入 tick 热路径。
 */

/**
 * AI 功法生成 Prompt 构造器。
 *
 * 职责：根据 category/grade/realmLv/playerContext 构造 system + user prompt。
 * 不注入 few-shot（归一化已兜数值），只描述结构约束。
 */

import type { PlayerRealmStage, TechniqueCategory, TechniqueGrade } from '@mud/shared';
import {
  CUSTOM_TECHNIQUE_NAME_MAX_LENGTH,
  CUSTOM_TECHNIQUE_NAME_MIN_LENGTH,
  PLAYER_REALM_ORDER,
  PLAYER_REALM_STAGE_LEVEL_RANGES,
  TECHNIQUE_ARTS_STRENGTH_ALLOWED_ATTRIBUTE_BASE_STATS,
  TECHNIQUE_ARTS_STRENGTH_ATTRIBUTE_BASE_COSTS,
  TECHNIQUE_ARTS_STRENGTH_CONSTANTS,
  TECHNIQUE_ARTS_STRENGTH_PERCENT_BONUS_KEYS,
  TECHNIQUE_ARTS_STRENGTH_SCALAR_PERCENT_BONUS_KEYS,
  TECHNIQUE_ARTS_STRENGTH_SCALAR_PERCENT_BONUS_SOURCE_BY_KEY,
  TECHNIQUE_INTERNAL_EXP_DIFFICULTY_RANGE,
  TECHNIQUE_INTERNAL_STAGE_WEIGHT,
  calcInternalTechniqueAttrTotalByBudgetPercent,
  calcInternalTechniqueTotalExp,
  getTechniqueGradeIndex,
  resolveTechniqueStageLayers,
} from '@mud/shared';
import { calcArtsBudgetMax } from './technique-budget-normalizer';

export interface TechniquePromptParams {
  category: TechniqueCategory;
  grade: TechniqueGrade;
  realmLv: number;
  maxLayer: number;
  playerContext: string;
  itemSpend?: number;
  budgetPercent?: number;
  totalBudget?: number;
}

export interface TechniquePromptOutput {
  systemMessage: string;
  userMessage: string;
}

export interface BatchInternalTechniqueNamingPromptParams {
  playerContext: string;
  entries: Array<{
    index: number;
    grade: TechniqueGrade;
    realmLv: number;
  }>;
}

const INTERNAL_SYSTEM_PROMPT = `你是修仙遊戲的功法設計師。根據玩家需求生成一個完整的內功功法 JSON。
嚴格遵循下方約束，不要生成約束裡不允許的字段。

輸出格式：單個 JSON 對象，可被 JSON.parse 直接解析。

必填字段：
- name: string（中文，${CUSTOM_TECHNIQUE_NAME_MIN_LENGTH}~${CUSTOM_TECHNIQUE_NAME_MAX_LENGTH}字）
- category: "internal"
- attrRatio: Record<AttrKey, number>（六維分配權重，正數，服務端歸一化）
- maxLayer: number（層數，3~49）
- expDifficulty: number（經驗難度，0.5~2.0，預設 1.0）

可選字段：
- desc: string（功法描述，20~60字）

AttrKey 枚舉：constitution / spirit / perception / talent / strength / meridians

規則：
- attrRatio 的值只是權重比例，服務端會自動歸一化，不需要湊整
- 至少分配 2 個維度的權重
- grade、realmLv、budgetPercent、totalBudget 由服務端隨機後注入，不要輸出
- 功法名稱和描述要有修仙风格，避免现代用语`;

const BATCH_INTERNAL_NAMING_SYSTEM_PROMPT = `你是修仙遊戲的功法命名與文案撰寫者。
本次只為一批內功擬定名稱和描述，不參與任何數值、屬性、權重、層數或技能設計。

輸出格式：只輸出一個可被 JSON.parse 直接解析的 JSON 對象，不要輸出代碼塊、解釋或額外文字。
JSON 根對象只能包含 techniques 字段：
{
  "techniques": [
    { "name": "內功名稱", "desc": "內功描述" }
  ]
}

規則：
- techniques 數量必須與輸入 entries 數量完全一致，並嚴格保持相同順序
- name 必须为中文，${CUSTOM_TECHNIQUE_NAME_MIN_LENGTH}~${CUSTOM_TECHNIQUE_NAME_MAX_LENGTH}字，同批名稱不得重複
- desc 必須為中文，20~60字，描述功法意象、修行方式或氣韻
- 名稱和描述須符合對應品階與境界，不得讓低階功法使用毀天滅地等失衡措辭
- 不得輸出 category、grade、realmLv、attrRatio、屬性、權重、maxLayer、expDifficulty、skills 或其他字段`;

const ARTS_SYSTEM_PROMPT = `你是修仙遊戲的術法強度設計器。請嚴格輸出單個 JSON 對象，不要輸出代碼塊或解釋文本。
你只能填寫強度導向的術法草稿，服務端會把 strength 權重歸一化並展開成正式 SkillDef。
所有強度預算權重只能寫在 structureStrength；target 只寫目標形狀；formulaStrength 只寫傷害屬性構成和可選百分比來源。
除非玩家在需求中主動提及吟唱、蓄力、施法前搖或類似設定，否則通常保持 structureStrength.chant 為 0，不要自行添加吟唱時間。
不要輸出約束裡沒有列出的字段；不要輸出 grade、realmLv、budgetPercent、totalBudget、真實傷害值、真實靈力消耗、真實冷卻、真實施法距離、真實影響半徑、effects、buff、heal 或技能公式。`;

const ARTS_TARGET_TYPE_ENUM = ['single', 'line', 'box', 'area'] as const;
const ARTS_DAMAGE_KIND_ENUM = ['physical', 'spell'] as const;
const ARTS_ELEMENT_ENUM = ['metal', 'wood', 'water', 'fire', 'earth'] as const;
const ARTS_STRUCTURE_STRENGTH_KEYS = ['damage', 'cost', 'cooldown', 'chant', 'castRange', 'area'] as const;

export function buildTechniquePrompt(params: TechniquePromptParams): TechniquePromptOutput {
  const { category } = params;

  const systemMessage = category === 'internal' ? INTERNAL_SYSTEM_PROMPT : ARTS_SYSTEM_PROMPT;
  if (category === 'arts') {
    return {
      systemMessage,
      userMessage: JSON.stringify(buildArtsStrengthPromptInput(params), null, 2),
    };
  }

  return {
    systemMessage,
    userMessage: JSON.stringify(buildInternalPromptInput(params), null, 2),
  };
}

export function buildBatchInternalTechniqueNamingPrompt(
  params: BatchInternalTechniqueNamingPromptParams,
): TechniquePromptOutput {
  return {
    systemMessage: BATCH_INTERNAL_NAMING_SYSTEM_PROMPT,
    userMessage: JSON.stringify({
      task: '為一批已由服務端完成數值生成的內功擬定名稱和描述',
      count: params.entries.length,
      playerTheme: params.playerContext || undefined,
      entries: params.entries.map((entry) => {
        const realmStage = resolveRealmStageInfo(entry.realmLv);
        return {
          index: entry.index,
          grade: entry.grade,
          gradeLabel: gradeLabel(entry.grade),
          realmLv: entry.realmLv,
          realmStage: realmStage.stage,
          realmStageLabel: realmStage.label,
        };
      }),
      outputSchema: {
        techniques: params.entries.map(() => ({
          name: `中文內功名，${CUSTOM_TECHNIQUE_NAME_MIN_LENGTH}到${CUSTOM_TECHNIQUE_NAME_MAX_LENGTH}字`,
          desc: '中文描述，20到60字',
        })),
      },
      forbiddenFields: [
        'category', 'grade', 'realmLv', 'attrRatio', 'attributes', 'weights',
        'maxLayer', 'expDifficulty', 'layers', 'skills', 'budgetPercent', 'totalBudget',
      ],
    }, null, 2),
  };
}

/** 构造重试 prompt（追加错误反馈） */
export function buildRetryPrompt(
  original: TechniquePromptOutput,
  failureReason: string,
): TechniquePromptOutput {
  const retryGuidance = {
    previousFailureReason: failureReason,
    instruction: '請優先修正上述失敗原因，並重新輸出完整 JSON；不要只輸出局部字段。',
  };
  try {
    const parsed = JSON.parse(original.userMessage) as Record<string, unknown>;
    return {
      systemMessage: original.systemMessage,
      userMessage: JSON.stringify({ ...parsed, retryGuidance }, null, 2),
    };
  } catch {
    // 内功 prompt 仍是自然语言，保留原有追加方式。
  }
  return {
    systemMessage: original.systemMessage,
    userMessage: `${original.userMessage}\n\n【重要修正】上次生成失敗，原因：${failureReason}\n請修正後重新輸出完整 JSON。`,
  };
}

function buildArtsStrengthPromptInput(params: TechniquePromptParams): Record<string, unknown> {
  const constants = TECHNIQUE_ARTS_STRENGTH_CONSTANTS;
  const generationContext = buildGenerationContext(params);
  const artsBudgetContext = buildArtsBudgetContext(params);
  const scalarPercentBonusRules = TECHNIQUE_ARTS_STRENGTH_SCALAR_PERCENT_BONUS_KEYS.map((key) => {
    const source = TECHNIQUE_ARTS_STRENGTH_SCALAR_PERCENT_BONUS_SOURCE_BY_KEY[key];
    const scale = constants.percentBonuses.moveSpeedScalePerStrength * source.moveSpeedEquivalent;
    return `${key}: 預算1時先加入 ${source.formulaVar} * ${scale} 的總傷害百分比加成，再統一乘百分比組合倍率`;
  });
  return {
    task: '生成一個 AI 術法功法強度草稿',
    generationContext,
    budgetContext: artsBudgetContext,
    fixedInputs: {
      grade: params.grade,
      gradeLabel: gradeLabel(params.grade),
      category: 'arts',
      realmLv: params.realmLv,
      budgetPercent: normalizePromptBudgetPercent(params.budgetPercent),
      totalBudget: artsBudgetContext.actualTotalBudget,
      maxLayer: params.maxLayer,
      playerTheme: params.playerContext || undefined,
    },
    serverInjectedFields: {
      grade: params.grade,
      realmLv: params.realmLv,
      budgetPercent: normalizePromptBudgetPercent(params.budgetPercent),
      totalBudget: artsBudgetContext.actualTotalBudget,
    },
    outputTopLevelSchema: {
      name: 'string，中文，2到8字',
      category: '必須嚴格等於 arts',
      maxLayer: `必須嚴格等於 ${params.maxLayer}`,
      expDifficulty: 'number，可選，0.5到2.0，預設1',
      desc: 'string，可選，20到60字',
      skills: '數組，必須且只能有1個 TechniqueArtsStrengthSkill',
    },
    skillSchema: {
      name: 'string，技能名，中文',
      desc: 'string，技能描述',
      unlockLevel: `integer，1到${params.maxLayer}`,
      damageKind: ARTS_DAMAGE_KIND_ENUM,
      element: ARTS_ELEMENT_ENUM,
      target: {
        type: ARTS_TARGET_TYPE_ENUM,
      },
      structureStrength: Object.fromEntries(ARTS_STRUCTURE_STRENGTH_KEYS.map((key) => [
        key,
        `number，強度權重，${constants.weights.min}到${constants.weights.max}；正數強化本項，負數犧牲本項並擴大正向預算池，0表示預設/最低可用`,
      ])),
      formulaStrength: {
        attributeBases: `對象，key 必須來自 allowedAttributeBaseStats，數量 ${constants.attributeBases.minCount} 到 ${constants.attributeBases.maxCount} 個，value 只表示傷害屬性構成比例，必須為正數，不能寫0或負數`,
        percentBonuses: `對象，可選，key 必須來自 allowedPercentBonusKeys；value 為權重，${constants.percentBonuses.minStrength}到${constants.percentBonuses.maxStrength}；省略等於0，禁止負數`,
      },
    },
    allowedAttributeBaseStats: [...TECHNIQUE_ARTS_STRENGTH_ALLOWED_ATTRIBUTE_BASE_STATS],
    attributeBaseCostBy100Percent: TECHNIQUE_ARTS_STRENGTH_ATTRIBUTE_BASE_COSTS,
    allowedPercentBonusKeys: [...TECHNIQUE_ARTS_STRENGTH_PERCENT_BONUS_KEYS],
    strengthRules: {
      budgetOwnership: '禁止輸出 totalBudget/inputBudget/targetBudget；本次實際總預算已在 budgetContext.actualTotalBudget 給出，服務端按各項權重分配並展開真實 SkillDef。',
      structureMeaning: [
        'structureStrength 必須作為唯一預算權重對象，建議寫全 damage/cost/cooldown/chant/castRange/area 六個字段，未提到的項目寫0。',
        'damage：傷害強弱；正數提高屬性基底倍率，負數犧牲傷害，0按最低可用傷害展開。',
        'cost：靈力消耗；正數降低消耗，負數提高消耗。',
        `cooldown：冷卻；正數縮短冷卻，負數拉長冷卻，0預算的基礎冷卻為 ${constants.structure.cooldownBaseRealmLvMultiplier} * realmLv 息。`,
        'castRange：施法距離；正數偏遠程，負數一般不要寫，0表示近身/基礎距離。',
        'area：覆蓋範圍；正數擴大覆蓋，single 會視為0覆蓋強度，0表示不追求範圍。',
        'chant：吟唱權重；負值會生成真實吟唱息數，絕對值越大吟唱越久；0或正值不會把瞬發技能繼續縮短。',
        '正權重表示想強化的項目；負權重表示主動犧牲的項目，會讓本項變差，並按絕對權重摺算犧牲預算加入正向預算池。',
        '正向預算池 = actualTotalBudget + sum(actualTotalBudget * abs(負權重) / 100)；正權重按權重比例瓜分該預算池。',
        '例如 damage=-100、cost=-100、cooldown=100 時，傷害和消耗各犧牲一份預算，cooldown 作為唯一正項可吃到約3份 actualTotalBudget。',
        'structureStrength 裡的字段都只是強度權重，不是真實運行時數值；不要輸出 costMultiplier/cooldown/cooldownTicks/range/radius。',
      ],
      formulaMeaning: [
        'attributeBases 只表示傷害由哪些屬性構成和構成比例，不參與預算池正負權重分配；傷害強弱必須寫在 structureStrength.damage。',
        'attributeBases 的值必須為正數；如果只要最低傷害，也要寫一個屬性構成，例如 { spellAtk: 1 }，並把 structureStrength.damage 寫為0或負數。',
        '如果玩家主題要求高傷害，才把 structureStrength.damage 提高到 60 到 100。',
        `techLevel 預設0，表示每層增加${Math.round(constants.percentBonuses.techLevelScaleBase * 100)}%總傷害；通常不要寫正值。`,
        `百分比來源組合倍率按正權重配比平衡度計算：均衡2項最高1.1、3項最高1.3、4項最高1.6、${constants.percentBonuses.synergyMaxSources}項及以上最高2.0；失衡會連續降低倍率，嚴重失衡時回到1.0。`,
        '不要為了湊來源數量加入極小權重；低配比來源會提高變異係數，可能讓組合倍率不升反降。',
        ...scalarPercentBonusRules,
      ],
      rangeMeaning: [
        'target 只描述目標形狀，不承載任何預算權重；不要在 target 裡寫 castRangeWeight、areaWeight 或真實範圍字段。',
        'target.type 選擇 single/line/box/area；真實範圍、距離和覆蓋格數由 structureStrength.castRange / structureStrength.area 展開。',
        '所有需要選取目標的技能統一可影響玩家、怪物、地塊、陣法和容器，不允許輸出目標類型模式。',
        '玩家主題中的“範圍32格”表示希望覆蓋強度接近32格，不是真實半徑32；請用 structureStrength.area 表達覆蓋傾向。',
        `structureStrength.castRange 表示施法距離預算傾向：1格為0預算，2格約消耗1*${constants.structure.castRangeBudgetGrowth}預算，3格約消耗2*${constants.structure.castRangeBudgetGrowth}^2預算；不要把它當作最終施法距離。`,
        `影響範圍按預算換算覆蓋格：每1點實際範圍預算約增加${constants.structure.coverageCellsPerBudget}格，line/box/area 會按各自形狀向下取整成真實寬度、邊長或半徑。`,
        'single 視為0覆蓋強度；line/box/area 只選擇形狀和覆蓋傾向，真實覆蓋格數由服務端展開。',
      ],
      calculationFormulas: artsBudgetContext.formulas,
    },
    forbiddenFields: [
      'id', 'grade', 'realmLv', 'budgetPercent', 'totalBudget',
      'cost', 'costMultiplier', 'cooldown', 'targeting',
      'effects', 'value', 'formula', 'buff', 'buffId', 'heal',
      'maxTargets', 'inputBudget', 'targetBudget',
      'range', 'radius', 'width', 'height',
      'targetMode',
      'damageValue', 'baseDamage',
    ],
    outputChecklist: [
      '只輸出單個 JSON 對象，必須可被 JSON.parse 解析。',
      'category/maxLayer 必須嚴格等於 fixedInputs。',
      '不要輸出 grade、realmLv、budgetPercent、totalBudget；這些字段由服務端注入。',
      'skills.length 必須等於1。',
      'skills[0] 只能描述一個 damage 術法，不允許 heal/buff/debuff/control。',
      '不得輸出 forbiddenFields 中的任何字段。',
      'formulaStrength.attributeBases 至少1個、最多5個 key，key 必須來自 allowedAttributeBaseStats。',
      'formulaStrength.attributeBases 的值必須是正構成權重；最低傷害也要寫 1，不能寫 0 或負數。',
      'target 只允許 type；不要輸出 targetMode/castRangeWeight/areaWeight/range/radius/width/height。',
      'structureStrength 必須只包含 damage/cost/cooldown/chant/castRange/area；為了表達玩家偏好，建議六個字段都寫出來。',
      '施法距離和影響範圍權重必須寫在 structureStrength.castRange / structureStrength.area，不要寫進 target。',
      '屬性基底優先按主題選擇，例如蠻力/拳掌偏 physAtk 或 breakPower，玄妙法術偏 spellAtk，身法風格可少量使用 dodge/moveSpeed。',
      '不要為了湊強度寫過多文本；描述保持修仙風格。',
      '名稱、描述、威勢措辭必須貼合 generationContext 的品階、境界階段和命名尺度，低境界不要寫毀天滅地，高境界不要寫成凡俗小術。',
    ],
    outputExample: {
      name: '分光訣',
      category: 'arts',
      maxLayer: params.maxLayer,
      expDifficulty: 1,
      desc: '凝鋒成線，催動金行銳氣直貫前方，破敵護體真元。',
      skills: [
        {
          name: '分光一線',
          desc: '鋒芒成線，直破前方三步。',
          unlockLevel: 1,
          damageKind: 'physical',
          element: 'metal',
          target: { type: 'line' },
          structureStrength: { damage: 4, cost: 0, cooldown: 1, chant: 0, castRange: 3, area: 1 },
          formulaStrength: {
            attributeBases: { physAtk: 4 },
          },
        },
      ],
    },
  };
}

function buildInternalPromptInput(params: TechniquePromptParams): Record<string, unknown> {
  const generationContext = buildGenerationContext(params);
  const internalBudgetContext = buildInternalBudgetContext(params);
  return {
    task: '生成一個 AI 內功功法強度草稿',
    generationContext,
    budgetContext: internalBudgetContext,
    fixedInputs: {
      grade: params.grade,
      gradeLabel: gradeLabel(params.grade),
      category: 'internal',
      realmLv: params.realmLv,
      budgetPercent: normalizePromptBudgetPercent(params.budgetPercent),
      totalBudget: internalBudgetContext.actualTotalBudget,
      maxLayer: params.maxLayer,
      playerTheme: params.playerContext || undefined,
    },
    serverInjectedFields: {
      grade: params.grade,
      realmLv: params.realmLv,
      budgetPercent: normalizePromptBudgetPercent(params.budgetPercent),
      totalBudget: internalBudgetContext.actualTotalBudget,
    },
    outputTopLevelSchema: {
      name: 'string，中文，2到8字',
      category: '必須嚴格等於 internal',
      maxLayer: `必須嚴格等於 ${params.maxLayer}`,
      expDifficulty: `number，可選，${TECHNIQUE_INTERNAL_EXP_DIFFICULTY_RANGE[0]}到${TECHNIQUE_INTERNAL_EXP_DIFFICULTY_RANGE[1]}，預設1`,
      desc: 'string，可選，20到60字',
      attrRatio: 'Record<AttrKey, number>，六維分配權重，正數，服務端歸一化',
    },
    attrKeys: {
      constitution: '體魄/肉身/生命承載',
      spirit: '神識/元神/法術根基',
      perception: '感知/身法/靈覺',
      talent: '根骨/資質/悟性',
      strength: '力道/氣力/近戰根基',
      meridians: '經脈/真元/靈力運轉',
    },
    strengthRules: {
      budgetOwnership: '不要輸出真實 layers、逐層屬性或總屬性；服務端按 attrRatio 和 serverInjectedFields.totalBudget 展開。',
      formulaMeaning: [
        'attrRatio 是六維分配權重，不是最終屬性數值；權重和不需要湊整。',
        '總預算由 serverInjectedFields.budgetPercent 和 serverInjectedFields.totalBudget 決定，不要輸出 attrFloat 或其他總量字段。',
        '至少分配2個維度；主題偏拳掌可重 strength/constitution，玄妙法術可重 spirit/meridians，身法感知可重 perception/talent。',
      ],
      calculationFormulas: internalBudgetContext.formulas,
    },
    forbiddenFields: [
      'id', 'grade', 'realmLv', 'budgetPercent', 'totalBudget',
      'layers', 'layerGains', 'skills', 'effects',
      'inputBudget', 'targetBudget', 'attrFloat', 'attrTotal', 'totalExp',
    ],
    outputChecklist: [
      '只輸出單個 JSON 對象，必須可被 JSON.parse 解析。',
      'category/maxLayer 必須嚴格等於 fixedInputs。',
      '不要輸出 grade、realmLv、budgetPercent、totalBudget；這些字段由服務端注入。',
      'attrRatio 至少包含2個合法 attrKeys，值必須為正數。',
      '不要輸出真實 layers、逐層屬性、技能公式或預算字段。',
      '名稱、描述、威勢措辭必須貼合 generationContext 的品階、境界階段和命名尺度，低境界不要寫毀天滅地，高境界不要寫成凡俗小術。',
    ],
    outputExample: {
      name: '玄息訣',
      category: 'internal',
      maxLayer: params.maxLayer,
      expDifficulty: 1,
      desc: '納息歸元，溫養經脈，使靈力流轉更為綿密。',
      attrRatio: { spirit: 3, meridians: 2, perception: 1 },
    },
  };
}

function buildGenerationContext(params: TechniquePromptParams): Record<string, unknown> {
  const realmStage = resolveRealmStageInfo(params.realmLv);
  return {
    rolled: true,
    grade: params.grade,
    gradeLabel: gradeLabel(params.grade),
    gradeIndex: getTechniqueGradeIndex(params.grade),
    category: params.category,
    categoryLabel: categoryLabel(params.category),
    realmLv: params.realmLv,
    realmStage: realmStage.stage,
    realmStageIndex: realmStage.stageIndex,
    realmStageLabel: realmStage.label,
    realmStageLevelRange: realmStage.levelRange,
    maxLayer: params.maxLayer,
    itemSpend: params.itemSpend,
    budgetPercent: normalizePromptBudgetPercent(params.budgetPercent),
    totalBudget: normalizePromptTotalBudget(params),
    playerTheme: params.playerContext || undefined,
    toneGuidance: buildToneGuidance(params.grade, realmStage.label),
  };
}

function buildInternalBudgetContext(params: TechniquePromptParams): Record<string, unknown> {
  const budgetPercent = normalizePromptBudgetPercent(params.budgetPercent);
  const baseAttrTotal = calcInternalTechniqueAttrTotalByBudgetPercent(params.grade, params.realmLv, 1);
  const actualTotalBudget = normalizePromptTotalBudget(params);
  const totalExpAtDefaultDifficulty = calcInternalTechniqueTotalExp(
    params.grade,
    params.realmLv,
    params.maxLayer,
    1,
    'internal',
  );
  return {
    budgetType: 'internal_attr_ratio',
    budgetPercent,
    baseTotalBudgetAt100Percent: roundPromptNumber(baseAttrTotal),
    actualTotalBudget,
    budgetPercentRange: { min: 0.8, max: 1.2, default: 1 },
    totalExpAtDefaultDifficulty: Math.round(totalExpAtDefaultDifficulty),
    stageLayers: resolveTechniqueStageLayers(params.maxLayer),
    stageWeight: TECHNIQUE_INTERNAL_STAGE_WEIGHT,
    formulas: [
      'gradeIndex: mortal=1, yellow=2, mystic=3, earth=4, heaven=5, spirit=6, saint=7, emperor=8',
      '滿層六維總屬性 totalBudget = (gradeIndex^2 * (realmLv + 25) + 50) * budgetPercent',
      '階段層數按 maxLayer 切為 [入門, 小成, 大成]；階段屬性權重為 [1, 2, 4]',
      '每層每維屬性 = 階段該維總屬性 / 階段層數 * attrRatio[維] / sum(attrRatio)',
      '總經驗 = gradeIndex^2 * (realmLv + 5) * categoryFactor * ((1.10^maxLayer - 1) / (1.10 - 1)) * expDifficulty * TECHNIQUE_EXP_BASE * realmLv',
    ],
  };
}

function buildArtsBudgetContext(params: TechniquePromptParams): Record<string, unknown> {
  const constants = TECHNIQUE_ARTS_STRENGTH_CONSTANTS;
  const budgetPercent = normalizePromptBudgetPercent(params.budgetPercent);
  return {
    budgetType: 'arts_weight_allocation',
    budgetPercent,
    baseTotalBudgetAt100Percent: roundPromptNumber(calcArtsBudgetMax(params.grade, params.realmLv)),
    actualTotalBudget: normalizePromptTotalBudget(params),
    budgetPercentRange: { min: 0.8, max: 1.2, default: 1 },
    formulas: [
      'gradeIndex: mortal=1, yellow=2, mystic=3, earth=4, heaven=5, spirit=6, saint=7, emperor=8',
      '術法基礎滿層預算 BUDGET_base = 3 + realmLv * 0.5 * 1.4^(gradeIndex - 1) * majorRealmMultiplier',
      '術法本次實際總預算 actualTotalBudget = BUDGET_base * budgetPercent',
      'positiveWeight = sum(max(itemWeight, 0)); sacrificeBudget = sum(actualTotalBudget * abs(支持負向的結構權重) / 100)，百分比來源不參與犧牲預算',
      '正向預算池 positiveBudgetPool = actualTotalBudget + sacrificeBudget',
      '正權重 itemBudget = positiveBudgetPool * itemWeight / positiveWeight；負權重 itemBudget = -actualTotalBudget * abs(itemWeight) / 100',
      `傷害倍率預算 damageBudget <= 0 時按最低 ${constants.attributeBases.minDamageScale} 屬性基底倍率展開`,
      `靈力消耗倍率 costMultiplier = costBudget >= 0 ? ${constants.structure.costPositivePerBudget}^costBudget : ${constants.structure.costNegativePerBudget}^abs(costBudget)`,
      `冷卻 cooldownTicks = round(${constants.structure.cooldownBaseRealmLvMultiplier} * realmLv * (cooldownBudget >= 0 ? ${constants.structure.cooldownPositivePerBudget}^cooldownBudget : ${constants.structure.cooldownNegativePerBudget}^abs(cooldownBudget)))，最小1息`,
      `施法距離：1格為0預算；r格消耗 (r - 1) * ${constants.structure.castRangeBudgetGrowth}^(r - 1)，常規最大${constants.structure.maxCastRange}格，line最大${constants.structure.maxLineCastRange}格`,
      `影響範圍：每1點範圍預算約增加${constants.structure.coverageCellsPerBudget}個覆蓋格，按 single/line/box/area 各自形狀向下取整`,
      '屬性基底倍率 = 屬性實際預算 / 每100%基底成本；spellAtk/physAtk等成本見 attributeBaseCostBy100Percent',
      `百分比組合平衡度：CV = sqrt(mean(((sourceBudget - meanBudget) / meanBudget)^2))；balance = clamp(1 - CV / ${constants.percentBonuses.synergyMaxCoefficientOfVariation}, 0, 1)`,
      `百分比組合倍率：count = min(正預算來源數, ${constants.percentBonuses.synergyMaxSources})；maxMultiplier = 1 + ${constants.percentBonuses.synergyPairBonus} * count * (count - 1) / 2；multiplier = 1 + (maxMultiplier - 1) * balance`,
      `層數加成 techLevel 每層比例 = ${constants.percentBonuses.techLevelScaleBase} + techLevelBudget * ${constants.percentBonuses.techLevelScaleBase} * 百分比組合倍率`,
      `移速加成 = caster.stat.moveSpeed * max(0, moveSpeedBudget) * ${constants.percentBonuses.moveSpeedScalePerStrength}`,
      `境界等級加成 = caster.realmLv * max(0, realmLevelBudget) * ${constants.percentBonuses.moveSpeedScalePerStrength * constants.percentBonuses.realmLevelMoveSpeedEquivalent}`,
      `任一技藝等級加成 = caster.craft.<技藝>.level * max(0, 對應Budget) * ${constants.percentBonuses.moveSpeedScalePerStrength * constants.percentBonuses.craftSkillLevelMoveSpeedEquivalent}`,
      '除功法層數基礎10%外，所有預算派生的百分比來源係數統一乘百分比組合倍率。',
      '觸頂或離散檔位暫時用不完的正預算會按原始正權重比例迴流給仍可增長的正向項目；不要輸出預算字段，服務端自動展開',
    ],
  };
}

function resolveRealmStageInfo(realmLv: number): {
  stage: PlayerRealmStage;
  stageIndex: number;
  label: string;
  levelRange: { from: number; to: number };
} {
  for (let i = PLAYER_REALM_ORDER.length - 1; i >= 0; i -= 1) {
    const stage = PLAYER_REALM_ORDER[i];
    const range = PLAYER_REALM_STAGE_LEVEL_RANGES[stage];
    if (range && realmLv >= range.levelFrom) {
      return {
        stage,
        stageIndex: i + 1,
        label: realmStageLabel(stage),
        levelRange: { from: range.levelFrom, to: range.levelTo },
      };
    }
  }
  const fallback = PLAYER_REALM_ORDER[0];
  const range = PLAYER_REALM_STAGE_LEVEL_RANGES[fallback];
  return {
    stage: fallback,
    stageIndex: 1,
    label: realmStageLabel(fallback),
    levelRange: { from: range.levelFrom, to: range.levelTo },
  };
}

function realmStageLabel(stage: PlayerRealmStage): string {
  const labels: Record<PlayerRealmStage, string> = {
    0: '凡人',
    1: '淬體',
    2: '鍛骨',
    3: '通脈',
    4: '先天',
    5: '練氣前期',
    7: '練氣中期',
    8: '練氣後期',
    6: '築基前期',
    9: '築基中期',
    10: '築基後期',
    11: '金丹前期',
    12: '金丹中期',
    13: '金丹後期',
    14: '元嬰前期',
    15: '元嬰中期',
    16: '元嬰後期',
    17: '化神前期',
    18: '化神中期',
    19: '化神後期',
    20: '煉虛前期',
    21: '煉虛中期',
    22: '煉虛後期',
    23: '合體前期',
    24: '合體中期',
    25: '合體後期',
    26: '大乘前期',
    27: '大乘中期',
    28: '大乘後期',
    29: '渡劫前期',
    30: '渡劫中期',
    31: '渡劫後期',
    32: '飛昇',
  };
  return labels[stage] ?? `境界階段${stage}`;
}

function buildToneGuidance(grade: TechniqueGrade, realmStageLabelText: string): string[] {
  const gradeIndex = getTechniqueGradeIndex(grade);
  const scale = gradeIndex <= 2
    ? '低階：名稱和描述應偏樸素、基礎、可修煉，不使用滅世、碎星、焚天、萬劫等過強詞。'
    : gradeIndex <= 4
      ? '中階：可以寫靈壓、劍光、丹火、陣紋、山河之勢，但仍避免宇宙級、毀天滅地級措辭。'
      : '高階：可以使用天象、法則、虛空、聖意、帝威等強勢意象，名稱要顯得稀有而厚重。';
  return [
    `本次抽中 ${gradeLabel(grade)} / ${realmStageLabelText}，名稱和描述必須匹配這個強度層級。`,
    scale,
    '玩家主題只決定風格傾向，不得覆蓋 fixedInputs 中的品階、境界等級和服務端預算。',
  ];
}

function roundPromptNumber(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function normalizePromptBudgetPercent(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 1;
  }
  return roundPromptNumber(Math.max(0.8, Math.min(1.2, numeric)));
}

function normalizePromptTotalBudget(params: TechniquePromptParams): number {
  const numeric = Number(params.totalBudget);
  if (Number.isFinite(numeric) && numeric > 0) {
    return roundPromptNumber(numeric);
  }
  const budgetPercent = normalizePromptBudgetPercent(params.budgetPercent);
  const base = params.category === 'arts'
    ? calcArtsBudgetMax(params.grade, params.realmLv)
    : calcInternalTechniqueAttrTotalByBudgetPercent(params.grade, params.realmLv, 1);
  return roundPromptNumber(base * budgetPercent);
}

function gradeLabel(grade: TechniqueGrade): string {
  const map: Record<TechniqueGrade, string> = {
    mortal: '凡階', yellow: '黃階', mystic: '玄階', earth: '地階',
    heaven: '天階', spirit: '靈階', saint: '聖階', emperor: '帝階',
  };
  return map[grade] ?? grade;
}

function categoryLabel(category: TechniqueCategory): string {
  const map: Record<TechniqueCategory, string> = {
    internal: '內功', arts: '術法', divine: '神通', secret: '秘術',
  };
  return map[category] ?? category;
}
