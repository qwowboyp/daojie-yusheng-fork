/** 後期地圖的離線建置：分層地形、可回返路網、城鎮與野外分區。 */
const palettes = [
  { ground: '地', accent: '熔', edge: '丘', tint: '#a65a38' },
  { ground: '泥', accent: '水', edge: '水', tint: '#487d91' },
  { ground: '草', accent: '崖', edge: '崖', tint: '#8492b3' },
  { ground: '霞', accent: '空', edge: '空', tint: '#7666a3' },
  { ground: '地', accent: '沼', edge: '丘', tint: '#898d72' },
  { ground: '地', accent: '崖', edge: '崖', tint: '#92799d' },
  { ground: '地', accent: '熔', edge: '空', tint: '#bc9560' },
];
const grid = (w, h, char) => Array.from({ length: h }, () => Array(w).fill(char));
const point = (x, y) => ({ x, y });

function baseMap(info, realmIndex, order, town = false) {
  const width = town ? 48 : 64;
  const height = town ? 40 : 48;
  const palette = palettes[realmIndex];
  const map = {
    format: 2, id: info.id, name: info.name,
    mapGroupId: info.id, mapGroupName: info.name,
    mapGroupOrder: 1100 + realmIndex * 100 + order,
    mapGroupMemberOrder: 0, width, height, routeDomain: 'system',
    mapLv: info.startLevel, spaceVisionMode: 'isolated', description: info.description,
    terrain: grid(width, height, palette.ground),
    structure: grid(width, height, '.'), surface: grid(width, height, '.'),
    spawnPoint: point(5, Math.floor(height / 2)), portals: [],
    monsterSpawns: [], landmarks: [], npcs: [],
    time: { offsetTicks: realmIndex * 80, scale: 1,
      light: { base: town ? 75 : 48, timeInfluence: town ? 15 : 22 },
      palette: { dusk: { tint: palette.tint, alpha: 0.12 }, night: { tint: '#101526', alpha: 0.24 } } },
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) {
      map.terrain[y][x] = palette.edge;
      map.structure[y][x] = '石';
    }
  }
  return map;
}

function clear(map, x, y, radius = 0, surface = '径') {
  for (let yy = y - radius; yy <= y + radius; yy++) for (let xx = x - radius; xx <= x + radius; xx++) {
    if (xx < 2 || yy < 2 || xx >= map.width - 2 || yy >= map.height - 2) continue;
    map.terrain[yy][xx] = '地'; map.structure[yy][xx] = '.'; map.surface[yy][xx] = surface;
  }
}

function path(map, a, b, surface = '径', radius = 1) {
  let { x, y } = a;
  while (x !== b.x || y !== b.y) {
    clear(map, x, y, radius, surface);
    if (x !== b.x) x += Math.sign(b.x - x);
    else y += Math.sign(b.y - y);
  }
  clear(map, x, y, radius, surface);
}

function portal(map, p, target, q, oneWay = false) {
  clear(map, p.x, p.y, 1, '板');
  const record = { id: `${map.id}:${p.x},${p.y}`, ...p,
    direction: oneWay ? 'one_way' : 'two_way', targetMapId: target.id,
    targetX: q.x, targetY: q.y, kind: 'portal', trigger: 'manual',
    routeDomain: 'inherit', allowPlayerOverlap: false, hidden: false,
    observeTitle: `前往${target.name}`,
    observeDesc: `通往${target.name}的道路。${target.mapLv ? `建議境界等級 ${target.mapLv}。` : ''}` };
  if (!oneWay) record.targetPortalId = `${target.id}:${q.x},${q.y}`;
  map.portals.push(record);
}

function connect(a, p, b, q) { portal(a, p, b, q); portal(b, q, a, p); }

function townMap(realm, realmIndex, shops, itemsById) {
  const info = { ...realm.town, startLevel: realm.startLevel };
  const map = baseMap(info, realmIndex, 0, true);
  path(map, point(4, 20), point(43, 20), '路');
  path(map, point(24, 4), point(24, 35), '路');
  clear(map, 24, 20, 5, '板');
  // 八處沿街院落；開口向中央道路，NPC 留在門前可互動的位置。
  const seats = [[10, 10], [22, 10], [36, 10], [10, 29], [22, 29], [36, 29], [8, 20], [39, 20]];
  realm.town.npcs.forEach((npc, i) => {
    const [x, y] = seats[i % seats.length];
    if (i < 6) {
      for (let yy = y - 3; yy <= y + 2; yy++) for (let xx = x - 3; xx <= x + 3; xx++) {
        map.surface[yy][xx] = '板';
        map.structure[yy][xx] = yy === y - 3 || xx === x - 3 || xx === x + 3 ? '墙' : '.';
      }
    }
    path(map, point(x, y), point(x, 20), '路', 0);
    map.npcs.push({ id: npc.id, name: npc.name, x, y, char: npc.name.includes('·') ? npc.name.split('·').at(-1)[0] : npc.name[0],
      color: palettes[realmIndex].tint, dialogue: npc.dialogue, role: 'guide',
      shopItems: [], quests: [] });
    map.landmarks.push({ id: `${npc.id}_residence`, name: npc.role || npc.name, x: x + 1, y,
      desc: npc.description });
  });
  // 商店由遭遇/配方模組提供真實物品及價格，不宣稱尚未接入的倉庫等機能。
  const listings = Array.isArray(shops) ? shops : Object.values(shops ?? {}).flat();
  const findVendor = (pattern, fallback) => {
    const index = realm.town.npcs.findIndex((npc) => pattern.test(`${npc.name} ${npc.role}`));
    return index < 0 ? fallback : index;
  };
  const smith = findVendor(/爐工|修貝匠|老階匠|修舟匠|折鏡匠|補風匠|造舟匠/, 3);
  const trader = findVendor(/掌櫃|攤主|牙人|收風人/, smith);
  const healer = findVendor(/大夫|醫者|醫修|診衰人/, trader);
  for (const listing of listings) {
    const item = itemsById.get(listing.itemId);
    const index = item?.type === 'equipment' ? smith : item?.type === 'consumable' ? healer : trader;
    map.npcs[index].shopItems.push(listing);
    map.npcs[index].role = 'trader';
  }
  map.safeZones = [{ x: 24, y: 20, radius: 64 }];
  return map;
}

function fieldMap(info, realmIndex, mapIndex, encounter) {
  const map = baseMap(info, realmIndex, 10 + mapIndex);
  const palette = palettes[realmIndex];
  // 四種地貌骨架：彎曲谷道、分渠街坊、雙壁長峽、環形遺址。
  for (let y = 3; y < 45; y++) for (let x = 3; x < 61; x++) {
    const ridge = mapIndex === 0 ? Math.abs(y - (12 + Math.round(5 * Math.sin(x / 8)))) < 2
      : mapIndex === 1 ? (x % 17 < 3 && y < 38)
      : mapIndex === 2 ? ((y > 9 && y < 14) || (y > 33 && y < 38))
      : Math.abs(Math.hypot((x - 39) * 0.8, y - 24) - 15) < 2;
    if (ridge) map.terrain[y][x] = palette.accent;
    if ((x * 13 + y * 7 + realmIndex * 11) % 47 === 0) map.structure[y][x] = realmIndex === 1 ? '石' : '树';
  }
  const bend = mapIndex % 2 === 0 ? 21 : 27;
  path(map, point(4, 24), point(15, 24));
  path(map, point(15, 24), point(15, bend));
  path(map, point(15, bend), point(56, bend));
  path(map, point(56, bend), point(59, 24));
  path(map, point(9, 24), point(9, 40));
  path(map, point(9, 40), point(49, 40));
  path(map, point(49, 40), point(49, 24));
  path(map, point(9, 24), point(9, 8));
  path(map, point(9, 8), point(49, 8));
  path(map, point(49, 8), point(49, 24));
  clear(map, 5, 24, 2, '板');
  clear(map, 54, 24, 4, '板');
  const ids = encounter.monsterIds ?? [];
  const lanes = [[18, 18], [21, 32], [29, 12], [32, 35], [39, 17], [43, 31], [35, 8], [45, 40]];
  ids.forEach((id, i) => {
    const [x, y] = lanes[i % lanes.length];
    path(map, point(x, y), point(x, bend), '径', 0);
    clear(map, x, y, 2, '');
    map.monsterSpawns.push([x, y, id]);
  });
  map.monsterSpawns.push([54, 24, encounter.bossId]);
  (info.landmarks ?? []).slice(0, 5).forEach((lm, i) => {
    const x = 12 + i * 9, y = i % 2 ? 39 : 9;
    path(map, point(x, y), point(x, y < 24 ? 8 : 40), '径', 0);
    map.landmarks.push({ id: `${info.id}_landmark_${i + 1}`, name: lm.name, desc: lm.description, x, y });
  });
  map.landmarks.push({ id: `${info.id}_warning`, name: '行路告示', x: 6, y: 26,
    desc: `此地適合境界等級 ${info.startLevel} 至 ${info.startLevel + 2} 的修士。路旁可採集藥材、開採礦脈；${info.boss.name}盤踞東側深處，先備齊同境裝備與丹藥，再觀察招式預警進退。南側道路可繞行回城。` });
  // 草藥走既有採集容器，礦石留給真正的挖礦地塊設定。
  map.resourceNodeGroups = [];
  (encounter.herbNodeTemplates ?? []).forEach((node, i) => {
    const positions = [point(15 + i * 5, 7), point(16 + i * 5, 39)];
    for (const p of positions) { clear(map, p.x, p.y, 1, '.'); path(map, p, point(p.x, p.y < 24 ? 8 : 40), '径', 0); }
    map.resourceNodeGroups.push({ resourceNodeId: node.id, idPrefix: `${info.id}_herb_${i}`, name: node.name, placements: positions });
  });
  map.mineralNodes = [];
  (encounter.oreItems ?? []).forEach((item, i) => {
    const x = 15 + i * 8, y = 42;
    path(map, point(x, 40), point(x, y), '径', 0);
    clear(map, x, y, 1, '.');
    map.structure[y][x] = '铁';
    map.mineralNodes.push({ x, y, name: item.name, itemId: item.itemId,
      level: item.level, damageChanceBps: 50, destroyCount: 1 });
    map.landmarks.push({ id: `${info.id}_ore_${i}`, x, y, name: `${item.name}礦脈`, desc: item.desc });
  });
  return map;
}

export function buildLateGameMaps(catalog, encounters) {
  const maps = [];
  const itemsById = new Map((encounters.items ?? []).map((item) => [item.itemId, item]));
  const realms = catalog.realms.map((realm, r) => {
    const town = townMap(realm, r, encounters.townShops?.[realm.town.id], itemsById);
    const fields = realm.maps.map((info, m) => fieldMap(info, r, m, encounters.mapContent[info.id]));
    maps.push(town, ...fields);
    connect(town, point(4, 20), fields[0], point(9, 40));
    for (let m = 0; m < 3; m++) connect(fields[m], point(59, 24), fields[m + 1], point(4, 24));
    // 四圖末端返回坊市，跨境出口在城鎮，避免新玩家直落下一境頭目區。
    connect(fields[3], point(59, 24), town, point(43, 20));
    return { town, fields };
  });
  for (let r = 0; r < realms.length - 1; r++) connect(realms[r].town, point(24, 35), realms[r + 1].fields[0], point(4, 24));
  // 金丹起點保留回返舊區的路；故事中的單向落下改為可攀返殘階，避免玩家困圖。
  const first = realms[0].fields[0];
  const entry = { id: 'darksoil_abyss', name: '玄壤深淵', mapLv: 39 };
  portal(first, point(4, 24), entry, point(28, 50));
  const entrance = { id: 'darksoil_abyss:28,50', x: 28, y: 50, targetMapId: first.id,
    targetX: 4, targetY: 24, targetPortalId: `${first.id}:4,24`, direction: 'two_way',
    kind: 'portal', trigger: 'manual', routeDomain: 'inherit', hidden: false, allowPlayerOverlap: false,
    observeTitle: '劫火帶入口', observeDesc: '深裂口的封緘已退，殘階通往薪盡坡。前方為金丹期地域，建議境界等級 43。' };
  const end = baseMap({ id: 'lg_ascension_gate', name: '天門遺址', description: '劫雲盡處，殘存的飛昇台立在無聲天光中。七材銘碑記下歷代補天者的行跡，斷階另一端是尚未開啟的天門。修士可在此回望來路，循階返回薪火城。', startLevel: 127 }, 6, 90, true);
  path(end, point(4, 20), point(38, 20), '阶');
  clear(end, 32, 20, 5, '板');
  end.safeZones = [{ x: 24, y: 20, radius: 64 }];
  end.landmarks.push({ id: 'lg_ascension_memorial', name: '七材銘碑', x: 32, y: 18,
    desc: '七次補天的遺證刻在石上。天門另一側仍有天地。此地為終章紀念地，不產出刷取材料。' });
  connect(realms.at(-1).town, point(24, 35), end, point(4, 20));
  maps.push(end);
  return { maps, entrance, finalize: () => maps.map((map) => ({ ...map,
    terrain: map.terrain.map((row) => row.join('')),
    structure: map.structure.map((row) => row.join('')),
    surface: map.surface.map((row) => row.map((c) => c || '.').join('')),
  })) };
}
