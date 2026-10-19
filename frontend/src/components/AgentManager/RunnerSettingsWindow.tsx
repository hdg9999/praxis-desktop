import React, { useState } from 'react';
import { SlidersHorizontal, Check, Save } from 'lucide-react';
import { useI18n } from '../../i18n';

interface RunnerSettingsWindowProps {
  onClose?: () => void;
}

export const RunnerSettingsWindow: React.FC<RunnerSettingsWindowProps> = ({ onClose }) => {
  const { t } = useI18n();
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      if (onClose) {
        onClose();
      } else if (window.electronAPI?.closeRunnerSettingsWindow) {
        window.electronAPI.closeRunnerSettingsWindow();
      }
    }, 500);
  };

  return (
    <div className="w-full h-screen bg-slate-900 text-slate-100 flex flex-col select-none overflow-hidden font-sans">
      {/* 상단 헤더 */}
      <header className="px-5 py-3.5 bg-slate-950 border-b border-slate-800 flex items-center gap-2.5 shrink-0">
        <div className="p-1.5 rounded-lg bg-indigo-950/70 border border-indigo-800/60 text-indigo-400">
          <SlidersHorizontal className="w-4 h-4" />
        </div>
        <div>
          <h1 className="text-sm font-bold text-slate-100">{t('runnerSettings.title')}</h1>
          <p className="text-[11px] text-slate-400 leading-none mt-0.5">
            {t('runnerSettings.subtitle')}
          </p>
        </div>
      </header>

      {/* 빈 설정 템플릿 영역 */}
      <main className="flex-1 p-6 flex items-center justify-center bg-slate-900">
        <div className="w-full h-full rounded-xl border border-dashed border-slate-800 bg-slate-950/40 flex flex-col items-center justify-center p-6 text-center">
          <p className="text-xs text-slate-500">
            {t('runnerSettings.templateNoticeDesc')}
          </p>
        </div>
      </main>

      {/* 하단 푸터 (저장 버튼만 존재) */}
      <footer className="px-5 py-3.5 bg-slate-950 border-t border-slate-800 flex items-center justify-end gap-3 shrink-0">
        {saved && (
          <span className="text-xs text-emerald-400 flex items-center gap-1 mr-auto font-medium">
            <Check className="w-3.5 h-3.5" />
            {t('runnerSettings.savedFeedback')}
          </span>
        )}
        <button
          type="button"
          onClick={handleSave}
          className="flex items-center gap-1.5 px-5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-500/20 transition-all active:scale-95"
        >
          <Save className="w-3.5 h-3.5" />
          <span>{t('runnerSettings.saveBtn')}</span>
        </button>
      </footer>
    </div>
  );
};
