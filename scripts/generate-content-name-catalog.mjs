/**
 * 本脚本生成客户端内容名称繁体目录（content-name-catalog.generated.json）。
 *
 * 来源：packages/server/data/content/*.json（简体真源），经 opencc-js（cn → tw）转成繁体。
 * 作用：客户端在繁体（zh-TW）语言下，将内容名称/描述解析为繁体展示；简体（zh-CN）不查此目录。
 *
 * 维护时保持与 server 内容真源的 id/name 字段一致，避免目录键与协议 id 分叉。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Converter } from 'opencc-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const contentDir = path.join(repoRoot, 'packages/server/data/content');
const targetPath = path.join(repoRoot, 'packages/client/src/constants/world/content-name-catalog.generated.json');

const cn2tw = Converter({ from: 'cn', to: 'tw' });

/** 简体字符串转繁体，非字符串原样返回。 */
function tw(value) {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed ? cn2tw(trimmed) : trimmed;
}

/** 读取目录下所有 .json 文件，返回合并后的数组（每个文件可能是数组或对象）。 */
function loadJsonFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  const results = [];
  for (const name of fs.readdirSync(dirPath)) {
    const fullPath = path.join(dirPath, name);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...loadJsonFiles(fullPath));
      continue;
    }
    if (!name.endsWith('.json')) {
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    } catch (error) {
      console.error(`解析失败：${fullPath}（${error.message}）`);
      process.exitCode = 1;
      continue;
    }
    if (Array.isArray(parsed)) {
      results.push(...parsed);
    } else if (parsed && typeof parsed === 'object') {
      // quests 用 { quests: [...] } 包裹
      const wrapped = parsed.quests;
      if (Array.isArray(wrapped)) {
        results.push(...wrapped);
      } else {
        results.push(parsed);
      }
    }
  }
  return results;
}

function loadMonsters() {
  const catalog = {};
  for (const monster of loadJsonFiles(path.join(contentDir, 'monsters'))) {
    if (!monster || typeof monster.id !== 'string') {
      continue;
    }
    catalog[monster.id] = {
      name: tw(monster.name),
    };
  }
  return catalog;
}

function loadItems() {
  const catalog = {};
  for (const item of loadJsonFiles(path.join(contentDir, 'items'))) {
    if (!item || typeof item.itemId !== 'string') {
      continue;
    }
    catalog[item.itemId] = {
      name: tw(item.name),
      ...(typeof item.desc === 'string' && item.desc ? { desc: tw(item.desc) } : {}),
    };
  }
  return catalog;
}

function loadTechniques() {
  const catalog = {};
  for (const technique of loadJsonFiles(path.join(contentDir, 'techniques'))) {
    if (!technique || typeof technique.id !== 'string') {
      continue;
    }
    catalog[technique.id] = {
      name: tw(technique.name),
      ...(typeof technique.desc === 'string' && technique.desc ? { desc: tw(technique.desc) } : {}),
    };
  }
  return catalog;
}

function loadQuests() {
  const catalog = {};
  for (const quest of loadJsonFiles(path.join(contentDir, 'quests'))) {
    if (!quest || typeof quest.id !== 'string') {
      continue;
    }
    catalog[quest.id] = {
      title: tw(quest.title),
      ...(typeof quest.desc === 'string' && quest.desc ? { desc: tw(quest.desc) } : {}),
      ...(typeof quest.story === 'string' && quest.story ? { story: tw(quest.story) } : {}),
      ...(typeof quest.chapter === 'string' && quest.chapter ? { chapter: tw(quest.chapter) } : {}),
      ...(typeof quest.objectiveText === 'string' && quest.objectiveText ? { objectiveText: tw(quest.objectiveText) } : {}),
      ...(typeof quest.targetNpcName === 'string' && quest.targetNpcName ? { targetNpcName: tw(quest.targetNpcName) } : {}),
      ...(typeof quest.targetName === 'string' && quest.targetName ? { targetName: tw(quest.targetName) } : {}),
    };
  }
  return catalog;
}

function loadRealmLevels() {
  const catalog = {};
  const realmPath = path.join(contentDir, 'realm-levels.json');
  if (!fs.existsSync(realmPath)) {
    return catalog;
  }
  let config;
  try {
    config = JSON.parse(fs.readFileSync(realmPath, 'utf8'));
  } catch {
    return catalog;
  }
  for (const level of config?.levels ?? []) {
    if (!level || typeof level.realmLv !== 'number') {
      continue;
    }
    catalog[String(level.realmLv)] = {
      name: tw(level.name),
      displayName: tw(level.displayName),
      ...(typeof level.review === 'string' && level.review ? { review: tw(level.review) } : {}),
      ...(typeof level.phaseName === 'string' && level.phaseName ? { phaseName: tw(level.phaseName) } : {}),
      ...(typeof level.gradeLabel === 'string' && level.gradeLabel ? { gradeLabel: tw(level.gradeLabel) } : {}),
    };
  }
  return catalog;
}

/** 收集技术/物品内的 buff 定义（consumeBuffs + 技能效果中的 buff）。 */
function collectBuffs(itemsCatalog, techniques) {
  const buffCatalog = {};
  for (const item of loadJsonFiles(path.join(contentDir, 'items'))) {
    for (const buff of item?.consumeBuffs ?? []) {
      if (buff && typeof buff.buffId === 'string') {
        buffCatalog[buff.buffId] = {
          name: tw(buff.name),
          ...(typeof buff.desc === 'string' && buff.desc ? { desc: tw(buff.desc) } : {}),
        };
      }
    }
  }
  // 技能效果中的 buff（含 shortMark 等）
  for (const technique of techniques) {
    for (const skill of technique?.skills ?? []) {
      for (const effect of skill?.effects ?? []) {
        if (effect && effect.type === 'buff' && typeof effect.buffId === 'string') {
          if (!buffCatalog[effect.buffId]) {
            buffCatalog[effect.buffId] = {
              ...(typeof effect.name === 'string' && effect.name ? { name: tw(effect.name) } : {}),
              ...(typeof effect.desc === 'string' && effect.desc ? { desc: tw(effect.desc) } : {}),
            };
          }
        }
      }
    }
  }
  return buffCatalog;
}

const monsters = loadMonsters();
const items = loadItems();
const techniques = loadTechniques();
const quests = loadQuests();
const realmLevels = loadRealmLevels();
const buffs = collectBuffs(items, Object.values(techniques));

const catalog = {
  version: 1,
  items,
  monsters,
  techniques,
  quests,
  realmLevels,
  buffs,
};

const output = `${JSON.stringify(catalog, null, 2)}\n`;
fs.mkdirSync(path.dirname(targetPath), { recursive: true });
if (!fs.existsSync(targetPath) || fs.readFileSync(targetPath, 'utf8') !== output) {
  fs.writeFileSync(targetPath, output);
  console.log(`已生成 content-name-catalog.generated.json（items=${Object.keys(items).length}, monsters=${Object.keys(monsters).length}, techniques=${Object.keys(techniques).length}, quests=${Object.keys(quests).length}, realmLevels=${Object.keys(realmLevels).length}, buffs=${Object.keys(buffs).length}）`);
} else {
  console.log('content-name-catalog.generated.json 无变更');
}
