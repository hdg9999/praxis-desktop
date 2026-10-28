import React, { memo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
  useReactFlow,
} from '@xyflow/react';
import { X } from 'lucide-react';

import { useI18n } from '../../i18n';

const HANDLE_BADGE_MAP: Record<
  string,
  { label: string; stroke: string; badgeClass: string }
> = {
  true: {
    label: 'True',
    stroke: '#10b981',
    badgeClass: 'bg-emerald-950/90 text-emerald-300 border-emerald-600/80',
  },
  false: {
    label: 'False',
    stroke: '#f43f5e',
    badgeClass: 'bg-rose-950/90 text-rose-300 border-rose-600/80',
  },
  loop: {
    label: 'Loop',
    stroke: '#06b6d4',
    badgeClass: 'bg-cyan-950/90 text-cyan-300 border-cyan-600/80',
  },
  exit: {
    label: 'Exit',
    stroke: '#8b5cf6',
    badgeClass: 'bg-violet-950/90 text-violet-300 border-violet-600/80',
  },
};

const DeletableEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  sourceHandleId,
  style = {},
  markerEnd,
  selected,
  data,
}) => {
  const { deleteElements } = useReactFlow();
  const { t } = useI18n();

  const handleKey = String(sourceHandleId || (data as any)?.sourceHandle || '').toLowerCase();
  const handleMeta = HANDLE_BADGE_MAP[handleKey];

  // 상->하(Top-to-Bottom) 레이아웃에서 아래쪽 노드(sourceY)가 위쪽 노드(targetY)로
  // 역방향 루프백(Back-edge) 연결될 때 노드 본체를 가로지르지 않도록 측면 우회 경로 생성
  const isBackwardVerticalEdge =
    targetY <= sourceY + 10 && Math.abs(targetX - sourceX) < 250;

  let edgePath = '';
  let labelX = 0;
  let labelY = 0;

  if (isBackwardVerticalEdge) {
    const offsetY = 24;
    const bottomY = Math.max(sourceY, targetY) + offsetY;
    const topY = Math.min(sourceY, targetY) - offsetY;
    const goLeft =
      handleKey === 'false' || handleKey === 'exit'
        ? false
        : handleKey === 'true' || handleKey === 'loop'
        ? true
        : sourceX <= targetX + 10;
    const sideX = goLeft
      ? Math.min(sourceX, targetX) - 170
      : Math.max(sourceX, targetX) + 170;
    const r = 12;
    const dirX = goLeft ? -1 : 1;

    edgePath = [
      `M ${sourceX} ${sourceY}`,
      `L ${sourceX} ${bottomY - r}`,
      `Q ${sourceX} ${bottomY} ${sourceX + dirX * r} ${bottomY}`,
      `L ${sideX - dirX * r} ${bottomY}`,
      `Q ${sideX} ${bottomY} ${sideX} ${bottomY - r}`,
      `L ${sideX} ${topY + r}`,
      `Q ${sideX} ${topY} ${sideX - dirX * r} ${topY}`,
      `L ${targetX + dirX * r} ${topY}`,
      `Q ${targetX} ${topY} ${targetX} ${topY + r}`,
      `L ${targetX} ${targetY}`,
    ].join(' ');
    labelX = sideX;
    labelY = (bottomY + topY) / 2;
  } else {
    [edgePath, labelX, labelY] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });
  }

  const handleDelete = (evt: React.MouseEvent) => {
    evt.stopPropagation();
    if (typeof (data as any)?.onDelete === 'function') {
      (data as any).onDelete(id);
    } else {
      deleteElements({ edges: [{ id }] });
    }
  };

  const baseStyle = handleMeta
    ? {
        ...style,
        stroke: handleMeta.stroke,
        strokeWidth: style.strokeWidth || 2,
      }
    : style;

  // 선택되었을 때 강조 스타일
  const edgeStyle = selected
    ? {
        ...baseStyle,
        stroke: '#38bdf8',
        strokeWidth: 2.5,
        filter: 'drop-shadow(0 0 4px rgba(56, 189, 248, 0.6))',
      }
    : baseStyle;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={edgeStyle}
        interactionWidth={20}
      />
      {(handleMeta || selected) && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan z-40 flex items-center gap-1"
          >
            {handleMeta && (
              <span
                className={`px-1.5 py-0.2 rounded text-[9px] font-bold font-mono border shadow-sm select-none ${handleMeta.badgeClass}`}
              >
                {handleMeta.label}
              </span>
            )}
            {selected && (
              <button
                onClick={handleDelete}
                className="w-5 h-5 rounded-full bg-rose-500 hover:bg-rose-600 active:scale-95 text-white flex items-center justify-center shadow-lg border border-slate-900 transition-all hover:scale-110 cursor-pointer animate-in fade-in zoom-in-75 duration-150"
                title={t('nodes.deleteEdge')}
                type="button"
              >
                <X className="w-3 h-3 stroke-[2.5]" />
              </button>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};

export default memo(DeletableEdge);
