/**
 * 每地圖 BGM 配置表（純客戶端表現層配置，不參與協議）。
 *
 * 配置方式：
 * 1. 把新的 BGM 檔案放進 `packages/client/public/bgm/`（僅 mp3，檔名建議全小寫連字號）。
 * 2. 在 {@link MAP_BGM_TRACKS} 註冊曲目 key → 檔名。
 * 3. 在 {@link MAP_BGM_ASSIGNMENTS} 把 mapId（精確）或 mapGroupId（整組）指到該 key。
 *
 * 查找順序：`MAP_BGM_ASSIGNMENTS[mapId]` → `MAP_BGM_ASSIGNMENTS[mapGroupId]` → `DEFAULT_MAP_BGM_TRACK`。
 *
 * 樓層歸組約定：「有樓層的都算同一張」——樓層／室內子圖不單獨配置時，
 * 依靠 mapGroupId 與母圖共用同一首（例：雲來鎮全組 mapGroupId=yunlai_town）。
 * 關卡型子圖（mapGroupId 為自身的）已在下方顯式指向母圖曲目，維持同一首不中斷。
 */

/** BGM 檔案根路徑（Vite public 目錄，部署後由 nginx 靜態伺服）。 */
export const MAP_BGM_BASE_PATH = '/bgm/';

/** 預設曲目 key：未命中任何配置時使用（同時也是登入畫面等無地圖場景的曲目）。 */
export const DEFAULT_MAP_BGM_TRACK = 'gameBGM-01';

/**
 * BGM 曲目庫：key → `public/bgm/` 下的檔名。
 * 新增曲目時在這裡註冊，key 命名建議按「場域風格」（如 town / wildlands / fire）。
 */
export const MAP_BGM_TRACKS: Readonly<Record<string, string>> = {
  'gameBGM-01': 'gameBGM-01.mp3',
  // 範例（放入檔案後取消註解即可啟用）：
  // town: 'town.mp3',             // 城鎮：寧靜古箏／笛
  // wildlands: 'wildlands.mp3',   // 荒野：開闊荒涼
  // fire: 'fire.mp3',             // 火行圖：熾烈鼓點
};

/**
 * 地圖 → 曲目對映表。
 * 鍵優先用 mapGroupId（整組共用，樓層子圖自動跟隨母圖）；
 * 需要為單張地圖（如某個關卡房間）指定不同曲目時，才用 mapId 精確覆蓋。
 * 未列出的地圖回退 {@link DEFAULT_MAP_BGM_TRACK}。
 */
export const MAP_BGM_ASSIGNMENTS: Readonly<Record<string, string>> = {
  // ── 城鎮／安全區 ──────────────────────────────────────────────
  yunlai_town: 'gameBGM-01', // 雲來鎮（整組：含腳店二樓、南門門樓二層、藥鋪地窖、湖底洞天、舊祠暗室、舊屋礦窖）
  qizhen_crossing: 'gameBGM-01', // 棲真渡：練氣主城，熱鬧市井
  yunxu_terrace: 'gameBGM-01', // 雲墟臺：築基雲海石臺，空靈超脫
  prison: 'gameBGM-01', // 監牢：空曠囚場，單調壓抑

  // ── 新手野外（lv1~11）────────────────────────────────────────
  wildlands: 'gameBGM-01', // 荒野（整組：含荒骨風穴）
  wildlands_gale_den: 'gameBGM-01', // 荒野·荒骨風穴（關卡子圖，跟隨母圖）
  bamboo_forest: 'gameBGM-01', // 青竹林（整組：含青螂巢庭）
  bamboo_forest_mantis_court: 'gameBGM-01', // 青竹林·青螂巢庭（關卡子圖，跟隨母圖）
  black_iron_mine: 'gameBGM-01', // 玄鐵礦洞（整組：含玄脈熔心）
  black_iron_mine_molten_heart: 'gameBGM-01', // 玄鐵礦洞·玄脈熔心（關卡子圖，跟隨母圖）
  ancient_ruins: 'gameBGM-01', // 斷碑遺蹟（整組：含斷碑主殿）
  ancient_ruins_monument_hall: 'gameBGM-01', // 斷碑遺蹟·斷碑主殿（關卡子圖，跟隨母圖）

  // ── 中期野外（lv10~18）───────────────────────────────────────
  beast_valley: 'gameBGM-01', // 噬魂獸谷（整組：含血祭壇）
  beast_valley_blood_altar: 'gameBGM-01', // 噬魂獸谷·血祭壇（關卡子圖，跟隨母圖）
  spirit_ridge: 'gameBGM-01', // 靈脊嶺（整組：含懸門舊關）
  spirit_ridge_old_gate: 'gameBGM-01', // 靈脊嶺·懸門舊關（關卡子圖，跟隨母圖）
  sky_ruins: 'gameBGM-01', // 天穹殘宮（整組：含封天核心井）
  sky_ruins_core_well: 'gameBGM-01', // 天穹殘宮·封天核心井（關卡子圖，跟隨母圖）

  // ── 五行圖＋練氣終圖（lv19~43）──────────────────────────────
  cleft_blade_plain: 'gameBGM-01', // 裂鋒原（金）
  cold_tide_marsh: 'gameBGM-01', // 寒汐澤（水）
  deepvein_ridge: 'gameBGM-01', // 厚脈嶺（土）
  emberfall_court: 'gameBGM-01', // 赤隕庭（火）
  guizang_vein_cavern: 'gameBGM-01', // 歸藏脈窟（練氣終圖）
  ruined_cavern_manor: 'gameBGM-01', // 破敗洞府（歸藏陣核旁子圖，跟隨母圖）

  // ── 築基期（lv30+）───────────────────────────────────────────
  heaven_ladder: 'gameBGM-01', // 天梯：半步築基關
  frostblade_abyss: 'gameBGM-01', // 霜刃淵：冰鐵深淵
  blazewood_waste: 'gameBGM-01', // 焚木荒臺：焦灼荒原
  darksoil_abyss: 'gameBGM-01', // 玄壤深淵：地脈洞穴
};

/** 解析曲目 key 對應的完整資源地址；未註冊的 key 回退預設曲目。 */
export function resolveMapBgmSrc(trackKey: string | undefined | null): string {
  const key = typeof trackKey === 'string' && trackKey.trim() ? trackKey.trim() : DEFAULT_MAP_BGM_TRACK;
  const file = MAP_BGM_TRACKS[key] ?? MAP_BGM_TRACKS[DEFAULT_MAP_BGM_TRACK];
  return `${MAP_BGM_BASE_PATH}${file ?? 'gameBGM-01.mp3'}`;
}

/** 按地圖解析當前應播放的曲目資源地址：mapId 精確 → mapGroupId 整組 → 預設。 */
export function resolveMapBgmSrcForMap(mapId: string | undefined | null, mapGroupId?: string | null): string {
  const id = typeof mapId === 'string' ? mapId.trim() : '';
  const groupId = typeof mapGroupId === 'string' ? mapGroupId.trim() : '';
  const trackKey = MAP_BGM_ASSIGNMENTS[id] ?? MAP_BGM_ASSIGNMENTS[groupId];
  return resolveMapBgmSrc(trackKey);
}
