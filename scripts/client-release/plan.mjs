import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertBaselineMatchesPlan, collectPlan, readBaselineManifest } from './manifest.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function parseArgs(argv) {
  const options = { ref: 'HEAD', baselineManifest: null, base: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--base') options.base = readOptionValue(argv, ++index, value);
    else if (value === '--ref') options.ref = readOptionValue(argv, ++index, value);
    else if (value === '--baseline-manifest') options.baselineManifest = readOptionValue(argv, ++index, value);
    else throw new Error(`未知參數：${value}`);
  }
  if (!options.base || !options.ref) throw new Error('用法：node plan.mjs --base <commit-ish> [--ref HEAD] [--baseline-manifest <path>]');
  return options;
}

function readOptionValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${option} 缺少值`);
  return value;
}

try {
  const options = parseArgs(process.argv.slice(2));
  const plan = collectPlan(repoRoot, options);
  const baseline = options.baselineManifest ? await readBaselineManifest(path.resolve(options.baselineManifest)) : null;
  assertBaselineMatchesPlan(baseline, plan);
  process.stdout.write(`${JSON.stringify({ ...plan, baseline: baseline ? { commit: baseline.commit ?? null } : null }, null, 2)}\n`);
  process.exit(plan.eligible ? 0 : 2);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
