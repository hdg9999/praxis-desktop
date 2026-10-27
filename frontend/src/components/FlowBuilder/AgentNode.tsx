import React, { memo } from 'react';
import { Handle, Position, NodeProps, useReactFlow } from '@xyflow/react';
import { Bot, Wrench, Camera, Variable, X, Layers } from 'lucide-react';
import { FlowNodeData } from '../../types';
import { useI18n } from '../../i18n';
import NodeNoteSubtitle from './NodeNoteSubtitle';

const AgentNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const { deleteElements } = useReactFlow();
  const { t } = useI18n();
  const nodeData = data as unknown as FlowNodeData;
  const cfg = nodeData.config || {};
  const model = cfg.model || 'llama3.1';
  const prompt = cfg.prompt || '';
  const outVar = cfg.output_variable || 'agent_result';
  const includeScreen = !!cfg.include_screen_capture;
  const skillMode = cfg.skill_mode || 'preset';
  const presetName = cfg.preset_name || 'basic_interaction';
  const customSkillsCount = Array.isArray(cfg.custom_skills) ? cfg.custom_skills.length : 0;

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
      className={`relative min-w-[230px] max-w-[310px] rounded-xl bg-slate-900 border transition-all shadow-md px-3.5 py-3 ${
        selected
          ? 'border-indigo-500 shadow-indigo-500/25 ring-1 ring-indigo-500'
          : 'border-indigo-900/50 hover:border-indigo-700/70'
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
        className="!w-3.5 !h-3.5 !bg-indigo-500 !border-2 !border-slate-900 !z-20 transition-all hover:scale-125 hover:!bg-indigo-400 cursor-crosshair"
      />

      {/* 헤더 */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 rounded-lg bg-indigo-950/80 border border-indigo-800/60 text-indigo-400 shrink-0">
            <Bot className="w-4 h-4" />
          </div>
          <div className="text-xs font-semibold text-slate-100 truncate">{nodeData.label}</div>
        </div>
        <div className="flex items-center gap-1 text-[10px] bg-indigo-900/40 border border-indigo-700/50 text-indigo-300 px-2 py-0.5 rounded-full font-mono shrink-0">
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

      {/* 지시 프롬프트 요약 */}
      <div className="text-[11px] text-slate-300 bg-slate-950/80 rounded px-2.5 py-1.5 border border-slate-800/80 mb-2 line-clamp-2 italic">
        {prompt ? `"${prompt}"` : `(${t('common.none')})`}
      </div>

      {/* 스킬 및 옵션 배지 목록 */}
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        <span className="inline-flex items-center gap-1 text-[10px] bg-slate-800/90 text-indigo-300 border border-slate-700/70 px-1.5 py-0.5 rounded">
          <Wrench className="w-2.5 h-2.5 text-indigo-400" />
          {skillMode === 'preset'
            ? presetName === 'basic_interaction'
              ? `${t('inspector.agentBasic.skillPresetAll')}`
              : `${t('inspector.agentBasic.skillPresetAll')}`
            : `${t('inspector.agentBasic.skillPresetCustom')} (${customSkillsCount})`}
        </span>
        {includeScreen && (
          <span className="inline-flex items-center gap-1 text-[10px] bg-teal-950/60 text-teal-300 border border-teal-800/60 px-1.5 py-0.5 rounded">
            <Camera className="w-2.5 h-2.5 text-teal-400" />
            Vision
          </span>
        )}
        <span className="inline-flex items-center gap-1 text-[10px] bg-cyan-950/50 text-cyan-300 border border-cyan-800/60 px-1.5 py-0.5 rounded font-mono">
          <Layers className="w-2.5 h-2.5 text-cyan-400" />
          {cfg.num_ctx ? (cfg.num_ctx >= 1024 ? `${Math.round(cfg.num_ctx / 1024)}k ctx` : `${cfg.num_ctx} ctx`) : '8k ctx'}
        </span>
      </div>

      {/* 출력 변수 */}
      <div className="flex items-center justify-between text-[10px] text-slate-400 px-0.5">
        <span className="flex items-center gap-1">
          <Variable className="w-3 h-3 text-indigo-400" />
          {t('inspector.aiOllama.outputVarLabel')}:
        </span>
        <span className="font-mono text-indigo-300 font-semibold">{`{{${outVar}}}`}</span>
      </div>

      {(cfg.retry_enabled || cfg.continue_on_error) && (
        <div className="flex flex-wrap items-center gap-1 mt-1.5 pt-1.5 border-t border-slate-800/80">
          {cfg.retry_enabled && (
            <span className="px-1.5 py-0.2 rounded bg-amber-950/70 border border-amber-700/60 text-amber-300 text-[9px] font-mono">
              🔄 재시도 {cfg.retry_count ?? 3}회({cfg.retry_interval ?? 2}s)
            </span>
          )}
          {cfg.continue_on_error && (
            <span className="px-1.5 py-0.2 rounded bg-teal-950/70 border border-teal-700/60 text-teal-300 text-[9px] font-medium">
              ⏭️ 오류무시 진행
            </span>
          )}
        </div>
      )}

      {/* Right Output Handle (source) */}
      <Handle
        type="source"
        position={Position.Right}
        id="source"
        className="!w-3.5 !h-3.5 !bg-indigo-500 !border-2 !border-slate-900 !z-20 transition-all hover:scale-125 hover:!bg-indigo-400 cursor-crosshair"
      />
    </div>
  );
};

export default memo(AgentNode);
