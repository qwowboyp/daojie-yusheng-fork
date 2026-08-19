/**
 * 简体 → 台湾繁体 词级对照表（纯数据模块）。
 *
 * 本表是 zh-tw-only-conversion 计划的词级真源：转换器（convert-to-traditional.mjs）、
 * 守卫（check-traditional.mjs）与后续对比脚本都从这里读取同一份词表，保证口径一致。
 *
 * 为什么需要词级表：opencc-js 的 cn→tw 是「字级」转换，会把「服务器」转成「服務器」
 * （台湾不用「服務器」），只有先做词级替换（服务器→伺服器），再做字级收尾，才能得到
 * 「伺服器」这类台湾惯用词。
 *
 * 使用方式：
 *   import { VOCABULARY_CN_TO_TW } from './tw-vocabulary.mjs';
 *   词表按 key 长度降序遍历，先匹配最长词（避免「网络」吃掉「网络游戏」的前缀）。
 *
 * 维护规范：
 *   - key 必须为简体，value 必须为台湾惯用繁体；追加条目即可，勿删除既有条目。
 *   - 单字词不放在这里（那是 opencc 字级转换的职责），这里只放「台湾用词与大陆
 *     用词不同」的多字词。
 */
export const VOCABULARY_CN_TO_TW = new Map([
  // 硬件 / 系统
  ['服务器', '伺服器'],
  ['内存', '記憶體'],
  ['硬盘', '硬碟'],
  ['软件', '軟體'],
  ['网络', '網路'],
  ['屏幕', '螢幕'],
  ['鼠标', '滑鼠'],
  ['打印', '列印'],
  ['音频', '音訊'],
  ['视频', '影片'],
  // 账号 / 交互
  ['登录', '登入'],
  ['注册', '註冊'],
  ['在线', '線上'],
  ['离线', '離線'],
  ['创建', '建立'],
  ['信息', '訊息'],
  ['默认', '預設'],
]);

/**
 * 返回按 key 长度降序排列的词条数组（转换时按此顺序做最长匹配）。
 * 返回的是新数组，调用方可以自由排序。
 */
export function sortedVocabularyEntries() {
  return [...VOCABULARY_CN_TO_TW.entries()].sort((a, b) => b[0].length - a[0].length);
}

/**
 * 对一段文本做词级替换（最长匹配优先）。
 * 返回 { text: 替换后的文本, hits: [{cn, tw}] }，hits 记录实际命中的词条（去重、按首次命中顺序）。
 */
export function applyVocabulary(text) {
  const hits = [];
  const seen = new Set();
  let result = text;
  for (const [cn, tw] of sortedVocabularyEntries()) {
    if (result.includes(cn)) {
      result = result.split(cn).join(tw);
      if (!seen.has(cn)) {
        seen.add(cn);
        hits.push({ cn, tw });
      }
    }
  }
  return { text: result, hits };
}
