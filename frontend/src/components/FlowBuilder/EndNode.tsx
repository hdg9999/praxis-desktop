import React, { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { Flag } from 'lucide-react';
import { FlowNodeData } from '../../types';
import { useI18n } from '../../i18n';
import NodeNoteSubtitle from './NodeNoteSubtitle';

const EndNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const { t } = useI18n();
  const nodeData = data as unknown as FlowNodeData;
  const cfg = nodeData.config || {};

  const displayLabel = !nodeData.label || nodeData.label === '끝' || nodeData.label === 'End'
    ? t('nodes.end')
    : nodeData.label;

  return (
    <div
      className={`relative min-w-[140px] max-w-[260px] rounded-xl bg-slate-900 border transition-all shadow-md px-3.5 py-2.5 select-none ${
        selected
          ? 'border-rose-500 shadow-rose-500/25 ring-1 ring-rose-500'
          : 'border-rose-700/60 hover:border-rose-500/70 bg-gradient-to-r from-slate-900 to-rose-950/40'
      }`}
    >
      {/* 좌측 Input Handle만 존재 (이전 노드에서 들어오는 것만 가능) */}
      <Handle
        type="target"
        position={Position.Left}
        id="target"
        className="!w-3.5 !h-3.5 !bg-rose-500 !border-2 !border-slate-900 !z-20 transition-all hover:scale-125 hover:!bg-rose-400 cursor-crosshair"
      />

      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-rose-600/20 border border-rose-500/40 flex items-center justify-center text-rose-400 shadow-inner shrink-0">
          <Flag className="w-3.5 h-3.5" />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-bold text-rose-300 tracking-tight truncate">
            {displayLabel}
          </div>
          <div className="text-[10px] text-rose-400/80 font-mono tracking-wider font-semibold">
            END
          </div>
        </div>
      </div>

      {/* 노드 이름(제목) 바로 아래 서브타이틀 주석 영역 */}
      <NodeNoteSubtitle
        nodeId={id}
        note={cfg.note}
        collapsed={cfg.note_collapsed}
      />
    </div>
  );
};

export default memo(EndNode);
