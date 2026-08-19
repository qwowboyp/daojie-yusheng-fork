import fs from 'node:fs';
import path from 'node:path';
function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.json')) out.push(p);
  }
  return out;
}
const set = new Set(['药品', '基础药品', '药膏', '丹药', '蛇胆', '蛛丝', '帽子', '护甲', '旧兵器', '步法', '武器', '腿部护甲', '锻体', '匪物', '材料']);
const files = walk('packages/server/data/maps', []);
let total = 0;
for (const f of files) {
  const t = JSON.parse(fs.readFileSync(f, 'utf8'));
  const hits = [];
  function walkv(o, pathStr) {
    if (Array.isArray(o)) { o.forEach((v, i) => walkv(v, `${pathStr}[${i}]`)); return; }
    if (o && typeof o === 'object') {
      for (const k of Object.keys(o)) {
        if (typeof o[k] === 'string' && set.has(o[k])) hits.push(`${pathStr}.${k}=${o[k]}`);
        walkv(o[k], `${pathStr}.${k}`);
      }
    }
  }
  walkv(t, '$');
  if (hits.length > 0) {
    total += hits.length;
    console.log(f.replace('packages/server/data/maps/', ''), '→', hits.slice(0, 4).join('; '));
  }
}
console.log('total:', total);
