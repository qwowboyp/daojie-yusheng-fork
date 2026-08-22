/** 本文件是客户端 DOM UI 的队伍面板主体，仅负责展示服务端视图和提交意图。 */
import type {
  PartyExpMode,
  PartyLootMode,
  PartyMemberView,
  PartyPanelView,
  PartyPurpose,
} from '@mud/shared';
import { PARTY_MAX_MEMBERS } from '@mud/shared';

export const PARTY_PURPOSE_LABELS: Record<PartyPurpose, string> = {
  general: '不限',
  leveling: '刷怪升級',
  boss: '討伐首領',
  tower: '挑戰高塔',
  exploration: '秘境探索',
};

export const PARTY_EXP_MODE_LABELS: Record<PartyExpMode, string> = {
  contribution: '按貢獻分配',
  equal: '全員平分',
};

export const PARTY_LOOT_MODE_LABELS: Record<PartyLootMode, string> = {
  killer: '擊殺者拾取',
  round_robin: '輪流拾取',
};

export const PARTY_REASON_LABELS: Record<string, string> = {
  party_not_found: '隊伍不存在或已解散',
  already_in_party: '你已在隊伍中',
  not_in_party: '你當前不在隊伍中',
  not_leader: '只有隊長可以執行此操作',
  leader_offline: '隊長離線期間無法執行管理操作，請等待隊長歸來',
  party_full: `队伍已满，最多 ${PARTY_MAX_MEMBERS} 人`,
  target_not_nearby: '目標不在附近',
  target_already_in_party: '對方已加入其他隊伍',
  invite_not_found: '邀請已失效',
  invite_expired: '邀請已過期',
  invite_already_sent: '已向對方發出邀請',
  invite_blocked: '對方暫不願被打擾',
  revision_mismatch: '隊伍狀態已變化，請刷新後重試',
  invalid_settings: '設置無效',
  invalid_purpose: '招募目的無效',
  invalid_realm_range: '境界範圍無效',
  invalid_note: '招募說明超長或無效',
  recruitment_not_found: '招募訊息不存在或已關閉',
  recruitment_already_open: '已有進行中的招募',
  application_not_found: '申請不存在或已處理',
  application_expired: '申請已過期',
  already_applied: '已向該隊伍提交申請',
  match_not_available: '自動匹配暫不可用',
  not_in_match_queue: '你當前不在匹配隊列中',
  invalid_message: '消息為空或過長',
  message_channel_busy: '隊伍消息較多，請稍後再試',
  party_persistence_disabled: '組隊系統暫不可用',
};

export type PartyStateSourceCallbacks = {
  onCreate(): void;
  onInviteByPlayerId(targetPlayerId: string): void;
  onInviteByPlayerNo(targetPlayerNo: number): void;
  onRespondInvite(inviteId: string, accept: boolean): void;
  onLeave(): void;
  onRemoveMember(targetPlayerId: string): void;
  onTransferLeader(targetPlayerId: string): void;
  onDisband(): void;
  onUpdateSettings(next: { expectedRevision: number; expMode?: PartyExpMode; lootMode?: PartyLootMode; friendlyFireEnabled?: boolean }): void;
  onPublishRecruitment(next: { expectedRevision: number; purpose: PartyPurpose; minRealmLv: number; maxRealmLv: number; note?: string }): void;
  onCloseRecruitment(expectedRevision: number): void;
  onRequestRecruitments(purpose?: PartyPurpose): void;
  onApplyRecruitment(listingId: string): void;
  onRespondApplication(applicationId: string, accept: boolean): void;
  onJoinMatch(purpose: PartyPurpose): void;
  onLeaveMatch(): void;
  onOpenChat(): void;
  onRequestRecruitmentCandidates(): void;
};

export type PartyPanelRenderState = {
  view: PartyPanelView;
  playerId: string | null;
  chatUnreadCount: number;
  recruitingPurpose: PartyPurpose;
  recruitmentLoaded: boolean;
};

function isPartyPurpose(value: string | undefined): value is PartyPurpose {
  return value === 'general' || value === 'leveling' || value === 'boss' || value === 'tower' || value === 'exploration';
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatRealm(realmLv: number): string {
  const lv = Math.max(0, Math.trunc(Number(realmLv) || 0));
  return lv > 0 ? `境界 ${lv} 层` : '境界未知';
}

function formatRatio(current: number | undefined, max: number | undefined): { text: string; percent: number } | null {
  if (typeof current !== 'number' || typeof max !== 'number' || max <= 0) {
    return null;
  }
  return { text: `${Math.max(0, Math.trunc(current))}/${Math.max(1, Math.trunc(max))}`, percent: Math.min(100, Math.max(0, (current / max) * 100)) };
}

export function renderPartyMemberCard(member: PartyMemberView, playerId: string | null, isLeaderView: boolean): string {
  const hp = formatRatio(member.hp, member.maxHp);
  const qi = formatRatio(member.qi, member.maxQi);
  const isSelf = member.playerId === playerId;
  const isLeader = member.role === 'leader';
  return `
    <div class="party-member-card ${member.online ? '' : 'offline'}" data-party-member="${escapeHtml(member.playerId)}">
      <div class="party-member-main">
        <div class="party-member-name">
          <span class="party-member-name-text">${escapeHtml(member.name)}</span>
          ${isLeader ? '<span class="party-member-badge leader">隊長</span>' : ''}
          ${isSelf ? '<span class="party-member-badge self">我</span>' : ''}
          ${member.online
            ? '<span class="party-member-status online">在線</span>'
            : '<span class="party-member-status offline">離線</span>'}
        </div>
        <div class="party-member-meta">${escapeHtml(formatRealm(member.realmLv))}${member.mapName ? ` · ${escapeHtml(member.mapName)}` : ''}</div>
        ${hp ? `<div class="party-member-bar hp" data-party-member-hp="true"><span style="width:${hp.percent.toFixed(1)}%"></span><em>${hp.text}</em></div>` : ''}
        ${qi ? `<div class="party-member-bar qi" data-party-member-qi="true"><span style="width:${qi.percent.toFixed(1)}%"></span><em>${qi.text}</em></div>` : ''}
      </div>
      ${isLeaderView && !isSelf && !isLeader ? `
        <div class="party-member-actions">
          <button class="small-btn ghost" type="button" data-party-action="transfer" data-player-id="${escapeHtml(member.playerId)}">移交队长</button>
          <button class="small-btn ghost danger" type="button" data-party-action="kick" data-player-id="${escapeHtml(member.playerId)}">移出队伍</button>
        </div>
      ` : ''}
    </div>
  `;
}
