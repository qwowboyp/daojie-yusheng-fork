import fs from 'node:fs';
const raw = fs.readFileSync('packages/server/data/maps/yunxu_terrace.json', 'utf8');
const doc = JSON.parse(raw);
const gridValues = {};
for (const k of ['terrain', 'structure', 'surface']) {
  if (Array.isArray(doc[k])) { gridValues[k] = doc[k]; doc[k] = ['__GRID_LAYER__']; }
}
const patched = JSON.stringify(doc, null, 2) + '\n';
console.log('gridValues keys:', Object.keys(gridValues).join(','));
const charLines = patched.split('\n').filter((l) => l.includes('"char"'));
console.log('char lines:', charLines.length);
for (const l of charLines) console.log(' ', l.trim());
