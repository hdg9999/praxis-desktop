import React, { memo } from 'react';
import { Handle, Position, NodeProps, useReactFlow } from '@xyflow/react';
import { Sparkles, Bot, Variable, X } from 'lucide-react';
import { FlowNodeData } from '../../types';
import { useI18n } from '../../i18n';
import NodeNoteSubtitle from './NodeNoteSubtitle';

const AINode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const { deleteElements } = useReactFlow();
  const { t } = useI18n();
  const nodeData = data as unknown as FlowNodeData;
  const cfg = nodeData.config || {};
  const model = cfg.model || 'llama3';
  const prompt = cfg.prompt || '';
  const outVar = cfg.output_variable || 'ai_output';

  const handleDelete = (evt: React.MouseEvent) => {
    evt.stopPropagation();
    if (typeof (data as any)?.onDelete === 'function') {
      (data as any).onDelete(id);
    } else {
      deleteElements({ nodes: [{ id }] });
    }
  };

  return (
    <div
      className={`relative min-w-[220px] max-w-[300px] rounded-xl bg-slate-900 border transition-all shadow-md px-3.5 py-3 ${
        selected ? 'border-purple-500 shadow-purple-500/25 ring-1 ring-purple-500' : 'border-purple-900/40 hover:border-purple-700/60'
      }`}
    >
      {/* 노드 선택 시 우상단 동그란 ✕ 삭제 버튼 */}
      {selected && (
        <button
          onClick={handleDelete}
          className="absolute -top-2.5 -right-2.5 w-5 h-5 rounded-full bg-rose-500 hover:bg-rose-600 active:scale-95 text-white flex items-center justify-center shadow-lg border border-slate-900 transition-all hover:scale-110 cursor-pointer z-30"
          title={t('nodes.deleteNode')}
          type="button"
        >
          <X className="w-3 h-3 stroke-[2.5]" />
        </button>
      )}

      {/* Left Input Handle (target) */}
      <Handle
        type="target"
        position={Position.Left}
        id="target"
        className="!w-3.5 !h-3.5 !bg-purple-500 !border-2 !border-slate-900 !z-20 transition-all hover:scale-125 hover:!bg-purple-400 cursor-crosshair"
      />

      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 rounded-lg bg-purple-950/80 border border-purple-800/60 text-purple-400 shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="text-xs font-semibold text-slate-100 truncate">{nodeData.label}</div>
        </div>
        <div className="flex items-center gap-1 text-[10px] bg-purple-900/40 border border-purple-700/50 text-purple-300 px-2 py-0.5 rounded-full font-mono shrink-0">
          <Bot className="w-3 h-3" />
          {model}
        </div>
      </div>

      {/* 노드 이름(제목) 바로 아래 서브타이틀 주석 영역 */}
      <NodeNoteSubtitle
        nodeId={id}
        note={cfg.note}
        collapsed={cfg.note_collapsed}
        className="mb-2"
      />

      <div className="text-[11px] text-slate-300 bg-slate-950/80 rounded px-2.5 py-1.5 border border-slate-800/80 mb-1.5 line-clamp-2 italic">
        {prompt ? `"${prompt}"` : `(${t('common.none')})`}
      </div>

      <div className="flex items-center justify-between text-[10px] text-slate-400 px-0.5">
        <span className="flex items-center gap-1">
          <Variable className="w-3 h-3 text-purple-400" />
          {t('inspector.aiOllama.outputVarLabel')}:
        </span>
        <span className="font-mono text-purple-300 font-semibold">{`{{${outVar}}}`}</span>
      </div>

      {/* Right Output Handle (source) */}
      <Handle
        type="source"
        position={Position.Right}
        id="source"
        className="!w-3.5 !h-3.5 !bg-purple-500 !border-2 !border-slate-900 !z-20 transition-all hover:scale-125 hover:!bg-purple-400 cursor-crosshair"
      />
    </div>
  );
};

export default memo(AINode);
