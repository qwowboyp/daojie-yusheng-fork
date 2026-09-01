/** 宗门目录 React 面板契约证明：容器查询样式、远程递帖 actionId 编码、挂载闸门与文案。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readPanelsCss } from './read-panels-css.mjs';

const require = createRequire(import.meta.url);
const {
  SECT_DIRECTORY_PAGE_DEFAULT_LIMIT,
  SECT_DIRECTORY_SEARCH_MAX_LENGTH,
} = require('@mud/shared');
const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const panelsStyleSource = readPanelsCss(clientRoot);
const panelCssSource = fs.readFileSync(
  path.join(clientRoot, 'src/styles/panels/sect-directory.css'),
  'utf8',
);
const panelSource = fs.readFileSync(
  path.join(clientRoot, 'src/react-ui/panels/sect-directory/SectDirectoryPanel.tsx'),
  'utf8',
);
const mountSource = fs.readFileSync(
  path.join(clientRoot, 'src/react-ui/panels/sect-directory/mount-sect-directory-panel.tsx'),
  'utf8',
);
const panelFlagsSource = fs.readFileSync(
  path.join(clientRoot, 'src/react-ui/bridge/panel-flags.ts'),
  'utf8',
);
const i18nSource = fs.readFileSync(
  path.join(clientRoot, 'src/content/i18n/zh-TW.csv'),
  'utf8',
);

// ─── 1. 样式必须使用容器查询而非媒体查询（随面板宽度而非视口宽度适配） ───
assert.match(
  panelCssSource,
  /\.sect-directory-panel\s*\{[\s\S]*?container-name:\s*sect-directory-panel;[\s\S]*?container-type:\s*inline-size;/,
  '宗門目錄面板根必須宣告 container-name 與 container-type: inline-size',
);
assert.match(
  panelCssSource,
  /@container\s+sect-directory-panel\s+\(max-width:\s*560px\)\s*\{/,
  '手機單欄佈局必須使用 @container 面板容器查詢',
);
assert.doesNotMatch(panelCssSource, /@media\b/, '宗門目錄面板不得再使用視口媒體查詢');

// ─── 2. 面板樣式必須納入 readPanelsCss 拼接順序（與 main.ts import 順序一致） ───
assert.ok(
  readPanelsCss(clientRoot).includes('.sect-directory-panel'),
  'read-panels-css 拼接結果必須包含宗門目錄面板樣式',
);

// ─── 3. 遠端遞帖必須以協議編碼送出 sect:apply-remote: action ───
assert.match(
  mountSource,
  /runtimeSender\.sendAction\(`sect:apply-remote:\$\{encodeURIComponent\(sectId\)\}`\)/,
  '遠端遞拜帖必須以 encodeURIComponent 編碼 sectId 並送出 sect:apply-remote: action',
);

// ─── 4. 面板必須經 panel-flags 閘門註冊掛載 ───
assert.match(panelFlagsSource, /'sect-directory'/, '宗門目錄面板必須註冊進 panel-flags 閘門');
assert.match(
  mountSource,
  /isReactPanelEnabled\('sect-directory'\)/,
  '宗門目錄面板掛載必須經 isReactPanelEnabled 檢查',
);

// ─── 5. 視圖關鍵文案與互動語義 ───
assert.match(panelSource, /遞交拜帖/, '可申請宗門卡片必須顯示遞交拜帖按鈕');
assert.match(panelSource, /拜帖審批中/, 'pending 關聯必須顯示拜帖審批中徽章/按鈕');
assert.match(panelSource, /onApply\(sect\.sectId\)/, '遞交按鈕必須回傳目標宗門 ID');
assert.match(
  mountSource,
  /currentApplying\.includes\(sectId\)/,
  '同一宗門重複點擊必須在送出前被 applyingSectIds 防抖攔截',
);
assert.match(
  mountSource,
  /sendRequestSectDirectory\(\{[\s\S]*?requestId[\s\S]*?search[\s\S]*?offset[\s\S]*?limit[\s\S]*?\}\)/,
  '目錄分頁請求必須攜帶 requestId/search/offset/limit',
);

// ─── 6. shared 契約常數與面板預設值一致 ───
assert.equal(SECT_DIRECTORY_PAGE_DEFAULT_LIMIT, 20, '目錄預設每頁 20 條');
assert.equal(SECT_DIRECTORY_SEARCH_MAX_LENGTH, 64, '目錄搜尋關鍵字最長 64 字元');
assert.match(panelSource, /limit:\s*SECT_DIRECTORY_PAGE_DEFAULT_LIMIT/, '面板預設 limit 必須引用 shared 常數');

// ─── 7. i18n 文案齊備 ───
for (const key of [
  'notice.sect.application-already-pending',
]) {
  assert.match(i18nSource, new RegExp(`^${key.replaceAll('.', '\\.')},`, 'm'), `缺少宗門目錄文案：${key}`);
}

console.log(JSON.stringify({ ok: true, case: 'sect-directory-panel' }, null, 2));
