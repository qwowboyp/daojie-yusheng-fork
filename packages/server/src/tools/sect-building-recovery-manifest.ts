/**
 * 本文件是服务端冷路径运维工具入口，用于迁移、预检、清理或后台任务手动执行。
 *
 * 维护时要让脚本参数、失败退出码和副作用范围清晰，避免误操作生产数据。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BACKUP_IDENTITY,
  BACKUP_SHA256,
  COVERAGE_GAP_NOTE,
  SOURCE_SQL_SHA256,
} from './sect-building-recovery-constants';
import {
  authorizeEmitSql,
  writeEmittedRecoverySql,
} from './sect-building-recovery-emit-sql';
import {
  CURRENT_STATE_RECEIPT_SCHEMA_DOC,
  parseCurrentStateReceipt,
} from './sect-building-recovery-current-state';
import { sha256Bytes } from './sect-building-recovery-hash';
import { buildSectBuildingRecoveryPlan } from './sect-building-recovery-plan';
import {
  buildSectBuildingRecoveryManifest,
  renderSectBuildingRecoveryReport,
} from './sect-building-recovery-report';

const DEFAULT_SQL_PATH = path.join(os.tmpdir(), 'opencode', 'sect-recovery', 'building-recovery-source.sql');

export type RecoveryCliIo = {
  readonly stdout: { readonly write: (chunk: string) => unknown };
  readonly stderr: { readonly write: (chunk: string) => unknown };
};

type RecoveryCliArgs = {
  readonly sql: string;
  readonly outDir: string;
  readonly dumpIdentity: string;
  readonly dumpSha256: string;
  readonly currentStatePath: string;
  readonly currentStateSha256: string;
  readonly help: boolean;
  readonly applyRequested: boolean;
  readonly emitApplySql: string;
  readonly emitAuthorization: string;
};

function printUsage(io: RecoveryCliIo): void {
  io.stdout.write(
    [
      'sect-building-recovery-manifest — local dry-run for 8 deleted sect buildings',
      'Usage: node dist/tools/sect-building-recovery-manifest.js --sql <path> --current-state <json> --current-state-sha256 <sha256> [--out-dir <dir>] [--emit-apply-sql <path> --emit-authorization <manifestSha256>]',
      'Dry-run only. --emit-apply-sql writes a local SQL file and never executes it.',
      COVERAGE_GAP_NOTE,
      CURRENT_STATE_RECEIPT_SCHEMA_DOC,
      '',
    ].join('\n'),
  );
}

function parseArgs(argv: readonly string[]): RecoveryCliArgs {
  let sql = process.env.SECT_BUILDING_RECOVERY_SQL || DEFAULT_SQL_PATH;
  let outDir = '';
  let dumpIdentity = BACKUP_IDENTITY;
  let dumpSha256 = BACKUP_SHA256;
  let currentStatePath = '';
  let currentStateSha256 = '';
  let help = false;
  let applyRequested = false;
  let emitApplySql = '';
  let emitAuthorization = '';
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--apply' || arg === '--i-understand-this-writes-the-database') {
      applyRequested = true;
      continue;
    }
    if (arg === '--sql') {
      sql = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--out-dir') {
      outDir = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--dump-identity') {
      dumpIdentity = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--dump-sha256') {
      dumpSha256 = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--current-state') {
      currentStatePath = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--current-state-sha256') {
      currentStateSha256 = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--emit-apply-sql') {
      emitApplySql = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--emit-authorization') {
      emitAuthorization = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
  }
  return {
    sql,
    outDir,
    dumpIdentity,
    dumpSha256,
    currentStatePath,
    currentStateSha256,
    help,
    applyRequested,
    emitApplySql,
    emitAuthorization,
  };
}

export function runSectBuildingRecoveryCli(
  argv: readonly string[],
  io: RecoveryCliIo = { stdout: process.stdout, stderr: process.stderr },
): number {
  const args = parseArgs(argv);
  if (args.help) {
    printUsage(io);
    return 0;
  }
  if (args.applyRequested) {
    io.stderr.write('apply is not part of this dry-run tool\n');
    return 2;
  }
  if (!args.currentStatePath || !args.currentStateSha256) {
    io.stderr.write('current_state_missing: --current-state and --current-state-sha256 are required\n');
    return 2;
  }
  if (!fs.existsSync(args.currentStatePath)) {
    io.stderr.write(`current_state_missing: ${args.currentStatePath}\n`);
    return 2;
  }
  const receiptBytes = fs.readFileSync(args.currentStatePath);
  const receiptFileSha256 = sha256Bytes(receiptBytes);
  if (receiptFileSha256 !== args.currentStateSha256) {
    io.stderr.write(`current_state_checksum_mismatch: current-state file SHA-256 ${receiptFileSha256} != ${args.currentStateSha256}\n`);
    return 2;
  }
  const parsedCurrent = parseCurrentStateReceipt(receiptBytes.toString('utf8'), receiptFileSha256);
  if (parsedCurrent.ok === false) {
    io.stderr.write(`${parsedCurrent.error.code}: ${parsedCurrent.error.message}\n`);
    return 2;
  }
  if (!args.sql || !fs.existsSync(args.sql)) {
    io.stderr.write(`missing SQL extraction: ${args.sql}\n`);
    return 2;
  }
  const sqlBytes = fs.readFileSync(args.sql);
  const fileSha256 = sha256Bytes(sqlBytes);
  if (fileSha256 !== SOURCE_SQL_SHA256) {
    io.stderr.write(`checksum_mismatch: source SQL SHA-256 ${fileSha256} != ${SOURCE_SQL_SHA256}\n`);
    return 2;
  }
  const sqlText = sqlBytes.toString('utf8');
  const planned = buildSectBuildingRecoveryPlan({
    sqlText,
    sourceSqlSha256: SOURCE_SQL_SHA256,
    dumpIdentity: args.dumpIdentity,
    dumpSha256: args.dumpSha256,
    current: parsedCurrent.current,
  });
  if (planned.ok === false) {
    io.stderr.write(`${planned.error.code}: ${planned.error.message}\n`);
    return 2;
  }
  const report = renderSectBuildingRecoveryReport(planned.plan);
  const manifest = buildSectBuildingRecoveryManifest(planned.plan);
  io.stdout.write(report);
  io.stdout.write(`sourceFileSha256=${fileSha256}\n`);
  io.stdout.write('sourceSqlVerified=true\n');
  if (args.emitApplySql) {
    const authorized = authorizeEmitSql({
      authorization: args.emitAuthorization,
      manifestSha256: planned.plan.manifestSha256,
    });
    if (authorized.ok === false) {
      io.stderr.write(`${authorized.code}: ${authorized.message}\n`);
      return 2;
    }
    const written = writeEmittedRecoverySql(planned.plan, args.emitApplySql);
    io.stdout.write(`emitSqlPath=${args.emitApplySql}\n`);
    io.stdout.write(`emitSqlSha256=${written.sqlSha256}\n`);
  }
  if (args.outDir) {
    fs.mkdirSync(args.outDir, { recursive: true });
    fs.writeFileSync(path.join(args.outDir, 'sect-building-recovery-report.txt'), report, 'utf8');
    fs.writeFileSync(
      path.join(args.outDir, 'sect-building-recovery-manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );
  }
  return 0;
}

function invokedAsCli(): boolean {
  const entry = process.argv[1];
  return typeof entry === 'string' && path.parse(entry).name === 'sect-building-recovery-manifest';
}

if (invokedAsCli()) {
  process.exitCode = runSectBuildingRecoveryCli(process.argv.slice(2));
}
