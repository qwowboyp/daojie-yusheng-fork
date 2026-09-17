/**
 * 宗門八棟建築本地 recovery 固定契約。備份為 11:00 UTC，無法涵蓋 11:00–11:48 變更。
 */

export const TARGET_INSTANCE_ID =
  'sect:sect:p_968e1246-d327-4ea4-8624-2111214cede1:mthy0v4f:main';

export const TARGET_OWNER_SECT_ID = 'sect:p_968e1246-d327-4ea4-8624-2111214cede1:mthy0v4f';

export const TARGET_BUILDING_IDS = [
  'build:1789433747949:rxekjwt5zi',
  'build:1789433754648:bo9whuvdl47',
  'build:1789433758532:6f5crr2kk02',
  'build:1789433763533:4ze284h93ny',
  'build:1789433766948:fh7b8bxgb8',
  'build:1789433789848:dzd2v1phqdi',
  'build:1789433810098:7sqjsgyt6g5',
  'build:1789433848348:yga6o9mjo4a',
] as const;

export const EXPECTED_DEF_BY_BUILDING_ID: Readonly<Record<string, string>> = {
  'build:1789433747949:rxekjwt5zi': 'spirit_incubator_metal',
  'build:1789433754648:bo9whuvdl47': 'spirit_incubator_wood',
  'build:1789433758532:6f5crr2kk02': 'spirit_incubator_water',
  'build:1789433763533:4ze284h93ny': 'spirit_incubator_fire',
  'build:1789433766948:fh7b8bxgb8': 'spirit_incubator_earth',
  'build:1789433789848:dzd2v1phqdi': 'sect_iron_mine',
  'build:1789433810098:7sqjsgyt6g5': 'sect_spirit_stone_mine',
  'build:1789433848348:yga6o9mjo4a': 'sect_spirit_field',
};

export const BACKUP_IDENTITY = '20260917-110032-hourly-f42e62c0';
export const BACKUP_SHA256 = '4b5435c12b5ded30e0ba3254c30606ef0d7ff4df98abd9ff05fd8856cc5d857d';
export const SOURCE_SQL_SHA256 = '239641d2f81730e80f0ca9cfe3c5fd061e4a88af695efb692ddacdd0f071f140';
export const TARGET_TILE_INDEXES = [151, 150, 149, 165, 164, 110, 109, 96] as const;
export const COVERAGE_GAP_TOKEN = 'cannot_capture_1100_to_1148_utc';
export const COVERAGE_GAP_NOTE =
  'Backup is from 11:00 UTC and cannot capture changes from 11:00-11:48.';

export type TargetBuildingId = (typeof TARGET_BUILDING_IDS)[number];
