#!/usr/bin/env node
/** 產出築基三圖功法、全卷書籍與定向掉落；預設只檢查，--write 才寫入。 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { applyFoundationTechniqueDrops, buildFoundationTechniques, LEGACY_BOOK_DROPS } from './lib/foundation-techniques.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const shared = require(path.join(root, 'packages/shared/dist/index.js'));
const write = process.argv.slice(2).includes('--write');
const data = 'packages/server/data/content';
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const encode = (value) => `${JSON.stringify(value, null, 2)}\n`;
const manuals = buildFoundationTechniques(shared);
const monsters = new Map(Object.values(manuals.maps).map(({ file }) => [file, read(`${data}/monsters/${file}`)]));
const acquisition = applyFoundationTechniqueDrops(monsters, manuals.books);
const output = new Map([
  [`${data}/techniques/筑基期/玩家功法.json`, encode(manuals.techniques)],
  [`${data}/items/筑基期/书籍.json`, encode(manuals.books)],
  ...[...monsters.entries()].map(([file, entries]) => [`${data}/monsters/${file}`, encode(entries)]),
  ['docs/design/balance/築基功法與掉落.json', encode(acquisition)],
  ['docs/design/balance/築基功法與掉落.md', renderMarkdown(acquisition)],
]);
const changed = [];
for (const [relative, content] of output) {
  const filename = path.join(root, relative);
  if (fs.existsSync(filename) && fs.readFileSync(filename, 'utf8') === content) continue;
  changed.push(relative);
  if (write) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, content);
  }
}
console.log(JSON.stringify({ ok: write || changed.length === 0, mode: write ? 'write' : 'check', techniques: manuals.techniques.length,
  books: manuals.books.length, changed }, null, 2));
if (!write && changed.length) process.exitCode = 1;

function renderMarkdown(acquisition) {
  const lines = [
    '# 築基功法與掉落', '',
    '本表由 `scripts/generate-foundation-techniques.mjs` 依正式功法與怪物配置產生。全卷功法書不寫 `learnTechniqueMaxLevel`，缺省即依模板滿層修煉。', '',
    '| 等級 | 功法 | 分類 | 品階 | 滿層 | 來源 | 基礎期望 | 現世二倍擊殺等價 |',
    '| --- | --- | --- | --- | ---: | --- | ---: | ---: |',
  ];
  for (const entry of acquisition) {
    const source = entry.sources.map((item) => `${item.monsterName}（${item.role} ${(item.chance * 100).toFixed(1)}%）`).join('、');
    const base = Math.min(...entry.sources.map((item) => item.chance));
    const current = 1 - ((1 - base) ** 2);
    lines.push(`| ${entry.realmLv} | ${entry.name} | ${entry.category} | ${entry.grade} | ${entry.maxLayer} | ${source} | ${formatExpected(base)} | ${formatExpected(current)} |`);
  }
  lines.push('', '基礎期望以可取得來源中最低基礎機率計算；現世欄採既有兩倍擊殺等價機率 `1-(1-p)^2`，均非保底。',
    '普通入門書基率為 0.8%，精英為 4%，頭目為 10%；神通使用精英 2%、頭目 6%，其中 34 級《玄龜護元章》因霜刃淵無頭目，僅由唯一精英鐵甲玄龜以 2% 掉落。', '',
    '既有天階書籍定向補充：焚木妖王掉落《凝氣成基法》 1%，玄壤地龍與五行噬脈獸各掉落《血煞喚靈決》 3%。',
    `既有定向掉落筆數：${LEGACY_BOOK_DROPS.length}。`, '');
  return lines.join('\n');
}

function formatExpected(chance) {
  return `${(1 / chance).toFixed(1)} 次`;
}
