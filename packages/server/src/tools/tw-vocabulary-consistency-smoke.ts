/**
 * 词表一致性 smoke：校验服务端 TS 词表与 scripts 语义真源词表完全相等。
 *
 * scripts/lib/tw-vocabulary.mjs 是 zh-tw-only-conversion 计划的词级真源；
 * packages/server/src/gm/compat-conversions/conversions/mail/tw-vocabulary.ts
 * 是服务端 GM 兼容转换的 TS 常量复制品。两份词表（VOCABULARY_CN_TO_TW /
 * TW_PROTECTED_PHRASES）必须逐条相等，否则服务端转换与全量转换口径漂移。
 * 该 smoke 不依赖数据库，任何 verify 门禁都会执行。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { installSmokeTimeout } from './smoke-timeout';
import {
  TW_PROTECTED_PHRASES,
  VOCABULARY_CN_TO_TW,
} from '../gm/compat-conversions/conversions/mail/tw-vocabulary';

installSmokeTimeout(__filename);

function resolveRepoRoot(): string {
  // dist 模式下 __dirname = packages/server/dist/tools
  const candidates = [
    join(__dirname, '..', '..', '..', '..', '..'), // dist/tools -> repo root
    join(__dirname, '..', '..', '..', '..'), // dist -> repo root
  ];
  for (const candidate of candidates) {
    try {
      if (readFileSync(join(candidate, 'package.json'), 'utf8').includes('"daojie-yusheng"')) {
        return candidate;
      }
    } catch {
      // try next candidate
    }
  }
  throw new Error(`无法定位仓库根目录：${__dirname}`);
}

async function main(): Promise<void> {
  const repoRoot = resolveRepoRoot();
  const vocabularySourcePath = join(repoRoot, 'scripts', 'lib', 'tw-vocabulary.mjs');
  const source = readFileSync(vocabularySourcePath, 'utf8');

  // 从 .mjs 源码提取 VOCABULARY_CN_TO_TW 词条（[cn, tw] 字面量对）
  const vocabularyLiteralPattern = /\[\s*(['"])([^'"]+)\1\s*,\s*(['"])([^'"]+)\3\s*\]/gu;
  const vocabularyPairs: Array<[string, string]> = [];
  for (const match of source.matchAll(vocabularyLiteralPattern)) {
    vocabularyPairs.push([match[2], match[4]]);
  }
  assert.ok(
    vocabularyPairs.length > 0,
    `未从 ${vocabularySourcePath} 解析到任何词条（词表可能已改动结构）`,
  );

  const scriptsVocabulary = new Map<string, string>(vocabularyPairs);
  assert.equal(
    scriptsVocabulary.size,
    VOCABULARY_CN_TO_TW.size,
    `词表条目数不一致：scripts=${scriptsVocabulary.size} ts=${VOCABULARY_CN_TO_TW.size}`,
  );
  const mismatched: string[] = [];
  for (const [cn, tw] of scriptsVocabulary) {
    const tsTw = VOCABULARY_CN_TO_TW.get(cn);
    if (tsTw !== tw) {
      mismatched.push(`${cn}->${tsTw ?? '<missing>'} (scripts: ${tw})`);
    }
  }
  assert.deepEqual(mismatched, [], `词表条目不一致：${mismatched.join('; ')}`);

  // TW_PROTECTED_PHRASES 一致性（从源码提取字符串数组字面量）
  const protectedPattern = /TW_PROTECTED_PHRASES\s*=\s*\[\s*((?:['"][^'"]+['"]\s*,\s*)*['"][^'"]+['"])\s*\]/u;
  const protectedMatch = source.match(protectedPattern);
  assert.ok(protectedMatch, `未从 ${vocabularySourcePath} 解析到 TW_PROTECTED_PHRASES`);
  const scriptsProtected = [...protectedMatch[1].matchAll(/['"]([^'"]+)['"]/gu)].map((m) => m[1]);
  assert.deepEqual(
    scriptsProtected,
    [...TW_PROTECTED_PHRASES],
    `TW_PROTECTED_PHRASES 不一致：scripts=${JSON.stringify(scriptsProtected)} ts=${JSON.stringify([...TW_PROTECTED_PHRASES])}`,
  );

  console.log(
    `tw-vocabulary-consistency-smoke passed: vocabulary=${scriptsVocabulary.size} entries, protected=${scriptsProtected.length} phrases`,
  );
}

void main();
