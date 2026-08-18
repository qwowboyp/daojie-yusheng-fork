/**
 * 本文件属于正式客户端主线，负责前端启动、状态拼装、工具函数或表现层逻辑。
 *
 * 维护时要把用户意图、显示派生和服务端权威数据分清，避免为了展示便利复制业务规则。
 */
import type { SocketAdminSender } from './network/socket-send-admin';
import type { SocketPanelSender } from './network/socket-send-panel';
import type { SocketRuntimeSender } from './network/socket-send-runtime';
import type { SocketSocialEconomySender } from './network/socket-send-social-economy';
import type { ChatUI } from './ui/chat';
import { bindZoomControls } from './main-ui-helpers';
import { t } from './ui/i18n';
/**
 * MainStartupBindingsOptions：统一结构类型，保证协议与运行时一致性。
 */


type MainStartupBindingsOptions = {
/**
 * documentRef：documentRef相关字段。
 */

  documentRef: Document;
  /**
 * initializeUiStyleConfig：initializeUiStyle配置状态或数据块。
 */

  initializeUiStyleConfig: () => void;
  /**
 * mountReactUi：mountReactUi相关字段。
 */

  mountReactUi: () => void;
  /**
 * startClientVersionReload：startClientVersionReload相关字段。
 */

  startClientVersionReload: (options: {
  /**
 * onBeforeReload：onBeforeReload相关字段。
 */
 onBeforeReload: () => void }) => void;
 /**
 * onBeforeVersionReload：onBeforeVersionReload相关字段。
 */

  onBeforeVersionReload: () => void;
  /**
 * createChangelogPanel：Changelog面板相关字段。
 */

  createChangelogPanel: () => void;
  /**
 * createTutorialPanel：Tutorial面板相关字段。
 */

  createTutorialPanel: () => void;
  /**
 * syncInitialPanelRuntime：Initial面板运行态引用。
 */

  syncInitialPanelRuntime: () => void;
  /**
 * subscribePanelStore：subscribe面板存储引用。
 */

  subscribePanelStore: () => void;
  /**
 * attachMapRuntime：attach地图运行态引用。
 */

  attachMapRuntime: () => void;
  /**
 * bodyTrainingPanel：bodyTraining面板相关字段。
 */

  bodyTrainingPanel: {
  /**
 * setInfusionHandler：InfusionHandler相关字段。
 */

    setInfusionHandler: (handler: (foundationSpent: number) => void) => void;
  };
  /**
 * hud：hud相关字段。
 */

  hud: {
  /**
 * setCallbacks：Callback相关字段。
 */

    setCallbacks: (callback: () => void) => void;
  };
  /**
 * lootPanel：掉落面板相关字段。
 */

  lootPanel: {
  /**
 * setCallbacks：Callback相关字段。
 */

    setCallbacks: (
      onTakeOne: (sourceId: string, itemKey: string) => void,
      onTakeAll: (sourceId: string) => void,
      onStartGather?: (sourceId: string, itemKey: string) => void,
      onCancelGather?: () => void,
      onStopHarvest?: () => void,
    ) => void;
  };
  /**
 * equipmentPanel：装备面板相关字段。
 */

  equipmentPanel: {
  /**
 * setCallbacks：Callback相关字段。
 */

    setCallbacks: (
      onUnequip: (slot: Parameters<SocketPanelSender['sendUnequip']>[0], expectedItemInstanceId?: string) => void,
      onSetArtifactSlotEnabled?: (
        slot: Parameters<SocketPanelSender['sendSetArtifactSlotEnabled']>[0],
        enabled: Parameters<SocketPanelSender['sendSetArtifactSlotEnabled']>[1],
      ) => void,
    ) => void;
  };
  /**
 * npcShopModal：NPCShop弹层相关字段。
 */

  npcShopModal: {
  /**
 * setCallbacks：Callback相关字段。
 */

    setCallbacks: (callbacks: {
    /**
 * onRequestShop：onRequestShop相关字段。
 */

      onRequestShop: (npcId: string) => void;
      /**
 * onBuyItem：onBuy道具相关字段。
 */

      onBuyItem: (npcId: string, itemId: string, quantity: number) => void;
    }) => void;
  };
  /**
 * craftWorkbenchModal：炼制Workbench弹层相关字段。
 */

  craftWorkbenchModal: {
  /**
 * setCallbacks：Callback相关字段。
 */

    setCallbacks: (callbacks: {
    /**
 * onRequestAlchemy：onRequest炼丹相关字段。
 */

      onRequestAlchemy: (knownCatalogVersion?: number) => void;
      onRequestForging: (knownCatalogVersion?: number) => void;
      /**
 * onSaveAlchemyPreset：onSave炼丹预设相关字段。
 */

      onSaveAlchemyPreset: (payload: Parameters<SocketPanelSender['sendSaveAlchemyPreset']>[0]) => void;
      /**
 * onDeleteAlchemyPreset：onDelete炼丹预设相关字段。
 */

      onDeleteAlchemyPreset: (presetId: string) => void;
      /**
 * onRequestEnhancement：onRequest强化相关字段。
 */

      onRequestEnhancement: () => void;
      /**
 * onStartAlchemy：onStart炼丹相关字段。
 */

      onStartAlchemy: (recipeId: string, ingredients: Array<{
      /**
 * itemId：道具ID标识。
 */
 itemId: string;
 /**
 * count：数量或计量字段。
 */
 count: number }>, quantity: number, queueMode?: Parameters<SocketPanelSender['sendStartAlchemy']>[0]['queueMode']) => void;
      onStartForging: (recipeId: string, ingredients: Array<{
 itemId: string;
 count: number }>, quantity: number, queueMode?: Parameters<SocketPanelSender['sendStartForging']>[0]['queueMode']) => void;
 /**
 * onCancelAlchemy：onCancel炼丹相关字段。
 */

      onCancelAlchemy: () => void;
      onCancelForging: () => void;
      onCancelTechniqueActivity: (cancelRef: Parameters<SocketPanelSender['sendCancelTechniqueActivity']>[0]) => void;
      onReorderTechniqueActivityQueue: (...args: Parameters<SocketPanelSender['sendReorderTechniqueActivityQueue']>) => void;
      /**
 * onStartEnhancement：onStart强化相关字段。
 */

      onStartEnhancement: (payload: Parameters<SocketPanelSender['sendStartEnhancement']>[0]) => void;
      /**
 * onCancelEnhancement：onCancel强化相关字段。
 */

      onCancelEnhancement: () => void;
      onDecomposeTechniqueBook?: (itemInstanceId: string, count: number) => void;
      onRequestTechniqueAggregation?: (payload: Parameters<SocketPanelSender['sendRequestTechniqueAggregation']>[0]) => boolean | void;
      onCloseTechniqueAggregation?: () => boolean | void;
      onPublishTechniqueAggregation?: (payload: Parameters<SocketPanelSender['sendPublishTechniqueAggregation']>[0]) => boolean | void;
      onLearnTechniqueAggregation?: (payload: Parameters<SocketPanelSender['sendLearnTechniqueAggregation']>[0]) => boolean | void;
    }) => void;
  };
  /**
 * debugPanel：debug面板相关字段。
 */

  debugPanel: {
  /**
 * setCallbacks：Callback相关字段。
 */

    setCallbacks: (onResetSpawn: () => void) => void;
  };
  /**
 * chatUI：chatUI相关字段。
 */

  chatUI: Pick<ChatUI, 'setCallback' | 'setHistorySyncCallback'>;
  /**
 * zoom：zoom相关字段。
 */

  zoom: {
  /**
 * zoomSlider：zoomSlider相关字段。
 */

    zoomSlider: HTMLInputElement | null;
    /**
 * zoomResetBtn：zoomResetBtn相关字段。
 */

    zoomResetBtn: HTMLButtonElement | null;
    /**
 * minZoom：minZoom相关字段。
 */

    minZoom: number;
    /**
 * maxZoom：maxZoom相关字段。
 */

    maxZoom: number;
    /**
 * applyZoomChange：ZoomChange相关字段。
 */

    applyZoomChange: (nextZoom: number) => number;
  };
  /**
 * showToast：showToast相关字段。
 */

  showToast: (message: string) => void;
  /**
 * registerAutoBattleButtons：registerAutoBattleButton相关字段。
 */

  registerAutoBattleButtons: () => void;
  /**
 * onOpenRealmAction：onOpenRealmAction相关字段。
 */

  onOpenRealmAction: () => void;
  /**
 * runtimeSender：运行态Sender相关字段。
 */

  runtimeSender: Pick<SocketRuntimeSender, 'sendAction'>;
  /**
 * panelSender：面板Sender相关字段。
 */

  panelSender: Pick<
    SocketPanelSender,
    | 'sendTakeLoot'
    | 'sendStartGather'
    | 'sendCancelGather'
    | 'sendStopLootHarvest'
    | 'sendUnequip'
    | 'sendSetArtifactSlotEnabled'
    | 'sendRequestNpcShop'
    | 'sendBuyNpcShopItem'
    | 'sendRequestAlchemyPanel'
    | 'sendRequestForgingPanel'
    | 'sendSaveAlchemyPreset'
    | 'sendDeleteAlchemyPreset'
    | 'sendRequestEnhancementPanel'
    | 'sendStartAlchemy'
    | 'sendStartForging'
    | 'sendCancelAlchemy'
    | 'sendCancelForging'
    | 'sendStartEnhancement'
    | 'sendCancelEnhancement'
    | 'sendCancelTechniqueActivity'
    | 'sendReorderTechniqueActivityQueue'
    | 'sendDestroyItem'
    | 'sendRequestTechniqueAggregation'
    | 'sendCloseTechniqueAggregation'
    | 'sendPublishTechniqueAggregation'
    | 'sendLearnTechniqueAggregation'
  >;
  /**
 * socialEconomySender：socialEconomySender相关字段。
 */

  socialEconomySender: Pick<SocketSocialEconomySender, 'sendChat' | 'requestChatHistory'>;
  /**
 * adminSender：adminSender相关字段。
 */

  adminSender: Pick<SocketAdminSender, 'sendDebugResetSpawn'>;
};
/**
 * bindMainStartup：执行bindMainStartup相关逻辑。
 * @param options MainStartupBindingsOptions 选项参数。
 * @returns 无返回值，直接更新bindMainStartup相关状态。
 */


export function bindMainStartup(options: MainStartupBindingsOptions): void {
  // 关键分支按状态与边界条件处理，非法路径会被提前拦截。

  options.initializeUiStyleConfig();
  options.mountReactUi();
  options.startClientVersionReload({
    onBeforeReload: options.onBeforeVersionReload,
  });

  options.createChangelogPanel();
  options.createTutorialPanel();
  options.syncInitialPanelRuntime();
  options.subscribePanelStore();
  options.attachMapRuntime();

  options.bodyTrainingPanel.setInfusionHandler((foundationSpent) => {
    options.runtimeSender.sendAction('body_training:infuse', String(foundationSpent));
  });

  options.hud.setCallbacks(() => {
    options.onOpenRealmAction();
  });

  options.lootPanel.setCallbacks(
    (sourceId, itemKey) => {
      options.panelSender.sendTakeLoot(sourceId, itemKey);
    },
    (sourceId) => {
      options.panelSender.sendTakeLoot(sourceId, undefined, true);
    },
    (sourceId, itemKey) => {
      options.panelSender.sendStartGather({ sourceId, itemKey });
    },
    () => {
      options.panelSender.sendCancelGather();
    },
    () => {
      options.panelSender.sendStopLootHarvest();
    },
  );

  options.equipmentPanel.setCallbacks(
    (slot, expectedItemInstanceId) => {
      options.panelSender.sendUnequip(slot, expectedItemInstanceId);
    },
    (slot, enabled) => {
      options.panelSender.sendSetArtifactSlotEnabled(slot, enabled);
    },
  );

  options.npcShopModal.setCallbacks({
    onRequestShop: (npcId) => options.panelSender.sendRequestNpcShop(npcId),
    onBuyItem: (npcId, itemId, quantity) => options.panelSender.sendBuyNpcShopItem(npcId, itemId, quantity),
  });

  options.craftWorkbenchModal.setCallbacks({
    onRequestAlchemy: (knownCatalogVersion) => options.panelSender.sendRequestAlchemyPanel(knownCatalogVersion),
    onRequestForging: (knownCatalogVersion) => options.panelSender.sendRequestForgingPanel(knownCatalogVersion),
    onSaveAlchemyPreset: (payload) => options.panelSender.sendSaveAlchemyPreset(payload),
    onDeleteAlchemyPreset: (presetId) => options.panelSender.sendDeleteAlchemyPreset(presetId),
    onRequestEnhancement: () => options.panelSender.sendRequestEnhancementPanel(),
    onStartAlchemy: (recipeId, ingredients, quantity, queueMode) => options.panelSender.sendStartAlchemy({ recipeId, ingredients, quantity, queueMode }),
    onStartForging: (recipeId, ingredients, quantity, queueMode) => options.panelSender.sendStartForging({ recipeId, ingredients, quantity, queueMode }),
    onCancelAlchemy: () => options.panelSender.sendCancelAlchemy(),
    onCancelForging: () => options.panelSender.sendCancelForging(),
    onCancelTechniqueActivity: (cancelRef) => options.panelSender.sendCancelTechniqueActivity(cancelRef),
    onReorderTechniqueActivityQueue: (queueId, action) => options.panelSender.sendReorderTechniqueActivityQueue(queueId, action),
    onStartEnhancement: (payload) => options.panelSender.sendStartEnhancement(payload),
    onCancelEnhancement: () => options.panelSender.sendCancelEnhancement(),
    onDecomposeTechniqueBook: (itemInstanceId, count) => options.panelSender.sendDestroyItem(itemInstanceId, count, { mode: 'decompose_technique_book' }),
    onRequestTechniqueAggregation: (payload) => options.panelSender.sendRequestTechniqueAggregation(payload),
    onCloseTechniqueAggregation: () => options.panelSender.sendCloseTechniqueAggregation(),
    onPublishTechniqueAggregation: (payload) => options.panelSender.sendPublishTechniqueAggregation(payload),
    onLearnTechniqueAggregation: (payload) => options.panelSender.sendLearnTechniqueAggregation(payload),
  });

  options.debugPanel.setCallbacks(() => {
    options.showToast(t('startup.toast.returning-spawn'));
    options.adminSender.sendDebugResetSpawn();
  });

  options.chatUI.setCallback((message, channel) => {
    options.socialEconomySender.sendChat(message, channel);
  });
  options.chatUI.setHistorySyncCallback((payload) => {
    options.socialEconomySender.requestChatHistory(payload);
  });

  bindZoomControls({
    zoomSlider: options.zoom.zoomSlider,
    zoomResetBtn: options.zoom.zoomResetBtn,
    minZoom: options.zoom.minZoom,
    maxZoom: options.zoom.maxZoom,
    applyZoomChange: options.zoom.applyZoomChange,
    showToast: options.showToast,
  });

  options.registerAutoBattleButtons();
}
