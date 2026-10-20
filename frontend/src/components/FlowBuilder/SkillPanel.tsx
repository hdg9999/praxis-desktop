import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Search,
  X,
  ChevronDown,
  ChevronsUpDown,
  ChevronsDownUp,
  Workflow,
  Blocks,
  Plus,
  SlidersHorizontal,
  Trash2,
  CheckCircle2,
  Clock,
  Variable,
} from 'lucide-react';
import { Flow, NodeType } from '../../types';
import {
  SKILL_CATEGORIES,
  SKILL_ITEMS,
  SkillCategory,
  SkillItem,
} from './skillRegistry';
import { useI18n } from '../../i18n';

interface SkillPanelProps {
  onAddNode: (type: NodeType, label: string, defaultConfig: Record<string, any>) => void;
  flows?: Flow[];
  activeFlow?: Flow | null;
  isLoadingFlows?: boolean;
  onSelectFlow?: (flowId: string) => void;
  onNewFlow?: () => void;
  onDeleteFlow?: (flowId: string, e: React.MouseEvent) => void;
  onOpenFlowSettings?: () => void;
}

export const SkillPanel: React.FC<SkillPanelProps> = ({
  onAddNode,
  flows = [],
  activeFlow = null,
  isLoadingFlows = false,
  onSelectFlow,
  onNewFlow,
  onDeleteFlow,
  onOpenFlowSettings,
}) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<'skills' | 'workflows'>('skills');
  const [searchQuery, setSearchQuery] = useState('');
  const [workflowSearchQuery, setWorkflowSearchQuery] = useState('');
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});

  // 좌측 패널 가변 너비 상태 (기본값 260px, 범위: 200px ~ 화면 45%)
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('promptmacro_skill_panel_width');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 200 && parsed <= 800) {
          return parsed;
        }
      }
    } catch {
      // 로컬스토리지 접근 제한 시 기본값
    }
    return 260;
  });
  const [isResizing, setIsResizing] = useState(false);

  // 너비 변경 시 로컬스토리지에 저장
  useEffect(() => {
    try {
      localStorage.setItem('promptmacro_skill_panel_width', panelWidth.toString());
    } catch {
      // 무시
    }
  }, [panelWidth]);

  // 좌우 리사이즈 마우스 드래그 시작 핸들러
  const handleStartResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);

    const startX = e.clientX;
    const startWidth = panelWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const maxWidth = Math.max(350, Math.floor(window.innerWidth * 0.45));
      const nextWidth = Math.max(200, Math.min(maxWidth, startWidth + deltaX));
      setPanelWidth(nextWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [panelWidth]);

  // 번역된 라벨 및 설명 헬퍼
  const getItemLabel = (item: SkillItem) => t(`skills.${item.type}.label`) || item.label;
  const getItemDesc = (item: SkillItem) => t(`skills.${item.type}.desc`) || item.desc;
  const getCatLabel = (cat: SkillCategory) => t(`skillCategories.${cat.id}.label`) || cat.label;

  // 드래그 앤 드롭 시작
  const onDragStart = (event: React.DragEvent, item: SkillItem) => {
    event.dataTransfer.setData(
      'application/reactflow',
      JSON.stringify({
        type: item.type,
        label: getItemLabel(item),
        defaultConfig: item.defaultConfig,
      })
    );
    event.dataTransfer.effectAllowed = 'move';
  };

  // 개별 카테고리 접기/펼치기 토글
  const toggleCategory = (categoryId: string) => {
    setCollapsedCategories((prev) => ({
      ...prev,
      [categoryId]: !prev[categoryId],
    }));
  };

  // 전체 접기 / 전체 펼치기
  const handleToggleAll = (collapse: boolean) => {
    const updated: Record<string, boolean> = {};
    SKILL_CATEGORIES.forEach((cat) => {
      updated[cat.id] = collapse;
    });
    setCollapsedCategories(updated);
  };

  const isAllCollapsed = useMemo(() => {
    return (
      SKILL_CATEGORIES.length > 0 &&
      SKILL_CATEGORIES.every((cat) => !!collapsedCategories[cat.id])
    );
  }, [collapsedCategories]);

  // 검색 필터링 로직 (한국어 + 영어 번역어 동시 매칭)
  const filteredCategories = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return SKILL_CATEGORIES.map((category) => {
      const catLabel = getCatLabel(category);
      const items = SKILL_ITEMS.filter((item) => {
        if (item.categoryId !== category.id) return false;
        if (!query) return true;

        const itemLabel = getItemLabel(item).toLowerCase();
        const itemDesc = getItemDesc(item).toLowerCase();
        const origLabel = item.label.toLowerCase();
        const origDesc = item.desc.toLowerCase();
        const categoryMatch =
          catLabel.toLowerCase().includes(query) || category.label.toLowerCase().includes(query);
        const matchTags = item.tags?.some((tag) => tag.toLowerCase().includes(query)) || false;

        return (
          itemLabel.includes(query) ||
          itemDesc.includes(query) ||
          origLabel.includes(query) ||
          origDesc.includes(query) ||
          categoryMatch ||
          matchTags
        );
      });

      return {
        category,
        items,
      };
    }).filter((group) => {
      if (searchQuery.trim()) {
        return group.items.length > 0;
      }
      return true;
    });
  }, [searchQuery, t]);

  // 전체 매칭 아이템 수
  const totalFilteredCount = useMemo(() => {
    return filteredCategories.reduce((sum, g) => sum + g.items.length, 0);
  }, [filteredCategories]);

  // 워크플로우 목록 필터링 (이름 + 설명)
  const filteredFlows = useMemo(() => {
    const q = workflowSearchQuery.trim().toLowerCase();
    if (!q) return flows;
    return flows.filter(
      (f) =>
        (f.name || '').toLowerCase().includes(q) ||
        (f.description || '').toLowerCase().includes(q)
    );
  }, [flows, workflowSearchQuery]);

  // 현재 편집 중인 미저장(신규) 워크플로우 여부
  const isUnsavedActiveFlow =
    activeFlow && (activeFlow.id.startsWith('temp_') || !flows.some((f) => f.id === activeFlow.id));

  return (
    <aside
      style={{ width: `${panelWidth}px` }}
      className="relative bg-slate-900 border-r border-slate-800 flex flex-col h-full select-none shrink-0"
    >
      {/* 우측 경계선 드래그 리사이저 핸들 (좌우 크기 조절) */}
      <div
        onMouseDown={handleStartResize}
        className={`absolute top-0 -right-1 w-2.5 h-full cursor-col-resize z-30 group transition-colors select-none ${
          isResizing ? 'bg-indigo-500/30' : 'hover:bg-indigo-500/20'
        }`}
        title="드래그하여 좌우 너비 조절"
      >
        <div
          className={`w-0.5 h-full mx-auto transition-colors ${
            isResizing ? 'bg-indigo-400' : 'bg-transparent group-hover:bg-indigo-400/80'
          }`}
        />
      </div>
      {/* 최상단 탭 스위처: [스킬] vs [워크플로우] */}
      <div className="p-2.5 pb-2 border-b border-slate-800 bg-slate-950/50 shrink-0">
        <div className="grid grid-cols-2 gap-1 p-1 bg-slate-950 rounded-xl border border-slate-800">
          <button
            type="button"
            onClick={() => setActiveTab('skills')}
            className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'skills'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <Blocks className="w-3.5 h-3.5" />
            <span>{t('workflowTab.tabSkills')}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('workflows')}
            className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'workflows'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <Workflow className="w-3.5 h-3.5" />
            <span>{t('workflowTab.tabWorkflows')}</span>
            <span
              className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                activeTab === 'workflows'
                  ? 'bg-indigo-800/90 text-indigo-100'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {flows.length}
            </span>
          </button>
        </div>
      </div>

      {activeTab === 'skills' ? (
        <>
          {/* 스킬 탭 헤더 영역 */}
          <div className="p-3.5 border-b border-slate-800 shrink-0">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-xs font-semibold text-slate-200 tracking-wide">
                {t('skills.title')}
              </h2>
              {!searchQuery.trim() && (
                <button
                  onClick={() => handleToggleAll(!isAllCollapsed)}
                  className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-slate-800 transition-colors"
                  title={isAllCollapsed ? t('skills.expandAll') : t('skills.collapseAll')}
                >
                  {isAllCollapsed ? (
                    <>
                      <ChevronsUpDown className="w-3 h-3 text-slate-400" />
                      <span>{t('skills.expandAll')}</span>
                    </>
                  ) : (
                    <>
                      <ChevronsDownUp className="w-3 h-3 text-slate-400" />
                      <span>{t('skills.collapseAll')}</span>
                    </>
                  )}
                </button>
              )}
            </div>
            <p className="text-[10px] text-slate-400">{t('skills.dragOrDoubleClick')}</p>

            {/* 검색 입력창 */}
            <div className="relative mt-2.5">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('skills.searchPlaceholder')}
                className="w-full bg-slate-950/80 border border-slate-700/80 rounded-lg pl-8 pr-7 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500/80 focus:ring-1 focus:ring-blue-500/50 transition-all"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-0.5 rounded-full hover:bg-slate-800 transition-colors"
                  title={t('skills.clearSearch')}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {searchQuery.trim() && (
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-800/80 text-[10px] text-slate-400">
                <span>
                  {t('skills.searchResultsCount', { count: totalFilteredCount })}
                </span>
                <button
                  onClick={() => setSearchQuery('')}
                  className="text-blue-400 hover:text-blue-300 font-medium hover:underline"
                >
                  {t('skills.clearSearch')}
                </button>
              </div>
            )}
          </div>

          {/* 스킬 목록 스크롤 영역 */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3.5 custom-scrollbar">
            {filteredCategories.length === 0 ? (
              <div className="py-10 text-center px-4">
                <Search className="w-6 h-6 text-slate-600 mx-auto mb-2" />
                <p className="text-xs text-slate-400 font-medium">
                  {t('skills.noSearchResults')}
                </p>
                <p className="text-[11px] text-slate-500 mt-1">
                  "{searchQuery}"
                </p>
                <button
                  onClick={() => setSearchQuery('')}
                  className="mt-3 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg transition-colors"
                >
                  {t('skills.clearSearch')}
                </button>
              </div>
            ) : (
              filteredCategories.map(({ category, items }) => {
                const isCollapsed = !searchQuery.trim() && !!collapsedCategories[category.id];
                const catLabel = getCatLabel(category);

                return (
                  <div
                    key={category.id}
                    className="rounded-xl border border-slate-800/80 bg-slate-950/40 overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => toggleCategory(category.id)}
                      className={`w-full flex items-center justify-between px-3 py-2 bg-slate-900/60 hover:bg-slate-850 transition-colors text-left group ${
                        category.headerColor || ''
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="shrink-0">{category.icon}</span>
                        <span className="text-xs font-semibold text-slate-300 group-hover:text-slate-100 truncate">
                          {catLabel}
                        </span>
                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full border ${
                            category.badgeColor || 'bg-slate-800 text-slate-400 border-slate-700'
                          }`}
                        >
                          {items.length}
                        </span>
                      </div>

                      <ChevronDown
                        className={`w-3.5 h-3.5 text-slate-500 group-hover:text-slate-300 transition-transform duration-200 shrink-0 ${
                          isCollapsed ? '-rotate-90' : 'rotate-0'
                        }`}
                      />
                    </button>

                    {!isCollapsed && (
                      <div className="p-2 space-y-1.5 bg-slate-950/20">
                        {items.map((item) => {
                          const itemLabel = getItemLabel(item);
                          const itemDesc = getItemDesc(item);

                          return (
                            <div
                              key={item.type}
                              draggable
                              onDragStart={(e) => onDragStart(e, item)}
                              onDoubleClick={() => onAddNode(item.type, itemLabel, item.defaultConfig)}
                              className="flex items-start gap-2.5 p-2 rounded-lg bg-slate-900/90 border border-slate-800/90 hover:border-blue-500/50 hover:bg-slate-850 cursor-grab active:cursor-grabbing transition-all group shadow-sm hover:shadow-md"
                            >
                              <div className="mt-0.5 p-1 rounded-md bg-slate-800/80 border border-slate-700/60 group-hover:border-blue-500/40 transition-colors shrink-0">
                                {item.icon}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-medium text-slate-200 group-hover:text-white truncate">
                                  {itemLabel}
                                </div>
                                <div className="text-[10px] text-slate-400 group-hover:text-slate-300 line-clamp-1 leading-tight mt-0.5">
                                  {itemDesc}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      ) : (
        /* 워크플로우 탭 영역 */
        <>
          <div className="p-3.5 border-b border-slate-800 shrink-0 space-y-2.5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xs font-semibold text-slate-200 tracking-wide">
                  {t('workflowTab.title')}
                </h2>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {t('workflowTab.subtitle')}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {onOpenFlowSettings && activeFlow && (
                  <button
                    type="button"
                    onClick={onOpenFlowSettings}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors"
                    title={t('workflowTab.openSettingsTooltip')}
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-400" />
                  </button>
                )}
                {onNewFlow && (
                  <button
                    type="button"
                    onClick={onNewFlow}
                    className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold shadow-sm transition-colors"
                    title={t('workflowTab.newWorkflowBtn')}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{t('workflowTab.newBtn')}</span>
                  </button>
                )}
              </div>
            </div>

            {/* 워크플로우 검색 입력창 */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={workflowSearchQuery}
                onChange={(e) => setWorkflowSearchQuery(e.target.value)}
                placeholder={t('workflowTab.searchPlaceholder')}
                className="w-full bg-slate-950/80 border border-slate-700/80 rounded-lg pl-8 pr-7 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500/80 focus:ring-1 focus:ring-indigo-500/50 transition-all"
              />
              {workflowSearchQuery && (
                <button
                  onClick={() => setWorkflowSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-0.5 rounded-full hover:bg-slate-800 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* 워크플로우 리스트 스크롤 영역 */}
          <div className="flex-1 overflow-y-auto p-2.5 space-y-2 custom-scrollbar">
            {/* 아직 저장되지 않은 신규 워크플로우가 활성 상태인 경우 상단에 표시 */}
            {isUnsavedActiveFlow && activeFlow && (
              <div
                className="p-2.5 rounded-xl bg-indigo-950/40 border border-indigo-500/60 shadow-md transition-all cursor-pointer"
                onClick={() => onSelectFlow?.(activeFlow.id)}
              >
                <div className="flex items-start gap-2.5">
                  <div className="mt-0.5 p-1.5 rounded-lg bg-indigo-900/70 border border-indigo-500/50 text-indigo-300 shrink-0">
                    <Workflow className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-semibold text-white truncate">
                        {activeFlow.name}
                      </span>
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 shrink-0">
                        {t('workflowTab.unsavedBadge')}
                      </span>
                    </div>
                    <p className="text-[10px] text-indigo-200/80 line-clamp-2 leading-relaxed mt-1">
                      {activeFlow.description?.trim()
                        ? activeFlow.description
                        : t('workflowTab.noDescription')}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {isLoadingFlows ? (
              <div className="py-10 text-center text-xs text-slate-400">
                {t('nav.loadingFlows')}
              </div>
            ) : filteredFlows.length === 0 ? (
              <div className="py-10 text-center px-4">
                <Workflow className="w-6 h-6 text-slate-600 mx-auto mb-2" />
                <p className="text-xs text-slate-400 font-medium">
                  {t('workflowTab.emptyList')}
                </p>
              </div>
            ) : (
              filteredFlows.map((flow) => {
                const isSelected = activeFlow?.id === flow.id;
                const displayFlow = isSelected && activeFlow ? activeFlow : flow;
                const rawNodes = displayFlow.graph_data?.nodes || [];
                const actionNodeCount = rawNodes.filter(
                  (n: any) => n.type !== 'flow_start' && n.type !== 'flow_end' && n.type !== 'flow_group'
                ).length;
                const varCount = (displayFlow.graph_data?.variables || []).length;
                const delaySec = displayFlow.graph_data?.settings?.execution_delay ?? 0.3;
                const descText =
                  displayFlow.description?.trim() || t('workflowTab.noDescription');

                return (
                  <div
                    key={flow.id}
                    onClick={() => onSelectFlow?.(flow.id)}
                    className={`group relative flex flex-col gap-2 p-2.5 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-950/40 border-indigo-500/70 shadow-md shadow-indigo-950/50'
                        : 'bg-slate-900/90 border-slate-800/90 hover:border-indigo-500/40 hover:bg-slate-850'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <div
                        className={`mt-0.5 p-1.5 rounded-lg border transition-colors shrink-0 ${
                          isSelected
                            ? 'bg-indigo-600/30 border-indigo-500/60 text-indigo-300'
                            : 'bg-slate-800/80 border-slate-700/60 text-slate-400 group-hover:text-indigo-300 group-hover:border-indigo-500/40'
                        }`}
                      >
                        <Workflow className="w-4 h-4" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <span
                            className={`text-xs font-semibold truncate ${
                              isSelected ? 'text-white' : 'text-slate-200 group-hover:text-white'
                            }`}
                          >
                            {displayFlow.name}
                          </span>

                          {isSelected && (
                            <span className="flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 shrink-0">
                              <CheckCircle2 className="w-2.5 h-2.5" />
                              {t('workflowTab.activeBadge')}
                            </span>
                          )}
                        </div>

                        {/* 스킬노드처럼 워크플로우에 대한 간단한 설명 표시 */}
                        <div
                          className={`text-[10px] line-clamp-2 leading-relaxed mt-1 ${
                            displayFlow.description?.trim()
                              ? 'text-slate-300 group-hover:text-slate-200'
                              : 'text-slate-500 italic'
                          }`}
                          title={descText}
                        >
                          {descText}
                        </div>
                      </div>
                    </div>

                    {/* 하단 메타 배지 및 우측 액션 버튼 */}
                    <div className="flex items-center justify-between pt-1.5 border-t border-slate-800/70 text-[10px] text-slate-400">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="px-1.5 py-0.5 rounded bg-slate-950/70 border border-slate-800 text-slate-300 font-mono">
                          {t('workflowTab.nodeCount', { count: actionNodeCount })}
                        </span>
                        <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-950/70 border border-slate-800 text-emerald-300 font-mono">
                          <Variable className="w-2.5 h-2.5" />
                          {varCount}
                        </span>
                        <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-950/70 border border-slate-800 text-amber-300 font-mono">
                          <Clock className="w-2.5 h-2.5" />
                          {delaySec}s
                        </span>
                      </div>

                      <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100">
                        {isSelected && onOpenFlowSettings && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenFlowSettings();
                            }}
                            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-indigo-300 transition-colors"
                            title={t('workflowTab.openSettingsTooltip')}
                          >
                            <SlidersHorizontal className="w-3 h-3" />
                          </button>
                        )}
                        {onDeleteFlow && flows.length > 1 && (
                          <button
                            type="button"
                            onClick={(e) => onDeleteFlow(flow.id, e)}
                            className="p-1 rounded hover:bg-rose-950/60 text-slate-500 hover:text-rose-400 transition-colors"
                            title={t('workflowTab.deleteTooltip')}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </aside>
  );
};
