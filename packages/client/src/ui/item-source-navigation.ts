/** 百科只提出導航意圖，實際移動沿用主線導航與伺服器裁定。 */
import type { ItemSourceEntry } from '../content/item-sources';
import { resolveItemSourceNavigation } from '../content/item-source-navigation';

type Destination = ReturnType<typeof resolveItemSourceNavigation>;
type NavigableDestination = Exclude<Destination, { kind: 'unavailable' }>;
type NavigationHandler = (target: NavigableDestination) => string | null;
let navigationHandler: NavigationHandler | null = null;

export function createItemSourceNavigationHandler(deps: {
  isReady: () => boolean;
  planPathTo: (target: { mapId: string; x: number; y: number }, options: { ignoreVisibilityLimit: boolean; allowNearestReachable: boolean }) => void;
  navigateToQuest: (questId: string) => void;
}): NavigationHandler {
  return (target) => {
    if (!deps.isReady()) return '尚未連上遊戲，請連線後再試。';
    if (target.kind === 'quest') deps.navigateToQuest(target.questId);
    else deps.planPathTo(target, { ignoreVisibilityLimit: true, allowNearestReachable: true });
    return null;
  };
}

export function setItemSourceNavigationHandler(handler: NavigationHandler): void {
  navigationHandler = handler;
}

/** null 代表已提出意圖，不代表伺服器保證可抵達。 */
export function navigateToItemSource(entry: ItemSourceEntry): string | null {
  const target = resolveItemSourceNavigation(entry);
  if (target.kind === 'unavailable') return target.reason;
  if (!navigationHandler) return '遊戲尚未就緒，請稍後再試。';
  return navigationHandler(target);
}
