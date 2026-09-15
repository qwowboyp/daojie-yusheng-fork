import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertBaselineMatchesPlan, collectPlan, readBaselineManifest } from './manifest.mjs';
import { resolveVerificationPlan } from './verification.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function parseArgs(argv) {
  const options = { ref: 'HEAD', baselineManifest: null, base: null, proofs: [], allClientTests: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--base') options.base = readOptionValue(argv, ++index, value);
    else if (value === '--ref') options.ref = readOptionValue(argv, ++index, value);
    else if (value === '--baseline-manifest') options.baselineManifest = readOptionValue(argv, ++index, value);
    else if (value === '--proof') options.proofs.push(readOptionValue(argv, ++index, value));
    else if (value === '--all-client-tests') options.allClientTests = true;
    else throw new Error(`未知參數：${value}`);
  }
  if (!options.base || !options.ref) throw new Error('用法：node plan.mjs --base <commit-ish> [--ref HEAD] [--baseline-manifest <path>] [--proof <id|script>... | --all-client-tests]');
  if (options.allClientTests && options.proofs.length > 0) throw new Error('--all-client-tests 與 --proof 不可同時使用');
  return options;
}

function readOptionValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${option} 缺少值`);
  return value;
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const plan = collectPlan(repoRoot, options);
    const baseline = options.baselineManifest ? await readBaselineManifest(path.resolve(options.baselineManifest)) : null;
    assertBaselineMatchesPlan(baseline, plan);
    const verification = resolveVerificationPlan(repoRoot, { ...options, requireSelection: false });
    process.stdout.write(`${JSON.stringify({
      ...plan,
      baseline: baseline ? { commit: baseline.commit ?? null } : null,
      verification: {
        mode: verification.mode,
        selectedProofs: verification.selectedProofs,
        commands: verification.commands,
        prepareRequiresExplicitSelection: verification.prepareRequiresExplicitSelection,
      },
    }, null, 2)}\n`);
    process.exitCode = plan.eligible ? 0 : 2;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
