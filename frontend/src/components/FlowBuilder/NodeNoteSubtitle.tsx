import React, { memo } from 'react';
import { useReactFlow } from '@xyflow/react';
import { ChevronDown, ChevronRight, StickyNote } from 'lucide-react';
import { useI18n } from '../../i18n';

interface NodeNoteSubtitleProps {
  nodeId: string;
  note?: string;
  collapsed?: boolean;
  className?: string;
}

export const NodeNoteSubtitle: React.FC<NodeNoteSubtitleProps> = memo(({
  nodeId,
  note,
  collapsed = false,
  className = '',
}) => {
  const { setNodes } = useReactFlow();
  const { t, language } = useI18n();
  const isEn = language === 'en';

  const rawNote = typeof note === 'string' ? note : '';
  if (!rawNote.trim()) {
    return null;
  }

  const isCollapsed = !!collapsed;
  const lines = rawNote.split(/\r?\n/);
  const firstLine = lines.find((line) => line.trim().length > 0) || lines[0] || '';
  const extraLineCount = Math.max(0, lines.length - 1);

  const handleToggleCollapse = (evt: React.MouseEvent) => {
    evt.stopPropagation();
    setNodes((prevNodes) =>
      prevNodes.map((n) => {
        if (n.id === nodeId) {
          const currCfg = (n.data as any)?.config || {};
          return {
            ...n,
            data: {
              ...n.data,
              config: {
                ...currCfg,
                note_collapsed: !isCollapsed,
              },
            },
          };
        }
        return n;
      })
    );
  };

  return (
    <div
      className={`mt-1 rounded-md bg-amber-950/25 border border-amber-500/25 px-2 py-1 text-[11px] text-amber-100/90 transition-all ${className}`}
    >
      <div className="flex items-start gap-1.5 min-w-0">
        <button
          type="button"
          onClick={handleToggleCollapse}
          onMouseDown={(e) => e.stopPropagation()}
          className="nodrag nopan mt-0.5 p-0.5 rounded hover:bg-amber-500/20 text-amber-400 hover:text-amber-300 transition-colors shrink-0 flex items-center gap-0.5 cursor-pointer"
          title={isCollapsed ? t('nodes.expandNote') : t('nodes.collapseNote')}
        >
          {isCollapsed ? (
            <ChevronRight className="w-3 h-3 stroke-[2.5]" />
          ) : (
            <ChevronDown className="w-3 h-3 stroke-[2.5]" />
          )}
          <StickyNote className="w-3 h-3 opacity-85" />
        </button>

        {isCollapsed ? (
          <div
            onClick={handleToggleCollapse}
            onMouseDown={(e) => e.stopPropagation()}
            className="nodrag nopan flex-1 min-w-0 flex items-center gap-1 cursor-pointer select-none text-amber-200/75 hover:text-amber-100"
            title={t('nodes.expandNote')}
          >
            <span className="truncate">{firstLine}</span>
            {extraLineCount > 0 && (
              <span className="text-[9px] px-1 py-0.2 rounded bg-amber-900/50 border border-amber-700/50 text-amber-300 font-mono shrink-0">
                {isEn ? `+${extraLineCount}L` : `+${extraLineCount}줄`}
              </span>
            )}
          </div>
        ) : (
          <div className="flex-1 min-w-0 whitespace-pre-wrap break-words leading-relaxed text-amber-100/95">
            {rawNote}
          </div>
        )}
      </div>
    </div>
  );
});

export default NodeNoteSubtitle;
