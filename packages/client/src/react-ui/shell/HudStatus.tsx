/**
 * 本文件属于 React 原型壳层，负责 HUD、地图周边或侧栏控件的展示拼装。
 *
 * 维护时应把它视为前端表现层：只组织视图和用户意图，不保存会与主运行态冲突的真源。
 */
import { StrictMode, memo, useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { t } from '../../ui/i18n';
import { createExternalStore } from '../stores/create-external-store';
import { useExternalStoreSnapshot } from '../hooks/use-external-store-snapshot';

export interface ReactHudStatusState {
  name: string;
  title: string;
  map: string;
  position: string;
  objective: string;
  threat: string;
  realmLabel: string;
  realmLevelLabel: string;
  realmReviewLabel: string;
  realmActionLabel: string;
  showRealmAction: boolean;
  realmActionAvailable: boolean;
  hpText: string;
  hpWidth: string;
  qiText: string;
  qiWidth: string;
  cultivateText: string;
  cultivateWidth: string;
}

const DEFAULT_HUD_STATUS: ReactHudStatusState = {
  name: t('shell.name', undefined),
  title: t('shell.title', undefined),
  map: '-',
  position: '(0, 0)',
  objective: t('shell.objective', undefined),
  threat: t('shell.threat', undefined),
  realmLabel: '-',
  realmLevelLabel: '',
  realmReviewLabel: '-',
  realmActionLabel: t('shell.breakthrough', undefined),
  showRealmAction: false,
  realmActionAvailable: false,
  hpText: '0/0',
  hpWidth: '0%',
  qiText: '0/0',
  qiWidth: '0%',
  cultivateText: t('shell.cultivate', undefined),
  cultivateWidth: '0%',
};

const hudStatusStore = createExternalStore<ReactHudStatusState>(DEFAULT_HUD_STATUS);

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let onBreakthrough: (() => void) | null = null;
let cornerActionsRoot: Root | null = null;
let cornerActionsHost: HTMLDivElement | null = null;
let linkActionsRoot: Root | null = null;
let linkActionsHost: HTMLDivElement | null = null;

export function mountReactHudStatus(hudRoot: HTMLElement): boolean {
  if (root) {
    return true;
  }
  const panel = hudRoot.querySelector<HTMLElement>('.hud-panel');
  if (!panel) {
    return false;
  }
  const identity = panel.querySelector<HTMLElement>('.hud-identity');
  const mobileScroll = panel.querySelector<HTMLElement>('.hud-mobile-scroll');
  const insertBefore = identity ?? mobileScroll ?? panel.firstElementChild;
  host = document.createElement('div');
  host.className = 'react-hud-status-host';
  host.dataset.reactHudStatus = 'true';
  host.style.display = 'contents';
  if (insertBefore) {
    panel.insertBefore(host, insertBefore);
  } else {
    panel.appendChild(host);
  }
  identity?.remove();
  mobileScroll?.remove();
  root = createRoot(host);
  flushSync(() => {
    root?.render(
      <StrictMode>
        <HudStatusView />
      </StrictMode>,
    );
  });
  return true;
}

export function mountReactHudCornerActions(hudRoot: HTMLElement): boolean {
  if (cornerActionsRoot) {
    return true;
  }
  const actions = hudRoot.querySelector<HTMLElement>('.hud-corner-actions');
  if (!actions) {
    return false;
  }
  cornerActionsHost = document.createElement('div');
  cornerActionsHost.className = 'react-hud-corner-actions-host';
  cornerActionsHost.dataset.reactHudCornerActions = 'true';
  cornerActionsHost.style.display = 'contents';
  actions.replaceChildren(cornerActionsHost);
  cornerActionsRoot = createRoot(cornerActionsHost);
  flushSync(() => {
    cornerActionsRoot?.render(
      <StrictMode>
        <HudCornerActions />
      </StrictMode>,
    );
  });
  return true;
}

export function mountReactHudLinkActions(hudRoot: HTMLElement): boolean {
  if (linkActionsRoot) {
    return true;
  }
  const actions = hudRoot.querySelector<HTMLElement>('.hud-link-actions');
  if (!actions) {
    return false;
  }
  linkActionsHost = document.createElement('div');
  linkActionsHost.className = 'react-hud-link-actions-host';
  linkActionsHost.dataset.reactHudLinkActions = 'true';
  linkActionsHost.style.display = 'contents';
  actions.replaceChildren(linkActionsHost);
  linkActionsRoot = createRoot(linkActionsHost);
  flushSync(() => {
    linkActionsRoot?.render(
      <StrictMode>
        <HudLinkActions />
      </StrictMode>,
    );
  });
  return true;
}

export function syncReactHudStatus(state: ReactHudStatusState): void {
  // 改用 patchState 触发 hasPatchChanges 字段级守卫：战斗/修炼状态下每个 SelfDelta 都会重建 HUD 状态对象，
  // DOM 路径已有 lastSignatures 字段去重，React 路径此处补齐同等的字段级守卫，
  // 避免无字段变化的 setState 仍 emit（新对象引用必不等于旧对象）导致整组件无意义 reconciliation。
  hudStatusStore.patchState(state);
}

export function setReactHudBreakthroughHandler(callback: (() => void) | null): void {
  onBreakthrough = callback;
}

const HudStatusView = memo(function HudStatusView() {
  const state = useExternalStoreSnapshot(hudStatusStore);
  return (
    <>
      <div className="hud-identity">
        <div className="hud-name" id="hud-name">{state.name}</div>
        <div className="hud-title" id="hud-title">{state.title}</div>
      </div>
      <div className="hud-mobile-scroll">
        <div className="hud-top-row">
          <div className="hud-realm-block">
            <div className="hud-realm-label">{t('shell.hud-realm-label-realm', undefined)}</div>
            <button
              className={`hud-realm-action${state.realmActionAvailable ? '' : ' is-unavailable'}`}
              id="hud-breakthrough"
              type="button"
              hidden={!state.showRealmAction}
              aria-disabled={state.realmActionAvailable ? 'false' : 'true'}
              onClick={() => onBreakthrough?.()}
            >
              {state.realmActionLabel}
            </button>
            <div className="hud-realm-main">
              <div className="hud-realm-heading">
                <div className="hud-realm-value" id="hud-realm">{state.realmLabel}</div>
                <div className="hud-realm-level" id="hud-realm-level">{state.realmLevelLabel}</div>
              </div>
              <div className="hud-realm-sub" id="hud-realm-sub">{state.realmReviewLabel}</div>
            </div>
            <div className="hud-progress-shell">
              <div className="hud-progress-value" id="hud-cultivate">{state.cultivateText}</div>
              <div className="hud-progress-track">
                <div className="hud-progress-fill" id="hud-cultivate-bar" style={{ width: state.cultivateWidth }} />
              </div>
            </div>
          </div>
        </div>

        <div className="hud-resource-bars">
          <HudResource
            label={t('shell.hud-resource-label-hp', undefined)}
            text={state.hpText}
            fillId="hud-hp-bar"
            textId="hud-hp-text"
            width={state.hpWidth}
          />
          <HudResource
            label={t('shell.hud-resource-label-qi', undefined)}
            text={state.qiText}
            fillId="hud-qi-bar"
            textId="hud-qi-text"
            width={state.qiWidth}
            qi
          />
        </div>

        <div className="hud-grid">
          <HudRow label={t('shell.hud-label-map', undefined)} value={state.map} id="hud-map" />
          <HudRow label={t('shell.hud-label-position', undefined)} value={state.position} id="hud-pos" />
          <HudRow label={t('shell.hud-label-age', undefined)} value={state.objective} id="hud-objective" />
          <HudRow label={t('shell.hud-label-lifespan', undefined)} value={state.threat} id="hud-threat" />
        </div>
      </div>
    </>
  );
});

const HudCornerActions = memo(function HudCornerActions() {
  return (
    <>
      <button id="hud-open-settings" className="hud-corner-btn" type="button" data-i18n="shell.open-settings">
        {t('shell.open-settings', undefined)}
      </button>
      <button id="hud-open-mail" className="hud-corner-btn" type="button" data-i18n="shell.open-mail">
        {t('shell.open-mail', undefined)}
      </button>
      <button id="hud-open-activity" className="hud-corner-btn" type="button" data-i18n="shell.open-activity">
        {t('shell.open-activity', undefined)}
      </button>
      <button id="hud-open-chronicle" className="hud-corner-btn" type="button" data-i18n="shell.open-chronicle">
        {t('shell.open-chronicle', undefined)}
      </button>
      <button id="hud-logout" className="hud-corner-btn danger" type="button" data-i18n="shell.logout">
        {t('shell.logout', undefined)}
      </button>
    </>
  );
});

const HudLinkActions = memo(function HudLinkActions() {
  return (
    <>
      <button
        id="hud-open-tutorial"
        className="hud-corner-btn hud-link-btn hud-link-btn--tutorial"
        type="button"
        aria-label={t('shell.open-tutorial.aria-label', undefined)}
      >
        <span className="hud-link-btn-text">{t('shell.hud-link-btn-text-simple-tutorial', undefined)}</span>
      </button>
      <button
        id="hud-open-guided-tour"
        className="hud-corner-btn hud-link-btn hud-link-btn--tutorial"
        type="button"
        aria-label={t('shell.open-guided-tour.aria-label', undefined)}
      >
        <span className="hud-link-btn-text">{t('shell.hud-link-btn-text-guided-tour', undefined)}</span>
      </button>
    </>
  );
});

const HudResource = memo(function HudResource({
  label,
  text,
  textId,
  fillId,
  width,
  qi = false,
}: {
  label: string;
  text: string;
  textId: string;
  fillId: string;
  width: string;
  qi?: boolean;
}) {
  return (
    <div className="hud-resource-bar">
      <div className="hud-resource-head">
        <div className="hud-resource-label">{label}</div>
        <div className="hud-resource-text" id={textId}>{text}</div>
      </div>
      <div className={`hud-resource-meter${qi ? ' hud-resource-meter--qi' : ''}`}>
        <div className="hud-resource-fill" id={fillId} style={{ width }} />
      </div>
    </div>
  );
});

const HudRow = memo(function HudRow({ label, value, id }: { label: string; value: string; id: string }) {
  return (
    <div className="hud-row">
      <span className="hud-label">{label}</span>
      <span className="hud-value" id={id}>{value}</span>
    </div>
  );
});
