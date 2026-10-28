import React, { memo } from 'react';
import { Handle, Position, NodeProps, useReactFlow } from '@xyflow/react';
import {
  Repeat,
  Infinity as InfinityIcon,
  X,
  RotateCw,
  CornerDownRight,
} from 'lucide-react';
import { FlowNodeData } from '../../types';
import { useI18n } from '../../i18n';
import NodeNoteSubtitle from './NodeNoteSubtitle';

const LoopNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const { deleteElements } = useReactFlow();
  const { t, language } = useI18n();
  const isEn = language === 'en';
  const nodeData = (data || {}) as unknown as FlowNodeData;
  const cfg = nodeData.config || {};

  const loopMode = String(cfg.loop_mode || 'count').trim().toLowerCase();
  const loopCount = cfg.loop_count ?? 3;
  const outVar = String(cfg.output_variable || '').trim();

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
      className={`relative min-w-[235px] max-w-[300px] rounded-xl bg-slate-900 border transition-all shadow-md pl-3 pr-2.5 py-2.5 ${
        selected
          ? 'border-violet-400 shadow-violet-500/20 ring-1 ring-violet-400'
          : 'border-violet-700/70 hover:border-violet-500/80'
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

      {/* Top Input Handle (target) */}
      <Handle
        type="target"
        position={Position.Top}
        id="target"
        className="!w-3.5 !h-3.5 !bg-violet-500 !border-2 !border-slate-900 !z-20 transition-all hover:scale-125 hover:!bg-violet-400 cursor-crosshair"
      />

      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <div className="p-1.5 rounded-lg bg-violet-950/80 border border-violet-700/60 shrink-0">
            {loopMode === 'infinite' ? (
              <InfinityIcon className="w-4 h-4 text-cyan-400" />
            ) : (
              <Repeat className="w-4 h-4 text-violet-400" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-slate-100 truncate">{nodeData.label}</div>
            <div className="text-[10px] text-violet-400 uppercase tracking-wider font-semibold">
              {loopMode === 'infinite'
                ? isEn
                  ? 'INFINITE LOOP (24H)'
                  : '무한 반복 (모니터링)'
                : isEn
                ? 'COUNT LOOP'
                : '지정 횟수 반복'}
            </div>
          </div>
        </div>

        {/* 노드 주석 서브타이틀 */}
        <NodeNoteSubtitle
          nodeId={id}
          note={cfg.note}
          collapsed={cfg.note_collapsed}
          className="mb-1.5"
        />

        {/* 반복 조건 요약 박스 */}
        <div className="text-[11px] bg-slate-950/80 rounded-lg px-2 py-1.5 border border-slate-800/90 space-y-0.5">
          {loopMode === 'infinite' ? (
            <div className="text-cyan-300 font-medium truncate">
              {isEn ? '♾️ Infinite Loop (Until Stop)' : '♾️ 중단 전까지 무한 반복'}
            </div>
          ) : (
            <div className="text-violet-200 font-medium truncate">
              {isEn ? `🔁 Repeat ${loopCount} time(s)` : `🔁 총 ${loopCount}회 반복 실행`}
            </div>
          )}
          <div className="text-[10px] text-slate-400 font-mono truncate">
            {outVar ? `idx ➔ {{${outVar}}} / {{loop_index}}` : `idx ➔ {{loop_index}}`}
          </div>
        </div>

        {/* 하단 좌/우 분기 출력 포트 라벨 영역 (반복 Loop / 종료 Exit) */}
        <div className="grid grid-cols-2 gap-2 pt-2 mt-2 border-t border-slate-800/80">
          <div className="flex items-center justify-center gap-1 px-1.5 py-0.5 rounded bg-cyan-950/80 border border-cyan-700/60 text-cyan-300 text-[10px] font-bold">
            <RotateCw className="w-2.5 h-2.5 text-cyan-400 shrink-0" />
            <span>{isEn ? 'Loop' : '반복(Loop)'}</span>
          </div>
          <div className="flex items-center justify-center gap-1 px-1.5 py-0.5 rounded bg-violet-950/80 border border-violet-700/60 text-violet-300 text-[10px] font-bold">
            <CornerDownRight className="w-2.5 h-2.5 text-violet-400 shrink-0" />
            <span>{isEn ? 'Exit' : '종료(Exit)'}</span>
          </div>
        </div>
      </div>

      {/* 하단 좌측 출력 핸들: Loop (반복 본문 진입) */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="loop"
        style={{ left: '28%' }}
        title={isEn ? 'Loop body path' : '반복할 작업 노드들로 연결 (완료 후 다시 이 노드의 상단 입력으로 연결)'}
        className="!w-3.5 !h-3.5 !bg-cyan-500 !border-2 !border-slate-900 !z-20 transition-all hover:scale-125 hover:!bg-cyan-400 cursor-crosshair"
      />

      {/* 하단 우측 출력 핸들: Exit (반복 종료 후 다음 단계) */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="exit"
        style={{ left: '72%' }}
        title={isEn ? 'Loop exit path' : '지정된 반복 횟수가 모두 끝난 뒤 이동할 다음 노드 경로'}
        className="!w-3.5 !h-3.5 !bg-violet-500 !border-2 !border-slate-900 !z-20 transition-all hover:scale-125 hover:!bg-violet-400 cursor-crosshair"
      />
    </div>
  );
};

export default memo(LoopNode);
