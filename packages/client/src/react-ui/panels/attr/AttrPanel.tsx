/**
 * 本文件负责 属性 面板的主要 React 视图入口，统一承接状态展示、用户操作回调和样式组合。
 *
 * 维护时要保持它只处理前端表现和组件契约，不保存业务真源，也不绕过共享规则或服务端权威运行时。
 */
import { memo, useCallback } from 'react';
import type { CSSProperties } from 'react';
import type { S2C_AttrUpdate } from '@mud/shared';
import { createPanelStore } from '../../stores/create-panel-store';
import {
  ATTR_ICON_ATLAS_CELLS,
  ATTR_TAB_LABELS,
  type AttrTab,
} from '../../../constants/ui/attr-panel';
import { t } from '../../../ui/i18n';

import type {
  AttrCraftPaneSnapshot,
  AttrNumericCardSnapshot,
  AttrNumericPaneSnapshot,
  AttrPaneSnapshot,
} from '../../../ui/panels/attr-panel';

// ─── Store ───────────────────────────────────────────────────────────────────

interface AttrPanelState {
  panes: Record<AttrTab, AttrPaneSnapshot>;
  rawData: S2C_AttrUpdate | null;
  activeTab: AttrTab;
}

const defaultPanes: Record<AttrTab, AttrPaneSnapshot> = {
  numeric: { kind: 'placeholder', message: t('attr.empty.no-data', undefined) },
  combat: { kind: 'placeholder', message: t('attr.empty.no-data', undefined) },
  qi: { kind: 'placeholder', message: t('attr.empty.no-data', undefined) },
  special: { kind: 'placeholder', message: t('attr.empty.no-data', undefined) },
  craft: { kind: 'placeholder', message: t('attr.empty.no-data', undefined) },
};

export const { store: attrPanelStore, useStore: useAttrPanelStore } = createPanelStore<AttrPanelState>({
  panes: defaultPanes,
  rawData: null,
  activeTab: 'numeric',
});

// ─── Callbacks ───────────────────────────────────────────────────────────────

interface AttrPanelCallbacks {
  onRequestDetail: (() => void) | null;
  onOpenCraftSkill: ((key: string) => void) | null;
  onBindCraftSkill: ((key: string) => void) | null;
  onOpenSpecialDetails: (() => void) | null;
  onSwitchTab: ((tab: AttrTab) => void) | null;
}

const callbacks: AttrPanelCallbacks = {
  onRequestDetail: null,
  onOpenCraftSkill: null,
  onBindCraftSkill: null,
  onOpenSpecialDetails: null,
  onSwitchTab: null,
};

export function setAttrPanelCallbacks(cbs: Partial<AttrPanelCallbacks>): void {
  Object.assign(callbacks, cbs);
}

// ─── Main Component ──────────────────────────────────────────────────────────

const TABS = Object.keys(ATTR_TAB_LABELS) as AttrTab[];

function AttrAtlasIcon({ iconKey, className }: { iconKey: string; className: string }) {
  const iconCell = ATTR_ICON_ATLAS_CELLS[iconKey];
  if (!iconCell) {
    return null;
  }
  return (
    <span
      className={className}
      style={{
        '--attr-icon-col': iconCell.col,
        '--attr-icon-row': iconCell.row,
      } as CSSProperties}
      aria-hidden="true"
    />
  );
}

export const AttrPanel = memo(function AttrPanel() {
  const { panes, activeTab } = useAttrPanelStore();

  const activePane = panes[activeTab];

  return (
    <div className="attr-layout">
      <div className="action-tab-bar">
        {TABS.map((tab) => (
          <button
            key={tab}
            className={`action-tab-btn${activeTab === tab ? ' active' : ''}`}
            type="button"
            data-attr-tab={tab}
            data-guided-tour-attr-tab={tab}
            onClick={() => callbacks.onSwitchTab?.(tab)}
          >
            {ATTR_TAB_LABELS[tab]}
          </button>
        ))}
      </div>
      <div className="action-tab-pane active">
        <div data-attr-pane={activeTab}>
        <AttrPaneView pane={activePane} />
        </div>
      </div>
    </div>
  );
});

// ─── Pane View ───────────────────────────────────────────────────────────────

const AttrPaneView = memo(function AttrPaneView({ pane }: { pane: AttrPaneSnapshot }) {
  if (pane.kind === 'placeholder') {
    return <div className="panel-section"><div className="empty-hint">{pane.message}</div></div>;
  }
  if (pane.kind === 'numeric') {
    return <NumericPane pane={pane} />;
  }
  if (pane.kind === 'craft') {
    return <CraftPane pane={pane} />;
  }
  return null;
});

// ─── Numeric Pane ────────────────────────────────────────────────────────────

const NumericPane = memo(function NumericPane({ pane }: { pane: AttrNumericPaneSnapshot }) {
  return (
    <div className="panel-section">
      <div className="attr-section-head">
        <div className="panel-section-title">{pane.title}</div>
        {pane.actions && pane.actions.length > 0 && (
          <div className="attr-section-actions">
            {pane.actions.map((action) => (
              <button
                key={action.key}
                className="small-btn"
                type="button"
                onClick={() => {
                  if (action.key === 'special-details') {
                    callbacks.onOpenSpecialDetails?.();
                  }
                }}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="attr-numeric-sections">
        {(pane.sections ?? [{ key: 'values', title: null, cards: pane.cards }]).map((section) => (
          <section key={section.key} className="attr-numeric-section" data-attr-section={section.key}>
            {section.title && <h3 className="attr-numeric-section-title">{section.title}</h3>}
            <div className="attr-grid wide">
              {section.cards.map((card) => <NumericCard key={card.key} card={card} />)}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
});

// ─── Numeric Card ────────────────────────────────────────────────────────────

const NumericCard = memo(function NumericCard({ card }: { card: AttrNumericCardSnapshot }) {
  return (
    <div
      className={`attr-mini${ATTR_ICON_ATLAS_CELLS[card.key] ? ' attr-mini--with-icon' : ''}`}
      data-tooltip-key={card.key}
      data-tooltip-title={card.tooltipTitle}
      data-tooltip-detail={card.tooltipDetail}
    >
      <div className="attr-mini-main">
        <AttrAtlasIcon iconKey={card.key} className="attr-mini-icon" />
        <div className="attr-mini-value">{card.value}</div>
      </div>
      <div className="attr-mini-label">{card.label}</div>
      {card.sub && <span className="attr-mini-sub">{card.sub}</span>}
    </div>
  );
});

// ─── Craft Pane ──────────────────────────────────────────────────────────────

const CraftPane = memo(function CraftPane({ pane }: { pane: AttrCraftPaneSnapshot }) {
  const handleOpen = useCallback((key: string) => {
    callbacks.onOpenCraftSkill?.(key);
  }, []);

  return (
    <div className="attr-craft-list" data-guided-tour-craft-pane="true">
      {pane.skills.map((skill) => (
        <div
          key={skill.key}
          className="attr-craft-row"
          data-guided-tour-craft-skill={skill.key}
          data-tooltip-key={skill.key}
          data-tooltip-title={skill.tooltipTitle}
          data-tooltip-detail={skill.tooltipDetail}
        >
          <span className="attr-craft-label">{skill.label}</span>
          <strong className="attr-craft-level">{skill.level}</strong>
          <div className="attr-craft-exp">
            <span className="attr-craft-exp-text">{skill.progress}</span>
            <div className="attr-craft-exp-track" aria-hidden="true">
              <span className="attr-craft-exp-fill" style={{ width: skill.progressPercent }} />
            </div>
          </div>
          <span className="attr-craft-remain">{skill.remain}</span>
          {skill.openable && (
            <div className="attr-craft-actions">
              <button
                className="small-btn"
                type="button"
                data-guided-tour-craft-open={skill.key}
                onClick={() => handleOpen(skill.key)}
              >
                {t('attr.craft.open', undefined)}
              </button>
              <button className="small-btn ghost" type="button" onClick={() => callbacks.onBindCraftSkill?.(skill.key)}>
                {skill.bindLabel}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
});
