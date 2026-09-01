/** 统一协调「队伍 + 宗門目錄 + 四个道友子页」固定尺寸独立面板的互斥显示。 */
import type { SocialPanel } from './ui/panels/social-panel';
import type { PartyWorkspacePanel } from './ui/party-workspace-panel';

/** 宗門目錄面板控制器：todo 7 由 React 面板接線提供，未提供時 open/close 均為 no-op。 */
type MainSocialPanelSectDirectoryController = {
  open(opener: HTMLElement | null): void;
  close(): void;
};

type MainSocialPanelNavigationOptions = {
  socialPanel: SocialPanel;
  partyPanel: PartyWorkspacePanel;
  /** 宗門目錄 React 面板控制器（可空佔位，todo 7 接入）。 */
  sectDirectoryPanel?: MainSocialPanelSectDirectoryController | null;
};

export type MainSocialPanelNavigation = {
  openPartyPanel(opener?: HTMLElement | null): void;
  openSectDirectoryPanel(opener?: HTMLElement | null): void;
  /** 事後注入宗門目錄 React 面板控制器（保持 bind 呼叫簽名穩定，供互斥導覽 proof 契約）。 */
  setSectDirectoryController(controller: MainSocialPanelSectDirectoryController | null): void;
};

export function bindMainSocialPanelNavigation(
  options: MainSocialPanelNavigationOptions,
): MainSocialPanelNavigation {
  const { socialPanel, partyPanel } = options;
  let sectDirectoryPanel = options.sectDirectoryPanel ?? null;
  const refreshLauncher = () => socialPanel.refreshFeatureLauncherState();
  const openPartyPanel = (opener: HTMLElement | null = null): void => {
    socialPanel.closeFeaturePanels('party');
    partyPanel.open(opener);
    refreshLauncher();
  };
  const openSectDirectoryPanel = (opener: HTMLElement | null = null): void => {
    socialPanel.closeFeaturePanels('sect-directory');
    partyPanel.close(false);
    sectDirectoryPanel?.open(opener);
    refreshLauncher();
  };
  const closeSectDirectoryPanel = (): void => {
    sectDirectoryPanel?.close();
  };
  const setSectDirectoryController = (controller: MainSocialPanelSectDirectoryController | null): void => {
    sectDirectoryPanel = controller;
  };

  socialPanel.setFeaturePanelOpenHandler(() => partyPanel.close(false));
  socialPanel.setPartyPanelOpenStateReader(() => partyPanel.isOpen());
  socialPanel.setPartyOpenHandler(openPartyPanel);
  socialPanel.setSectDirectoryOpenHandler(openSectDirectoryPanel);
  socialPanel.setSectDirectoryCloseHandler(closeSectDirectoryPanel);
  partyPanel.setVisibilityChangeHandler(refreshLauncher);

  return { openPartyPanel, openSectDirectoryPanel, setSectDirectoryController };
}
