'use strict';

const assert = require('node:assert/strict');
const {
  formatDisplayCountBadge,
  formatDisplayCurrentMax,
  formatDisplayInteger,
  formatDisplayNumber,
  formatDisplayPercent,
  formatDisplaySignedNumber,
} = require('../dist');

const cases = [
  ['五位数保留四位有效数字', formatDisplayNumber(12_345), '1.234萬'],
  ['一位整数部分向下截断', formatDisplayNumber(19_999), '1.999萬'],
  ['两位整数部分保留两位小数', formatDisplayNumber(123_456), '12.34萬'],
  ['三位整数部分保留一位小数', formatDisplayNumber(1_299_999), '129.9萬'],
  ['四位整数部分不保留小数', formatDisplayNumber(12_999_999), '1299萬'],
  ['万单位上界不因四舍五入跨到亿', formatDisplayNumber(99_999_999), '9999萬'],
  ['亿单位沿用四位有效数字', formatDisplayNumber(123_456_789), '1.234億'],
  ['兆单位沿用四位有效数字', formatDisplayNumber(12_345_678_901_234), '12.34兆'],
  ['精确单位值不补无效零', formatDisplayNumber(100_000_000), '1億'],
  ['负数按绝对值向下截断', formatDisplayNumber(-19_999), '-1.999萬'],
  ['显式小数上限仍可降低精度', formatDisplayNumber(12_345, { compactMaximumFractionDigits: 2 }), '1.23萬'],
  ['显式小数上限不能突破四位有效数字', formatDisplayNumber(12_345, { compactMaximumFractionDigits: 20 }), '1.234萬'],
  ['整数格式化在压缩前不四舍五入', formatDisplayInteger(12_349.9), '1.234萬'],
  ['带符号格式继承统一策略', formatDisplaySignedNumber(12_345), '+1.234萬'],
  ['百分比格式继承统一策略', formatDisplayPercent(12_345), '1.234萬%'],
  ['当前最大值格式继承统一策略', formatDisplayCurrentMax(12_345, 99_999), '1.234萬 / 9.999萬'],
  ['数量角标格式继承统一策略', formatDisplayCountBadge(12_345), 'x1.234萬'],
  ['非有限值保持安全回退', formatDisplayNumber(Number.POSITIVE_INFINITY), '0'],
];

for (const [label, actual, expected] of cases) {
  assert.equal(actual, expected, label);
}

assert.match(
  formatDisplayNumber(Number.MAX_VALUE),
  /^1797(?:0+)無量大數$/u,
  '超过最高中文单位四个数量级后仍只能保留四位有效数字',
);

console.log(JSON.stringify({ ok: true, case: 'display-number', cases: cases.length + 1 }, null, 2));
