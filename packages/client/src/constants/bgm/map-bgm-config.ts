/**
 * 每地圖 BGM 配置表（純客戶端表現層配置，不參與協議）。
 *
 * 配置方式：
 * 1. 把新的 BGM 檔案放進 `packages/client/public/bgm/`。
 *    命名規則：檔名 = 曲目 key（即 mapGroupId）底線改連字號 + `.mp3`，全小寫。
 *    例：mapGroupId `yunlai_town` → `yunlai-town.mp3`。
 * 2. 在 {@link MAP_BGM_TRACKS} 註冊曲目 key → 檔名（通常已預先註冊，放檔案即生效）。
 * 3. 在 {@link MAP_BGM_ASSIGNMENTS} 把 mapId（精確）或 mapGroupId（整組）指到該 key。
 *
 * 查找順序：`MAP_BGM_ASSIGNMENTS[mapId]` → `MAP_BGM_ASSIGNMENTS[mapGroupId]` → `DEFAULT_MAP_BGM_TRACK`。
 * 檔案尚未放入時播放器會在載入失敗後回退預設曲目（見 bgm-player.ts），
 * 因此放入 mp3 前不必擔心整圖無聲。
 *
 * 樓層歸組約定：「有樓層的都算同一張」——雲來鎮全組子圖 mapGroupId=yunlai_town 天然共用；
 * 其餘關卡型子圖（mapGroupId 為自身）已在下方顯式指向母圖曲目 key，
 * 換樓層不換曲、不中斷。
 */

/** BGM 檔案根路徑（Vite public 目錄，部署後由 nginx 靜態伺服）。 */
export const MAP_BGM_BASE_PATH = '/bgm/';

/** 預設曲目 key：未命中任何配置時使用（同時也是登入畫面與載入失敗的回退曲目）。 */
export const DEFAULT_MAP_BGM_TRACK = 'gameBGM-01';

/**
 * BGM 曲目庫：key → `public/bgm/` 下的檔名。
 * key 與 mapGroupId 同名（底線），檔名為其連字號版本；`gameBGM-01` 為歷史保留命名。
 */
export const MAP_BGM_TRACKS: Readonly<Record<string, string>> = {
  'gameBGM-01': 'gameBGM-01.mp3', // 預設／登入畫面（既有檔案）
  yunlai_town: 'yunlai-town.mp3', // 雲來鎮：破敗新手鎮，寧靜滄桑古箏笛
  qizhen_crossing: 'qizhen-crossing.mp3', // 棲真渡：練氣主城，熱鬧市井
  yunxu_terrace: 'yunxu-terrace.mp3', // 雲墟臺：雲海石臺，空靈超脫
  prison: 'prison.mp3', // 監牢：空曠囚場，單調壓抑
  wildlands: 'wildlands.mp3', // 荒野：開闊荒涼，風聲低迴
  bamboo_forest: 'bamboo-forest.mp3', // 青竹林：清新竹韻，暗藏蟲巢
  black_iron_mine: 'black-iron-mine.mp3', // 玄鐵礦洞：低沉迴響，鑿巖節奏
  ancient_ruins: 'ancient-ruins.mp3', // 斷碑遺蹟：古老神秘，鐘磬殘響
  beast_valley: 'beast-valley.mp3', // 噬魂獸谷：危機四伏，獸性鼓點
  spirit_ridge: 'spirit-ridge.mp3', // 靈脊嶺：山嶺陡峭，風急雲高
  sky_ruins: 'sky-ruins.mp3', // 天穹殘宮：高空殘宮，莊嚴蒼涼
  cleft_blade_plain: 'cleft-blade-plain.mp3', // 裂鋒原（金）：金屬鋒利，緊湊推進
  cold_tide_marsh: 'cold-tide-marsh.mp3', // 寒汐澤（水）：陰冷潮溼，水滴迴音
  deepvein_ridge: 'deepvein-ridge.mp3', // 厚脈嶺（土）：厚重沉穩，巖石掘進
  emberfall_court: 'emberfall-court.mp3', // 赤隕庭（火）：熾烈緊張，灼熱鼓點
  guizang_vein_cavern: 'guizang-vein-cavern.mp3', // 歸藏脈窟：深隧迷離，終局感
  heaven_ladder: 'heaven-ladder.mp3', // 天梯：壓迫莊嚴，漸強攀登
  frostblade_abyss: 'frostblade-abyss.mp3', // 霜刃淵：冰鐵深淵，寒意滲人
  blazewood_waste: 'blazewood-waste.mp3', // 焚木荒臺：荒蕪炙熱，餘燼感
  darksoil_abyss: 'darksoil-abyss.mp3', // 玄壤深淵：深沉地底，低頻迴盪
};

/**
 * 地圖 → 曲目對映表。
 * 鍵優先用 mapGroupId（整組共用，樓層子圖自動跟隨母圖）；
 * 需要為單張地圖（如某個關卡房間）指定不同曲目時，才用 mapId 精確覆蓋。
 * 未列出的地圖回退 {@link DEFAULT_MAP_BGM_TRACK}。
 */
export const MAP_BGM_ASSIGNMENTS: Readonly<Record<string, string>> = {
  // ── 城鎮／安全區 ──────────────────────────────────────────────
  yunlai_town: 'yunlai_town', // 雲來鎮
  yunlai_town_inn_2f: 'yunlai_town', // 雲來鎮·沈記腳店二樓（樓層，跟隨母圖）
  yunlai_town_south_gate_tower_2f: 'yunlai_town', // 雲來鎮·南門門樓二層（樓層，跟隨母圖）
  yunlai_town_apothecary_cellar: 'yunlai_town', // 雲來鎮·蘭氏藥鋪地窖（樓層，跟隨母圖）
  yunlai_town_lake_bottom_grotto: 'yunlai_town', // 雲來鎮·湖底洞天（樓層，跟隨母圖）
  yunlai_town_old_shrine_crypt: 'yunlai_town', // 雲來鎮·舊祠暗室（樓層，跟隨母圖）
  yunlai_town_ore_basement: 'yunlai_town', // 雲來鎮·舊屋礦窖（樓層，跟隨母圖）
  qizhen_crossing: 'qizhen_crossing', // 棲真渡：練氣主城
  yunxu_terrace: 'yunxu_terrace', // 雲墟臺：築基雲海石臺
  prison: 'prison', // 監牢：空曠囚場

  // ── 新手野外（lv1~11）────────────────────────────────────────
  wildlands: 'wildlands', // 荒野
  wildlands_gale_den: 'wildlands', // 荒野·荒骨風穴（關卡子圖，跟隨母圖）
  bamboo_forest: 'bamboo_forest', // 青竹林
  bamboo_forest_mantis_court: 'bamboo_forest', // 青竹林·青螂巢庭（關卡子圖，跟隨母圖）
  black_iron_mine: 'black_iron_mine', // 玄鐵礦洞
  black_iron_mine_molten_heart: 'black_iron_mine', // 玄鐵礦洞·玄脈熔心（關卡子圖，跟隨母圖）
  ancient_ruins: 'ancient_ruins', // 斷碑遺蹟
  ancient_ruins_monument_hall: 'ancient_ruins', // 斷碑遺蹟·斷碑主殿（關卡子圖，跟隨母圖）

  // ── 中期野外（lv10~18）───────────────────────────────────────
  beast_valley: 'beast_valley', // 噬魂獸谷
  beast_valley_blood_altar: 'beast_valley', // 噬魂獸谷·血祭壇（關卡子圖，跟隨母圖）
  spirit_ridge: 'spirit_ridge', // 靈脊嶺
  spirit_ridge_old_gate: 'spirit_ridge', // 靈脊嶺·懸門舊關（關卡子圖，跟隨母圖）
  sky_ruins: 'sky_ruins', // 天穹殘宮
  sky_ruins_core_well: 'sky_ruins', // 天穹殘宮·封天核心井（關卡子圖，跟隨母圖）

  // ── 五行圖＋練氣終圖（lv19~43）──────────────────────────────
  cleft_blade_plain: 'cleft_blade_plain', // 裂鋒原（金）
  cold_tide_marsh: 'cold_tide_marsh', // 寒汐澤（水）
  deepvein_ridge: 'deepvein_ridge', // 厚脈嶺（土）
  emberfall_court: 'emberfall_court', // 赤隕庭（火）
  guizang_vein_cavern: 'guizang_vein_cavern', // 歸藏脈窟（練氣終圖）
  ruined_cavern_manor: 'guizang_vein_cavern', // 破敗洞府（歸藏陣核旁子圖，跟隨母圖）

  // ── 築基期（lv30+）───────────────────────────────────────────
  heaven_ladder: 'heaven_ladder', // 天梯：半步築基關
  frostblade_abyss: 'frostblade_abyss', // 霜刃淵：冰鐵深淵
  blazewood_waste: 'blazewood_waste', // 焚木荒臺：焦灼荒原
  darksoil_abyss: 'darksoil_abyss', // 玄壤深淵：地脈洞穴
};

/** 解析曲目 key 對應的完整資源地址；未註冊的 key 回退預設曲目。 */
export function resolveMapBgmSrc(trackKey: string | undefined | null): string {
  const key = typeof trackKey === 'string' && trackKey.trim() ? trackKey.trim() : DEFAULT_MAP_BGM_TRACK;
  const file = MAP_BGM_TRACKS[key] ?? MAP_BGM_TRACKS[DEFAULT_MAP_BGM_TRACK];
  return `${MAP_BGM_BASE_PATH}${file ?? 'gameBGM-01.mp3'}`;
}

/** 預設曲目的完整資源地址（播放器載入失敗回退用）。 */
export function resolveDefaultMapBgmSrc(): string {
  return resolveMapBgmSrc(DEFAULT_MAP_BGM_TRACK);
}

/** 按地圖解析當前應播放的曲目資源地址：mapId 精確 → mapGroupId 整組 → 預設。 */
export function resolveMapBgmSrcForMap(mapId: string | undefined | null, mapGroupId?: string | null): string {
  const id = typeof mapId === 'string' ? mapId.trim() : '';
  const groupId = typeof mapGroupId === 'string' ? mapGroupId.trim() : '';
  const trackKey = MAP_BGM_ASSIGNMENTS[id] ?? MAP_BGM_ASSIGNMENTS[groupId];
  return resolveMapBgmSrc(trackKey);
}
