import React from 'react';
import {
  Trash2,
  X,
  Sparkles,
  HelpCircle,
  Crosshair,
  RotateCcw,
  Zap,
  Move,
  Keyboard,
  AppWindow,
  Maximize2,
  Minimize2,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Play,
  Flag,
  Monitor,
  Camera,
  Save,
  Copy,
  Bot,
  Wrench,
  Rocket,
  FolderOpen,
  XCircle,
  Power,
  Ban,
  ShieldCheck,
} from 'lucide-react';
import { FlowNodeData } from '../../types';
import { resolveImageUrl } from '../../services/api';
import { AGENT_AVAILABLE_SKILLS } from './skillRegistry';
import { useI18n } from '../../i18n';

interface PropertyInspectorProps {
  selectedNode: any | null;
  ollamaModels: string[];
  onUpdateNodeData: (nodeId: string, label: string, config: Record<string, any>) => void;
  onDeleteNode: (nodeId: string) => void;
  onClose: () => void;
  onOpenObjectPicker?: () => void;
}

export const PropertyInspector: React.FC<PropertyInspectorProps> = ({
  selectedNode,
  ollamaModels,
  onUpdateNodeData,
  onDeleteNode,
  onClose,
  onOpenObjectPicker,
}) => {
  const { t, language } = useI18n();
  const isEn = language === 'en';

  if (!selectedNode) return null;

  const nodeData = selectedNode.data as FlowNodeData;
  const cfg = { ...nodeData.config };
  const isStart = nodeData.type === 'flow_start';
  const isEnd = nodeData.type === 'flow_end';
  const isMarker = isStart || isEnd;
  const subtype = nodeData.type.replace('general_', '');
  const isAi = nodeData.type === 'ai_ollama';
  const isAgent = nodeData.type === 'agent_basic';

  const handleLabelChange = (newLabel: string) => {
    onUpdateNodeData(selectedNode.id, newLabel, cfg);
  };

  const handleConfigChange = (key: string, val: any) => {
    const updated = { ...cfg, [key]: val };
    onUpdateNodeData(selectedNode.id, nodeData.label, updated);
  };

  const handleBrowseFile = async () => {
    if (window.electronAPI?.openFileDialog) {
      const selectedPath = await window.electronAPI.openFileDialog();
      if (selectedPath) {
        handleConfigChange('program_path', selectedPath);
      }
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.exe,.bat,.cmd,.lnk,*';
    input.onchange = (e: any) => {
      const file = e.target.files?.[0];
      if (file) {
        const filePath = file.path || file.name;
        handleConfigChange('program_path', filePath);
      }
    };
    input.click();
  };

  return (
    <aside className="w-80 bg-slate-900 border-l border-slate-800 flex flex-col h-full select-none">
      <div className="p-4 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isStart && <Play className="w-4 h-4 text-emerald-400 fill-current" />}
          {isEnd && <Flag className="w-4 h-4 text-rose-400" />}
          {isAi && <Sparkles className="w-4 h-4 text-purple-400" />}
          {isAgent && <Bot className="w-4 h-4 text-indigo-400" />}
          {subtype === 'screenshot' && <Camera className="w-4 h-4 text-teal-400" />}
          {subtype === 'launch_program' && <Rocket className="w-4 h-4 text-orange-400" />}
          {subtype === 'window_close' && <XCircle className="w-4 h-4 text-rose-400" />}
          {subtype === 'close_program' && <Power className="w-4 h-4 text-amber-400" />}
          {subtype === 'kill_process' && <Ban className="w-4 h-4 text-rose-500" />}
          <h2 className="text-sm font-semibold text-slate-200">
            {isStart
              ? (isEn ? 'Start Node Properties' : '시작 노드 속성')
              : isEnd
              ? (isEn ? 'End Node Properties' : '끝 노드 속성')
              : isAgent
              ? (isEn ? 'Agent Properties' : '기본 에이전트 속성')
              : t('inspector.title')}
          </h2>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          title={t('common.close')}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* 노드 이름 */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">{t('inspector.nodeNameLabel')}</label>
          <input
            type="text"
            value={nodeData.label}
            onChange={(e) => handleLabelChange(e.target.value)}
            className="w-full px-3 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="border-t border-slate-800 pt-3">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-3">
            {isEn ? 'Action Parameters' : '세부 동작 파라미터'}
          </div>

          {/* 시작 노드 전용 안내 */}
          {isStart && (
            <div className="p-3.5 bg-emerald-950/20 border border-emerald-900/50 rounded-xl space-y-2">
              <div className="flex items-center gap-2 text-emerald-400 font-semibold text-xs">
                <Play className="w-3.5 h-3.5 fill-current" />
                {isEn ? 'Workflow Start Node' : '워크플로우 시작 노드'}
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {isEn
                  ? 'Entry point of the workflow. Execution starts here and flows sequentially along edges.'
                  : '전체 자동화 워크플로우의 실행 진입점입니다. 모든 동작은 이 노드에서 출발하여 오른쪽 간선으로 연결된 다음 노드로 순차 실행됩니다.'}
              </p>
              <div className="text-[10px] text-emerald-400/90 bg-emerald-950/60 px-2.5 py-1.5 rounded-lg border border-emerald-800/50 font-medium">
                {isEn ? '🔒 Cannot delete start node for safety.' : '🔒 안전을 위해 이 노드는 삭제할 수 없습니다.'}
              </div>
            </div>
          )}

          {/* 끝 노드 전용 안내 */}
          {isEnd && (
            <div className="p-3.5 bg-rose-950/20 border border-rose-900/50 rounded-xl space-y-2">
              <div className="flex items-center gap-2 text-rose-400 font-semibold text-xs">
                <Flag className="w-3.5 h-3.5" />
                {isEn ? 'Workflow End Node' : '워크플로우 끝 노드'}
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {isEn
                  ? 'Exit point of the workflow. Reaching this node marks successful workflow completion.'
                  : '전체 자동화 워크플로우의 실행 종료점입니다. 시작 노드에서 출발한 흐름이 이 노드에 도달하면 워크플로우가 성공적으로 완료됩니다.'}
              </p>
              <div className="text-[10px] text-rose-400/90 bg-rose-950/60 px-2.5 py-1.5 rounded-lg border border-rose-800/50 font-medium">
                {isEn ? '🔒 Cannot delete end node for safety.' : '🔒 안전을 위해 이 노드는 삭제할 수 없습니다.'}
              </div>
            </div>
          )}

          {/* 마우스 클릭 노드 */}
          {subtype === 'mouse_click' && (
            <div className="space-y-3.5">
              {/* 클릭 모드 선택 (좌표 클릭 vs 오브젝트 클릭) */}
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">
                  {isEn ? 'Click Mode' : '클릭 방식 모드'}
                </label>
                <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-950 rounded-lg border border-slate-800">
                  <button
                    type="button"
                    onClick={() => handleConfigChange('click_mode', 'coordinate')}
                    className={`py-1 text-xs rounded-md font-medium transition-all ${
                      (cfg.click_mode || 'coordinate') === 'coordinate'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {isEn ? 'Coordinate' : '좌표 클릭'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleConfigChange('click_mode', 'object')}
                    className={`py-1 text-xs rounded-md font-medium transition-all ${
                      cfg.click_mode === 'object'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {isEn ? 'Object' : '오브젝트 클릭'}
                  </button>
                </div>
              </div>

              {/* 오브젝트 클릭 모드인 경우 */}
              {cfg.click_mode === 'object' ? (
                <div className="space-y-3">
                  {cfg.object_data ? (
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-blue-400 flex items-center gap-1">
                          <Crosshair className="w-3.5 h-3.5" />
                          {isEn ? 'Selected Object' : '선택된 오브젝트'}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={onOpenObjectPicker}
                            className="text-[10px] text-slate-400 hover:text-slate-200 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 transition-colors flex items-center gap-1"
                          >
                            <RotateCcw className="w-2.5 h-2.5" /> {isEn ? 'Reselect' : '다시 선택'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleConfigChange('object_data', null)}
                            className="text-[10px] text-red-400 hover:text-red-300 px-1.5 py-0.5 rounded bg-red-950/40 hover:bg-red-900/60 transition-colors"
                          >
                            {isEn ? 'Remove' : '제거'}
                          </button>
                        </div>
                      </div>

                      {/* 크롭된 이미지 썸네일 */}
                      <div className="rounded-lg bg-slate-900 border border-slate-800/80 p-2 flex items-center justify-center min-h-[70px] max-h-[110px] overflow-hidden">
                        {cfg.object_data.base64_image || cfg.object_data.image_url ? (
                          <img
                            src={cfg.object_data.base64_image || resolveImageUrl(cfg.object_data.image_url)}
                            alt="Object Template"
                            className="max-h-[90px] max-w-full object-contain rounded border border-slate-700/60 shadow"
                          />
                        ) : (
                          <div className="text-[10px] text-slate-500">{isEn ? 'No image' : '이미지 없음'}</div>
                        )}
                      </div>

                      {/* 오브젝트 이름 및 좌표 메타정보 */}
                      <div className="space-y-1">
                        <input
                          type="text"
                          value={cfg.object_data.name || ''}
                          onChange={(e) => {
                            const updatedObj = { ...cfg.object_data, name: e.target.value };
                            handleConfigChange('object_data', updatedObj);
                          }}
                          placeholder={isEn ? 'Object name' : '오브젝트 이름'}
                          className="w-full px-2 py-1 text-xs bg-slate-900 border border-slate-700 rounded text-slate-200"
                        />
                        <div className="flex justify-between text-[10px] text-slate-400 px-0.5 pt-0.5">
                          <span>{isEn ? 'Coords' : '좌표'}: ({cfg.object_data.x}, {cfg.object_data.y})</span>
                          <span>{isEn ? 'Size' : '크기'}: {cfg.object_data.width}×{cfg.object_data.height}px</span>
                        </div>
                      </div>

                      {/* UIA 메타데이터 요약 */}
                      {(cfg.object_data.control_type || cfg.object_data.window_title) && (
                        <div className="p-2 bg-slate-900/80 rounded-lg border border-slate-800 text-[10px] space-y-1">
                          {cfg.object_data.control_type && (
                            <div className="flex items-center justify-between text-slate-300">
                              <span className="text-slate-400">{isEn ? 'UIA Type:' : 'UIA 타입:'}</span>
                              <span className="font-mono text-blue-400">{cfg.object_data.control_type}</span>
                            </div>
                          )}
                          {cfg.object_data.window_title && (
                            <div className="flex items-center justify-between text-slate-300">
                              <span className="text-slate-400">{isEn ? 'Target Window:' : '대상 윈도우:'}</span>
                              <span className="truncate max-w-[150px] text-slate-200" title={cfg.object_data.window_title}>
                                {cfg.object_data.window_title}
                              </span>
                            </div>
                          )}
                          {cfg.object_data.automation_id && (
                            <div className="flex items-center justify-between text-slate-300">
                              <span className="text-slate-400">{isEn ? 'Automation ID:' : '자동화 ID:'}</span>
                              <span className="font-mono text-purple-300 truncate max-w-[150px]">
                                {cfg.object_data.automation_id}
                              </span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* 인식 방식 모드 (하이브리드 vs UIA vs 이미지) */}
                      <div className="pt-1 border-t border-slate-800">
                        <label className="text-[11px] text-slate-400 block mb-1">
                          {isEn ? 'Recognition Mode' : '인식 방식 (매칭 모드)'}
                        </label>
                        <div className="grid grid-cols-3 gap-1 p-0.5 bg-slate-900 rounded-lg border border-slate-800">
                          <button
                            type="button"
                            onClick={() => handleConfigChange('search_mode', 'hybrid')}
                            className={`py-1 text-[10px] rounded font-medium transition-all ${
                              (cfg.search_mode || 'hybrid') === 'hybrid'
                                ? 'bg-blue-600 text-white shadow-xs'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {isEn ? 'Hybrid' : '하이브리드'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleConfigChange('search_mode', 'uia_only')}
                            className={`py-1 text-[10px] rounded font-medium transition-all ${
                              cfg.search_mode === 'uia_only'
                                ? 'bg-blue-600 text-white shadow-xs'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {isEn ? 'UIA Object' : 'UIA 객체'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleConfigChange('search_mode', 'image_only')}
                            className={`py-1 text-[10px] rounded font-medium transition-all ${
                              cfg.search_mode === 'image_only'
                                ? 'bg-blue-600 text-white shadow-xs'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {isEn ? 'Image Match' : '이미지 일치'}
                          </button>
                        </div>
                        <div className="text-[10px] text-slate-400 mt-1 px-0.5">
                          {(cfg.search_mode || 'hybrid') === 'hybrid' && (
                            <span className="text-blue-300/90">
                              {isEn
                                ? '✨ Step 1 UIA Match ➔ Step 2 Image Match ➔ Step 3 Coords Fallback'
                                : '✨ 1단계 UIA 객체 일치 ➔ 2단계 이미지 매칭 ➔ 3단계 좌표 폴백'}
                            </span>
                          )}
                          {cfg.search_mode === 'uia_only' && (
                            <span className="text-slate-300">
                              {isEn
                                ? '🎯 Click by Windows UIA properties (Name, ID, Type)'
                                : '🎯 Windows UIA 객체 정보(Name, ID, 타입) 일치로만 클릭'}
                            </span>
                          )}
                          {cfg.search_mode === 'image_only' && (
                            <span className="text-slate-300">
                              {isEn
                                ? '🖼️ Click by OpenCV template image matching only'
                                : '🖼️ 화면 이미지(OpenCV 템플릿 매칭) 일치로만 클릭'}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* 매칭 신뢰도 슬라이더 (이미지 매칭 사용 시) */}
                      {cfg.search_mode !== 'uia_only' && (
                        <div className="pt-1 border-t border-slate-800">
                          <div className="flex justify-between text-[11px] text-slate-400">
                            <span>{isEn ? 'Image Match Confidence' : '이미지 매칭 유사도 (Confidence)'}</span>
                            <span className="font-mono text-blue-400">
                              {Math.round((cfg.confidence ?? 0.8) * 100)}%
                            </span>
                          </div>
                          <input
                            type="range"
                            min="0.5"
                            max="0.99"
                            step="0.05"
                            value={cfg.confidence ?? 0.8}
                            onChange={(e) => handleConfigChange('confidence', Number(e.target.value))}
                            className="w-full mt-1 accent-blue-500"
                          />
                        </div>
                      )}

                      {/* 미검출 시 원래 좌표 폴백 체크박스 */}
                      <div className="flex items-center gap-2 pt-1 border-t border-slate-800/60">
                        <input
                          type="checkbox"
                          id="fallback_to_coords"
                          checked={cfg.fallback_to_coords !== false}
                          onChange={(e) => handleConfigChange('fallback_to_coords', e.target.checked)}
                          className="rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-0 w-3.5 h-3.5"
                        />
                        <label htmlFor="fallback_to_coords" className="text-[11px] text-slate-400 cursor-pointer">
                          {isEn ? 'Fallback to coords if not found' : '오브젝트 미발견 시 원래 좌표로 폴백 클릭'}
                        </label>
                      </div>

                      {/* 대상 오브젝트 자동 활성화 및 포커싱/스크롤 이동 옵션 (하이브리드 및 UIA 모드) */}
                      {cfg.search_mode !== 'image_only' && (
                        <div className="flex items-start gap-2 pt-1 border-t border-slate-800/60">
                          <input
                            type="checkbox"
                            id="auto_focus_scroll"
                            checked={cfg.auto_focus_scroll !== false}
                            onChange={(e) => handleConfigChange('auto_focus_scroll', e.target.checked)}
                            className="mt-0.5 rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                          />
                          <div>
                            <label htmlFor="auto_focus_scroll" className="text-[11px] font-medium text-slate-300 cursor-pointer block">
                              {isEn ? 'Auto-activate & Scroll into View' : '자동 활성화 & 포커싱 (스크롤 자동 이동)'}
                            </label>
                            <p className="text-[10px] text-slate-500 leading-tight">
                              {isEn
                                ? 'Automatically scrolls to and focuses on off-screen elements'
                                : '스크롤 아래에 가려진 오브젝트 위치로 자동 스크롤 및 활성화 후 클릭'}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* 오브젝트 미선택 시 오브젝트 선택 버튼 */
                    <div className="p-3 bg-slate-950 rounded-xl border border-dashed border-slate-700 text-center space-y-2.5">
                      <p className="text-[11px] text-slate-400">
                        {isEn
                          ? 'No target UI object or image specified yet.'
                          : '클릭할 UI 오브젝트나 이미지가 아직 지정되지 않았습니다.'}
                      </p>
                      <button
                        type="button"
                        onClick={onOpenObjectPicker}
                        className="w-full py-2 px-3 rounded-lg text-xs font-semibold bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-md shadow-blue-500/20 flex items-center justify-center gap-1.5 transition-all"
                      >
                        <Crosshair className="w-3.5 h-3.5" />
                        {isEn ? 'Pick Object from Screen' : '오브젝트 선택'}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                /* 좌표 클릭 모드인 경우 기존 좌표 입력창 */
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] text-slate-400">{isEn ? 'X Coords (Empty: Current)' : 'X 좌표 (비우면 현재위치)'}</label>
                      <input
                        type="number"
                        placeholder={isEn ? 'Current' : '현재 위치'}
                        value={cfg.x ?? ''}
                        onChange={(e) => handleConfigChange('x', e.target.value ? Number(e.target.value) : null)}
                        className="w-full px-2.5 py-1 text-xs bg-slate-950 border border-slate-700 rounded text-slate-200 mt-1"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-400">{isEn ? 'Y Coords (Empty: Current)' : 'Y 좌표 (비우면 현재위치)'}</label>
                      <input
                        type="number"
                        placeholder={isEn ? 'Current' : '현재 위치'}
                        value={cfg.y ?? ''}
                        onChange={(e) => handleConfigChange('y', e.target.value ? Number(e.target.value) : null)}
                        className="w-full px-2.5 py-1 text-xs bg-slate-950 border border-slate-700 rounded text-slate-200 mt-1"
                      />
                    </div>
                  </div>
                  {/* 좌표 모드에서도 언제든 오브젝트 선택으로 전환할 수 있는 버튼 제공 */}
                  <button
                    type="button"
                    onClick={() => {
                      handleConfigChange('click_mode', 'object');
                      if (onOpenObjectPicker) onOpenObjectPicker();
                    }}
                    className="w-full py-1.5 px-3 rounded-lg text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Crosshair className="w-3.5 h-3.5 text-blue-400" />
                    {isEn ? 'Pick Object from Screen instead' : '화면에서 오브젝트 선택하여 지정'}
                  </button>
                </div>
              )}

              {/* 공통 마우스 버튼 및 횟수 설정 */}
              <div className="pt-1 border-t border-slate-800/80">
                <label className="text-[11px] text-slate-400">{isEn ? 'Mouse Button' : '마우스 버튼'}</label>
                <select
                  value={cfg.button || 'left'}
                  onChange={(e) => handleConfigChange('button', e.target.value)}
                  className="w-full px-2.5 py-1 text-xs bg-slate-950 border border-slate-700 rounded text-slate-200 mt-1"
                >
                  <option value="left">{isEn ? 'Left Click' : '왼쪽 클릭 (Left)'}</option>
                  <option value="right">{isEn ? 'Right Click' : '오른쪽 클릭 (Right)'}</option>
                  <option value="middle">{isEn ? 'Middle Click' : '휠 클릭 (Middle)'}</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] text-slate-400">{isEn ? 'Click Count' : '클릭 횟수'}</label>
                <select
                  value={cfg.clicks || 1}
                  onChange={(e) => handleConfigChange('clicks', Number(e.target.value))}
                  className="w-full px-2.5 py-1 text-xs bg-slate-950 border border-slate-700 rounded text-slate-200 mt-1"
                >
                  <option value={1}>{isEn ? 'Single Click (1)' : '1회 클릭 (Single)'}</option>
                  <option value={2}>{isEn ? 'Double Click (2)' : '더블 클릭 (Double)'}</option>
                </select>
              </div>

              {/* 마우스 이동 방식 및 소요 시간 */}
              <div className="pt-2 border-t border-slate-800/80 space-y-2">
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">{isEn ? 'Movement Style' : '마우스 이동 방식'}</label>
                  <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-950 rounded-lg border border-slate-800">
                    <button
                      type="button"
                      onClick={() => handleConfigChange('move_mode', 'instant')}
                      className={`py-1 text-xs rounded-md font-medium transition-all flex items-center justify-center gap-1 ${
                        (cfg.move_mode || 'instant') === 'instant'
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Zap className="w-3 h-3" />
                      {isEn ? 'Instant' : '즉시 (순간이동)'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleConfigChange('move_mode', 'smooth')}
                      className={`py-1 text-xs rounded-md font-medium transition-all flex items-center justify-center gap-1 ${
                        cfg.move_mode === 'smooth'
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Move className="w-3 h-3" />
                      {isEn ? 'Smooth Move' : '천천히 이동'}
                    </button>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1 px-0.5">
                    {(cfg.move_mode || 'instant') === 'instant' ? (
                      <span className="text-slate-400">{isEn ? '⚡ Jumps immediately to target and clicks.' : '⚡ 대상 위치로 순간이동하여 즉시 클릭합니다.'}</span>
                    ) : (
                      <span className="text-blue-300">{isEn ? '🌊 Glides smoothly to target before clicking.' : '🌊 대상 위치로 부드럽게 마우스를 이동한 후 클릭합니다.'}</span>
                    )}
                  </div>
                </div>

                {cfg.move_mode === 'smooth' && (
                  <div className="p-2.5 bg-slate-950 rounded-lg border border-slate-800 space-y-1.5">
                    <div className="flex justify-between items-center text-[11px] text-slate-400">
                      <span>{isEn ? 'Move Duration (sec)' : '마우스 이동 소요 시간 (초)'}</span>
                      <span className="font-mono text-blue-400">{cfg.duration ?? 0.2}{isEn ? 's' : '초'}</span>
                    </div>
                    <input
                      type="number"
                      step="0.1"
                      min="0.05"
                      max="10"
                      value={cfg.duration ?? 0.2}
                      onChange={(e) => handleConfigChange('duration', Math.max(0.05, Number(e.target.value)))}
                      className="w-full px-2.5 py-1 text-xs bg-slate-900 border border-slate-700 rounded text-slate-200 focus:outline-none focus:border-blue-500"
                    />
                    <div className="text-[10px] text-slate-500">
                      {isEn
                        ? 'Moves cursor slowly for apps that cannot detect rapid teleported clicks.'
                        : '일부 너무 빠른 입력을 받지 못하는 애플리케이션을 위해 천천히 커서를 이동시킵니다.'}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 마우스 이동 노드 */}
          {subtype === 'mouse_move' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-slate-400">{isEn ? 'Target X Coords' : '목표 X 좌표'}</label>
                  <input
                    type="number"
                    value={cfg.x ?? 500}
                    onChange={(e) => handleConfigChange('x', Number(e.target.value))}
                    className="w-full px-2.5 py-1 text-xs bg-slate-950 border border-slate-700 rounded text-slate-200 mt-1"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-400">{isEn ? 'Target Y Coords' : '목표 Y 좌표'}</label>
                  <input
                    type="number"
                    value={cfg.y ?? 500}
                    onChange={(e) => handleConfigChange('y', Number(e.target.value))}
                    className="w-full px-2.5 py-1 text-xs bg-slate-950 border border-slate-700 rounded text-slate-200 mt-1"
                  />
                </div>
              </div>
              <div>
                <label className="text-[11px] text-slate-400">{isEn ? 'Move Duration (sec)' : '이동 소요 시간 (초)'}</label>
                <input
                  type="number"
                  step="0.1"
                  value={cfg.duration ?? 0.2}
                  onChange={(e) => handleConfigChange('duration', Number(e.target.value))}
                  className="w-full px-2.5 py-1 text-xs bg-slate-950 border border-slate-700 rounded text-slate-200 mt-1"
                />
              </div>
            </div>
          )}

          {/* 키보드 입력 노드 */}
          {subtype === 'keyboard_type' && (
            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-slate-400">{isEn ? 'Text to Type' : '입력할 텍스트'}</label>
                <textarea
                  rows={3}
                  value={cfg.text || ''}
                  onChange={(e) => handleConfigChange('text', e.target.value)}
                  placeholder={isEn ? 'e.g. Hello {{username}}' : '예: 안녕하세요 {{username}}님'}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded text-slate-200 mt-1 focus:outline-none focus:border-emerald-500"
                />
                <div className="text-[10px] text-slate-500 mt-1 flex items-center gap-1">
                  <HelpCircle className="w-3 h-3" />
                  {isEn
                    ? 'Use {{variable}} to reference output data from preceding nodes.'
                    : '{{변수명}}을 통해 이전 노드의 출력 데이터를 참조할 수 있습니다.'}
                </div>
              </div>

              {/* 입력 방식 및 소요 시간/자모 설정 */}
              <div className="pt-2 border-t border-slate-800/80 space-y-2">
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">{isEn ? 'Typing Style' : '입력 방식'}</label>
                  <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-950 rounded-lg border border-slate-800">
                    <button
                      type="button"
                      onClick={() => handleConfigChange('type_mode', 'instant')}
                      className={`py-1 text-xs rounded-md font-medium transition-all flex items-center justify-center gap-1 ${
                        (cfg.type_mode || 'instant') === 'instant'
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Zap className="w-3 h-3" />
                      {isEn ? 'Instant (Paste)' : '즉시 (붙여넣기)'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleConfigChange('type_mode', 'smooth')}
                      className={`py-1 text-xs rounded-md font-medium transition-all flex items-center justify-center gap-1 ${
                        cfg.type_mode === 'smooth'
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Keyboard className="w-3 h-3" />
                      {isEn ? 'Smooth Typing' : '천천히 입력'}
                    </button>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1 px-0.5">
                    {(cfg.type_mode || 'instant') === 'instant' ? (
                      <span className="text-slate-400">
                        {isEn
                          ? '⚡ Pastes text immediately via clipboard (fastest & 100% reliable).'
                          : '⚡ 클립보드를 통해 한 번에 즉시 입력합니다. (가장 빠르고 한글/특수문자 100% 안전)'}
                      </span>
                    ) : (
                      <span className="text-emerald-300">
                        {isEn
                          ? '⌨️ Simulates keystrokes one character at a time.'
                          : '⌨️ 실제 키보드를 타이핑하듯 한 글자씩 부드럽게 입력합니다.'}
                      </span>
                    )}
                  </div>
                </div>

                {cfg.type_mode === 'smooth' && (
                  <div className="p-2.5 bg-slate-950 rounded-lg border border-slate-800 space-y-2.5">
                    <div>
                      <div className="flex justify-between items-center text-[11px] text-slate-400">
                        <span>{isEn ? 'Key Interval (sec)' : '글자 간 입력 간격 (초)'}</span>
                        <span className="font-mono text-emerald-400">{cfg.interval ?? 0.05}{isEn ? 's' : '초'}</span>
                      </div>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        max="2"
                        value={cfg.interval ?? 0.05}
                        onChange={(e) => handleConfigChange('interval', Math.max(0.005, Number(e.target.value)))}
                        className="w-full px-2.5 py-1 text-xs bg-slate-900 border border-slate-700 rounded text-slate-200 focus:outline-none focus:border-emerald-500 mt-1"
                      />
                      <div className="text-[10px] text-slate-500 mt-1">
                        {isEn
                          ? 'Delay between keystrokes in seconds. (e.g. 0.05 = 50ms)'
                          : '글자(또는 자모)마다 키를 누르고 대기할 시간입니다. (예: 0.05 = 50ms)'}
                      </div>
                    </div>

                    {/* 한글 자모 순서 타이핑 옵션 */}
                    <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          id="decompose_korean"
                          checked={cfg.decompose_korean !== false}
                          onChange={(e) => handleConfigChange('decompose_korean', e.target.checked)}
                          className="mt-0.5 rounded border-slate-700 bg-slate-900 text-emerald-600 focus:ring-0 w-3.5 h-3.5"
                        />
                        <label htmlFor="decompose_korean" className="text-[11px] text-slate-300 cursor-pointer">
                          {isEn ? 'Type Korean syllables sequentially' : '한글 자모 순서로 타이핑'}
                        </label>
                      </div>
                      <div className="text-[10px] text-slate-400 pl-5.5 leading-relaxed">
                        {cfg.decompose_korean !== false ? (
                          <>
                            <div className="text-emerald-400/90 font-mono">
                              {isEn ? 'e.g. "자동화" ➔ ㅈ-ㅏ-ㄷ-ㅗ-ㅇ-ㅎ-ㅗ-ㅏ' : '예: \'자동화\' ➔ ㅈ-ㅏ-ㄷ-ㅗ-ㅇ-ㅎ-ㅗ-ㅏ (2벌식 키)'}
                            </div>
                            <div className="text-slate-500 mt-0.5">
                              {isEn
                                ? '⚠️ Note: Requires target window IME set to Korean.'
                                : '⚠️ 주의: 대상 창의 입력 모드가 \'한글\' 상태여야 정상 조합됩니다. 영문 상태일 경우 영문 자판(wkedghk)으로 입력될 수 있습니다.'}
                            </div>
                          </>
                        ) : (
                          <span className="text-slate-500">
                            {isEn
                              ? 'Safely enters whole characters one by one via clipboard.'
                              : '한글도 글자 단위(\'자\' ➔ \'동\' ➔ \'화\')로 클립보드를 통해 한 글자씩 안전하게 입력합니다.'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 단축키 노드 */}
          {subtype === 'keyboard_hotkey' && (
            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-slate-400">
                  {isEn ? 'Shortcut Combination (plus-separated)' : '단축키 조합 (더하기 기호로 구분)'}
                </label>
                <input
                  type="text"
                  value={cfg.keys || 'ctrl+c'}
                  onChange={(e) => handleConfigChange('keys', e.target.value)}
                  placeholder={isEn ? 'ctrl+c, ctrl+v, enter, etc.' : 'ctrl+c, ctrl+v, enter 등'}
                  className="w-full px-2.5 py-1 text-xs bg-slate-950 border border-slate-700 rounded text-slate-200 mt-1"
                />
              </div>
            </div>
          )}

          {/* 대기 노드 (수동 대기 & 동적 대기 고도화) */}
          {subtype === 'delay' && (
            <div className="space-y-3.5">
              {/* 대기 모드 On/Off 토글 (수동 고정 대기 vs 동적 로딩 대기) */}
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">
                  {isEn ? 'Wait Mode' : '대기 방식'}
                </label>
                <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-950 rounded-lg border border-slate-800">
                  <button
                    type="button"
                    onClick={() => handleConfigChange('dynamic_wait', false)}
                    className={`py-1 text-xs rounded-md font-medium transition-all flex items-center justify-center gap-1 ${
                      !cfg.dynamic_wait
                        ? 'bg-amber-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Clock className="w-3 h-3" />
                    {isEn ? 'Fixed Delay' : '수동 고정 대기'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleConfigChange('dynamic_wait', true)}
                    className={`py-1 text-xs rounded-md font-medium transition-all flex items-center justify-center gap-1 ${
                      cfg.dynamic_wait
                        ? 'bg-amber-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Zap className="w-3 h-3" />
                    {isEn ? 'Dynamic Wait (Load Detection)' : '동적 대기 (로딩 감지)'}
                  </button>
                </div>
                <div className="text-[10px] text-slate-400 mt-1 px-0.5">
                  {!cfg.dynamic_wait ? (
                    <span className="text-slate-400">
                      {isEn ? '⏱️ Pause unconditionally for specified duration before next node.' : '⏱️ 설정한 대기 시간만큼 무조건 일시 정지 후 다음 노드로 진행합니다.'}
                    </span>
                  ) : (
                    <span className="text-amber-300">
                      {isEn ? '⚡ Finish waiting immediately once UI element or app loading completes.' : '⚡ UI 요소 또는 앱의 로딩이 완료되면 즉시 대기를 끝내고 다음 노드를 실행합니다.'}
                    </span>
                  )}
                </div>
              </div>

              {/* 1. 수동 고정 대기 모드 설정 */}
              {!cfg.dynamic_wait && (
                <div>
                  <label className="text-[11px] text-slate-400">
                    {isEn ? 'Delay Duration (sec)' : '대기 시간 (초)'}
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={cfg.seconds ?? 1.0}
                    onChange={(e) => handleConfigChange('seconds', Number(e.target.value))}
                    className="w-full px-2.5 py-1 text-xs bg-slate-950 border border-slate-700 rounded text-slate-200 mt-1 focus:outline-none focus:border-amber-500"
                  />
                  <div className="text-[10px] text-slate-500 mt-1">
                    {isEn ? 'Fixed duration to pause the process. (e.g. 1.0 = 1 sec)' : '프로세스가 일시 정지될 고정 시간입니다. (예: 1.0 = 1초)'}
                  </div>
                </div>
              )}

              {/* 2. 동적 대기 모드 상세 설정 */}
              {cfg.dynamic_wait && (
                <div className="space-y-3.5">
                  {/* 동적 대기 2가지 모드 선택 (부분로딩 vs 완전로딩) */}
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">
                      {isEn ? 'Dynamic Wait Condition Mode' : '동적 대기 조건 모드'}
                    </label>
                    <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-950 rounded-lg border border-slate-800">
                      <button
                        type="button"
                        onClick={() => handleConfigChange('wait_mode', 'element')}
                        className={`py-1 text-xs rounded-md font-medium transition-all flex items-center justify-center gap-1 ${
                          (cfg.wait_mode || 'element') === 'element'
                            ? 'bg-amber-600 text-white shadow-sm'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <Crosshair className="w-3 h-3" />
                        {isEn ? 'Element Wait (Partial)' : '부분로딩 대기'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleConfigChange('wait_mode', 'window_ready')}
                        className={`py-1 text-xs rounded-md font-medium transition-all flex items-center justify-center gap-1 ${
                          cfg.wait_mode === 'window_ready'
                            ? 'bg-amber-600 text-white shadow-sm'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <Layers className="w-3 h-3" />
                        {isEn ? 'App Ready Wait (Full)' : '완전로딩 대기'}
                      </button>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1 px-0.5">
                      {(cfg.wait_mode || 'element') === 'element' ? (
                        <span className="text-amber-300">
                          {isEn
                            ? '🎯 Element Wait: Completes as soon as the selected UI object appears.'
                            : '🎯 부분로딩 대기: 선택한 UI 오브젝트만 화면에 나타나서 감지되면 대기 완료 처리합니다.'}
                        </span>
                      ) : (
                        <span className="text-sky-300">
                          {isEn
                            ? '🪟 App Ready: Completes once the entire window/app finishes loading and input is idle.'
                            : '🪟 완전로딩 대기: 선택한 오브젝트가 속한 창/앱 전체의 로딩 및 블로킹(응답 없음 해소 및 InputIdle)이 끝나면 대기 완료 처리합니다.'}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 감지 대상 UI 오브젝트 선택 카드 */}
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">
                      {isEn ? 'Target UI Object to Detect' : '감지 대상 UI 오브젝트'}
                    </label>
                    {cfg.object_data ? (
                      <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-amber-400 flex items-center gap-1">
                            <Crosshair className="w-3.5 h-3.5" />
                            {isEn ? 'Selected Target' : '선택된 감지 대상'}
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={onOpenObjectPicker}
                              className="text-[10px] text-slate-400 hover:text-slate-200 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 transition-colors flex items-center gap-1"
                            >
                              <RotateCcw className="w-3 h-3" />
                              {isEn ? 'Reselect' : '재선택'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleConfigChange('object_data', null)}
                              className="text-[10px] text-rose-400 hover:text-rose-300 px-1 py-0.5 rounded hover:bg-rose-950/40 transition-colors"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        <div className="flex items-start gap-2.5">
                          {(cfg.object_data.image_url || cfg.object_data.base64_image) ? (
                            <img
                              src={cfg.object_data.image_url ? resolveImageUrl(cfg.object_data.image_url) : cfg.object_data.base64_image}
                              alt={isEn ? "Object" : "오브젝트"}
                              className="w-16 h-12 object-contain bg-slate-900 rounded border border-slate-700/80 shrink-0"
                            />
                          ) : (
                            <div className="w-16 h-12 bg-slate-900 rounded border border-slate-800 flex items-center justify-center shrink-0">
                              <Crosshair className="w-5 h-5 text-slate-600" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-slate-200 truncate">
                              {cfg.object_data.name || (isEn ? 'Selected Control' : '선택된 컨트롤')}
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                              {isEn ? 'Window: ' : '창: '}{cfg.object_data.window_title || (isEn ? 'Full Screen' : '전체 화면')}
                            </div>
                            {cfg.object_data.control_type && (
                              <div className="text-[9px] text-amber-400/80 font-mono mt-0.5">
                                Type: {cfg.object_data.control_type}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 bg-slate-950 rounded-xl border border-dashed border-slate-800 text-center">
                        <p className="text-[11px] text-slate-400 mb-2">
                          {isEn ? 'Specify a UI element to detect completion' : '로딩 완료를 감지할 대상 UI 요소를 지정하세요'}
                        </p>
                        <button
                          type="button"
                          onClick={onOpenObjectPicker}
                          className="w-full py-1.5 px-3 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <Crosshair className="w-3.5 h-3.5" />
                          {isEn ? 'Pick Object from Screen' : '화면에서 오브젝트 선택'}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* 최대 대기 시간 (Timeout) */}
                  <div>
                    <div className="flex justify-between items-center text-[11px] text-slate-400">
                      <span>{isEn ? 'Max Wait Timeout (sec)' : '최대 대기 시간 (타임아웃, 초)'}</span>
                      <span className="font-mono text-amber-400">{cfg.seconds ?? 5.0}{isEn ? 's' : '초'}</span>
                    </div>
                    <input
                      type="number"
                      step="0.5"
                      min="0.1"
                      value={cfg.seconds ?? 5.0}
                      onChange={(e) => handleConfigChange('seconds', Number(e.target.value))}
                      className="w-full px-2.5 py-1 text-xs bg-slate-950 border border-slate-700 rounded text-slate-200 mt-1 focus:outline-none focus:border-amber-500"
                    />
                    <div className="text-[10px] text-slate-500 mt-1">
                      {isEn
                        ? 'Passes immediately if loading finishes within this time; times out if exceeded.'
                        : '이 시간 이내에 로딩이 완료되면 즉시 통과하며, 초과 시 타임아웃 처리됩니다.'}
                    </div>
                  </div>

                  {/* 타임아웃 발생 시 동작 (오류 중단 vs 다음 노드 진행) */}
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">
                      {isEn ? 'Action on Timeout' : '타임아웃 초과 시 동작'}
                    </label>
                    <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-950 rounded-lg border border-slate-800">
                      <button
                        type="button"
                        onClick={() => handleConfigChange('fail_on_timeout', true)}
                        className={`py-1 text-xs rounded-md font-medium transition-all flex items-center justify-center gap-1 ${
                          cfg.fail_on_timeout !== false
                            ? 'bg-rose-600 text-white shadow-sm'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <AlertTriangle className="w-3 h-3" />
                        {isEn ? 'Fail & Stop' : '오류로 중단 (실패)'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleConfigChange('fail_on_timeout', false)}
                        className={`py-1 text-xs rounded-md font-medium transition-all flex items-center justify-center gap-1 ${
                          cfg.fail_on_timeout === false
                            ? 'bg-emerald-600 text-white shadow-sm'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        {isEn ? 'Continue Next Node' : '다음 노드 계속 진행'}
                      </button>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1 px-0.5">
                      {cfg.fail_on_timeout !== false ? (
                        <span className="text-rose-400">
                          {isEn ? '🛑 Stops workflow with an error if timeout is reached.' : '🛑 최대 대기 시간을 초과하면 오류를 발생시키고 워크플로우 실행을 중단합니다.'}
                        </span>
                      ) : (
                        <span className="text-emerald-400">
                          {isEn ? '⏭️ Continues to next node even if timeout is reached.' : '⏭️ 최대 대기 시간을 초과해도 워크플로우를 중단하지 않고 그 다음 노드를 계속 실행합니다.'}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 추가 안정 지연 시간 (초) */}
                  <div className="pt-2 border-t border-slate-800/80">
                    <div className="flex justify-between items-center text-[11px] text-slate-400">
                      <span>{isEn ? 'Post-detection Settle Delay (sec)' : '감지 완료 후 추가 안정 대기 (초)'}</span>
                      <span className="font-mono text-slate-300">{cfg.post_delay ?? 0}{isEn ? 's' : '초'}</span>
                    </div>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="10"
                      value={cfg.post_delay ?? 0}
                      onChange={(e) => handleConfigChange('post_delay', Math.max(0, Number(e.target.value)))}
                      className="w-full px-2.5 py-1 text-xs bg-slate-950 border border-slate-700 rounded text-slate-200 mt-1 focus:outline-none focus:border-amber-500"
                    />
                    <div className="text-[10px] text-slate-500 mt-1">
                      {isEn
                        ? 'Buffer delay after detection for UI rendering stabilization. (Recommended: 0 ~ 0.5s)'
                        : '오브젝트나 창이 감지된 직후 안정적인 렌더링을 위해 추가로 머무를 여유 시간입니다. (권장 0 ~ 0.5초)'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 클립보드 복사 노드 */}
          {subtype === 'clipboard_copy' && (
            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-slate-400">
                  {isEn ? 'Text to Copy to Clipboard' : '클립보드에 복사할 텍스트'}
                </label>
                <textarea
                  rows={2}
                  value={cfg.text || ''}
                  onChange={(e) => handleConfigChange('text', e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded text-slate-200 mt-1"
                />
              </div>
            </div>
          )}

          {/* 윈도우 / 창 제어 노드 (창 활성화, 창 최대화, 창 최소화, 창 닫기) */}
          {(subtype === 'window_activate' || subtype === 'window_maximize' || subtype === 'window_minimize' || subtype === 'window_close') && (
            <div className="space-y-3.5">
              {/* 노드 동작 안내 배지 */}
              <div className="p-2.5 rounded-lg bg-sky-950/40 border border-sky-800/50 flex items-start gap-2">
                {subtype === 'window_activate' && <AppWindow className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />}
                {subtype === 'window_maximize' && <Maximize2 className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />}
                {subtype === 'window_minimize' && <Minimize2 className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />}
                {subtype === 'window_close' && <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />}
                <div className="text-[11px] leading-relaxed">
                  {subtype === 'window_activate' && (
                    <>
                      <span className="font-semibold text-sky-300">
                        {isEn ? 'Activate & Focus Window: ' : '창 활성화 & 포커스: '}
                      </span>
                      <span className="text-slate-300">
                        {isEn
                          ? 'Brings the target window to the foreground and gives it focus. Minimized windows are automatically restored.'
                          : '선택한 UI 요소가 속한 창이나 지정한 프로그램 윈도우를 맨 앞으로 가져오고 포커스를 잡습니다. 최소화되어 있는 창도 자동으로 복원(Restore)합니다.'}
                      </span>
                    </>
                  )}
                  {subtype === 'window_maximize' && (
                    <>
                      <span className="font-semibold text-cyan-300">
                        {isEn ? 'Maximize Window: ' : '창 최대화: '}
                      </span>
                      <span className="text-slate-300">
                        {isEn
                          ? 'Expands the target window to full screen. (Equivalent to clicking the maximize button)'
                          : '대상 윈도우를 현재 모니터 화면 전체 크기로 확장합니다. (우상단 \'ㅁ\' 최대화 버튼 효과)'}
                      </span>
                    </>
                  )}
                  {subtype === 'window_minimize' && (
                    <>
                      <span className="font-semibold text-slate-300">
                        {isEn ? 'Minimize Window: ' : '창 최소화: '}
                      </span>
                      <span className="text-slate-300">
                        {isEn
                          ? 'Minimizes the target window to the taskbar. (Equivalent to clicking the minimize button)'
                          : '대상 윈도우를 작업표시줄로 내려 화면에서 가려버립니다. (우상단 \'-\' 최소화 버튼 효과)'}
                      </span>
                    </>
                  )}
                  {subtype === 'window_close' && (
                    <>
                      <span className="font-semibold text-rose-400">
                        {isEn ? 'Close Window: ' : '창 닫기: '}
                      </span>
                      <span className="text-slate-300">
                        {isEn
                          ? 'Safely closes the target window or currently active window. (Equivalent to clicking \'✕\', supports save prompts)'
                          : '지정한 창이나 실행 시점의 현재 활성 창을 안전하게 닫습니다. (우상단 \'✕\' 닫기 버튼 효과, 저장 확인 팝업 지원)'}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* 대상 창 식별 모드 선택 */}
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">
                  {isEn ? 'Target Window Identification Method' : '대상 창 식별 방식'}
                </label>
                <div className={`grid ${subtype === 'window_activate' ? 'grid-cols-2' : 'grid-cols-3'} gap-1 p-1 bg-slate-950 rounded-lg border border-slate-800`}>
                  <button
                    type="button"
                    onClick={() => handleConfigChange('target_mode', 'object')}
                    className={`py-1 text-xs rounded-md font-medium transition-all ${
                      (cfg.target_mode || 'object') === 'object'
                        ? 'bg-sky-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {isEn ? 'By Object' : '오브젝트 기준'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleConfigChange('target_mode', 'title')}
                    className={`py-1 text-xs rounded-md font-medium transition-all ${
                      cfg.target_mode === 'title'
                        ? 'bg-sky-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {isEn ? 'By Window Title' : '창 제목 입력'}
                  </button>
                  {subtype !== 'window_activate' && (
                    <button
                      type="button"
                      onClick={() => handleConfigChange('target_mode', 'current')}
                      className={`py-1 text-xs rounded-md font-medium transition-all ${
                        cfg.target_mode === 'current'
                          ? 'bg-sky-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {isEn ? 'Current Active Window' : '현재 활성 창'}
                    </button>
                  )}
                </div>
                <div className="text-[10px] text-slate-400 mt-1 px-0.5">
                  {(cfg.target_mode || 'object') === 'object' && (
                    <span className="text-sky-300">
                      {isEn
                        ? '🎯 Pick an element with the Object Picker to accurately pinpoint that window. (Recommended for multiple browser windows)'
                        : '🎯 오브젝트 선택기로 원하는 창의 요소를 클릭하여 해당 창을 정확하게 특정합니다. (다중 브라우저 창 권장)'}
                    </span>
                  )}
                  {cfg.target_mode === 'title' && (
                    <span className="text-slate-400">
                      {isEn
                        ? '🪟 Searches based on the window title text (contains / exact match).'
                        : '🪟 윈도우 제목 표시줄 텍스트(부분 일치/정확 일치)를 기준으로 탐색합니다.'}
                    </span>
                  )}
                  {cfg.target_mode === 'current' && (
                    <span className="text-slate-400">
                      {isEn
                        ? '⚡ Controls the foreground window currently focused when executed.'
                        : '⚡ 현재 전면에 포커스되어 있는 활성 창(Foreground Window)을 즉시 제어합니다.'}
                    </span>
                  )}
                </div>
              </div>

              {/* 1. 오브젝트 기준 타겟팅 모드 */}
              {(cfg.target_mode || 'object') === 'object' && (
                <div className="space-y-3">
                  {cfg.object_data ? (
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-sky-400 flex items-center gap-1">
                          <Crosshair className="w-3.5 h-3.5" />
                          {isEn ? 'Selected Target Object' : '선택된 기준 오브젝트'}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={onOpenObjectPicker}
                            className="text-[10px] text-slate-400 hover:text-slate-200 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 transition-colors flex items-center gap-1"
                          >
                            <RotateCcw className="w-2.5 h-2.5" /> {isEn ? 'Reselect' : '다시 선택'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleConfigChange('object_data', null)}
                            className="text-[10px] text-red-400 hover:text-red-300 px-1.5 py-0.5 rounded bg-red-950/40 hover:bg-red-900/60 transition-colors"
                          >
                            {isEn ? 'Remove' : '제거'}
                          </button>
                        </div>
                      </div>

                      {/* 썸네일 */}
                      <div className="rounded-lg bg-slate-900 border border-slate-800/80 p-2 flex items-center justify-center min-h-[60px] max-h-[90px] overflow-hidden">
                        {cfg.object_data.base64_image || cfg.object_data.image_url ? (
                          <img
                            src={cfg.object_data.base64_image || resolveImageUrl(cfg.object_data.image_url)}
                            alt="Target Object"
                            className="max-h-[80px] max-w-full object-contain rounded border border-slate-700/60 shadow"
                          />
                        ) : (
                          <div className="text-[10px] text-slate-500">{isEn ? 'No preview' : '이미지 없음'}</div>
                        )}
                      </div>

                      {/* 오브젝트 명칭 및 상위 윈도우 메타정보 */}
                      <div className="space-y-1.5 text-[11px]">
                        <div className="flex items-center justify-between text-slate-300">
                          <span className="text-slate-400">{isEn ? 'Object:' : '오브젝트:'}</span>
                          <span className="font-medium text-slate-200 truncate max-w-[170px]" title={cfg.object_data.name}>
                            {cfg.object_data.name}
                          </span>
                        </div>
                        {cfg.object_data.window_title && (
                          <div className="flex items-center justify-between text-slate-300">
                            <span className="text-slate-400">{isEn ? 'Target Window:' : '대상 윈도우:'}</span>
                            <span className="font-semibold text-sky-300 truncate max-w-[170px]" title={cfg.object_data.window_title}>
                              {cfg.object_data.window_title}
                            </span>
                          </div>
                        )}
                        {cfg.object_data.control_type && (
                          <div className="flex items-center justify-between text-slate-300">
                            <span className="text-slate-400">{isEn ? 'UIA Type:' : 'UIA 타입:'}</span>
                            <span className="font-mono text-[10px] text-blue-400">{cfg.object_data.control_type}</span>
                          </div>
                        )}
                      </div>

                      <div className="p-2 bg-sky-950/30 rounded-lg border border-sky-900/40 text-[10px] text-sky-300/90 leading-tight">
                        {isEn
                          ? '✨ Automatically targets and controls the top-level window hosting this object at runtime.'
                          : '✨ 실행 시 이 오브젝트가 속한 최상위 윈도우를 실시간으로 특정하여 조작합니다.'}
                      </div>
                    </div>
                  ) : (
                    /* 오브젝트 미선택 시 */
                    <div className="p-3 bg-slate-950 rounded-xl border border-dashed border-slate-700 text-center space-y-2.5">
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        {isEn
                          ? 'Select any UI element (button, tab, content) inside the window you want to control.'
                          : '제어하고자 하는 창 안의 아무 UI 요소(버튼, 탭, 본문 등)를 선택해 주세요.'}
                      </p>
                      <button
                        type="button"
                        onClick={onOpenObjectPicker}
                        className="w-full py-2 px-3 rounded-lg text-xs font-semibold bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 text-white shadow-md shadow-sky-500/20 flex items-center justify-center gap-1.5 transition-all"
                      >
                        <Crosshair className="w-3.5 h-3.5" />
                        {isEn ? 'Pick Window Object from Screen' : '화면에서 대상 창 오브젝트 선택'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* 2. 창 제목 직접 입력 모드 */}
              {cfg.target_mode === 'title' && (
                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] text-slate-400">
                      {isEn ? 'Target Window Title' : '대상 창 제목 (Window Title)'}
                    </label>
                    <input
                      type="text"
                      value={cfg.window_title || ''}
                      onChange={(e) => handleConfigChange('window_title', e.target.value)}
                      placeholder={isEn ? 'e.g. Chrome, Notepad, Calculator' : '예: Chrome, 메모장, 계산기, 네이버'}
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded text-slate-200 mt-1 focus:outline-none focus:border-sky-500"
                    />
                    <div className="text-[10px] text-slate-500 mt-1 flex items-center gap-1">
                      <HelpCircle className="w-3 h-3" />
                      {isEn ? 'Dynamic window titles supported via {{variable}}.' : '{{변수명}}을 통해 동적 창 제목을 지정할 수 있습니다.'}
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] text-slate-400">
                      {isEn ? 'Matching Mode' : '일치 방식 (매칭 모드)'}
                    </label>
                    <select
                      value={cfg.match_type || 'contains'}
                      onChange={(e) => handleConfigChange('match_type', e.target.value)}
                      className="w-full px-2.5 py-1 text-xs bg-slate-950 border border-slate-700 rounded text-slate-200 mt-1 focus:outline-none focus:border-sky-500"
                    >
                      <option value="contains">
                        {isEn ? 'Contains (Recommended - matches if keyword is present)' : '포함 (Contains - 권장: 창 제목에 단어가 포함되면 일치)'}
                      </option>
                      <option value="exact">
                        {isEn ? 'Exact Match (Window title must be identical)' : '정확히 일치 (Exact: 창 제목 전체가 같아야 함)'}
                      </option>
                      <option value="startswith">
                        {isEn ? 'Starts With (Window title starts with keyword)' : '시작 일치 (Starts With: 창 제목이 해당 단어로 시작)'}
                      </option>
                    </select>
                  </div>

                  {/* 브라우저 다중 창 식별 팁 배지 */}
                  <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-[10px] text-slate-400 space-y-1">
                    <div className="font-semibold text-sky-400 flex items-center gap-1">
                      {isEn ? '💡 Multi-Window Identification Tip' : '💡 브라우저 다중 창 식별 팁'}
                    </div>
                    <div className="leading-relaxed">
                      {isEn
                        ? 'When multiple browser windows (Chrome, Edge) are open, the title contains the active tab name (e.g. Google - Chrome). Entering unique tab keywords allows precise targeting.'
                        : <>Chrome이나 Edge 등 창이 여러 개 떠 있을 때는 현재 활성화된 탭 제목이 창 제목에 포함됩니다 (예: <span className="text-slate-300 font-mono">Google - Chrome</span>, <span className="text-slate-300 font-mono">네이버 - Chrome</span>). 특정 탭의 고유 키워드를 입력하면 원하는 특정 창만 정확히 골라 제어할 수 있습니다.</>}
                    </div>
                  </div>
                </div>
              )}

              {/* 3. 현재 활성 창 모드 안내 */}
              {cfg.target_mode === 'current' && (
                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-center space-y-1.5">
                  <div className="text-xs font-medium text-slate-300">
                    {isEn ? 'Target Foreground (Active) Window' : '현재 활성화된 창(Foreground Window) 대상'}
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {isEn
                      ? 'Controls the window that currently has focus when executed.'
                      : '실행 시점에 사용자가 포커스를 두고 있는 전면 윈도우를 즉시 조작합니다.'}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* 스크린샷 촬영 노드 */}
          {subtype === 'screenshot' && (
            <div className="space-y-4">
              {/* 1. 촬영 대상 선택 */}
              <div>
                <label className="text-[11px] text-slate-400 block mb-1.5 font-medium flex items-center gap-1.5">
                  <Monitor className="w-3.5 h-3.5 text-teal-400" />
                  {isEn ? 'Capture Target (Display)' : '촬영 대상 (모니터 선택)'}
                </label>
                <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-950 rounded-lg border border-slate-800">
                  <button
                    type="button"
                    onClick={() => handleConfigChange('capture_target', 'primary')}
                    className={`py-1.5 text-xs rounded-md font-medium transition-all flex items-center justify-center gap-1 ${
                      (cfg.capture_target || 'primary') === 'primary'
                        ? 'bg-teal-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {isEn ? 'Primary Display' : '주 모니터만'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleConfigChange('capture_target', 'all')}
                    className={`py-1.5 text-xs rounded-md font-medium transition-all flex items-center justify-center gap-1 ${
                      cfg.capture_target === 'all'
                        ? 'bg-teal-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {isEn ? 'All Displays' : '전체 모니터'}
                  </button>
                </div>
                <div className="text-[10px] text-slate-500 mt-1.5 leading-relaxed">
                  {cfg.capture_target === 'all'
                    ? (isEn ? '💡 Captures the combined virtual screen across all connected displays.' : '💡 연결된 모든 디스플레이(듀얼/다중 모니터)를 합친 전체 가상 영역을 캡처합니다.')
                    : (isEn ? '💡 Captures the primary display screen area of the Windows system.' : '💡 현재 Windows 시스템의 기본(주) 디스플레이 화면 영역을 캡처합니다.')}
                </div>
              </div>

              {/* 2. 스크린샷 저장 방식 선택 (체크박스 다중 선택 지원) */}
              <div className="border-t border-slate-800/80 pt-3">
                <label className="text-[11px] text-slate-400 block mb-2 font-medium flex items-center gap-1.5">
                  <Camera className="w-3.5 h-3.5 text-teal-400" />
                  {isEn ? 'Storage Method (Multi-select)' : '저장 방식 (다중 선택 가능)'}
                </label>
                <div className="space-y-2">
                  {/* 클립보드로 복사 체크박스 */}
                  <label className="flex items-start gap-2.5 p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 hover:border-slate-700 cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={!!cfg.copy_to_clipboard}
                      onChange={(e) => handleConfigChange('copy_to_clipboard', e.target.checked)}
                      className="mt-0.5 rounded border-slate-700 bg-slate-900 text-teal-500 focus:ring-teal-500/20"
                    />
                    <div className="flex-1">
                      <div className="text-xs font-medium text-slate-200 flex items-center gap-1.5">
                        <Copy className="w-3.5 h-3.5 text-teal-400" />
                        {isEn ? 'Copy to Clipboard' : '클립보드로 복사'}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
                        {isEn
                          ? 'Copies captured image to Windows clipboard for immediate pasting (Ctrl+V) into other apps.'
                          : '캡처한 이미지를 Windows 클립보드에 복사하여 다른 앱에서 바로 붙여넣기(Ctrl+V)할 수 있습니다.'}
                      </div>
                    </div>
                  </label>

                  {/* 파일로 저장 체크박스 */}
                  <label className="flex items-start gap-2.5 p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 hover:border-slate-700 cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={cfg.save_to_file ?? true}
                      onChange={(e) => handleConfigChange('save_to_file', e.target.checked)}
                      className="mt-0.5 rounded border-slate-700 bg-slate-900 text-teal-500 focus:ring-teal-500/20"
                    />
                    <div className="flex-1">
                      <div className="text-xs font-medium text-slate-200 flex items-center gap-1.5">
                        <Save className="w-3.5 h-3.5 text-teal-400" />
                        {isEn ? 'Save to File' : '파일로 저장'}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
                        {isEn
                          ? 'Saves captured image as a local file (PNG, JPG, etc.).'
                          : '캡처한 이미지를 로컬 스토리지 파일(PNG, JPG 등)로 저장합니다.'}
                      </div>
                    </div>
                  </label>
                </div>

                {/* 저장 방식 미선택 경고 */}
                {!(cfg.save_to_file ?? true) && !cfg.copy_to_clipboard && (
                  <div className="mt-2.5 p-2 rounded-lg bg-amber-950/30 border border-amber-900/60 flex items-center gap-2 text-[11px] text-amber-400">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>{isEn ? 'Select at least one storage method (Save to file or Clipboard).' : '저장 방식(파일 저장 또는 클립보드)을 최소 1개 이상 선택해야 합니다.'}</span>
                  </div>
                )}
              </div>

              {/* 3. 파일 저장 경로 설정 (파일로 저장이 체크되어 있을 때 노출) */}
              {(cfg.save_to_file ?? true) && (
                <div className="border-t border-slate-800/80 pt-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] text-slate-400 font-medium">
                      {isEn ? 'Save File Path' : '저장 파일 경로'}
                    </label>
                    <button
                      type="button"
                      onClick={() => handleConfigChange('file_path', 'C:\\Screenshots\\screenshot_{{timestamp}}.png')}
                      className="text-[10px] text-teal-400 hover:text-teal-300 transition-colors"
                    >
                      {isEn ? 'Reset to Default' : '기본 경로 복원'}
                    </button>
                  </div>
                  <input
                    type="text"
                    value={cfg.file_path ?? 'C:\\Screenshots\\screenshot_{{timestamp}}.png'}
                    onChange={(e) => handleConfigChange('file_path', e.target.value)}
                    placeholder={isEn ? 'e.g. C:\\Screenshots\\shot_{{timestamp}}.png' : '예: C:\\Screenshots\\shot_{{timestamp}}.png'}
                    className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-teal-500 font-mono"
                  />
                  <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-[10px] text-slate-400 space-y-1">
                    <div className="font-semibold text-teal-400 flex items-center gap-1">
                      {isEn ? '💡 Path Template Placeholders' : '💡 경로 치환 플레이스홀더'}
                    </div>
                    <div className="space-y-0.5 leading-relaxed">
                      <div><code className="text-slate-300 font-mono">{'{{timestamp}}'}</code> : {isEn ? 'Current timestamp (' : '현재 일시 ('}<span className="text-slate-500">20261012_143000</span>)</div>
                      <div><code className="text-slate-300 font-mono">{'{{date}}'}</code> : {isEn ? 'Current date (' : '현재 날짜 ('}<span className="text-slate-500">20261012</span>)</div>
                      <div><code className="text-slate-300 font-mono">{'{{time}}'}</code> : {isEn ? 'Current time (' : '현재 시각 ('}<span className="text-slate-500">143000</span>)</div>
                      <div><code className="text-slate-300 font-mono">{'{{var_name}}'}</code> : {isEn ? 'Context variable from previous node' : '이전 노드의 context 변수'}</div>
                    </div>
                    <div className="text-slate-500 text-[9px] pt-1 border-t border-slate-800/60">
                      {isEn
                        ? '* Missing folders are created automatically. Format is inferred from extension (.png, .jpg, etc.).'
                        : '* 폴더가 없으면 자동 생성되며, 확장자(.png, .jpg, .webp 등)에 맞춰 포맷이 자동 결정됩니다.'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 프로그램 실행 노드 (Launch Program) */}
          {subtype === 'launch_program' && (
            <div className="space-y-3.5">
              {/* 실행 파일 경로 영역 */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] text-slate-400 font-medium flex items-center gap-1">
                    <Rocket className="w-3.5 h-3.5 text-orange-400" />
                    {isEn ? 'Executable Path' : '실행 파일 경로'} <span className="text-rose-400">*</span>
                  </label>
                  {cfg.program_path && (
                    <button
                      type="button"
                      onClick={() => {
                        handleConfigChange('program_path', '');
                        handleConfigChange('object_data', null);
                      }}
                      className="text-[10px] text-slate-500 hover:text-rose-400 transition-colors"
                    >
                      {isEn ? 'Clear' : '지우기'}
                    </button>
                  )}
                </div>

                {/* 텍스트 입력 필드 */}
                <input
                  type="text"
                  value={cfg.program_path || ''}
                  onChange={(e) => handleConfigChange('program_path', e.target.value)}
                  placeholder={isEn ? 'e.g. C:\\Windows\\notepad.exe, chrome.exe' : '예: C:\\Windows\\notepad.exe, chrome.exe'}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-orange-500 font-mono"
                />

                {/* 경로 선택 도구 버튼 2종 ([오브젝트 선택], [파일 찾아보기]) */}
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <button
                    type="button"
                    onClick={onOpenObjectPicker}
                    className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-sm transition-all"
                    title={isEn ? 'Extract executable path by clicking app window/icon' : '화면에서 실행 중인 앱 창이나 아이콘을 마우스로 클릭하여 실행 파일 경로 추출'}
                  >
                    <Crosshair className="w-3.5 h-3.5" />
                    {isEn ? 'Pick Object' : '오브젝트 선택'}
                  </button>
                  <button
                    type="button"
                    onClick={handleBrowseFile}
                    className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 hover:border-slate-600 transition-all"
                    title={isEn ? 'Select executable (.exe, .lnk) via Windows File Explorer' : 'Windows 파일 탐색기에서 직접 실행 파일(.exe, .lnk 등) 선택'}
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
                    {isEn ? 'Browse File' : '파일 찾아보기'}
                  </button>
                </div>
              </div>

              {/* 오브젝트 선택기로 추출된 메타데이터가 있을 때 안내 카드 */}
              {cfg.object_data && (
                <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 space-y-1.5 text-[11px]">
                  <div className="flex items-center justify-between text-blue-400 font-medium">
                    <span className="flex items-center gap-1">
                      <Crosshair className="w-3 h-3" />
                      {isEn ? 'Extracted Target Info' : '추출된 타겟 정보'}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleConfigChange('object_data', null)}
                      className="text-[10px] text-slate-500 hover:text-slate-300"
                    >
                      {isEn ? 'Clear' : '해제'}
                    </button>
                  </div>
                  {cfg.object_data.name && (
                    <div className="text-slate-300">
                      <span className="text-slate-500">{isEn ? 'Name:' : '이름:'}</span> {cfg.object_data.name}
                    </div>
                  )}
                  {cfg.object_data.window_title && (
                    <div className="text-slate-300 truncate" title={cfg.object_data.window_title}>
                      <span className="text-slate-500">{isEn ? 'Window:' : '윈도우:'}</span> {cfg.object_data.window_title}
                    </div>
                  )}
                  {cfg.object_data.image_url && (
                    <div className="mt-1 flex justify-center bg-slate-900 rounded p-1 border border-slate-800">
                      <img
                        src={cfg.object_data.base64_image || resolveImageUrl(cfg.object_data.image_url)}
                        alt="Target Preview"
                        className="max-h-12 object-contain rounded"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* 커맨드라인 실행 인자 (Arguments) */}
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">
                  {isEn ? 'Arguments (Optional)' : '실행 인자 (Arguments, 선택 사항)'}
                </label>
                <input
                  type="text"
                  value={cfg.arguments || ''}
                  onChange={(e) => handleConfigChange('arguments', e.target.value)}
                  placeholder={isEn ? 'e.g. --incognito, C:\\data\\file.txt, https://google.com' : '예: --incognito, C:\\data\\file.txt, https://naver.com'}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-orange-500 font-mono"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  {isEn ? 'Specify command line arguments, target files, or URLs.' : '프로그램 실행 시 전달할 커맨드라인 파라미터나 대상 파일/URL을 지정합니다.'}
                </p>
              </div>

              {/* 템플릿 변수 및 동작 안내 배지 */}
              <div className="p-2.5 bg-orange-950/20 border border-orange-900/40 rounded-xl space-y-1.5 text-[10px]">
                <div className="font-semibold text-orange-400 flex items-center gap-1">
                  <span>⚡</span> {isEn ? 'Immediate Background Launch' : '비동기 백그라운드 즉시 실행'}
                </div>
                <p className="text-slate-400 leading-relaxed">
                  {isEn ? 'Proceeds immediately to the next node once the program starts.' : '지정된 프로그램이 시작되면 기다리지 않고 즉시 다음 연결 노드를 이어서 실행합니다.'}
                </p>
                <div className="pt-1 border-t border-orange-900/30 text-slate-400">
                  {isEn ? (
                    <>Supports <span className="text-orange-300/90 font-mono">{'{{var_name}}'}</span> substitution to bind dynamic outputs to path and arguments.</>
                  ) : (
                    <><span className="text-orange-300/90 font-mono">{'{{변수명}}'}</span> 치환을 지원하여 이전 노드의 동적 결과값을 경로 및 인자에 바인딩할 수 있습니다.</>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 프로그램 정상 종료 노드 (Close Program) */}
          {subtype === 'close_program' && (
            <div className="space-y-3.5">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] text-slate-400 font-medium flex items-center gap-1">
                    <Power className="w-3.5 h-3.5 text-amber-400" />
                    {isEn ? 'Target Process Name' : '대상 프로그램 프로세스명'} <span className="text-rose-400">*</span>
                  </label>
                  {cfg.process_name && (
                    <button
                      type="button"
                      onClick={() => {
                        handleConfigChange('process_name', '');
                        handleConfigChange('object_data', null);
                      }}
                      className="text-[10px] text-slate-500 hover:text-rose-400 transition-colors"
                    >
                      {isEn ? 'Clear' : '지우기'}
                    </button>
                  )}
                </div>

                {/* 텍스트 입력 필드 */}
                <input
                  type="text"
                  value={cfg.process_name || ''}
                  onChange={(e) => handleConfigChange('process_name', e.target.value)}
                  placeholder={isEn ? 'e.g. notepad.exe, chrome.exe' : '예: notepad.exe, chrome.exe'}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-amber-500 font-mono"
                />

                {/* 오브젝트 선택기 버튼 */}
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={onOpenObjectPicker}
                    className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white shadow-sm transition-all"
                    title={isEn ? 'Extract process name by clicking target app window or UI' : '화면에서 대상 프로그램 창이나 UI 요소를 클릭하여 프로세스명 자동 추출'}
                  >
                    <Crosshair className="w-3.5 h-3.5" />
                    {isEn ? 'Extract Process Name with Picker' : '오브젝트 선택기로 프로세스명 추출'}
                  </button>
                </div>
              </div>

              {/* 오브젝트 선택기로 추출된 메타데이터가 있을 때 안내 카드 */}
              {cfg.object_data && (
                <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 space-y-1.5 text-[11px]">
                  <div className="flex items-center justify-between text-amber-400 font-medium">
                    <span className="flex items-center gap-1">
                      <Crosshair className="w-3 h-3" />
                      {isEn ? 'Extracted Target Info' : '추출된 타겟 정보'}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleConfigChange('object_data', null)}
                      className="text-[10px] text-slate-500 hover:text-slate-300"
                    >
                      {isEn ? 'Clear' : '해제'}
                    </button>
                  </div>
                  {cfg.object_data.name && (
                    <div className="text-slate-300">
                      <span className="text-slate-500">{isEn ? 'Element:' : '요소:'}</span> {cfg.object_data.name}
                    </div>
                  )}
                  {cfg.object_data.window_title && (
                    <div className="text-slate-300 truncate" title={cfg.object_data.window_title}>
                      <span className="text-slate-500">{isEn ? 'Window:' : '윈도우:'}</span> {cfg.object_data.window_title}
                    </div>
                  )}
                  {cfg.process_name && (
                    <div className="text-amber-300 font-mono text-[10px]">
                      <span className="text-slate-500">{isEn ? 'Process:' : '프로세스:'}</span> {cfg.process_name}
                    </div>
                  )}
                </div>
              )}

              {/* 소프트 클로징 및 가드레일 안내 배지 */}
              <div className="p-2.5 bg-amber-950/20 border border-amber-900/40 rounded-xl space-y-1.5 text-[10px]">
                <div className="font-semibold text-amber-400 flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                  {isEn ? 'Soft Close (Graceful Termination)' : '소프트 종료 (정상 종료 유도)'}
                </div>
                <p className="text-slate-400 leading-relaxed">
                  {isEn
                    ? 'Sends a close signal (WM_CLOSE) to allow application graceful shutdown (e.g. save prompts).'
                    : '프로세스 소유 창에 종료 신호(WM_CLOSE)를 전달하여, 문서 저장 확인 팝업 등 애플리케이션의 정상 종료 절차를 거치도록 유도합니다.'}
                </p>
                <div className="pt-1 border-t border-amber-900/30 text-amber-300/80">
                  {isEn
                    ? '🔒 Safety Guardrail: System & core Praxis Desktop processes cannot be terminated.'
                    : '🔒 안전 가드레일: 시스템 및 Praxis Desktop 핵심 프로세스는 안전을 위해 종료가 원천 차단됩니다.'}
                </div>
              </div>
            </div>
          )}

          {/* 프로세스 강제 종료 노드 (Kill Process) */}
          {subtype === 'kill_process' && (
            <div className="space-y-3.5">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] text-slate-400 font-medium flex items-center gap-1">
                    <Ban className="w-3.5 h-3.5 text-rose-400" />
                    {isEn ? 'Process Name to Kill' : '강제 종료할 프로세스명'} <span className="text-rose-400">*</span>
                  </label>
                  {cfg.process_name && (
                    <button
                      type="button"
                      onClick={() => {
                        handleConfigChange('process_name', '');
                        handleConfigChange('object_data', null);
                      }}
                      className="text-[10px] text-slate-500 hover:text-rose-400 transition-colors"
                    >
                      {isEn ? 'Clear' : '지우기'}
                    </button>
                  )}
                </div>

                {/* 텍스트 입력 필드 */}
                <input
                  type="text"
                  value={cfg.process_name || ''}
                  onChange={(e) => handleConfigChange('process_name', e.target.value)}
                  placeholder={isEn ? 'e.g. notepad.exe, chrome.exe' : '예: notepad.exe, chrome.exe'}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-rose-500 font-mono"
                />

                {/* 오브젝트 선택기 버튼 */}
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={onOpenObjectPicker}
                    className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white shadow-sm transition-all"
                    title={isEn ? 'Extract process name by clicking target app window or UI' : '화면에서 대상 프로그램 창이나 UI 요소를 클릭하여 프로세스명 자동 추출'}
                  >
                    <Crosshair className="w-3.5 h-3.5" />
                    {isEn ? 'Extract Process Name with Picker' : '오브젝트 선택기로 프로세스명 추출'}
                  </button>
                </div>
              </div>

              {/* 오브젝트 선택기로 추출된 메타데이터가 있을 때 안내 카드 */}
              {cfg.object_data && (
                <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 space-y-1.5 text-[11px]">
                  <div className="flex items-center justify-between text-rose-400 font-medium">
                    <span className="flex items-center gap-1">
                      <Crosshair className="w-3 h-3" />
                      {isEn ? 'Extracted Target Info' : '추출된 타겟 정보'}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleConfigChange('object_data', null)}
                      className="text-[10px] text-slate-500 hover:text-slate-300"
                    >
                      {isEn ? 'Clear' : '해제'}
                    </button>
                  </div>
                  {cfg.object_data.name && (
                    <div className="text-slate-300">
                      <span className="text-slate-500">{isEn ? 'Element:' : '요소:'}</span> {cfg.object_data.name}
                    </div>
                  )}
                  {cfg.object_data.window_title && (
                    <div className="text-slate-300 truncate" title={cfg.object_data.window_title}>
                      <span className="text-slate-500">{isEn ? 'Window:' : '윈도우:'}</span> {cfg.object_data.window_title}
                    </div>
                  )}
                  {cfg.process_name && (
                    <div className="text-rose-300 font-mono text-[10px]">
                      <span className="text-slate-500">{isEn ? 'Process:' : '프로세스:'}</span> {cfg.process_name}
                    </div>
                  )}
                </div>
              )}

              {/* 강제 종료 경고 및 가드레일 배지 */}
              <div className="p-2.5 bg-rose-950/30 border border-rose-900/50 rounded-xl space-y-1.5 text-[10px]">
                <div className="font-semibold text-rose-400 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  {isEn ? 'Warning: Force Kill Process' : '주의: 프로세스 강제 종료 (Kill)'}
                </div>
                <p className="text-slate-300 leading-relaxed">
                  {isEn
                    ? 'Terminates the target process forcefully at OS level. Unsaved work will be lost.'
                    : '대상 프로세스를 OS 레벨에서 즉각 강제 종료합니다. 저장되지 않은 작업 데이터가 즉시 유실될 수 있으므로 주의하여 사용하십시오.'}
                </p>
                <div className="pt-1 border-t border-rose-900/40 text-rose-300/80">
                  {isEn
                    ? '🔒 Safety Guardrail: Windows system & core Praxis Desktop processes cannot be killed.'
                    : '🔒 안전 가드레일: Windows 시스템 프로세스 및 Praxis Desktop 핵심 프로세스는 강제 종료할 수 없습니다.'}
                </div>
              </div>
            </div>
          )}

          {/* AI 노드 (Ollama) */}
          {isAi && (
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] text-purple-300 font-medium">
                    {isEn ? 'Select Ollama Model' : 'Ollama 모델 선택'}
                  </label>
                  {ollamaModels.length > 0 && cfg.model && !ollamaModels.includes(cfg.model) && (
                    <button
                      type="button"
                      onClick={() => handleConfigChange('model', ollamaModels[0])}
                      className="text-[10px] text-purple-400 hover:text-purple-300 underline font-medium"
                    >
                      {isEn ? `Change to ${ollamaModels[0]}` : `${ollamaModels[0]}로 즉시 변경`}
                    </button>
                  )}
                </div>
                {ollamaModels.length > 0 ? (
                  <select
                    value={cfg.model || ''}
                    onChange={(e) => handleConfigChange('model', e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-purple-800 rounded text-purple-200 mt-1 focus:outline-none focus:border-purple-500"
                  >
                    {!cfg.model && (
                      <option value="" disabled>{isEn ? '-- Select a Model --' : '-- 모델을 선택해 주세요 --'}</option>
                    )}
                    {cfg.model && !ollamaModels.includes(cfg.model) && (
                      <option value={cfg.model} className="text-amber-400 bg-slate-900 font-medium">
                        ⚠️ {cfg.model} ({isEn ? 'Not installed / undetected' : '미설치 / 감지 안됨'})
                      </option>
                    )}
                    {ollamaModels.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={cfg.model || 'llama3'}
                    onChange={(e) => handleConfigChange('model', e.target.value)}
                    placeholder={isEn ? 'e.g. llama3, qwen2.5:7b' : '예: llama3, qwen2.5:7b'}
                    className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-purple-800 rounded text-purple-200 mt-1"
                  />
                )}
                {ollamaModels.length > 0 && cfg.model && !ollamaModels.includes(cfg.model) && (
                  <div className="mt-1.5 p-2 bg-amber-950/40 border border-amber-800/60 rounded text-[10px] text-amber-300 flex items-start gap-1.5 leading-relaxed">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400 mt-0.5" />
                    <span>
                      {isEn ? (
                        <>Selected model <strong>{cfg.model}</strong> is not installed in Ollama. Please select an installed model from the dropdown above.</>
                      ) : (
                        <>설정된 <strong>{cfg.model}</strong> 모델이 현재 Ollama에 설치되어 있지 않습니다. 위 드롭다운에서 설치된 모델을 선택해 주세요.</>
                      )}
                    </span>
                  </div>
                )}
              </div>

              <div>
                <label className="text-[11px] text-purple-300 font-medium">
                  {isEn ? 'Prompt' : '지시 프롬프트 (Prompt)'}
                </label>
                <textarea
                  rows={4}
                  value={cfg.prompt || ''}
                  onChange={(e) => handleConfigChange('prompt', e.target.value)}
                  placeholder={isEn ? 'e.g. Summarize the article in 3 sentences: {{last_output}}' : '예: 화면에 보이는 기사를 3줄로 요약해줘: {{last_output}}'}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-purple-800/80 rounded text-slate-200 mt-1 focus:outline-none focus:border-purple-500 font-sans"
                />
                <div className="text-[10px] text-purple-400/80 mt-1">
                  {isEn ? 'Inject previous step results using {{last_output}} or {{var_name}}' : '{{last_output}} 또는 {{변수명}}으로 이전 단계 결과 주입 가능'}
                </div>
              </div>

              <div>
                <label className="text-[11px] text-slate-400">
                  {isEn ? 'System Prompt (Optional)' : '시스템 프롬프트 (선택)'}
                </label>
                <input
                  type="text"
                  value={cfg.system_prompt || ''}
                  onChange={(e) => handleConfigChange('system_prompt', e.target.value)}
                  placeholder={isEn ? 'e.g. You are an expert office automation assistant.' : '예: 너는 전문 사무 자동화 비서야.'}
                  className="w-full px-2.5 py-1 text-xs bg-slate-950 border border-slate-700 rounded text-slate-200 mt-1"
                />
              </div>

              <div>
                <label className="text-[11px] text-slate-400">
                  {isEn ? 'Output Variable Name' : '출력 저장 변수명'}
                </label>
                <input
                  type="text"
                  value={cfg.output_variable || 'ai_output'}
                  onChange={(e) => handleConfigChange('output_variable', e.target.value)}
                  placeholder="ai_output"
                  className="w-full px-2.5 py-1 text-xs bg-slate-950 border border-slate-700 rounded text-purple-300 font-mono mt-1"
                />
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>{isEn ? 'Temperature (Creativity)' : 'Temperature (창의성)'}</span>
                  <span>{cfg.temperature ?? 0.7}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={cfg.temperature ?? 0.7}
                  onChange={(e) => handleConfigChange('temperature', Number(e.target.value))}
                  className="w-full mt-1 accent-purple-500"
                />
              </div>
            </div>
          )}

          {/* 기본 에이전트 노드 (Agent) */}
          {isAgent && (
            <div className="space-y-4">
              {/* LLM 백엔드 선택 */}
              <div>
                <label className="text-[11px] text-indigo-300 font-medium">
                  {isEn ? 'LLM Backend' : 'LLM 백엔드'}
                </label>
                <select
                  value={cfg.llm_backend || 'ollama'}
                  onChange={(e) => handleConfigChange('llm_backend', e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-indigo-800/80 rounded-lg text-indigo-200 mt-1 focus:outline-none focus:border-indigo-500"
                >
                  <option value="ollama">Ollama ({isEn ? 'Local LLM' : '로컬 LLM'})</option>
                  <option value="vllm" disabled>vLLM ({isEn ? 'Coming soon' : '향후 지원 예정'})</option>
                  <option value="openai" disabled>OpenAI API ({isEn ? 'Coming soon' : '향후 지원 예정'})</option>
                </select>
              </div>

              {/* 모델 선택 */}
              {(cfg.llm_backend || 'ollama') === 'ollama' && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] text-indigo-300 font-medium">
                      {isEn ? 'Select Ollama Model' : 'Ollama 모델 선택'}
                    </label>
                    {ollamaModels.length > 0 && cfg.model && !ollamaModels.includes(cfg.model) && (
                      <button
                        type="button"
                        onClick={() => handleConfigChange('model', ollamaModels[0])}
                        className="text-[10px] text-indigo-400 hover:text-indigo-300 underline font-medium"
                      >
                        {isEn ? `Change to ${ollamaModels[0]}` : `${ollamaModels[0]}로 즉시 변경`}
                      </button>
                    )}
                  </div>
                  {ollamaModels.length > 0 ? (
                    <select
                      value={cfg.model || ''}
                      onChange={(e) => handleConfigChange('model', e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-indigo-800 rounded-lg text-indigo-200 mt-1 focus:outline-none focus:border-indigo-500"
                    >
                      {!cfg.model && (
                        <option value="" disabled>{isEn ? '-- Select a Model --' : '-- 모델을 선택해 주세요 --'}</option>
                      )}
                      {cfg.model && !ollamaModels.includes(cfg.model) && (
                        <option value={cfg.model} className="text-amber-400 bg-slate-900 font-medium">
                          ⚠️ {cfg.model} ({isEn ? 'Not installed / undetected' : '미설치 / 감지 안됨'})
                        </option>
                      )}
                      {ollamaModels.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={cfg.model || 'llama3.1'}
                      onChange={(e) => handleConfigChange('model', e.target.value)}
                      placeholder={isEn ? 'e.g. llama3.1, qwen2.5:7b' : '예: llama3.1, qwen2.5:7b'}
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-indigo-800 rounded-lg text-indigo-200 mt-1 focus:outline-none focus:border-indigo-500"
                    />
                  )}
                  {ollamaModels.length > 0 && cfg.model && !ollamaModels.includes(cfg.model) ? (
                    <div className="mt-1.5 p-2 bg-amber-950/40 border border-amber-800/60 rounded text-[10px] text-amber-300 flex items-start gap-1.5 leading-relaxed">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400 mt-0.5" />
                      <span>
                        {isEn ? (
                          <>Selected model <strong>{cfg.model}</strong> is not installed in Ollama. Please select an installed model (e.g. <strong>{ollamaModels[0]}</strong>).</>
                        ) : (
                          <>설정된 <strong>{cfg.model}</strong> 모델이 현재 Ollama에 설치되어 있지 않습니다. 위 드롭다운에서 설치된 모델(예: <strong>{ollamaModels[0]}</strong>)을 선택해 주세요.</>
                        )}
                      </span>
                    </div>
                  ) : (
                    <p className="text-[10px] text-slate-500 mt-1">
                      {isEn ? '* Tool-calling models (Llama 3.1, Qwen 2.5, etc.) recommended' : '* Tool Calling을 지원하는 모델(Llama 3.1, Qwen 2.5 등) 권장'}
                    </p>
                  )}
                </div>
              )}

              {/* 지시 프롬프트 */}
              <div>
                <label className="text-[11px] text-indigo-300 font-medium">
                  {isEn ? 'Instruction Prompt' : '지시 프롬프트 (Prompt)'}
                </label>
                <textarea
                  rows={4}
                  value={cfg.prompt || ''}
                  onChange={(e) => handleConfigChange('prompt', e.target.value)}
                  placeholder={isEn ? "e.g. Open browser, check today's top news and summarize in 3 lines" : '예: 브라우저를 열고 오늘 주요 뉴스를 확인해서 3줄로 요약해줘'}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-indigo-800/80 rounded-lg text-slate-200 mt-1 focus:outline-none focus:border-indigo-500 font-sans"
                />
                <div className="text-[10px] text-indigo-400/80 mt-1">
                  {isEn ? 'Supports {{var_name}} or {{last_output}} template variables' : '{{변수명}} 또는 {{last_output}} 템플릿 치환 지원'}
                </div>

                {/* 실행 시점 PC 화면 포함 옵션 */}
                <label className="flex items-start gap-2.5 mt-2.5 p-2 rounded-lg bg-slate-950 border border-slate-800 hover:border-slate-700 cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={!!cfg.include_screen_capture}
                    onChange={(e) => handleConfigChange('include_screen_capture', e.target.checked)}
                    className="mt-0.5 rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0 cursor-pointer"
                  />
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-slate-200">
                      <Camera className="w-3.5 h-3.5 text-teal-400" />
                      {isEn ? 'Attach Desktop Screenshot at Execution' : '실행 시점 PC 화면 포함 (스크린샷)'}
                    </div>
                    <p className="text-[10px] text-slate-500 leading-tight">
                      {isEn
                        ? 'Captures the full desktop screen right before agent execution and attaches it as visual context.'
                        : '에이전트 시작 직전 PC 화면 전체를 캡처하여 시각 정보로 프롬프트에 자동 첨부합니다.'}
                    </p>
                  </div>
                </label>
              </div>

              {/* 시스템 프롬프트 */}
              <div>
                <label className="text-[11px] text-slate-400">
                  {isEn ? 'System Prompt (Optional)' : '시스템 프롬프트 (선택)'}
                </label>
                <textarea
                  rows={2}
                  value={cfg.system_prompt || ''}
                  onChange={(e) => handleConfigChange('system_prompt', e.target.value)}
                  placeholder={isEn ? '예: 당신은 정밀한 데스크톱 사무 자동화 전문 에이전트입니다.' : '예: 당신은 정밀한 데스크톱 사무 자동화 전문 에이전트입니다.'}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 mt-1 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* 스킬셋 설정 */}
              <div className="border-t border-slate-800 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[11px] text-indigo-300 font-semibold flex items-center gap-1.5">
                    <Wrench className="w-3.5 h-3.5 text-indigo-400" />
                    {isEn ? 'Available Skillset (Tools)' : '사용 가능 스킬셋 (Tools)'}
                  </label>
                  <span className="text-[10px] text-slate-500">
                    {cfg.skill_mode === 'custom'
                      ? `${(cfg.custom_skills || []).length}${isEn ? ' selected' : '개 선택됨'}`
                      : cfg.preset_name === 'all'
                      ? (isEn ? 'All (11 skills)' : '전체 (11종)')
                      : (isEn ? 'Default (8 skills)' : '기본 (8종)')}
                  </span>
                </div>

                {/* 모드 토글: 프리셋 vs 커스텀 */}
                <div className="grid grid-cols-2 gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 mb-2.5">
                  <button
                    type="button"
                    onClick={() => handleConfigChange('skill_mode', 'preset')}
                    className={`py-1 text-xs font-medium rounded-md transition-all ${
                      (cfg.skill_mode || 'preset') === 'preset'
                        ? 'bg-indigo-600 text-white shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {isEn ? 'Preset Mode' : '프리셋 모드'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleConfigChange('skill_mode', 'custom')}
                    className={`py-1 text-xs font-medium rounded-md transition-all ${
                      cfg.skill_mode === 'custom'
                        ? 'bg-indigo-600 text-white shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {isEn ? 'Custom Mode' : '커스텀 모드'}
                  </button>
                </div>

                {/* 1. 프리셋 모드 뷰 */}
                {(cfg.skill_mode || 'preset') === 'preset' ? (
                  <div className="space-y-2">
                    <select
                      value={cfg.preset_name || 'basic_interaction'}
                      onChange={(e) => handleConfigChange('preset_name', e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500"
                    >
                      <option value="basic_interaction">
                        {isEn
                          ? 'Basic UI Interaction (Mouse, Keyboard, Window, Screenshot, UI Scan - 8 skills)'
                          : '기본 화면 상호작용 (마우스/키보드/창/스크린샷/UI스캔 8종)'}
                      </option>
                      <option value="all">
                        {isEn ? 'All (All 11 skills included)' : '전체 (모든 스킬 11종 포함)'}
                      </option>
                    </select>

                    {/* 전체 프리셋 선택 시 소형 모델 경고 배지 */}
                    {cfg.preset_name === 'all' && (
                      <div className="p-2.5 bg-amber-950/40 border border-amber-800/60 rounded-lg flex items-start gap-2 text-amber-300 text-[11px] leading-relaxed">
                        <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
                        <div>
                          <span className="font-semibold text-amber-300">
                            {isEn ? 'Small Model Performance Warning!' : '소형 모델 성능 저하 주의!'}
                          </span>
                          <p className="text-[10px] text-amber-400/90 mt-0.5">
                            {isEn
                              ? 'Too many skills can bloat context in small models (<=8B), reducing reasoning accuracy and tool call precision.'
                              : '스킬이 너무 많으면 소형 모델(8B 이하)에서 컨텍스트가 비대해져 추론 정확도와 도구 호출 성능이 저하될 수 있습니다.'}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  /* 2. 커스텀 모드 뷰 (스킬별 체크박스 리스트) */
                  <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                    {AGENT_AVAILABLE_SKILLS.map((skill) => {
                      const currentSkills: string[] = Array.isArray(cfg.custom_skills)
                        ? cfg.custom_skills
                        : ['get_screen_elements', 'mouse_click', 'keyboard_type', 'window_activate', 'take_screenshot'];
                      const isChecked = currentSkills.includes(skill.id);

                      const toggleSkill = () => {
                        const nextSkills = isChecked
                          ? currentSkills.filter((id) => id !== skill.id)
                          : [...currentSkills, skill.id];
                        handleConfigChange('custom_skills', nextSkills);
                      };

                      return (
                        <div
                          key={skill.id}
                          onClick={toggleSkill}
                          className={`p-2 rounded-lg border text-xs cursor-pointer transition-all flex items-start gap-2 ${
                            isChecked
                              ? 'bg-indigo-950/40 border-indigo-800/70 text-slate-200'
                              : 'bg-slate-950/50 border-slate-800/60 text-slate-400 hover:border-slate-700'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {}}
                            className="mt-0.5 rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0 cursor-pointer pointer-events-none"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <span className="font-medium truncate">{skill.name}</span>
                              <span className="text-[9px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">
                                {skill.category}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-500 truncate mt-0.5">
                              {skill.desc}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 기타 파라미터 (최대 루프, 출력 변수, Temperature) */}
              <div className="border-t border-slate-800 pt-3 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-slate-400">
                      {isEn ? 'Max Step Loops' : '최대 반복 루프'}
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="30"
                      value={cfg.max_steps ?? 10}
                      onChange={(e) => handleConfigChange('max_steps', Number(e.target.value))}
                      className="w-full px-2.5 py-1 text-xs bg-slate-950 border border-slate-700 rounded text-slate-200 mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400">
                      {isEn ? 'Output Variable Name' : '출력 저장 변수명'}
                    </label>
                    <input
                      type="text"
                      value={cfg.output_variable || 'agent_result'}
                      onChange={(e) => handleConfigChange('output_variable', e.target.value)}
                      placeholder="agent_result"
                      className="w-full px-2.5 py-1 text-xs bg-slate-950 border border-slate-700 rounded text-indigo-300 font-mono mt-1"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-[11px] text-slate-400">
                    <span>{isEn ? 'Temperature (Reasoning Diversity)' : 'Temperature (추론 다양성)'}</span>
                    <span>{cfg.temperature ?? 0.3}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={cfg.temperature ?? 0.3}
                    onChange={(e) => handleConfigChange('temperature', Number(e.target.value))}
                    className="w-full mt-1 accent-indigo-500"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {!isMarker && (
        <div className="p-3 border-t border-slate-800">
          <button
            onClick={() => onDeleteNode(selectedNode.id)}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-red-950/40 text-red-400 border border-red-900/60 hover:bg-red-900/60 hover:text-red-200 transition-colors text-xs font-medium"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t('inspector.deleteNodeButton')}
          </button>
        </div>
      )}
    </aside>
  );
};
