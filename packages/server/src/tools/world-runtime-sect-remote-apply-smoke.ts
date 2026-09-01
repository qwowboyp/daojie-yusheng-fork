// @ts-nocheck

/**
 * 用途：验证远程递拜帖（sect:apply-remote:）绕过位置闸、防灌水三闸顺序、
 * 同宗 pending 短路语义与走路递帖行为完全不变。
 */
import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { WorldRuntimeSectService } from '../runtime/world/world-runtime-sect.service';
import { buildDefaultSectRolePermissions } from '../runtime/world/world-runtime-sect-domain.helpers';

const applicantId = 'applicant:remote';
const applicant = { id: applicantId, playerId: applicantId, name: '遠端散修', sectId: null, x: 9, y: 9 };

const players = new Map([
  [applicantId, applicant],
  ['leaderA', { id: 'leaderA', playerId: 'leaderA', name: '甲宗主', sectId: 'sect:alpha' }],
  ['leaderB', { id: 'leaderB', playerId: 'leaderB', name: '乙宗主', sectId: 'sect:beta' }],
  ['leaderC', { id: 'leaderC', playerId: 'leaderC', name: '丙宗主', sectId: 'sect:gamma' }],
  ['leaderD', { id: 'leaderD', playerId: 'leaderD', name: '丁宗主', sectId: 'sect:delta' }],
]);

const notices = [];
const mails = [];
const playerViews = [];

const playerRuntimeService = {
  getPlayer(targetPlayerId) {
    return players.get(targetPlayerId) ?? null;
  },
  getPlayerOrThrow(targetPlayerId) {
    const target = players.get(targetPlayerId);
    if (!target) throw new Error(`missing player ${targetPlayerId}`);
    return target;
  },
  setPlayerSectId(targetPlayerId, sectId) {
    const target = players.get(targetPlayerId);
    if (target) target.sectId = sectId;
  },
};

const mailRuntimeService = {
  async createDirectMail(targetPlayerId, input) {
    mails.push({ playerId: targetPlayerId, ...input });
    return `mail:${targetPlayerId}:${mails.length}`;
  },
};

const service = new WorldRuntimeSectService(
  {},
  {},
  playerRuntimeService,
  mailRuntimeService,
);

// 玩家遠離任何山門：位置閘必須放行遠端、攔截走路
const deps = {
  queuePlayerNotice(targetPlayerId, text, kind, _undefined, _undefined2, structured) {
    notices.push({ playerId: targetPlayerId, text, kind, structured });
  },
  getPlayerLocationOrThrow(targetPlayerId) {
    assert.ok(players.has(targetPlayerId));
    return { instanceId: 'world:elsewhere', sessionId: 'session:remote' };
  },
  getPlayerViewOrThrow(targetPlayerId) {
    playerViews.push(targetPlayerId);
    return { playerId: targetPlayerId, instance: { instanceId: 'world:elsewhere' } };
  },
  refreshPlayerContextActions() {},
};

function registerSect(sect) {
  service.sectsById.set(sect.sectId, sect);
}

function makeSect(sectId, leaderPlayerId, name) {
  return {
    sectId,
    sectInstanceId: `sect-domain:${sectId.split(':')[1]}`,
    coreX: 0,
    coreY: 0,
    name,
    mark: name.slice(0, 1),
    status: 'active',
    leaderPlayerId,
    entranceInstanceId: 'world:elsewhere',
    entranceTemplateId: 'yunlai_town',
    entranceX: 3,
    entranceY: 4,
    createdAt: 100,
    updatedAt: 100,
    rolePermissions: buildDefaultSectRolePermissions(),
    members: [
      { playerId: leaderPlayerId, name, roleId: 'leader', joinedAt: 1 },
    ],
    applications: [],
  };
}

const sects = {
  alpha: makeSect('sect:alpha', 'leaderA', '青雲宗'),
  beta: makeSect('sect:beta', 'leaderB', '落霞谷'),
  gamma: makeSect('sect:gamma', 'leaderC', '浩然門'),
  delta: makeSect('sect:delta', 'leaderD', '太虛閣'),
};
for (const sect of Object.values(sects)) {
  registerSect(sect);
}

const remoteAction = (sectId) => `sect:apply-remote:${encodeURIComponent(sectId)}`;
const walkAction = (sectId) => `sect:apply:${encodeURIComponent(sectId)}`;

function leaderMailsFor(leaderPlayerId) {
  return mails.filter((entry) => entry.playerId === leaderPlayerId);
}

function pendingCount() {
  let count = 0;
  for (const sect of service.sectsById.values()) {
    if (sect.status === 'dissolved') continue;
    if ((sect.applications ?? []).some((entry) => entry.playerId === applicantId && entry.status === 'pending')) {
      count += 1;
    }
  }
  return count;
}

async function main() {
  // 1. 遠端遞帖：不在山門前也必須成功
  await service.executeSectAction(applicantId, remoteAction('sect:alpha'), deps);
  assert.equal(
    sects.alpha.applications.some((entry) => entry.playerId === applicantId && entry.status === 'pending'),
    true,
    '遠端遞帖必須在遠離山門時成功建立 pending 申請',
  );
  assert.equal(pendingCount(), 1);

  // 7. 前綴：sect:apply-remote: 不能被 sect:apply: 吃掉（成功即證明）

  // 2. 走路遞帖：錯誤文案逐字不變（實例不符 + 超過互動半徑兩道閘）
  await assert.rejects(
    service.executeSectAction(applicantId, walkAction('sect:beta'), {
      ...deps,
      getPlayerLocationOrThrow() {
        return { instanceId: 'world:another', sessionId: 'session:remote' };
      },
    }),
    (error) => error instanceof BadRequestException
      && error.message === '需要在該宗門山門前遞交拜帖',
    '走路遞帖必須維持「需要在該宗門山門前遞交拜帖」',
  );
  await assert.rejects(
    service.executeSectAction(applicantId, walkAction('sect:beta'), deps),
    (error) => error instanceof BadRequestException
      && error.message === '需要靠近護宗大陣前的山門傳送點',
    '走路遞帖必須維持「需要靠近護宗大陣前的山門傳送點」',
  );

  // 4. 冷卻內同宗重複遞帖：must hit ①already-pending 而非②冷卻
  const noticesBefore = notices.length;
  await service.executeSectAction(applicantId, remoteAction('sect:alpha'), deps);
  const alreadyPendingNotice = notices.slice(noticesBefore).find(
    (entry) => entry.structured?.key === 'notice.sect.application-already-pending',
  );
  assert.ok(alreadyPendingNotice, '同宗 pending 重複遞帖必須發 already-pending 通知');
  assert.equal(
    notices.slice(noticesBefore).some((entry) => entry.structured?.key === 'notice.sect.application-submitted'),
    false,
    '同宗 pending 短路不得重發申請提交通知',
  );

  // 6. 同宗 pending 重複不重置 appliedAt、不重發宗主郵件
  const appliedAt = sects.alpha.applications.find((entry) => entry.playerId === applicantId).appliedAt;
  const alphaLeaderMailsBefore = leaderMailsFor('leaderA').length;
  await service.executeSectAction(applicantId, remoteAction('sect:alpha'), deps);
  assert.equal(
    sects.alpha.applications.find((entry) => entry.playerId === applicantId).appliedAt,
    appliedAt,
    '同宗 pending 短路不得重置 appliedAt',
  );
  assert.equal(
    leaderMailsFor('leaderA').length,
    alphaLeaderMailsBefore,
    '同宗 pending 短路不得重發宗主郵件',
  );

  // 3. 冷卻內異宗二連發被冷卻拒絕
  await assert.rejects(
    service.executeSectAction(applicantId, remoteAction('sect:beta'), deps),
    (error) => error instanceof BadRequestException
      && /拜帖剛遞出/.test(error.message),
    '冷卻內遠端異宗遞帖必須被冷卻拒絕',
  );

  // 清掉同宗 pending 以便冷卻後測試跨宗上限（alpha pending 佔 1 個名額）
  service.findSectById('sect:alpha').applications = [];

  // 5. 冷卻結束後：4th 跨宗 pending 被拒、3 個允許
  // 每次成功遞帖會設 30s 冷卻，逐次把冷卻撥回過去以專注測跨宗上限
  const clearCooldown = () => service.nextRemoteApplyAllowedAtByPlayerId.set(applicantId, Date.now() - 1);
  clearCooldown();
  await service.executeSectAction(applicantId, remoteAction('sect:alpha'), deps);
  clearCooldown();
  await service.executeSectAction(applicantId, remoteAction('sect:beta'), deps);
  clearCooldown();
  await service.executeSectAction(applicantId, remoteAction('sect:gamma'), deps);
  assert.equal(pendingCount(), 3, '跨宗同時 pending 最多允許 3 個');
  clearCooldown();
  await assert.rejects(
    service.executeSectAction(applicantId, remoteAction('sect:delta'), deps),
    (error) => error instanceof BadRequestException
      && /你已有太多待審拜帖/.test(error.message),
    '第 4 個跨宗 pending 必須被拒絕',
  );

  // 8. 清理：撤銷所有測試宗門與申請
  for (const key of Object.keys(sects)) {
    service.sectsById.delete(sects[key].sectId);
  }
  service.nextRemoteApplyAllowedAtByPlayerId.clear();

  console.log(JSON.stringify({ ok: true, case: 'world-runtime-sect-remote-apply' }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
