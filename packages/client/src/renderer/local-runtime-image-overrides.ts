/**
 * 本文件负责客户端运行时图包的本地地形资源覆盖。
 *
 * 覆盖只写入当前浏览器 localStorage，不改变服务端真源、manifest 或资源文件。
 * 实体形象（玩家/怪物/NPC）已由服务器头像（server-avatar-registry）统一供给，
 * 本地覆盖仅对地形类 key（terrain:/surface:/structure:/interactable:）生效。
 */

export interface RuntimeImageResourceEntry {
  key: string;
  label: string;
  src: string;
  aliasKeys?: string[];
}

export interface RuntimeImageOverrideEntry {
  key: string;
  dataUrl: string;
  fileName: string;
  updatedAt: number;
}

type RuntimeImageOverridesSnapshot = Record<string, RuntimeImageOverrideEntry>;

type RuntimeImagePackManifest = {
  tiles?: Record<string, unknown>;
};

const MANIFEST_URL = '/assets/runtime-image-packs/default/manifest.json';
const STORAGE_KEY = 'mud:runtime-image-overrides:v1';
const RELOAD_LIST_STORAGE_KEY = 'mud:runtime-image-reload-list:v1';
export const RUNTIME_IMAGE_OVERRIDES_CHANGED_EVENT = 'mud:runtime-image-overrides-changed';

const TILE_LABELS: Record<string, string> = {
  'terrain:floor': '地形 · 平地',
  'terrain:grass': '地形 · 草地',
  'terrain:hill': '地形 · 山丘',
  'terrain:water': '地形 · 水域',
  'terrain:mud': '地形 · 泥地',
  'terrain:swamp': '地形 · 沼澤',
  'terrain:cold_bog': '地形 · 寒潭',
  'terrain:molten_pool': '地形 · 熔岩',
  'terrain:cloud_floor': '地形 · 霞臺',
  'terrain:cloud': '地形 · 雲海',
  'terrain:void': '地形 · 虛空',
  'terrain:cliff': '地形 · 峭壁',
  'surface:floor': '地表 · 石板',
  'surface:trail': '地表 · 小徑',
  'surface:road': '地表 · 大路',
  'surface:veranda': '地表 · 迴廊',
  'surface:stone_stairs': '地表 · 石階',
  'structure:wall': '結構 · 牆',
  'structure:door': '結構 · 門',
  'structure:window': '結構 · 窗',
  'structure:house_eave': '結構 · 屋簷',
  'structure:house_corner': '結構 · 簷角',
  'structure:screen_wall': '結構 · 影壁',
  'structure:tree': '結構 · 樹木',
  'structure:bamboo': '結構 · 翠竹',
  'structure:stone': '結構 · 岩石',
  'structure:spirit_ore': '結構 · 靈礦',
  'structure:black_iron_ore': '結構 · 玄鐵礦',
  'structure:broken_sword_heap': '結構 · 斷劍堆',
};

let resources: RuntimeImageResourceEntry[] = [];let resourceLoadPromise: Promise<RuntimeImageResourceEntry[]> | null = null;
let overrides: RuntimeImageOverridesSnapshot | null = null;
let overrideMutationSequence = 0;
const pendingOverrideMutationByKey = new Map<string, number>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeKey(value: string): string {
  return value.trim();
}

function resolveResourceLabel(key: string): string {
  if (TILE_LABELS[key]) return TILE_LABELS[key]!;
  const [prefix, rawId = key] = key.split(':', 2);
  const kindLabel = prefix === 'terrain'
    ? '地形'
    : prefix === 'surface'
      ? '地表'
      : prefix === 'structure'
        ? '結構'
        : prefix === 'interactable'
          ? '交互物'
          : '地塊';
  return `${kindLabel} · ${rawId.replace(/[_-]+/g, ' ')}`;
}

function readManifestTileResourceEntries(value: unknown): RuntimeImageResourceEntry[] {
  if (!isRecord(value)) return [];
  const entries: RuntimeImageResourceEntry[] = [];
  for (const [rawKey, rawRef] of Object.entries(value)) {
    const key = normalizeKey(rawKey);
    if (!key || !isRecord(rawRef) || typeof rawRef.src !== 'string' || rawRef.src.trim().length === 0) {
      continue;
    }
    entries.push({
      key,
      label: resolveResourceLabel(key),
      src: rawRef.src.trim(),
    });
  }
  return entries;
}

function sortResourceEntries(left: RuntimeImageResourceEntry, right: RuntimeImageResourceEntry): number {
  return left.key.localeCompare(right.key, 'zh-Hans-CN');
}

function readStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readStoredOverrides(): RuntimeImageOverridesSnapshot {
  const storage = readStorage();
  if (!storage) return {};
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return {};
    const next: RuntimeImageOverridesSnapshot = {};
    for (const [rawKey, rawValue] of Object.entries(parsed)) {
      const key = normalizeKey(rawKey);
      if (!key || !isRecord(rawValue)) continue;
      const dataUrl = typeof rawValue.dataUrl === 'string' ? rawValue.dataUrl : '';
      if (!dataUrl.startsWith('data:image/')) continue;
      next[key] = {
        key,
        dataUrl,
        fileName: typeof rawValue.fileName === 'string' ? rawValue.fileName : '',
        updatedAt: Number.isFinite(Number(rawValue.updatedAt)) ? Number(rawValue.updatedAt) : 0,
      };
    }
    return next;
  } catch {
    return {};
  }
}

function getMutableOverrides(): RuntimeImageOverridesSnapshot {
  if (!overrides) overrides = readStoredOverrides();
  return overrides;
}

function persistOverrides(next: RuntimeImageOverridesSnapshot): void {
  const storage = readStorage();
  if (!storage) {
    throw new Error('local_runtime_image_override_storage_failed');
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 图片覆盖较大时 localStorage 可能被浏览器拒绝，调用方会通过返回状态提示玩家。
    throw new Error('local_runtime_image_override_storage_failed');
  }
  // 持久化是正式真源；只有写入成功后才发布新内存快照和刷新事件。
  overrides = next;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(RUNTIME_IMAGE_OVERRIDES_CHANGED_EVENT, {
      detail: getRuntimeImageOverrides(),
    }));
  }
}

function beginOverrideMutation(key: string): number {
  overrideMutationSequence += 1;
  pendingOverrideMutationByKey.set(key, overrideMutationSequence);
  return overrideMutationSequence;
}

function invalidateOverrideMutation(key: string): void {
  pendingOverrideMutationByKey.delete(key);
}

function assertCurrentOverrideMutation(key: string, mutation: number): void {
  if (pendingOverrideMutationByKey.get(key) !== mutation) {
    throw new Error('local_runtime_image_override_superseded');
  }
}

function finishOverrideMutation(key: string, mutation: number): void {
  if (pendingOverrideMutationByKey.get(key) === mutation) {
    pendingOverrideMutationByKey.delete(key);
  }
}

export function getRuntimeImageOverrides(): RuntimeImageOverrideEntry[] {
  return Object.values(getMutableOverrides()).sort((left, right) => right.updatedAt - left.updatedAt || left.key.localeCompare(right.key));
}

export function getRuntimeImageOverride(key: string): RuntimeImageOverrideEntry | null {
  return getMutableOverrides()[key] ?? null;
}

/** 本地覆盖仅对地形类 key 生效；实体形象统一走服务器头像，旧实体覆盖数据不再生效。 */
const TILE_OVERRIDE_KEY_PREFIXES = ['terrain:', 'surface:', 'structure:', 'interactable:'] as const;

export function resolveRuntimeImageOverrideSrc(key: string, fallbackSrc: string): string {
  if (!TILE_OVERRIDE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) return fallbackSrc;
  return getRuntimeImageOverride(key)?.dataUrl ?? fallbackSrc;
}

export function getRuntimeImageReloadListKeys(): string[] {
  const storage = readStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(RELOAD_LIST_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const keys: string[] = [];
    for (const item of parsed) {
      if (typeof item !== 'string') continue;
      const key = normalizeKey(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
    return keys;
  } catch {
    return [];
  }
}

export function setRuntimeImageReloadListKeys(keys: readonly string[]): void {
  const storage = readStorage();
  if (!storage) return;
  const seen = new Set<string>();
  const normalizedKeys: string[] = [];
  for (const item of keys) {
    const key = normalizeKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    normalizedKeys.push(key);
  }
  try {
    storage.setItem(RELOAD_LIST_STORAGE_KEY, JSON.stringify(normalizedKeys));
  } catch {
    // 列表本身很小；失败时只影响下次打开设置面板，不影响本次会话。
  }
}

export function removeRuntimeImageOverride(key: string): void {
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey) return;
  // “恢复默认”也是该 key 的最新意图，必须让仍在读取的旧文件失效。
  invalidateOverrideMutation(normalizedKey);
  const current = getMutableOverrides();
  if (!current[normalizedKey]) return;
  const next = { ...current };
  delete next[normalizedKey];
  persistOverrides(next);
}

export async function loadRuntimeImageResourceCatalog(): Promise<RuntimeImageResourceEntry[]> {
  if (resources.length > 0) return resources;
  if (resourceLoadPromise) return resourceLoadPromise;
  resourceLoadPromise = fetch(MANIFEST_URL, { cache: 'no-cache' })
    .then(async (response) => {
      if (!response.ok) throw new Error(`runtime_image_resource_manifest_http_${response.status}`);
      const manifest = await response.json() as RuntimeImagePackManifest;
      // 只提供地形类资源目录；实体形象已由服务器头像统一供给。
      resources = readManifestTileResourceEntries(manifest.tiles).sort(sortResourceEntries);
      return resources;
    })
    .catch((error) => {
      resourceLoadPromise = null;
      throw error;
    });
  return resourceLoadPromise;
}

export async function saveRuntimeImageOverrideFromFile(key: string, file: File): Promise<RuntimeImageOverrideEntry> {
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey) throw new Error('local_runtime_image_override_empty_key');
  if (!file.type.startsWith('image/')) throw new Error('local_runtime_image_override_not_image');
  // 目录清单是懒加载的 UI 数据，save 不能依赖它；用 tile 前缀判定即可拒绝实体类 key。
  if (!TILE_OVERRIDE_KEY_PREFIXES.some((prefix) => normalizedKey.startsWith(prefix))) {
    throw new Error('local_runtime_image_override_unknown_key');
  }
  const mutation = beginOverrideMutation(normalizedKey);
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('local_runtime_image_override_read_failed'));
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        if (!result.startsWith('data:image/')) {
          reject(new Error('local_runtime_image_override_read_failed'));
          return;
        }
        resolve(result);
      };
      reader.readAsDataURL(file);
    });
    assertCurrentOverrideMutation(normalizedKey, mutation);
    const nextEntry: RuntimeImageOverrideEntry = {
      key: normalizedKey,
      dataUrl,
      fileName: file.name,
      updatedAt: Date.now(),
    };
    persistOverrides({
      ...getMutableOverrides(),
      [normalizedKey]: nextEntry,
    });
    return nextEntry;
  } finally {
    finishOverrideMutation(normalizedKey, mutation);
  }
}
