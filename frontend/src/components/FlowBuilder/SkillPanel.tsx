import React, { useState, useMemo } from 'react';
import {
  Search,
  X,
  ChevronDown,
  ChevronsUpDown,
  ChevronsDownUp,
  Sparkles,
} from 'lucide-react';
import { NodeType } from '../../types';
import {
  SKILL_CATEGORIES,
  SKILL_ITEMS,
  SkillCategory,
  SkillItem,
} from './skillRegistry';
import { useI18n } from '../../i18n';

interface SkillPanelProps {
  onAddNode: (type: NodeType, label: string, defaultConfig: Record<string, any>) => void;
}

export const SkillPanel: React.FC<SkillPanelProps> = ({ onAddNode }) => {
  const { t } = useI18n();
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});

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
        const categoryMatch = catLabel.toLowerCase().includes(query) || category.label.toLowerCase().includes(query);
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
      // 검색어가 있을 때는 매칭된 아이템이 있는 카테고리만 노출
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

  return (
    <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col h-full select-none">
      {/* 헤더 영역 */}
      <div className="p-3.5 border-b border-slate-800 shrink-0">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-xs font-semibold text-slate-200 tracking-wide">
            스킬 패널 (Skill Panel)
          </h2>
          {/* 전체 접기/펼치기 원클릭 토글 버튼 */}
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

        {/* 검색 진행 중 카운트 및 초기화 바 */}
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

      {/* 스킬 목록 스크롤 영역 (아코디언 카테고리) */}
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
                {/* 카테고리 헤더 (클릭 시 토글) */}
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

                {/* 카테고리 내 스킬 아이템 목록 */}
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
    </aside>
  );
};
