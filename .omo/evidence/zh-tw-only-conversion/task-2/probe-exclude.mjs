import { convertJsonString } from "../../../../scripts/convert-to-traditional.mjs";
const text = '{\n  "a": {\n    "char": "\u6742",\n    "name": "\u6742\u8d27"\n  }\n}\n';
const r = convertJsonString(text, { excludedFields: ["char"] });
console.log(r.text);
console.log("pending:", JSON.stringify(r.pending));
