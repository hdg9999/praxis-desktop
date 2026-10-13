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

const DeletableEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  selected,
  data,
}) => {
  const { deleteElements } = useReactFlow();
  const { t } = useI18n();

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const handleDelete = (evt: React.MouseEvent) => {
    evt.stopPropagation();
    if (typeof (data as any)?.onDelete === 'function') {
      (data as any).onDelete(id);
    } else {
      deleteElements({ edges: [{ id }] });
    }
  };

  // 선택되었을 때 강조 스타일
  const edgeStyle = selected
    ? {
        ...style,
        stroke: '#38bdf8',
        strokeWidth: 2.5,
        filter: 'drop-shadow(0 0 4px rgba(56, 189, 248, 0.6))',
      }
    : style;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={edgeStyle}
        interactionWidth={20}
      />
      {selected && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan z-50 flex items-center justify-center animate-in fade-in zoom-in-75 duration-150"
          >
            <button
              onClick={handleDelete}
              className="w-5 h-5 rounded-full bg-rose-500 hover:bg-rose-600 active:scale-95 text-white flex items-center justify-center shadow-lg border border-slate-900 transition-all hover:scale-110 cursor-pointer"
              title={t('nodes.deleteEdge')}
              type="button"
            >
              <X className="w-3 h-3 stroke-[2.5]" />
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};

export default memo(DeletableEdge);
