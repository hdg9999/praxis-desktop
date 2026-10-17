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
} from 'lucide-react';
import { WorkflowSettings } from '../../types';
import { useI18n } from '../../i18n';

interface FlowSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  flowName: string;
  flowDescription: string;
  settings: WorkflowSettings;
  ollamaModels: string[];
  onApplySettings: (
    name: string,
    description: string,
    settings: WorkflowSettings,
    applyModelToExistingNodes?: boolean
  ) => void;
}

export const FlowSettingsModal: React.FC<FlowSettingsModalProps> = ({
  isOpen,
  onClose,
  flowName,
  flowDescription,
  settings,
  ollamaModels,
  onApplySettings,
}) => {
  const { t, language } = useI18n();
  const isEn = language === 'en';

  const [name, setName] = useState(flowName);
  const [description, setDescription] = useState(flowDescription);
  const [executionDelay, setExecutionDelay] = useState<number>(settings.execution_delay ?? 0.3);
  const [defaultLlmModel, setDefaultLlmModel] = useState<string>(settings.default_llm_model ?? '');
  const [defaultNumCtx, setDefaultNumCtx] = useState<number>(settings.default_num_ctx ?? 8192);
  const [applyToExisting, setApplyToExisting] = useState(false);

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
        typeof settings.default_num_ctx === 'number' && !isNaN(settings.default_num_ctx) && settings.default_num_ctx > 0
          ? settings.default_num_ctx
          : 8192
      );
      setApplyToExisting(false);
    }
  }, [isOpen, flowName, flowDescription, settings]);

  if (!isOpen) return null;

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
        className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 모달 헤더 */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
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

        {/* 설정 폼 본문 */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
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
                ? 'Displayed below the workflow name in the left [Workflows] tab.'
                : '입력한 설명은 좌측 패널의 [워크플로우] 탭에서 워크플로우 이름과 함께 표시됩니다.'}
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
