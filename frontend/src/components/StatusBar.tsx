import React from 'react';
import { Globe, Shield, Sparkles, CheckCircle2, AlertTriangle, AlertCircle, Radio } from 'lucide-react';
import { useI18n } from '../i18n';
import { FlowValidationResult } from '../utils/flowValidator';

interface StatusBarProps {
  backendConnected?: boolean;
  ollamaConnected?: boolean;
  activeNodesCount?: number;
  validation?: FlowValidationResult;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  backendConnected = true,
  ollamaConnected = false,
  activeNodesCount,
  validation,
}) => {
  const { language, setLanguage, t } = useI18n();

  return (
    <footer className="h-6 bg-slate-900 border-t border-slate-800 px-3 flex items-center justify-between text-[11px] text-slate-400 select-none z-10 shrink-0">
      {/* 좌측 시스템 및 백엔드 상태 */}
      <div className="flex items-center gap-4">
        {/* 백엔드 연결 인디케이터 */}
        <div className="flex items-center gap-1.5" title={backendConnected ? t('statusBar.backendConnected') : t('statusBar.backendDisconnected')}>
          <span
            className={`w-2 h-2 rounded-full ${
              backendConnected ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50' : 'bg-rose-500 animate-pulse'
            }`}
          />
          <span className="font-mono text-[10px] text-slate-300">
            {backendConnected ? 'Backend 8000' : 'Disconnected'}
          </span>
        </div>

        {/* Ollama 연결 상태 */}
        <div className="hidden sm:flex items-center gap-1" title={ollamaConnected ? t('statusBar.ollamaConnected') : t('statusBar.ollamaDisconnected')}>
          <Sparkles className={`w-3 h-3 ${ollamaConnected ? 'text-purple-400' : 'text-slate-500'}`} />
          <span className={ollamaConnected ? 'text-purple-300' : 'text-slate-500'}>
            Ollama {ollamaConnected ? 'Active' : 'Offline'}
          </span>
        </div>

        {/* F12 Kill Switch 감시 상태 */}
        <div className="hidden md:flex items-center gap-1 text-slate-400">
          <Shield className="w-3 h-3 text-rose-400" />
          <span>F12 Kill Switch</span>
        </div>

        {/* 활성 노드 수 표시 */}
        {typeof activeNodesCount === 'number' && (
          <div className="hidden lg:flex items-center gap-1 text-slate-400">
            <span>{t('flow.totalNodes', { count: activeNodesCount })}</span>
          </div>
        )}
      </div>

      {/* 우측 워크플로우 상태 및 언어 전환 메뉴 */}
      <div className="flex items-center gap-3">
        {/* 워크플로우 요약 */}
        {validation && (
          <div className="hidden sm:flex items-center gap-1">
            {validation.isValid && validation.warnings.length === 0 && (
              <span className="text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                {t('validation.readyToRun')}
              </span>
            )}
            {validation.isValid && validation.warnings.length > 0 && (
              <span className="text-amber-400 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {t('validation.orphanNodes', { count: validation.orphanNodeIds.length })}
              </span>
            )}
            {!validation.isValid && (
              <span className="text-rose-400 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {t('validation.blocked', { count: validation.errors.length })}
              </span>
            )}
          </div>
        )}

        {/* 언어 설정 메뉴 (하단 패널 우측) */}
        <div className="flex items-center gap-1 border-l border-slate-800 pl-3">
          <Globe className="w-3 h-3 text-blue-400" />
          <button
            onClick={() => setLanguage(language === 'ko' ? 'en' : 'ko')}
            className="flex items-center gap-1 text-[11px] font-medium text-slate-300 hover:text-white transition-colors px-1 py-0.5 rounded hover:bg-slate-800"
            title={`${t('common.language')}: ${language === 'ko' ? '한국어 (클릭하여 English로 전환)' : 'English (Click to switch to 한국어)'}`}
          >
            <span>{language === 'ko' ? '한국어' : 'English'}</span>
            <span className="text-[9px] text-slate-500 font-mono">({language.toUpperCase()})</span>
          </button>
        </div>
      </div>
    </footer>
  );
};
