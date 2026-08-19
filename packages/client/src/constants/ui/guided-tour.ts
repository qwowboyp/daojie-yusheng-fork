/**
 * 客户端新手导览配置。
 *
 * 这里只描述“指向哪里、进入前做什么、如何推进”，具体遮罩和定位由 ui/guided-tour.ts 负责。
 */

export type GuidedTourPlacement = 'auto' | 'top' | 'right' | 'bottom' | 'left';

export type GuidedTourAdvanceMode = 'next' | 'target-click';

export type GuidedTourPrepareWhen = 'always' | 'mobile' | 'desktop';

export type GuidedTourPrepareAction =
  | {
      type: 'switch-tab';
      tabName: string;
      when?: GuidedTourPrepareWhen;
    }
  | {
      type: 'set-layout-collapsed';
      target: 'left' | 'right' | 'bottom';
      collapsed: boolean;
      when?: GuidedTourPrepareWhen;
    }
  | {
      type: 'click';
      selector: string;
      mobileSelector?: string;
      waitMs?: number;
      when?: GuidedTourPrepareWhen;
    };

export interface GuidedTourStep {
  id: string;
  targetSelector: string;
  mobileTargetSelector?: string;
  titleKey: string;
  titleFallback: string;
  bodyKey: string;
  bodyFallback: string;
  placement?: GuidedTourPlacement;
  advanceMode?: GuidedTourAdvanceMode;
  prepare?: GuidedTourPrepareAction[];
}

export interface GuidedTourFlow {
  id: string;
  storageVersion: number;
  autoStart: boolean;
  titleKey: string;
  titleFallback: string;
  steps: GuidedTourStep[];
}

export const STARTER_GUIDED_TOUR_FLOW_ID = 'starter-basics';

const OPEN_ACTION_PANEL_PREPARE: GuidedTourPrepareAction[] = [
  { type: 'set-layout-collapsed', target: 'right', collapsed: false, when: 'desktop' },
  { type: 'switch-tab', tabName: 'mobile-action', when: 'mobile' },
];

const OPEN_TECHNIQUE_PANEL_PREPARE: GuidedTourPrepareAction[] = [
  { type: 'set-layout-collapsed', target: 'right', collapsed: false, when: 'desktop' },
  { type: 'switch-tab', tabName: 'mobile-bag', when: 'mobile' },
  { type: 'switch-tab', tabName: 'technique' },
];

const OPEN_ATTR_PANEL_PREPARE: GuidedTourPrepareAction[] = [
  { type: 'set-layout-collapsed', target: 'left', collapsed: false, when: 'desktop' },
  { type: 'switch-tab', tabName: 'mobile-attrs', when: 'mobile' },
];

const OPEN_ATTR_CRAFT_PANEL_PREPARE: GuidedTourPrepareAction[] = [
  ...OPEN_ATTR_PANEL_PREPARE,
  { type: 'click', selector: '[data-guided-tour-attr-tab="craft"]' },
];

export const GUIDED_TOUR_FLOWS: GuidedTourFlow[] = [
  {
    id: STARTER_GUIDED_TOUR_FLOW_ID,
    storageVersion: 2,
    autoStart: true,
    titleKey: 'guided-tour.flow.starter.title',
    titleFallback: '基礎界面導覽',
    steps: [
      {
        id: 'hud',
        targetSelector: '#hud',
        titleKey: 'guided-tour.step.hud.title',
        titleFallback: '先看自身狀態',
        bodyKey: 'guided-tour.step.hud.body',
        bodyFallback: '這裡顯示角色、境界、氣血、靈力和突破入口。後續能突破時，按鈕會出現在境界區域。',
        placement: 'right',
        prepare: [
          { type: 'set-layout-collapsed', target: 'left', collapsed: false, when: 'desktop' },
          { type: 'switch-tab', tabName: 'mobile-overview', when: 'mobile' },
        ],
      },
      {
        id: 'map',
        targetSelector: '#game-stage',
        titleKey: 'guided-tour.step.map.title',
        titleFallback: '地圖是主要行動區',
        bodyKey: 'guided-tour.step.map.body',
        bodyFallback: '點擊可見地圖格子可以移動或選擇目標。戰鬥、採集、觀察等指向性操作也會落在這裡。',
        placement: 'top',
        prepare: [
          { type: 'set-layout-collapsed', target: 'bottom', collapsed: false, when: 'desktop' },
        ],
      },
      {
        id: 'map-icons',
        targetSelector: '#game-stage',
        titleKey: 'guided-tour.step.map-icons.title',
        titleFallback: '先看懂地圖標記',
        bodyKey: 'guided-tour.step.map-icons.body',
        bodyFallback: 'NPC 頭頂出現任務標記時，! 表示可接任務，? 表示可交付，... 表示任務正在進行。傳送點和樓梯用於跨地圖，寶箱、草藥、礦脈等資源點可以觀察或交互，紅色敵對目標通常會進入戰鬥。',
        placement: 'top',
        prepare: [
          { type: 'set-layout-collapsed', target: 'bottom', collapsed: false, when: 'desktop' },
        ],
      },
      {
        id: 'inventory-tab',
        targetSelector: '[data-tab="inventory"]',
        mobileTargetSelector: '[data-tab="mobile-bag"]',
        titleKey: 'guided-tour.step.inventory.title',
        titleFallback: '打開行囊',
        bodyKey: 'guided-tour.step.inventory.body',
        bodyFallback: '背包、裝備、功法和任務都在這一側。點擊高亮按鈕進入行囊頁籤。',
        placement: 'left',
        advanceMode: 'target-click',
        prepare: [
          { type: 'set-layout-collapsed', target: 'right', collapsed: false, when: 'desktop' },
        ],
      },
      {
        id: 'action-panel',
        targetSelector: '#pane-action',
        titleKey: 'guided-tour.step.action.title',
        titleFallback: '行動欄執行操作',
        bodyKey: 'guided-tour.step.action.body',
        bodyFallback: '常用互動、技能、開關和通用操作都在行動欄。需要點目標的操作會先進入選擇狀態，再到地圖上點目標。',
        placement: 'left',
        prepare: [
          { type: 'set-layout-collapsed', target: 'right', collapsed: false, when: 'desktop' },
          { type: 'switch-tab', tabName: 'mobile-action', when: 'mobile' },
        ],
      },
      {
        id: 'tutorial-book',
        targetSelector: '#hud-open-tutorial',
        titleKey: 'guided-tour.step.tutorial.title',
        titleFallback: '百科隨時可查',
        bodyKey: 'guided-tour.step.tutorial.body',
        bodyFallback: '不清楚系統規則時，可以從這裡打開百科。導覽完成後也能從設置或調試入口重新打開。',
        placement: 'bottom',
        prepare: [
          { type: 'set-layout-collapsed', target: 'left', collapsed: false, when: 'desktop' },
          { type: 'switch-tab', tabName: 'mobile-overview', when: 'mobile' },
        ],
      },
    ],
  },
  {
    id: 'alchemy-guide',
    storageVersion: 1,
    autoStart: false,
    titleKey: 'guided-tour.flow.alchemy.title',
    titleFallback: '煉丹引導',
    steps: [
      {
        id: 'alchemy-attr-panel',
        targetSelector: '#pane-attr',
        titleKey: 'guided-tour.step.alchemy-attr-panel.title',
        titleFallback: '先看左側修行卷',
        bodyKey: 'guided-tour.step.alchemy-attr-panel.body',
        bodyFallback: '煉丹入口在左側修行卷的技藝頁裡。桌面端展開左側，手機端先切到屬性頁。',
        placement: 'right',
        prepare: OPEN_ATTR_PANEL_PREPARE,
      },
      {
        id: 'alchemy-craft-tab',
        targetSelector: '[data-guided-tour-attr-tab="craft"]',
        titleKey: 'guided-tour.step.alchemy-craft-tab.title',
        titleFallback: '切換到技藝',
        bodyKey: 'guided-tour.step.alchemy-craft-tab.body',
        bodyFallback: '點擊技藝頁，進入煉丹、煉器、強化、挖礦等技藝等級與入口列表。',
        placement: 'bottom',
        advanceMode: 'target-click',
        prepare: OPEN_ATTR_PANEL_PREPARE,
      },
      {
        id: 'alchemy-craft-row',
        targetSelector: '[data-guided-tour-craft-skill="alchemy"]',
        titleKey: 'guided-tour.step.alchemy-craft-row.title',
        titleFallback: '找到煉丹',
        bodyKey: 'guided-tour.step.alchemy-craft-row.body',
        bodyFallback: '這一行顯示煉丹等級、經驗進度和距離下一級還需經驗。右側打開按鈕會進入煉丹操作界面。',
        placement: 'right',
        prepare: OPEN_ATTR_CRAFT_PANEL_PREPARE,
      },
      {
        id: 'alchemy-open',
        targetSelector: '[data-guided-tour-craft-open="alchemy"]',
        titleKey: 'guided-tour.step.alchemy-open.title',
        titleFallback: '打開煉丹',
        bodyKey: 'guided-tour.step.alchemy-open.body',
        bodyFallback: '點擊煉丹這一行的打開按鈕，進入對應的煉丹操作界面。',
        placement: 'right',
        advanceMode: 'target-click',
        prepare: OPEN_ATTR_CRAFT_PANEL_PREPARE,
      },
      {
        id: 'alchemy-workbench',
        targetSelector: '.detail-modal--craft [data-craft-workbench-shell="true"]',
        titleKey: 'guided-tour.step.alchemy-workbench.title',
        titleFallback: '煉丹操作界面',
        bodyKey: 'guided-tour.step.alchemy-workbench.body',
        bodyFallback: '左側是技藝模式切換，右側是當前煉丹內容。基礎丹方和自定義丹方都在這裡完成。',
        placement: 'left',
      },
      {
        id: 'alchemy-mortal-realm',
        targetSelector: '[data-guided-tour-alchemy-realm="mortal"]',
        titleKey: 'guided-tour.step.alchemy-mortal-realm.title',
        titleFallback: '選擇凡胎',
        bodyKey: 'guided-tour.step.alchemy-mortal-realm.body',
        bodyFallback: '先按丹藥適用階段篩選。回春散是凡胎階段的基礎恢復丹藥，點擊凡胎分組。',
        placement: 'bottom',
        advanceMode: 'target-click',
      },
      {
        id: 'alchemy-recovery-category',
        targetSelector: '[data-guided-tour-alchemy-category="recovery"]',
        titleKey: 'guided-tour.step.alchemy-recovery-category.title',
        titleFallback: '選擇回覆藥',
        bodyKey: 'guided-tour.step.alchemy-recovery-category.body',
        bodyFallback: '再按用途篩選。回覆藥分組會收束到氣血、靈力等恢復類丹藥。',
        placement: 'bottom',
        advanceMode: 'target-click',
      },
      {
        id: 'alchemy-minor-heal',
        targetSelector: '[data-guided-tour-alchemy-output="pill.minor_heal"], [data-guided-tour-alchemy-recipe="alchemy.pill.minor_heal"]',
        titleKey: 'guided-tour.step.alchemy-minor-heal.title',
        titleFallback: '選擇回春散',
        bodyKey: 'guided-tour.step.alchemy-minor-heal.body',
        bodyFallback: '點擊凡胎回春散後，右側會顯示等級、品階、五行匹配、材料、耗時、成功率和單批產出。',
        placement: 'right',
        advanceMode: 'target-click',
      },
      {
        id: 'alchemy-detail',
        targetSelector: '[data-alchemy-detail-panel="true"]',
        titleKey: 'guided-tour.step.alchemy-detail.title',
        titleFallback: '查看丹方詳情',
        bodyKey: 'guided-tour.step.alchemy-detail.body',
        bodyFallback: '詳情區會對比當前投料和標準需求。基礎丹方按固定材料煉製，適合穩定生產。',
        placement: 'left',
      },
      {
        id: 'alchemy-custom-tab',
        targetSelector: '[data-guided-tour-alchemy-tab="simple"]',
        titleKey: 'guided-tour.step.alchemy-custom-tab.title',
        titleFallback: '切到自定義丹方',
        bodyKey: 'guided-tour.step.alchemy-custom-tab.body',
        bodyFallback: '自定義丹方允許調整輔藥，用不同材料嘗試滿足五行需求。點擊這裡查看自定義投料區。',
        placement: 'bottom',
        advanceMode: 'target-click',
      },
      {
        id: 'alchemy-custom-detail',
        targetSelector: '[data-alchemy-ingredients="true"], [data-alchemy-actions="true"]',
        titleKey: 'guided-tour.step.alchemy-custom-detail.title',
        titleFallback: '自定義丹方說明',
        bodyKey: 'guided-tour.step.alchemy-custom-detail.body',
        bodyFallback: '主藥通常固定，輔藥可以加減。系統會按當前投料重新計算成功率、耗時和是否滿足完整丹方。',
        placement: 'left',
      },
      {
        id: 'alchemy-base-tab',
        targetSelector: '[data-guided-tour-alchemy-tab="full"]',
        titleKey: 'guided-tour.step.alchemy-base-tab.title',
        titleFallback: '回到基礎丹方',
        bodyKey: 'guided-tour.step.alchemy-base-tab.body',
        bodyFallback: '點擊基礎丹方，回到標準配方視圖。新手優先用基礎丹方確認材料和消耗。',
        placement: 'bottom',
        advanceMode: 'target-click',
      },
      {
        id: 'alchemy-start',
        targetSelector: '[data-guided-tour-alchemy-start="full"]',
        titleKey: 'guided-tour.step.alchemy-start.title',
        titleFallback: '開始煉製',
        bodyKey: 'guided-tour.step.alchemy-start.body',
        bodyFallback: '材料足夠時，從這裡開始煉製或加入技藝隊列。按鈕不可點時，先補齊材料或靈石。',
        placement: 'top',
      },
    ],
  },
  {
    id: 'observe-guide',
    storageVersion: 1,
    autoStart: false,
    titleKey: 'guided-tour.flow.observe.title',
    titleFallback: '觀察功能引導',
    steps: [
      {
        id: 'observe-action-panel',
        targetSelector: '#pane-action',
        titleKey: 'guided-tour.step.observe-action-panel.title',
        titleFallback: '打開行動欄',
        bodyKey: 'guided-tour.step.observe-action-panel.body',
        bodyFallback: '觀察是指向地圖格子的通用操作，先打開行動欄。',
        placement: 'left',
        prepare: OPEN_ACTION_PANEL_PREPARE,
      },
      {
        id: 'observe-utility-tab',
        targetSelector: '[data-action-tab="utility"]',
        titleKey: 'guided-tour.step.observe-utility-tab.title',
        titleFallback: '切到通用頁',
        bodyKey: 'guided-tour.step.observe-utility-tab.body',
        bodyFallback: '通用頁放置觀察、強制攻擊、返回復活點等不屬於普通技能的操作。',
        placement: 'bottom',
        advanceMode: 'target-click',
        prepare: OPEN_ACTION_PANEL_PREPARE,
      },
      {
        id: 'observe-button',
        targetSelector: '[data-action-exec="client:observe"]',
        titleKey: 'guided-tour.step.observe-button.title',
        titleFallback: '點擊觀察',
        bodyKey: 'guided-tour.step.observe-button.body',
        bodyFallback: '點擊觀察後會進入選格狀態，不會立刻消耗資源。接著到地圖上選擇要查看的格子。',
        placement: 'left',
        advanceMode: 'target-click',
        prepare: [
          ...OPEN_ACTION_PANEL_PREPARE,
          { type: 'click', selector: '[data-action-tab="utility"]' },
        ],
      },
      {
        id: 'observe-map',
        targetSelector: '#game-stage',
        titleKey: 'guided-tour.step.observe-map.title',
        titleFallback: '在地圖上選格',
        bodyKey: 'guided-tour.step.observe-map.body',
        bodyFallback: '觀察可以查看視野內格子的地形、資源、建築或實體訊息。選中目標後，詳情會在界面中彈出。',
        placement: 'top',
      },
    ],
  },
  {
    id: 'sense-qi-guide',
    storageVersion: 1,
    autoStart: false,
    titleKey: 'guided-tour.flow.sense-qi.title',
    titleFallback: '感氣功能引導',
    steps: [
      {
        id: 'sense-qi-toggle-tab',
        targetSelector: '[data-action-tab="toggle"]',
        titleKey: 'guided-tour.step.sense-qi-toggle-tab.title',
        titleFallback: '切到開關頁',
        bodyKey: 'guided-tour.step.sense-qi-toggle-tab.body',
        bodyFallback: '感氣是顯示類開關，先進入行動欄的開關頁。',
        placement: 'bottom',
        advanceMode: 'target-click',
        prepare: OPEN_ACTION_PANEL_PREPARE,
      },
      {
        id: 'sense-qi-card',
        targetSelector: '[data-action-card="sense_qi:toggle"]',
        titleKey: 'guided-tour.step.sense-qi-card.title',
        titleFallback: '開啟感氣',
        bodyKey: 'guided-tour.step.sense-qi-card.body',
        bodyFallback: '點擊感氣開關後，地圖會顯示可感知的靈氣、魔氣、煞氣等氣機線索。',
        placement: 'left',
        advanceMode: 'target-click',
        prepare: [
          ...OPEN_ACTION_PANEL_PREPARE,
          { type: 'click', selector: '[data-action-tab="toggle"]' },
        ],
      },
      {
        id: 'sense-qi-map',
        targetSelector: '#game-stage',
        titleKey: 'guided-tour.step.sense-qi-map.title',
        titleFallback: '觀察地圖氣機',
        bodyKey: 'guided-tour.step.sense-qi-map.body',
        bodyFallback: '開啟後回到地圖查看氣機疊層。不同地點的靈氣、陣法、地塊狀態會影響後續判斷。',
        placement: 'top',
      },
    ],
  },
  {
    id: 'cultivation-guide',
    storageVersion: 1,
    autoStart: false,
    titleKey: 'guided-tour.flow.cultivation.title',
    titleFallback: '修煉引導',
    steps: [
      {
        id: 'cultivation-open-bag',
        targetSelector: '[data-tab="inventory"]',
        mobileTargetSelector: '[data-tab="mobile-bag"]',
        titleKey: 'guided-tour.step.cultivation-open-bag.title',
        titleFallback: '打開行囊側欄',
        bodyKey: 'guided-tour.step.cultivation-open-bag.body',
        bodyFallback: '功法面板在行囊側欄裡。桌面端展開右側，手機端先切到行囊頁。',
        placement: 'left',
        advanceMode: 'target-click',
        prepare: [
          { type: 'set-layout-collapsed', target: 'right', collapsed: false, when: 'desktop' },
          { type: 'switch-tab', tabName: 'mobile-bag', when: 'mobile' },
        ],
      },
      {
        id: 'cultivation-technique-tab',
        targetSelector: '[data-tab="technique"]',
        titleKey: 'guided-tour.step.cultivation-technique-tab.title',
        titleFallback: '切到功法',
        bodyKey: 'guided-tour.step.cultivation-technique-tab.body',
        bodyFallback: '修煉功法前，先進入功法頁查看已學功法、領悟進度和主修按鈕。',
        placement: 'bottom',
        advanceMode: 'target-click',
        prepare: [
          { type: 'set-layout-collapsed', target: 'right', collapsed: false, when: 'desktop' },
          { type: 'switch-tab', tabName: 'mobile-bag', when: 'mobile' },
        ],
      },
      {
        id: 'cultivation-technique-card',
        targetSelector: '[data-guided-tour-cultivate-button="true"], [data-tech-cultivate-button]',
        titleKey: 'guided-tour.step.cultivation-technique-card.title',
        titleFallback: '選擇主修功法',
        bodyKey: 'guided-tour.step.cultivation-technique-card.body',
        bodyFallback: '這裡可以把某門功法設為主修。若按鈕顯示取消主修，說明當前已經有功法在修煉中。',
        placement: 'left',
        prepare: OPEN_TECHNIQUE_PANEL_PREPARE,
      },
      {
        id: 'cultivation-toggle-tab',
        targetSelector: '[data-action-tab="toggle"]',
        titleKey: 'guided-tour.step.cultivation-toggle-tab.title',
        titleFallback: '回到修煉開關',
        bodyKey: 'guided-tour.step.cultivation-toggle-tab.body',
        bodyFallback: '主修功法確定後，再回到行動欄開關頁控制當前是否閉關修煉。',
        placement: 'bottom',
        advanceMode: 'target-click',
        prepare: OPEN_ACTION_PANEL_PREPARE,
      },
      {
        id: 'cultivation-toggle-card',
        targetSelector: '[data-action-card="cultivation:toggle"]',
        titleKey: 'guided-tour.step.cultivation-toggle-card.title',
        titleFallback: '當前修煉開關',
        bodyKey: 'guided-tour.step.cultivation-toggle-card.body',
        bodyFallback: '這個開關控制是否進行閉關修煉。開啟後每息獲得境界修為和主修功法經驗，移動、攻擊等操作可能打斷當前修煉狀態。',
        placement: 'left',
        prepare: [
          ...OPEN_ACTION_PANEL_PREPARE,
          { type: 'click', selector: '[data-action-tab="toggle"]' },
        ],
      },
      {
        id: 'cultivation-auto-card',
        targetSelector: '[data-action-card="toggle:auto_idle_cultivation"], [data-action-card="toggle:auto_switch_cultivation"]',
        titleKey: 'guided-tour.step.cultivation-auto-card.title',
        titleFallback: '自動修煉選項',
        bodyKey: 'guided-tour.step.cultivation-auto-card.body',
        bodyFallback: '自動修煉會在空閒時嘗試恢復修煉；修滿切換可輔助輪換功法。按當前策略選擇開啟即可。',
        placement: 'left',
        prepare: [
          ...OPEN_ACTION_PANEL_PREPARE,
          { type: 'click', selector: '[data-action-tab="toggle"]' },
        ],
      },
    ],
  },
  {
    id: 'force-attack-guide',
    storageVersion: 1,
    autoStart: false,
    titleKey: 'guided-tour.flow.force-attack.title',
    titleFallback: '強制攻擊引導',
    steps: [
      {
        id: 'force-attack-utility-tab',
        targetSelector: '[data-action-tab="utility"]',
        titleKey: 'guided-tour.step.force-attack-utility-tab.title',
        titleFallback: '切到通用頁',
        bodyKey: 'guided-tour.step.force-attack-utility-tab.body',
        bodyFallback: '強制攻擊屬於通用操作，用於主動選擇目標發起攻擊。',
        placement: 'bottom',
        advanceMode: 'target-click',
        prepare: OPEN_ACTION_PANEL_PREPARE,
      },
      {
        id: 'force-attack-button',
        targetSelector: '[data-action-exec="battle:force_attack"]',
        titleKey: 'guided-tour.step.force-attack-button.title',
        titleFallback: '點擊強制攻擊',
        bodyKey: 'guided-tour.step.force-attack-button.body',
        bodyFallback: '點擊後進入選目標狀態。它不會自動找怪，需要你在地圖上指定要攻擊的目標。',
        placement: 'left',
        advanceMode: 'target-click',
        prepare: [
          ...OPEN_ACTION_PANEL_PREPARE,
          { type: 'click', selector: '[data-action-tab="utility"]' },
        ],
      },
      {
        id: 'force-attack-map',
        targetSelector: '#game-stage',
        titleKey: 'guided-tour.step.force-attack-map.title',
        titleFallback: '選擇攻擊目標',
        bodyKey: 'guided-tour.step.force-attack-map.body',
        bodyFallback: '在地圖上點擊視野內目標即可發起攻擊。請注意玩家、怪物、建築或陣法目標的可攻擊規則不同。',
        placement: 'top',
      },
    ],
  },
  {
    id: 'mining-guide',
    storageVersion: 2,
    autoStart: false,
    titleKey: 'guided-tour.flow.mining.title',
    titleFallback: '挖礦引導',
    steps: [
      {
        id: 'mining-quest-tab',
        targetSelector: '[data-tab="quest"]',
        mobileTargetSelector: '[data-tab="quest"]',
        titleKey: 'guided-tour.step.mining-quest-tab.title',
        titleFallback: '先從任務定位入口',
        bodyKey: 'guided-tour.step.mining-quest-tab.body',
        bodyFallback: '帶挖礦引導的任務詳情裡會出現“打開引導”和“前往目標”。任務導航負責找當前任務地點；本引導用雲來鎮舊屋礦窖演示入門挖礦路線。',
        placement: 'bottom',
        advanceMode: 'target-click',
        prepare: [
          { type: 'set-layout-collapsed', target: 'right', collapsed: false, when: 'desktop' },
          { type: 'switch-tab', tabName: 'mobile-bag', when: 'mobile' },
        ],
      },
      {
        id: 'mining-town-entrance',
        targetSelector: '#game-stage',
        titleKey: 'guided-tour.step.mining-town-entrance.title',
        titleFallback: '到雲來鎮礦井前',
        bodyKey: 'guided-tour.step.mining-town-entrance.body',
        bodyFallback: '雲來鎮舊屋礦窖入口地標在 (42,17) 附近，實際樓梯傳送點在 (38,14)。如果門口石頭擋住路線，先在地圖上選中石頭目標處理掉，再靠近樓梯。',
        placement: 'top',
      },
      {
        id: 'mining-clear-stone',
        targetSelector: '#game-stage',
        titleKey: 'guided-tour.step.mining-clear-stone.title',
        titleFallback: '清掉門口石頭',
        bodyKey: 'guided-tour.step.mining-clear-stone.body',
        bodyFallback: '石頭和礦脈都屬於可受損地塊。選中石頭後使用強制攻擊或可用的採掘操作，服務端會按地塊耐久結算；石頭被破壞後路線才會打開。',
        placement: 'top',
      },
      {
        id: 'mining-use-portal',
        targetSelector: '#game-stage',
        titleKey: 'guided-tour.step.mining-use-portal.title',
        titleFallback: '踩上傳送樓梯',
        bodyKey: 'guided-tour.step.mining-use-portal.body',
        bodyFallback: '點擊樓梯傳送點會自動尋路；角色站到傳送點後會進入雲來鎮·舊屋礦窖。傳送和落點仍由服務端處理，導覽不會替你跨圖。',
        placement: 'top',
      },
      {
        id: 'mining-basement-node',
        targetSelector: '#game-stage',
        titleKey: 'guided-tour.step.mining-basement-node.title',
        titleFallback: '靠近玄鐵礦脈',
        bodyKey: 'guided-tour.step.mining-basement-node.body',
        bodyFallback: '進入舊屋礦窖後，移動到玄鐵礦脈 (10,9) 附近。挖礦按鈕只會在附近存在可見礦脈時出現，找不到按鈕時先繼續靠近或觀察目標格。',
        placement: 'top',
      },
      {
        id: 'mining-skill-tab',
        targetSelector: '[data-action-tab="skill"]',
        titleKey: 'guided-tour.step.mining-skill-tab.title',
        titleFallback: '切到技能頁',
        bodyKey: 'guided-tour.step.mining-skill-tab.body',
        bodyFallback: '挖礦是需要附近有礦脈時出現的採集行動。先進入行動欄的技能頁。',
        placement: 'bottom',
        advanceMode: 'target-click',
        prepare: OPEN_ACTION_PANEL_PREPARE,
      },
      {
        id: 'mining-button',
        targetSelector: '[data-action-exec="mining:start"], [data-action-card="mining:start"]',
        titleKey: 'guided-tour.step.mining-button.title',
        titleFallback: '點擊挖礦',
        bodyKey: 'guided-tour.step.mining-button.body',
        bodyFallback: '看到挖礦行動時，點擊它進入礦脈選擇狀態。若當前沒有這個按鈕，說明附近沒有可採的可見礦脈。',
        placement: 'left',
        advanceMode: 'target-click',
        prepare: [
          ...OPEN_ACTION_PANEL_PREPARE,
          { type: 'click', selector: '[data-action-tab="skill"]' },
        ],
      },
      {
        id: 'mining-map',
        targetSelector: '#game-stage',
        titleKey: 'guided-tour.step.mining-map.title',
        titleFallback: '選擇礦脈格',
        bodyKey: 'guided-tour.step.mining-map.body',
        bodyFallback: '移動到礦脈附近後，在地圖上選擇可見礦脈格即可開始採集。挖礦按鈕隨位置和可見目標動態出現。',
        placement: 'top',
      },
    ],
  },
];
