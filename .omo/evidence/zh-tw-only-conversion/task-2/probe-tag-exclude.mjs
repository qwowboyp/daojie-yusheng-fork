import { convertJsonString } from '../../../../scripts/convert-to-traditional.mjs';
const text = '{\n  "name": "测试药品",\n  "tagGroups": [\n    [\n      "药品"\n    ],\n    [\n      "基础药品"\n    ]\n  ],\n  "tags": ["异材", "金属"],\n  "desc": "药品说明"\n}\n';
const r = convertJsonString(text, { excludedFields: ['char', 'tags', 'tagGroups'] });
console.log(r.text);
console.log('pending:', r.pending.length);
