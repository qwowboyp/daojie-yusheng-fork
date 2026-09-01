/**
 * 本文件負責 宗門目錄 面板的主要 React 視圖入口，統一承接狀態展示、使用者操作回呼和樣式組合。
 *
 * 維護時要保持它只處理前端表現和組件契約，不保存業務真源，也不繞過共享規則或服務端權威運行時。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  SECT_DIRECTORY_PAGE_DEFAULT_LIMIT,
  SECT_DIRECTORY_SEARCH_MAX_LENGTH,
  type SectDirectoryEntry,
  type SectDirectoryView,
} from '@mud/shared';
import { createPanelStore } from '../../stores/create-panel-store';

// ─── Store ───────────────────────────────────────────────────────────────────

export interface SectDirectoryPanelState {
  items: SectDirectoryEntry[];
  total: number;
  offset: number;
  limit: number;
  search: string;
  revision: number;
  loading: boolean;
  applyingSectIds: string[];
  error: string | null;
}

const EMPTY_PAGE_STATE: SectDirectoryPanelState = {
  items: [],
  total: 0,
  offset: 0,
  limit: SECT_DIRECTORY_PAGE_DEFAULT_LIMIT,
  search: '',
  revision: 0,
  loading: false,
  applyingSectIds: [],
  error: null,
};

export const {
  store: sectDirectoryStore,
  useStore: useSectDirectoryStore,
} = createPanelStore<SectDirectoryPanelState>(EMPTY_PAGE_STATE);

// ─── Callbacks ───────────────────────────────────────────────────────────────

export interface SectDirectoryPanelCallbacks {
  onRequestPage: ((search: string, offset: number, limit: number) => void) | null;
  onApplyRemote: ((sectId: string) => void) | null;
  onClose: (() => void) | null;
}

const callbacks: SectDirectoryPanelCallbacks = {
  onRequestPage: null,
  onApplyRemote: null,
  onClose: null,
};

export function setSectDirectoryCallbacks(cbs: Partial<SectDirectoryPanelCallbacks>): void {
  Object.assign(callbacks, cbs);
}

// ─── 輔助函式 ────────────────────────────────────────────────────────────────

const DATE_FORMATTER = new Intl.DateTimeFormat('zh-TW', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function formatCreatedDate(timestamp: number): string {
  if (!timestamp || isNaN(timestamp)) {
    return '-';
  }
  try {
    return DATE_FORMATTER.format(new Date(timestamp));
  } catch {
    return '-';
  }
}

// ─── Card Component ──────────────────────────────────────────────────────────

interface SectDirectoryCardProps {
  sect: SectDirectoryEntry;
  isApplying: boolean;
  onApply: (sectId: string) => void;
}

const SectDirectoryCard = memo(function SectDirectoryCard({
  sect,
  isApplying,
  onApply,
}: SectDirectoryCardProps) {
  const formattedDate = useMemo(() => formatCreatedDate(sect.createdAt), [sect.createdAt]);

  const renderRelationBadge = () => {
    switch (sect.relation) {
      case 'pending':
        return <span className="sect-directory-badge sect-directory-badge--pending">拜帖審批中</span>;
      case 'member':
        return <span className="sect-directory-badge sect-directory-badge--member">我的宗門</span>;
      case 'leader':
        return <span className="sect-directory-badge sect-directory-badge--leader">宗主</span>;
      default:
        return null;
    }
  };

  const renderActionButton = () => {
    if (sect.relation === 'pending') {
      return (
        <button type="button" className="small-btn ghost" disabled aria-label="拜帖審批中">
          拜帖審批中
        </button>
      );
    }

    if (sect.canApply) {
      return (
        <button
          type="button"
          className="small-btn sect-directory-apply-btn"
          disabled={isApplying}
          onClick={() => onApply(sect.sectId)}
          aria-label={`遞交拜帖至${sect.name}`}
        >
          {isApplying ? '遞交中...' : '遞交拜帖'}
        </button>
      );
    }

    let disabledReason = '不可遞交';
    if (sect.relation === 'member') {
      disabledReason = '已是成員';
    } else if (sect.relation === 'leader') {
      disabledReason = '身為宗主';
    }

    return (
      <button type="button" className="small-btn ghost" disabled title={disabledReason} aria-label={disabledReason}>
        {disabledReason}
      </button>
    );
  };

  return (
    <div className="sect-directory-card" data-sect-id={sect.sectId}>
      <div className="sect-directory-card-head">
        <div className="sect-directory-mark" title="宗門印記">
          {sect.mark || '宗'}
        </div>
        <div className="sect-directory-card-title-group">
          <div className="sect-directory-name-row">
            <span className="sect-directory-name" title={sect.name}>
              {sect.name}
            </span>
            {renderRelationBadge()}
          </div>
          <div className="sect-directory-leader" title={sect.leaderName || '未知'}>
            宗主：{sect.leaderName || '未知'}
          </div>
        </div>
      </div>
      <div className="sect-directory-card-body">
        <div className="sect-directory-info-row">
          <span className="sect-directory-info-label">成員：</span>
          <span className="sect-directory-info-value">{sect.memberCount} 人</span>
        </div>
        <div className="sect-directory-info-row">
          <span className="sect-directory-info-label">山門：</span>
          <span
            className="sect-directory-info-value"
            title={`${sect.entranceMapName} (${sect.entranceX}, ${sect.entranceY})`}
          >
            {sect.entranceMapName} ({sect.entranceX}, {sect.entranceY})
          </span>
        </div>
        <div className="sect-directory-info-row">
          <span className="sect-directory-info-label">創宗：</span>
          <span className="sect-directory-info-value">{formattedDate}</span>
        </div>
      </div>
      <div className="sect-directory-card-actions">{renderActionButton()}</div>
    </div>
  );
});

// ─── Main Panel Component ────────────────────────────────────────────────────

export const SectDirectoryPanel = memo(function SectDirectoryPanel() {
  const { items, total, offset, limit, search, loading, applyingSectIds, error } = useSectDirectoryStore();
  const [searchInput, setSearchInput] = useState(search);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstMountRef = useRef(true);

  // 同步外部 search 變更到本地輸入框
  useEffect(() => {
    if (search !== searchInput && !isFirstMountRef.current) {
      setSearchInput(search);
    }
  }, [search]);

  // 搜尋防抖處理 (300ms)
  const handleSearchChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchInput(value);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      const normalized = value.trim();
      callbacks.onRequestPage?.(normalized, 0, limit);
    }, 300);
  }, [limit]);

  const handleClearSearch = useCallback(() => {
    setSearchInput('');
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    callbacks.onRequestPage?.('', 0, limit);
  }, [limit]);

  const handleRefresh = useCallback(() => {
    callbacks.onRequestPage?.(searchInput.trim(), offset, limit);
  }, [searchInput, offset, limit]);

  const handlePrevPage = useCallback(() => {
    const nextOffset = Math.max(0, offset - limit);
    callbacks.onRequestPage?.(searchInput.trim(), nextOffset, limit);
  }, [searchInput, offset, limit]);

  const handleNextPage = useCallback(() => {
    if (offset + limit < total) {
      callbacks.onRequestPage?.(searchInput.trim(), offset + limit, limit);
    }
  }, [searchInput, offset, limit, total]);

  const handleApply = useCallback((sectId: string) => {
    callbacks.onApplyRemote?.(sectId);
  }, []);

  useEffect(() => {
    isFirstMountRef.current = false;
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="sect-directory-panel" data-sect-directory-root="true">
      <div className="sect-directory-toolbar">
        <div className="sect-directory-search-box">
          <input
            type="text"
            className="sect-directory-search-input"
            placeholder="搜尋宗門名稱"
            maxLength={SECT_DIRECTORY_SEARCH_MAX_LENGTH}
            value={searchInput}
            onChange={handleSearchChange}
            aria-label="搜尋宗門名稱"
          />
          {searchInput ? (
            <button
              type="button"
              className="sect-directory-clear-btn"
              onClick={handleClearSearch}
              aria-label="清除搜尋"
            >
              ✕
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className="small-btn ghost sect-directory-refresh-btn"
          onClick={handleRefresh}
          disabled={loading}
        >
          {loading ? '整理中...' : '重新整理'}
        </button>
      </div>

      <div className="sect-directory-content">
        {error ? <div className="empty-hint compact sect-directory-error">{error}</div> : null}

        {loading && items.length === 0 ? (
          <div className="empty-hint compact">載入宗門名錄中...</div>
        ) : null}

        {!loading && items.length === 0 && !error ? (
          <div className="empty-hint compact">目前沒有符合的宗門</div>
        ) : null}

        {items.length > 0 ? (
          <div className="sect-directory-grid">
            {items.map((sect) => (
              <SectDirectoryCard
                key={sect.sectId}
                sect={sect}
                isApplying={applyingSectIds.includes(sect.sectId)}
                onApply={handleApply}
              />
            ))}
          </div>
        ) : null}
      </div>

      <div className="sect-directory-pagination">
        <button
          type="button"
          className="small-btn ghost"
          disabled={offset === 0 || loading}
          onClick={handlePrevPage}
          aria-label="上一頁"
        >
          上一頁
        </button>
        <span className="sect-directory-page-info">
          第 {currentPage} / {totalPages} 頁 (共 {total} 個宗門)
        </span>
        <button
          type="button"
          className="small-btn ghost"
          disabled={offset + limit >= total || loading}
          onClick={handleNextPage}
          aria-label="下一頁"
        >
          下一頁
        </button>
      </div>
    </div>
  );
});
