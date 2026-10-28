import React, { useState, useEffect } from 'react';
import {
  X,
  SlidersHorizontal,
  Clock,
  Sparkles,
  FileText,
  Workflow,
  Check,
  RefreshCw,
  Layers,
  ShieldAlert,
  Bot,
  Wrench,
  ArrowRight,
  Octagon,
  AlertTriangle,
  Globe,
  Cpu,
} from 'lucide-react';
import {
  WorkflowSettings,
  Flow,
  GlobalErrorHandlerMode,
  AfterErrorAgentAction,
} from '../../types';
import { AGENT_AVAILABLE_SKILLS } from './skillRegistry';
import { detectSubflowCallCycle } from '../../utils/flowValidator';
import { useI18n } from '../../i18n';

interface FlowSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  flowName: string;
  flowDescription: string;
  settings: WorkflowSettings;
  ollamaModels: string[];
  flows?: Flow[];
  activeFlowId?: string;
  activeFlowName?: string;
  onApplySettings: (
    name: string,
    description: string,
    settings: WorkflowSettings,
    applyModelToExistingNodes?: boolean
  ) => void;
}

const DEFAULT_SELF_HEALING_PLACEHOLDER_KO =
  '[미입력 시 기본 동작 프롬프트]\n' +
  '1. 실패한 노드의 이름, 노드 주석(의도), 설정 파라미터와 오류 메시지, 최근 실행 기록을 종합하여 실패 원인을 진단합니다.\n' +
  '2. 자동으로 기본 로드된 실패 노드의 대응 스킬 및 추가 허용 스킬을 활용해 화면/브라우저 상태를 점검하고 원래 노드가 수행하려던 작업을 복구·완수합니다.\n' +
  '3. 복구 조치 결과 또는 오류 분석 요약을 한국어로 명확히 보고합니다.';

const DEFAULT_SELF_HEALING_PLACEHOLDER_EN =
  '[Default Prompt when left empty]\n' +
  '1. Diagnose the root cause using the failed node name, node note (intent), parameters, error message, and session logs.\n' +
  '2. Use the auto-loaded skill for the failed node and any extra allowed skills to inspect the state and recover/complete the intended task.\n' +
  '3. Report the recovery result or error analysis clearly.';

export const FlowSettingsModal: React.FC<FlowSettingsModalProps> = ({
  isOpen,
  onClose,
  flowName,
  flowDescription,
  settings,
  ollamaModels,
  flows = [],
  activeFlowId,
  activeFlowName,
  onApplySettings,
}) => {
  const { t, language } = useI18n();
  const isEn = language === 'en';

  const [name, setName] = useState(flowName);
  const [description, setDescription] = useState(flowDescription);
  const [executionDelay, setExecutionDelay] = useState<number>(settings.execution_delay ?? 0.3);
  const [defaultLlmModel, setDefaultLlmModel] = useState<string>(settings.default_llm_model ?? '');
  const [defaultNumCtx, setDefaultNumCtx] = useState<number>(settings.default_num_ctx ?? 8192);
  const [maxTotalSteps, setMaxTotalSteps] = useState<number>(settings.max_total_steps ?? 1000);
  const [unlimitedSteps, setUnlimitedSteps] = useState<boolean>(Boolean(settings.unlimited_steps));
  const [applyToExisting, setApplyToExisting] = useState(false);

  // 전역 오류 발생 시 처리 (Global Error Handler) 상태
  const [errorMode, setErrorMode] = useState<GlobalErrorHandlerMode>(
    settings.global_error_handler?.mode || 'none'
  );
  const [errorSubflowId, setErrorSubflowId] = useState<string>(
    settings.global_error_handler?.error_subflow_id || ''
  );
  const [errorSubflowName, setErrorSubflowName] = useState<string>(
    settings.global_error_handler?.error_subflow_name || ''
  );
  const [afterAgentAction, setAfterAgentAction] = useState<AfterErrorAgentAction>(
    settings.global_error_handler?.after_agent_action || 'stop_workflow'
  );
  const [agentSkillMode, setAgentSkillMode] = useState<'preset' | 'custom'>(
    settings.global_error_handler?.skill_mode || 'custom'
  );
  const [agentPresetName, setAgentPresetName] = useState<'basic_interaction' | 'web_playwright' | 'all'>(
    settings.global_error_handler?.preset_name || 'basic_interaction'
  );
  const [agentCustomSkills, setAgentCustomSkills] = useState<string[]>(
    Array.isArray(settings.global_error_handler?.custom_skills)
      ? settings.global_error_handler!.custom_skills!
      : ['get_screen_elements', 'window_activate', 'take_screenshot']
  );
  const [agentUserPrompt, setAgentUserPrompt] = useState<string>(
    settings.global_error_handler?.user_prompt || ''
  );
  const [agentMaxSteps, setAgentMaxSteps] = useState<number>(
    settings.global_error_handler?.max_steps ?? 5
  );
  const [agentIncludeScreen, setAgentIncludeScreen] = useState<boolean>(
    Boolean(settings.global_error_handler?.include_screen_capture)
  );

  useEffect(() => {
    if (isOpen) {
      setName(flowName || '');
      setDescription(flowDescription || '');
      setExecutionDelay(
        typeof settings.execution_delay === 'number' && !isNaN(settings.execution_delay)
          ? settings.execution_delay
          : 0.3
      );
      setDefaultLlmModel(settings.default_llm_model || '');
      setDefaultNumCtx(
        typeof settings.default_num_ctx === 'number' &&
          !isNaN(settings.default_num_ctx) &&
          settings.default_num_ctx > 0
          ? settings.default_num_ctx
          : 8192
      );
      setMaxTotalSteps(
        typeof settings.max_total_steps === 'number' &&
          !isNaN(settings.max_total_steps) &&
          settings.max_total_steps > 0
          ? settings.max_total_steps
          : 1000
      );
      setUnlimitedSteps(Boolean(settings.unlimited_steps));
      setApplyToExisting(false);

      const eh = settings.global_error_handler;
      setErrorMode(eh?.mode || 'none');
      setErrorSubflowId(eh?.error_subflow_id || '');
      setErrorSubflowName(eh?.error_subflow_name || '');
      setAfterAgentAction(eh?.after_agent_action || 'stop_workflow');
      setAgentSkillMode(eh?.skill_mode || 'custom');
      setAgentPresetName(eh?.preset_name || 'basic_interaction');
      setAgentCustomSkills(
        Array.isArray(eh?.custom_skills)
          ? eh!.custom_skills!
          : ['get_screen_elements', 'window_activate', 'take_screenshot']
      );
      setAgentUserPrompt(eh?.user_prompt || '');
      setAgentMaxSteps(
        typeof eh?.max_steps === 'number' && eh.max_steps >= 1 ? eh.max_steps : 5
      );
      setAgentIncludeScreen(Boolean(eh?.include_screen_capture));
    }
  }, [isOpen, flowName, flowDescription, settings]);

  if (!isOpen) return null;

  const selectableFlows = flows.filter((f) => f.id !== activeFlowId && !f.id.startsWith('temp_'));
  const subflowCycleChain =
    errorMode === 'subflow' && errorSubflowId
      ? detectSubflowCallCycle(activeFlowId, activeFlowName || name, errorSubflowId, flows)
      : null;

  const handleSelectErrorSubflow = (nextFlowId: string) => {
    const found = flows.find((f) => f.id === nextFlowId);
    setErrorSubflowId(nextFlowId);
    setErrorSubflowName(found ? found.name : '');
  };

  const toggleCustomSkill = (skillId: string) => {
    setAgentCustomSkills((prev) =>
      prev.includes(skillId) ? prev.filter((id) => id !== skillId) : [...prev, skillId]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const safeDelay = Math.max(0, Math.min(60, Number(executionDelay) || 0));
    onApplySettings(
      name.trim() || flowName || '새 워크플로우',
      description.trim(),
      {
        execution_delay: Number(safeDelay.toFixed(2)),
        default_llm_model: defaultLlmModel.trim(),
        default_num_ctx: Math.max(1024, Math.min(131072, Number(defaultNumCtx) || 8192)),
        max_total_steps: Math.max(50, Math.min(1000000, Number(maxTotalSteps) || 1000)),
        unlimited_steps: unlimitedSteps,
        global_error_handler: {
          mode: errorMode,
          error_subflow_id: errorSubflowId.trim(),
          error_subflow_name: errorSubflowName.trim(),
          after_agent_action: afterAgentAction,
          skill_mode: agentSkillMode,
          preset_name: agentPresetName,
          custom_skills: agentCustomSkills,
          user_prompt: agentUserPrompt,
          max_steps: Math.max(1, Math.min(100, Number(agentMaxSteps) || 5)),
          include_screen_capture: agentIncludeScreen,
        },
      },
      applyToExisting
    );
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 select-none"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 모달 헤더 */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-600/20 border border-indigo-500/40 text-indigo-400">
              <SlidersHorizontal className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-100">{t('flowSettings.title')}</h2>
              <p className="text-[11px] text-slate-400 mt-0.5">{t('flowSettings.subtitle')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 설정 폼 본문 (스크롤 영역) */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar">
          {/* 1. 워크플로우 이름 */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-200 mb-1.5">
              <Workflow className="w-3.5 h-3.5 text-blue-400" />
              {t('flowSettings.nameLabel')}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('flowSettings.namePlaceholder')}
              className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/40"
              required
            />
          </div>

          {/* 2. 워크플로우 설명 */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-200 mb-1.5">
              <FileText className="w-3.5 h-3.5 text-emerald-400" />
              {t('flowSettings.descLabel')}
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('flowSettings.descPlaceholder')}
              className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/40 resize-none"
            />
            <p className="text-[10px] text-slate-400 mt-1">
              {isEn
                ? 'Displayed below the workflow name in the left [Workflows] tab and passed as workflow context to the Self-Healing Agent.'
                : '입력한 설명은 좌측 [워크플로우] 탭에 표시되며, 오류 복구 AI 에이전트 호출 시 워크플로우 전체 맥락 정보로도 제공됩니다.'}
            </p>
          </div>

          {/* 3. 워크플로우 실행 속도 (노드 실행 직전 딜레이, 디폴트 0.3초) */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                {t('flowSettings.delayLabel')}
              </label>
              <span className="text-xs font-mono font-bold text-amber-400 bg-amber-950/50 border border-amber-800/60 px-2 py-0.5 rounded-lg">
                {executionDelay}
                {t('common.seconds')}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0"
                max="3"
                step="0.1"
                value={Math.min(3, executionDelay)}
                onChange={(e) => setExecutionDelay(Number(e.target.value))}
                className="flex-1 accent-amber-500"
              />
              <input
                type="number"
                min="0"
                max="60"
                step="0.1"
                value={executionDelay}
                onChange={(e) => setExecutionDelay(Math.max(0, Number(e.target.value)))}
                className="w-20 px-2.5 py-1 text-xs font-mono text-right bg-slate-900 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="flex items-center justify-between text-[10px] text-slate-400">
              <span>{t('flowSettings.delayHelp')}</span>
              <button
                type="button"
                onClick={() => setExecutionDelay(0.3)}
                className="text-amber-400 hover:text-amber-300 underline font-medium shrink-0 ml-2"
              >
                {isEn ? 'Reset (0.3s)' : '기본값(0.3초)'}
              </button>
            </div>
          </div>

          {/* 4. 기본 LLM 모델명 (Ollama 연동 AI 스킬 노드 기본값) */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2.5">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              {t('flowSettings.defaultModelLabel')}
            </label>

            {ollamaModels.length > 0 ? (
              <div className="space-y-2">
                <select
                  value={ollamaModels.includes(defaultLlmModel) ? defaultLlmModel : '__custom__'}
                  onChange={(e) => {
                    if (e.target.value !== '__custom__') {
                      setDefaultLlmModel(e.target.value);
                    }
                  }}
                  className="w-full px-3 py-1.5 text-xs bg-slate-900 border border-purple-800/80 rounded-lg text-purple-200 focus:outline-none focus:border-purple-500"
                >
                  <option value="">
                    {isEn
                      ? `-- Auto (${ollamaModels[0]}) --`
                      : `-- 자동 (감지된 첫 번째 모델: ${ollamaModels[0]}) --`}
                  </option>
                  {ollamaModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                  {defaultLlmModel && !ollamaModels.includes(defaultLlmModel) && (
                    <option value="__custom__">
                      {isEn ? `Custom: ${defaultLlmModel}` : `직접 입력: ${defaultLlmModel}`}
                    </option>
                  )}
                </select>

                <input
                  type="text"
                  value={defaultLlmModel}
                  onChange={(e) => setDefaultLlmModel(e.target.value)}
                  placeholder={t('flowSettings.defaultModelPlaceholder')}
                  className="w-full px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-slate-200 font-mono placeholder-slate-500 focus:outline-none focus:border-purple-500"
                />
              </div>
            ) : (
              <input
                type="text"
                value={defaultLlmModel}
                onChange={(e) => setDefaultLlmModel(e.target.value)}
                placeholder={t('flowSettings.defaultModelPlaceholder')}
                className="w-full px-3 py-1.5 text-xs bg-slate-900 border border-purple-800/80 rounded-lg text-purple-200 font-mono placeholder-slate-500 focus:outline-none focus:border-purple-500"
              />
            )}

            <p className="text-[10px] text-slate-400 leading-relaxed">
              {t('flowSettings.defaultModelHelp')}
            </p>

            {/* 기존 AI 노드에도 일괄 적용 체크박스 */}
            {defaultLlmModel.trim() && (
              <label className="flex items-center gap-2 pt-1.5 border-t border-slate-800/80 cursor-pointer">
                <input
                  type="checkbox"
                  checked={applyToExisting}
                  onChange={(e) => setApplyToExisting(e.target.checked)}
                  className="rounded bg-slate-900 border-slate-700 text-purple-600 focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                />
                <span className="text-[11px] text-purple-300 font-medium flex items-center gap-1">
                  <RefreshCw className="w-3 h-3" />
                  {t('flowSettings.applyModelToExistingBtn')}
                </span>
              </label>
            )}
          </div>

          {/* 5. 기본 LLM 컨텍스트 크기 (기본값: 8192) */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                <Layers className="w-3.5 h-3.5 text-cyan-400" />
                {t('flowSettings.defaultNumCtxLabel')}
              </label>
              <span className="text-xs font-mono font-bold text-cyan-400 bg-cyan-950/50 border border-cyan-800/60 px-2 py-0.5 rounded-lg">
                {defaultNumCtx.toLocaleString()} tokens
              </span>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1024"
                max="131072"
                step="1024"
                value={defaultNumCtx}
                onChange={(e) => setDefaultNumCtx(Math.max(1024, Number(e.target.value) || 8192))}
                className="w-32 px-3 py-1.5 text-xs font-mono text-right bg-slate-900 border border-cyan-800/60 rounded-lg text-cyan-200 focus:outline-none focus:border-cyan-500"
              />
              <div className="flex items-center gap-1 flex-1 overflow-x-auto py-0.5">
                {[8192, 16384, 32768, 65536].map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => setDefaultNumCtx(size)}
                    className={`px-2 py-1 text-[11px] font-mono rounded-lg transition-colors shrink-0 ${
                      defaultNumCtx === size
                        ? 'bg-cyan-600/30 text-cyan-300 border border-cyan-500/60 font-semibold'
                        : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    {size >= 1024 ? `${size / 1024}k` : size}
                  </button>
                ))}
              </div>
            </div>

            <p className="text-[10px] text-slate-400 leading-relaxed">
              {t('flowSettings.defaultNumCtxHelp')}
            </p>
          </div>

          {/* 5-2. 반복 루프 안전 가드레일 & 24시간 상시 모니터링 모드 */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                <RefreshCw className="w-3.5 h-3.5 text-violet-400" />
                <span>
                  {isEn
                    ? 'Max Execution Steps & 24h Monitoring Mode'
                    : '최대 누적 실행 스텝 제한 (루프 안전장치 & 24시간 모니터링)'}
                </span>
              </label>
              <span className="text-xs font-mono font-bold text-violet-300 bg-violet-950/50 border border-violet-800/60 px-2 py-0.5 rounded-lg">
                {unlimitedSteps
                  ? isEn
                    ? '♾️ Unlimited'
                    : '♾️ 무제한 (모니터링)'
                  : `${maxTotalSteps.toLocaleString()} steps`}
              </span>
            </div>

            {!unlimitedSteps && (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="50"
                  max="1000000"
                  step="100"
                  value={maxTotalSteps}
                  onChange={(e) => setMaxTotalSteps(Math.max(50, Number(e.target.value) || 1000))}
                  className="w-32 px-3 py-1.5 text-xs font-mono text-right bg-slate-900 border border-violet-800/60 rounded-lg text-violet-200 focus:outline-none focus:border-violet-500"
                />
                <div className="flex items-center gap-1 flex-1 overflow-x-auto py-0.5">
                  {[500, 1000, 5000, 10000].map((limit) => (
                    <button
                      key={limit}
                      type="button"
                      onClick={() => setMaxTotalSteps(limit)}
                      className={`px-2 py-1 text-[11px] font-mono rounded-lg transition-colors shrink-0 ${
                        maxTotalSteps === limit
                          ? 'bg-violet-600/30 text-violet-300 border border-violet-500/60 font-semibold'
                          : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200 hover:bg-slate-800'
                      }`}
                    >
                      {limit.toLocaleString()}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <label className="flex items-center gap-2 pt-1 cursor-pointer">
              <input
                type="checkbox"
                checked={unlimitedSteps}
                onChange={(e) => setUnlimitedSteps(e.target.checked)}
                className="rounded bg-slate-900 border-slate-700 text-violet-500 focus:ring-0 w-3.5 h-3.5 cursor-pointer"
              />
              <span className="text-[11px] text-violet-200 font-medium">
                {isEn
                  ? 'Allow Unlimited Steps (24-Hour Continuous Monitoring Loop Mode)'
                  : '무제한 반복 스텝 허용 (24시간 상시 모니터링 무한루프 워크플로우용)'}
              </span>
            </label>

            <p className="text-[10px] text-slate-400 leading-relaxed">
              {isEn
                ? 'Prevents unintended infinite loops by stopping execution when total steps exceed the limit. Enable Unlimited mode for 24-hour monitoring workflows (memory & screenshot auto-rotation stays active).'
                : '실수로 탈출 조건이 없는 무한루프를 작성했을 때 지정한 스텝 수 도달 시 안전하게 자동 중단합니다. 24시간 상시 모니터링 목적의 워크플로우에서는 무제한 모드를 체크하세요 (로그/스크린샷 메모리 자동 순환 보호 적용됨).'}
            </p>
          </div>

          {/* 6. 전역 오류 발생 시 처리 (Global Error Handler) */}
          <div className="p-3.5 rounded-xl bg-slate-950/80 border border-rose-900/50 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <label className="flex items-center gap-1.5 text-xs font-bold text-rose-300">
                  <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{t('flowSettings.errorHandlerTitle')}</span>
                </label>
                <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">
                  {t('flowSettings.errorHandlerSubtitle')}
                </p>
              </div>
              <span
                className={`text-[10px] px-2 py-0.5 rounded-lg font-mono shrink-0 ${
                  errorMode === 'subflow'
                    ? 'bg-cyan-950/70 text-cyan-300 border border-cyan-700/60'
                    : errorMode === 'self_healing_agent'
                    ? 'bg-indigo-950/70 text-indigo-300 border border-indigo-700/60'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                {errorMode === 'subflow'
                  ? isEn
                    ? 'Run Workflow'
                    : '워크플로우 실행'
                  : errorMode === 'self_healing_agent'
                  ? isEn
                    ? 'Self-Healing Agent'
                    : 'AI 복구 에이전트'
                  : isEn
                  ? 'Disabled (Stop)'
                  : '미사용 (즉시 중단)'}
              </span>
            </div>

            {/* 선택지 1: 워크플로우 실행 (에러 핸들러 서브플로우) */}
            <div
              onClick={() => setErrorMode(errorMode === 'subflow' ? 'none' : 'subflow')}
              className={`p-3 rounded-xl border transition-all cursor-pointer space-y-2 ${
                errorMode === 'subflow'
                  ? 'bg-cyan-950/30 border-cyan-600/70 text-cyan-100'
                  : 'bg-slate-900/70 border-slate-800 text-slate-300 hover:border-slate-700'
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={errorMode === 'subflow'}
                    onChange={() => {}}
                    className="rounded bg-slate-900 border-slate-700 text-cyan-500 focus:ring-0 w-3.5 h-3.5 pointer-events-none"
                  />
                  <Workflow className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span className="text-xs font-semibold">
                    {isEn
                      ? '1) Run Error Handler Workflow'
                      : '1) 워크플로우 실행 (에러 핸들러 서브플로우)'}
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 pl-5 leading-relaxed">
                  {isEn
                    ? 'Executes a saved recovery/cleanup workflow when an unhandled error occurs.'
                    : '사용자가 작성해 둔 에러 핸들러 서브플로우를 실행하여 알림 전송, 창 정리 등 후처리를 수행합니다.'}
                </p>
              </div>

              {errorMode === 'subflow' && (
                <div
                  className="pt-2.5 border-t border-cyan-800/50 space-y-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <label className="text-[11px] font-medium text-cyan-300 block">
                    {isEn ? 'Select Error Handler Sub-Workflow' : '실행할 에러 핸들러 서브플로우 선택'}
                  </label>
                  <select
                    value={errorSubflowId}
                    onChange={(e) => handleSelectErrorSubflow(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs bg-slate-950 border border-cyan-700/70 rounded-lg text-slate-200 focus:outline-none focus:border-cyan-400"
                  >
                    <option value="">
                      {isEn
                        ? '-- Select a saved workflow --'
                        : '-- 저장된 에러 핸들러 워크플로우 선택 --'}
                    </option>
                    {selectableFlows.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>

                  {selectableFlows.length === 0 && (
                    <p className="text-[10px] text-amber-400">
                      {isEn
                        ? 'No other saved workflows available. Please create and save a recovery workflow first.'
                        : '선택 가능한 다른 저장된 워크플로우가 없습니다. 먼저 에러 핸들러용 워크플로우를 만들어 저장해 주세요.'}
                    </p>
                  )}

                  {subflowCycleChain && (
                    <div className="p-2 rounded-lg bg-rose-950/70 border border-rose-700/80 text-[10px] text-rose-200 space-y-1">
                      <div className="font-semibold text-rose-300 flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                        <span>
                          {isEn ? 'Circular Call Loop Detected!' : '순환 호출(무한 루프) 감지!'}
                        </span>
                      </div>
                      <p className="font-mono break-all text-rose-300/90">
                        {subflowCycleChain.join(' ➔ ')}
                      </p>
                    </div>
                  )}

                  <p className="text-[10px] text-cyan-300/80 leading-relaxed">
                    {isEn
                      ? '* Inside the error handler workflow, you can reference {{last_error_message}}, {{last_error_node_name}}, and {{last_error_node_id}}.'
                      : '* 호출된 서브플로우 내부에서 {{last_error_message}}, {{last_error_node_name}}, {{last_error_node_id}} 시스템 변수로 실패 원인을 참조할 수 있습니다.'}
                  </p>
                </div>
              )}
            </div>

            {/* 선택지 2: 오류 복구 AI 에이전트 호출 (Self-Healing Agent) */}
            <div
              onClick={() =>
                setErrorMode(
                  errorMode === 'self_healing_agent' ? 'none' : 'self_healing_agent'
                )
              }
              className={`p-3 rounded-xl border transition-all cursor-pointer space-y-3 ${
                errorMode === 'self_healing_agent'
                  ? 'bg-indigo-950/35 border-indigo-500/80 text-indigo-100'
                  : 'bg-slate-900/70 border-slate-800 text-slate-300 hover:border-slate-700'
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={errorMode === 'self_healing_agent'}
                    onChange={() => {}}
                    className="rounded bg-slate-900 border-slate-700 text-indigo-500 focus:ring-0 w-3.5 h-3.5 pointer-events-none"
                  />
                  <Bot className="w-4 h-4 text-indigo-400 shrink-0" />
                  <span className="text-xs font-semibold">
                    {isEn
                      ? '2) Call Self-Healing AI Agent (Runtime Error Recovery)'
                      : '2) 오류 복구 AI 에이전트 호출 (Self-Healing Agent)'}
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 pl-5 leading-relaxed">
                  {isEn
                    ? 'Invokes an AI recovery agent with full context of the failed node, workflow overview, session logs, and auto-loaded skills.'
                    : '오류가 발생한 노드 정보(노드 주석 포함), 워크플로우 전체 개요, 현 세션 실행 기록 및 해당 노드의 에이전트 스킬을 런타임에 자동 로드하여 복구 또는 후처리를 수행합니다.'}
                </p>
              </div>

              {errorMode === 'self_healing_agent' && (
                <div
                  className="pt-3 border-t border-indigo-800/50 space-y-3.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* 2-1. 런타임 자동 인식 컨텍스트 및 저사양/소형 LLM 경량화 아키텍처 안내 */}
                  <div className="p-2.5 rounded-xl bg-slate-950/90 border border-indigo-800/60 space-y-1.5 text-[10px]">
                    <div className="font-semibold text-indigo-300 flex items-center gap-1.5">
                      <Cpu className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                      <span>
                        {isEn
                          ? 'Auto-Injected Context & Small-LLM Friendly Optimization'
                          : '런타임 자동 인식 맥락 & 소형 LLM 메모리 보호 적용됨'}
                      </span>
                    </div>
                    <ul className="list-disc list-inside space-y-0.5 text-slate-300/90 leading-relaxed">
                      <li>
                        {isEn
                          ? 'Failed node details including Node Note (comment), target object/selector, and error message (heavy base64 images stripped).'
                          : '노드 주석(Note)을 포함한 실패 노드의 제반 설정 및 에러 메시지 자동 전달 (대용량 이미지 제외 경량화)'}
                      </li>
                      <li>
                        {isEn
                          ? 'Current workflow name/description/step flow + recent session logs (with get_session_logs tool for on-demand log inspection).'
                          : '현재 워크플로우 이름·설명·흐름 개요 + 현 세션 최근 로그 요약 및 전체 실행 기록 열람 도구(get_session_logs) 제공'}
                      </li>
                      <li>
                        {isEn
                          ? 'Agent skill matching the failed skill node is automatically loaded by default.'
                          : '오류가 발생한 일반 스킬 노드에 해당하는 에이전트 스킬이 별도 설정 없이도 런타임에 자동 기본 로드됨'}
                      </li>
                    </ul>
                  </div>

                  {/* 2-2. 에이전트 동작 종료 시 후속 진행 옵션 */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold text-indigo-200 block">
                      {isEn
                        ? 'Action After Recovery Agent Finishes'
                        : '에이전트 동작 종료 시 워크플로우 진행 방식'}
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setAfterAgentAction('continue_next')}
                        className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer space-y-1 ${
                          afterAgentAction === 'continue_next'
                            ? 'bg-emerald-950/50 border-emerald-500/80 text-emerald-100 shadow-sm'
                            : 'bg-slate-950/70 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 text-xs font-bold">
                          <ArrowRight className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span>
                            {isEn ? 'Continue to Next Node' : '원래 워크플로우의 다음 노드 실행'}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400 leading-tight">
                          {isEn
                            ? 'Agent heals/completes the failed step, then resumes the main workflow from the next node.'
                            : '에이전트가 실패한 작업을 대신 복구·수행한 뒤, 원래 워크플로우의 다음 노드로 이어서 진행합니다.'}
                        </p>
                      </button>

                      <button
                        type="button"
                        onClick={() => setAfterAgentAction('stop_workflow')}
                        className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer space-y-1 ${
                          afterAgentAction === 'stop_workflow'
                            ? 'bg-rose-950/50 border-rose-500/80 text-rose-100 shadow-sm'
                            : 'bg-slate-950/70 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 text-xs font-bold">
                          <Octagon className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                          <span>{isEn ? 'Stop Workflow' : '워크플로우 종료'}</span>
                        </div>
                        <p className="text-[10px] text-slate-400 leading-tight">
                          {isEn
                            ? 'Agent performs error analysis / cleanup, then terminates the workflow.'
                            : '에이전트가 오류 원인 분석 및 스마트 후처리를 마친 후 워크플로우를 종료합니다.'}
                        </p>
                      </button>
                    </div>
                  </div>

                  {/* 2-3. 오류 발생 스킬 노드 외 추가로 허용할 스킬셋 (기본 에이전트 노드와 동일한 UI) */}
                  <div className="space-y-2 pt-1 border-t border-slate-800/80">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-semibold text-indigo-200 flex items-center gap-1.5">
                        <Wrench className="w-3.5 h-3.5 text-indigo-400" />
                        <span>
                          {isEn
                            ? 'Additional Allowed Skillset (Beyond Failed Node Skill)'
                            : '오류 지점 스킬 외 추가로 허용할 스킬셋'}
                        </span>
                      </label>
                      <span className="text-[10px] font-mono text-indigo-300 bg-indigo-950/70 border border-indigo-800/60 px-1.5 py-0.5 rounded">
                        {agentSkillMode === 'preset'
                          ? isEn
                            ? `Preset: ${agentPresetName}`
                            : `프리셋 모드`
                          : isEn
                          ? `+${agentCustomSkills.length} extra skill(s)`
                          : `추가 선택 ${agentCustomSkills.length}개`}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 leading-tight">
                      {isEn
                        ? 'The skill corresponding to the failed node and get_session_logs are always loaded automatically. Select additional skills to allow during recovery.'
                        : '실패한 노드에 해당하는 에이전트 스킬과 실행 기록 조회(get_session_logs)는 기본 로드됩니다. 팝업 닫기·창 활성화 등 복구에 추가로 허용할 스킬셋을 지정하세요.'}
                    </p>

                    {/* 프리셋 모드 / 커스텀 모드 전환 탭 */}
                    <div className="grid grid-cols-2 gap-1 p-1 bg-slate-950 rounded-lg border border-slate-800">
                      <button
                        type="button"
                        onClick={() => setAgentSkillMode('custom')}
                        className={`py-1 text-xs font-medium rounded-md transition-all ${
                          agentSkillMode === 'custom'
                            ? 'bg-indigo-600 text-white shadow'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {isEn ? 'Custom Mode (Recommended)' : '커스텀 모드 (소형 모델 권장)'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setAgentSkillMode('preset')}
                        className={`py-1 text-xs font-medium rounded-md transition-all ${
                          agentSkillMode === 'preset'
                            ? 'bg-indigo-600 text-white shadow'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {isEn ? 'Preset Mode' : '프리셋 모드'}
                      </button>
                    </div>

                    {agentSkillMode === 'preset' ? (
                      <div className="space-y-2">
                        <select
                          value={agentPresetName}
                          onChange={(e) =>
                            setAgentPresetName(
                              e.target.value as 'basic_interaction' | 'web_playwright' | 'all'
                            )
                          }
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

                        {agentPresetName === 'web_playwright' && (
                          <div className="p-2 bg-cyan-950/40 border border-cyan-800/60 rounded-lg flex items-start gap-2 text-cyan-200 text-[10px]">
                            <Globe className="w-3.5 h-3.5 shrink-0 text-cyan-400 mt-0.5" />
                            <span>
                              {isEn
                                ? 'Loads Playwright DOM/ref skills for web error recovery without mouse interference.'
                                : 'Playwright 웹 요소(ref) 스캔 및 조작 스킬셋을 로드하여 웹 자동화 오류를 정교하게 복구합니다.'}
                            </span>
                          </div>
                        )}

                        {agentPresetName === 'all' && (
                          <div className="p-2 bg-amber-950/40 border border-amber-800/60 rounded-lg flex items-start gap-2 text-amber-300 text-[10px]">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400 mt-0.5" />
                            <span>
                              {isEn
                                ? 'Loading all 27 skills may slow down inference or degrade accuracy on small LLMs (<=8B).'
                                : '전체 스킬(27종) 로드는 소형 모델(8B 이하)에서 추론 속도 저하 및 컨텍스트 비대화를 유발할 수 있으므로 필요한 스킬만 선택하는 커스텀 모드를 권장합니다.'}
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[10px] text-slate-400 px-0.5">
                          <span>
                            {isEn
                              ? 'Check additional skills to grant:'
                              : '복구 에이전트에게 추가로 허용할 스킬 체크:'}
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setAgentCustomSkills([
                                  'get_screen_elements',
                                  'window_activate',
                                  'take_screenshot',
                                ])
                              }
                              className="text-indigo-400 hover:text-indigo-300 underline"
                            >
                              {isEn ? 'Recommended (3)' : '권장 기본(3종)'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setAgentCustomSkills([])}
                              className="text-slate-400 hover:text-slate-200 underline"
                            >
                              {isEn ? 'Failed Node Skill Only (0)' : '실패 노드 스킬만 사용(0)'}
                            </button>
                          </div>
                        </div>
                        <div className="space-y-1 max-h-44 overflow-y-auto pr-1 custom-scrollbar">
                          {AGENT_AVAILABLE_SKILLS.map((skill) => {
                            const isChecked = agentCustomSkills.includes(skill.id);
                            return (
                              <div
                                key={skill.id}
                                onClick={() => toggleCustomSkill(skill.id)}
                                className={`p-2 rounded-lg border text-xs cursor-pointer transition-all flex items-start gap-2 ${
                                  isChecked
                                    ? 'bg-indigo-950/50 border-indigo-700/80 text-slate-100'
                                    : 'bg-slate-950/60 border-slate-800/70 text-slate-400 hover:border-slate-700'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => {}}
                                  className="mt-0.5 rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0 pointer-events-none"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between">
                                    <span className="font-medium truncate text-[11px]">
                                      {skill.name}
                                    </span>
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
                      </div>
                    )}
                  </div>

                  {/* 2-4. 사용자 프롬프트 (미입력 시 디폴트 복구 프롬프트 동작) */}
                  <div className="space-y-1.5 pt-1 border-t border-slate-800/80">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-semibold text-indigo-200">
                        {isEn
                          ? 'User Prompt (Optional — Uses Default Recovery Prompt if Empty)'
                          : '사용자 프롬프트 (미입력 시 디폴트 오류 복구 프롬프트로 동작)'}
                      </label>
                      {agentUserPrompt.trim() && (
                        <button
                          type="button"
                          onClick={() => setAgentUserPrompt('')}
                          className="text-[10px] text-slate-400 hover:text-rose-300 underline"
                        >
                          {isEn ? 'Reset to Default' : '비우기(디폴트 프롬프트 사용)'}
                        </button>
                      )}
                    </div>
                    <textarea
                      rows={4}
                      value={agentUserPrompt}
                      onChange={(e) => setAgentUserPrompt(e.target.value)}
                      placeholder={
                        isEn
                          ? DEFAULT_SELF_HEALING_PLACEHOLDER_EN
                          : DEFAULT_SELF_HEALING_PLACEHOLDER_KO
                      }
                      className="w-full px-3 py-2 text-xs bg-slate-950 border border-indigo-800/70 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-400 resize-y leading-relaxed"
                    />
                    <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                      <span className="text-slate-400">
                        {isEn ? 'Quick Templates:' : '프롬프트 예시 빠른 적용:'}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setAgentUserPrompt(
                            '오류가 발생한 노드의 주석(의도)과 현재 화면/브라우저 상태를 확인하여 방해되는 팝업이나 알림창이 있다면 닫고, 실패한 노드가 원래 수행하려던 동작을 대신 완수해 주세요.'
                          )
                        }
                        className="px-2 py-0.5 rounded bg-slate-800 hover:bg-indigo-900/60 text-indigo-300 border border-slate-700"
                      >
                        {isEn ? '🔧 Active Self-Healing' : '🔧 능동적 작업 대행·복구형'}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setAgentUserPrompt(
                            '현재 실행 기록(get_session_logs)과 실패 노드 정보를 바탕으로 왜 오류가 발생했는지 원인을 3줄 이내로 명확히 진단하여 보고하고, 필요한 경우 화면 캡처나 알림창으로 사용자에게 알려주세요.'
                          )
                        }
                        className="px-2 py-0.5 rounded bg-slate-800 hover:bg-indigo-900/60 text-indigo-300 border border-slate-700"
                      >
                        {isEn ? '🔍 Smart Error Analysis & Post-Process' : '🔍 스마트 오류 원인 분석·후처리형'}
                      </button>
                    </div>
                  </div>

                  {/* 2-5. 에이전트 최대 추론 스텝 & 초기 화면 캡처 포함 여부 */}
                  <div className="grid grid-cols-2 gap-3 pt-1 border-t border-slate-800/80">
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">
                        {isEn
                          ? 'Max Recovery Steps (1~100, Default: 5)'
                          : '최대 복구 추론 스텝 (1~100회, 기본: 5회)'}
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={agentMaxSteps}
                        onChange={(e) =>
                          setAgentMaxSteps(Math.max(1, Math.min(100, Number(e.target.value) || 5)))
                        }
                        className="w-full px-2.5 py-1 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 font-mono"
                      />
                    </div>
                    <div className="flex flex-col justify-end">
                      <label className="flex items-center gap-2 cursor-pointer py-1">
                        <input
                          type="checkbox"
                          checked={agentIncludeScreen}
                          onChange={(e) => setAgentIncludeScreen(e.target.checked)}
                          className="rounded bg-slate-900 border-slate-700 text-indigo-500 focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                        />
                        <span className="text-[11px] text-slate-300">
                          {isEn
                            ? 'Attach Screen Capture (Vision LLM)'
                            : '오류 시점 화면 캡처 자동 첨부 (Vision 모델용)'}
                        </span>
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 하단 버튼 */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/20 transition-all"
            >
              <Check className="w-3.5 h-3.5" />
              {t('flowSettings.saveBtn')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
