import React, { memo, useState, useRef, useEffect } from 'react';
import { Handle, Position, NodeProps, useReactFlow } from '@xyflow/react';
import {
  FolderKanban,
  ChevronDown,
  ChevronRight,
  Plus,
  X,
  Edit3,
  Layers,
  Check,
} from 'lucide-react';
import { FlowNodeData, NodeType } from '../../types';
import { SKILL_ITEMS } from './skillRegistry';
import { useI18n } from '../../i18n';
import NodeNoteSubtitle from './NodeNoteSubtitle';

const COLOR_THEMES: Record<
  string,
  {
    bg: string;
    border: string;
    selectedBorder: string;
    headerBg: string;
    text: string;
    badge: string;
    accent: string;
  }
> = {
  indigo: {
    bg: 'bg-indigo-950/15',
    border: 'border-indigo-500/40',
    selectedBorder: 'border-indigo-400 ring-1 ring-indigo-400/60 shadow-indigo-500/20',
    headerBg: 'bg-indigo-950/75 border-indigo-500/30',
    text: 'text-indigo-200',
    badge: 'bg-indigo-900/70 text-indigo-200 border-indigo-600/50',
    accent: 'text-indigo-400',
  },
  emerald: {
    bg: 'bg-emerald-950/15',
    border: 'border-emerald-500/40',
    selectedBorder: 'border-emerald-400 ring-1 ring-emerald-400/60 shadow-emerald-500/20',
    headerBg: 'bg-emerald-950/75 border-emerald-500/30',
    text: 'text-emerald-200',
    badge: 'bg-emerald-900/70 text-emerald-200 border-emerald-600/50',
    accent: 'text-emerald-400',
  },
  amber: {
    bg: 'bg-amber-950/15',
    border: 'border-amber-500/40',
    selectedBorder: 'border-amber-400 ring-1 ring-amber-400/60 shadow-amber-500/20',
    headerBg: 'bg-amber-950/75 border-amber-500/30',
    text: 'text-amber-200',
    badge: 'bg-amber-900/70 text-amber-200 border-amber-600/50',
    accent: 'text-amber-400',
  },
  sky: {
    bg: 'bg-sky-950/15',
    border: 'border-sky-500/40',
    selectedBorder: 'border-sky-400 ring-1 ring-sky-400/60 shadow-sky-500/20',
    headerBg: 'bg-sky-950/75 border-sky-500/30',
    text: 'text-sky-200',
    badge: 'bg-sky-900/70 text-sky-200 border-sky-600/50',
    accent: 'text-sky-400',
  },
  purple: {
    bg: 'bg-purple-950/15',
    border: 'border-purple-500/40',
    selectedBorder: 'border-purple-400 ring-1 ring-purple-400/60 shadow-purple-500/20',
    headerBg: 'bg-purple-950/75 border-purple-500/30',
    text: 'text-purple-200',
    badge: 'bg-purple-900/70 text-purple-200 border-purple-600/50',
    accent: 'text-purple-400',
  },
  rose: {
    bg: 'bg-rose-950/15',
    border: 'border-rose-500/40',
    selectedBorder: 'border-rose-400 ring-1 ring-rose-400/60 shadow-rose-500/20',
    headerBg: 'bg-rose-950/75 border-rose-500/30',
    text: 'text-rose-200',
    badge: 'bg-rose-900/70 text-rose-200 border-rose-600/50',
    accent: 'text-rose-400',
  },
  slate: {
    bg: 'bg-slate-900/30',
    border: 'border-slate-600/50',
    selectedBorder: 'border-slate-400 ring-1 ring-slate-400/60 shadow-slate-500/20',
    headerBg: 'bg-slate-900/90 border-slate-700/60',
    text: 'text-slate-200',
    badge: 'bg-slate-800 text-slate-200 border-slate-600',
    accent: 'text-slate-300',
  },
};

const GroupNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const { deleteElements } = useReactFlow();
  const { t, language } = useI18n();
  const isEn = language === 'en';

  const nodeData = data as unknown as FlowNodeData & {
    childNodes?: { id: string; label: string; type: string }[];
    onToggleCollapse?: (groupId: string) => void;
    onAddChildSkill?: (groupId: string, skillType: NodeType, label: string, defaultConfig: Record<string, any>) => void;
    onRenameGroup?: (groupId: string, newLabel: string) => void;
    onResizeGroup?: (groupId: string, width: number, height: number) => void;
    onDelete?: (nodeId: string) => void;
  };

  const cfg = nodeData.config || {};
  const isCollapsed = !!cfg.collapsed;
  const width = Math.max(320, Number(cfg.width) || 560);
  const height = Math.max(180, Number(cfg.height) || 260);
  const colorKey = cfg.color || 'indigo';
  const theme = COLOR_THEMES[colorKey] || COLOR_THEMES.indigo;
  const childNodes = Array.isArray(nodeData.childNodes) ? nodeData.childNodes : [];

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState(nodeData.label || (isEn ? 'Node Group' : '그룹 노드'));
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTitleInput(nodeData.label || (isEn ? 'Node Group' : '그룹 노드'));
  }, [nodeData.label, isEn]);

  useEffect(() => {
    if (!showAddMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as HTMLElement)) {
        setShowAddMenu(false);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [showAddMenu]);

  const handleDelete = (evt: React.MouseEvent) => {
    evt.stopPropagation();
    if (typeof nodeData.onDelete === 'function') {
      nodeData.onDelete(id);
    } else {
      deleteElements({ nodes: [{ id }] });
    }
  };

  const handleToggleCollapse = (evt: React.MouseEvent) => {
    evt.stopPropagation();
    if (typeof nodeData.onToggleCollapse === 'function') {
      nodeData.onToggleCollapse(id);
    }
  };

  const handleCommitTitle = () => {
    setIsEditingTitle(false);
    const trimmed = titleInput.trim() || (isEn ? 'Node Group' : '그룹 노드');
    setTitleInput(trimmed);
    if (typeof nodeData.onRenameGroup === 'function') {
      nodeData.onRenameGroup(id, trimmed);
    }
  };

  // 우하단 리사이즈 핸들 드래그
  const handleStartResize = (evt: React.MouseEvent) => {
    evt.stopPropagation();
    evt.preventDefault();
    const startX = evt.clientX;
    const startY = evt.clientY;
    const startW = width;
    const startH = height;

    const onMove = (moveEvt: MouseEvent) => {
      const nextW = Math.max(320, startW + (moveEvt.clientX - startX));
      const nextH = Math.max(180, startH + (moveEvt.clientY - startY));
      if (typeof nodeData.onResizeGroup === 'function') {
        nodeData.onResizeGroup(id, nextW, nextH);
      }
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // 그룹 안에 추가 가능한 스킬 목록 (그룹 노드 자체는 중첩 방지 위해 제외)
  const addableSkills = SKILL_ITEMS.filter((item) => {
    if (item.type === 'flow_group') return false;
    if (!addSearch.trim()) return true;
    const q = addSearch.trim().toLowerCase();
    const itemLabel = (t(`skills.${item.type}.label`) || item.label).toLowerCase();
    return (
      itemLabel.includes(q) ||
      item.label.toLowerCase().includes(q) ||
      (item.tags || []).some((tg) => tg.toLowerCase().includes(q))
    );
  });

  // 1) 접힌(Collapsed) 상태 렌더링: 컴팩트한 카드 형태 + 좌우 가상 브릿지 Handle 제공
  if (isCollapsed) {
    return (
      <div
        className={`relative min-w-[230px] max-w-[290px] rounded-xl bg-slate-900 border-2 transition-all shadow-lg px-3.5 py-2.5 ${
          selected ? theme.selectedBorder : theme.border
        }`}
      >
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

        {/* 접힌 상태에서 외부 간선 브릿지 표시용 상/하 Handle */}
        <Handle
          type="target"
          position={Position.Top}
          id="target"
          className="!w-3 !h-3 !bg-teal-400 !border-2 !border-slate-900 !z-20 !pointer-events-none"
        />

        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <button
              type="button"
              onClick={handleToggleCollapse}
              onMouseDown={(e) => e.stopPropagation()}
              className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-teal-400 transition-colors shrink-0 cursor-pointer"
              title={isEn ? 'Expand Group' : '그룹 펼치기'}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <div className="min-w-0 flex-1">
              {isEditingTitle ? (
                <div className="flex items-center gap-1" onMouseDown={(e) => e.stopPropagation()}>
                  <input
                    type="text"
                    value={titleInput}
                    onChange={(e) => setTitleInput(e.target.value)}
                    onBlur={handleCommitTitle}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCommitTitle();
                    }}
                    autoFocus
                    className="w-full px-1.5 py-0.5 text-xs bg-slate-950 border border-teal-500 rounded text-white focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleCommitTitle}
                    className="p-0.5 text-emerald-400 hover:text-emerald-300"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setIsEditingTitle(true);
                  }}
                  className="flex items-center gap-1.5 group/title cursor-pointer"
                >
                  <FolderKanban className={`w-3.5 h-3.5 shrink-0 ${theme.accent}`} />
                  <span className="text-xs font-bold text-slate-100 truncate">
                    {nodeData.label}
                  </span>
                  <Edit3 className="w-2.5 h-2.5 text-slate-500 opacity-0 group-hover/title:opacity-100 transition-opacity shrink-0" />
                </div>
              )}
              <div className="text-[10px] text-teal-400/90 font-medium flex items-center gap-1 flex-wrap">
                <span>{isEn ? 'Collapsed Group' : '그룹 접힘'}</span>
                <span>·</span>
                <span>
                  {isEn ? `${childNodes.length} node(s)` : `하위 노드 ${childNodes.length}개`}
                </span>
                {(cfg.error_mode === 'break_group' || cfg.break_on_error) && (
                  <span className="text-[9px] px-1 py-0.2 rounded bg-amber-950/80 border border-amber-600/60 text-amber-200">
                    ⏭️ Break
                  </span>
                )}
                {(cfg.error_mode === 'catch_subflow' || cfg.catch_subflow_enabled) && (
                  <span className="text-[9px] px-1 py-0.2 rounded bg-cyan-950/80 border border-cyan-600/60 text-cyan-200">
                    🛡️ Catch
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 노드 이름(제목) 바로 아래 서브타이틀 주석 영역 */}
        <NodeNoteSubtitle
          nodeId={id}
          note={cfg.note ?? cfg.description}
          collapsed={cfg.note_collapsed}
          className="mb-1.5"
        />

        {/* 하위 노드 요약 칩 목록 */}
        <div className="bg-slate-950/80 rounded-lg px-2.5 py-1.5 border border-slate-800/90 space-y-1">
          {childNodes.length === 0 ? (
            <div className="text-[10px] text-slate-500 italic">
              {isEn ? 'No nodes inside group' : '포함된 하위 노드가 없습니다'}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1 max-h-16 overflow-hidden">
              {childNodes.slice(0, 4).map((cn, idx) => (
                <span
                  key={cn.id}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700/80 text-slate-300 truncate max-w-[115px]"
                >
                  {idx + 1}. {cn.label}
                </span>
              ))}
              {childNodes.length > 4 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-950/70 border border-teal-700/50 text-teal-300 font-mono">
                  +{childNodes.length - 4}
                </span>
              )}
            </div>
          )}
        </div>

        <Handle
          type="source"
          position={Position.Bottom}
          id="source"
          className="!w-3 !h-3 !bg-teal-400 !border-2 !border-slate-900 !z-20 !pointer-events-none"
        />
      </div>
    );
  }

  // 2) 펼쳐진(Expanded) 상태 렌더링: 반투명 영역 컨테이너 + 상단 바 + '+' 노드 추가 메뉴 + 우하단 리사이즈 핸들
  return (
    <div
      style={{ width: `${width}px`, height: `${height}px` }}
      className={`relative rounded-2xl border-2 border-dashed transition-colors flex flex-col ${
        theme.bg
      } ${selected ? theme.selectedBorder : theme.border}`}
    >
      {/* 노드 선택 시 우상단 ✕ 삭제 버튼 */}
      {selected && (
        <button
          onClick={handleDelete}
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute -top-3 -right-3 w-6 h-6 rounded-full bg-rose-500 hover:bg-rose-600 active:scale-95 text-white flex items-center justify-center shadow-lg border-2 border-slate-900 transition-all hover:scale-110 cursor-pointer z-40"
          title={t('nodes.deleteNode')}
          type="button"
        >
          <X className="w-3.5 h-3.5 stroke-[2.5]" />
        </button>
      )}

      {/* 상단 그룹 헤더 바 */}
      <div
        className={`flex flex-col gap-1 px-3.5 py-2 rounded-t-xl border-b backdrop-blur-sm ${theme.headerBg}`}
      >
        <div className="flex items-center justify-between gap-2 w-full">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            type="button"
            onClick={handleToggleCollapse}
            onMouseDown={(e) => e.stopPropagation()}
            className="p-1 rounded-md bg-slate-900/70 hover:bg-slate-800 text-slate-200 border border-slate-700/70 transition-colors cursor-pointer shrink-0"
            title={isEn ? 'Collapse Group' : '그룹 접기 (하위 노드 숨기기)'}
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>

          <FolderKanban className={`w-4 h-4 shrink-0 ${theme.accent}`} />

          {isEditingTitle ? (
            <div className="flex items-center gap-1 flex-1 max-w-[240px]" onMouseDown={(e) => e.stopPropagation()}>
              <input
                type="text"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                onBlur={handleCommitTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCommitTitle();
                }}
                autoFocus
                className="w-full px-2 py-0.5 text-xs bg-slate-950 border border-teal-500 rounded text-white focus:outline-none"
              />
              <button
                type="button"
                onClick={handleCommitTitle}
                className="p-1 rounded bg-emerald-600 text-white hover:bg-emerald-500"
              >
                <Check className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <div
              onDoubleClick={(e) => {
                e.stopPropagation();
                setIsEditingTitle(true);
              }}
              className="flex items-center gap-1.5 min-w-0 group/title cursor-pointer"
              title={isEn ? 'Double-click to edit group name' : '더블클릭하여 그룹 이름 수정'}
            >
              <span className={`text-xs font-bold truncate ${theme.text}`}>
                {nodeData.label}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsEditingTitle(true);
                }}
                onMouseDown={(e) => e.stopPropagation()}
                className="p-0.5 rounded text-slate-400 hover:text-white opacity-60 group-hover/title:opacity-100 transition-opacity"
              >
                <Edit3 className="w-3 h-3" />
              </button>
            </div>
          )}

          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border shrink-0 ${theme.badge}`}>
            {isEn ? `${childNodes.length} node(s)` : `${childNodes.length}개 노드`}
          </span>

          {(cfg.error_mode === 'break_group' || cfg.break_on_error) && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-950/80 border border-amber-600/60 text-amber-200 font-medium shrink-0">
              {isEn ? '⏭️ Break on Error' : '⏭️ 오류 시 그룹 건너뛰기'}
            </span>
          )}
          {(cfg.error_mode === 'catch_subflow' || cfg.catch_subflow_enabled) && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-950/80 border border-cyan-600/60 text-cyan-200 font-medium shrink-0 truncate max-w-[160px]">
              🛡️ Catch: {cfg.catch_subflow_name || (isEn ? 'Subflow' : '서브플로우')}
            </span>
          )}
        </div>

        {/* 우측 액션: '+' 그룹 내부에 스킬 노드 즉시 추가 버튼 */}
        <div className="relative flex items-center gap-1.5 shrink-0" ref={menuRef}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowAddMenu((prev) => !prev);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-teal-600/90 hover:bg-teal-500 text-white text-[11px] font-semibold shadow-sm transition-colors cursor-pointer"
            title={isEn ? 'Add a skill node inside this group' : '이 그룹 내부에 스킬 노드 추가'}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{isEn ? 'Add Node' : '노드 추가'}</span>
          </button>

          {/* '+' 클릭 시 열리는 스킬 선택 드롭다운 팝오버 */}
          {showAddMenu && (
            <div
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className="nopan nodrag absolute right-0 top-full mt-1.5 w-64 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden"
            >
              <div className="p-2 border-b border-slate-800 bg-slate-950/80">
                <input
                  type="text"
                  value={addSearch}
                  onChange={(e) => setAddSearch(e.target.value)}
                  placeholder={isEn ? 'Search skill to add...' : '그룹에 추가할 스킬 검색...'}
                  autoFocus
                  className="w-full px-2.5 py-1 text-xs bg-slate-900 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-teal-500"
                />
              </div>
              <div className="max-h-56 overflow-y-auto p-1.5 space-y-1 custom-scrollbar">
                {addableSkills.map((item) => {
                  const itemLabel = t(`skills.${item.type}.label`) || item.label;
                  return (
                    <button
                      key={item.type}
                      type="button"
                      onClick={() => {
                        if (typeof nodeData.onAddChildSkill === 'function') {
                          nodeData.onAddChildSkill(id, item.type, itemLabel, item.defaultConfig);
                        }
                        setShowAddMenu(false);
                        setAddSearch('');
                      }}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      <span className="shrink-0">{item.icon}</span>
                      <span className="truncate font-medium">{itemLabel}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        </div>

        {/* 노드 이름(제목) 바로 아래 서브타이틀 주석 영역 */}
        <NodeNoteSubtitle
          nodeId={id}
          note={cfg.note ?? cfg.description}
          collapsed={cfg.note_collapsed}
        />
      </div>

      {/* 그룹 바디 영역 (하위 노드가 없을 때 가이드 안내 표시) */}
      <div className="flex-1 relative flex items-center justify-center pointer-events-none p-4">
        {childNodes.length === 0 && (
          <div className="text-center space-y-1 opacity-60">
            <Layers className="w-6 h-6 text-slate-400 mx-auto" />
            <p className="text-xs font-medium text-slate-300">
              {isEn
                ? 'Drag nodes into this box or click [+ Add Node] above'
                : '노드를 이 영역 안으로 드래그하거나 상단 [+ 노드 추가] 버튼을 누르세요'}
            </p>
            <p className="text-[10px] text-slate-400">
              {isEn
                ? 'Visual grouping only — does not affect workflow execution'
                : '시각적 그룹화 전용 컨테이너 (백엔드 실행 순서에는 영향을 주지 않음)'}
            </p>
          </div>
        )}
      </div>

      {/* 우하단 크기 조절(Resize) 핸들 */}
      <div
        onMouseDown={handleStartResize}
        className="nopan nodrag absolute bottom-1 right-1 w-5 h-5 cursor-nwse-resize flex items-end justify-end p-0.5 text-slate-400 hover:text-white z-30"
        title={isEn ? 'Drag to resize group area' : '드래그하여 그룹 영역 크기 조절'}
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
          <path d="M14 14H10V12H12V10H14V14ZM14 7H12V5H14V7ZM7 14H5V12H7V14Z" />
        </svg>
      </div>
    </div>
  );
};

export default memo(GroupNode);
