/**
 * 简体 → 台湾繁体 词级对照表（TS 常量复制品）。
 *
 * 语义真源是 scripts/lib/tw-vocabulary.mjs（zh-tw-only-conversion 计划词级真源）。
 * 给 GM 兼容转换（系统邮件繁体化）用的复制品，因为在生产代码里 import 脚本层
 * .mjs 会造成运行时对脚本目录的耦合；tools/tw-vocabulary-consistency-smoke.ts
 * 会解析两份词表逐条比对，漂移即红。
 *
 * 维护规范：要改本表必须同步改 scripts/lib/tw-vocabulary.mjs，且保持一致。
 */

/** 简体 → 台湾繁体 词级对照（与 scripts/lib/tw-vocabulary.mjs 的 VOCABULARY_CN_TO_TW 一致）。 */
export const VOCABULARY_CN_TO_TW: ReadonlyMap<string, string> = new Map([
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

/** 台湾标准写法保护表（opencc cn→tw 幂等性误转修复；与 scripts 真源一致）。 */
export const TW_PROTECTED_PHRASES: readonly string[] = ['濃郁', '馥郁', '岩', '殘卷'];

/**
 * 返回按 key 长度降序排列的词条数组（转换时按此顺序做最长匹配）。
 * 返回的是新数组，调用方可以自由排序。
 */
export function sortedVocabularyEntries(): Array<[string, string]> {
  return [...VOCABULARY_CN_TO_TW.entries()].sort((left, right) => right[0].length - left[0].length);
}

/**
 * 对一段文本做词级替换（最长匹配优先）。
 * 返回 { text: 替换后的文本, hits: [{cn, tw}] }，hits 记录实际命中的词条（去重、按首次命中顺序）。
 */
export function applyVocabulary(
  text: string,
): { text: string; hits: Array<{ cn: string; tw: string }> } {
  const hits: Array<{ cn: string; tw: string }> = [];
  const seen = new Set<string>();
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

/**
 * 掩码保护：把 TW_PROTECTED_PHRASES 中的词替换为控制字符哨兵，
 * 避免 opencc 对这些已是台湾标准的词做错误再转换。
 *
 * 返回 { text: 掩码后的文本, restore: (t) => 把哨兵还原为原词的函数 }。
 * 哨兵为 \u0000TW<i>\u0000 形式（控制字符 + ASCII），源文本中不会出现，
 * opencc 字级转换对非 CJK 控制字符原样透传。
 */
export function maskProtected(text: string): {
  text: string;
  restore: (masked: string) => string;
} {
  let out = text;
  const map = new Map<string, string>();
  // 长词优先掩码（避免「岩石」等长词被「岩」前缀截断；当前条目不重叠，纯防御）
  const ordered = [...TW_PROTECTED_PHRASES].sort((a, b) => b.length - a.length);
  for (const [i, phrase] of ordered.entries()) {
    const sentinel = `\u0000TW${i}\u0000`;
    map.set(sentinel, phrase);
    out = out.split(phrase).join(sentinel);
  }
  return {
    text: out,
    restore: (masked: string): string => {
      let result = masked;
      for (const [sentinel, phrase] of map) {
        result = result.split(sentinel).join(phrase);
      }
      return result;
    },
  };
}
