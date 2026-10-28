import React, { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { Play } from 'lucide-react';
import { FlowNodeData } from '../../types';
import { useI18n } from '../../i18n';
import NodeNoteSubtitle from './NodeNoteSubtitle';

const StartNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const { t } = useI18n();
  const nodeData = data as unknown as FlowNodeData;
  const cfg = nodeData.config || {};

  const displayLabel = !nodeData.label || nodeData.label === '시작' || nodeData.label === 'Start'
    ? t('nodes.start')
    : nodeData.label;

  return (
    <div
      className={`relative min-w-[140px] max-w-[260px] rounded-xl bg-slate-900 border transition-all shadow-md px-3.5 py-2.5 select-none ${
        selected
          ? 'border-emerald-500 shadow-emerald-500/25 ring-1 ring-emerald-500'
          : 'border-emerald-700/60 hover:border-emerald-500/70 bg-gradient-to-r from-emerald-950/40 to-slate-900'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-emerald-600/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shadow-inner shrink-0">
          <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-bold text-emerald-300 tracking-tight truncate">
            {displayLabel}
          </div>
          <div className="text-[10px] text-emerald-400/80 font-mono tracking-wider font-semibold">
            START
          </div>
        </div>
      </div>

      {/* 노드 이름(제목) 바로 아래 서브타이틀 주석 영역 */}
      <NodeNoteSubtitle
        nodeId={id}
        note={cfg.note}
        collapsed={cfg.note_collapsed}
      />

      {/* 하단 Output Handle만 존재 (다음 노드로만 연결 가능) */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="source"
        className="!w-3.5 !h-3.5 !bg-emerald-500 !border-2 !border-slate-900 !z-20 transition-all hover:scale-125 hover:!bg-emerald-400 cursor-crosshair"
      />
    </div>
  );
};

export default memo(StartNode);
