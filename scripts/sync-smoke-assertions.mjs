/**
 * 断言语义同步器（zh-tw-only-conversion 计划 todo 4/9）。
 *
 * 生产文本已转换为台湾繁体；smoke 测试里的「断言字符串」是生产文本的镜像
 * （expected value / regex 针 / includes 参数），必须同步为繁体，否则
 * assert 会因文本不匹配而失败。
 *
 * 本工具只做「文本同动」：AST 定位断言调用（assert.* / assert 变量）与
 * 文本匹配方法（includes / startsWith / endsWith / indexOf / match）里的
 * 字符串与正则字面量，用两段式转换器（词级 + opencc 字级，含
 * 濃郁/馥郁/岩/殘卷 掩码保护）转换其中文。
 *
 * 绝不动：注释、标识符、非断言字符串、含插值模板、lookup key 字符串、
 * 纯 ASCII、已是繁体的字符串。
 *
 * 用法：
 *   node scripts/sync-smoke-assertions.mjs --dry-run            # 报告（默认）
 *   node scripts/sync-smoke-assertions.mjs --write              # 写回
 *   node scripts/sync-smoke-assertions.mjs --dir packages/server/src/tools --dry-run
 *   node scripts/sync-smoke-assertions.mjs --files a.ts b.mjs   # 指定文件
 *   node scripts/sync-smoke-assertions.mjs --files scripts/*.mjs --dry-run
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { convertText, findReplacementChar } from './convert-to-traditional.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

/* ------------------------------------------------------------------ */
/* 排除清单                                                            */
/* ------------------------------------------------------------------ */

/**
 * 断言字符串里「充当 lookup key / 数据标签」的字面量，禁止转换。
 *
 * 背景：build-material 等系统以简体中文标签（数据档 tags）做代码级匹配，
 * 数据标签保持简体（见 convert-exclude-fields.json 的 tags/tagGroups 排除），
 * 断言里若出现这些标签（如构造材料 item 的 name/tag），转繁体会导致
 * 与简体数据标签对不上。
 *
 * 命中规则：字符串「包含」任一排除词即跳过（如 '透明材' 同时命中 '透明'）。
 */
const KEYWORD_EXCLUSIONS = [
  '金属', '石材', '木材', '布料', '透明',
  // 材料类标签（内容数据 tags 维持简体，见 learnings task-2 排除清单一节）
  '药材', '异材', '矿石', '兽骨', '草药', '灵材', '蛇胆', '蛛丝', '兽皮',
  '药品', '丹药', '护甲', '步法', '武器', '帽子', '匪物', '狼牙', '翠竹心',
  // 数值格式化输出（shared display-number 已转繁：萬/億；含萬/億断言维持排除防误伤，
  // 简体「万」仍排除以保护万矿归元/万虚归墟等简体 fixture 名；config 日志未转繁）
  '万', '萬', '億',
  // ---- F2 修复后新增：纯 fixture 回显（smoke 自造数据，两侧一致即可，非生产文案）----
  // world-runtime-instance-capability-guard 自造怪物/技能名（断言模板位已是繁体，
  // 名字保持简体即与运行时输出一致）
  '唤灵真人', '唤灵火',
  // gm-network-perf-hotpath 自造 payload 玩家名回显
  '测试玩家_0',
  // player-display-name 输入名 → trim 回显
  '云来散修',
  // item-instance-id 显示名合成（输入 name → '+N 名 xN' 回显）
  '+5 测试剑',
  // world-gateway-inventory-helper 搜索串规范化回显（输入 ' 铜  罗盘 ' → '铜 罗盘'）
  '铜 罗盘',
  // sect-application-page 搜索串规范化回显（输入 '  青云  ' → '青云'）
  '青云',
  // world-runtime-formation 自造玩家名「旧档修士」首字投影回显
  '旧',
  // world-runtime-transfer-placement smoke 自抛错误消息 → 断言透传回传
  '目标实例没有可用出生点',
];

/**
 * 逐字面量排除（needle 的原文精确子串匹配；命中则跳过转换）。
 * 用于「镜像的生产文本尚未转繁」的断言：
 *   - config/ 目录日志前缀 [启动配置] 不在守卫 scope 内，保持简体
 *   - GM 面（native-gm-* / runtime/gm）生产消息按计划保持简体
 *   - 启动校验 / 共享校验等未转繁的生产消息
 */
const LITERAL_EXCLUSIONS = [
  '\\[启动配置\\].*\\.env.*code=EISDIR',
  '\\[启动配置\\].*repository-loader-directory.*code=EISDIR',
  // 生产仍为简体的镜像断言（来源见行尾注释），同步器禁止改动：
  '不支持的玩家修改分区',                          // http/native/native-gm-player.service.ts
  'GM 密码错误',                                  // runtime/gm/runtime-gm-auth.service.ts
  'GM 运行时环境变量文件不可读',                    // runtime/gm/runtime-env-management.service.ts
  '数据库备份目录不可用',                           // http/native/native-gm-admin.service.ts
  '非开发环境必须显式配置 SERVER_CORS_ORIGINS',      // config/server-cors.ts
  '手动分线创建后未就绪',                           // http/native/native-gm-world.service.ts
  '分线预设必须是和平线或真实线',                    // http/native/native-gm-world.service.ts
  '目标玩家未在线',                                // http/native/native-gm-world.service.ts
  '显示名称组合序列不能超过',                        // auth/account-validation.ts
  '显示名称必须为可见字符',                         // auth/account-validation.ts
  '[敏感请求正文已隐藏]',                          // runtime/gm/runtime-gm-state.service.ts 脱敏常量
  '背包物品身份已修复，请重新选择',                  // network/world-gateway-inventory.helper.ts
];

/** 判定字符串是否命中排除词（整词含于其中）。 */
function isExcludedKeyword(text) {
  return KEYWORD_EXCLUSIONS.some((word) => text.includes(word));
}

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

/** 统计 index 所在行（0 起始），行号 = 行数 + 1。 */
function lineAt(text, index) {
  let line = 0;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

/** 纯 ASCII / 无 CJK → 无需转换。 */
function hasCjk(text) {
  return /[\u3400-\u9FFF\uF900-\uFAFF]/.test(text);
}

/** 转换一段文本；无差异返回 null。 */
function convertIfNeeded(raw) {
  if (!hasCjk(raw) || isExcludedKeyword(raw)) return null;
  if (LITERAL_EXCLUSIONS.some((pattern) => raw.includes(pattern))) return null;
  const { text: converted } = convertText(raw);
  if (converted === raw) return null;
  return converted;
}

/** 是否在 assert.* 调用链上的成员访问（assert.xxx / assert.xxx.yyy）。 */
function isAssertMember(node) {
  let current = node;
  while (current && ts.isPropertyAccessExpression(current)) {
    current = current.expression;
  }
  return !!current && current.getText().startsWith('assert');
}

/* ------------------------------------------------------------------ */
/* AST 收集                                                            */
/* ------------------------------------------------------------------ */

/**
 * 收集一个源码文件里所有「断言字面量」：
 *   - assert.*(...) 调用的字符串 / 正则参数
 *   - 文本匹配方法（includes / startsWith / endsWith / indexOf / match）
 *     的字符串 / 正则参数（限断言调用链内；含 assert.ok(x.includes(...)) 等）
 *
 * 「fixture 值」处理：断言针如果与同文件里非断言的 fixture 字面量（对象
 * 属性值 / 函数实参等）完全同值，说明它是 fixture 回显（如
 * name: '烟测' + assert.equal(x.name, '烟测')），两侧都保持简体才是配对。
 * 因此先用「标记遍历」定位全部断言字面量节点，再收集「非断言位置」的
 * 字面量值作为 fixture 候选；断言针命中集合则跳过。
 * （F2 修复：旧实现预扫递归收集了所有 StringLiteral，包括断言实参本身，
 * 导致断言预期值必然命中 fixtureValues 而被静默跳过——工具对字符串断言
 * 永远 no-op。现在预扫严格排除断言节点。）
 *
 * 返回 [{ start, end, raw, converted, kind }]；start/end 为原文字符位置
 * （不含引号/斜杠），converted 为 null 表示无需转换或命中排除。
 */
function collectAssertionLiterals(sourceFile, text) {
  const found = [];
  const fixtureValues = new Set();

  const rawOfStringLiteral = (node) => {
    const start = node.getStart(sourceFile) + 1; // 跳过引号
    const end = node.end - 1;
    return { start, end, raw: text.slice(start, end) };
  };

  /** 判断一个调用是否「断言调用」：assert.xxx(...) 或 assert(...) 等。 */
  const isAssertCall = (call) => {
    const expr = call.expression;
    if (ts.isIdentifier(expr) && expr.text === 'assert') return true;
    if (ts.isPropertyAccessExpression(expr)) {
      // 从成员链根部取基座标识符（assert.xxx / assert.xxx.yyy）
      let base = expr;
      while (ts.isPropertyAccessExpression(base)) base = base.expression;
      return ts.isIdentifier(base) && base.text === 'assert';
    }
    return false;
  };

  /** 判断节点是否在「断言调用实参」里（用于放行 includes 链）。 */
  const insideAssertArgs = (node) => {
    let current = node.parent;
    while (current) {
      if (ts.isCallExpression(current) && isAssertCall(current)) return true;
      current = current.parent;
    }
    return false;
  };

  const MATCH_METHODS = new Set(['includes', 'startsWith', 'endsWith', 'indexOf', 'match']);

  /** 断言调用中「参与值比较」的实参下标集合；其余（如消息文案）不动。 */
  const ASSERT_VALUE_ARG_INDEX = new Map([
    ['equal', [1]],
    ['strictEqual', [1]],
    ['notEqual', [1]],
    ['notStrictEqual', [1]],
    ['deepEqual', [1]],
    ['notDeepEqual', [1]],
    ['deepStrictEqual', [1]],
    ['notDeepStrictEqual', [1]],
    ['throws', [1]],
    ['rejects', [1]],
    ['match', [1]],
    ['doesNotMatch', [1]],
    ['ok', []],           // assert.ok(x, msg)：无 expected 字面量可转
    ['doesNotThrow', []], // 同上
    ['fail', []],         // 无比较
  ]);

  /* ---- 第一步：标记遍历，定位全部断言字面量节点（不转换） ---- */
  const assertionStringNodes = new Set();
  const assertionRegExpNodes = new Set();

  const markAssertionArgs = (call) => {
    // 只标记「值比较位」的实参（expected 值 / regex 针）；消息文案不动
    const callee = call.expression;
    let methodName = 'assert';
    if (ts.isPropertyAccessExpression(callee)) methodName = callee.name.text;
    const valueArgs = ASSERT_VALUE_ARG_INDEX.get(methodName) ?? [];
    for (const index of valueArgs) {
      const arg = call.arguments[index];
      if (!arg) continue;
      if (ts.isStringLiteral(arg)) assertionStringNodes.add(arg);
      else if (ts.isRegularExpressionLiteral(arg)) assertionRegExpNodes.add(arg);
    }
  };

  const markMatchArgs = (node) => {
    for (const arg of node.arguments) {
      if (ts.isStringLiteral(arg)) assertionStringNodes.add(arg);
      else if (ts.isRegularExpressionLiteral(arg)) assertionRegExpNodes.add(arg);
    }
  };

  const markVisit = (node) => {
    if (ts.isCallExpression(node)) {
      if (isAssertCall(node)) {
        markAssertionArgs(node);
      } else if (ts.isPropertyAccessExpression(node.expression) && MATCH_METHODS.has(node.expression.name.text)) {
        // 文本匹配方法：仅当「调用本身在断言实参内」或「在断言调用链上」才标记
        if (insideAssertArgs(node) || isAssertMember(node.expression)) {
          markMatchArgs(node);
        }
      }
    }
    ts.forEachChild(node, markVisit);
  };
  markVisit(sourceFile);

  /* ---- 第二步：收集非断言位置的字符串字面量值（fixture 候选） ---- */
  const collectFixtureValues = (node) => {
    if (ts.isStringLiteral(node)) {
      if (!assertionStringNodes.has(node)) {
        const { raw } = rawOfStringLiteral(node);
        if (hasCjk(raw)) fixtureValues.add(raw);
      }
      return;
    }
    ts.forEachChild(node, collectFixtureValues);
  };
  collectFixtureValues(sourceFile);

  /* ---- 第三步：对断言字面量做转换判定 ---- */
  const pushStringLiteral = (node) => {
    const { start, end, raw } = rawOfStringLiteral(node);
    const converted = convertIfNeeded(raw);
    if (!converted) return;
    if (fixtureValues.has(raw)) return; // 与 fixture 配对，保持简体
    found.push({ start, end, raw, converted, kind: 'string' });
  };

  const pushRegExpLiteral = (node) => {
    const textNode = node.text; // 含首尾斜杠
    const slashStart = textNode.indexOf('/');
    const slashEnd = textNode.lastIndexOf('/');
    if (slashStart < 0 || slashEnd <= slashStart) return;
    const raw = textNode.slice(slashStart + 1, slashEnd);
    if (!hasCjk(raw)) return;
    const converted = convertIfNeeded(raw);
    if (converted) {
      found.push({
        start: node.getStart(sourceFile) + slashStart + 1,
        end: node.getStart(sourceFile) + slashEnd,
        raw,
        converted,
        kind: 'regexp',
      });
    }
  };

  /* ---- 第四步：对第一步标记的断言字面量节点执行转换判定 ---- */
  for (const node of assertionStringNodes) pushStringLiteral(node);
  for (const node of assertionRegExpNodes) pushRegExpLiteral(node);

  // 去重（同一字面量可能被多个规则命中）
  const seen = new Set();
  const unique = [];
  for (const item of found) {
    const key = `${item.start}:${item.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

/* ------------------------------------------------------------------ */
/* 文件级处理                                                          */
/* ------------------------------------------------------------------ */

/** 转换单个文件（不写盘）。返回 { filePath, rewrites, changed, output }。 */
function convertFileAssertions(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const bad = findReplacementChar(text);
  if (bad) throw new Error(`${filePath}:${bad.line}:${bad.column} 包含替换字符 U+FFFD，拒绝转换。`);
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
  const literals = collectAssertionLiterals(sourceFile, text);
  const rewrites = literals.map((item) => ({
    start: item.start,
    end: item.end,
    raw: item.raw,
    converted: item.converted,
    kind: item.kind,
    line: lineAt(text, item.start) + 1,
  }));
  if (rewrites.length === 0) return { filePath, changed: false, rewrites: [], output: text };
  let output = text;
  for (const span of [...rewrites].sort((a, b) => b.start - a.start)) {
    output = output.slice(0, span.start) + span.converted + output.slice(span.end);
  }
  return { filePath, changed: true, rewrites, output };
}

/* ------------------------------------------------------------------ */
/* CLI                                                                */
/* ------------------------------------------------------------------ */

function printHelp() {
  console.log(`用法：node scripts/sync-smoke-assertions.mjs [选项]

断言语义同步器：把 smoke 测试里镜像生产文本的断言字符串（assert.* 实参 /
includes 等文本匹配方法的字符串与正则）同步为台湾繁体。

扫描范围：packages/server/src/tools/**/*.ts（默认）
  --dir <path>            指定扫描目录（递归）
  --files <a.ts,b.mjs>    指定文件列表（相对 repoRoot）
  --dry-run               只报告，不写盘（默认）
  --write                 写回文件
  --help                  显示本帮助

转换范围：assert.*(...) 调用的字符串/正则实参；includes/startsWith/endsWith/
indexOf/match 的字符串/正则实参（限断言调用链内）。注释、标识符、非断言
字符串、含插值模板、lookup key 字符串（KEYWORD_EXCLUSIONS）一律不动。`);
}

function walkDir(dir) {
  const files = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walkDir(full);
    else if (path.extname(full).toLowerCase() === '.ts') files.push(full);
  }
  return files;
}

function main() {
  const argv = process.argv.slice(2);
  let dryRun = true;
  let write = false;
  let dir = path.join(repoRoot, 'packages/server/src/tools');
  let files = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg === '--dry-run') {
      dryRun = true;
      write = false;
    } else if (arg === '--write') {
      write = true;
      dryRun = false;
    } else if (arg === '--dir') {
      dir = argv[++i];
    } else if (arg === '--files') {
      files = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    } else {
      console.error(`未知选项：${arg}（--help 查看用法）`);
      process.exit(2);
    }
  }

  const targetFiles = files
    ? files.map((f) => (path.isAbsolute(f) ? f : path.resolve(repoRoot, f)))
    : walkDir(dir);

  const allRewrites = [];
  let changedFiles = 0;
  let hadError = false;

  for (const filePath of targetFiles) {
    if (!fs.existsSync(filePath)) {
      console.error(`文件不存在：${filePath}`);
      hadError = true;
      continue;
    }
    let result;
    try {
      result = convertFileAssertions(filePath);
    } catch (error) {
      console.error(`錯誤：${error.message}`);
      hadError = true;
      continue;
    }
    if (!result.changed) continue;
    changedFiles += 1;
    const rel = path.relative(repoRoot, filePath) || filePath;
    console.log(`[${dryRun ? '待轉換' : '已轉換'}] ${rel}`);
    for (const r of result.rewrites) {
      console.log(`  ${rel}:${r.line} (${r.kind}) ${r.raw} → ${r.converted}`);
      allRewrites.push({ file: rel, line: r.line, kind: r.kind, raw: r.raw, converted: r.converted });
    }
    if (write) {
      try {
        fs.writeFileSync(filePath, result.output);
      } catch (error) {
        console.error(`寫入失敗：${filePath}（${error.message}）`);
        hadError = true;
      }
    }
  }

  console.log(`\n共掃描 ${targetFiles.length} 個文件，${changedFiles} 個有斷言轉換，共 ${allRewrites.length} 處${write ? '（已寫回）' : ''}${dryRun ? '（dry-run，未寫盤）' : ''}`);
  if (hadError) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
