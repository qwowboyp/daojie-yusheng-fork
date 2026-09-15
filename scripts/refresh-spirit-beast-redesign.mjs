/** 靈獸重製的名稱真源同步與 AGY 圖集匯入。保留 ID、順序、數值與融合配方。 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const grades = ['fan', 'human', 'heaven', 'saint', 'immortal'];
const reportRoot = path.join(root, '.runtime/reports/spirit-beasts-redesign-20260915/art');
const elements = ['metal', 'wood', 'water', 'fire', 'earth'];

// 次序完全對應 catalog 的 grade → element → slot；名稱是顯示資料，stable ID 不變。
const roster = {
  fan: [
    '雲鋒靈鹿|銀羽靈鷹|玄鐵背猊|星鋒九尾|鎏金靈羚|磁尾幼螭',
    '琅葉麋|青藤翼狐|芳華翼猊|翠冠靈鶴|木靈青鹿|芝雲神貘',
    '瀲光靈鯢|月潮飛玄龜|雲鰭青螭|碧渦海馬|珠霧蝶翼麟|玄波幼螭',
    '焰翎靈鶴|赤燼翼狐|火羽鸞雛|熾角狴犴|丹霞靈獬|燈魄鳳靈',
    '靈岩幼獬|山紋翼羆|坤砂靈羚|玉壤靈犀|石髓龍龜|雲嶽角猊',
  ],
  human: [
    '玄鋒獬豸|鳴金靈隼|星鎧猙獸|鎏電靈貂|斷嶽金羚|白玉貔靈',
    '青蘿靈鹿|百花九尾|建木靈猿|翠雲青鸞|森羅麒獸|藥霞靈貘',
    '寒潭靈黿|滄浪青螭|月汐長鰭鯉|琉璃海馬麟|珠泉獨角靈鯉|霧海靈鯤',
    '赤曜朱鶴|離焰九尾|丹霞火鸞|熔星狻猊|南明靈獬|燼羽鳳靈',
    '鎮嶽靈犀|厚土翼羆|坤脈麒麟|青巖獬豸|負碑靈龜|崩雲巨猿',
  ],
  heaven: [
    '太庚白虎|天鉞金鵬|萬刃猙王|星河貔貅|斬嶽金麟|靈樞應龍',
    '青帝蒼鹿|萬葉白澤|扶桑神猿|碧落青鸞|花海九色鹿|長春麒麟',
    '玄冥龍龜|滄瀾螭龍|寒月鯤鵬|天河鮫靈|雨師青麟|冰鑑應龍',
    '南離朱雀|九轉丹凰|赤霄金烏|焚天狻猊|流火畢方|燭炎天龍',
    '承天玄武|不周神羆|厚嶺陸吾|壘嶽麒麟|地脈贔屭|黃泉虯龍',
  ],
  saint: [
    '白帝虎尊|鎮界金鵬|太鋒天猙|九曜貔貅|裂空金犀|萬器祖龍',
    '神農白澤|建木青龍|萬藥仙猿|榮枯九尾|百華青鸞|玉枝祖麟',
    '覆海玄武|北溟鯤鵬|洛川應龍|雲夢鮫皇|九曲水麒麟|玄淵蒼龍',
    '太陽金烏|九曜丹凰|焚霄朱雀|赤帝狻猊|南明畢方|萬焰燭龍',
    '后土麒麟|鎮世贔屭|不周巨靈|開明神獸|九壤騰蛇|地藏諦聽',
  ],
  immortal: [
    '混元白虎|太虛金鵬|誅仙天猙|乾坤貔貅|斷界金翅鯤|萬劫應龍',
    '太初青龍|神木白澤|太古夔皇|百草九色鹿|元春青鸞|萬象祖麟',
    '滄海玄武|北冥鯤祖|銀河應龍|玄冥冰夷|天河九嬰|溯源白螭',
    '大日金烏|涅槃丹凰|丹霄鳳皇|赤霄畢方|永燼燭龍|離天狻猊',
    '九天麒麟|鎮界贔屭|崑崙陸吾|開天鎮嶽獸|太荒騰蛇|幽冥諦聽',
  ],
};
for (const [grade, lines] of Object.entries(roster)) roster[grade] = lines.flatMap((line) => line.split('|'));

const motifs = {
  metal: ['crystal antlers and silver-gold feather plates', 'a halo of small orbiting metal shards'],
  wood: ['jade leaves, luminous vine mane and flowered antlers', 'soft green spirit mist and seed-pod ornaments'],
  water: ['translucent fins, pearl scales and flowing cloud-water ribbons', 'a crescent water halo and misty tail'],
  fire: ['vermilion flame feathers, ember mane and molten crystal horns', 'a restrained flame corona confined to its silhouette'],
  earth: ['amber mineral armour, cloud-shaped hooves and layered stone horns', 'a small ring of floating earth crystals confined to its silhouette'],
};
// 高品圖集逐格手寫構圖，傳給模型時只傳外觀、不傳中文名稱或 stable ID。
const directVisuals = {
  saint: [
    'radiant platinum tiger emperor with a crown of seven crystal antlers, layered metal mane and star-ring tail', 'vast gold roc with armour-like feathers, a solar crest and six translucent comet tails', 'black celestial lion-dragon with a silver blade mane, three horns and a circular meteor halo', 'jade pixiu sovereign with split antlers, gold scale belly and a spiralling nebula tail', 'massive gold rhinoceros spirit with a floating crystal horn crown and layered scale mantle', 'long imperial metal dragon with four limbs, broad feather wings, silver whiskers and a constellation halo',
    'white bai ze with jade leaf fins, flower antlers and a green aurora mane', 'long green eastern dragon with a living-vine mane, leaf wings and luminous root whiskers', 'colossal sacred ape with bark armour, flowering antler crown and cloud sleeves from its shoulders', 'nine-tailed flower fox with petal scale tails, luminous vine ears and a green moon halo', 'emerald phoenix with large jade wings, layered blossom tail plumes and a leaf crown', 'pale jade qilin with branch horns, crystal flower mane and long cloud tail',
    'black sea turtle-dragon with a pearl mountain shell, wave fins and a star-water halo', 'enormous dark-blue whale-like celestial fish with broad fins, a full tail and moonlit pearl mist, never a dragon', 'silver eastern river dragon with four limbs, ice fins, antlers and a flowing water ring', 'aquatic fish sovereign with a full scaled tail, glass fins and a sea-crystal crown', 'blue water qilin with twin spiral horns, tide mane and a raindrop constellation halo', 'deep abyss eastern dragon with moonstone fins, white whiskers and cloud-water tail',
    'three-legged golden sun crow with colossal flame wings, a solar disk and a fan of ember tail feathers', 'vermilion alchemy phoenix with nine crystal tail plumes, a jade-red breast gem and flame halo', 'scarlet phoenix sovereign with layered wing armour, long fire tail and crown plume', 'red lion-dragon emperor with an obsidian flame mane, horn crown and molten cloud tail', 'one-legged vermilion divine bird with a blazing crest, two long tail streamers and a fire-ring halo', 'ancient candle dragon with a long crimson body, four limbs, crystal horns and spiral flame breath',
    'earth qilin sovereign with four jade horns, terraced mineral scales and cloud hooves', 'giant turtle-dragon with a carved tablet shell, amber crystal crown and serpent tail', 'towering mountain guardian with a humanlike jade mask, nine mineral tails and cliff mantle', 'four-legged stone guardian with a mountain crown, waterfall tail and layered slate wings', 'long earth serpent dragon with amber scales, crystal whiskers and floating sandstone halos', 'noble listening guardian beast with huge leaflike ears, jade antlers, stone mane and cloud paws',
  ],
  human: [
    'silver horned metal guardian beast with a chiselled jade mask, plated mane and three cloud hooves visible', 'sleek silver falcon spirit with a bronze crest, broad layered wings and long ringing tail feathers', 'iron-toothed lion-dragon with black plated shoulders, a heavy crystal dorsal fin and feline paws', 'slender gold-edged marten spirit with a forked lightning tail and translucent crystal ear fins', 'graceful gold-maned antelope qilin with spiral horns, scale shoulders and cloud hooves', 'white jade pixiu guardian with a magnetic shard mane, curled cloud tail and split horn',
    'moss-antlered deer spirit with fern chest fur, jade leaf scales and a soft green cloud tail', 'nine-tailed flower fox with separate vine-wrapped tails, blossom ears and leaf-shaped shoulder fins', 'long-armed tree ape with a hollow jadewood crown, root bracers and a flowering mane', 'emerald crane-phoenix with a crown crest, leaf feathers and two complete ribbon-like tail plumes', 'forest qilin with a woven vine mane, green crystal horn and cloven cloud hooves', 'dream tapir with a jade mask, flowered curled tail, glowing seed pods and short trunk',
    'cold spring turtle-dragon with a pearl-carved shell, four paws and a long serpent tail', 'blue-green eastern water dragon with translucent fins, antlers and a wave-shaped cloud tail', 'small moonlit fish-dragon with a full finned body, pearl scales and flowing dorsal ribbons', 'glass sea-horse spirit with a curled fish tail, fin-wings and a crystal coral crown', 'water mirror carp-qilin with a broad fish tail, spiral horn and ripple halo', 'mist-sea whale-like spirit fish with broad fins, a full fish tail and cloud-water mane, never a winged dragon',
    'vermilion fire crane with complete long legs, crystal wing feathers and two flame tail plumes', 'red winged nine-tail fox with a charcoal mane, separate glowing tails and ember ear tufts', 'small fire phoenix with a gold breast crystal, fully spread flame wings and a long fan tail', 'molten lion-dragon with obsidian horn crown, ember mane and plated paws', 'scarlet fire qilin with a faceted horn, molten scale mantle and curled flame cloud tail', 'candle-flame phoenix spirit with a crescent flame halo, long crest and six individual tail feathers',
    'mountain rhinoceros guardian with a jade crystal horn, layered cliff armour and four cloud hooves', 'broad winged sacred bear with an amber crystal mane, carved stone shoulder mantle and cloud claws', 'earth qilin with mineral antlers, sandglass tail plume and terraced scale plates', 'green-grey guardian beast with a forked stone horn, layered shale mane and a ring of soil mist', 'ancient turtle-dragon with a stone tablet shell, quartz stalactite crest and serpent tail', 'massive cliff ape with long crystal-braced arms, a cloud mane and a crown of small geodes',
  ],
  heaven: [
    'white tiger sovereign with plated silver mane, three crystal antlers and comet-metal stripes', 'golden roc with enormous swept wings, hooked beak and six long blade-feather tails', 'black-gold lion-dragon with a serrated metal carapace and a crown of floating iron petals', 'four-legged jade pixiu with a split spiral horn, star-crystal belly and cloud tail', 'golden rhinoceros qilin with a long faceted horn and mineral scale mantle', 'slender imperial yinglong with four limbs, bronze wings, silver whiskers and orbiting metal motes',
    'azure deer-dragon with bamboo antlers, leaf mane and translucent green hoof mist', 'white bai ze guardian with layered emerald leaf fins and a flowering jade crown', 'long-armed sacred ape with living-root shoulder mantle and a branch-antler crown', 'emerald blue phoenix with peacock-like tail eyes made of leaves and translucent wing tips', 'nine-colour deer qilin with petal scale mane, flowering antlers and vine tail', 'long-bodied green qilin with a canopy mane, jade bark plates and cloud hooves',
    'ancient black turtle-dragon with wave-carved shell, pearl horns and a complete serpent tail', 'sea-blue eastern dragon with fins, whiskers and a crescent of water behind its back', 'colossal whale-like celestial fish with broad moonlit fins, a full fish tail and drifting pearl bubbles, never a dragon', 'elegant aquatic mermaid-beast with a fish tail, glass fins and a crown of sea crystals', 'blue water qilin with spiral horns, flowing fin mane and a circular rain halo', 'ice-white eastern dragon with crystalline fins, four limbs and a frosted mirror halo',
    'scarlet phoenix with broad ember wings, a long fan tail and a restrained sun disk behind it', 'gold and vermilion alchemy phoenix with a glowing crystal breast and nine layered tail plumes', 'three-legged golden sun crow with flame-feather wings, circular solar halo and visible talons', 'massive flame lion-dragon with obsidian mane, molten horns and ember cloud tail', 'one-legged vermilion divine bird with a long flame crest and two curling tail banners', 'long crimson candle dragon with a glowing horn crown, four limbs and a fire-ring breath halo',
    'massive earth turtle-dragon with a mountain shell, jade soil horns and four stone paws', 'broad shouldered sacred bear with a carved cliff mantle, amber crystal mane and cloud claws', 'nine-tailed tiger guardian with a humanlike jade mask, striped mineral fur and mountain halo', 'four-legged mountain qilin with terraced stone plates, twin horns and a misty waterfall tail', 'ancient giant tortoise with a carved tablet shell, crystal stalactite mane and serpent tail', 'yellow earth dragon with a long scaled body, mineral whiskers, four limbs and floating sandstone rings',
  ],
};
function formFor(name) {
  if (/(龍|螭|虯|應龍|騰蛇|冰夷)/.test(name)) return 'long four-limbed celestial dragon with branching antlers, whiskers and a coiling cloud tail';
  if (/(龜|玄武|贔屭|黿)/.test(name)) return 'broad ancient turtle-dragon with a sculpted shell, serpent tail and four clawed limbs';
  if (/(鷹|隼|鵬|鸞|鶴|雀|凰|烏|鳳|畢方)/.test(name)) return 'full-bodied celestial bird with a distinct beak, two wings, visible talons and layered tail plumes';
  if (/(狐|九尾)/.test(name)) return 'slender nine-tailed fox spirit with pointed ears, graceful paws and several fully separated cloud tails';
  if (/(鹿|麋|羚)/.test(name)) return 'elegant four-legged deer spirit with branching antlers, cloud hooves and a long mane';
  if (/(猊|獅|狴犴)/.test(name)) return 'muscular lion-dragon chimera with a mane, horn crown, scaled shoulders and feline paws';
  if (/(貂)/.test(name)) return 'long-bodied marten spirit with a crystalline crest, swift paws and a forked plume tail';
  if (/(貘)/.test(name)) return 'round-bodied dream tapir spirit with a short trunk, curled cloud tail and jade mask markings';
  if (/(鯤)/.test(name)) return 'enormous whale-like celestial fish with broad fins, a complete fish tail, pearl scales and cloud-water ribbons; never a dragon or winged lizard';
  if (/(鯢|鰩|海馬|鮫)/.test(name)) return 'mythic aquatic spirit with fin-wings, pearl scales and a complete fishlike body; never a western dragon';
  if (/(熊|羆)/.test(name)) return 'towering bear spirit with a crystal shoulder mantle, engraved foreclaws and a cloud mane';
  if (/(猿|夔)/.test(name)) return 'ancient ape or ox spirit with long arms, stone-gold bracers and a crown of antler branches';
  if (/(犀)/.test(name)) return 'powerful rhinoceros spirit with a faceted crystal horn, plated hide and cloud-hooves';
  if (/(麒麟|麟)/.test(name)) return 'deer-bodied qilin with a single branching horn, scale mane, cloven cloud-hooves and long tail';
  if (/(白澤|貔貅|獬豸|陸吾|諦聽|神獸)/.test(name)) return 'distinct noble mythic guardian beast with multiple horns, scaled mane, cloud paws and a ceremonial tail';
  return 'distinct four-legged mythology spirit beast with a horn crown, scale mane, cloud hooves and a full silhouette';
}
function auraFor(name, grade, element) {
  const variants = [
    'a spiralling cloud-tail that grows from the body', 'a crescent of translucent elemental light behind the shoulders',
    'two short crystalline feather streamers woven into the mane', 'an organic ring of floating leaves, scales or feathers close to the silhouette',
    'a compact star-mist halo formed from its own elemental breath', 'a layered aurora plume that follows the tail',
    'a crown of tiny naturally-grown crystals between the horns', 'a flowing mantle of elemental mist around the paws or talons',
    'a double arc of subtle constellation light closely following the body', 'a bloom of elemental petals or scales spreading from the back',
  ];
  const index = [...name].reduce((sum, character) => sum + character.codePointAt(0), 0) % variants.length;
  const scale = grade === 'fan' ? 'delicate' : grade === 'human' ? 'ornate' : grade === 'heaven' ? 'radiant' : grade === 'saint' ? 'majestic' : 'vast sovereign';
  return `${scale} ${variants[index]}, with no weapon, tool, plaque, tag or readable glyph`;
}
function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value, 'utf8'); }
function redesign() {
  const files = [
    path.join(root, 'packages/server/data/content/spirit-beasts/catalog.json'),
    path.join(root, 'docs/design/spirit-beasts/catalog.json'),
  ];
  const previous = new Map();
  for (const file of files) {
    const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (catalog.species.length !== 150) throw new Error(`${file} 靈獸數量不是 150`);
    for (const entry of catalog.species) {
      const index = elements.indexOf(entry.element) * 6 + entry.slot;
      const name = roster[entry.grade][index];
      if (!name) throw new Error(`未找到名稱：${entry.id}`);
      previous.set(entry.name, name);
      entry.name = name;
      if ('appearanceBrief' in entry) {
        const tier = entry.grade === 'fan' ? 'young but distinctly immortal' : entry.grade === 'human' ? 'elegant spirit beast' : entry.grade === 'heaven' ? 'majestic heavenly beast' : entry.grade === 'saint' ? 'radiant saint beast' : 'transcendent immortal sovereign';
        entry.appearanceBrief = `${tier}; ${formFor(name)}; ${motifs[entry.element][0]}; ${motifs[entry.element][1]}; ${auraFor(name, entry.grade, entry.element)}; full silhouette, never an ordinary animal or insect.`;
      }
    }
    if (new Set(catalog.species.map((entry) => entry.name)).size !== 150) throw new Error(`${file} 含重複靈獸名稱`);
    write(file, JSON.stringify(catalog, null, 2) + '\n');
  }
  for (const relative of ['docs/design/spirit-beasts/catalog.md', 'docs/design/spirit-beasts/fusion-recipes.csv']) {
    const file = path.join(root, relative); let text = fs.readFileSync(file, 'utf8');
    for (const [oldName, newName] of previous) text = text.replaceAll(oldName, newName);
    write(file, text);
  }
  console.log(JSON.stringify({ redesignedNames: previous.size, files: 4 }));
}
function prepare(grade) {
  if (!grades.includes(grade)) throw new Error(`未知品級 ${grade}`);
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'docs/design/spirit-beasts/catalog.json'), 'utf8'));
  const beasts = catalog.species.filter((entry) => entry.grade === grade);
  if (beasts.length !== 30) throw new Error(`${grade} 不是 30 種`);
  const dir = path.join(reportRoot, `species-${grade}`); fs.mkdirSync(dir, { recursive: true });
  const placement = beasts.map((entry, index) => {
    const [motif, aura] = motifs[entry.element];
    const detailed = directVisuals[grade]?.[index];
    return `row ${Math.floor(index / 6) + 1} column ${index % 6 + 1}: ${detailed ?? `${formFor(entry.name)}, ${motif}, ${aura}, ${auraFor(entry.name, grade, entry.element)}`}`;
  }).join('\n');
  const tier = grade === 'fan' ? 'delicate but unmistakably immortal, modest glow' : grade === 'human' ? 'ornate spiritual regalia' : grade === 'heaven' ? 'large luminous horns and celestial cloud ribbons' : grade === 'saint' ? 'premium detailed fantasy RPG art: radiant celestial apparitions, luminous filigree scales, layered translucent aura, ornate divine halo, crystalline feather and cloud-tail details, visibly far more magnificent than heaven grade' : 'supreme immortal grandeur in premium detailed fantasy RPG art: vast radiant celestial apparitions, intricate luminous filigree scales, multiple layered translucent auras, ornate divine halos, crystalline wings, cloud tail and constellation crown, visibly the most magnificent grade';
  const generatedVisual = `Generate only production game artwork: exactly thirty completely distinct xianxia spirit beasts arranged in six columns and five rows using INVISIBLE placement regions on a completely flat uniform #ff00ff magenta background. Pure cutout asset collection, never a catalogue, table, sheet, card, or infographic. Every creature must follow its assigned description and have a unique mythology silhouette; no ordinary real-world mammals, birds, reptiles or insects, no recolours, and no repeated body plan. ${tier}. Cohesive polished hand-painted xianxia game art, three-quarter view facing right, full body. Each complete subject, including all glow, horns, tails, wings and accessories, fits inside the central 60 percent of its placement region with empty #ff00ff margins; no overlap or cropping. No ground, pedestal, cast shadow, text, letters, Chinese characters, numbers, labels, captions, titles, signatures, watermarks, grid lines, separators, borders, frames, cards or panels. Do not render a checkerboard. The whole background must be exact RGB #ff00ff with no texture, gradient, reflection or other marks. Original mythology-inspired designs only; do not copy an existing franchise.\n\n${placement}`;
  const approvedPrompt = path.join(root, 'docs/artwork/prompts/spirit-beasts-v2', `${grade}.txt`);
  const visual = fs.existsSync(approvedPrompt) ? fs.readFileSync(approvedPrompt, 'utf8') : generatedVisual;
  const output = path.join(dir, `spirit-beasts-${grade}-raw.png`);
  const command = `Use the image-generation capability exactly once for the visual prompt below. Save the actual generated PNG to ${output}. Request native 3072 x 2560 pixels, or the highest native resolution the tool supports; never upscale a smaller image and report the actual native dimensions. This instruction and output path must not appear in the image. Report whether the image has alpha; this task deliberately requires a flat #ff00ff background for local chroma-key removal.\n\nVISUAL PROMPT:\n${visual}`;
  write(path.join(dir, 'prompt.txt'), command);
  write(path.join(dir, 'prompt.sha256'), `${crypto.createHash('sha256').update(command).digest('hex')}\n`);
  write(path.join(dir, 'roster.json'), JSON.stringify({ grade, columns: 6, rows: 5, items: beasts.map((entry, index) => ({ id: entry.id, name: entry.name, element: entry.element, cell: { col: index % 6, row: Math.floor(index / 6) } })) }, null, 2) + '\n');
  console.log(JSON.stringify({ grade, prompt: path.relative(root, path.join(dir, 'prompt.txt')), output: path.relative(root, output), count: beasts.length }));
}
function magenta(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  if (max < 80 || delta / max < .22) return false;
  const hue = (max === r ? ((g-b)/delta+6)%6 : max === g ? (b-r)/delta+2 : (r-g)/delta+4) * 60;
  return hue >= 265 && hue <= 335;
}
// 九色鹿的粉紫鱗片與色鍵同色相，依本批實圖改以高亮背景判定，保留完整頸部。
function brightMagenta(r, g, b) { return r >= 220 && b >= 220 && r - g >= 40 && b - g >= 40; }

function components(pixels, width, height) {
  const seen = new Uint8Array(width * height), found = [];
  for (let start = 0; start < seen.length; start += 1) {
    if (seen[start] || pixels[start * 4 + 3] < 32) continue;
    const queue = [start]; seen[start] = 1; let area = 0; let left = width; let right = 0; let top = height; let bottom = 0;
    for (let index = 0; index < queue.length; index += 1) { const point = queue[index], x = point % width, y = Math.floor(point / width); area += 1; left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) { if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue; const next = ny * width + nx; if (!seen[next] && pixels[next * 4 + 3] >= 32) { seen[next] = 1; queue.push(next); } }
    }
    found.push({ queue, area, left, right, top, bottom });
  }
  return found.sort((a, b) => b.area - a.area);
}
function distance(a, b) { return Math.max(0, a.left - b.right - 1, b.left - a.right - 1, a.top - b.bottom - 1, b.top - a.bottom - 1); }
async function crop(grade) {
  const bundled = process.env.CODEX_BUNDLED_NODE_MODULES;
  const sharp = bundled ? require(path.join(bundled, 'sharp')) : require('sharp');
  const dir = path.join(reportRoot, `species-${grade}`); const source = path.join(dir, `spirit-beasts-${grade}-raw.png`); const data = JSON.parse(fs.readFileSync(path.join(dir, 'roster.json'), 'utf8')); const meta = await sharp(source).metadata();
  if (!meta.width || !meta.height || meta.width < 600 || meta.height < 500) throw new Error(`圖集尺寸過小：${meta.width}x${meta.height}`);
  const records = []; const outDir = path.join(root, 'packages/client/public/assets/spirit-beasts/species'); fs.mkdirSync(outDir, { recursive: true });
  for (const item of data.items) {
    const left = Math.round(item.cell.col * meta.width / 6), top = Math.round(item.cell.row * meta.height / 5);
    const width = Math.round((item.cell.col + 1) * meta.width / 6) - left, height = Math.round((item.cell.row + 1) * meta.height / 5) - top;
    const pixels = await sharp(source).extract({ left, top, width, height }).ensureAlpha().raw().toBuffer();
    const preservePink = item.id === 'spirit_beast.heaven.wood.05';
    for (let p = 0; p < pixels.length; p += 4) {
      const y = Math.floor(p / 4 / width);
      const inCaptionGutter = preservePink && (y < Math.round(height * .045) || y >= Math.round(height * .928));
      if (inCaptionGutter || (preservePink ? brightMagenta : magenta)(pixels[p], pixels[p+1], pixels[p+2])) pixels[p+3] = 0;
    }
    const parts = components(pixels, width, height); const primary = parts[0];
    if (!primary || primary.area < 200) throw new Error(`${item.id} 的有效輪廓不足`);
    // 模型字標可能緊鄰法相而被距離規則誤保留；正式圖優先完整主獸角、翼、尾，移除所有分離字群與碎片。
    const kept = [primary]; const mask = new Uint8Array(width * height);
    for (const part of kept) for (const point of part.queue) mask[point] = 1;
    for (let point = 0; point < mask.length; point += 1) {
      const offset = point * 4;
      if (!mask[point]) { pixels.fill(0, offset, offset + 4); continue; }
      const x = point % width, y = Math.floor(point / width);
      const boundary = x === 0 || y === 0 || x === width - 1 || y === height - 1
        || !mask[point - 1] || !mask[point + 1] || !mask[point - width] || !mask[point + width];
      // 只校正輪廓最外一圈的洋紅溢色，獸體內的粉紫鱗片維持原色。
      if (boundary && pixels[offset] - pixels[offset + 1] > 40 && pixels[offset + 2] - pixels[offset + 1] > 40) {
        pixels[offset] = Math.min(pixels[offset], pixels[offset + 1] + 35);
        pixels[offset + 2] = Math.min(pixels[offset + 2], pixels[offset + 1] + 35);
      }
    }
    const leftCrop = Math.max(0, Math.min(...kept.map((part) => part.left)) - 6), topCrop = Math.max(0, Math.min(...kept.map((part) => part.top)) - 6);
    const rightCrop = Math.min(width - 1, Math.max(...kept.map((part) => part.right)) + 6), bottomCrop = Math.min(height - 1, Math.max(...kept.map((part) => part.bottom)) + 6);
    const opaque = kept.reduce((sum, part) => sum + part.area, 0);
    const input = sharp(pixels, { raw: { width, height, channels: 4 } }).extract({ left: leftCrop, top: topCrop, width: rightCrop - leftCrop + 1, height: bottomCrop - topCrop + 1 }); const outputs = [];
    for (const size of [96, 192]) { const target = path.join(outDir, `${item.id}-${size}.webp`); await input.clone().resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 94, alphaQuality: 100 }).toFile(target); outputs.push({ size, path: path.relative(root, target).replaceAll('\\', '/'), sha256: sha(target), bytes: fs.statSync(target).size }); }
    records.push({ ...item, source: path.relative(root, source).replaceAll('\\', '/'), extraction: { method: 'magenta-chroma-key-primary-silhouette', alphaKey: '#ff00ff', keyMode: preservePink ? 'bright-magenta-with-caption-gutters' : 'magenta-hue', edgeDespill: 'outer-one-pixel-only', sourceCell: { left, top, width, height }, primaryComponent: { area: primary.area, left: primary.left, top: primary.top, width: primary.right - primary.left + 1, height: primary.bottom - primary.top + 1 }, keptComponentCount: kept.length, removedComponentCount: parts.length - kept.length, extraction: { left: leftCrop, top: topCrop, width: rightCrop - leftCrop + 1, height: bottomCrop - topCrop + 1 }, opaquePixels: opaque }, outputs });
  }
  const finalPrompt = path.join(dir, 'prompt-final.txt');
  const manifest = { id: `spirit-beasts-${grade}-01`, grade, sourceSha256: sha(source), promptSource: path.relative(root, fs.existsSync(finalPrompt) ? finalPrompt : path.join(dir, 'prompt.txt')).replaceAll('\\', '/'), nativeDimensions: [meta.width, meta.height], records };
  const serialized = JSON.stringify(manifest, null, 2) + '\n'; write(path.join(dir, 'art-manifest.json'), serialized); write(path.join(root, 'docs/artwork/atlases', `spirit-beasts-${grade}-01.json`), serialized);
  console.log(JSON.stringify({ grade, cropped: records.length, dimensions: [meta.width, meta.height], manifest: `docs/artwork/atlases/spirit-beasts-${grade}-01.json` }));
}
async function contact() {
  const bundled = process.env.CODEX_BUNDLED_NODE_MODULES; const sharp = bundled ? require(path.join(bundled, 'sharp')) : require('sharp');
  const entries = grades.flatMap((grade) => JSON.parse(fs.readFileSync(path.join(root, 'docs/artwork/atlases', `spirit-beasts-${grade}-01.json`), 'utf8')).records);
  if (entries.length !== 150) throw new Error(`聯絡圖需要 150 格，實得 ${entries.length}`);
  const size = 96, cols = 15; const output = path.join(reportRoot, 'spirit-beasts-redesign-contact-sheet.png');
  await sharp({ create: { width: cols * size, height: Math.ceil(entries.length / cols) * size, channels: 4, background: { r: 18, g: 26, b: 42, alpha: 1 } } })
    .composite(entries.map((entry, index) => ({ input: path.join(root, entry.outputs.find((output) => output.size === 96).path), left: index % cols * size, top: Math.floor(index / cols) * size }))).png().toFile(output);
  console.log(JSON.stringify({ contactSheet: path.relative(root, output), records: entries.length, sha256: sha(output) }));
}
// 由 285d04618 的兩個 catalog 移除 name/appearanceBrief 後，以 JSON.stringify 得出的 canonical SHA-256。
// archive runner 無 .git，故 proof 只比較這組已追蹤的 immutable 值；本機可用 git show 285d04618 復核來源。
const BASELINE_CANONICAL_SHA256 = {
  'packages/server/data/content/spirit-beasts/catalog.json': 'c24a1781f4f2158bfbfd0886c1f897cd453a7b5fdff569c72b4361dc109f50e1',
  'docs/design/spirit-beasts/catalog.json': '19bc925c848820ca9ec29985ff430be50ac04d6886ac6cb5af5a9cd96231243a',
};
function withoutNames(catalog) { return { ...catalog, species: catalog.species.map(({ name, appearanceBrief, ...entry }) => entry) }; }
async function verify() {
  const bundled = process.env.CODEX_BUNDLED_NODE_MODULES; const sharp = bundled ? require(path.join(bundled, 'sharp')) : require('sharp');
  const checks = [];
  for (const relative of ['packages/server/data/content/spirit-beasts/catalog.json', 'docs/design/spirit-beasts/catalog.json']) {
    const current = JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
    const canonicalHash = crypto.createHash('sha256').update(JSON.stringify(withoutNames(current))).digest('hex');
    if (canonicalHash !== BASELINE_CANONICAL_SHA256[relative]) throw new Error(`${relative} 出現名稱/美術描述外的資料變更`);
    if (new Set(current.species.map((entry) => entry.id)).size !== 150 || new Set(current.species.map((entry) => entry.name)).size !== 150) throw new Error(`${relative} ID 或名稱不唯一`);
    checks.push({ relative, species: current.species.length, nonNameFieldsEqualHead: true });
  }
  const species = JSON.parse(fs.readFileSync(path.join(root, 'packages/server/data/content/spirit-beasts/catalog.json'), 'utf8')).species;
  const sharedRows = fs.readFileSync(path.join(root, 'packages/shared/src/spirit-beast-catalog.generated.ts'), 'utf8').split(/\r?\n/)
    .filter((line) => line.startsWith('  {"id":"spirit_beast.')).map((line) => JSON.parse(line.trim().replace(/,$/, '')));
  if (sharedRows.length !== 150 || species.some((entry, index) => entry.id !== sharedRows[index]?.id || entry.name !== sharedRows[index]?.name)) throw new Error('shared 與 server 的物種 ID/名稱不一致');
  const manifests = new Map();
  for (const grade of grades) for (const record of JSON.parse(fs.readFileSync(path.join(root, 'docs/artwork/atlases', `spirit-beasts-${grade}-01.json`), 'utf8')).records) manifests.set(record.id, record);
  if (manifests.size !== 150) throw new Error(`manifest 靈獸數量不是 150：${manifests.size}`);
  const deer = manifests.get('spirit_beast.heaven.wood.05')?.extraction.primaryComponent;
  if (!deer || deer.top > 25 || deer.height < 140) throw new Error('九色鹿粉紫頸部或頭角遭去背誤刪');
  const arts = [];
  for (const entry of species) for (const size of [96, 192]) {
    const file = path.join(root, 'packages/client/public/assets/spirit-beasts/species', `${entry.id}-${size}.webp`); const metadata = await sharp(file).metadata(); const stats = await sharp(file).ensureAlpha().stats();
    if (metadata.width !== size || metadata.height !== size || !stats.channels[3] || stats.channels[3].min !== 0 || stats.channels[3].max !== 255) throw new Error(`${path.relative(root, file)} 尺寸或真 alpha 不合格`);
    const digest = sha(file); const output = manifests.get(entry.id)?.outputs.find((candidate) => candidate.size === size);
    if (!output || output.sha256 !== digest || output.path !== path.relative(root, file).replaceAll('\\', '/')) throw new Error(`${entry.id}-${size} manifest 雜湊或路徑不一致`);
    arts.push(digest);
  }
  if (new Set(arts).size !== arts.length) throw new Error('存在位元相同的靈獸素材');
  console.log(JSON.stringify({ baseline: '285d04618', checks, sharedServerNamesEqual: true, manifests: manifests.size, images: arts.length, uniqueImageHashes: new Set(arts).size }));
}
const [command, grade] = process.argv.slice(2);
if (command === 'redesign') redesign(); else if (command === 'prepare') prepare(grade); else if (command === 'crop') await crop(grade); else if (command === 'contact') await contact(); else if (command === 'verify') await verify(); else throw new Error('usage: refresh-spirit-beast-redesign.mjs redesign | prepare <grade> | crop <grade> | contact | verify');
