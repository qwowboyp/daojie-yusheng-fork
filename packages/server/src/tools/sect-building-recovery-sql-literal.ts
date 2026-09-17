/**
 * PostgreSQL 安全字面值。不連庫。
 */
import type { CopyValue } from './sect-building-recovery-copy-parser';
import { isRecord } from './sect-building-recovery-hash';

export function pgSqlLiteral(value: CopyValue | undefined): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('non-finite number cannot be a SQL literal');
    }
    return String(value);
  }
  if (typeof value === 'string') {
    return quotePgString(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return 'ARRAY[]::text[]';
    }
    return `ARRAY[${value.map((item) => pgSqlLiteral(item)).join(', ')}]::text[]`;
  }
  if (isRecord(value)) {
    return `${quotePgString(JSON.stringify(value))}::jsonb`;
  }
  throw new Error('unsupported SQL literal');
}

function quotePgString(text: string): string {
  if (text.includes('\\')) {
    return `E'${text.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
  }
  return `'${text.replaceAll("'", "''")}'`;
}
