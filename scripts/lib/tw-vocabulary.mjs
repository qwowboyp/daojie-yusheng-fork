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

/* ------------------------------------------------------------------ */
/* 台湾标准用词保护表（opencc cn→tw 幂等性修复）                         */
/* ------------------------------------------------------------------ */

/**
 * 台湾标准写法保护表。
 *
 * opencc-js 的 cn→tw 不是幂等转换：对「已是台湾标准」的文本再次转换时，
 * 会误转部分台湾惯用词为异体/罕用字（例：濃郁→濃鬱、岩→巖、馥郁→馥鬱）。
 * 这些字形在简化字与台湾标准之间本无差异（岩/岩石 简繁体同形），误转后
 * 反而变成台湾不用或仅用于特定词的字（鬱 只用于 憂鬱/鬱悶/鬱金香）。
 *
 * 掩码规则：
 *   - 岩：单字掩码安全——简化字「岩」与台湾标准「岩」同形，掩码不影响
 *     真正的简体转换（黄岩鼍兽→黃岩鼉獸 仍正确）。
 *   - 濃郁 / 馥郁：词级掩码——单字「郁」绝不掩码，「憂郁 / 忧郁」仍能被
 *     守卫抓到（郁 在台湾标准只有 鬱 一种写法，但仅在 憂鬱 等词中）。
 *
 * 追加条目即可扩展；新条目必须是「台湾标准写法」且 opencc 会误转的词/字。
 */
export const TW_PROTECTED_PHRASES = ['濃郁', '馥郁', '岩'];

/**
 * 掩码保护：把 TW_PROTECTED_PHRASES 中的词替换为控制字符哨兵，
 * 避免 opencc 对这些已是台湾标准的词做错误再转换。
 *
 * 返回 { text: 掩码后的文本, restore: (t) => 把哨兵还原为原词的函数 }。
 * 哨兵为 \u0000TW<i>\u0000 形式（控制字符 + ASCII），源文本中不会出现，
 * opencc 字级转换对非 CJK 控制字符原样透传。
 */
export function maskProtected(text) {
  let out = text;
  const map = new Map();
  // 长词优先掩码（避免「岩石」等长词被「岩」前缀截断；当前条目不重叠，纯防御）
  const ordered = [...TW_PROTECTED_PHRASES].sort((a, b) => b.length - a.length);
  for (const [i, phrase] of ordered.entries()) {
    const sentinel = `\u0000TW${i}\u0000`;
    map.set(sentinel, phrase);
    out = out.split(phrase).join(sentinel);
  }
  return {
    text: out,
    restore: (t) => {
      let result = t;
      for (const [sentinel, phrase] of map) {
        result = result.split(sentinel).join(phrase);
      }
      return result;
    },
  };
}

/** 便捷导出：只返回掩码后的文本（守卫 textNeedsConversion 用）。 */
export function applyProtectedMask(text) {
  return maskProtected(text).text;
}
