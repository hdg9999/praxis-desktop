import React from 'react';
import {
  Play,
  Save,
  Plus,
  Settings as SettingsIcon,
  Workflow,
  MessageSquareText,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Globe,
  SlidersHorizontal,
  Loader2,
} from 'lucide-react';
import { Flow } from '../types';
import { FlowValidationResult } from '../utils/flowValidator';
import { useI18n } from '../i18n';

interface NavbarProps {
  currentTab: 'builder' | 'runner';
  onChangeTab: (tab: 'builder' | 'runner') => void;
  flows: Flow[];
  activeFlow: Flow | null;
  onSelectFlow: (flowId: string) => void;
  onUpdateFlowName: (name: string) => void;
  onNewFlow: () => void;
  onSaveFlow: () => void;
  onRunFlow: () => void;
  onOpenSettings: () => void;
  onOpenFlowSettings?: () => void;
  isSaving?: boolean;
  isLoadingFlows?: boolean;
  isExecuting?: boolean;
  validation?: FlowValidationResult;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  onChangeTab,
  flows,
  activeFlow,
  onSelectFlow,
  onUpdateFlowName,
  onNewFlow,
  onSaveFlow,
  onRunFlow,
  onOpenSettings,
  onOpenFlowSettings,
  isSaving,
  isLoadingFlows,
  isExecuting,
  validation,
}) => {
  const { language, setLanguage, t } = useI18n();

  return (
    <header className="h-14 bg-slate-900 border-b border-slate-800 px-4 flex items-center justify-between select-none z-10 shadow-md">
      {/* 좌측 로고 및 탭 전환 */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <span className="text-white font-bold text-sm tracking-tighter">PX</span>
          </div>
          <div>
            <div className="font-bold text-sm tracking-tight bg-gradient-to-r from-blue-400 via-indigo-300 to-purple-400 bg-clip-text text-transparent">
              {t('nav.appTitle')}
            </div>
            <div className="text-[10px] text-slate-400 font-mono leading-none">{t('nav.appSubtitle')}</div>
          </div>
        </div>

        {/* 메인 모드 탭 (Builder <-> Runner) */}
        <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => onChangeTab('builder')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
              currentTab === 'builder'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Workflow className="w-3.5 h-3.5" />
            {t('nav.flowBuilder')}
          </button>
          <button
            onClick={() => onChangeTab('runner')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
              currentTab === 'runner'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <MessageSquareText className="w-3.5 h-3.5" />
            {t('nav.agentRunner')}
          </button>
        </div>
      </div>

      {/* 중앙 Flow 선택 및 관리 (Builder 모드일 때) */}
      {currentTab === 'builder' && (
        <div className="flex items-center gap-2">
          {/* 워크플로우 목록 선택 드롭다운 */}
          <select
            value={activeFlow?.id || ''}
            onChange={(e) => onSelectFlow(e.target.value)}
            disabled={isLoadingFlows}
            className="px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-blue-500 max-w-[170px] truncate disabled:opacity-60"
            title={t('nav.selectFlowPlaceholder')}
          >
            {isLoadingFlows ? (
              <option value="" disabled>{t('nav.loadingFlows')}</option>
            ) : flows.length === 0 ? (
              <option value="" disabled>{t('nav.noSavedFlows')}</option>
            ) : (
              flows.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))
            )}
          </select>

          {/* 워크플로우 이름 직접 입력 및 수정 필드 */}
          <input
            type="text"
            value={activeFlow?.name || ''}
            onChange={(e) => onUpdateFlowName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onSaveFlow();
              }
            }}
            placeholder={t('nav.flowNamePlaceholder')}
            className="px-3 py-1.5 bg-slate-950 border border-slate-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-lg text-xs font-medium text-slate-100 placeholder-slate-500 focus:outline-none w-48 sm:w-64 transition-all"
            title={t('nav.flowNameTooltip')}
          />

          {onOpenFlowSettings && (
            <button
              onClick={onOpenFlowSettings}
              className="flex items-center gap-1 px-2.5 py-1.5 text-indigo-300 hover:text-white bg-indigo-950/50 hover:bg-indigo-900/70 rounded-lg transition-colors border border-indigo-800/70 text-xs font-medium"
              title={t('nav.flowSettingsTooltip')}
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-400" />
              <span className="hidden xl:inline">{t('nav.flowSettings')}</span>
            </button>
          )}

          <button
            onClick={onNewFlow}
            className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors border border-slate-800"
            title={t('nav.newFlowTooltip')}
          >
            <Plus className="w-4 h-4" />
          </button>

          <button
            onClick={onSaveFlow}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white border border-slate-700 text-xs font-medium transition-colors"
            title={t('nav.saveFlowTooltip')}
          >
            <Save className="w-3.5 h-3.5" />
            {isSaving ? t('common.saving') : t('common.save')}
          </button>

          {/* 실시간 워크플로우 유효성 검사 상태 배지 */}
          {validation && (
            <div className="flex items-center ml-1">
              {validation.isValid && validation.warnings.length === 0 && (
                <div
                  className="flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-950/50 border border-emerald-800/60 px-2 py-1 rounded-lg select-none"
                  title={t('validation.readyTooltip')}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{t('validation.readyToRun')}</span>
                </div>
              )}

              {validation.isValid && validation.warnings.length > 0 && (
                <div
                  className="flex items-center gap-1 text-[11px] font-medium text-amber-400 bg-amber-950/50 border border-amber-800/60 px-2 py-1 rounded-lg cursor-help select-none"
                  title={t('validation.orphanTooltip', { warnings: validation.warnings.join('\n') })}
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>{t('validation.orphanNodes', { count: validation.orphanNodeIds.length })}</span>
                </div>
              )}

              {!validation.isValid && (
                <div
                  className="flex items-center gap-1 text-[11px] font-medium text-rose-400 bg-rose-950/60 border border-rose-800/80 px-2.5 py-1 rounded-lg cursor-help animate-pulse select-none"
                  title={t('validation.blockedTooltip', { errors: validation.errors.map((e) => `• ${e}`).join('\n') })}
                >
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>{t('validation.blocked', { count: validation.errors.length })}</span>
                </div>
              )}
            </div>
          )}

          <button
            onClick={onRunFlow}
            disabled={(validation ? !validation.isValid : false) || isExecuting}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold shadow-md transition-all ml-1 ${
              (validation && !validation.isValid) || isExecuting
                ? 'bg-slate-800/80 text-slate-500 border border-slate-700/60 cursor-not-allowed shadow-none'
                : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-500 hover:to-indigo-500 shadow-blue-500/20 active:scale-95'
            }`}
            title={
              validation && !validation.isValid
                ? t('nav.cannotRunTooltip', { errors: validation.errors.join('\n') })
                : t('nav.runFlowTooltip')
            }
          >
            {isExecuting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-300" />
            ) : (
              <Play className="w-3.5 h-3.5 fill-current" />
            )}
            <span>{isExecuting ? t('common.running') : t('nav.runFlow')}</span>
            <kbd className="hidden sm:inline-block ml-0.5 px-1.5 py-0.5 text-[10px] font-mono font-bold bg-white/20 text-white/95 rounded border border-white/30 shadow-xs leading-none">
              F5
            </kbd>
          </button>
        </div>
      )}

      {/* 우측 언어 스위처, 비상 정지 안내, 환경설정 */}
      <div className="flex items-center gap-2.5">
        {/* 비상 정지 안내 */}
        <div className="hidden lg:flex items-center gap-1.5 text-[11px] text-rose-400/80 bg-rose-950/30 border border-rose-900/40 px-2.5 py-1 rounded-full">
          <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
          <span>{t('nav.emergencyStop')}: <kbd className="font-mono font-bold text-rose-300">F12</kbd></span>
        </div>

        {/* 직관적인 원클릭 언어 스위처 [🌐 KO | EN] */}
        <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[11px] font-semibold" title={t('common.language')}>
          <div className="flex items-center pl-1.5 pr-1 text-slate-400">
            <Globe className="w-3.5 h-3.5 text-blue-400" />
          </div>
          <button
            onClick={() => setLanguage('ko')}
            className={`px-2 py-0.5 rounded transition-all ${
              language === 'ko'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="한국어로 변경"
          >
            KO
          </button>
          <button
            onClick={() => setLanguage('en')}
            className={`px-2 py-0.5 rounded transition-all ${
              language === 'en'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Switch to English"
          >
            EN
          </button>
        </div>

        {/* 환경설정 버튼 */}
        <button
          onClick={onOpenSettings}
          className="p-2 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-xl transition-colors border border-slate-800"
          title={t('nav.settings')}
        >
          <SettingsIcon className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
