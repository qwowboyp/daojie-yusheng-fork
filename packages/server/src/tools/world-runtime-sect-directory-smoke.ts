// @ts-nocheck

/**
 * 用途：验证宗门目录查询由服务端按活跃过滤、排序、搜索、分页和刷新节流返回。
 */
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { WorldRuntimeSectService } from '../runtime/world/world-runtime-sect.service';
import { buildDefaultSectRolePermissions } from '../runtime/world/world-runtime-sect-domain.helpers';

const SECT_DIRECTORY_RATE_LIMIT_MAX = 2;
const SECT_DIRECTORY_RATE_LIMIT_WINDOW_MS = 10_000;
const SECT_DIRECTORY_PAGE_DEFAULT_LIMIT = 20;
const SECT_DIRECTORY_PAGE_MAX_LIMIT = 50;

const leaderPlayers = new Map([
  ['leaderA', { id: 'leaderA', playerId: 'leaderA', name: '甲宗主', sectId: 'sect:alpha' }],
  ['leaderB', { id: 'leaderB', playerId: 'leaderB', name: '乙宗主', sectId: 'sect:beta' }],
  ['leaderC', { id: 'leaderC', playerId: 'leaderC', name: '丙宗主', sectId: 'sect:gamma' }],
  ['memberA1', { id: 'memberA1', playerId: 'memberA1', name: '青云弟子', sectId: 'sect:alpha' }],
  ['memberB1', { id: 'memberB1', playerId: 'memberB1', name: '落霞弟子', sectId: 'sect:beta' }],
  ['memberB2', { id: 'memberB2', playerId: 'memberB2', name: '落霞执事', sectId: 'sect:beta' }],
]);

const playerRuntimeService = {
  getPlayer(playerId: string) {
    return leaderPlayers.get(playerId) ?? null;
  },
  getPlayerOrThrow(playerId: string) {
    const player = leaderPlayers.get(playerId);
    if (!player) {
      throw new Error('玩家不存在');
    }
    return player;
  },
};

const service = new WorldRuntimeSectService({}, {}, playerRuntimeService);

function registerSect(sect) {
  service.sectsById.set(sect.sectId, sect);
}

registerSect({
  sectId: 'sect:alpha',
  sectInstanceId: 'sect-domain:alpha',
  coreX: 0,
  coreY: 0,
  name: '青云宗',
  mark: '青',
  status: 'active',
  leaderPlayerId: 'leaderA',
  entranceTemplateId: 'yunlai_town',
  entranceX: 3,
  entranceY: 4,
  createdAt: 100,
  updatedAt: 100,
  rolePermissions: buildDefaultSectRolePermissions(),
  members: [
    { playerId: 'leaderA', name: '甲宗主', roleId: 'leader', joinedAt: 1 },
    { playerId: 'memberA1', name: '青云弟子', roleId: 'outer', joinedAt: 2 },
  ],
  applications: [],
});
registerSect({
  sectId: 'sect:beta',
  sectInstanceId: 'sect-domain:beta',
  coreX: 0,
  coreY: 0,
  name: '落霞谷',
  mark: '霞',
  status: 'active',
  leaderPlayerId: 'leaderB',
  entranceTemplateId: 'yunlai_town',
  entranceX: 5,
  entranceY: 6,
  createdAt: 300,
  updatedAt: 300,
  rolePermissions: buildDefaultSectRolePermissions(),
  members: [
    { playerId: 'leaderB', name: '乙宗主', roleId: 'leader', joinedAt: 1 },
    { playerId: 'memberB1', name: '落霞弟子', roleId: 'outer', joinedAt: 2 },
    { playerId: 'memberB2', name: '落霞执事', roleId: 'outer', joinedAt: 3 },
  ],
  applications: [],
});
registerSect({
  sectId: 'sect:gamma',
  sectInstanceId: 'sect-domain:gamma',
  coreX: 0,
  coreY: 0,
  name: '浩然门',
  mark: '浩',
  status: 'active',
  leaderPlayerId: 'leaderC',
  entranceTemplateId: 'yunlai_town',
  entranceX: 7,
  entranceY: 8,
  createdAt: 200,
  updatedAt: 500,
  rolePermissions: buildDefaultSectRolePermissions(),
  members: [
    { playerId: 'leaderC', name: '丙宗主', roleId: 'leader', joinedAt: 1 },
  ],
  applications: [],
});
registerSect({
  sectId: 'sect:ghost',
  sectInstanceId: 'sect-domain:ghost',
  coreX: 0,
  coreY: 0,
  name: '已解散宗门',
  mark: '散',
  status: 'dissolved',
  leaderPlayerId: 'leaderA',
  entranceTemplateId: 'yunlai_town',
  entranceX: 1,
  entranceY: 1,
  createdAt: 50,
  updatedAt: 50,
  rolePermissions: buildDefaultSectRolePermissions(),
  members: [],
  applications: [],
});
registerSect({
  sectId: 'sect:empty',
  sectInstanceId: 'sect-domain:empty',
  coreX: 0,
  coreY: 0,
  name: '空壳宗门',
  mark: '空',
  status: 'active',
  leaderPlayerId: 'leaderA',
  entranceTemplateId: 'yunlai_town',
  entranceX: 9,
  entranceY: 9,
  createdAt: 60,
  updatedAt: 60,
  rolePermissions: buildDefaultSectRolePermissions(),
  members: [],
  applications: [],
});

// 过滤：dissolved 与空宗門不得出现
const filterView = service.buildSectDirectoryView('leaderA', { requestId: 'dir:filter' });
assert.equal(filterView.total, 3, 'dissolved / 空宗必須被過濾');
assert.equal(filterView.items.length, 3);
assert.ok(
  filterView.items.every((entry) => !['sect:ghost', 'sect:empty'].includes(entry.sectId)),
  '目錄不得包含已解散或空宗門',
);

// 排序：memberCount DESC → createdAt ASC → sectId
assert.deepEqual(
  filterView.items.map((entry) => entry.sectId),
  ['sect:beta', 'sect:alpha', 'sect:gamma'],
  '排序必須先按成員數降序，再按創宗時間升序',
);
assert.deepEqual(
  filterView.items.map((entry) => entry.memberCount),
  [3, 2, 1],
);

// 分頁：offset/limit 與預設 limit
const firstPage = service.buildSectDirectoryView('leaderA', { requestId: 'dir:p1', offset: 0, limit: 2 });
assert.equal(firstPage.items.length, 2);
assert.deepEqual(firstPage.items.map((entry) => entry.sectId), ['sect:beta', 'sect:alpha']);
const secondPage = service.buildSectDirectoryView('leaderA', { requestId: 'dir:p2', offset: 2, limit: 2 });
assert.equal(secondPage.items.length, 1);
assert.deepEqual(secondPage.items.map((entry) => entry.sectId), ['sect:gamma']);
const defaultLimitView = service.buildSectDirectoryView('leaderA', { requestId: 'dir:default' });
assert.equal(defaultLimitView.limit, SECT_DIRECTORY_PAGE_DEFAULT_LIMIT, '未指定 limit 必須用預設值');
const cappedLimitView = service.buildSectDirectoryView('leaderA', { requestId: 'dir:cap', limit: 999 });
assert.equal(cappedLimitView.limit, SECT_DIRECTORY_PAGE_MAX_LIMIT, 'limit 必須被收斂到上限');

// 搜索：按宗名包含（折疊空白 + 小寫）
const searchView = service.buildSectDirectoryView('leaderA', { requestId: 'dir:search', search: '  浩  ' });
assert.equal(searchView.search, '浩');
assert.deepEqual(searchView.items.map((entry) => entry.sectId), ['sect:gamma']);
const emptySearchView = service.buildSectDirectoryView('leaderA', { requestId: 'dir:search-empty', search: '   ' });
assert.equal(emptySearchView.total, 3, '空白搜尋詞必須等價於無搜尋');

// 條目字段：entranceMapName 由模板解析（無模板時回退地圖 ID）、不帶 entranceInstanceId
const alphaEntry = filterView.items.find((entry) => entry.sectId === 'sect:alpha');
assert.equal(alphaEntry.name, '青云宗');
assert.equal(alphaEntry.mark, '青');
assert.equal(alphaEntry.memberCount, 2);
assert.equal(alphaEntry.leaderPlayerId, 'leaderA');
assert.equal(alphaEntry.leaderName, '甲宗主', '宗主名稱必須由 runtime 玩家名解析');
assert.equal(alphaEntry.entranceMapName, 'yunlai_town');
assert.equal(alphaEntry.entranceX, 3);
assert.equal(alphaEntry.entranceY, 4);
assert.equal(alphaEntry.createdAt, 100);
assert.equal('entranceInstanceId' in alphaEntry, false, '不得外送 entranceInstanceId');

// relation：leader / member / none / pending
assert.equal(alphaEntry.relation, 'leader', '宗主看自己宗門必須是 leader');
assert.equal(alphaEntry.canApply, false, '宗主不可對自己宗門遞帖');
const memberView = service.buildSectDirectoryView('memberB2', { requestId: 'dir:member' });
assert.equal(
  memberView.items.find((entry) => entry.sectId === 'sect:beta').relation,
  'member',
);
assert.equal(memberView.items.find((entry) => entry.sectId === 'sect:beta').canApply, false);
assert.equal(
  memberView.items.find((entry) => entry.sectId === 'sect:alpha').relation,
  'none',
  '非成員看其他宗門必須是 none',
);
assert.equal(memberView.items.find((entry) => entry.sectId === 'sect:alpha').canApply, true);

// pending：有未審批申請的非成員玩家看該宗門顯示 pending 且不可遞帖
const betaSect = service.findSectById('sect:beta');
betaSect.applications.push({
  playerId: 'applicantX',
  name: '申請人',
  status: 'pending',
  appliedAt: 1,
  updatedAt: 1,
});
leaderPlayers.set('applicantX', { id: 'applicantX', playerId: 'applicantX', name: '申請人', sectId: null });
const pendingView = service.buildSectDirectoryView('applicantX', { requestId: 'dir:pending' });
assert.equal(pendingView.items.find((entry) => entry.sectId === 'sect:beta').relation, 'pending');
assert.equal(pendingView.items.find((entry) => entry.sectId === 'sect:beta').canApply, false);

// canApply：已另領一宗（他宗宗主）不得再對其他宗門遞帖
const leaderBView = service.buildSectDirectoryView('leaderB', { requestId: 'dir:leaderB' });
assert.equal(leaderBView.items.find((entry) => entry.sectId === 'sect:alpha').canApply, false, '他宗宗主不得再對別宗遞帖');
assert.equal(leaderBView.items.find((entry) => entry.sectId === 'sect:gamma').canApply, false);

// revision：掃描內最大 updatedAt，且隨 updatedAt 變化
assert.equal(filterView.revision, 500, 'revision 必須等於掃描內最大 updatedAt');
service.findSectById('sect:alpha').updatedAt = 900;
const bumpView = service.buildSectDirectoryView('leaderA', { requestId: 'dir:rev2' });
assert.equal(bumpView.revision, 900, 'revision 必須隨宗門 updatedAt 提高');

// 節流：10 秒窗口內第 3 次請求必須被拒絕
service.directoryRequestAtByPlayerId.delete('memberB2');
const now = Date.now();
assert.equal(service.consumeSectDirectoryRateLimit('memberB2', now), true, '第 1 次請求必須放行');
assert.equal(service.consumeSectDirectoryRateLimit('memberB2', now), true, '第 2 次請求必須放行');
assert.equal(service.consumeSectDirectoryRateLimit('memberB2', now), false, '第 3 次請求必須被節流拒絕');
assert.equal(
  service.consumeSectDirectoryRateLimit('memberB2', now + SECT_DIRECTORY_RATE_LIMIT_WINDOW_MS + 1),
  true,
  '窗口過期後必須恢復額度',
);

// 非法請求 ID 必須被拒絕
assert.throws(
  () => service.buildSectDirectoryView('leaderA', { requestId: '' }),
  (error) => error instanceof BadRequestException,
  '空請求 ID 必須被拒絕',
);

console.log(JSON.stringify({ ok: true, case: 'world-runtime-sect-directory' }, null, 2));
