import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Trash2,
  X,
  Sparkles,
  HelpCircle,
  Crosshair,
  RotateCcw,
  Zap,
  Move,
  Hand,
  ArrowUpDown,
  ClipboardPaste,
  FileText,
  MessageSquare,
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
  Variable,
  Plus,
  GripVertical,
  AlertCircle,
  FolderKanban,
  GitBranchPlus,
  Workflow,
  ArrowRight,
  ArrowLeft,
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  Wand2,
  Globe,
  MousePointerClick,
  FormInput,
  FileSearch,
  Compass,
  Info,
  Code2,
  StickyNote,
} from 'lucide-react';
import {
  FlowNodeData,
  VariableType,
  WorkflowVariable,
  Flow,
  SubflowVariableMapping,
  SubflowMappingDirection,
  NodeType,
  WebElementData,
} from '../../types';
import {
  resolveImageUrl,
  startWebPicker,
  getWebPickerStatus,
  cancelWebPicker,
} from '../../services/api';
import { AGENT_AVAILABLE_SKILLS, SKILL_ITEMS } from './skillRegistry';
import { detectSubflowCallCycle } from '../../utils/flowValidator';
import {
  SYSTEM_VARIABLES,
  validateVariableNameFormat,
  getDefaultValueForType,
  analyzeNodeVariableUsage,
  isSystemVariable,
} from '../../utils/variableUtils';
import { useI18n } from '../../i18n';

interface PropertyInspectorProps {
  selectedNode: any | null;
  ollamaModels: string[];
  onUpdateNodeData: (nodeId: string, label: string, config: Record<string, any>) => void;
  onDeleteNode: (nodeId: string) => void;
  onClose: () => void;
  onOpenObjectPicker?: (targetField?: string | any) => void;
  variables?: WorkflowVariable[];
  onDeclareVariable?: (variable: WorkflowVariable) => void;
  externalInsertTrigger?: { varName: string; timestamp: number } | null;
  flows?: Flow[];
  activeFlowId?: string;
  activeFlowName?: string;
  allNodes?: any[];
  onAssignNodeToGroup?: (nodeId: string, groupId: string | null) => void;
  onAddNewSkillToGroup?: (groupId: string, type: NodeType, label: string, defaultConfig: Record<string, any>) => void;
}

export const PropertyInspector: React.FC<PropertyInspectorProps> = ({
  selectedNode,
  ollamaModels,
  onUpdateNodeData,
  onDeleteNode,
  onClose,
  onOpenObjectPicker,
  variables = [],
  onDeclareVariable,
  externalInsertTrigger,
  flows = [],
  activeFlowId,
  activeFlowName,
  allNodes = [],
  onAssignNodeToGroup,
  onAddNewSkillToGroup,
}) => {
  const { t, language } = useI18n();
  const isEn = language === 'en';

  const [activeTextKey, setActiveTextKey] = useState<string>('');
  const [newOutVarInput, setNewOutVarInput] = useState<string>('');
  const [outVarError, setOutVarError] = useState<string | null>(null);
  const [showDeclareInline, setShowDeclareInline] = useState<boolean>(false);

  const lastFocusedElementRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const lastCursorPosRef = useRef<{ start: number; end: number } | null>(null);

  const nodeData = (selectedNode?.data as FlowNodeData) || { label: '', type: 'flow_start', config: {} };
  const cfg = { ...(nodeData.config || {}) };
  const isStart = nodeData.type === 'flow_start';
  const isEnd = nodeData.type === 'flow_end';
  const isGroup = nodeData.type === 'flow_group';
  const isSubflow = nodeData.type === 'flow_call';
  const isMarker = isStart || isEnd;
  const subtype = (nodeData.type || '').replace('general_', '');
  const isAi = nodeData.type === 'ai_ollama';
  const isAgent = nodeData.type === 'agent_basic';
  const [groupAddSkillType, setGroupAddSkillType] = useState<string>('general_mouse_click');
  const [assignExistingNodeId, setAssignExistingNodeId] = useState<string>('');

  // 비주얼 웹 요소 선택기 (Web Picker) 상태
  const [webPickerActive, setWebPickerActive] = useState<boolean>(false);
  const [webPickerError, setWebPickerError] = useState<string | null>(null);
  const [webPickerCustomUrl, setWebPickerCustomUrl] = useState<string>('');
  const [showWebPickerUrlInput, setShowWebPickerUrlInput] = useState<boolean>(false);
  const webPickerPollRef = useRef<any>(null);

  // 워크플로우 내 '웹 브라우저 열기(browser_navigate)' 노드에서 기본 URL 추론
  const inferredBrowserUrl = useMemo(() => {
    const navNodes = (allNodes || []).filter((n) => n?.data?.type === 'browser_navigate');
    for (let i = navNodes.length - 1; i >= 0; i--) {
      const u = String(navNodes[i]?.data?.config?.url || '').trim();
      if (u && !u.includes('{{')) {
        return u;
      }
    }
    return 'https://www.naver.com';
  }, [allNodes]);

  useEffect(() => {
    return () => {
      if (webPickerPollRef.current) {
        clearInterval(webPickerPollRef.current);
        webPickerPollRef.current = null;
      }
    };
  }, []);

  // 현재 노드가 가진 텍스트형 속성 목록 정의 (클릭/드래그 변수 삽입 대상)
  const nodeTextFields = useMemo((): { key: string; label: string }[] => {
    switch (nodeData.type) {
      case 'general_keyboard_type':
        return [{ key: 'text', label: isEn ? 'Text to Type' : '입력할 텍스트' }];
      case 'general_keyboard_hotkey':
        return [{ key: 'keys', label: isEn ? 'Shortcut Keys' : '단축키 조합' }];
      case 'general_clipboard_copy':
        return [{ key: 'text', label: isEn ? 'Clipboard Text' : '복사할 텍스트' }];
      case 'general_file_read':
        return [{ key: 'file_path', label: isEn ? 'File Path' : '읽어올 파일 경로' }];
      case 'general_file_write':
        return [
          { key: 'content', label: isEn ? 'File Content' : '파일에 쓸 입력값' },
          { key: 'file_path', label: isEn ? 'File Path' : '저장할 파일 경로' },
        ];
      case 'general_message_box':
        return [
          { key: 'message', label: isEn ? 'Message Body' : '메시지 본문' },
          { key: 'title', label: isEn ? 'Dialog Title' : '대화상자 타이틀' },
        ];
      case 'general_window_activate':
      case 'general_window_maximize':
      case 'general_window_minimize':
      case 'general_window_close':
        return [{ key: 'window_title', label: isEn ? 'Window Title' : '대상 창 제목' }];
      case 'general_launch_program':
        return [
          { key: 'program_path', label: isEn ? 'Program Path' : '프로그램 경로' },
          { key: 'arguments', label: isEn ? 'Arguments' : '실행 인자' },
          { key: 'working_dir', label: isEn ? 'Working Dir' : '작업 폴더' },
        ];
      case 'general_close_program':
      case 'general_kill_process':
        return [{ key: 'process_name', label: isEn ? 'Process Name' : '프로세스명' }];
      case 'general_screenshot':
        return [{ key: 'file_path', label: isEn ? 'Save File Path' : '저장 파일 경로' }];
      case 'browser_navigate':
        return [{ key: 'url', label: isEn ? 'Web URL' : '이동할 웹 주소 (URL)' }];
      case 'browser_click':
        return [{ key: 'selector', label: isEn ? 'Target Selector / Text' : '대상 요소 선택자/텍스트' }];
      case 'browser_fill':
        return [
          { key: 'text', label: isEn ? 'Text to Input' : '입력할 텍스트' },
          { key: 'selector', label: isEn ? 'Target Selector / Placeholder' : '입력창 선택자/안내문구' },
        ];
      case 'browser_extract':
        return [
          { key: 'selector', label: isEn ? 'Target Selector' : '추출 영역 선택자' },
          { key: 'attribute_name', label: isEn ? 'Attribute Name' : '추출할 속성명 (href 등)' },
        ];
      case 'browser_action':
        return [
          { key: 'target_value', label: isEn ? 'Target Tab / Selector' : '대상 탭 키워드 / 선택자' },
          { key: 'option_value', label: isEn ? 'Option / Folder Path' : '선택 항목값 / 폴더 경로' },
        ];
      case 'browser_evaluate':
        return [{ key: 'script', label: isEn ? 'JavaScript Code' : '실행할 JS 스크립트' }];
      case 'ai_ollama':
      case 'agent_basic':
        return [
          { key: 'prompt', label: isEn ? 'Prompt' : '지시 프롬프트' },
          { key: 'system_prompt', label: isEn ? 'System Prompt' : '시스템 프롬프트' },
        ];
      default:
        return [];
    }
  }, [nodeData.type, isEn]);

  // 노드 선택 변경 시 기본 활성 텍스트 필드 초기화
  useEffect(() => {
    setOutVarError(null);
    setNewOutVarInput('');
    setShowDeclareInline(false);
    setWebPickerError(null);
    setWebPickerCustomUrl(cfg.web_element_data?.page_url || inferredBrowserUrl);
    lastFocusedElementRef.current = null;
    lastCursorPosRef.current = null;
    if (nodeTextFields.length > 0) {
      setActiveTextKey(nodeTextFields[0].key);
    } else {
      setActiveTextKey('');
    }
  }, [selectedNode?.id, nodeTextFields]);

  const handleLabelChange = (newLabel: string) => {
    if (!selectedNode) return;
    onUpdateNodeData(selectedNode.id, newLabel, cfg);
  };

  const handleConfigChange = (key: string, val: any) => {
    if (!selectedNode) return;
    const updated = { ...cfg, [key]: val };
    onUpdateNodeData(selectedNode.id, nodeData.label, updated);
  };

  const handleMultiConfigChange = (patch: Record<string, any>) => {
    if (!selectedNode) return;
    const updated = { ...cfg, ...patch };
    onUpdateNodeData(selectedNode.id, nodeData.label, updated);
  };

  // 지정한 텍스트 설정 필드에 {{변수명}} 토큰 삽입
  const insertVariableToken = (varName: string, explicitKey?: string) => {
    if (!selectedNode) return;
    const targetKey =
      explicitKey ||
      activeTextKey ||
      (nodeTextFields.length > 0 ? nodeTextFields[0].key : '');
    if (!targetKey) return;

    const token = `{{${varName}}}`;
    const currentStr = String(cfg[targetKey] ?? '');

    let nextStr = `${currentStr}${token}`;
    if (
      !explicitKey &&
      lastFocusedElementRef.current &&
      lastCursorPosRef.current &&
      lastFocusedElementRef.current.value === currentStr
    ) {
      const { start, end } = lastCursorPosRef.current;
      nextStr = currentStr.slice(0, start) + token + currentStr.slice(end);
      const nextCursor = start + token.length;
      lastCursorPosRef.current = { start: nextCursor, end: nextCursor };
    }

    handleConfigChange(targetKey, nextStr);
  };

  // 하단 VariableManagerPanel에서 변수 칩 클릭 시 현재 활성 텍스트 필드에 자동 삽입
  const prevTriggerTimeRef = useRef<number>(0);
  useEffect(() => {
    if (
      externalInsertTrigger &&
      externalInsertTrigger.timestamp > prevTriggerTimeRef.current &&
      selectedNode &&
      nodeTextFields.length > 0
    ) {
      prevTriggerTimeRef.current = externalInsertTrigger.timestamp;
      insertVariableToken(externalInsertTrigger.varName);
    }
  }, [externalInsertTrigger]);

  // 현재 노드에서 참조 중인 {{변수}} 중 미선언 변수 추출
  const undeclaredReferencedVars = useMemo(() => {
    if (!selectedNode || isMarker) return [];
    const usage = analyzeNodeVariableUsage(selectedNode);
    const declaredSet = new Set(variables.map((v) => v.name));
    return usage.referencedVars.filter(
      (refName) => !declaredSet.has(refName) && !isSystemVariable(refName)
    );
  }, [selectedNode, cfg, variables, isMarker]);

  // Inspector 내부 입력창 포커스/커서 위치 추적
  const handleInspectorSelectOrFocus = (e: React.SyntheticEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') return;
    const inputEl = target as HTMLInputElement | HTMLTextAreaElement;
    if (
      inputEl.type === 'number' ||
      inputEl.type === 'checkbox' ||
      inputEl.type === 'range' ||
      inputEl.getAttribute('data-ignore-var-focus') === 'true'
    ) {
      return;
    }

    const explicitAttrKey = inputEl.getAttribute('data-config-key');
    if (explicitAttrKey) {
      setActiveTextKey(explicitAttrKey);
      lastFocusedElementRef.current = inputEl;
      lastCursorPosRef.current = {
        start: inputEl.selectionStart ?? inputEl.value.length,
        end: inputEl.selectionEnd ?? inputEl.value.length,
      };
      return;
    }

    // 값 매칭으로 어느 텍스트 속성인지 역추적
    const matchedField = nodeTextFields.find(
      (f) => String(cfg[f.key] ?? '') === inputEl.value
    );
    if (matchedField) {
      setActiveTextKey(matchedField.key);
      lastFocusedElementRef.current = inputEl;
      lastCursorPosRef.current = {
        start: inputEl.selectionStart ?? inputEl.value.length,
        end: inputEl.selectionEnd ?? inputEl.value.length,
      };
    }
  };

  // Inspector 내 텍스트 입력창으로 변수 칩을 드래그 앤 드롭했을 때 처리
  const handleInspectorDropCapture = (e: React.DragEvent) => {
    const droppedVar =
      e.dataTransfer.getData('application/x-praxis-variable') ||
      (() => {
        const plain = e.dataTransfer.getData('text/plain') || '';
        const m = plain.match(/^\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}$/);
        return m ? m[1] : '';
      })();

    if (!droppedVar) return;
    e.preventDefault();
    e.stopPropagation();

    const target = e.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
      const inputEl = target as HTMLInputElement | HTMLTextAreaElement;
      const attrKey = inputEl.getAttribute('data-config-key');
      const matchedKey =
        attrKey ||
        nodeTextFields.find((f) => String(cfg[f.key] ?? '') === inputEl.value)?.key ||
        activeTextKey;

      if (matchedKey) {
        const curVal = String(cfg[matchedKey] ?? '');
        const pos = inputEl.selectionStart ?? curVal.length;
        const token = `{{${droppedVar}}}`;
        const nextVal = curVal.slice(0, pos) + token + curVal.slice(pos);
        setActiveTextKey(matchedKey);
        handleConfigChange(matchedKey, nextVal);
        return;
      }
    }

    insertVariableToken(droppedVar);
  };

  // 출력 변수(output_variable) 전용 선언 검사 및 선택 컴포넌트 렌더러
  const renderOutputVariableSelector = (
    defaultVarName: string,
    expectedTypes: VariableType[] = ['string', 'json'],
    accentClass: string = 'border-emerald-700 text-emerald-300'
  ) => {
    const currentOutVar = String(cfg.output_variable ?? defaultVarName).trim();
    const declaredObj = variables.find((v) => v.name === currentOutVar);
    const isDeclared = !!declaredObj;
    const isSysVar = isSystemVariable(currentOutVar);
    const isTypeCompatible = !declaredObj || expectedTypes.includes(declaredObj.type);
    const recommendedType: VariableType = expectedTypes[0] || 'string';

    const handleQuickDeclareCurrent = (targetName: string) => {
      const trimmed = targetName.trim();
      const fmtCheck = validateVariableNameFormat(trimmed);
      if (!fmtCheck.valid) {
        setOutVarError(fmtCheck.reason || '올바르지 않은 변수명입니다.');
        return;
      }
      setOutVarError(null);
      if (onDeclareVariable && !variables.some((v) => v.name === trimmed)) {
        onDeclareVariable({
          name: trimmed,
          type: recommendedType,
          defaultValue: getDefaultValueForType(recommendedType),
          description: `${nodeData.label} 출력 변수`,
        });
      }
      handleConfigChange('output_variable', trimmed);
      setNewOutVarInput('');
      setShowDeclareInline(false);
    };

    return (
      <div className="space-y-2 mt-1">
        {/* 1) 선언된 변수 드롭다운 선택기 (미선언 변수 입력 원천 차단) */}
        <div className="flex items-center gap-1.5">
          <select
            value={isDeclared && isTypeCompatible ? currentOutVar : ''}
            onChange={(e) => {
              setOutVarError(null);
              if (e.target.value) {
                handleConfigChange('output_variable', e.target.value);
              }
            }}
            className={`flex-1 px-2.5 py-1.5 text-xs bg-slate-950 border rounded-lg font-mono focus:outline-none ${
              isDeclared && isTypeCompatible
                ? accentClass
                : 'border-rose-600/80 text-rose-300 bg-rose-950/20'
            }`}
          >
            <option value="" disabled>
              {t('variables.selectOutputVarPlaceholder')}
            </option>
            {variables.map((v) => {
              const compatible = expectedTypes.includes(v.type);
              return (
                <option key={v.name} value={v.name} disabled={!compatible}>
                  {v.name} ({v.type})
                  {!compatible ? ' - 타입 불일치' : ''}
                </option>
              );
            })}
          </select>

          <button
            type="button"
            onClick={() => {
              setShowDeclareInline(!showDeclareInline);
              setOutVarError(null);
            }}
            className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-medium flex items-center gap-1 shrink-0 transition-colors"
            title="새 출력 변수를 즉시 선언하고 이 노드에 지정합니다"
          >
            <Plus className="w-3.5 h-3.5 text-emerald-400" />
            <span>{isEn ? 'Declare' : '변수 선언'}</span>
          </button>
        </div>

        {/* 2) 인라인 신규 출력 변수 선언 폼 */}
        {showDeclareInline && (
          <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
            <div className="text-[10px] text-slate-400 font-medium">
              {isEn
                ? `Declare new '${recommendedType}' variable & assign:`
                : `새 출력 변수 선언 (${recommendedType} 타입 자동 지정):`}
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={newOutVarInput}
                onChange={(e) => {
                  setNewOutVarInput(e.target.value);
                  setOutVarError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleQuickDeclareCurrent(newOutVarInput);
                  }
                }}
                placeholder={defaultVarName}
                className="flex-1 px-2 py-1 text-xs font-mono bg-slate-900 border border-slate-700 rounded text-emerald-300 focus:outline-none focus:border-emerald-500"
              />
              <button
                type="button"
                onClick={() => handleQuickDeclareCurrent(newOutVarInput)}
                className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shrink-0"
              >
                {isEn ? 'Add' : '선언 및 적용'}
              </button>
            </div>
          </div>
        )}

        {/* 3) 미선언 변수이거나 타입 불일치 시 경고 및 원클릭 해결 버튼 */}
        {(!isDeclared || !isTypeCompatible || isSysVar) && (
          <div className="p-2.5 rounded-xl bg-rose-950/40 border border-rose-800/70 space-y-1.5 text-[11px]">
            <div className="flex items-start gap-1.5 text-rose-300 font-medium leading-tight">
              <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
              <span>
                {isSysVar
                  ? `'${currentOutVar}' 변수는 읽기 전용 시스템 변수이므로 출력 변수로 지정할 수 없습니다.`
                  : !isDeclared
                  ? `현재 지정된 '${currentOutVar || '(공란)'}' 변수가 선언되지 않았습니다. 선언되지 않은 변수는 사용할 수 없습니다.`
                  : `'${currentOutVar}' 변수의 타입(${declaredObj?.type})이 이 노드의 출력 타입(${expectedTypes.join(
                      '/'
                    )})과 일치하지 않습니다.`}
              </span>
            </div>
            {!isDeclared && !isSysVar && currentOutVar && (
              <button
                type="button"
                onClick={() => handleQuickDeclareCurrent(currentOutVar)}
                className="w-full py-1 px-2 rounded-lg bg-emerald-600/90 hover:bg-emerald-500 text-white text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors"
              >
                <Plus className="w-3 h-3" />
                <span>
                  {t('variables.declareNowBtn', {
                    name: currentOutVar,
                    type: recommendedType,
                  })}
                </span>
              </button>
            )}
          </div>
        )}

        {outVarError && (
          <div className="text-[10px] text-rose-400 flex items-center gap-1 px-1">
            <AlertCircle className="w-3 h-3 shrink-0" />
            <span>{outVarError}</span>
          </div>
        )}

        <div className="text-[10px] text-slate-500 leading-tight">
          🔒 {t('variables.outputVarHelp')}
        </div>
      </div>
    );
  };

  if (!selectedNode) return null;

  const handleBrowseFileForKey = async (configKey: string, acceptExts: string = '*') => {
    if (window.electronAPI?.openFileDialog) {
      const selectedPath = await window.electronAPI.openFileDialog();
      if (selectedPath) {
        handleConfigChange(configKey, selectedPath);
      }
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = acceptExts;
    input.onchange = (e: any) => {
      const file = e.target.files?.[0];
      if (file) {
        const filePath = file.path || file.name;
        handleConfigChange(configKey, filePath);
      }
    };
    input.click();
  };

  const handleBrowseFile = async () => {
    await handleBrowseFileForKey('program_path', '.exe,.bat,.cmd,.lnk,*');
  };

  // 비주얼 웹 요소 선택기(Web Picker) 시작 핸들러
  const handleStartWebPicker = async (
    targetFieldKey: 'selector' | 'target_value' = 'selector',
    extraPatch?: Record<string, any>
  ) => {
    if (!selectedNode) return;
    if (webPickerPollRef.current) {
      clearInterval(webPickerPollRef.current);
      webPickerPollRef.current = null;
    }

    setWebPickerError(null);
    setWebPickerActive(true);

    const targetNodeId = selectedNode.id;
    const targetNodeLabel = nodeData.label;
    const targetNodeType = nodeData.type;
    const snapshotCfg = { ...cfg, ...(extraPatch || {}) };

    try {
      // Electron 데스크톱 앱인 경우 브라우저가 잘 보이도록 메인 창 최소화
      if (window.electronAPI?.minimizeMainWindow) {
        await window.electronAPI.minimizeMainWindow();
      }

      const startUrl = (webPickerCustomUrl || '').trim() || inferredBrowserUrl;
      await startWebPicker({
        url: startUrl,
        browser_channel: 'chrome',
        use_persistent_profile: true,
      });

      webPickerPollRef.current = setInterval(async () => {
        try {
          const statusRes = await getWebPickerStatus();
          if (statusRes.status === 'picked' && statusRes.element) {
            if (webPickerPollRef.current) {
              clearInterval(webPickerPollRef.current);
              webPickerPollRef.current = null;
            }
            setWebPickerActive(false);

            if (window.electronAPI?.restoreMainWindow) {
              await window.electronAPI.restoreMainWindow();
            }

            const elem = statusRes.element;
            const nextCfg: Record<string, any> = {
              ...snapshotCfg,
              web_element_data: elem,
            };

            if (targetNodeType === 'browser_click') {
              nextCfg.selector_type = elem.recommended_type || 'css';
              nextCfg.selector = elem.recommended_selector || elem.css_selector;
            } else if (targetNodeType === 'browser_fill') {
              nextCfg.selector_type = elem.recommended_type || 'css';
              nextCfg.selector = elem.recommended_selector || elem.css_selector;
            } else if (targetNodeType === 'browser_extract') {
              nextCfg.extract_target = 'element';
              nextCfg.selector = elem.css_selector || elem.xpath;
            } else if (targetNodeType === 'browser_action') {
              nextCfg[targetFieldKey] = elem.recommended_selector || elem.css_selector;
            } else {
              nextCfg[targetFieldKey] = elem.recommended_selector || elem.css_selector;
            }

            onUpdateNodeData(targetNodeId, targetNodeLabel, nextCfg);
          } else if (
            statusRes.status === 'cancelled' ||
            statusRes.status === 'error' ||
            (!statusRes.active && statusRes.status !== 'picking')
          ) {
            if (webPickerPollRef.current) {
              clearInterval(webPickerPollRef.current);
              webPickerPollRef.current = null;
            }
            setWebPickerActive(false);
            if (statusRes.error) {
              setWebPickerError(statusRes.error);
            }
            if (window.electronAPI?.restoreMainWindow) {
              await window.electronAPI.restoreMainWindow();
            }
          }
        } catch (pollErr: any) {
          if (webPickerPollRef.current) {
            clearInterval(webPickerPollRef.current);
            webPickerPollRef.current = null;
          }
          setWebPickerActive(false);
          setWebPickerError(pollErr?.message || '웹 요소 선택기 상태 확인 중 오류 발생');
          if (window.electronAPI?.restoreMainWindow) {
            await window.electronAPI.restoreMainWindow();
          }
        }
      }, 250);
    } catch (err: any) {
      setWebPickerActive(false);
      setWebPickerError(err?.message || '웹 요소 선택기를 시작할 수 없습니다.');
      if (window.electronAPI?.restoreMainWindow) {
        await window.electronAPI.restoreMainWindow();
      }
    }
  };

  const handleCancelWebPicker = async () => {
    if (webPickerPollRef.current) {
      clearInterval(webPickerPollRef.current);
      webPickerPollRef.current = null;
    }
    setWebPickerActive(false);
    try {
      await cancelWebPicker();
    } catch {
      // ignore
    }
  };

  // 웹 전용 노드 공통 비주얼 Web Picker UI 렌더러
  const renderWebElementPickerSection = (
    targetFieldKey: 'selector' | 'target_value' = 'selector',
    buttonLabel?: string,
    extraPatch?: Record<string, any>
  ) => {
    const webElem: WebElementData | null = cfg.web_element_data || null;
    const currentSelectorVal = String(cfg[targetFieldKey] ?? '');
    const textCandidate = webElem?.placeholder || webElem?.text || webElem?.aria_label || '';

    return (
      <div className="p-3 rounded-xl bg-slate-950 border border-cyan-800/60 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-cyan-300 flex items-center gap-1.5">
            <Crosshair className="w-3.5 h-3.5 text-cyan-400" />
            {isEn ? 'Visual Web Element Picker' : '비주얼 웹 요소 선택기 (Web Picker)'}
          </span>
          <button
            type="button"
            onClick={() => setShowWebPickerUrlInput((prev) => !prev)}
            className="text-[10px] text-slate-400 hover:text-cyan-300 transition-colors flex items-center gap-0.5"
            title={isEn ? 'Set initial URL if browser is not open yet' : '브라우저가 열려 있지 않을 때 자동으로 띄울 시작 URL 설정'}
          >
            <Globe className="w-3 h-3" />
            <span>{showWebPickerUrlInput ? (isEn ? 'Hide URL' : '시작 URL 접기') : (isEn ? 'Initial URL' : '시작 URL 설정')}</span>
          </button>
        </div>

        {/* 열려 있는 브라우저가 없을 때 사용할 기본 URL 설정란 (접이식) */}
        {showWebPickerUrlInput && (
          <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 space-y-1">
            <label className="text-[10px] text-slate-400 block">
              {isEn
                ? 'Fallback URL (used when no Playwright browser is open yet)'
                : '열린 브라우저가 없을 때 자동으로 열 웹 주소 (URL)'}
            </label>
            <input
              type="text"
              value={webPickerCustomUrl}
              onChange={(e) => setWebPickerCustomUrl(e.target.value)}
              placeholder={inferredBrowserUrl}
              className="w-full px-2 py-1 text-[11px] bg-slate-950 border border-slate-700 rounded text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
            />
            <p className="text-[9px] text-slate-500">
              {isEn
                ? '* If a browser window is already open, it picks directly from the current active tab.'
                : '* 이미 열려 있는 Playwright 브라우저 창이 있으면 현재 보고 있는 페이지에서 즉시 선택합니다.'}
            </p>
          </div>
        )}

        {/* 선택기 실행 / 취소 메인 버튼 */}
        {!webPickerActive ? (
          <button
            type="button"
            onClick={() => handleStartWebPicker(targetFieldKey, extraPatch)}
            className="w-full py-2 px-3 rounded-lg text-xs font-semibold bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 text-white shadow-md shadow-cyan-500/20 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span>
              {buttonLabel ||
                (webElem
                  ? isEn
                    ? 'Reselect Element in Browser'
                    : '브라우저에서 웹 요소 다시 선택'
                  : isEn
                  ? 'Pick Web Element in Browser'
                  : '🎯 브라우저에서 웹 요소 선택')}
            </span>
          </button>
        ) : (
          <div className="space-y-2">
            <div className="p-2.5 rounded-lg bg-cyan-950/60 border border-cyan-500/60 text-[11px] text-cyan-200 space-y-1 animate-pulse">
              <div className="font-semibold text-cyan-300 flex items-center gap-1.5">
                <Crosshair className="w-3.5 h-3.5 text-cyan-400" />
                <span>
                  {isEn
                    ? 'Click target element in the Chrome browser...'
                    : '브라우저 창에서 원하는 웹 요소를 클릭하세요...'}
                </span>
              </div>
              <p className="text-[10px] text-slate-300 leading-relaxed">
                {isEn
                  ? 'Use the top floating bar in the browser to switch between [Pick Mode] and [Normal Navigation Mode] (for login/menus).'
                  : '로그인이나 메뉴 이동이 필요하면 브라우저 상단 바의 [일반 브라우저 조작 전환] 버튼을 눌러 이동한 뒤 다시 선택하세요.'}
              </p>
            </div>
            <button
              type="button"
              onClick={handleCancelWebPicker}
              className="w-full py-1.5 px-3 rounded-lg text-xs font-semibold bg-rose-950/70 hover:bg-rose-900/80 text-rose-200 border border-rose-700/60 transition-colors"
            >
              {isEn ? '✕ Cancel Web Picker (ESC)' : '✕ 웹 요소 선택 취소 (ESC)'}
            </button>
          </div>
        )}

        {webPickerError && (
          <div className="p-2 rounded-lg bg-rose-950/40 border border-rose-800/60 text-[10px] text-rose-300 flex items-start gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
            <span>{webPickerError}</span>
          </div>
        )}

        {/* 선택된 웹 요소 메타데이터 요약 카드 + 원클릭 식별자 전환 버튼 */}
        {webElem && (
          <div className="p-2.5 rounded-lg bg-slate-900/95 border border-slate-800 space-y-2 text-[11px]">
            <div className="flex items-center justify-between gap-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800/70 font-mono text-[10px] shrink-0">
                  &lt;{webElem.tag}&gt;
                </span>
                {webElem.in_iframe && (
                  <span className="px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-700/60 font-semibold text-[9px] shrink-0">
                    iframe 내부
                  </span>
                )}
                <span className="text-slate-200 font-medium truncate" title={webElem.display_name}>
                  {webElem.display_name}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleConfigChange('web_element_data', null)}
                className="text-[10px] text-slate-500 hover:text-rose-400 shrink-0 px-1"
                title={isEn ? 'Clear picked metadata' : '선택 정보 지우기'}
              >
                {isEn ? 'Clear' : '초기화'}
              </button>
            </div>

            {/* 원클릭 Selector 방식 전환 칩 (추천 CSS / XPath / 텍스트·안내문구) */}
            <div className="space-y-1 pt-1 border-t border-slate-800/80">
              <div className="text-[10px] text-slate-400">
                {isEn ? 'Quick Switch Identification Method:' : '식별자 방식 원클릭 전환:'}
              </div>
              <div className="flex flex-wrap gap-1">
                {webElem.css_selector && (
                  <button
                    type="button"
                    onClick={() => {
                      const patch: Record<string, any> = { [targetFieldKey]: webElem.css_selector };
                      if (nodeData.type === 'browser_click' || nodeData.type === 'browser_fill') {
                        patch.selector_type = 'css';
                      }
                      handleMultiConfigChange(patch);
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-all ${
                      currentSelectorVal === webElem.css_selector
                        ? 'bg-cyan-600 text-white border-cyan-500'
                        : 'bg-slate-950 text-slate-300 border-slate-700 hover:border-cyan-600'
                    }`}
                    title={webElem.css_selector}
                  >
                    ✨ CSS Selector
                  </button>
                )}

                {webElem.xpath && (
                  <button
                    type="button"
                    onClick={() => {
                      const patch: Record<string, any> = { [targetFieldKey]: webElem.xpath };
                      if (nodeData.type === 'browser_click' || nodeData.type === 'browser_fill') {
                        patch.selector_type = 'xpath';
                      }
                      handleMultiConfigChange(patch);
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-all ${
                      currentSelectorVal === webElem.xpath
                        ? 'bg-cyan-600 text-white border-cyan-500'
                        : 'bg-slate-950 text-slate-300 border-slate-700 hover:border-cyan-600'
                    }`}
                    title={webElem.xpath}
                  >
                    🧬 XPath
                  </button>
                )}

                {textCandidate && nodeData.type !== 'browser_extract' && (
                  <button
                    type="button"
                    onClick={() => {
                      const patch: Record<string, any> = { [targetFieldKey]: textCandidate };
                      if (nodeData.type === 'browser_click') {
                        patch.selector_type = 'text';
                      } else if (nodeData.type === 'browser_fill') {
                        patch.selector_type = 'placeholder';
                      }
                      handleMultiConfigChange(patch);
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-all ${
                      currentSelectorVal === textCandidate
                        ? 'bg-cyan-600 text-white border-cyan-500'
                        : 'bg-slate-950 text-slate-300 border-slate-700 hover:border-cyan-600'
                    }`}
                    title={textCandidate}
                  >
                    🔤 {nodeData.type === 'browser_fill' ? '안내문구(Placeholder)' : '화면 텍스트'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="w-80 bg-slate-900 border-l border-slate-800 flex flex-col h-full select-none">
      <div className="p-4 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isStart && <Play className="w-4 h-4 text-emerald-400 fill-current" />}
          {isEnd && <Flag className="w-4 h-4 text-rose-400" />}
          {isAi && <Sparkles className="w-4 h-4 text-purple-400" />}
          {isAgent && <Bot className="w-4 h-4 text-indigo-400" />}
          {subtype === 'mouse_drag' && <Hand className="w-4 h-4 text-indigo-400" />}
          {subtype === 'mouse_scroll' && <ArrowUpDown className="w-4 h-4 text-sky-400" />}
          {subtype === 'clipboard_read' && <ClipboardPaste className="w-4 h-4 text-violet-400" />}
          {subtype === 'file_read' && <FileText className="w-4 h-4 text-emerald-400" />}
          {subtype === 'file_write' && <Save className="w-4 h-4 text-teal-400" />}
          {subtype === 'message_box' && <MessageSquare className="w-4 h-4 text-amber-400" />}
          {subtype === 'screenshot' && <Camera className="w-4 h-4 text-teal-400" />}
          {subtype === 'launch_program' && <Rocket className="w-4 h-4 text-orange-400" />}
          {subtype === 'window_close' && <XCircle className="w-4 h-4 text-rose-400" />}
          {subtype === 'close_program' && <Power className="w-4 h-4 text-amber-400" />}
          {subtype === 'kill_process' && <Ban className="w-4 h-4 text-rose-500" />}
          {isGroup && <FolderKanban className="w-4 h-4 text-teal-400" />}
          {isSubflow && <GitBranchPlus className="w-4 h-4 text-cyan-400" />}
          <h2 className="text-sm font-semibold text-slate-200">
            {isStart
              ? (isEn ? 'Start Node Properties' : '시작 노드 속성')
              : isEnd
              ? (isEn ? 'End Node Properties' : '끝 노드 속성')
              : isGroup
              ? (isEn ? 'Group Node Properties' : '그룹 노드 속성')
              : isSubflow
              ? (isEn ? 'Sub-Workflow Call Properties' : '다른 워크플로우 호출 속성')
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

      <div
        className="flex-1 overflow-y-auto p-4 space-y-4"
        onFocusCapture={handleInspectorSelectOrFocus}
        onClickCapture={handleInspectorSelectOrFocus}
        onKeyUpCapture={handleInspectorSelectOrFocus}
        onDragOverCapture={(e) => {
          if (e.dataTransfer.types.includes('application/x-praxis-variable')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDropCapture={handleInspectorDropCapture}
      >
        {/* 노드 이름 */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">{t('inspector.nodeNameLabel')}</label>
          <input
            type="text"
            data-ignore-var-focus="true"
            value={nodeData.label}
            onChange={(e) => handleLabelChange(e.target.value)}
            className="w-full px-3 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* 노드 주석 (부가 설명) */}
        <div>
          <div className="flex items-center justify-between gap-1 mb-1">
            <label className="text-xs font-medium text-amber-300/90 flex items-center gap-1.5">
              <StickyNote className="w-3.5 h-3.5 text-amber-400" />
              <span>{t('inspector.nodeNoteLabel')}</span>
            </label>
            {Boolean((cfg.note ?? (isGroup ? cfg.description ?? '' : '')).trim()) && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleConfigChange('note_collapsed', !cfg.note_collapsed)}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950/60 hover:bg-amber-900/70 text-amber-300 border border-amber-700/50 transition-colors flex items-center gap-0.5 cursor-pointer"
                  title={cfg.note_collapsed ? t('nodes.expandNote') : t('nodes.collapseNote')}
                >
                  {cfg.note_collapsed ? (
                    <ChevronRight className="w-3 h-3" />
                  ) : (
                    <ChevronDown className="w-3 h-3" />
                  )}
                  <span>{cfg.note_collapsed ? t('nodes.expandNote') : t('nodes.collapseNote')}</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleMultiConfigChange({
                      note: '',
                      note_collapsed: false,
                      ...(isGroup ? { description: '' } : {}),
                    })
                  }
                  className="text-[10px] text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
                  title={t('inspector.nodeNoteClear')}
                >
                  {t('inspector.nodeNoteClear')}
                </button>
              </div>
            )}
          </div>
          <textarea
            rows={2}
            data-ignore-var-focus="true"
            value={cfg.note ?? (isGroup ? cfg.description ?? '' : '')}
            onChange={(e) => {
              const val = e.target.value;
              if (isGroup && cfg.description !== undefined && cfg.note === undefined) {
                handleMultiConfigChange({ note: val, description: val });
              } else {
                handleConfigChange('note', val);
              }
            }}
            placeholder={t('inspector.nodeNotePlaceholder')}
            className="w-full px-3 py-1.5 text-xs bg-slate-950 border border-slate-700/90 rounded-lg text-amber-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-500/80 resize-y leading-relaxed"
          />
        </div>

        {/* 텍스트 속성을 가진 노드에 대해 클릭/드래그 변수 간편 삽입 바 제공 */}
        {!isMarker && nodeTextFields.length > 0 && (
          <div className="p-2.5 rounded-xl bg-slate-950/90 border border-emerald-900/50 space-y-2">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1">
                <Variable className="w-3.5 h-3.5" />
                {t('variables.quickInsertLabel')}
              </span>
              {nodeTextFields.length > 1 ? (
                <select
                  value={activeTextKey}
                  onChange={(e) => setActiveTextKey(e.target.value)}
                  className="px-1.5 py-0.5 text-[10px] bg-slate-900 border border-slate-700 rounded text-slate-300 focus:outline-none"
                  title="변수를 삽입할 대상 속성"
                >
                  {nodeTextFields.map((f) => (
                    <option key={f.key} value={f.key}>
                      대상: {f.label}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-[10px] text-slate-400">
                  대상: {nodeTextFields[0].label}
                </span>
              )}
            </div>

            {/* 선언 변수 + 주요 시스템 변수 칩 목록 */}
            <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto custom-scrollbar">
              {variables.map((v) => (
                <button
                  key={v.name}
                  type="button"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-praxis-variable', v.name);
                    e.dataTransfer.setData('text/plain', `{{${v.name}}}`);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => insertVariableToken(v.name)}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-950/70 hover:bg-emerald-900 border border-emerald-700/60 text-[10px] font-mono text-emerald-200 cursor-pointer transition-colors"
                  title={`클릭 또는 드래그하여 {{${v.name}}} (${v.type}) 삽입`}
                >
                  <GripVertical className="w-2.5 h-2.5 opacity-60" />
                  <span>{`{{${v.name}}}`}</span>
                </button>
              ))}
              {SYSTEM_VARIABLES.slice(0, 4).map((sv) => (
                <button
                  key={sv.name}
                  type="button"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-praxis-variable', sv.name);
                    e.dataTransfer.setData('text/plain', `{{${sv.name}}}`);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => insertVariableToken(sv.name)}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] font-mono text-slate-300 cursor-pointer transition-colors"
                  title={`${sv.description} (시스템 변수)`}
                >
                  <span>{`{{${sv.name}}}`}</span>
                </button>
              ))}
            </div>

            {/* 텍스트 내 미선언 {{변수}} 참조 감지 시 즉시 선언 경고 표시 */}
            {undeclaredReferencedVars.length > 0 && (
              <div className="p-2 rounded-lg bg-rose-950/50 border border-rose-800/70 space-y-1.5 text-[10px]">
                <div className="text-rose-300 font-medium flex items-start gap-1">
                  <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                  <span>
                    선언되지 않은 변수 참조 감지: {undeclaredReferencedVars.map((v) => `{{${v}}}`).join(', ')}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {undeclaredReferencedVars.map((uVar) => (
                    <button
                      key={uVar}
                      type="button"
                      onClick={() => {
                        if (onDeclareVariable && !validateVariableNameFormat(uVar)) {
                          onDeclareVariable({
                            name: uVar,
                            type: 'string',
                            defaultValue: '',
                            description: `${nodeData.label} 참조 변수`,
                          });
                        }
                      }}
                      className="px-2 py-0.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-semibold flex items-center gap-0.5"
                    >
                      <Plus className="w-2.5 h-2.5" />
                      <span>'{uVar}' 변수 즉시 선언</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

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

          {/* 1. 마우스 드래그 앤 드롭 노드 (Mouse Drag & Drop) */}
          {subtype === 'mouse_drag' && (
            <div className="space-y-4">
              {/* 드래그 시작 지점 설정 */}
              <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold text-indigo-300 flex items-center gap-1">
                    <span>①</span> {isEn ? 'Drag Start Point' : '드래그 시작 지점 (From)'}
                  </label>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-950/60 text-indigo-300 border border-indigo-800/50">
                    {(cfg.start_mode || 'coordinate') === 'object' ? (isEn ? 'Object' : '오브젝트') : (isEn ? 'Coordinate' : '좌표')}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-900 rounded-lg border border-slate-800">
                  <button
                    type="button"
                    onClick={() => handleConfigChange('start_mode', 'coordinate')}
                    className={`py-1 text-xs rounded-md font-medium transition-all ${
                      (cfg.start_mode || 'coordinate') === 'coordinate'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {isEn ? 'Coordinate' : '좌표 지정'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleConfigChange('start_mode', 'object')}
                    className={`py-1 text-xs rounded-md font-medium transition-all ${
                      cfg.start_mode === 'object'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {isEn ? 'UI Object' : '오브젝트 선택'}
                  </button>
                </div>

                {(cfg.start_mode || 'coordinate') === 'coordinate' ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-slate-400">{isEn ? 'Start X (px)' : '시작 X 좌표'}</label>
                      <input
                        type="number"
                        value={cfg.start_x ?? 300}
                        onChange={(e) => handleConfigChange('start_x', Number(e.target.value))}
                        className="w-full px-2.5 py-1 text-xs bg-slate-900 border border-slate-700 rounded text-slate-200 mt-1"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400">{isEn ? 'Start Y (px)' : '시작 Y 좌표'}</label>
                      <input
                        type="number"
                        value={cfg.start_y ?? 300}
                        onChange={(e) => handleConfigChange('start_y', Number(e.target.value))}
                        className="w-full px-2.5 py-1 text-xs bg-slate-900 border border-slate-700 rounded text-slate-200 mt-1"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {cfg.start_object_data ? (
                      <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-medium text-indigo-300 truncate max-w-[130px]">
                            🎯 {cfg.start_object_data.name || '시작 오브젝트'}
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => onOpenObjectPicker?.('start_object_data')}
                              className="text-[10px] text-slate-300 hover:text-white px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700"
                            >
                              {isEn ? 'Reselect' : '다시 선택'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleConfigChange('start_object_data', null)}
                              className="text-[10px] text-rose-400 hover:text-rose-300 px-1.5 py-0.5 rounded bg-rose-950/40"
                            >
                              {isEn ? 'Remove' : '제거'}
                            </button>
                          </div>
                        </div>
                        {(cfg.start_object_data.base64_image || cfg.start_object_data.image_url) && (
                          <div className="rounded bg-slate-950 border border-slate-800 p-1.5 flex items-center justify-center max-h-[70px] overflow-hidden">
                            <img
                              src={cfg.start_object_data.base64_image || resolveImageUrl(cfg.start_object_data.image_url)}
                              alt={cfg.start_object_data.name}
                              className="max-h-[60px] object-contain rounded"
                            />
                          </div>
                        )}
                        <div className="text-[10px] text-slate-400 flex justify-between">
                          <span className="truncate">{cfg.start_object_data.window_title || '-'}</span>
                          <span className="font-mono text-indigo-400">({cfg.start_object_data.x}, {cfg.start_object_data.y})</span>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onOpenObjectPicker?.('start_object_data')}
                        className="w-full py-2 px-3 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 text-xs font-medium flex items-center justify-center gap-1.5 transition-all"
                      >
                        <Crosshair className="w-3.5 h-3.5" />
                        {isEn ? 'Pick Start Object from Screen' : '시작 UI 오브젝트 선택하기'}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* 드롭 끝 지점 설정 */}
              <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold text-cyan-300 flex items-center gap-1">
                    <span>②</span> {isEn ? 'Drop End Point' : '드롭 끝 지점 (To)'}
                  </label>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950/60 text-cyan-300 border border-cyan-800/50">
                    {(cfg.end_mode || 'coordinate') === 'object' ? (isEn ? 'Object' : '오브젝트') : (isEn ? 'Coordinate' : '좌표')}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-900 rounded-lg border border-slate-800">
                  <button
                    type="button"
                    onClick={() => handleConfigChange('end_mode', 'coordinate')}
                    className={`py-1 text-xs rounded-md font-medium transition-all ${
                      (cfg.end_mode || 'coordinate') === 'coordinate'
                        ? 'bg-cyan-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {isEn ? 'Coordinate' : '좌표 지정'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleConfigChange('end_mode', 'object')}
                    className={`py-1 text-xs rounded-md font-medium transition-all ${
                      cfg.end_mode === 'object'
                        ? 'bg-cyan-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {isEn ? 'UI Object' : '오브젝트 선택'}
                  </button>
                </div>

                {(cfg.end_mode || 'coordinate') === 'coordinate' ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-slate-400">{isEn ? 'End X (px)' : '끝 X 좌표'}</label>
                      <input
                        type="number"
                        value={cfg.end_x ?? 600}
                        onChange={(e) => handleConfigChange('end_x', Number(e.target.value))}
                        className="w-full px-2.5 py-1 text-xs bg-slate-900 border border-slate-700 rounded text-slate-200 mt-1"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400">{isEn ? 'End Y (px)' : '끝 Y 좌표'}</label>
                      <input
                        type="number"
                        value={cfg.end_y ?? 300}
                        onChange={(e) => handleConfigChange('end_y', Number(e.target.value))}
                        className="w-full px-2.5 py-1 text-xs bg-slate-900 border border-slate-700 rounded text-slate-200 mt-1"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {cfg.end_object_data ? (
                      <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-medium text-cyan-300 truncate max-w-[130px]">
                            🎯 {cfg.end_object_data.name || '끝 오브젝트'}
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => onOpenObjectPicker?.('end_object_data')}
                              className="text-[10px] text-slate-300 hover:text-white px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700"
                            >
                              {isEn ? 'Reselect' : '다시 선택'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleConfigChange('end_object_data', null)}
                              className="text-[10px] text-rose-400 hover:text-rose-300 px-1.5 py-0.5 rounded bg-rose-950/40"
                            >
                              {isEn ? 'Remove' : '제거'}
                            </button>
                          </div>
                        </div>
                        {(cfg.end_object_data.base64_image || cfg.end_object_data.image_url) && (
                          <div className="rounded bg-slate-950 border border-slate-800 p-1.5 flex items-center justify-center max-h-[70px] overflow-hidden">
                            <img
                              src={cfg.end_object_data.base64_image || resolveImageUrl(cfg.end_object_data.image_url)}
                              alt={cfg.end_object_data.name}
                              className="max-h-[60px] object-contain rounded"
                            />
                          </div>
                        )}
                        <div className="text-[10px] text-slate-400 flex justify-between">
                          <span className="truncate">{cfg.end_object_data.window_title || '-'}</span>
                          <span className="font-mono text-cyan-400">({cfg.end_object_data.x}, {cfg.end_object_data.y})</span>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onOpenObjectPicker?.('end_object_data')}
                        className="w-full py-2 px-3 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/40 text-xs font-medium flex items-center justify-center gap-1.5 transition-all"
                      >
                        <Crosshair className="w-3.5 h-3.5" />
                        {isEn ? 'Pick End Object from Screen' : '끝 UI 오브젝트 선택하기'}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* 마우스 버튼 및 이동 방식 */}
              <div className="pt-2 border-t border-slate-800 space-y-3">
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">
                    {isEn ? 'Mouse Button' : '드래그 마우스 버튼'}
                  </label>
                  <select
                    value={cfg.button || 'left'}
                    onChange={(e) => handleConfigChange('button', e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200"
                  >
                    <option value="left">{isEn ? 'Left Button (Default)' : '좌클릭 드래그 (기본)'}</option>
                    <option value="right">{isEn ? 'Right Button' : '우클릭 드래그'}</option>
                    <option value="middle">{isEn ? 'Middle Button' : '가운데 휠 버튼 드래그'}</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">
                    {isEn ? 'Mouse Movement Style' : '마우스 이동 방식'}
                  </label>
                  <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-950 rounded-lg border border-slate-800">
                    <button
                      type="button"
                      onClick={() => handleConfigChange('move_mode', 'instant')}
                      className={`py-1 text-xs rounded-md font-medium transition-all flex items-center justify-center gap-1 ${
                        cfg.move_mode === 'instant'
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
                        (cfg.move_mode || 'smooth') === 'smooth'
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Move className="w-3 h-3" />
                      {isEn ? 'Smooth' : '부드러운 이동'}
                    </button>
                  </div>
                </div>

                {(cfg.move_mode || 'smooth') === 'smooth' && (
                  <div className="p-2.5 bg-slate-950 rounded-lg border border-slate-800 space-y-1.5">
                    <div className="flex justify-between items-center text-[11px] text-slate-400">
                      <span>{isEn ? 'Drag Duration (sec)' : '드래그 이동 시간 (초)'}</span>
                      <span className="font-mono text-blue-400">{cfg.duration ?? 0.5}{isEn ? 's' : '초'}</span>
                    </div>
                    <input
                      type="number"
                      step="0.1"
                      min="0.05"
                      max="10"
                      value={cfg.duration ?? 0.5}
                      onChange={(e) => handleConfigChange('duration', Math.max(0.05, Number(e.target.value)))}
                      className="w-full px-2.5 py-1 text-xs bg-slate-900 border border-slate-700 rounded text-slate-200"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 2. 마우스 스크롤 노드 (Mouse Scroll) */}
          {subtype === 'mouse_scroll' && (
            <div className="space-y-3.5">
              {/* 스크롤 대상 모드: 오브젝트 선택(기본값) vs 현재 활성창 */}
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">
                  {isEn ? 'Scroll Target Mode' : '스크롤 대상 지정 방식'}
                </label>
                <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-950 rounded-lg border border-slate-800">
                  <button
                    type="button"
                    onClick={() => handleConfigChange('target_mode', 'object')}
                    className={`py-1.5 text-xs rounded-md font-medium transition-all flex items-center justify-center gap-1 ${
                      (cfg.target_mode || 'object') === 'object'
                        ? 'bg-sky-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Crosshair className="w-3 h-3" />
                    {isEn ? 'Select Object (Default)' : '오브젝트 선택 (기본)'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMultiConfigChange({ target_mode: 'current', distance_mode: 'ticks' })}
                    className={`py-1.5 text-xs rounded-md font-medium transition-all flex items-center justify-center gap-1 ${
                      cfg.target_mode === 'current'
                        ? 'bg-sky-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <AppWindow className="w-3 h-3" />
                    {isEn ? 'Current Active Window' : '현재 활성창'}
                  </button>
                </div>
              </div>

              {/* 오브젝트 선택 모드일 때: 타겟 오브젝트 선택 카드 */}
              {(cfg.target_mode || 'object') === 'object' && (
                <div className="space-y-2.5">
                  {cfg.object_data ? (
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-sky-400 flex items-center gap-1">
                          <Crosshair className="w-3.5 h-3.5" />
                          {isEn ? 'Scroll Target Object' : '선택된 스크롤 대상 오브젝트'}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onOpenObjectPicker?.('object_data')}
                            className="text-[10px] text-slate-400 hover:text-slate-200 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 flex items-center gap-1"
                          >
                            <RotateCcw className="w-2.5 h-2.5" /> {isEn ? 'Reselect' : '다시 선택'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleConfigChange('object_data', null)}
                            className="text-[10px] text-rose-400 hover:text-rose-300 px-1.5 py-0.5 rounded bg-rose-950/40"
                          >
                            {isEn ? 'Remove' : '제거'}
                          </button>
                        </div>
                      </div>

                      {(cfg.object_data.base64_image || cfg.object_data.image_url) && (
                        <div className="rounded-lg bg-slate-900 border border-slate-800/80 p-2 flex items-center justify-center max-h-[90px] overflow-hidden">
                          <img
                            src={cfg.object_data.base64_image || resolveImageUrl(cfg.object_data.image_url)}
                            alt={cfg.object_data.name}
                            className="max-h-[75px] object-contain rounded"
                          />
                        </div>
                      )}

                      <div className="text-[11px] space-y-1 bg-slate-900/60 p-2 rounded-lg border border-slate-800/60">
                        <div className="flex justify-between">
                          <span className="text-slate-500">{isEn ? 'Element:' : '요소명:'}</span>
                          <span className="text-slate-200 font-medium truncate max-w-[150px]">{cfg.object_data.name || '-'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">{isEn ? 'Window:' : '창 제목:'}</span>
                          <span className="text-slate-300 truncate max-w-[150px]">{cfg.object_data.window_title || '-'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">{isEn ? 'Control:' : '컨트롤:'}</span>
                          <span className="text-sky-400 font-mono text-[10px]">{cfg.object_data.control_type || '-'}</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onOpenObjectPicker?.('object_data')}
                      className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-lg shadow-sky-600/20 transition-all"
                    >
                      <Crosshair className="w-4 h-4" />
                      {isEn ? 'Pick Scrollable UI Object' : '화면에서 스크롤할 오브젝트 선택'}
                    </button>
                  )}

                  <div className="p-2.5 bg-sky-950/25 border border-sky-900/50 rounded-lg text-[10px] text-slate-300 leading-relaxed">
                    💡 {isEn
                      ? 'Automatically focuses the selected UI object right before scrolling, resolves nested scrollbars via UIA ScrollPattern / Win32 ScrollInfo, and scrolls without keyboard shortcuts.'
                      : '스크롤 직전 선택한 UI 오브젝트에 자동 포커스(Focus)를 맞춘 뒤, 중첩된 하위 스크롤 컨테이너까지 개별 식별하여 키보드 단축키 없이 정밀 스크롤합니다.'}
                  </div>
                </div>
              )}

              {/* 스크롤 방향: 상하(기본값) / 좌우 */}
              <div className="pt-2 border-t border-slate-800">
                <label className="text-[11px] text-slate-400 block mb-1">
                  {isEn ? 'Scroll Axis Direction' : '스크롤 방향'}
                </label>
                <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-950 rounded-lg border border-slate-800">
                  <button
                    type="button"
                    onClick={() => handleConfigChange('direction', 'vertical')}
                    className={`py-1.5 text-xs rounded-md font-medium transition-all ${
                      (cfg.direction || 'vertical') === 'vertical'
                        ? 'bg-sky-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    ↕️ {isEn ? 'Vertical (Default)' : '상하 (기본값)'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleConfigChange('direction', 'horizontal')}
                    className={`py-1.5 text-xs rounded-md font-medium transition-all ${
                      cfg.direction === 'horizontal'
                        ? 'bg-sky-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    ↔️ {isEn ? 'Horizontal' : '좌우 (수평)'}
                  </button>
                </div>
              </div>

              {/* 현재 활성창 모드 + 좌우 방향 선택 시 주의 문구 */}
              {cfg.target_mode === 'current' && cfg.direction === 'horizontal' && (
                <div className="p-2.5 bg-amber-950/40 border border-amber-700/60 rounded-xl flex items-start gap-2 text-amber-300 text-[10px] leading-relaxed">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
                  <div>
                    <div className="font-semibold text-amber-200">
                      {isEn ? 'Horizontal Scroll Notice (Current Window Mode)' : '현재 활성창 좌우 스크롤 유의사항'}
                    </div>
                    <p className="mt-0.5 text-amber-300/90">
                      {isEn
                        ? 'In "Current Active Window" mode, horizontal wheel signals (MOUSEEVENTF_HWHEEL) may not work in applications that do not natively handle horizontal mouse wheels. Use [Select Object] mode for guaranteed horizontal scrolling.'
                        : '\'현재 활성창\' 모드에서는 좌우 방향 스크롤 신호(가로 마우스 휠)를 지원하지 않는 일부 프로그램에서 좌우 스크롤이 동작하지 않을 수 있습니다. 확실한 좌우 스크롤이 필요한 경우 [오브젝트 선택] 모드를 권장합니다.'}
                    </p>
                  </div>
                </div>
              )}

              {/* 스크롤 거리 옵션 */}
              <div className="pt-2 border-t border-slate-800 space-y-2.5">
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">
                    {isEn ? 'Scroll Distance Mode' : '스크롤 이동 거리 방식'}
                  </label>
                  {cfg.target_mode === 'current' ? (
                    <div className="space-y-1.5">
                      <div className="px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-lg text-sky-300 font-medium">
                        ⚙️ {isEn ? 'Wheel Ticks Only (Active Window Mode)' : '휠 칸수 지정 (현재 활성창 모드 전용)'}
                      </div>
                      <p className="text-[10px] text-slate-500 leading-relaxed">
                        {isEn
                          ? '※ In Current Active Window mode, only Wheel Ticks can be specified since wheel signals are sent directly without inspecting UI scrollbars.'
                          : '※ \'현재 활성창\' 모드에서는 스크롤바 유무를 판별하지 않고 활성 창에 마우스 휠 신호를 직접 전송하므로 \'휠 칸수\'만 지정 가능합니다.'}
                      </p>
                    </div>
                  ) : (
                    <select
                      value={cfg.distance_mode || 'ticks'}
                      onChange={(e) => handleConfigChange('distance_mode', e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-sky-500"
                    >
                      <option value="ticks">
                        {isEn ? 'Wheel Ticks (Count)' : '휠 칸수 지정 (Wheel Ticks)'}
                      </option>
                      <option value="page_down">
                        {isEn
                          ? 'One Page Backward (Page Down effect · Non-shortcut)'
                          : cfg.direction === 'horizontal'
                          ? '한 페이지 뒤로 (오른쪽 한 화면 이동 · 비단축키)'
                          : '한 페이지 뒤로 (Page Down과 동일 효과 · 비단축키)'}
                      </option>
                      <option value="page_up">
                        {isEn
                          ? 'One Page Forward (Page Up effect · Non-shortcut)'
                          : cfg.direction === 'horizontal'
                          ? '한 페이지 앞으로 (왼쪽 한 화면 이동 · 비단축키)'
                          : '한 페이지 앞으로 (Page Up과 동일 효과 · 비단축키)'}
                      </option>
                      <option value="end">
                        {isEn
                          ? 'To the Very End (End effect · Boundary detected)'
                          : '맨 끝으로 (End 키와 동일 효과 · 끝 도달 감지)'}
                      </option>
                      <option value="home">
                        {isEn
                          ? 'To the Very Beginning (Home effect · Boundary detected)'
                          : '맨 처음으로 (Home 키와 동일 효과 · 처음 도달 감지)'}
                      </option>
                    </select>
                  )}
                </div>

                {/* 휠 칸수 모드일 때: 세부 방향(아래/위 또는 오른쪽/왼쪽) 및 칸수 입력 */}
                {(cfg.target_mode === 'current' || (cfg.distance_mode || 'ticks') === 'ticks') && (
                  <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2.5">
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">
                        {isEn ? 'Wheel Direction' : '휠 회전 방향'}
                      </label>
                      <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-900 rounded-lg border border-slate-800">
                        <button
                          type="button"
                          onClick={() => handleConfigChange('ticks_direction', 'backward')}
                          className={`py-1 text-xs rounded font-medium transition-all ${
                            (cfg.ticks_direction || 'backward') === 'backward'
                              ? 'bg-sky-600 text-white'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {cfg.direction === 'horizontal'
                            ? (isEn ? '▶ Scroll Right' : '▶ 오른쪽으로 이동')
                            : (isEn ? '▼ Scroll Down' : '▼ 아래로 내리기')}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleConfigChange('ticks_direction', 'forward')}
                          className={`py-1 text-xs rounded font-medium transition-all ${
                            cfg.ticks_direction === 'forward'
                              ? 'bg-sky-600 text-white'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {cfg.direction === 'horizontal'
                            ? (isEn ? '◀ Scroll Left' : '◀ 왼쪽으로 이동')
                            : (isEn ? '▲ Scroll Up' : '▲ 위로 올리기')}
                        </button>
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between items-center text-[11px] text-slate-400 mb-1">
                        <span>{isEn ? 'Wheel Ticks Count' : '스크롤 휠 칸수'}</span>
                        <span className="font-mono text-sky-400">{cfg.ticks ?? 5}{isEn ? ' ticks' : '칸'}</span>
                      </div>
                      <input
                        type="number"
                        min="1"
                        max="200"
                        value={cfg.ticks ?? 5}
                        onChange={(e) => handleConfigChange('ticks', Math.max(1, Number(e.target.value)))}
                        className="w-full px-2.5 py-1 text-xs bg-slate-900 border border-slate-700 rounded text-slate-200"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 3. 클립보드 읽기 노드 (Clipboard Read) */}
          {subtype === 'clipboard_read' && (
            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-slate-400 font-medium">
                  {isEn ? 'Variable Name to Store Clipboard Text' : '저장할 변수명 (Output Variable)'}
                </label>
                {renderOutputVariableSelector('clipboard_text', ['string', 'json'], 'border-violet-700 text-violet-300')}
              </div>
              <div className="p-2.5 bg-violet-950/25 border border-violet-900/50 rounded-xl text-[10px] text-slate-300 leading-relaxed space-y-1">
                <div className="font-semibold text-violet-300">
                  📋 {isEn ? 'How to Reference in Next Nodes' : '후속 노드에서 참조하는 방법'}
                </div>
                <p>
                  {isEn
                    ? `Reads current Windows clipboard text and saves it to {{${cfg.output_variable || 'clipboard_text'}}} and {{last_output}}.`
                    : `현재 윈도우 클립보드에 들어있는 텍스트를 읽어와 {{${cfg.output_variable || 'clipboard_text'}}} 및 {{last_output}} 변수에 저장합니다.`}
                </p>
              </div>
            </div>
          )}

          {/* 4. 텍스트 파일 읽기 노드 (Text File Read) */}
          {subtype === 'file_read' && (
            <div className="space-y-3.5">
              <div>
                <label className="text-[11px] text-slate-400 font-medium">
                  {isEn ? 'File Path to Read' : '읽어올 텍스트 파일 경로'} <span className="text-emerald-400">*</span>
                </label>
                <div className="flex gap-1.5 mt-1">
                  <input
                    type="text"
                    data-config-key="file_path"
                    value={cfg.file_path || ''}
                    onChange={(e) => handleConfigChange('file_path', e.target.value)}
                    placeholder={isEn ? 'e.g. C:\\Data\\memo.txt' : '예: C:\\Data\\memo.txt'}
                    className="flex-1 px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => handleBrowseFileForKey('file_path', '.txt,.csv,.json,.md,.log,.xml,.yaml,.yml,*')}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs flex items-center gap-1 shrink-0"
                    title={isEn ? 'Browse File' : '파일 찾아보기'}
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-emerald-400" />
                  </button>
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  {isEn ? 'Supports {{variable}} replacement in path.' : '경로에 {{변수명}} 치환을 사용할 수 있습니다.'}
                </div>
              </div>

              <div>
                <label className="text-[11px] text-slate-400">
                  {isEn ? 'Text Encoding' : '파일 인코딩'}
                </label>
                <select
                  value={cfg.encoding || 'utf-8'}
                  onChange={(e) => handleConfigChange('encoding', e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 mt-1"
                >
                  <option value="utf-8">UTF-8 ({isEn ? 'Default/Auto' : '기본/자동감지'})</option>
                  <option value="cp949">CP949 / EUC-KR ({isEn ? 'Korean ANSI' : '한글 윈도우'})</option>
                  <option value="utf-16">UTF-16</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] text-slate-400 font-medium">
                  {isEn ? 'Output Variable' : '저장할 변수명 (Output Variable)'}
                </label>
                {renderOutputVariableSelector('file_content', ['string', 'json'], 'border-emerald-700 text-emerald-300')}
              </div>
            </div>
          )}

          {/* 5. 파일 쓰기 노드 (File Write) */}
          {subtype === 'file_write' && (
            <div className="space-y-3.5">
              <div>
                <label className="text-[11px] text-slate-400 font-medium">
                  {isEn ? 'File Path to Save' : '파일을 저장할 경로'} <span className="text-teal-400">*</span>
                </label>
                <div className="flex gap-1.5 mt-1">
                  <input
                    type="text"
                    data-config-key="file_path"
                    value={cfg.file_path || ''}
                    onChange={(e) => handleConfigChange('file_path', e.target.value)}
                    placeholder={isEn ? 'e.g. C:\\Temp\\result_{{date}}.txt' : '예: C:\\Temp\\result_{{date}}.txt'}
                    className="flex-1 px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono focus:outline-none focus:border-teal-500"
                  />
                  <button
                    type="button"
                    onClick={() => handleBrowseFileForKey('file_path', '.txt,.csv,.json,.md,.log,*')}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs flex items-center gap-1 shrink-0"
                    title={isEn ? 'Browse File' : '파일 경로 선택'}
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-teal-400" />
                  </button>
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  {isEn
                    ? 'Supports {{variable}}, {{timestamp}}, {{date}}, {{time}}.'
                    : '{{변수명}}, {{timestamp}}, {{date}}, {{time}} 치환을 지원합니다.'}
                </div>
              </div>

              <div>
                <label className="text-[11px] text-slate-400 font-medium">
                  {isEn ? 'Content to Write' : '파일에 쓸 입력값 (텍스트 또는 변수)'}
                </label>
                <textarea
                  rows={4}
                  data-config-key="content"
                  value={cfg.content ?? ''}
                  onChange={(e) => handleConfigChange('content', e.target.value)}
                  placeholder={isEn ? 'Enter text or {{variable}} to save...' : '직접 텍스트를 입력하거나 {{last_output}}, {{변수명}}을 입력하세요.'}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 mt-1 focus:outline-none focus:border-teal-500"
                />
              </div>

              {/* 덮어쓰기 여부 체크박스 */}
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(cfg.overwrite)}
                    onChange={(e) => handleConfigChange('overwrite', e.target.checked)}
                    className="mt-0.5 rounded bg-slate-900 border-slate-700 text-teal-600 focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                  />
                  <span className="text-xs font-medium text-slate-200">
                    {isEn ? 'Allow Overwrite Existing File' : '기존 파일 덮어쓰기 허용 (Overwrite)'}
                  </span>
                </label>
                <div className={`text-[10px] leading-relaxed pl-5.5 ${cfg.overwrite ? 'text-teal-300/90' : 'text-amber-300/90'}`}>
                  {cfg.overwrite
                    ? (isEn
                        ? '✔ Overwrites the file if it already exists at the target path.'
                        : '✔ 지정한 경로에 파일이 이미 존재하면 새로운 내용으로 덮어씁니다.')
                    : (isEn
                        ? '⚠️ When unchecked, if the file already exists, an error (FileExistsError) is raised and the workflow stops safely.'
                        : '⚠️ 선택 해제 상태에서는 동일한 경로에 파일이 이미 존재할 경우 오류(ERROR)를 발생시켜 덮어쓰기를 방지하고 워크플로우를 중단합니다.')}
                </div>
              </div>
            </div>
          )}

          {/* 6. 사용자 대화상자 출력 노드 (User Message Box) */}
          {subtype === 'message_box' && (
            <div className="space-y-3.5">
              {/* 1) 타이틀 */}
              <div>
                <label className="text-[11px] text-slate-400 font-medium">
                  {isEn ? 'Dialog Title' : '대화상자 타이틀'}
                </label>
                <input
                  type="text"
                  data-config-key="title"
                  value={cfg.title ?? '알림'}
                  onChange={(e) => handleConfigChange('title', e.target.value)}
                  placeholder={isEn ? 'e.g. Notice, Confirmation' : '예: 알림, 작업 확인'}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 mt-1 focus:outline-none focus:border-amber-500"
                />
              </div>

              {/* 2) 메시지 유형 (정보 / 경고 / 오류) */}
              <div>
                <label className="text-[11px] text-slate-400 font-medium block mb-1">
                  {isEn ? 'Message Type (Icon)' : '메시지 유형'}
                </label>
                <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-950 rounded-lg border border-slate-800">
                  <button
                    type="button"
                    onClick={() => handleConfigChange('message_type', 'info')}
                    className={`py-1.5 text-xs rounded-md font-medium transition-all ${
                      (cfg.message_type || 'info') === 'info'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    ℹ️ {isEn ? 'Info' : '정보'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleConfigChange('message_type', 'warning')}
                    className={`py-1.5 text-xs rounded-md font-medium transition-all ${
                      cfg.message_type === 'warning'
                        ? 'bg-amber-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    ⚠️ {isEn ? 'Warning' : '경고'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleConfigChange('message_type', 'error')}
                    className={`py-1.5 text-xs rounded-md font-medium transition-all ${
                      cfg.message_type === 'error'
                        ? 'bg-rose-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    🚨 {isEn ? 'Error' : '오류'}
                  </button>
                </div>
              </div>

              {/* 3) 메시지 본문 */}
              <div>
                <label className="text-[11px] text-slate-400 font-medium">
                  {isEn ? 'Message Body' : '메시지 본문'}
                </label>
                <textarea
                  rows={3}
                  data-config-key="message"
                  value={cfg.message ?? ''}
                  onChange={(e) => handleConfigChange('message', e.target.value)}
                  placeholder={isEn ? 'Enter message body ({{variable}} supported)...' : '대화상자에 표시할 본문을 입력하세요. ({{변수명}} 치환 가능)'}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 mt-1 focus:outline-none focus:border-amber-500"
                />
              </div>

              {/* 4) 버튼 유형 (확인만 / 예·아니오 / 계속·중지) */}
              <div>
                <label className="text-[11px] text-slate-400 font-medium block mb-1">
                  {isEn ? 'Button Type & Action' : '버튼 유형'}
                </label>
                <select
                  value={cfg.button_type || 'ok'}
                  onChange={(e) => handleConfigChange('button_type', e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-amber-500"
                >
                  <option value="ok">{isEn ? 'OK Only (Confirm)' : "'확인' 버튼만 (단순 알림)"}</option>
                  <option value="yes_no">{isEn ? 'Yes / No (Save True/False to variable)' : "'예 / 아니오' (True / False 변수 저장)"}</option>
                  <option value="continue_stop">{isEn ? 'Continue / Stop (Stop aborts workflow)' : "'계속 / 중지' ('중지' 클릭 시 워크플로우 즉시 종료)"}</option>
                </select>
              </div>

              {/* 예/아니오 선택 시: boolean 결과 저장 변수명 */}
              {cfg.button_type === 'yes_no' && (
                <div>
                  <label className="text-[11px] text-slate-400 font-medium">
                    {isEn ? 'Boolean Output Variable Name' : '선택 결과(True/False) 저장 변수명'}
                  </label>
                  {renderOutputVariableSelector('dialog_result', ['boolean', 'string'], 'border-amber-700 text-amber-300')}
                </div>
              )}

              {/* 버튼 유형별 상세 동작 안내 */}
              <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-xl text-[10px] text-slate-300 leading-relaxed">
                {(cfg.button_type || 'ok') === 'ok' && (
                  <span>
                    💡 {isEn
                      ? 'Displays a single [OK] button on top of all windows. Clicking [OK] completes this node normally.'
                      : '화면 최상단에 단 하나의 [확인] 버튼을 출력하며, 사용자가 확인을 누르면 정상 실행 완료로 처리되어 다음 노드로 넘어갑니다.'}
                  </span>
                )}
                {cfg.button_type === 'yes_no' && (
                  <span>
                    💡 {isEn
                      ? `Saves boolean True ([Yes]) or False ([No]) into {{${cfg.output_variable || 'dialog_result'}}}.`
                      : `사용자가 [예]를 누르면 True, [아니오]를 누르면 False(boolean) 값을 {{${cfg.output_variable || 'dialog_result'}}} 변수에 저장합니다.`}
                  </span>
                )}
                {cfg.button_type === 'continue_stop' && (
                  <span className="text-amber-300/90">
                    ⚡ {isEn
                      ? 'Clicking [Continue] proceeds to the next node. Clicking [Stop] raises an error to terminate the workflow immediately.'
                      : '사용자가 [계속] 버튼을 누르면 후속 노드 실행을 이어가고, [중지] 버튼을 누르면 즉시 오류를 발생시켜 그 시점에서 워크플로우가 종료됩니다.'}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* ==================== 🌐 웹 브라우저 전용 노드 7종 (Playwright) ==================== */}
          {nodeData.type.startsWith('browser_') && (
            <div className="p-2.5 rounded-xl bg-cyan-950/30 border border-cyan-800/50 text-[11px] text-cyan-200 space-y-1 mb-3">
              <div className="font-semibold text-cyan-300 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span>{isEn ? 'Playwright Web Automation Node' : 'Playwright 웹 전용 고급 스킬 노드'}</span>
              </div>
              <p className="text-[10px] text-slate-300 leading-relaxed">
                {isEn
                  ? 'Directly controls the browser DOM without moving your physical mouse cursor. Supports nested iframes, SPAs, and background execution.'
                  : '물리 마우스 커서를 움직이지 않고 브라우저 DOM을 직접 제어합니다. 중첩 iframe, SPA 동적 탭, 백그라운드(Headless) 작업을 완벽 지원합니다.'}
              </p>
            </div>
          )}

          {/* B-1. 웹 브라우저 열기 / 이동 (browser_navigate) */}
          {nodeData.type === 'browser_navigate' && (
            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-cyan-300 font-medium block mb-1">
                  {isEn ? 'Target URL' : '이동할 웹 주소 (URL)'}
                </label>
                <input
                  type="text"
                  data-config-key="url"
                  value={cfg.url ?? 'https://www.naver.com'}
                  onChange={(e) => handleConfigChange('url', e.target.value)}
                  placeholder="https://www.naver.com ({{변수명}} 치환 지원)"
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">
                    {isEn ? 'Browser Engine' : '사용할 브라우저'}
                  </label>
                  <select
                    value={cfg.browser_channel || 'chrome'}
                    onChange={(e) => handleConfigChange('browser_channel', e.target.value)}
                    className="w-full px-2 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-cyan-500"
                  >
                    <option value="chrome">Google Chrome</option>
                    <option value="msedge">Microsoft Edge</option>
                    <option value="chromium">Playwright Chromium</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">
                    {isEn ? 'Execution Window Mode' : '실행 화면 모드'}
                  </label>
                  <select
                    value={cfg.run_mode || 'headed'}
                    onChange={(e) => handleConfigChange('run_mode', e.target.value)}
                    className="w-full px-2 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-cyan-500"
                  >
                    <option value="headed">{isEn ? 'Normal Window (No mouse hijack)' : '일반 창 표시 (마우스 비점유)'}</option>
                    <option value="minimized">{isEn ? 'Minimized Background' : '최소화 창 (백그라운드)'}</option>
                    <option value="headless">{isEn ? 'Headless (100% Hidden)' : 'Headless (창 완전 숨김)'}</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">
                    {isEn ? 'Load Wait Condition' : '로딩 완료 대기 기준'}
                  </label>
                  <select
                    value={cfg.wait_until || 'domcontentloaded'}
                    onChange={(e) => handleConfigChange('wait_until', e.target.value)}
                    className="w-full px-2 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-cyan-500"
                  >
                    <option value="domcontentloaded">{isEn ? 'DOM Ready (Fast)' : 'DOM 로드 완료 (빠름·권장)'}</option>
                    <option value="load">{isEn ? 'Full Page Load' : '전체 리소스 로드 완료'}</option>
                    <option value="networkidle">{isEn ? 'SPA Network Idle' : '네트워크 통신 유휴 (SPA 권장)'}</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">
                    {isEn ? 'Timeout (sec)' : '최대 대기 시간 (초)'}
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="120"
                    step="1"
                    value={cfg.timeout ?? 15}
                    onChange={(e) => handleConfigChange('timeout', Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono"
                  />
                </div>
              </div>

              <label className="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cfg.use_persistent_profile ?? true}
                  onChange={(e) => handleConfigChange('use_persistent_profile', e.target.checked)}
                  className="mt-0.5 rounded bg-slate-900 border-slate-700 text-cyan-500 focus:ring-0"
                />
                <div>
                  <div className="text-xs font-medium text-slate-200">
                    {isEn ? 'Keep Login Session & Cookies (Persistent Profile)' : '전용 브라우저 프로필로 로그인 세션/쿠키 유지'}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">
                    {isEn
                      ? 'Preserves login sessions across runs so background/headless tasks stay logged in.'
                      : '최초 1회 로그인해 두면 이후 백그라운드(Headless 포함) 실행에서도 로그인 상태가 그대로 유지됩니다.'}
                  </p>
                </div>
              </label>

              <label className="flex items-center gap-2 p-2 rounded-lg bg-slate-950 border border-slate-800 cursor-pointer text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={!!cfg.new_tab}
                  onChange={(e) => handleConfigChange('new_tab', e.target.checked)}
                  className="rounded bg-slate-900 border-slate-700 text-cyan-500 focus:ring-0"
                />
                <span>{isEn ? 'Open in a new tab (if browser is already open)' : '이미 열린 브라우저가 있으면 새 탭에서 열기'}</span>
              </label>
            </div>
          )}

          {/* B-2. 웹 요소 클릭 (browser_click) */}
          {nodeData.type === 'browser_click' && (
            <div className="space-y-3">
              {renderWebElementPickerSection('selector')}

              <div>
                <label className="text-[11px] text-slate-400 block mb-1">
                  {isEn ? 'Target Identification Mode' : '대상 요소 식별 방식'}
                </label>
                <select
                  value={cfg.selector_type || 'auto'}
                  onChange={(e) => handleConfigChange('selector_type', e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="auto">{isEn ? 'Auto Detect (Text / CSS / XPath / Ref)' : '자동 판별 (화면 텍스트 / CSS / XPath 모두 지원)'}</option>
                  <option value="text">{isEn ? 'Visible Text / Button Name' : '화면에 보이는 버튼/링크 텍스트'}</option>
                  <option value="css">CSS Selector (예: #login-btn, .submit)</option>
                  <option value="xpath">XPath (예: //button[@type="submit"])</option>
                  <option value="role">ARIA Role (예: button:로그인)</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] text-cyan-300 font-medium block mb-1">
                  {isEn ? 'Target Selector or Text' : '클릭할 대상 (텍스트 또는 Selector)'}
                </label>
                <input
                  type="text"
                  data-config-key="selector"
                  value={cfg.selector ?? ''}
                  onChange={(e) => handleConfigChange('selector', e.target.value)}
                  placeholder={isEn ? 'e.g. Login, #submit-btn, //a[contains(text(),"More")]' : '예: 로그인, 검색, #btn-submit ({{변수명}} 치환 지원)'}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">
                    {isEn ? 'Click Type' : '클릭 종류'}
                  </label>
                  <select
                    value={cfg.click_type || 'single'}
                    onChange={(e) => handleConfigChange('click_type', e.target.value)}
                    className="w-full px-2 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200"
                  >
                    <option value="single">{isEn ? 'Single Left Click' : '단일 좌클릭'}</option>
                    <option value="double">{isEn ? 'Double Click' : '더블 클릭'}</option>
                    <option value="right">{isEn ? 'Right Click' : '우클릭'}</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">
                    {isEn ? 'Wait Timeout (sec)' : '탐색 대기 시간 (초)'}
                  </label>
                  <input
                    type="number"
                    min="0.5"
                    max="60"
                    step="0.5"
                    value={cfg.timeout ?? 5.0}
                    onChange={(e) => handleConfigChange('timeout', Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono"
                  />
                </div>
              </div>

              <label className="flex items-start gap-2 p-2 rounded-lg bg-slate-950 border border-slate-800 cursor-pointer text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={cfg.iframe_auto_search ?? true}
                  onChange={(e) => handleConfigChange('iframe_auto_search', e.target.checked)}
                  className="mt-0.5 rounded bg-slate-900 border-slate-700 text-cyan-500 focus:ring-0"
                />
                <div>
                  <div className="font-medium text-slate-200">
                    {isEn ? 'Auto-traverse nested iframes' : '중첩 iframe 내부까지 자동 관통 탐색'}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {isEn
                      ? 'Automatically searches inside all child iframes on legacy web pages.'
                      : '레거시 웹페이지에서 메인 프레임에 요소가 없으면 모든 하위 iframe을 자동으로 뒤져 클릭합니다.'}
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-2 p-2 rounded-lg bg-slate-950 border border-slate-800 cursor-pointer text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={!!cfg.force_click}
                  onChange={(e) => handleConfigChange('force_click', e.target.checked)}
                  className="mt-0.5 rounded bg-slate-900 border-slate-700 text-cyan-500 focus:ring-0"
                />
                <div>
                  <div className="font-medium text-slate-200">
                    {isEn ? 'Force Click (Bypass overlay checks)' : '강제 클릭 (가려진 레이어/이벤트 제약 무시)'}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {isEn
                      ? 'Dispatches click even if covered by transparent overlays in custom SPA/legacy UI.'
                      : '투명 배너나 독자 UI 레이어에 가려져 일반 클릭이 막힐 때 강제로 클릭 이벤트를 발생시킵니다.'}
                  </p>
                </div>
              </label>
            </div>
          )}

          {/* B-3. 웹 텍스트 입력 (browser_fill) */}
          {nodeData.type === 'browser_fill' && (
            <div className="space-y-3">
              {renderWebElementPickerSection('selector')}

              <div>
                <label className="text-[11px] text-slate-400 block mb-1">
                  {isEn ? 'Input Field Identification Mode' : '입력창 식별 방식'}
                </label>
                <select
                  value={cfg.selector_type || 'auto'}
                  onChange={(e) => handleConfigChange('selector_type', e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="auto">{isEn ? 'Auto Detect (Placeholder / Label / CSS / XPath)' : '자동 판별 (안내문구 / 라벨 / CSS / XPath)'}</option>
                  <option value="placeholder">{isEn ? 'Placeholder or Label Text' : '입력창 안내문구(Placeholder) 또는 라벨'}</option>
                  <option value="css">CSS Selector (예: input[name="query"])</option>
                  <option value="xpath">XPath (예: //input[@type="text"])</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] text-cyan-300 font-medium block mb-1">
                  {isEn ? 'Target Input Selector / Placeholder' : '대상 입력창 (안내문구 또는 Selector)'}
                </label>
                <input
                  type="text"
                  data-config-key="selector"
                  value={cfg.selector ?? ''}
                  onChange={(e) => handleConfigChange('selector', e.target.value)}
                  placeholder={isEn ? 'e.g. Search, #query, input[name="id"]' : '예: 검색어를 입력해 주세요, #query, input[name="id"]'}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="text-[11px] text-emerald-300 font-medium block mb-1">
                  {isEn ? 'Text to Input' : '입력할 텍스트 내용'}
                </label>
                <input
                  type="text"
                  data-config-key="text"
                  value={cfg.text ?? ''}
                  onChange={(e) => handleConfigChange('text', e.target.value)}
                  placeholder={isEn ? 'Enter text ({{variable}} supported)' : '입력할 텍스트 ({{변수명}} 치환 지원)'}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">
                    {isEn ? 'Input Method' : '입력 방식'}
                  </label>
                  <select
                    value={cfg.input_method || 'fill'}
                    onChange={(e) => handleConfigChange('input_method', e.target.value)}
                    className="w-full px-2 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200"
                  >
                    <option value="fill">{isEn ? 'Instant Fill (Fast)' : '즉시 채우기 (빠름·권장)'}</option>
                    <option value="type">{isEn ? 'Sequential Key Events (SPA)' : '한 글자씩 키 이벤트 발생 (SPA용)'}</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">
                    {isEn ? 'Wait Timeout (sec)' : '탐색 대기 시간 (초)'}
                  </label>
                  <input
                    type="number"
                    min="0.5"
                    max="60"
                    step="0.5"
                    value={cfg.timeout ?? 5.0}
                    onChange={(e) => handleConfigChange('timeout', Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 p-2 rounded-lg bg-slate-950 border border-slate-800 cursor-pointer text-xs text-slate-200">
                <input
                  type="checkbox"
                  checked={cfg.press_enter ?? true}
                  onChange={(e) => handleConfigChange('press_enter', e.target.checked)}
                  className="rounded bg-slate-900 border-slate-700 text-emerald-500 focus:ring-0"
                />
                <span>{isEn ? 'Press Enter key automatically after input' : '입력 완료 후 자동으로 Enter 키 전송 (검색/제출)'}</span>
              </label>

              <label className="flex items-center gap-2 p-2 rounded-lg bg-slate-950 border border-slate-800 cursor-pointer text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={cfg.iframe_auto_search ?? true}
                  onChange={(e) => handleConfigChange('iframe_auto_search', e.target.checked)}
                  className="rounded bg-slate-900 border-slate-700 text-cyan-500 focus:ring-0"
                />
                <span>{isEn ? 'Auto-traverse nested iframes' : '중첩 iframe 내부 입력창 자동 관통 탐색'}</span>
              </label>
            </div>
          )}

          {/* B-4. 웹 데이터 / 본문 추출 (browser_extract) */}
          {nodeData.type === 'browser_extract' && (
            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">
                  {isEn ? 'Extraction Scope' : '추출 범위'}
                </label>
                <select
                  value={cfg.extract_target || 'full_page'}
                  onChange={(e) => handleConfigChange('extract_target', e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-teal-500"
                >
                  <option value="full_page">{isEn ? 'Full Page Content (including iframes)' : '웹페이지 전체 본문 (하위 iframe 통합 추출)'}</option>
                  <option value="element">{isEn ? 'Specific Element Only (Selector)' : '특정 웹 요소 영역만 지정 추출'}</option>
                </select>
              </div>

              {renderWebElementPickerSection(
                'selector',
                cfg.extract_target === 'element'
                  ? undefined
                  : isEn
                  ? '🎯 Pick Specific Area in Browser to Extract'
                  : '🎯 브라우저에서 추출할 특정 영역 선택',
                { extract_target: 'element' }
              )}

              {cfg.extract_target === 'element' && (
                <div>
                  <label className="text-[11px] text-teal-300 font-medium block mb-1">
                    {isEn ? 'Target Element Selector' : '추출할 영역 선택자 (CSS / XPath)'}
                  </label>
                  <input
                    type="text"
                    data-config-key="selector"
                    value={cfg.selector ?? ''}
                    onChange={(e) => handleConfigChange('selector', e.target.value)}
                    placeholder="예: #articleBody, .news_list, table.report"
                    className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">
                    {isEn ? 'Output Format' : '추출 포맷'}
                  </label>
                  <select
                    value={cfg.extract_format || 'markdown'}
                    onChange={(e) => handleConfigChange('extract_format', e.target.value)}
                    className="w-full px-2 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200"
                  >
                    <option value="markdown">{isEn ? 'Markdown (Preserves Tables)' : '마크다운 (표/제목 구조 보존·AI 최적)'}</option>
                    <option value="text">{isEn ? 'Plain Text' : '순수 일반 텍스트'}</option>
                    <option value="html">{isEn ? 'Raw Inner HTML' : '원본 HTML 코드'}</option>
                    {cfg.extract_target === 'element' && (
                      <option value="attribute">{isEn ? 'HTML Attribute (href, src...)' : '특정 속성값 (href 링크 주소 등)'}</option>
                    )}
                  </select>
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">
                    {isEn ? 'Max Length (chars)' : '최대 글자 수 제한'}
                  </label>
                  <input
                    type="number"
                    min="500"
                    max="100000"
                    step="500"
                    value={cfg.max_length ?? 15000}
                    onChange={(e) => handleConfigChange('max_length', Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono"
                  />
                </div>
              </div>

              {cfg.extract_target === 'element' && cfg.extract_format === 'attribute' && (
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">
                    {isEn ? 'Attribute Name' : '추출할 HTML 속성명'}
                  </label>
                  <input
                    type="text"
                    data-config-key="attribute_name"
                    value={cfg.attribute_name ?? 'href'}
                    onChange={(e) => handleConfigChange('attribute_name', e.target.value)}
                    placeholder="href, src, value, data-id..."
                    className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono"
                  />
                </div>
              )}

              <div>
                <label className="text-[11px] text-slate-400 font-medium">
                  {isEn ? 'Output Variable Name' : '추출 데이터 저장 변수명'}
                </label>
                {renderOutputVariableSelector('web_content', ['string', 'json'], 'border-teal-700 text-teal-300')}
              </div>
            </div>
          )}

          {/* B-5. 웹 탭 / 드롭다운 / 다운로드 / 탐색 제어 (browser_action) */}
          {nodeData.type === 'browser_action' && (
            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-indigo-300 font-medium block mb-1">
                  {isEn ? 'Browser Control Action' : '수행할 웹 제어 동작'}
                </label>
                <select
                  value={cfg.action_type || 'switch_tab'}
                  onChange={(e) => handleConfigChange('action_type', e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="switch_tab">{isEn ? 'Switch Browser Tab / Popup' : '탭 전환 (새로 열린 탭/팝업 또는 제목 검색)'}</option>
                  <option value="close_tab">{isEn ? 'Close Current Tab' : '현재 탭 닫기'}</option>
                  <option value="go_back">{isEn ? 'Navigate Back' : '뒤로 가기 (Back)'}</option>
                  <option value="go_forward">{isEn ? 'Navigate Forward' : '앞으로 가기 (Forward)'}</option>
                  <option value="reload">{isEn ? 'Reload Page' : '새로고침 (Reload)'}</option>
                  <option value="select_option">{isEn ? 'Select Dropdown (<select>) Option' : '드롭다운(<select>) 항목 선택'}</option>
                  <option value="wait_for_element">{isEn ? 'Wait for Element to Appear (SPA)' : '특정 웹 요소가 나타날 때까지 동적 대기 (SPA)'}</option>
                  <option value="wait_for_download">{isEn ? 'Trigger & Wait for File Download' : '파일 다운로드 실행 및 완료 대기'}</option>
                </select>
              </div>

              {(cfg.action_type === 'select_option' ||
                cfg.action_type === 'wait_for_element' ||
                cfg.action_type === 'wait_for_download') &&
                renderWebElementPickerSection('target_value')}

              {(cfg.action_type === 'switch_tab' ||
                cfg.action_type === 'select_option' ||
                cfg.action_type === 'wait_for_element' ||
                cfg.action_type === 'wait_for_download') && (
                <div>
                  <label className="text-[11px] text-slate-300 font-medium block mb-1">
                    {cfg.action_type === 'switch_tab'
                      ? (isEn ? 'Target Tab Keyword (or "latest" / "next")' : '전환할 탭 키워드 (latest=가장 최근 탭, next=다음 탭, 또는 제목 일부)')
                      : cfg.action_type === 'select_option'
                      ? (isEn ? 'Dropdown (<select>) Selector' : '대상 드롭다운(<select>) 선택자')
                      : cfg.action_type === 'wait_for_download'
                      ? (isEn ? 'Download Button Selector/Text (Optional)' : '클릭할 다운로드 버튼 선택자/텍스트 (비워두면 직전 다운로드 대기)')
                      : (isEn ? 'Element Selector/Text to Wait For' : '기다릴 웹 요소 선택자 또는 텍스트')}
                  </label>
                  <input
                    type="text"
                    data-config-key="target_value"
                    value={cfg.target_value ?? ''}
                    onChange={(e) => handleConfigChange('target_value', e.target.value)}
                    placeholder={
                      cfg.action_type === 'switch_tab'
                        ? 'latest, next, 또는 탭 제목 키워드'
                        : '예: 다운로드, #download-btn, select[name="category"]'
                    }
                    className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono"
                  />
                </div>
              )}

              {(cfg.action_type === 'select_option' || cfg.action_type === 'wait_for_download') && (
                <div>
                  <label className="text-[11px] text-slate-300 font-medium block mb-1">
                    {cfg.action_type === 'select_option'
                      ? (isEn ? 'Option Label or Value to Select' : '선택할 항목 이름(Label) 또는 값(Value)')
                      : (isEn ? 'Download Save Directory (Optional)' : '다운로드 저장 폴더 경로 (비워두면 기본 storage/downloads)')}
                  </label>
                  <input
                    type="text"
                    data-config-key="option_value"
                    value={cfg.option_value ?? ''}
                    onChange={(e) => handleConfigChange('option_value', e.target.value)}
                    placeholder={cfg.action_type === 'select_option' ? '예: 서울특별시, 2026년' : '예: C:\\Downloads'}
                    className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono"
                  />
                </div>
              )}

              <div>
                <label className="text-[11px] text-slate-400 block mb-1">
                  {isEn ? 'Timeout (sec)' : '최대 대기 시간 (초)'}
                </label>
                <input
                  type="number"
                  min="1"
                  max="300"
                  step="1"
                  value={cfg.timeout ?? 10.0}
                  onChange={(e) => handleConfigChange('timeout', Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono"
                />
              </div>

              {cfg.action_type === 'wait_for_download' && (
                <div>
                  <label className="text-[11px] text-slate-400 font-medium">
                    {isEn ? 'Downloaded File Path Variable' : '저장된 파일 전체 경로를 담을 변수명'}
                  </label>
                  {renderOutputVariableSelector('downloaded_file_path', ['string', 'json'], 'border-indigo-700 text-indigo-300')}
                </div>
              )}
            </div>
          )}

          {/* B-6. 현재 웹페이지 정보 읽기 (browser_get_info) */}
          {nodeData.type === 'browser_get_info' && (
            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">
                  {isEn ? 'Information to Read' : '읽어올 웹페이지 정보 종류'}
                </label>
                <select
                  value={cfg.info_type || 'url'}
                  onChange={(e) => handleConfigChange('info_type', e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-blue-500"
                >
                  <option value="url">{isEn ? 'Current Page URL' : '현재 웹페이지 주소 (URL)'}</option>
                  <option value="title">{isEn ? 'Current Page Title' : '현재 웹페이지 제목 (Title)'}</option>
                  <option value="tabs_json">{isEn ? 'All Open Tabs List (JSON)' : '열려 있는 전체 탭 목록 (JSON)'}</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] text-slate-400 font-medium">
                  {isEn ? 'Output Variable Name' : '결과 저장 변수명'}
                </label>
                {renderOutputVariableSelector('web_info', ['string', 'json'], 'border-blue-700 text-blue-300')}
              </div>
            </div>
          )}

          {/* B-7. 웹 자바스크립트(JS) 실행 (browser_evaluate) */}
          {nodeData.type === 'browser_evaluate' && (
            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-amber-300 font-medium block mb-1">
                  {isEn ? 'JavaScript Code to Execute in Page' : '웹페이지 내부에서 실행할 JavaScript 코드'}
                </label>
                <textarea
                  rows={5}
                  data-config-key="script"
                  value={cfg.script ?? 'return document.title;'}
                  onChange={(e) => handleConfigChange('script', e.target.value)}
                  placeholder="예: return document.querySelector('#grid').innerText;"
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-amber-200 font-mono focus:outline-none focus:border-amber-500"
                />
                <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                  💡 {isEn
                    ? 'Use "return ..." to store the evaluated result into the output variable. Ideal for legacy custom UI frameworks.'
                    : '비표준 레거시 웹(WebSquare, 캔버스 UI 등)의 전역 함수를 직접 호출하거나 값을 추출할 때 사용하세요. return 문의 결과가 출력 변수에 저장됩니다.'}
                </p>
              </div>

              <div>
                <label className="text-[11px] text-slate-400 font-medium">
                  {isEn ? 'Return Value Output Variable' : 'JS 반환값 저장 변수명'}
                </label>
                {renderOutputVariableSelector('js_result', ['string', 'number', 'boolean', 'json'], 'border-amber-700 text-amber-300')}
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
                  data-config-key="prompt"
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
                  data-config-key="system_prompt"
                  value={cfg.system_prompt || ''}
                  onChange={(e) => handleConfigChange('system_prompt', e.target.value)}
                  placeholder={isEn ? 'e.g. You are an expert office automation assistant.' : '예: 너는 전문 사무 자동화 비서야.'}
                  className="w-full px-2.5 py-1 text-xs bg-slate-950 border border-slate-700 rounded text-slate-200 mt-1"
                />
              </div>

              <div>
                <label className="text-[11px] text-slate-400 font-medium">
                  {isEn ? 'Output Variable Name' : '출력 저장 변수명'}
                </label>
                {renderOutputVariableSelector('ai_output', ['string', 'json'], 'border-purple-700 text-purple-300')}
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
                  data-config-key="prompt"
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
                  {t('inspector.agentBasic.systemPromptLabel')}
                </label>
                <textarea
                  rows={4}
                  data-config-key="system_prompt"
                  value={cfg.system_prompt || ''}
                  onChange={(e) => handleConfigChange('system_prompt', e.target.value)}
                  placeholder={t('inspector.agentBasic.systemPromptPlaceholder')}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 mt-1 focus:outline-none focus:border-indigo-500 leading-relaxed font-sans placeholder:text-slate-500"
                />
                <div className="text-[10px] text-slate-500 mt-1 leading-tight">
                  ℹ️ {t('inspector.agentBasic.systemPromptHelp')}
                </div>
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
                      : cfg.preset_name === 'web_playwright'
                      ? (isEn ? 'Web Playwright (7 skills)' : '웹 전용 (7종)')
                      : cfg.preset_name === 'all'
                      ? (isEn ? 'All (27 skills)' : '전체 (27종)')
                      : (isEn ? 'Default (11 skills)' : '기본 화면 조작 (11종)')}
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
                          ? 'Basic Desktop UI Interaction (Mouse, Keyboard, Window, UI Scan - 11 skills)'
                          : '기본 데스크톱 화면 조작 (마우스/키보드/창/UI스캔 11종)'}
                      </option>
                      <option value="web_playwright">
                        {isEn
                          ? '🌐 Web Browser Automation (Playwright DOM/iframe/Background - 7 skills)'
                          : '🌐 웹 브라우저 자동화 (Playwright 웹 전용·백그라운드 7종)'}
                      </option>
                      <option value="all">
                        {isEn ? 'All (All 27 skills included)' : '전체 (모든 스킬 27종 포함)'}
                      </option>
                    </select>

                    {/* 웹 브라우저 자동화 프리셋 선택 시 안내 배지 */}
                    {cfg.preset_name === 'web_playwright' && (
                      <div className="p-2.5 bg-cyan-950/40 border border-cyan-800/60 rounded-lg flex items-start gap-2 text-cyan-200 text-[11px] leading-relaxed">
                        <Globe className="w-4 h-4 shrink-0 text-cyan-400 mt-0.5" />
                        <div>
                          <span className="font-semibold text-cyan-300">
                            {isEn ? 'Playwright Web Agent Mode Enabled' : 'Playwright 웹 전용 에이전트 프리셋'}
                          </span>
                          <p className="text-[10px] text-cyan-300/90 mt-0.5">
                            {isEn
                              ? 'Uses DOM ref IDs instead of pixel coordinates for high accuracy on small models, without moving your mouse cursor.'
                              : '픽셀 좌표 추측 대신 웹 요소 고유 번호(ref)와 마크다운 본문 추출을 사용하여, 소형 모델에서도 높은 정확도로 마우스 간섭 없이 웹 업무를 수행합니다.'}
                          </p>
                        </div>
                      </div>
                    )}

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

                {/* 컨텍스트 크기 (num_ctx) */}
                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] text-slate-400 font-medium flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-indigo-400" />
                      {t('inspector.agentBasic.numCtxLabel')}
                    </label>
                    <span className="text-[11px] font-mono font-bold text-indigo-400">
                      {(cfg.num_ctx ?? 8192).toLocaleString()} tokens
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <input
                      type="number"
                      min="1024"
                      max="131072"
                      step="1024"
                      value={cfg.num_ctx ?? 8192}
                      onChange={(e) => handleConfigChange('num_ctx', Math.max(1024, Number(e.target.value) || 8192))}
                      className="w-28 px-2.5 py-1 text-xs font-mono text-right bg-slate-950 border border-slate-700 rounded text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                    <div className="flex items-center gap-1 flex-1 overflow-x-auto py-0.5">
                      {[8192, 16384, 32768, 65536].map((size) => (
                        <button
                          key={size}
                          type="button"
                          onClick={() => handleConfigChange('num_ctx', size)}
                          className={`px-1.5 py-0.5 text-[10px] font-mono rounded transition-colors shrink-0 ${
                            (cfg.num_ctx ?? 8192) === size
                              ? 'bg-indigo-600/40 text-indigo-300 border border-indigo-500/60 font-semibold'
                              : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-slate-200 hover:bg-slate-900'
                          }`}
                        >
                          {size >= 1024 ? `${size / 1024}k` : size}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1 leading-tight">
                    {t('inspector.agentBasic.numCtxHelp')}
                  </p>
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 font-medium">
                    {isEn ? 'Output Variable Name' : '출력 저장 변수명'}
                  </label>
                  {renderOutputVariableSelector('agent_result', ['string', 'json'], 'border-indigo-700 text-indigo-300')}
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

          {/* 7. 그룹 노드 (flow_group) */}
          {isGroup && (
            <div className="space-y-4">
              {/* 안내 배지 */}
              <div className="p-3 bg-teal-950/30 border border-teal-800/50 rounded-xl space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-teal-300">
                  <FolderKanban className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                  <span>{isEn ? 'Visual Group Container' : '시각적 그룹 컨테이너 노드'}</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  {isEn
                    ? 'Groups related nodes visually on the canvas. Collapsing hides child nodes compactly. Purely visual—ignored by the backend engine and agent skillset.'
                    : '연관성 있는 노드들을 시각적으로 묶어 관리하는 컨테이너입니다. 접기/펼치기로 하위 노드를 컴팩트하게 감출 수 있으며, 백엔드 실행 및 에이전트 스킬에는 아무런 영향을 주지 않습니다.'}
                </p>
              </div>

              {/* 접기 / 펼치기 상태 제어 */}
              <div>
                <label className="text-[11px] text-slate-400 block mb-1.5 font-medium">
                  {isEn ? 'Canvas Display State' : '캔버스 표시 상태 (접기 / 펼치기)'}
                </label>
                <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-950 rounded-lg border border-slate-800">
                  <button
                    type="button"
                    onClick={() => handleConfigChange('collapsed', false)}
                    className={`flex items-center justify-center gap-1.5 py-1.5 text-xs rounded-md font-medium transition-all ${
                      !cfg.collapsed
                        ? 'bg-teal-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                    <span>{isEn ? 'Expanded (Show)' : '펼치기 (노드 표시)'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleConfigChange('collapsed', true)}
                    className={`flex items-center justify-center gap-1.5 py-1.5 text-xs rounded-md font-medium transition-all ${
                      cfg.collapsed
                        ? 'bg-teal-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                    <span>{isEn ? 'Collapsed (Compact)' : '접기 (컴팩트 숨김)'}</span>
                  </button>
                </div>
              </div>

              {/* 그룹 테마 색상 */}
              <div>
                <label className="text-[11px] text-slate-400 block mb-1.5 font-medium">
                  {isEn ? 'Group Color Theme' : '그룹 테두리 색상 테마'}
                </label>
                <div className="grid grid-cols-7 gap-1.5">
                  {[
                    { id: 'indigo', bg: 'bg-indigo-500' },
                    { id: 'emerald', bg: 'bg-emerald-500' },
                    { id: 'amber', bg: 'bg-amber-500' },
                    { id: 'sky', bg: 'bg-sky-500' },
                    { id: 'purple', bg: 'bg-purple-500' },
                    { id: 'rose', bg: 'bg-rose-500' },
                    { id: 'slate', bg: 'bg-slate-400' },
                  ].map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleConfigChange('color', c.id)}
                      className={`h-6 rounded-lg flex items-center justify-center border transition-all ${
                        (cfg.color || 'indigo') === c.id
                          ? 'border-white ring-2 ring-teal-400 scale-105'
                          : 'border-slate-700 opacity-70 hover:opacity-100'
                      }`}
                    >
                      <span className={`w-3.5 h-3.5 rounded-full ${c.bg}`} />
                    </button>
                  ))}
                </div>
              </div>

              {/* 그룹 박스 크기 (가로 / 세로) */}
              {!cfg.collapsed && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">
                      {isEn ? 'Width (px)' : '영역 가로 폭 (px)'}
                    </label>
                    <input
                      type="number"
                      min="320"
                      max="2400"
                      step="20"
                      value={cfg.width ?? 560}
                      onChange={(e) => handleConfigChange('width', Math.max(320, Number(e.target.value) || 560))}
                      className="w-full px-2.5 py-1 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">
                      {isEn ? 'Height (px)' : '영역 세로 높이 (px)'}
                    </label>
                    <input
                      type="number"
                      min="180"
                      max="1600"
                      step="20"
                      value={cfg.height ?? 260}
                      onChange={(e) => handleConfigChange('height', Math.max(180, Number(e.target.value) || 260))}
                      className="w-full px-2.5 py-1 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono"
                    />
                  </div>
                </div>
              )}

              {/* '+' 버튼 방식으로 그룹 내부에 새 스킬 노드 즉시 생성 추가 */}
              <div className="border-t border-slate-800 pt-3 space-y-2">
                <label className="text-[11px] font-semibold text-teal-300 flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5 text-teal-400" />
                  <span>{isEn ? 'Add New Skill Node into Group' : '그룹 내부에 새 스킬 노드 추가 (+)'}</span>
                </label>
                <div className="flex items-center gap-1.5">
                  <select
                    value={groupAddSkillType}
                    onChange={(e) => setGroupAddSkillType(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-teal-500"
                  >
                    {SKILL_ITEMS.filter((it) => it.type !== 'flow_group').map((it) => (
                      <option key={it.type} value={it.type}>
                        {t(`skills.${it.type}.label`) || it.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      const found = SKILL_ITEMS.find((it) => it.type === groupAddSkillType);
                      if (found && onAddNewSkillToGroup && selectedNode) {
                        const itemLabel = t(`skills.${found.type}.label`) || found.label;
                        onAddNewSkillToGroup(selectedNode.id, found.type, itemLabel, found.defaultConfig);
                      }
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold flex items-center gap-1 shrink-0 transition-colors cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{isEn ? 'Add' : '추가'}</span>
                  </button>
                </div>
              </div>

              {/* 캔버스의 기존 노드를 이 그룹으로 편입 (+) */}
              {(() => {
                const candidateNodes = allNodes.filter(
                  (n) =>
                    n.id !== selectedNode?.id &&
                    n.type !== 'flow_group' &&
                    n.type !== 'flow_start' &&
                    n.type !== 'flow_end' &&
                    (n.data as any)?.config?.group_id !== selectedNode?.id
                );
                if (candidateNodes.length === 0) return null;
                return (
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-slate-400 block">
                      {isEn ? 'Include Existing Canvas Node' : '캔버스의 기존 노드를 그룹에 포함 (+)'}
                    </label>
                    <div className="flex items-center gap-1.5">
                      <select
                        value={assignExistingNodeId}
                        onChange={(e) => setAssignExistingNodeId(e.target.value)}
                        className="flex-1 px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-teal-500"
                      >
                        <option value="">
                          {isEn ? '-- Select existing node --' : '-- 포함할 기존 노드 선택 --'}
                        </option>
                        {candidateNodes.map((cn) => (
                          <option key={cn.id} value={cn.id}>
                            {(cn.data as any)?.label || cn.id}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={!assignExistingNodeId}
                        onClick={() => {
                          if (assignExistingNodeId && onAssignNodeToGroup && selectedNode) {
                            onAssignNodeToGroup(assignExistingNodeId, selectedNode.id);
                            setAssignExistingNodeId('');
                          }
                        }}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-teal-300 border border-teal-700/50 text-xs font-semibold flex items-center gap-1 shrink-0 transition-colors cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>{isEn ? 'Include' : '포함'}</span>
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* 현재 그룹에 소속된 하위 노드 목록 및 개별 제외 버튼 */}
              {(() => {
                const groupChildren = allNodes.filter(
                  (n) => n.type !== 'flow_group' && (n.data as any)?.config?.group_id === selectedNode?.id
                );
                return (
                  <div className="border-t border-slate-800 pt-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-slate-300">
                        {isEn ? 'Grouped Child Nodes' : '그룹 내 포함된 하위 노드'}
                      </span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-teal-300">
                        {groupChildren.length}
                      </span>
                    </div>

                    {groupChildren.length === 0 ? (
                      <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80 text-[11px] text-slate-500 text-center">
                        {isEn
                          ? 'Drag nodes into the group box on the canvas or use the + button above.'
                          : '캔버스에서 노드를 그룹 영역 안으로 드래그하거나 위 [+] 버튼으로 추가하세요.'}
                      </div>
                    ) : (
                      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                        {groupChildren.map((child, idx) => (
                          <div
                            key={child.id}
                            className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs"
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-[10px] font-mono text-slate-500">{idx + 1}.</span>
                              <span className="text-slate-200 font-medium truncate">
                                {(child.data as any)?.label || child.id}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                if (onAssignNodeToGroup) {
                                  onAssignNodeToGroup(child.id, null);
                                }
                              }}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 hover:bg-rose-950/70 text-slate-400 hover:text-rose-300 transition-colors shrink-0"
                              title={isEn ? 'Remove from group (keep on canvas)' : '그룹에서 빼내기 (노드는 캔버스에 유지됨)'}
                            >
                              {isEn ? 'Ungroup' : '그룹 해제'}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {/* 8. 다른 워크플로우 호출 노드 (flow_call) */}
          {isSubflow && (() => {
            const targetFlowId = (cfg.target_flow_id || '').trim();
            // 자기 자신은 선택 목록에서 제외하여 직접 재귀 호출 원천 차단
            const selectableFlows = flows.filter((f) => f.id !== activeFlowId && !f.id.startsWith('temp_'));
            const selectedSubflow = flows.find((f) => f.id === targetFlowId);
            const subflowVars: WorkflowVariable[] = selectedSubflow?.graph_data?.variables || [];
            const mappings: SubflowVariableMapping[] = Array.isArray(cfg.variable_mappings)
              ? cfg.variable_mappings
              : [];

            // 정적 순환 호출(A -> B -> A) 여부 실시간 감지
            const cycleChain = targetFlowId
              ? detectSubflowCallCycle(activeFlowId, activeFlowName, targetFlowId, flows)
              : null;

            const handleSelectTargetFlow = (nextFlowId: string) => {
              const found = flows.find((f) => f.id === nextFlowId);
              handleMultiConfigChange({
                target_flow_id: nextFlowId,
                target_flow_name: found ? found.name : '',
              });
            };

            const handleAddMapping = () => {
              const defaultParentVar = variables.length > 0 ? variables[0].name : '';
              const defaultSubVar = subflowVars.length > 0 ? subflowVars[0].name : '';
              const nextList: SubflowVariableMapping[] = [
                ...mappings,
                {
                  id: `mp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                  direction: 'in',
                  parent_var: defaultParentVar,
                  sub_var: defaultSubVar,
                },
              ];
              handleConfigChange('variable_mappings', nextList);
            };

            // 상용 RPA 스타일: 선택한 서브 워크플로우의 선언 변수들을 기준으로 원클릭 자동 매핑 생성
            const handleAutoPopulateMappings = () => {
              if (!selectedSubflow || subflowVars.length === 0) return;
              const existingSubVars = new Set(mappings.map((m) => m.sub_var));
              const added: SubflowVariableMapping[] = [];

              for (const sv of subflowVars) {
                if (existingSubVars.has(sv.name)) continue;
                const matchingParent = variables.find((pv) => pv.name === sv.name);
                added.push({
                  id: `mp_${Date.now()}_${sv.name}`,
                  direction: 'inout',
                  parent_var: matchingParent ? matchingParent.name : (variables[0]?.name || ''),
                  sub_var: sv.name,
                });
              }
              if (added.length > 0) {
                handleConfigChange('variable_mappings', [...mappings, ...added]);
              }
            };

            const handleUpdateMapping = (index: number, patch: Partial<SubflowVariableMapping>) => {
              const nextList = mappings.map((item, idx) =>
                idx === index ? { ...item, ...patch } : item
              );
              handleConfigChange('variable_mappings', nextList);
            };

            const handleRemoveMapping = (index: number) => {
              const nextList = mappings.filter((_, idx) => idx !== index);
              handleConfigChange('variable_mappings', nextList);
            };

            return (
              <div className="space-y-4">
                {/* 1) 호출할 대상 워크플로우 선택 */}
                <div>
                  <label className="text-[11px] font-semibold text-cyan-300 flex items-center gap-1.5 mb-1.5">
                    <Workflow className="w-3.5 h-3.5 text-cyan-400" />
                    <span>{isEn ? 'Target Workflow to Call' : '호출할 대상 워크플로우'}</span>
                  </label>
                  <select
                    value={targetFlowId}
                    onChange={(e) => handleSelectTargetFlow(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-cyan-500"
                  >
                    <option value="">
                      {isEn ? '-- Select a saved workflow --' : '-- 저장된 워크플로우 선택 --'}
                    </option>
                    {selectableFlows.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                  {selectableFlows.length === 0 && (
                    <p className="text-[10px] text-amber-400 mt-1">
                      {isEn
                        ? 'No other saved workflows found. Save another workflow first.'
                        : '호출 가능한 다른 저장된 워크플로우가 없습니다. 먼저 서브 워크플로우를 생성하고 저장해 주세요.'}
                    </p>
                  )}
                </div>

                {/* 순환 참조(무한 루프) 감지 경고 */}
                {cycleChain && (
                  <div className="p-2.5 rounded-xl bg-rose-950/60 border border-rose-700/80 text-[11px] text-rose-200 space-y-1">
                    <div className="font-semibold text-rose-300 flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                      <span>{isEn ? 'Circular Call Loop Detected!' : '순환 호출(무한 루프) 감지!'}</span>
                    </div>
                    <p className="text-[10px] text-rose-300/90 font-mono break-all">
                      {cycleChain.join(' ➔ ')}
                    </p>
                    <p className="text-[10px] text-slate-300 leading-tight">
                      {isEn
                        ? 'The selected workflow directly or indirectly calls the current workflow, creating an infinite loop.'
                        : '선택한 워크플로우가 직·간접적으로 현재 워크플로우를 다시 호출하여 무한 루프가 형성됩니다.'}
                    </p>
                  </div>
                )}

                {/* 선택된 서브 워크플로우 요약 정보 */}
                {selectedSubflow && !cycleChain && (
                  <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1 text-[11px]">
                    <div className="flex items-center justify-between text-slate-300">
                      <span className="font-semibold text-cyan-300 truncate">{selectedSubflow.name}</span>
                      <span className="text-[10px] font-mono text-slate-400 shrink-0">
                        {isEn
                          ? `${subflowVars.length} var(s)`
                          : `선언 변수 ${subflowVars.length}개`}
                      </span>
                    </div>
                    {selectedSubflow.description && (
                      <p className="text-[10px] text-slate-400 line-clamp-2">
                        {selectedSubflow.description}
                      </p>
                    )}
                  </div>
                )}

                {/* 2) 상용 RPA 스타일 입출력(In / Out / InOut) 변수 매핑 섹션 */}
                <div className="border-t border-slate-800 pt-3 space-y-2.5">
                  <div className="flex items-center justify-between gap-1">
                    <div>
                      <label className="text-[11px] font-semibold text-slate-200 flex items-center gap-1.5">
                        <ArrowLeftRight className="w-3.5 h-3.5 text-cyan-400" />
                        <span>{isEn ? 'Variable Parameter Mappings' : '입출력 변수 매핑 (In / Out / InOut)'}</span>
                      </label>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {isEn
                          ? 'Variables are isolated by default. Map specific variables to pass in or receive back.'
                          : '기본적으로 변수는 독립 격리됩니다. 값을 전달(In)하거나 종료 시 반환받을(Out) 변수만 매핑하세요.'}
                      </p>
                    </div>
                  </div>

                  {/* 매핑 추가 & 자동 매핑 버튼 바 */}
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleAddMapping}
                      className="flex-1 py-1.5 px-2.5 rounded-lg bg-cyan-600/90 hover:bg-cyan-500 text-white text-xs font-semibold flex items-center justify-center gap-1 shadow-sm transition-colors cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>{isEn ? 'Add Mapping' : '변수 매핑 추가'}</span>
                    </button>

                    {selectedSubflow && subflowVars.length > 0 && (
                      <button
                        type="button"
                        onClick={handleAutoPopulateMappings}
                        className="py-1.5 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-700/50 text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer shrink-0"
                        title={
                          isEn
                            ? 'Auto-create mappings from sub-workflow variables'
                            : '서브 워크플로우의 변수 목록을 기준으로 매핑 자동 불러오기'
                        }
                      >
                        <Wand2 className="w-3.5 h-3.5" />
                        <span>{isEn ? 'Auto-Fill' : '자동 매핑'}</span>
                      </button>
                    )}
                  </div>

                  {/* 매핑 리스트 */}
                  {mappings.length === 0 ? (
                    <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 text-center text-[11px] text-slate-500">
                      {isEn
                        ? 'No variable mappings configured. Sub-workflow will run with its own isolated default variables.'
                        : '설정된 변수 매핑이 없습니다. 서브 워크플로우가 자체 초기값으로 완전히 격리되어 실행됩니다.'}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {mappings.map((mp, idx) => {
                        const dir: SubflowMappingDirection = mp.direction || 'in';
                        return (
                          <div
                            key={mp.id || idx}
                            className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2"
                          >
                            {/* 방향 선택 (In / Out / InOut) + 삭제 버튼 */}
                            <div className="flex items-center justify-between gap-1">
                              <div className="grid grid-cols-3 gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800 flex-1">
                                <button
                                  type="button"
                                  onClick={() => handleUpdateMapping(idx, { direction: 'in' })}
                                  className={`flex items-center justify-center gap-1 py-1 rounded text-[10px] font-semibold transition-all ${
                                    dir === 'in'
                                      ? 'bg-blue-600 text-white shadow'
                                      : 'text-slate-400 hover:text-slate-200'
                                  }`}
                                  title={isEn ? 'Pass value from Main to Sub-workflow' : '메인 워크플로우 값을 서브 워크플로우로 전달 (In)'}
                                >
                                  <ArrowRight className="w-3 h-3" />
                                  <span>In (전달)</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleUpdateMapping(idx, { direction: 'out' })}
                                  className={`flex items-center justify-center gap-1 py-1 rounded text-[10px] font-semibold transition-all ${
                                    dir === 'out'
                                      ? 'bg-emerald-600 text-white shadow'
                                      : 'text-slate-400 hover:text-slate-200'
                                  }`}
                                  title={isEn ? 'Return value from Sub-workflow to Main on finish' : '서브 워크플로우 종료 시 결과값을 메인 변수로 반환 (Out)'}
                                >
                                  <ArrowLeft className="w-3 h-3" />
                                  <span>Out (반환)</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleUpdateMapping(idx, { direction: 'inout' })}
                                  className={`flex items-center justify-center gap-1 py-1 rounded text-[10px] font-semibold transition-all ${
                                    dir === 'inout'
                                      ? 'bg-purple-600 text-white shadow'
                                      : 'text-slate-400 hover:text-slate-200'
                                  }`}
                                  title={isEn ? 'Pass in at start and receive updated value on finish' : '시작 시 전달하고 종료 시 변경된 값을 다시 반환받음 (InOut)'}
                                >
                                  <ArrowLeftRight className="w-3 h-3" />
                                  <span>InOut</span>
                                </button>
                              </div>

                              <button
                                type="button"
                                onClick={() => handleRemoveMapping(idx)}
                                className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-950/50 transition-colors shrink-0"
                                title={t('common.delete')}
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            {/* 현재(메인) 워크플로우 변수 선택 */}
                            <div>
                              <label className="text-[10px] text-slate-400 block mb-0.5">
                                {isEn ? 'Main Workflow Variable' : '현재(메인) 워크플로우 변수'}
                              </label>
                              <select
                                value={mp.parent_var || ''}
                                onChange={(e) => handleUpdateMapping(idx, { parent_var: e.target.value })}
                                className="w-full px-2 py-1 text-xs bg-slate-900 border border-slate-700 rounded text-emerald-300 font-mono focus:outline-none focus:border-cyan-500"
                              >
                                <option value="">
                                  {isEn ? '-- Select main variable --' : '-- 메인 변수 선택 --'}
                                </option>
                                {variables.map((v) => (
                                  <option key={v.name} value={v.name}>
                                    {v.name} ({v.type})
                                  </option>
                                ))}
                                {dir === 'in' &&
                                  SYSTEM_VARIABLES.map((sv) => (
                                    <option key={sv.name} value={sv.name}>
                                      {sv.name} (system)
                                    </option>
                                  ))}
                              </select>
                            </div>

                            {/* 서브 워크플로우 변수 선택 (또는 직접 입력) */}
                            <div>
                              <label className="text-[10px] text-slate-400 block mb-0.5">
                                {isEn ? 'Sub-Workflow Variable' : '호출 대상(서브) 워크플로우 변수'}
                              </label>
                              {subflowVars.length > 0 ? (
                                <select
                                  value={mp.sub_var || ''}
                                  onChange={(e) => handleUpdateMapping(idx, { sub_var: e.target.value })}
                                  className="w-full px-2 py-1 text-xs bg-slate-900 border border-slate-700 rounded text-cyan-300 font-mono focus:outline-none focus:border-cyan-500"
                                >
                                  <option value="">
                                    {isEn ? '-- Select sub-workflow variable --' : '-- 서브 워크플로우 변수 선택 --'}
                                  </option>
                                  {subflowVars.map((sv) => (
                                    <option key={sv.name} value={sv.name}>
                                      {sv.name} ({sv.type})
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  type="text"
                                  value={mp.sub_var || ''}
                                  onChange={(e) => handleUpdateMapping(idx, { sub_var: e.target.value })}
                                  placeholder={isEn ? 'Sub-workflow variable name' : '서브 워크플로우 변수명 입력'}
                                  className="w-full px-2 py-1 text-xs bg-slate-900 border border-slate-700 rounded text-cyan-300 font-mono focus:outline-none focus:border-cyan-500"
                                />
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 3) 무한 루프 및 과다 호출 안전 보호 정책 안내 */}
                <div className="p-2.5 rounded-xl bg-slate-950/90 border border-slate-800/90 text-[10px] text-slate-400 space-y-1">
                  <div className="font-semibold text-slate-300 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                    <span>{isEn ? 'Sub-Workflow Safety Guardrails' : '서브 워크플로우 3중 안전 가드레일 작동 중'}</span>
                  </div>
                  <ul className="list-disc list-inside space-y-0.5 text-slate-400/90">
                    <li>
                      {isEn
                        ? 'Call-stack cycle detection blocks direct & indirect infinite loops.'
                        : '콜 스택(Call Stack) 추적으로 직·간접 무한 루프 즉시 차단'}
                    </li>
                    <li>
                      {isEn
                        ? 'Max nesting depth (5 levels) & total step limit (500 steps) enforced.'
                        : '최대 중첩 호출 깊이(5단계) 및 세션당 누적 실행(500스텝) 제한'}
                    </li>
                  </ul>
                </div>
              </div>
            );
          })()}
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
