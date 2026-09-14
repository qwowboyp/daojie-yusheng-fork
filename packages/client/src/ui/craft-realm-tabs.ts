import { gameplayConstants, PlayerRealmStage } from '@mud/shared';

const { PLAYER_REALM_CONFIG, PLAYER_REALM_STAGE_LEVEL_RANGES } = gameplayConstants;

const CRAFT_REALM_TAB_DEFINITIONS = [
  { realm: 'mortal', label: '凡胎', lastStage: PlayerRealmStage.Innate },
  { realm: 'qi', label: '練氣', lastStage: PlayerRealmStage.QiRefiningLate },
  { realm: 'foundation', label: '築基', lastStage: PlayerRealmStage.FoundationLate },
  { realm: 'golden-core', lastStage: PlayerRealmStage.GoldenCoreLate },
  { realm: 'nascent', lastStage: PlayerRealmStage.NascentLate },
  { realm: 'soul-transform', lastStage: PlayerRealmStage.SoulTransformLate },
  { realm: 'void-refine', lastStage: PlayerRealmStage.VoidRefineLate },
  { realm: 'body-integration', lastStage: PlayerRealmStage.BodyIntegrationLate },
  { realm: 'mahayana', lastStage: PlayerRealmStage.MahayanaLate },
  { realm: 'tribulation', lastStage: PlayerRealmStage.TribulationLate },
  { realm: 'ascension', lastStage: PlayerRealmStage.Ascension },
] as const satisfies readonly {
  realm: string;
  label?: string;
  lastStage: PlayerRealmStage;
}[];

export type CraftRealmTab = (typeof CRAFT_REALM_TAB_DEFINITIONS)[number]['realm'];

export type CraftRealmTabDefinition = {
  realm: CraftRealmTab;
  label: string;
  levelTo: number;
};

const CRAFT_REALM_TABS: readonly CraftRealmTabDefinition[] = CRAFT_REALM_TAB_DEFINITIONS.map((definition) => {
  const config = PLAYER_REALM_CONFIG[definition.lastStage];
  const label = 'label' in definition ? definition.label : undefined;
  return {
    realm: definition.realm,
    label: label ?? config.name.replace(/[前中後]期$/, ''),
    levelTo: PLAYER_REALM_STAGE_LEVEL_RANGES[definition.lastStage].levelTo,
  };
});

export function getCraftRealmTab(level: number): CraftRealmTab {
  const normalizedLevel = Math.max(1, Math.floor(Number(level) || 1));
  return CRAFT_REALM_TABS.find((tab) => normalizedLevel <= tab.levelTo)?.realm ?? 'ascension';
}

export function normalizeCraftRealmTab(value: string | undefined): CraftRealmTab {
  return CRAFT_REALM_TABS.find((tab) => tab.realm === value)?.realm ?? 'mortal';
}

/** 保留原本三個入口；築基後的分頁只有實際配方存在時才顯示。 */
export function getVisibleCraftRealmTabs(
  entries: readonly { outputLevel: number }[],
): readonly CraftRealmTabDefinition[] {
  const available = new Set(entries.map((entry) => getCraftRealmTab(entry.outputLevel)));
  return CRAFT_REALM_TABS.filter((tab, index) => index < 3 || available.has(tab.realm));
}
