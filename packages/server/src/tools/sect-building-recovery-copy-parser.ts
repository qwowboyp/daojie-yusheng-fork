/**
 * 解析 pg_restore data-only COPY SQL，保留欄位原值，不猜測座標或 payload。
 */

export type CopyScalar = string | number | boolean | null;
export type CopyValue = CopyScalar | readonly string[] | Readonly<Record<string, unknown>>;
export type CopyRow = Readonly<Record<string, CopyValue>>;

export type ParsedCopyTables = {
  readonly instance_building_state: readonly CopyRow[];
  readonly instance_building_cell: readonly CopyRow[];
  readonly instance_building_storage_item: readonly CopyRow[];
};

const COPY_HEADER =
  /^COPY\s+(?:public\.)?([a-z0-9_]+)\s*\(([^)]+)\)\s+FROM\s+stdin;\s*$/i;

const NUMERIC_COLUMNS = new Set([
  'tile_index',
  'x',
  'y',
  'rotation',
  'hp',
  'max_hp',
  'created_at_tick',
  'updated_at_tick',
  'revision',
  'slot_index',
  'count',
  'enhance_level',
]);

const BOOL_COLUMNS = new Set(['blocks_move', 'blocks_sight']);
const JSON_COLUMNS = new Set(['payload', 'raw_payload']);
const TEXT_ARRAY_COLUMNS = new Set(['previous_interactable_kinds']);
const KNOWN_TABLES = new Set([
  'instance_building_state',
  'instance_building_cell',
  'instance_building_storage_item',
]);

function unescapeCopyField(raw: string): string | null {
  if (raw === '\\N') {
    return null;
  }
  let out = '';
  for (let index = 0; index < raw.length; index += 1) {
    const ch = raw[index];
    if (ch !== '\\' || index === raw.length - 1) {
      out += ch;
      continue;
    }
    index += 1;
    const next = raw[index];
    if (next === 'N') {
      return null;
    }
    if (next === 'b') {
      out += '\b';
      continue;
    }
    if (next === 'f') {
      out += '\f';
      continue;
    }
    if (next === 'n') {
      out += '\n';
      continue;
    }
    if (next === 'r') {
      out += '\r';
      continue;
    }
    if (next === 't') {
      out += '\t';
      continue;
    }
    if (next === 'v') {
      out += '\v';
      continue;
    }
    out += next;
  }
  return out;
}

function parsePgTextArray(raw: string): string[] {
  if (raw === '{}' || raw === '') {
    return [];
  }
  const inner = raw.startsWith('{') && raw.endsWith('}') ? raw.slice(1, -1) : raw;
  if (inner === '') {
    return [];
  }
  return inner.split(',').map((part) => {
    const trimmed = part.trim();
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return trimmed.slice(1, -1).replace(/\\"/g, '"');
    }
    return trimmed;
  });
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function coerceCopyValue(column: string, raw: string | null): CopyValue {
  if (raw === null) {
    return null;
  }
  if (BOOL_COLUMNS.has(column)) {
    return raw === 't';
  }
  if (NUMERIC_COLUMNS.has(column)) {
    return Number(raw);
  }
  if (JSON_COLUMNS.has(column)) {
    const parsed: unknown = JSON.parse(raw);
    if (isJsonRecord(parsed)) {
      return parsed;
    }
    return { value: parsed };
  }
  if (TEXT_ARRAY_COLUMNS.has(column)) {
    return parsePgTextArray(raw);
  }
  return raw;
}

function parseCopyRow(columns: readonly string[], line: string): CopyRow {
  const fields = line.split('\t');
  const row: Record<string, CopyValue> = {};
  for (let index = 0; index < columns.length; index += 1) {
    const column = columns[index];
    row[column] = coerceCopyValue(column, unescapeCopyField(fields[index] ?? '\\N'));
  }
  return row;
}

export function parsePgRestoreCopySql(sqlText: string): ParsedCopyTables {
  const tables: {
    instance_building_state: CopyRow[];
    instance_building_cell: CopyRow[];
    instance_building_storage_item: CopyRow[];
  } = {
    instance_building_state: [],
    instance_building_cell: [],
    instance_building_storage_item: [],
  };
  const lines = sqlText.split(/\r?\n/);
  let current: { table: keyof typeof tables; columns: string[] } | null = null;
  for (const line of lines) {
    if (current) {
      if (line === '\\.') {
        current = null;
        continue;
      }
      tables[current.table].push(parseCopyRow(current.columns, line));
      continue;
    }
    const matched = COPY_HEADER.exec(line);
    if (!matched) {
      continue;
    }
    const tableName = matched[1];
    if (!KNOWN_TABLES.has(tableName)) {
      continue;
    }
    current = {
      table: tableName as keyof typeof tables,
      columns: matched[2].split(',').map((part) => part.trim()),
    };
  }
  return tables;
}
