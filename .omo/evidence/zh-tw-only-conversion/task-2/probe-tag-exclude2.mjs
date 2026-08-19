import { convertJsonString } from '../../../../scripts/convert-to-traditional.mjs';
const cases = [
  {
    name: 'nested-object-in-array (should convert)',
    text: '{\n  "monsters": [\n    { "name": "噬魂兽谷", "char": "狼", "tags": ["异材"] },\n    { "name": "测试" }\n  ]\n}\n',
  },
  {
    name: 'normal string array (should convert)',
    text: '{\n  "list": ["药品", "基础药品"]\n}\n',
  },
  {
    name: 'tags array single level (should exclude)',
    text: '{\n  "tags": ["异材", "金属", "布料"]\n}\n',
  },
  {
    name: 'tagGroups deep nested (should exclude)',
    text: '{\n  "tagGroups": [[ "药品" ], [ "基础药品" ]]\n}\n',
  },
  {
    name: 'char excluded',
    text: '{\n  "char": "杂",\n  "name": "杂货"\n}\n',
  },
];
for (const c of cases) {
  const r = convertJsonString(c.text, { excludedFields: ['char', 'tags', 'tagGroups'] });
  console.log(`--- ${c.name} ---`);
  console.log(r.text);
  console.log('pending:', r.pending.length);
}
