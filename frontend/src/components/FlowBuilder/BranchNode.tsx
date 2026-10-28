import React, { memo } from 'react';
import { Handle, Position, NodeProps, useReactFlow } from '@xyflow/react';
import {
  GitFork,
  X,
  CheckCircle2,
  XCircle,
  Variable,
  Crosshair,
  Globe,
} from 'lucide-react';
import { FlowNodeData } from '../../types';
import { useI18n } from '../../i18n';
import NodeNoteSubtitle from './NodeNoteSubtitle';

const OPERATOR_SYMBOL_MAP: Record<string, string> = {
  equals: '==',
  '==': '==',
  not_equals: '!=',
  '!=': '!=',
  contains: '포함(contains)',
  not_contains: '미포함(!contains)',
  starts_with: '시작문자(starts)',
  ends_with: '끝문자(ends)',
  greater_than: '>',
  '>': '>',
  greater_or_equal: '>=',
  '>=': '>=',
  less_than: '<',
  '<': '<',
  less_or_equal: '<=',
  '<=': '<=',
  is_empty: '비어있음(empty)',
  is_not_empty: '값있음(!empty)',
  is_true: '참(True)임',
  is_false: '거짓(False)임',
  regex: '정규식(regex)',
};

const BranchNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const { deleteElements } = useReactFlow();
  const { t, language } = useI18n();
  const isEn = language === 'en';
  const nodeData = (data || {}) as unknown as FlowNodeData;
  const cfg = nodeData.config || {};

  const mode = String(cfg.condition_mode || 'variable').trim().toLowerCase();
  const operator = String(cfg.operator || 'equals').trim().toLowerCase();
  const unaryOps = new Set(['is_empty', 'is_not_empty', 'is_true', 'is_false']);

  const handleDelete = (evt: React.MouseEvent) => {
    evt.stopPropagation();
    if (typeof (data as any)?.onDelete === 'function') {
      (data as any).onDelete(id);
    } else {
      deleteElements({ nodes: [{ id }] });
    }
  };

  const renderConditionSummary = () => {
    if (mode === 'ui_element_exists') {
      const objName =
        cfg.object_data?.name ||
        cfg.object_data?.window_title ||
        (isEn ? 'Target UI Object not set' : '대상 UI 오브젝트 미지정');
      return (
        <div className="flex items-center gap-1.5 text-amber-200 truncate">
          <Crosshair className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="truncate">🎯 {objName}</span>
        </div>
      );
    }
    if (mode === 'web_element_exists') {
      const selName =
        cfg.web_element_data?.display_name ||
        cfg.selector ||
        (isEn ? 'Web Selector not set' : '웹 요소 선택자 미지정');
      return (
        <div className="flex items-center gap-1.5 text-cyan-200 truncate">
          <Globe className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <span className="truncate">🌐 {selName}</span>
        </div>
      );
    }

    const leftStr = String(cfg.left_value || '').trim() || (isEn ? '(Left empty)' : '(좌변 미입력)');
    const rightStr = String(cfg.right_value ?? '').trim();
    const opLabel = OPERATOR_SYMBOL_MAP[operator] || operator;
    return (
      <div className="flex items-center gap-1 text-amber-100 font-mono text-[10px] truncate">
        <Variable className="w-3 h-3 text-amber-400 shrink-0" />
        <span className="truncate">
          {unaryOps.has(operator)
            ? `${leftStr} [${opLabel}]`
            : `${leftStr} ${opLabel} ${rightStr || '""'}`}
        </span>
      </div>
    );
  };

  const getModeLabel = () => {
    if (mode === 'ui_element_exists') return isEn ? 'PC UI Element Exists' : 'PC 화면 UI 존재 여부';
    if (mode === 'web_element_exists') return isEn ? 'Web Element Exists' : '웹 브라우저 요소 존재';
    return isEn ? 'Variable / Value Compare' : '변수 / 값 조건 비교';
  };

  return (
    <div
      className={`relative min-w-[235px] max-w-[300px] rounded-xl bg-slate-900 border transition-all shadow-md pl-3 pr-2.5 py-2.5 ${
        selected
          ? 'border-amber-400 shadow-amber-500/20 ring-1 ring-amber-400'
          : 'border-amber-700/70 hover:border-amber-500/80'
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
        className="!w-3.5 !h-3.5 !bg-amber-500 !border-2 !border-slate-900 !z-20 transition-all hover:scale-125 hover:!bg-amber-400 cursor-crosshair"
      />

      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <div className="p-1.5 rounded-lg bg-amber-950/80 border border-amber-700/60 shrink-0">
            <GitFork className="w-4 h-4 text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-slate-100 truncate">{nodeData.label}</div>
            <div className="text-[10px] text-amber-400 uppercase tracking-wider font-semibold">
              {getModeLabel()}
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

        {/* 조건 요약 박스 */}
        <div className="text-[11px] bg-slate-950/80 rounded-lg px-2 py-1.5 border border-slate-800/90">
          {renderConditionSummary()}
        </div>

        {/* 하단 좌/우 분기 출력 포트 라벨 영역 (True / False) */}
        <div className="grid grid-cols-2 gap-2 pt-2 mt-2 border-t border-slate-800/80">
          <div className="flex items-center justify-center gap-1 px-1.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-700/60 text-emerald-300 text-[10px] font-bold">
            <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
            <span>{isEn ? 'True' : '참(True)'}</span>
          </div>
          <div className="flex items-center justify-center gap-1 px-1.5 py-0.5 rounded bg-rose-950/80 border border-rose-700/60 text-rose-300 text-[10px] font-bold">
            <XCircle className="w-2.5 h-2.5 text-rose-400 shrink-0" />
            <span>{isEn ? 'False' : '거짓(False)'}</span>
          </div>
        </div>
      </div>

      {/* 하단 좌측 출력 핸들: True (참) */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="true"
        style={{ left: '28%' }}
        title={isEn ? 'True branch output' : '조건이 참(True)일 때 실행할 경로'}
        className="!w-3.5 !h-3.5 !bg-emerald-500 !border-2 !border-slate-900 !z-20 transition-all hover:scale-125 hover:!bg-emerald-400 cursor-crosshair"
      />

      {/* 하단 우측 출력 핸들: False (거짓) */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="false"
        style={{ left: '72%' }}
        title={isEn ? 'False branch output' : '조건이 거짓(False)일 때 실행할 경로'}
        className="!w-3.5 !h-3.5 !bg-rose-500 !border-2 !border-slate-900 !z-20 transition-all hover:scale-125 hover:!bg-rose-400 cursor-crosshair"
      />
    </div>
  );
};

export default memo(BranchNode);
