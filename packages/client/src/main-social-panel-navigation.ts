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
};

export function bindMainSocialPanelNavigation(
  options: MainSocialPanelNavigationOptions,
): MainSocialPanelNavigation {
  const { socialPanel, partyPanel, sectDirectoryPanel } = options;
  const refreshLauncher = () => socialPanel.refreshFeatureLauncherState();
  const openPartyPanel = (opener: HTMLElement | null = null): void => {
    socialPanel.closeFeaturePanels('party');
    partyPanel.open(opener);
    refreshLauncher();
  };
  const openSectDirectoryPanel = (opener: HTMLElement | null = null): void => {
    socialPanel.closeFeaturePanels('sect-directory');
    partyPanel.close(false);
    // TODO: todo 7 — 接入 React sect-directory 面板（屆時由 options.sectDirectoryPanel 提供掛載入口）
    sectDirectoryPanel?.open(opener);
    refreshLauncher();
  };
  const closeSectDirectoryPanel = (): void => {
    sectDirectoryPanel?.close();
  };

  socialPanel.setFeaturePanelOpenHandler(() => {
    partyPanel.close(false);
    closeSectDirectoryPanel();
  });
  socialPanel.setPartyPanelOpenStateReader(() => partyPanel.isOpen());
  socialPanel.setPartyOpenHandler(openPartyPanel);
  socialPanel.setSectDirectoryOpenHandler(openSectDirectoryPanel);
  socialPanel.setSectDirectoryCloseHandler(closeSectDirectoryPanel);
  partyPanel.setVisibilityChangeHandler(refreshLauncher);

  return { openPartyPanel, openSectDirectoryPanel };
}
