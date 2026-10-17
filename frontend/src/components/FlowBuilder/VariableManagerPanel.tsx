import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Variable,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Lock,
  AlertCircle,
  Check,
  Sparkles,
  Type,
  Hash,
  ToggleLeft,
  Braces,
} from 'lucide-react';
import { Node } from '@xyflow/react';
import { VariableType, WorkflowVariable } from '../../types';
import {
  SYSTEM_VARIABLES,
  validateVariableNameFormat,
  normalizeVariableValue,
  getDefaultValueForType,
  analyzeNodeVariableUsage,
} from '../../utils/variableUtils';
import { useI18n } from '../../i18n';

interface VariableManagerPanelProps {
  variables: WorkflowVariable[];
  onChangeVariables: (nextVars: WorkflowVariable[]) => void;
  nodes: Node[];
  onInsertVariable?: (varName: string) => void;
}

export const VariableManagerPanel: React.FC<VariableManagerPanelProps> = ({
  variables,
  onChangeVariables,
  nodes,
  onInsertVariable,
}) => {
  const { t, language } = useI18n();
  const isEn = language === 'en';

  const [isExpanded, setIsExpanded] = useState(true);
  const [activeSubTab, setActiveSubTab] = useState<'declared' | 'system'>('declared');

  // 하단 패널 높이 상태 (기본값 224px, 범위: 120px ~ 화면 70%)
  const [panelHeight, setPanelHeight] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('promptmacro_var_panel_height');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 120 && parsed <= 800) {
          return parsed;
        }
      }
    } catch {
      // 로컬스토리지 접근 제한 시 기본값
    }
    return 224;
  });
  const [isResizing, setIsResizing] = useState(false);

  // 높이 변경 시 로컬스토리지 저장
  useEffect(() => {
    try {
      localStorage.setItem('promptmacro_var_panel_height', panelHeight.toString());
    } catch {
      // 무시
    }
  }, [panelHeight]);

  // 상하 리사이즈 마우스 드래그 핸들러
  const handleStartResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // 접혀있었다면 자동으로 펼침
    if (!isExpanded) {
      setIsExpanded(true);
    }

    setIsResizing(true);
    const startY = e.clientY;
    const startHeight = panelHeight;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      // 위로 드래그 시 높이 증가
      const deltaY = startY - moveEvent.clientY;
      const maxHeight = Math.max(300, Math.floor(window.innerHeight * 0.7));
      const nextHeight = Math.max(120, Math.min(maxHeight, startHeight + deltaY));
      setPanelHeight(nextHeight);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [isExpanded, panelHeight]);

  // 신규 변수 추가 입력 폼 상태
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<VariableType>('string');
  const [newDefault, setNewDefault] = useState<string>('');
  const [newDesc, setNewDesc] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // 각 변수가 노드들에서 몇 번 출력/참조되는지 계산
  const usageStats = useMemo(() => {
    const stats: Record<string, { writtenBy: string[]; readBy: string[] }> = {};
    for (const v of variables) {
      stats[v.name] = { writtenBy: [], readBy: [] };
    }
    for (const sv of SYSTEM_VARIABLES) {
      stats[sv.name] = { writtenBy: [], readBy: [] };
    }

    for (const node of nodes) {
      if (node.type === 'flow_start' || node.type === 'flow_end') continue;
      const usage = analyzeNodeVariableUsage(node);
      const label = (node.data as any)?.label || node.id;

      if (usage.outputVar) {
        if (!stats[usage.outputVar]) {
          stats[usage.outputVar] = { writtenBy: [], readBy: [] };
        }
        stats[usage.outputVar].writtenBy.push(label);
      }

      for (const ref of usage.referencedVars) {
        if (!stats[ref]) {
          stats[ref] = { writtenBy: [], readBy: [] };
        }
        stats[ref].readBy.push(label);
      }
    }
    return stats;
  }, [variables, nodes]);

  const getTypeIcon = (type: VariableType) => {
    switch (type) {
      case 'string':
        return <Type className="w-3 h-3 text-emerald-400" />;
      case 'number':
        return <Hash className="w-3 h-3 text-sky-400" />;
      case 'boolean':
        return <ToggleLeft className="w-3 h-3 text-amber-400" />;
      case 'json':
        return <Braces className="w-3 h-3 text-purple-400" />;
    }
  };

  const getTypeBadgeStyle = (type: VariableType) => {
    switch (type) {
      case 'string':
        return 'bg-emerald-950/60 text-emerald-300 border-emerald-800/70';
      case 'number':
        return 'bg-sky-950/60 text-sky-300 border-sky-800/70';
      case 'boolean':
        return 'bg-amber-950/60 text-amber-300 border-amber-800/70';
      case 'json':
        return 'bg-purple-950/60 text-purple-300 border-purple-800/70';
    }
  };

  // 타입 변경 시 기본값 입력창 자동 초기화
  const handleNewTypeChange = (nextType: VariableType) => {
    setNewType(nextType);
    setFormError(null);
    if (nextType === 'boolean') {
      setNewDefault('false');
    } else if (nextType === 'number') {
      setNewDefault('0');
    } else if (nextType === 'json') {
      setNewDefault('{}');
    } else {
      setNewDefault('');
    }
  };

  // 신규 변수 등록
  const handleAddVariable = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedName = newName.trim();
    const fmtCheck = validateVariableNameFormat(trimmedName, isEn);
    if (!fmtCheck.valid) {
      setFormError(fmtCheck.reason || '올바르지 않은 변수명입니다.');
      return;
    }

    if (variables.some((v) => v.name === trimmedName)) {
      setFormError(
        isEn
          ? `Variable '${trimmedName}' is already declared.`
          : `'${trimmedName}' 변수는 이미 선언되어 있습니다.`
      );
      return;
    }

    const rawDefault =
      newType === 'boolean'
        ? newDefault === 'true'
        : newType === 'number' && newDefault.trim() === ''
        ? 0
        : newType === 'json' && newDefault.trim() === ''
        ? '{}'
        : newDefault;

    const norm = normalizeVariableValue(rawDefault, newType);
    if (!norm.valid) {
      setFormError(norm.error || '기본값 타입이 올바르지 않습니다.');
      return;
    }

    const created: WorkflowVariable = {
      name: trimmedName,
      type: newType,
      defaultValue: norm.normalizedValue,
      description: newDesc.trim() || undefined,
    };

    onChangeVariables([...variables, created]);
    setNewName('');
    setNewDesc('');
    if (newType === 'string') setNewDefault('');
    else if (newType === 'number') setNewDefault('0');
    else if (newType === 'boolean') setNewDefault('false');
    else setNewDefault('{}');
  };

  // 기존 선언 변수 타입 변경 (자동 형변환 보장)
  const handleUpdateVarType = (varName: string, nextType: VariableType) => {
    onChangeVariables(
      variables.map((v) => {
        if (v.name !== varName) return v;
        const norm = normalizeVariableValue(v.defaultValue, nextType);
        return {
          ...v,
          type: nextType,
          defaultValue: norm.valid ? norm.normalizedValue : getDefaultValueForType(nextType),
        };
      })
    );
  };

  // 기존 선언 변수 기본값 변경
  const handleUpdateVarDefault = (varName: string, rawVal: any, varType: VariableType) => {
    const norm = normalizeVariableValue(rawVal, varType);
    onChangeVariables(
      variables.map((v) => {
        if (v.name !== varName) return v;
        return {
          ...v,
          defaultValue: norm.valid ? norm.normalizedValue : rawVal,
        };
      })
    );
  };

  // 기존 선언 변수 설명 변경
  const handleUpdateVarDesc = (varName: string, desc: string) => {
    onChangeVariables(
      variables.map((v) => (v.name === varName ? { ...v, description: desc } : v))
    );
  };

  // 변수 삭제
  const handleDeleteVariable = (varName: string) => {
    onChangeVariables(variables.filter((v) => v.name !== varName));
  };

  // 변수 칩 드래그 시작 핸들러
  const handleDragStartVariable = (e: React.DragEvent, varName: string) => {
    const token = `{{${varName}}}`;
    e.dataTransfer.setData('application/x-praxis-variable', varName);
    e.dataTransfer.setData('text/plain', token);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <section
      style={{ height: isExpanded ? `${panelHeight}px` : '36px' }}
      className={`relative bg-slate-900 border-t border-slate-800 flex flex-col select-none shrink-0 ${
        isResizing ? '' : 'transition-[height] duration-200'
      }`}
    >
      {/* 상단 경계선 드래그 리사이저 핸들 (상하 크기 조절) */}
      <div
        onMouseDown={handleStartResize}
        className={`absolute -top-1 left-0 right-0 h-2.5 cursor-row-resize z-30 group transition-colors select-none flex items-center justify-center ${
          isResizing ? 'bg-emerald-500/30' : 'hover:bg-emerald-500/20'
        }`}
        title="드래그하여 상하 높이 조절"
      >
        {/* 미세한 드래그 그립 인디케이터 바 */}
        <div
          className={`w-12 h-1 rounded-full transition-colors ${
            isResizing ? 'bg-emerald-400' : 'bg-slate-700/60 group-hover:bg-emerald-400/80'
          }`}
        />
      </div>
      {/* 상단 헤더 바 */}
      <div className="h-9 px-3.5 bg-slate-950/80 border-b border-slate-800/80 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-200 hover:text-white transition-colors"
          >
            <Variable className="w-3.5 h-3.5 text-emerald-400" />
            <span>{t('variables.panelTitle')}</span>
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
            )}
          </button>

          {/* 서브 탭: 선언 변수 vs 시스템 변수 */}
          <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800">
            <button
              type="button"
              onClick={() => {
                setActiveSubTab('declared');
                if (!isExpanded) setIsExpanded(true);
              }}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all ${
                activeSubTab === 'declared'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t('variables.declaredCount', { count: variables.length })}
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveSubTab('system');
                if (!isExpanded) setIsExpanded(true);
              }}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all ${
                activeSubTab === 'system'
                  ? 'bg-slate-700 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t('variables.systemCount', { count: SYSTEM_VARIABLES.length })}
            </button>
          </div>

          {/* 접혀 있을 때도 빠른 변수 칩 미리보기 제공 */}
          {!isExpanded && variables.length > 0 && (
            <div className="hidden md:flex items-center gap-1.5 overflow-x-auto max-w-md py-0.5">
              {variables.map((v) => (
                <button
                  key={v.name}
                  type="button"
                  draggable
                  onDragStart={(e) => handleDragStartVariable(e, v.name)}
                  onClick={() => onInsertVariable?.(v.name)}
                  className="px-1.5 py-0.5 rounded bg-emerald-950/60 hover:bg-emerald-900/80 border border-emerald-800/60 text-[10px] font-mono text-emerald-300 flex items-center gap-1 cursor-grab active:cursor-grabbing shrink-0"
                  title={t('variables.insertHint')}
                >
                  <span>{`{{${v.name}}}`}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 text-[10px] text-slate-400">
          <span className="hidden sm:inline flex items-center gap-1 text-slate-400">
            <Sparkles className="w-3 h-3 text-emerald-400 inline mr-1" />
            {t('variables.insertHint')}
          </span>
        </div>
      </div>

      {/* 펼쳐진 본문 영역 */}
      {isExpanded && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {activeSubTab === 'declared' ? (
            <>
              {/* 상단 신규 변수 빠른 선언 바 */}
              <form
                onSubmit={handleAddVariable}
                className="px-3.5 py-2 bg-slate-900/90 border-b border-slate-800/80 flex flex-wrap items-center gap-2 shrink-0"
              >
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => {
                      setNewName(e.target.value);
                      if (formError) setFormError(null);
                    }}
                    placeholder={t('variables.varNamePlaceholder')}
                    className="w-36 sm:w-44 px-2.5 py-1 text-xs font-mono bg-slate-950 border border-slate-700 rounded-lg text-emerald-300 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />

                  <select
                    value={newType}
                    onChange={(e) => handleNewTypeChange(e.target.value as VariableType)}
                    className="px-2 py-1 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="string">{t('variables.varTypeString')}</option>
                    <option value="number">{t('variables.varTypeNumber')}</option>
                    <option value="boolean">{t('variables.varTypeBoolean')}</option>
                    <option value="json">{t('variables.varTypeJson')}</option>
                  </select>

                  {/* 타입별 기본값 입력 컨트롤 */}
                  {newType === 'boolean' ? (
                    <select
                      value={newDefault || 'false'}
                      onChange={(e) => setNewDefault(e.target.value)}
                      className="w-28 px-2 py-1 text-xs font-mono bg-slate-950 border border-slate-700 rounded-lg text-amber-300 focus:outline-none focus:border-amber-500"
                    >
                      <option value="false">false (거짓)</option>
                      <option value="true">true (참)</option>
                    </select>
                  ) : newType === 'number' ? (
                    <input
                      type="number"
                      step="any"
                      value={newDefault}
                      onChange={(e) => setNewDefault(e.target.value)}
                      placeholder="0"
                      className="w-28 px-2.5 py-1 text-xs font-mono bg-slate-950 border border-slate-700 rounded-lg text-sky-300 placeholder-slate-500 focus:outline-none focus:border-sky-500"
                    />
                  ) : (
                    <input
                      type="text"
                      value={newDefault}
                      onChange={(e) => setNewDefault(e.target.value)}
                      placeholder={
                        newType === 'json'
                          ? '{"key": "value"}'
                          : t('variables.varDefaultPlaceholder')
                      }
                      className="w-36 sm:w-44 px-2.5 py-1 text-xs font-mono bg-slate-950 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                    />
                  )}

                  <input
                    type="text"
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    placeholder={t('variables.varDescPlaceholder')}
                    className="w-40 sm:w-52 px-2.5 py-1 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-300 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />

                  <button
                    type="submit"
                    className="flex items-center gap-1 px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm transition-colors shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{t('variables.addVariableBtn')}</span>
                  </button>
                </div>

                {formError && (
                  <div className="flex items-center gap-1 text-[11px] text-rose-400 bg-rose-950/50 border border-rose-800/70 px-2 py-0.5 rounded-lg">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    <span>{formError}</span>
                  </div>
                )}
              </form>

              {/* 선언된 변수 테이블/리스트 */}
              <div className="flex-1 overflow-y-auto p-2.5 custom-scrollbar">
                {variables.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-center text-xs text-slate-500 py-4">
                    {t('variables.noDeclaredVars')}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                    {variables.map((v) => {
                      const usage = usageStats[v.name] || { writtenBy: [], readBy: [] };
                      const normCheck = normalizeVariableValue(v.defaultValue, v.type);

                      return (
                        <div
                          key={v.name}
                          className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-slate-950/70 border border-slate-800/90 hover:border-slate-700 transition-all group"
                        >
                          {/* 드래그 & 클릭 가능한 변수 칩 */}
                          <button
                            type="button"
                            draggable
                            onDragStart={(e) => handleDragStartVariable(e, v.name)}
                            onClick={() => onInsertVariable?.(v.name)}
                            className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-mono font-semibold cursor-grab active:cursor-grabbing transition-all shrink-0 hover:brightness-110 ${getTypeBadgeStyle(
                              v.type
                            )}`}
                            title={t('variables.insertHint')}
                          >
                            <GripVertical className="w-3 h-3 opacity-60" />
                            {getTypeIcon(v.type)}
                            <span>{`{{${v.name}}}`}</span>
                          </button>

                          {/* 타입 선택 드롭다운 */}
                          <select
                            value={v.type}
                            onChange={(e) =>
                              handleUpdateVarType(v.name, e.target.value as VariableType)
                            }
                            className="px-1.5 py-1 text-[11px] bg-slate-900 border border-slate-800 rounded text-slate-300 focus:outline-none focus:border-emerald-500 shrink-0"
                            title="변수 데이터 타입 (프론트/백엔드 자동 형변환 보장)"
                          >
                            <option value="string">String</option>
                            <option value="number">Number</option>
                            <option value="boolean">Boolean</option>
                            <option value="json">JSON</option>
                          </select>

                          {/* 기본값 편집 */}
                          <div className="w-28 sm:w-32 shrink-0">
                            {v.type === 'boolean' ? (
                              <select
                                value={String(Boolean(v.defaultValue))}
                                onChange={(e) =>
                                  handleUpdateVarDefault(
                                    v.name,
                                    e.target.value === 'true',
                                    'boolean'
                                  )
                                }
                                className="w-full px-2 py-1 text-[11px] font-mono bg-slate-900 border border-slate-800 rounded text-amber-300 focus:outline-none focus:border-amber-500"
                              >
                                <option value="false">false</option>
                                <option value="true">true</option>
                              </select>
                            ) : v.type === 'number' ? (
                              <input
                                type="number"
                                step="any"
                                value={v.defaultValue ?? 0}
                                onChange={(e) =>
                                  handleUpdateVarDefault(v.name, e.target.value, 'number')
                                }
                                className="w-full px-2 py-1 text-[11px] font-mono bg-slate-900 border border-slate-800 rounded text-sky-300 focus:outline-none focus:border-sky-500"
                              />
                            ) : (
                              <input
                                type="text"
                                value={String(v.defaultValue ?? '')}
                                onChange={(e) =>
                                  handleUpdateVarDefault(v.name, e.target.value, v.type)
                                }
                                placeholder={isEn ? 'Empty string' : '초기값 없음'}
                                className={`w-full px-2 py-1 text-[11px] font-mono bg-slate-900 border rounded text-slate-200 focus:outline-none ${
                                  normCheck.valid
                                    ? 'border-slate-800 focus:border-emerald-500'
                                    : 'border-rose-600 text-rose-300'
                                }`}
                              />
                            )}
                          </div>

                          {/* 설명 편집 */}
                          <input
                            type="text"
                            value={v.description || ''}
                            onChange={(e) => handleUpdateVarDesc(v.name, e.target.value)}
                            placeholder={t('variables.varDescPlaceholder')}
                            className="flex-1 min-w-[80px] px-2 py-1 text-[11px] bg-slate-900/60 border border-transparent hover:border-slate-800 focus:border-slate-700 rounded text-slate-300 placeholder-slate-600 focus:outline-none truncate"
                          />

                          {/* 노드 사용 현황 배지 */}
                          <div className="hidden xl:flex items-center gap-1 shrink-0 text-[10px]">
                            <span
                              className={`px-1.5 py-0.5 rounded border font-mono ${
                                usage.writtenBy.length > 0
                                  ? 'bg-blue-950/50 text-blue-300 border-blue-800/60'
                                  : 'bg-slate-900 text-slate-500 border-slate-800'
                              }`}
                              title={
                                usage.writtenBy.length > 0
                                  ? `값을 저장하는 노드: ${usage.writtenBy.join(', ')}`
                                  : '이 변수에 값을 출력하는 노드가 아직 없습니다 (초기값 사용)'
                              }
                            >
                              W:{usage.writtenBy.length}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded border font-mono ${
                                usage.readBy.length > 0
                                  ? 'bg-purple-950/50 text-purple-300 border-purple-800/60'
                                  : 'bg-slate-900 text-slate-500 border-slate-800'
                              }`}
                              title={
                                usage.readBy.length > 0
                                  ? `값을 참조하는 노드: ${usage.readBy.join(', ')}`
                                  : '이 변수를 참조하는 노드가 아직 없습니다'
                              }
                            >
                              R:{usage.readBy.length}
                            </span>
                          </div>

                          {/* 삭제 버튼 */}
                          <button
                            type="button"
                            onClick={() => handleDeleteVariable(v.name)}
                            className="p-1 rounded hover:bg-rose-950/60 text-slate-500 hover:text-rose-400 transition-colors shrink-0"
                            title={t('common.delete')}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          ) : (
            /* 시스템 기본 제공 변수 탭 (읽기 전용, 클릭/드래그 삽입 지원) */
            <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
              <div className="text-[11px] text-slate-400 mb-2 flex items-center gap-1.5">
                <Lock className="w-3 h-3 text-slate-500" />
                <span>{t('variables.systemVarsTitle')}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {SYSTEM_VARIABLES.map((sv) => {
                  const usage = usageStats[sv.name] || { writtenBy: [], readBy: [] };
                  return (
                    <div
                      key={sv.name}
                      className="flex items-center justify-between gap-2 p-2 rounded-xl bg-slate-950/70 border border-slate-800/80"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <button
                          type="button"
                          draggable
                          onDragStart={(e) => handleDragStartVariable(e, sv.name)}
                          onClick={() => onInsertVariable?.(sv.name)}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-mono text-slate-200 cursor-grab active:cursor-grabbing shrink-0"
                          title={t('variables.insertHint')}
                        >
                          <GripVertical className="w-3 h-3 opacity-50" />
                          <span>{`{{${sv.name}}}`}</span>
                        </button>
                        <span className="text-[11px] text-slate-400 truncate" title={sv.description}>
                          {sv.description}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800 shrink-0">
                        R:{usage.readBy.length}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
