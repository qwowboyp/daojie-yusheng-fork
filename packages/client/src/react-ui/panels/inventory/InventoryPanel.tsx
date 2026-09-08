/**
 * 本文件负责 背包 面板的主要 React 视图入口，统一承接状态展示、用户操作回调和样式组合。
 *
 * 维护时要保持它只处理前端表现和组件契约，不保存业务真源，也不绕过共享规则或服务端权威运行时。
 */
import { memo, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Inventory, ItemType } from '@mud/shared';
import { createPanelStore } from '../../stores/create-panel-store';
import { INVENTORY_FILTER_TABS, type InventoryFilter } from '../../../constants/ui/inventory';
import { t } from '../../../ui/i18n';

export interface ReactInventoryItemView {
  slotIndex: number;
  itemInstanceId: string | null;
  itemId: string;
  itemKey: string;
  name: string;
  nameClassName: string;
  countLabel: string;
  itemType: ItemType;
  ribbonLabel?: string;
  ribbonTitle?: string;
  learnedRibbonLabel?: string;
  learnedRibbonTitle?: string;
  gradeLineLabel?: string;
  cellClassName: string;
  grade?: string;
  levelLabel?: string;
  enhanceLabel?: string;
  primaryActionHint?: string;
  cooldown?: {
    title: string;
    progress: string;
    label: string;
  };
  cooldownRemaining?: number;
  primaryAction: ReactInventoryPrimaryAction | null;
  detail: ReactInventoryItemDetailView;
}

export interface ReactInventoryItemDetailView {
  typeLabel: string;
  description: string;
  statusLabel?: string;
  equipSlotLabel?: string;
  bonusLines: string[];
  materialValueLines: string[];
  effectLines: string[];
  equippedComparison?: ReactInventoryEquippedComparison;
}

export interface ReactInventoryEquippedComparison {
  name: string;
  gradeLineLabel?: string;
  levelLabel?: string;
  enhanceLabel?: string;
  bonusLines: string[];
}

export interface ReactInventoryPrimaryAction {
  label: string;
  kind: 'use' | 'equip' | 'status';
  disabled?: boolean;
}

export interface ReactInventoryPanelState {
  inventory: Inventory | null;
  title: string;
  items: ReactInventoryItemView[];
  activeFilter: InventoryFilter;
  totalItems: number;
  totalVisibleItems: number;
  renderedVisibleCount: number;
  capacity: number;
  emptyText: string | null;
  loadHint: string | null;
  pagination: ReactInventoryPaginationState | null;
  searchQuery: string;
}

export interface ReactInventoryPaginationState {
  label: string;
  canPrev: boolean;
  canNext: boolean;
  loading: boolean;
}

export const { store: inventoryPanelStore, useStore: useInventoryPanelStore } = createPanelStore<ReactInventoryPanelState>({
  inventory: null,
  title: t('inventory.title', undefined),
  items: [],
  activeFilter: 'all',
  totalItems: 0,
  totalVisibleItems: 0,
  renderedVisibleCount: 0,
  capacity: 0,
  emptyText: t('inventory.empty.all', undefined),
  loadHint: null,
  pagination: null,
  searchQuery: '',
});

interface InventoryPanelCallbacks {
  onFilterChange: ((filter: InventoryFilter) => void) | null;
  onSortInventory: (() => void) | null;
  onOpenBulkDiscard: (() => void) | null;
  onRequestLoadMore: ((scrollTarget: HTMLElement) => void) | null;
  onPageChange: ((direction: 'prev' | 'next') => void) | null;
  onSearchChange: ((value: string) => void) | null;
  onPrimaryAction: ((slotIndex: number, itemInstanceId: string | null) => void) | null;
  onOpenItemDetail: ((slotIndex: number, itemKey: string) => void) | null;
}

const callbacks: InventoryPanelCallbacks = {
  onFilterChange: null,
  onSortInventory: null,
  onOpenBulkDiscard: null,
  onRequestLoadMore: null,
  onPageChange: null,
  onSearchChange: null,
  onPrimaryAction: null,
  onOpenItemDetail: null,
};

export function setInventoryPanelCallbacks(cbs: Partial<InventoryPanelCallbacks>): void {
  Object.assign(callbacks, cbs);
}

export const InventoryPanel = memo(function InventoryPanel() {
  const state = useInventoryPanelStore();
  const [searchDraft, setSearchDraft] = useState(state.searchQuery);
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null);
  const [showDetailOnMobile, setShowDetailOnMobile] = useState(false);
  const selectedCellRef = useRef<HTMLElement | null>(null);
  const selectedItem = state.items.find((item) => item.itemKey === selectedItemKey) ?? null;

  useEffect(() => {
    setSearchDraft(state.searchQuery);
  }, [state.searchQuery]);

  useEffect(() => {
    if (selectedItemKey && !selectedItem) {
      setSelectedItemKey(null);
      setShowDetailOnMobile(false);
    }
  }, [selectedItem, selectedItemKey]);

  return (
    <div className="panel-section inventory-panel">
      <div className="inventory-panel-head">
        <div className="panel-section-title" data-inventory-title="true">{state.title}</div>
        <div className="inventory-panel-controls">
          <input
            className="inventory-search-input"
            type="search"
            value={searchDraft}
            placeholder={t('inventory.search.placeholder', undefined, '搜尋物品')}
            autoComplete="off"
            onChange={(event) => {
              const value = event.currentTarget.value;
              setSearchDraft(value);
              callbacks.onSearchChange?.(value);
            }}
          />
          <button className="small-btn" type="button" onClick={() => callbacks.onSortInventory?.()}>
            {t('inventory.action.sort', undefined)}
          </button>
          <button className="small-btn danger" type="button" onClick={() => callbacks.onOpenBulkDiscard?.()}>
            一鍵丟棄
          </button>
        </div>
      </div>
      <div className="ui-filter-tabs">
          {INVENTORY_FILTER_TABS.map((tab) => (
            <button
              key={tab.id}
              className={`ui-filter-tab${state.activeFilter === tab.id ? ' active' : ''}`}
              type="button"
              onClick={() => callbacks.onFilterChange?.(tab.id)}
            >
              {tab.label}
            </button>
          ))}
      </div>
      <div className="inventory-workspace" data-detail-open={showDetailOnMobile && selectedItem ? 'true' : undefined}>
        <div className="inventory-workspace-list">
          {state.emptyText ? (
            <div className="empty-hint" data-inventory-empty="true">{state.emptyText}</div>
          ) : (
            <div
              className="inventory-grid"
              data-inventory-grid="true"
              onScroll={(event) => callbacks.onRequestLoadMore?.(event.currentTarget)}
            >
              {state.items.map((item) => (
                <InventoryCell
                  key={`${item.slotIndex}:${item.itemKey}`}
                  item={item}
                  selected={item.itemKey === selectedItemKey}
                  onSelect={(cell) => {
                    selectedCellRef.current = cell;
                    setSelectedItemKey(item.itemKey);
                    setShowDetailOnMobile(true);
                  }}
                />
              ))}
            </div>
          )}
          {state.loadHint && (
            <div className="inventory-load-hint" data-inventory-load-hint="true">
              {state.loadHint}
            </div>
          )}
          {state.pagination && (
            <div className="inventory-pagination" data-inventory-pagination="true">
              <button
                className="small-btn ghost"
                type="button"
                disabled={!state.pagination.canPrev || state.pagination.loading}
                onClick={() => callbacks.onPageChange?.('prev')}
              >
                {t('inventory.pagination.prev', undefined, '上一頁')}
              </button>
              <span className="inventory-pagination-status">{state.pagination.label}</span>
              <button
                className="small-btn ghost"
                type="button"
                disabled={!state.pagination.canNext || state.pagination.loading}
                onClick={() => callbacks.onPageChange?.('next')}
              >
                {t('inventory.pagination.next', undefined, '下一頁')}
              </button>
            </div>
          )}
        </div>
        <InventoryDetail
          item={selectedItem}
          onBack={() => {
            setShowDetailOnMobile(false);
            requestAnimationFrame(() => {
              const selectedCell = selectedCellRef.current;
              const target = selectedCell?.isConnected ? selectedCell
                : document.querySelector<HTMLElement>('#pane-inventory [data-item-selected="true"]');
              target?.focus({ preventScroll: true });
            });
          }}
        />
      </div>
    </div>
  );
});

const InventoryCell = memo(function InventoryCell({
  item,
  selected,
  onSelect,
}: {
  item: ReactInventoryItemView;
  selected: boolean;
  onSelect: (cell: HTMLElement) => void;
}) {
  const cooldownStyle = item.cooldown
    ? ({ '--inventory-cooldown-progress': item.cooldown.progress } as CSSProperties)
    : ({ '--inventory-cooldown-progress': '0' } as CSSProperties);

  return (
    <div
      className={item.cellClassName}
      data-open-item={item.slotIndex}
      data-item-slot={item.slotIndex}
      data-item-key={item.itemKey}
      data-item-type={item.itemType}
      data-item-grade={item.grade}
      data-item-grade-line-visible={item.gradeLineLabel ? 'true' : undefined}
      data-item-action-hint={item.primaryActionHint}
      data-item-selected={selected ? 'true' : undefined}
      aria-label={`${item.name}，${item.countLabel}${item.primaryActionHint ? `，${item.primaryActionHint}` : ''}`}
      role="button"
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(event.currentTarget);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(event.currentTarget);
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        if (!item.primaryAction || item.primaryAction.disabled === true) {
          return;
        }
        callbacks.onPrimaryAction?.(item.slotIndex, item.itemInstanceId);
      }}
    >
      <div
        className="inventory-cell-cooldown"
        data-item-cooldown="true"
        aria-label={item.cooldown?.title}
        hidden={!item.cooldown}
      >
        <span
          className="inventory-cell-cooldown-pie"
          data-item-cooldown-pie="true"
          style={cooldownStyle}
        />
        <span className="inventory-cell-cooldown-label" data-item-cooldown-label="true">
          {item.cooldown?.label ?? ''}
        </span>
      </div>
      <div className="inventory-cell-head">
        <span
          className="inventory-cell-type"
          data-item-type="true"
          aria-label={item.ribbonTitle}
          hidden={!item.ribbonLabel}
        >
          {item.ribbonLabel ?? ''}
        </span>
        <span className="inventory-cell-count" data-item-count="true" data-quantity={item.countLabel.replace(/^x\s*/, '')}>{item.countLabel}</span>
      </div>
      {item.learnedRibbonLabel && (
        <span
          className="inventory-cell-learned-ribbon"
          data-item-learned-ribbon="true"
          aria-label={item.learnedRibbonTitle}
        >
          {item.learnedRibbonLabel}
        </span>
      )}
      <div
        className="inventory-cell-grade-line"
        data-item-grade-line="true"
        hidden={!item.gradeLineLabel}
      >
        {item.gradeLineLabel ?? ''}
      </div>
      <div className={item.nameClassName} data-item-name="true" aria-label={item.name}>
        {item.name}
      </div>
      {item.levelLabel && (
        <span className="item-card-chip item-card-chip--level" data-item-level="true">
          {item.levelLabel}
        </span>
      )}
      {item.enhanceLabel && (
        <span className="item-card-chip item-card-chip--enhance" data-item-enhance="true">
          {item.enhanceLabel}
        </span>
      )}
      {item.primaryActionHint && (
        <span className="inventory-cell-action-hint" data-item-action-hint-node="true">
          {item.primaryActionHint}
        </span>
      )}
    </div>
  );
});

const InventoryDetail = memo(function InventoryDetail({
  item,
  onBack,
}: {
  item: ReactInventoryItemView | null;
  onBack: () => void;
}) {
  if (!item) {
    return <aside className="inventory-workspace-detail inventory-workspace-detail--empty">選取背包物品以查看詳情</aside>;
  }

  const { detail } = item;
  return (
    <aside className="inventory-workspace-detail" aria-live="polite">
      <div className="inventory-workspace-detail-head">
        <button className="small-btn ghost inventory-workspace-detail-back" type="button" onClick={onBack}>返回背包</button>
        <div>
          <div className="inventory-workspace-detail-title">{item.name}</div>
          <div className="inventory-workspace-detail-meta">{detail.typeLabel} · {item.countLabel}</div>
        </div>
      </div>
      {detail.equipSlotLabel && <InventoryDetailSection title="裝備部位" lines={[detail.equipSlotLabel]} />}
      {detail.description && <InventoryDetailSection title="說明" lines={[detail.description]} />}
      {detail.statusLabel && <InventoryDetailSection title="狀態" lines={[detail.statusLabel]} />}
      <InventoryDetailSection title="屬性與效果" lines={[...detail.bonusLines, ...detail.materialValueLines, ...detail.effectLines]} />
      {detail.equippedComparison && (
        <section className="inventory-workspace-comparison">
          <div className="inventory-workspace-detail-section-title">目前已裝備</div>
          <div className="inventory-workspace-comparison-name">{detail.equippedComparison.name}</div>
          <div className="inventory-workspace-comparison-meta">
            {[detail.equippedComparison.gradeLineLabel, detail.equippedComparison.levelLabel, detail.equippedComparison.enhanceLabel]
              .filter((value): value is string => Boolean(value))
              .join(' · ')}
          </div>
          <InventoryDetailLines lines={detail.equippedComparison.bonusLines} />
        </section>
      )}
      {item.primaryAction && item.primaryAction.kind !== 'status' && (
        <div className="inventory-workspace-detail-actions">
          <button
            className="small-btn"
            type="button"
            disabled={item.primaryAction.disabled === true}
            onClick={() => callbacks.onPrimaryAction?.(item.slotIndex, item.itemInstanceId)}
          >
            {item.primaryAction.label}
          </button>
        </div>
      )}
      <div className="inventory-workspace-detail-actions">
        <button
          className="small-btn ghost"
          type="button"
          onClick={() => callbacks.onOpenItemDetail?.(item.slotIndex, item.itemKey)}
        >
          完整詳情與更多操作
        </button>
      </div>
    </aside>
  );
});

function InventoryDetailSection({ title, lines }: { title: string; lines: string[] }) {
  if (lines.length === 0) {
    return null;
  }
  return (
    <section className="inventory-workspace-detail-section">
      <div className="inventory-workspace-detail-section-title">{title}</div>
      <InventoryDetailLines lines={lines} />
    </section>
  );
}

function InventoryDetailLines({ lines }: { lines: string[] }) {
  if (lines.length === 0) {
    return null;
  }
  return <div className="inventory-workspace-detail-lines">{lines.map((line, index) => <div key={`${line}:${index}`}>{line}</div>)}</div>;
}
