/**
 * 统法台手机端布局与交互连续性 proof。
 *
 * 使用正式 Vite 页面、CraftWorkbenchModal、通用权限编辑器和样式，验证主 Tab 权限裁剪、
 * 法卷分页筛选、选中边框、强度角标以及窄屏纵向滚动路径。
 */
import assert from 'node:assert/strict';
import { delay, withClientBrowserProof } from './browser-proof-runtime.mjs';

const VIEWPORT = { width: 390, height: 844 };
const SHORT_VIEWPORT = { width: 390, height: 640 };

const initializeExpression = String.raw`
  (async () => {
    const { CraftWorkbenchModal } = await import('/src/ui/craft-workbench-modal.ts');
    const modal = new CraftWorkbenchModal();
    window.__techniqueUnificationPublishPayload = null;
    window.__techniqueUnificationRequests = [];
    modal.setCallbacks({
      onRequestTechniqueAggregation: (payload) => {
        window.__techniqueUnificationRequests.push(structuredClone(payload));
        return true;
      },
      onPublishTechniqueAggregation: (payload) => {
        window.__techniqueUnificationPublishPayload = structuredClone(payload);
        return true;
      },
      onLearnTechniqueAggregation: () => true,
    });
    const everyonePolicy = {
      schemaVersion: 1,
      mode: 'everyone',
      operator: 'any',
      conditions: [],
      revision: 1,
    };
    const ownerOnlyPolicy = {
      schemaVersion: 1,
      mode: 'owner_only',
      operator: 'any',
      conditions: [],
      revision: 1,
    };
    const readPolicy = {
      schemaVersion: 1,
      mode: 'conditional',
      operator: 'any',
      conditions: [{ type: 'relation', relations: ['close_friend'] }],
      revision: 1,
    };
    const revisionPolicy = {
      schemaVersion: 1,
      mode: 'conditional',
      operator: 'any',
      conditions: [{ type: 'sect', roles: ['inner'] }],
      revision: 1,
    };
    modal.setAccessPolicyClient({
      async loadSet(ref) {
        return structuredClone({
          ...ref,
          title: '玄门统法台',
          slots: [
            {
              slot: 'read',
              label: '参阅',
              description: '查看并参悟统法台当前法脉。',
              defaultPolicy: everyonePolicy,
              policy: readPolicy,
              revision: readPolicy.revision,
            },
            {
              slot: 'revision',
              label: '修订',
              description: '向统法台当前法脉续录自己的圆满功法。',
              defaultPolicy: ownerOnlyPolicy,
              policy: revisionPolicy,
              revision: revisionPolicy.revision,
            },
          ],
        });
      },
      async resolvePlayerNo(playerNo) {
        return playerNo === 10002
          ? { playerNo, playerId: 'player:visitor', roleName: '青云剑客' }
          : null;
      },
      async save(_ref, policy, expectedRevision) {
        return {
          ok: true,
          policy: { ...structuredClone(policy), revision: expectedRevision + 1 },
        };
      },
    });
    modal.openTechniqueAggregation('building:mobile-proof');
    const mortalSources = Array.from({ length: 28 }, (_, index) => ({
      techId: 'gen_mobile_mortal_' + index,
      name: '凡阶归元功' + (index + 1),
      grade: 'mortal',
      category: 'internal',
      realmLv: index < 16 ? 1 : 2,
      strengthPercent: 80 + (index % 41),
      level: 9,
      maxLevel: 9,
      fullyMastered: true,
      covered: false,
    }));
    const yellowSources = Array.from({ length: 2 }, (_, index) => ({
      techId: 'gen_mobile_yellow_' + index,
      name: '黄阶守一经' + (index + 1),
      grade: 'yellow',
      category: 'internal',
      realmLv: 3,
      strengthPercent: 119 - index,
      level: 9,
      maxLevel: 9,
      fullyMastered: true,
      covered: false,
    }));
    const previousAggregateSource = {
      techId: 'agg_mobile_previous_v4',
      name: '太玄归一真经',
      grade: 'mortal',
      category: 'internal',
      realmLv: 3,
      strengthPercent: 100,
      level: 9,
      maxLevel: 9,
      fullyMastered: true,
      covered: true,
      aggregate: {
        familyId: 'family:mobile-previous',
        revision: 4,
        sourceCount: 18,
      },
    };
    const sources = [...mortalSources, ...yellowSources];
    const buildPanel = ({
      bound = false,
      isOwner = true,
      canRevise = true,
      includeRebind = false,
      playerRevision,
      latestRevision = 4,
    } = {}) => ({
      revision: 7,
      buildingId: 'building:mobile-proof',
      eligibleSources: canRevise ? [...(includeRebind ? [previousAggregateSource] : []), ...sources] : [],
      families: bound ? [{
        familyId: 'family:mobile-proof',
        latestRevision,
        latestTechniqueId: 'agg_mobile_proof_v' + latestRevision,
        name: '太玄归一真经',
        grade: 'mortal',
        category: 'internal',
        realmLv: 3,
        sourceCount: 2,
        sourceTechniqueIds: [mortalSources[0].techId, mortalSources[1].techId],
        sourceTechniques: [
          { techniqueId: mortalSources[0].techId, name: mortalSources[0].name },
          { techniqueId: mortalSources[1].techId, name: mortalSources[1].name },
        ],
        fullLevelAttrs: {
          constitution: 111,
          spirit: 122,
          perception: 133,
          talent: 144,
          strength: 155,
          meridians: 166,
        },
        creatorPlayerId: 'player:owner',
        ...(Number.isFinite(playerRevision) ? { playerRevision } : {}),
        playerCoveredCount: 0,
      }] : [],
      totalCoveredLeafCount: 0,
      learnedAggregateCount: 0,
      platform: {
        buildingId: 'building:mobile-proof',
        displayName: '玄门统法台',
        ownerPlayerId: 'player:owner',
        isOwner,
        ...(bound ? { familyId: 'family:mobile-proof', latestTechniqueId: 'agg_mobile_proof_v' + latestRevision, latestRevision } : {}),
        accessPolicyResource: {
          resourceType: 'technique_unification_platform',
          resourceId: 'building:mobile-proof',
        },
        canLearn: bound,
        canRevise,
        learnerState: bound ? 'available' : 'unbound',
      },
    });
    modal.handleTechniqueAggregationPanel(buildPanel());
    window.__techniqueUnificationProofModal = modal;
    window.__techniqueUnificationBuildPanel = buildPanel;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return document.getElementById('detail-modal-title')?.textContent?.trim() ?? '';
  })()
`;

const measureShellExpression = String.raw`
  (() => {
    const card = document.getElementById('detail-modal-card');
    const body = document.getElementById('detail-modal-body');
    const panel = document.querySelector('[data-technique-aggregation-panel="true"]');
    if (!(card instanceof HTMLElement) || !(body instanceof HTMLElement) || !(panel instanceof HTMLElement)) {
      throw new Error('统法台移动端 proof 外壳不完整');
    }
    const cardRect = card.getBoundingClientRect();
    const mainTabs = Array.from(panel.querySelectorAll('.technique-aggregation-primary-tab'));
    const tabRects = mainTabs.map((entry) => entry.getBoundingClientRect());
    const overflowNodes = [card, body, panel, ...Array.from(panel.querySelectorAll('*'))]
      .filter((entry) => entry instanceof HTMLElement && entry.scrollWidth > entry.clientWidth + 1)
      .map((entry) => entry.className || entry.tagName);
    return {
      viewportHeight: innerHeight,
      cardTop: cardRect.top,
      cardBottom: cardRect.bottom,
      cardClass: card.className,
      bodyOverflowY: getComputedStyle(body).overflowY,
      bodyClientHeight: body.clientHeight,
      bodyScrollHeight: body.scrollHeight,
      mainTabLabels: mainTabs.map((entry) => entry.textContent?.trim() ?? ''),
      activeMainTab: panel.querySelector('.technique-aggregation-primary-tab.is-active')?.textContent?.trim() ?? '',
      minMainTabHeight: tabRects.length > 0 ? Math.min(...tabRects.map((rect) => rect.height)) : 0,
      hasDirectory: Boolean(panel.querySelector('[data-technique-aggregation-directory="true"]')),
      hasPermissions: Boolean(panel.querySelector('[data-technique-aggregation-permissions="true"]')),
      hasRecordTabs: Boolean(panel.querySelector('.technique-aggregation-record-tabs')),
      overviewText: panel.querySelector('.technique-aggregation-tab-content')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      overflowNodes,
    };
  })()
`;

const openSourceRecordExpression = String.raw`
  (() => {
    document.querySelector('[data-primary-tab="record"]')?.click();
    return Array.from(document.querySelectorAll('.technique-aggregation-record-tab'))
      .map((entry) => entry.textContent?.trim() ?? '');
  })()
`;

const measureSourceExpression = String.raw`
  (() => {
    const body = document.getElementById('detail-modal-body');
    const panel = document.querySelector('[data-technique-aggregation-panel="true"]');
    const directory = document.querySelector('[data-technique-aggregation-directory="true"]');
    const list = document.querySelector('[data-technique-aggregation-source-list="true"]');
    const grade = document.querySelector('[data-technique-aggregation-grade-filter="true"]');
    const realm = document.querySelector('[data-technique-aggregation-realm-filter="true"]');
    const name = document.querySelector('[data-technique-aggregation-name="true"]');
    if (!(body instanceof HTMLElement)
      || !(panel instanceof HTMLElement)
      || !(directory instanceof HTMLElement)
      || !(list instanceof HTMLElement)
      || !(grade instanceof HTMLSelectElement)
      || !(realm instanceof HTMLSelectElement)
      || !(name instanceof HTMLInputElement)) {
      throw new Error('自有功法录法结构不完整');
    }
    const sourceCards = Array.from(list.querySelectorAll('.technique-aggregation-source'))
      .filter((entry) => entry instanceof HTMLElement);
    const sourceRects = sourceCards.map((entry) => entry.getBoundingClientRect());
    const firstCard = sourceCards[0];
    const firstStrength = firstCard?.querySelector('.technique-aggregation-source-strength');
    const cardRect = firstCard?.getBoundingClientRect();
    const strengthRect = firstStrength?.getBoundingClientRect();
    const overflowNodes = [body, panel, ...Array.from(panel.querySelectorAll('*'))]
      .filter((entry) => entry instanceof HTMLElement && entry.scrollWidth > entry.clientWidth + 1)
      .map((entry) => entry.className || entry.tagName);
    return {
      bodyClientHeight: body.clientHeight,
      bodyScrollHeight: body.scrollHeight,
      listOverflowY: getComputedStyle(list).overflowY,
      listClientHeight: list.clientHeight,
      listScrollHeight: list.scrollHeight,
      sourceCount: sourceCards.length,
      sourceGridColumns: getComputedStyle(list).gridTemplateColumns.split(' ').filter(Boolean).length,
      minSourceHeight: sourceRects.length > 0 ? Math.min(...sourceRects.map((rect) => rect.height)) : 0,
      maxSourceHeight: sourceRects.length > 0 ? Math.max(...sourceRects.map((rect) => rect.height)) : 0,
      maxSourceWidth: sourceRects.length > 0 ? Math.max(...sourceRects.map((rect) => rect.width)) : 0,
      inventoryCardCount: list.querySelectorAll('.technique-aggregation-source.inventory-cell').length,
      firstStrength: firstStrength?.textContent?.trim() ?? '',
      strengthLeftOffset: cardRect && strengthRect ? strengthRect.left - cardRect.left : -1,
      strengthBottomOffset: cardRect && strengthRect ? cardRect.bottom - strengthRect.bottom : -1,
      gradeOptionCount: grade.options.length,
      realmOptionCount: realm.options.length,
      pageText: directory.querySelector('.technique-aggregation-pagination span')?.textContent?.trim() ?? '',
      recordTabLabels: Array.from(panel.querySelectorAll('.technique-aggregation-record-tab'))
        .map((entry) => entry.textContent?.trim() ?? ''),
      activeRecordTab: panel.querySelector('.technique-aggregation-record-tab.is-active')?.textContent?.trim() ?? '',
      hasPermissions: Boolean(panel.querySelector('[data-technique-aggregation-permissions="true"]')),
      overflowNodes,
    };
  })()
`;

const sourceInteractionExpression = String.raw`
  (() => {
    const directory = document.querySelector('[data-technique-aggregation-directory="true"]');
    const realm = document.querySelector('[data-technique-aggregation-realm-filter="true"]');
    const name = document.querySelector('[data-technique-aggregation-name="true"]');
    const firstCard = document.querySelector('.technique-aggregation-source');
    if (!(directory instanceof HTMLElement)
      || !(realm instanceof HTMLSelectElement)
      || !(name instanceof HTMLInputElement)
      || !(firstCard instanceof HTMLButtonElement)) {
      throw new Error('统法台自有功法交互结构不完整');
    }
    name.focus();
    name.value = '太玄归一真经';
    name.dispatchEvent(new Event('input', { bubbles: true }));

    const beforeStyle = getComputedStyle(firstCard);
    const before = {
      borderColor: beforeStyle.borderTopColor,
      backgroundColor: beforeStyle.backgroundColor,
      backgroundImage: beforeStyle.backgroundImage,
    };
    const originalTransition = firstCard.style.transition;
    firstCard.style.transition = 'none';
    void firstCard.offsetWidth;
    firstCard.classList.add('is-selected');
    const selectedStyle = getComputedStyle(firstCard);
    const selectedCss = {
      borderColor: selectedStyle.borderTopColor,
      backgroundColor: selectedStyle.backgroundColor,
      backgroundImage: selectedStyle.backgroundImage,
    };
    firstCard.classList.remove('is-selected');
    firstCard.style.transition = originalTransition;
    firstCard.click();
    const selectedCard = document.querySelector('.technique-aggregation-source.is-selected');
    if (!(selectedCard instanceof HTMLButtonElement)) throw new Error('法卷卡未进入选中态');
    const selectedCardText = selectedCard.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    realm.value = '2';
    realm.dispatchEvent(new Event('change', { bubbles: true }));
    const realmFilteredCards = document.querySelectorAll('.technique-aggregation-source');
    const realmPageText = document.querySelector('.technique-aggregation-pagination span')?.textContent?.trim() ?? '';
    const realmStrength = realmFilteredCards[0]?.querySelector('.technique-aggregation-source-strength')?.textContent?.trim() ?? '';

    const currentRealm = document.querySelector('[data-technique-aggregation-realm-filter="true"]');
    if (!(currentRealm instanceof HTMLSelectElement)) throw new Error('境界筛选器丢失');
    currentRealm.value = '';
    currentRealm.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('[data-craft-action="technique-aggregation-select-all"]')?.click();
    const firstPageSelected = document.querySelectorAll('.technique-aggregation-source.is-selected').length;
    const selectedSummary = document.querySelector('[data-technique-aggregation-selection-summary="true"]')?.textContent?.trim() ?? '';
    document.querySelector('[data-craft-action="technique-aggregation-page-next"]')?.click();
    const secondPageSelected = document.querySelectorAll('.technique-aggregation-source.is-selected').length;
    const secondPageText = document.querySelector('.technique-aggregation-pagination span')?.textContent?.trim() ?? '';
    document.querySelector('[data-craft-action="technique-aggregation-clear-selection"]')?.click();
    const selectedAfterClear = document.querySelectorAll('.technique-aggregation-source.is-selected').length;

    const grade = document.querySelector('[data-technique-aggregation-grade-filter="true"]');
    if (!(grade instanceof HTMLSelectElement)) throw new Error('品阶筛选器丢失');
    grade.value = 'yellow';
    grade.dispatchEvent(new Event('change', { bubbles: true }));
    const sparseCards = Array.from(document.querySelectorAll('.technique-aggregation-source'))
      .filter((entry) => entry instanceof HTMLElement);
    const sparseWidths = sparseCards.map((entry) => entry.getBoundingClientRect().width);
    const currentName = document.querySelector('[data-technique-aggregation-name="true"]');
    return {
      directoryIdentityPreserved: document.querySelector('[data-technique-aggregation-directory="true"]') === directory,
      nameIdentityPreserved: currentName === name,
      nameValue: currentName instanceof HTMLInputElement ? currentName.value : '',
      borderChanged: before.borderColor !== selectedCss.borderColor,
      backgroundColorPreserved: before.backgroundColor === selectedCss.backgroundColor,
      backgroundImagePreserved: before.backgroundImage === selectedCss.backgroundImage,
      selectedCardText,
      realmFilteredCount: realmFilteredCards.length,
      realmPageText,
      realmStrength,
      firstPageSelected,
      selectedSummary,
      secondPageSelected,
      secondPageText,
      selectedAfterClear,
      gradeValue: document.querySelector('[data-technique-aggregation-grade-filter="true"]')?.value ?? '',
      sparseCount: sparseCards.length,
      maxSparseWidth: sparseWidths.length > 0 ? Math.max(...sparseWidths) : 0,
    };
  })()
`;

const openPublishConfirmExpression = String.raw`
  (() => {
    const modal = window.__techniqueUnificationProofModal;
    const buildPanel = window.__techniqueUnificationBuildPanel;
    window.__techniqueUnificationPublishPayload = null;
    modal.openTechniqueAggregation('building:mobile-proof');
    modal.handleTechniqueAggregationPanel(buildPanel());
    document.querySelector('[data-primary-tab="record"]')?.click();
    const name = document.querySelector('[data-technique-aggregation-name="true"]');
    const cards = Array.from(document.querySelectorAll('.technique-aggregation-source'));
    if (!(name instanceof HTMLInputElement)
      || !(cards[0] instanceof HTMLButtonElement)
      || !(cards[1] instanceof HTMLButtonElement)) {
      throw new Error('统法台凝篇确认准备失败');
    }
    name.value = '太玄归一真经';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    cards[0].click();
    cards[1].click();
    document.querySelector('[data-craft-action="technique-aggregation-publish"]')?.click();
    const title = document.querySelector('.confirm-modal-title')?.textContent?.trim() ?? '';
    const subtitle = document.querySelector('.confirm-modal-subtitle')?.textContent?.trim() ?? '';
    const body = document.querySelector('.confirm-modal-body')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const confirmLabel = document.querySelector('[data-confirm-modal-confirm="true"]')?.textContent?.trim() ?? '';
    const payloadBeforeConfirm = window.__techniqueUnificationPublishPayload;
    document.querySelector('[data-confirm-modal-confirm="true"]')?.click();
    const payloadAfterConfirm = window.__techniqueUnificationPublishPayload;
    modal.handleTechniqueAggregationResult({
      ok: false,
      code: 'TECHNIQUE_AGGREGATE_NOT_READY',
      messageKey: 'technique.aggregation.technique_aggregate_not_ready',
    });
    return { title, subtitle, body, confirmLabel, payloadBeforeConfirm, payloadAfterConfirm };
  })()
`;

const openRebindConfirmExpression = String.raw`
  (() => {
    const modal = window.__techniqueUnificationProofModal;
    const buildPanel = window.__techniqueUnificationBuildPanel;
    window.__techniqueUnificationPublishPayload = null;
    modal.openTechniqueAggregation('building:mobile-proof');
    modal.handleTechniqueAggregationPanel(buildPanel({ includeRebind: true }));
    document.querySelector('[data-primary-tab="record"]')?.click();
    const card = document.querySelector('[data-technique-id="agg_mobile_previous_v4"]');
    if (!(card instanceof HTMLButtonElement)) {
      throw new Error('旧统法重录候选未显示');
    }
    card.click();
    const name = document.querySelector('[data-technique-aggregation-name="true"]');
    const publish = document.querySelector('[data-craft-action="technique-aggregation-publish"]');
    const marker = card.querySelector('.technique-aggregation-source-mark')?.textContent?.trim() ?? '';
    const chip = card.querySelector('.technique-aggregation-source-strength')?.textContent?.trim() ?? '';
    if (!(name instanceof HTMLInputElement) || !(publish instanceof HTMLButtonElement)) {
      throw new Error('旧统法重录控件不完整');
    }
    const publishLabel = publish.textContent?.trim() ?? '';
    publish.click();
    const title = document.querySelector('.confirm-modal-title')?.textContent?.trim() ?? '';
    const body = document.querySelector('.confirm-modal-body')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const confirmLabel = document.querySelector('[data-confirm-modal-confirm="true"]')?.textContent?.trim() ?? '';
    document.querySelector('[data-confirm-modal-confirm="true"]')?.click();
    const publishingLabel = publish.textContent?.trim() ?? '';
    return {
      marker,
      chip,
      nameDisabled: name.disabled,
      nameValue: name.value,
      publishLabel,
      publishingLabel,
      title,
      body,
      confirmLabel,
      payload: window.__techniqueUnificationPublishPayload,
    };
  })()
`;

const openPermissionsExpression = String.raw`
  (async () => {
    const modal = window.__techniqueUnificationProofModal;
    const buildPanel = window.__techniqueUnificationBuildPanel;
    modal.handleTechniqueAggregationPanel(buildPanel({ bound: true, isOwner: true, canRevise: true }));
    document.querySelector('[data-primary-tab="permissions"]')?.click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const panel = document.querySelector('[data-technique-aggregation-panel="true"]');
    const permissions = panel?.querySelector('[data-technique-aggregation-permissions="true"]');
    const revisionTab = Array.from(permissions?.querySelectorAll('.access-policy-resource-tabs button') ?? [])
      .find((entry) => entry.textContent?.trim() === '修订');
    if (!(permissions instanceof HTMLElement) || !(revisionTab instanceof HTMLButtonElement)) {
      throw new Error('统法台权限页结构不完整');
    }
    const permissionIdentity = permissions;
    revisionTab.click();
    const optionRects = Array.from(permissions.querySelectorAll('.access-policy-resource-panel:not([hidden]) .access-policy-mode-group button'))
      .map((entry) => entry.getBoundingClientRect());
    const tabRects = Array.from(permissions.querySelectorAll('.access-policy-resource-tabs button'))
      .map((entry) => entry.getBoundingClientRect());
    const customButton = Array.from(permissions.querySelectorAll('.access-policy-resource-panel:not([hidden]) .access-policy-mode-group button'))
      .find((entry) => entry.textContent?.trim() === '自定義策略');
    if (!(customButton instanceof HTMLButtonElement)) throw new Error('统法台自定义权限入口缺失');
    customButton.click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const customPanel = document.querySelector('.access-policy-panel-layer:not(.hidden)');
    const customCard = customPanel?.querySelector('.access-policy-panel');
    if (!(customPanel instanceof HTMLElement) || !(customCard instanceof HTMLElement)) {
      throw new Error('统法台自定义权限面板未打开');
    }
    const result = {
      activeMainTab: panel?.querySelector('.technique-aggregation-primary-tab.is-active')?.textContent?.trim() ?? '',
      permissionIdentityPreserved: panel?.querySelector('[data-technique-aggregation-permissions="true"]') === permissionIdentity,
      permissionTabLabels: Array.from(permissions.querySelectorAll('.access-policy-resource-tabs button'))
        .map((entry) => entry.textContent?.trim() ?? ''),
      activePermissionTab: permissions.querySelector('.access-policy-resource-tabs button.active')?.textContent?.trim() ?? '',
      activePermissionMode: permissions.querySelector('.access-policy-resource-panel:not([hidden]) .access-policy-mode-group button.active')?.textContent?.trim() ?? '',
      permissionEditorText: permissions.querySelector('.access-policy-resource-panel:not([hidden])')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      hasInlineConditions: Boolean(permissions.querySelector('.access-policy-resource-panel:not([hidden]) .access-policy-condition')),
      customPanelIndependent: !permissions.contains(customPanel),
      customPanelOverflow: customCard.scrollWidth > customCard.clientWidth + 1,
      customPanelCloseSize: customPanel.querySelector('.access-policy-panel-close')?.getBoundingClientRect().height ?? 0,
      checkedRevisionRoles: Array.from(customPanel.querySelectorAll('.access-policy-checkbox-options label'))
        .filter((entry) => entry.querySelector('input')?.checked)
        .map((entry) => entry.textContent?.trim() ?? ''),
      minPolicyOptionHeight: optionRects.length > 0 ? Math.min(...optionRects.map((rect) => rect.height)) : 0,
      minPermissionTabHeight: tabRects.length > 0 ? Math.min(...tabRects.map((rect) => rect.height)) : 0,
      hasDirectory: Boolean(panel?.querySelector('[data-technique-aggregation-directory="true"]')),
      hasJadeRecord: Boolean(panel?.querySelector('.technique-aggregation-jade-record')),
    };
    customPanel.querySelector('.access-policy-panel-close')?.click();
    return result;
  })()
`;

const openOverviewExpression = String.raw`
  (() => {
    document.querySelector('[data-primary-tab="overview"]')?.click();
    const panel = document.querySelector('[data-technique-aggregation-panel="true"]');
    const recordedSources = panel?.querySelector('.technique-aggregation-recorded-sources');
    return {
      activeMainTab: panel?.querySelector('.technique-aggregation-primary-tab.is-active')?.textContent?.trim() ?? '',
      overviewText: panel?.querySelector('.technique-aggregation-tab-content')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      metricCount: panel?.querySelectorAll('.technique-aggregation-overview-metrics > span').length ?? 0,
      sourceNames: Array.from(panel?.querySelectorAll('.technique-aggregation-recorded-sources strong') ?? [])
        .map((entry) => entry.textContent?.trim() ?? ''),
      attributeTexts: Array.from(panel?.querySelectorAll('.technique-aggregation-attribute-grid > span') ?? [])
        .map((entry) => entry.textContent?.replace(/\s+/g, ' ').trim() ?? ''),
      sourceOverflowY: recordedSources instanceof HTMLElement ? getComputedStyle(recordedSources).overflowY : '',
      overflow: panel instanceof HTMLElement && panel.scrollWidth > panel.clientWidth + 1,
      hasRecordTabs: Boolean(panel?.querySelector('.technique-aggregation-record-tabs')),
      hasPermissions: Boolean(panel?.querySelector('[data-technique-aggregation-permissions="true"]')),
    };
  })()
`;

const inspectRevisionUpdateExpression = String.raw`
  (() => {
    const modal = window.__techniqueUnificationProofModal;
    const buildPanel = window.__techniqueUnificationBuildPanel;
    modal.handleTechniqueAggregationPanel(buildPanel({
      bound: true,
      isOwner: false,
      canRevise: false,
      playerRevision: 3,
    }));
    const panel = document.querySelector('[data-technique-aggregation-panel="true"]');
    const learn = panel?.querySelector('[data-craft-action="technique-aggregation-learn"]');
    return {
      learnLabel: learn?.textContent?.trim() ?? '',
      learnDisabled: learn instanceof HTMLButtonElement ? learn.disabled : true,
      summary: panel?.querySelector('.technique-aggregation-lineage-summary')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    };
  })()
`;

const restrictTabsExpression = String.raw`
  (() => {
    const modal = window.__techniqueUnificationProofModal;
    const buildPanel = window.__techniqueUnificationBuildPanel;
    modal.handleTechniqueAggregationPanel(buildPanel({ bound: true, isOwner: false, canRevise: false }));
    const panel = document.querySelector('[data-technique-aggregation-panel="true"]');
    return {
      labels: Array.from(panel?.querySelectorAll('.technique-aggregation-primary-tab') ?? [])
        .map((entry) => entry.textContent?.trim() ?? ''),
      active: panel?.querySelector('.technique-aggregation-primary-tab.is-active')?.textContent?.trim() ?? '',
      hasRecordTabs: Boolean(panel?.querySelector('.technique-aggregation-record-tabs')),
      hasPermissions: Boolean(panel?.querySelector('[data-technique-aggregation-permissions="true"]')),
    };
  })()
`;

const inspectCatalogRefreshExpression = String.raw`
  (() => {
    const modal = window.__techniqueUnificationProofModal;
    const buildPanel = window.__techniqueUnificationBuildPanel;
    const requests = window.__techniqueUnificationRequests;
    const activeOperationId = window.__techniqueUnificationPublishPayload?.operationId;
    if (!activeOperationId) throw new Error('统法修订操作标识未保留');
    const before = requests.length;
    modal.handleTechniqueAggregationCatalogChanged({ familyId: 'family:other', latestRevision: 9 });
    modal.handleTechniqueAggregationCatalogChanged({ familyId: 'family:mobile-proof', latestRevision: 4 });
    modal.handleTechniqueAggregationCatalogChanged({ familyId: 'family:mobile-proof', latestRevision: 5 });
    modal.handleTechniqueAggregationCatalogChanged({ familyId: 'family:mobile-proof', latestRevision: 5 });
    const requestCountDelta = requests.length - before;
    const latestRequest = structuredClone(requests.at(-1));
    modal.handleTechniqueAggregationPanel(buildPanel({
      bound: true,
      isOwner: false,
      canRevise: false,
      playerRevision: 3,
      latestRevision: 5,
    }));
    modal.handleTechniqueAggregationResult({
      requestId: 'technique-aggregation:stale-publish-request',
      operationId: activeOperationId,
      ok: true,
      operation: 'publish',
      aggregate: {
        techniqueId: 'agg_mobile_proof_v5',
        familyId: 'family:mobile-proof',
        revision: 5,
        name: '太玄归一真经',
        grade: 'mortal',
        category: 'internal',
        sourceCount: 18,
        sourceTechniqueIds: ['gen:mobile-proof-1', 'gen:mobile-proof-2'],
        totalTrainingDifficulty: 900,
        effectMultiplier: 1.1,
      },
    });
    const panel = document.querySelector('[data-technique-aggregation-panel="true"]');
    return {
      requestCountDelta,
      latestRequest,
      learnLabel: panel?.querySelector('[data-craft-action="technique-aggregation-learn"]')?.textContent?.trim() ?? '',
      summary: panel?.querySelector('.technique-aggregation-lineage-summary')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      publishResult: panel?.querySelector('[data-technique-aggregation-result="true"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    };
  })()
`;

const inspectSanitizedErrorExpression = String.raw`
  (() => {
    const modal = window.__techniqueUnificationProofModal;
    modal.handleTechniqueAggregationResult({
      ok: false,
      code: 'TECHNIQUE_AGGREGATE_OVERLAP',
      messageKey: 'technique.aggregation.internal_overlap',
      conflictAggregateIds: ['agg_internal_debug'],
      conflictSourceTechniqueIds: ['gen_internal_debug'],
      invalidTechniqueIds: ['gen_invalid_debug'],
    });
    const conflictText = document.querySelector('[data-technique-aggregation-result="true"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    modal.handleTechniqueAggregationResult({
      ok: false,
      code: 'TECHNIQUE_AGGREGATE_UNKNOWN',
      messageKey: 'technique.aggregation.internal_unknown',
    });
    const fallbackText = document.querySelector('[data-technique-aggregation-result="true"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    return { conflictText, fallbackText };
  })()
`;

function assertShell(measurement, label) {
  assert(measurement.cardTop >= 0, `${label}弹层顶部越出视口：${JSON.stringify(measurement)}`);
  assert(measurement.cardBottom <= measurement.viewportHeight, `${label}弹层底部越出视口：${JSON.stringify(measurement)}`);
  assert.match(measurement.cardClass, /detail-modal--technique-unification/, `${label}未应用统法台弹层变体`);
  assert.match(measurement.bodyOverflowY, /auto|scroll/, `${label}正文没有纵向滚动路径`);
  assert(measurement.minMainTabHeight >= 43.5, `${label}主 Tab 触控高度不足 44px`);
  assert.deepEqual(measurement.overflowNodes, [], `${label}出现横向溢出：${JSON.stringify(measurement.overflowNodes)}`);
}

function assertSourceLayout(measurement, label) {
  assert(measurement.bodyScrollHeight > measurement.bodyClientHeight, `${label}法卷目录没有形成纵向滚动范围`);
  assert.equal(measurement.listOverflowY, 'visible', `${label}法卷目录不应形成嵌套滚动`);
  assert(measurement.listScrollHeight <= measurement.listClientHeight + 1, `${label}法卷目录仍存在内部滚动范围`);
  assert(measurement.sourceCount > 0 && measurement.sourceCount <= 12, `${label}单页法卷数量超出 12 条`);
  assert.equal(measurement.inventoryCardCount, measurement.sourceCount, `${label}法卷未全部使用背包式卡格`);
  assert.equal(measurement.sourceGridColumns, 2, `${label}手机端法卷目录未保持双列`);
  assert(measurement.minSourceHeight >= 111.5, `${label}法卷卡高度不足`);
  assert(measurement.maxSourceHeight - measurement.minSourceHeight <= 1, `${label}同页法卷卡高度不稳定`);
  assert(measurement.maxSourceWidth <= 180, `${label}少量法卷被横向拉伸过宽`);
  assert(Math.abs(measurement.strengthLeftOffset - 4) <= 2, `${label}强度未贴合法卷左下角`);
  assert(Math.abs(measurement.strengthBottomOffset - 3) <= 2, `${label}强度未贴合法卷左下角`);
  assert.equal(measurement.hasPermissions, false, `${label}录法页混入权限编辑器`);
  assert.deepEqual(measurement.overflowNodes, [], `${label}出现横向溢出：${JSON.stringify(measurement.overflowNodes)}`);
}

await withClientBrowserProof({ viewport: VIEWPORT, profilePrefix: 'technique-unification-mobile-proof-' }, async (cdp) => {
  assert.equal(await cdp.evaluate(initializeExpression), '統法臺', '未打開正式統法臺彈層');

  const initial = await cdp.evaluate(measureShellExpression);
  assertShell(initial, '标准手机视口');
  assert.deepEqual(initial.mainTabLabels, ['總覽', '錄法', '權限'], '建造者主 Tab 不完整');
  assert.equal(initial.activeMainTab, '總覽', '默認未打開總覽');
  assert.equal(initial.hasDirectory, false, '总览页混入法卷目录');
  assert.equal(initial.hasPermissions, false, '总览页混入权限编辑器');
  assert.equal(initial.hasRecordTabs, false, '总览页混入录法方式');
  assert.match(initial.overviewText, /此臺尚未立脈/, '未綁定總覽文案錯誤');

  assert.deepEqual(
    await cdp.evaluate(openSourceRecordExpression),
    [],
    '录法页不应再显示录法方式 Tab',
  );
  const sourceInitial = await cdp.evaluate(measureSourceExpression);
  assertSourceLayout(sourceInitial, '标准手机视口');
  assert.equal(sourceInitial.sourceCount, 12, '首页未限制为 12 部法卷');
  assert.equal(sourceInitial.firstStrength, '強度 80%', '未顯示服務端權威功法強度');
  assert.equal(sourceInitial.gradeOptionCount, 2, '品阶过滤项不完整');
  assert.equal(sourceInitial.realmOptionCount, 3, '境界过滤项不完整');
  assert.match(sourceInitial.pageText, /第 1 頁，共 3 頁 · 當前 1-12 部，共 28 部/, '首頁分頁摘要錯誤');
  assert.equal(sourceInitial.activeRecordTab, '', '移除玉简录法后不应保留多余的二级录法 Tab');

  const interaction = await cdp.evaluate(sourceInteractionExpression);
  assert.equal(interaction.directoryIdentityPreserved, true, '筛选或分页时替换了法卷目录根节点');
  assert.equal(interaction.nameIdentityPreserved, true, '筛选或分页时替换了法脉名输入框');
  assert.equal(interaction.nameValue, '太玄归一真经', '篩選或分頁後丟失法脈名草稿');
  assert.equal(interaction.borderChanged, true, '选中法卷未通过边框呈现');
  assert.equal(interaction.backgroundColorPreserved, true, '选中法卷不应改变底色');
  assert.equal(interaction.backgroundImagePreserved, true, '选中法卷不应改变品阶底纹');
  assert.doesNotMatch(interaction.selectedCardText, /已選|可選/, '選中狀態仍使用文字標記');
  assert.equal(interaction.realmFilteredCount, 12, '境界过滤结果数量错误');
  assert.match(interaction.realmPageText, /第 1 頁，共 1 頁 · 當前 1-12 部，共 12 部/, '境界過濾後的分頁摘要錯誤');
  assert.equal(interaction.realmStrength, '強度 96%', '境界過濾後強度顯示錯誤');
  assert.equal(interaction.firstPageSelected, 12, '全选后当前页未全部呈现选中边框');
  assert.match(interaction.selectedSummary, /已選 28 部/, '全選未覆蓋當前篩選的全部分頁');
  assert.equal(interaction.secondPageSelected, 12, '翻页后跨页全选状态未保留');
  assert.match(interaction.secondPageText, /第 2 頁，共 3 頁 · 當前 13-24 部，共 28 部/, '下一頁分頁摘要錯誤');
  assert.equal(interaction.selectedAfterClear, 0, '全部取消后仍残留选中法卷');
  assert.equal(interaction.gradeValue, 'yellow', '品阶过滤未切换到黄阶');
  assert.equal(interaction.sparseCount, 2, '黄阶少量法卷筛选结果错误');
  assert(interaction.maxSparseWidth <= 180, '只有两部法卷时卡格被拉伸过宽');

  const publishConfirm = await cdp.evaluate(openPublishConfirmExpression);
  assert.equal(publishConfirm.title, '確認凝成首卷', '首次凝篇未經過二次確認');
  assert.equal(publishConfirm.subtitle, '法脈「太玄归一真经」', '二次確認未展示法脈名諱');
  assert.match(publishConfirm.body, /法脈名諱一經凝篇，往後不可更改/, '二次確認未強調名諱不可更改');
  assert.equal(publishConfirm.confirmLabel, '確認凝篇', '二次確認按鈕文案錯誤');
  assert.equal(publishConfirm.payloadBeforeConfirm, null, '二次确认前不应提交凝篇请求');
  assert.equal(publishConfirm.payloadAfterConfirm?.customName, '太玄归一真经', '确认后提交的法脉名讳错误');
  assert.equal(publishConfirm.payloadAfterConfirm?.sourceTechniqueIds?.length, 2, '确认后提交的源法数量错误');

  const rebindConfirm = await cdp.evaluate(openRebindConfirmExpression);
  assert.equal(rebindConfirm.marker, '建立者可重錄', '舊統法候選未標識建立者重錄權限');
  assert.equal(rebindConfirm.chip, '第 4 卷 · 18 部源法', '舊統法候選未顯示卷次與葉子數量');
  assert.equal(rebindConfirm.nameDisabled, true, '重新录入时仍允许改写原法脉名讳');
  assert.equal(rebindConfirm.nameValue, '太玄归一真经', '重新录入未沿用原法脉名讳');
  assert.equal(rebindConfirm.publishLabel, '重新錄入', '重新錄入按鈕文案錯誤');
  assert.equal(rebindConfirm.publishingLabel, '凝篇中...', '重新錄入提交後未進入防重複提交狀態');
  assert.equal(rebindConfirm.title, '確認重新錄入', '舊統法重新錄入未經過二次確認');
  assert.match(rebindConfirm.body, /不會把統法作為嵌套源法重複計算/, '重新錄入確認未說明葉子展開規則');
  assert.equal(rebindConfirm.confirmLabel, '確認重錄', '重新錄入確認按鈕文案錯誤');
  assert.deepEqual(rebindConfirm.payload?.sourceTechniqueIds, ['agg_mobile_previous_v4'], '重新录入提交的旧统法错误');
  assert.equal('customName' in (rebindConfirm.payload ?? {}), false, '重新录入不应提交可改写的法脉名讳');

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: SHORT_VIEWPORT.width,
    height: SHORT_VIEWPORT.height,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: SHORT_VIEWPORT.width,
    screenHeight: SHORT_VIEWPORT.height,
  });
  await delay(80);
  assertShell(await cdp.evaluate(measureShellExpression), '短屏手机视口');
  assertSourceLayout(await cdp.evaluate(measureSourceExpression), '短屏手机视口');

  await cdp.evaluate(`document.documentElement.dataset.colorMode = 'dark'`);
  await delay(80);
  assertShell(await cdp.evaluate(measureShellExpression), '短屏深色模式');
  assertSourceLayout(await cdp.evaluate(measureSourceExpression), '短屏深色模式');

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: VIEWPORT.width,
    screenHeight: VIEWPORT.height,
  });
  await cdp.evaluate(`document.documentElement.dataset.colorMode = 'light'`);
  await delay(80);

  const permissions = await cdp.evaluate(openPermissionsExpression);
  assert.equal(permissions.activeMainTab, '權限', '未切換到權限頁');
  assert.equal(permissions.permissionIdentityPreserved, true, '切换权限组时替换了权限根节点');
  assert.deepEqual(permissions.permissionTabLabels, ['参阅', '修订'], '通用權限槽位 Tab 不完整');
  assert.equal(permissions.activePermissionTab, '修订', '修訂權限槽位未切換');
  assert.equal(permissions.activePermissionMode, '自定義策略', '修訂權限策略模式錯誤');
  assert.match(permissions.permissionEditorText, /預設策略：僅所有者/, '修訂權限默認策略說明錯誤');
  assert.equal(permissions.hasInlineConditions, false, '统法台权限页不应内嵌自定义条件');
  assert.equal(permissions.customPanelIndependent, true, '统法台自定义策略未使用独立权限面板');
  assert.equal(permissions.customPanelOverflow, false, '统法台自定义权限面板出现横向溢出');
  assert(permissions.customPanelCloseSize >= 39.5, '自定义权限面板关闭按钮触控尺寸不足 40px');
  assert.deepEqual(permissions.checkedRevisionRoles, ['內門弟子'], '修訂權限草稿未獨立保留');
  assert(permissions.minPolicyOptionHeight >= 39.5, '权限选项触控高度不足 40px');
  assert(permissions.minPermissionTabHeight >= 41.5, '权限 Tab 触控高度不足 42px');
  assert.equal(permissions.hasDirectory, false, '权限页混入法卷目录');
  assert.equal(permissions.hasJadeRecord, false, '权限页混入录法内容');

  const overview = await cdp.evaluate(openOverviewExpression);
  assert.equal(overview.activeMainTab, '總覽', '未切回總覽頁');
  assert.equal(overview.metricCount, 2, '已绑定总览指标不完整');
  assert.match(overview.overviewText, /源法 2 部/, '總覽未顯示源法數量');
  assert.match(overview.overviewText, /法脈所錄/, '總覽未顯示錄入構成');
  assert.match(overview.overviewText, /圓滿六維總加成/, '總覽六維標題不符合玩家語義');
  assert.doesNotMatch(overview.overviewText, /預檢|二次確認|服務端|客戶端|revision|messageKey|Lv\./, '總覽仍暴露開發者術語');
  assert.deepEqual(overview.sourceNames, ['凡阶归元功1', '凡阶归元功2'], '总览源法名录不完整');
  assert.equal(overview.attributeTexts.length, 6, '总览未显示完整六维加成');
  assert.deepEqual(overview.attributeTexts, ['體魄 +111', '神識 +122', '身法 +133', '根骨 +144', '力道 +155', '經脈 +166'], '总览六维加成显示错误');
  assert.equal(overview.sourceOverflowY, 'visible', '手机端录法构成未随正文纵向展开');
  assert.equal(overview.overflow, false, '总览源法与六维区域出现横向溢出');
  assert.equal(overview.hasRecordTabs, false, '总览页混入录法方式');
  assert.equal(overview.hasPermissions, false, '总览页混入权限编辑器');

  const revisionUpdate = await cdp.evaluate(inspectRevisionUpdateExpression);
  assert.equal(revisionUpdate.learnLabel, '獲取最新版 · 第 4 卷', '舊卷玩家未顯示最新版獲取入口');
  assert.equal(revisionUpdate.learnDisabled, false, '旧卷玩家的最新版获取入口被错误禁用');
  assert.match(revisionUpdate.summary, /已習得第 3 卷 · 最新第 4 卷/, '總覽未明確展示舊卷與最新卷差異');

  const catalogRefresh = await cdp.evaluate(inspectCatalogRefreshExpression);
  assert.equal(catalogRefresh.requestCountDelta, 1, '同一新卷通知触发了重复面板请求');
  assert.equal(catalogRefresh.latestRequest?.buildingId, 'building:mobile-proof', '目录更新未重拉当前统法台');
  assert.match(catalogRefresh.latestRequest?.requestId ?? '', /^technique-aggregation:/, '目录更新请求缺少独立 requestId');
  assert.equal(catalogRefresh.learnLabel, '獲取最新版 · 第 5 卷', '目錄更新後未展示最新卷獲取入口');
  assert.match(catalogRefresh.summary, /已習得第 3 卷 · 最新第 5 卷/, '目錄更新後卷次摘要仍然陳舊');
  assert.equal(catalogRefresh.publishResult, '「太玄归一真经」第 5 卷已成。', '目錄刷新搶先到達時誤丟了合法修訂結果');

  const restricted = await cdp.evaluate(restrictTabsExpression);
  assert.deepEqual(restricted.labels, ['總覽'], '普通參閱者仍可看到錄法或權限 Tab');
  assert.equal(restricted.active, '總覽', '權限收窄後未回退總覽');
  assert.equal(restricted.hasRecordTabs, false, '普通参阅者仍可进入录法页');
  assert.equal(restricted.hasPermissions, false, '非建造者仍可进入权限页');

  const sanitizedError = await cdp.evaluate(inspectSanitizedErrorExpression);
  assert.match(sanitizedError.conflictText, /1 部已有法脈/, '衝突提示未保留玩家可理解的數量');
  assert.match(sanitizedError.conflictText, /1 部已有功法/, '重疊提示未保留玩家可理解的數量');
  assert.match(sanitizedError.conflictText, /1 部不可入卷/, '無效功法提示未保留玩家可理解的數量');
  assert.doesNotMatch(sanitizedError.conflictText, /agg_internal_debug|gen_internal_debug|gen_invalid_debug|internal_overlap/, '冲突提示泄露内部标识');
  assert.equal(sanitizedError.fallbackText, '法脈凝篇未成，請稍後再試。', '未知錯誤未使用玩家可見兜底文案');
  assert.doesNotMatch(sanitizedError.fallbackText, /internal_unknown|messageKey/, '未知错误泄露内部消息键');
});

console.log('technique unification mobile proof passed');
