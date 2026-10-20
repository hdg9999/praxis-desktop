import React, { memo } from 'react';
import { Handle, Position, NodeProps, useReactFlow } from '@xyflow/react';
import {
  GitBranchPlus,
  X,
  ArrowRight,
  ArrowLeft,
  ArrowLeftRight,
  Workflow,
  AlertCircle,
} from 'lucide-react';
import { FlowNodeData, SubflowVariableMapping } from '../../types';
import { useI18n } from '../../i18n';

const SubflowNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const { deleteElements } = useReactFlow();
  const { t, language } = useI18n();
  const isEn = language === 'en';
  const nodeData = data as unknown as FlowNodeData;
  const cfg = nodeData.config || {};

  const targetFlowId = (cfg.target_flow_id || '').trim();
  const targetFlowName = (cfg.target_flow_name || '').trim();
  const mappings: SubflowVariableMapping[] = Array.isArray(cfg.variable_mappings)
    ? cfg.variable_mappings.filter((m: any) => m?.parent_var || m?.sub_var)
    : [];

  const inCount = mappings.filter((m) => m.direction === 'in' || m.direction === 'inout').length;
  const outCount = mappings.filter((m) => m.direction === 'out' || m.direction === 'inout').length;

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
      className={`relative min-w-[215px] max-w-[280px] rounded-xl bg-slate-900 border transition-all shadow-md px-3 py-2.5 ${
        selected
          ? 'border-cyan-400 shadow-cyan-500/20 ring-1 ring-cyan-400'
          : 'border-cyan-800/70 hover:border-cyan-600/80'
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
        className="!w-3.5 !h-3.5 !bg-cyan-500 !border-2 !border-slate-900 !z-20 transition-all hover:scale-125 hover:!bg-cyan-400 cursor-crosshair"
      />

      <div className="flex items-center gap-2 mb-1.5">
        <div className="p-1.5 rounded-lg bg-cyan-950/80 border border-cyan-700/60">
          <GitBranchPlus className="w-4 h-4 text-cyan-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-slate-100 truncate">{nodeData.label}</div>
          <div className="text-[10px] text-cyan-400 uppercase tracking-wider font-semibold">
            SUB-WORKFLOW CALL
          </div>
        </div>
      </div>

      {/* 호출 대상 워크플로우 배지 */}
      <div className="text-[11px] bg-slate-950/80 rounded-lg px-2.5 py-1.5 border border-slate-800/90 space-y-1">
        {targetFlowId ? (
          <div className="flex items-center gap-1.5 text-cyan-200 font-medium truncate">
            <Workflow className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="truncate">{targetFlowName || targetFlowId}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 text-amber-400 text-[10px]">
            <AlertCircle className="w-3 h-3 shrink-0" />
            <span>{isEn ? 'Select a workflow to call' : '호출할 워크플로우를 선택하세요'}</span>
          </div>
        )}

        {/* 변수 매핑 요약 배지 */}
        {mappings.length > 0 && (
          <div className="flex items-center gap-1.5 pt-1 border-t border-slate-800/80 text-[10px]">
            {inCount > 0 && (
              <span className="flex items-center gap-0.5 px-1.5 py-0.2 rounded bg-blue-950/70 border border-blue-800/60 text-blue-300 font-mono">
                <ArrowRight className="w-2.5 h-2.5" />
                In:{inCount}
              </span>
            )}
            {outCount > 0 && (
              <span className="flex items-center gap-0.5 px-1.5 py-0.2 rounded bg-emerald-950/70 border border-emerald-800/60 text-emerald-300 font-mono">
                <ArrowLeft className="w-2.5 h-2.5" />
                Out:{outCount}
              </span>
            )}
            {mappings.some((m) => m.direction === 'inout') && (
              <ArrowLeftRight className="w-3 h-3 text-purple-400 ml-auto shrink-0" />
            )}
          </div>
        )}
      </div>

      {/* Right Output Handle (source) */}
      <Handle
        type="source"
        position={Position.Right}
        id="source"
        className="!w-3.5 !h-3.5 !bg-cyan-500 !border-2 !border-slate-900 !z-20 transition-all hover:scale-125 hover:!bg-cyan-400 cursor-crosshair"
      />
    </div>
  );
};

export default memo(SubflowNode);
