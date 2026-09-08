/**
 * 聊天列旁的行動捷徑；只投影既有 ActionPanel 動作，不建立第二套意圖。
 */
import { memo, useEffect, useRef, useState } from 'react';
import { prefersPinnedTooltipInteraction } from '../../../ui/floating-tooltip';
import { useFloatingTooltip } from '../../hooks/use-floating-tooltip';

export interface QuickActionView {
  id: string;
  name: string;
  desc: string;
  cooldownLeft: number;
  requiresTarget?: boolean;
  targetMode?: string;
  range?: number;
}

export interface QuickActionsProps {
  actions: readonly QuickActionView[];
  onExecute: (actionId: string) => void;
}

export const QuickActions = memo(function QuickActions({ actions, onExecute }: QuickActionsProps) {
  const [expanded, setExpanded] = useState(false);
  const { show, hide, hideImmediate } = useFloatingTooltip();
  const activeTooltipActionId = useRef<string | null>(null);

  useEffect(() => {
    const activeId = activeTooltipActionId.current;
    if (activeId && !actions.some((action) => action.id === activeId)) {
      activeTooltipActionId.current = null;
      hideImmediate();
    }
  }, [actions, hideImmediate]);

  const showDescription = (action: QuickActionView, clientX: number, clientY: number) => {
    if (prefersPinnedTooltipInteraction()) {
      return;
    }
    activeTooltipActionId.current = action.id;
    show({ title: action.name, lines: [action.desc] }, { clientX, clientY } as MouseEvent);
  };

  const hideDescription = () => {
    activeTooltipActionId.current = null;
    hide();
  };

  if (actions.length === 0) {
    return null;
  }

  return (
    <div className="chat-quick-actions" data-chat-quick-actions="true" data-expanded={expanded}>
      <button
        className="chat-action-toggle"
        type="button"
        aria-expanded={expanded}
        aria-controls="chat-quick-action-buttons"
        onClick={() => setExpanded((current) => !current)}
      >
        行動 <span aria-hidden="true">▾</span>
      </button>
      <div className="chat-action-buttons" id="chat-quick-action-buttons">
        {actions.map((action) => {
          const onCooldown = action.cooldownLeft > 0;
          return (
            <button
              key={action.id}
              data-quick-action-id={action.id}
              className={`chat-quick-action${onCooldown ? ' is-cooldown' : ''}`}
              type="button"
              disabled={onCooldown}
              aria-disabled={onCooldown || undefined}
              onClick={() => onExecute(action.id)}
              onMouseEnter={(event) => showDescription(action, event.clientX, event.clientY)}
              onMouseMove={(event) => showDescription(action, event.clientX, event.clientY)}
              onMouseLeave={hideDescription}
              onFocus={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                showDescription(action, rect.left + rect.width / 2, rect.bottom);
              }}
              onBlur={hideDescription}
            >
              {action.name}
            </button>
          );
        })}
      </div>
      <details className="chat-action-help">
        <summary>行動說明</summary>
        <dl>
          {actions.map((action) => (
            <div key={action.id}>
              <dt>{action.name}</dt>
              <dd>{action.desc}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
});
