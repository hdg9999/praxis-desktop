import React, { useState, useEffect } from 'react';
import { AppSettings } from '../types';
import { X, Check, Server, Shield, Database, Sparkles, Globe } from 'lucide-react';
import { fetchSettings, updateSettings, fetchOllamaInfo } from '../services/api';
import { useI18n, Language } from '../i18n';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { language, setLanguage, t } = useI18n();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<{ connected: boolean; models: string[] }>({
    connected: false,
    models: []
  });
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchSettings().then(setSettings).catch(console.error);
      fetchOllamaInfo().then(setOllamaStatus).catch(console.error);
    }
  }, [isOpen]);

  if (!isOpen || !settings) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await updateSettings(settings);
      setSettings(updated);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2000);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* 모달 헤더 */}
        <div className="px-6 py-4 bg-slate-800/80 border-b border-slate-700 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Server className="w-4 h-4 text-blue-400" />
            {t('settings.title')}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 설정 본문 */}
        <div className="p-6 space-y-6 text-xs text-slate-300 overflow-y-auto max-h-[75vh]">
          {/* 언어 설정 섹션 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-slate-100 font-semibold border-b border-slate-800 pb-1.5">
              <Globe className="w-4 h-4 text-blue-400" />
              <span>{t('settings.languageSection')}</span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between">
              <div>
                <div className="font-medium text-slate-200">{t('common.language')}</div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {t('settings.languageDesc')}
                </div>
              </div>
              <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-700">
                <button
                  type="button"
                  onClick={() => setLanguage('ko')}
                  className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                    language === 'ko'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  한국어
                </button>
                <button
                  type="button"
                  onClick={() => setLanguage('en')}
                  className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                    language === 'en'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  English
                </button>
              </div>
            </div>
          </div>

          {/* 스토리지 및 세션 유지 관리 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-slate-100 font-semibold border-b border-slate-800 pb-1.5">
              <Database className="w-4 h-4 text-emerald-400" />
              <span>{t('settings.storageSection')}</span>
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/60 border border-slate-800">
              <div>
                <div className="font-medium text-slate-200">{t('settings.autoCleanLabel')}</div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {t('settings.autoCleanDesc')}
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.auto_clean_sessions}
                onChange={(e) => setSettings({ ...settings, auto_clean_sessions: e.target.checked })}
                className="w-4 h-4 rounded border-slate-700 accent-blue-600 cursor-pointer"
              />
            </div>

            {settings.auto_clean_sessions && (
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                <span className="text-slate-300">{t('settings.maxHistoryLabel')}</span>
                <input
                  type="number"
                  min="5"
                  max="500"
                  value={settings.max_session_history}
                  onChange={(e) => setSettings({ ...settings, max_session_history: Number(e.target.value) })}
                  className="w-24 px-2.5 py-1 text-xs bg-slate-900 border border-slate-700 rounded text-slate-200 text-right"
                />
              </div>
            )}

            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/60 border border-slate-800">
              <div>
                <div className="font-medium text-slate-200">{t('settings.captureScreenLabel')}</div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {t('settings.captureScreenDesc')}
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.capture_screen_after_execution ?? true}
                onChange={(e) => setSettings({ ...settings, capture_screen_after_execution: e.target.checked })}
                className="w-4 h-4 rounded border-slate-700 accent-blue-600 cursor-pointer"
              />
            </div>

            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between">
              <div>
                <div className="font-medium text-slate-200">{t('settings.webpFormatLabel')}</div>
                <div className="text-[11px] text-slate-400 mt-0.5">{t('settings.webpFormatDesc')}</div>
              </div>
              <span className="px-2.5 py-1 rounded bg-slate-800 text-blue-400 font-mono font-semibold">
                WebP (80%)
              </span>
            </div>
          </div>

          {/* 로컬 Ollama 연동 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-slate-100 font-semibold border-b border-slate-800 pb-1.5">
              <Sparkles className="w-4 h-4 text-purple-400" />
              <span>{t('settings.ollamaSection')}</span>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">{t('settings.ollamaHostLabel')}</label>
              <input
                type="text"
                value={settings.ollama_base_url}
                onChange={(e) => setSettings({ ...settings, ollama_base_url: e.target.value })}
                className="w-full px-3 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200"
              />
            </div>

            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between">
              <span className="text-slate-400">{t('settings.ollamaStatusLabel')}</span>
              <span
                className={`font-semibold px-2 py-0.5 rounded text-[11px] ${
                  ollamaStatus.connected
                    ? 'text-emerald-400 bg-emerald-950/60 border border-emerald-800/40'
                    : 'text-amber-400 bg-amber-950/60 border border-amber-800/40'
                }`}
              >
                {ollamaStatus.connected ? t('settings.ollamaConnected') : t('settings.ollamaDisconnected')}
              </span>
            </div>

            {ollamaStatus.models.length > 0 && (
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                <div className="text-slate-400 mb-1.5">{t('settings.detectedModelsLabel')}</div>
                <div className="flex flex-wrap gap-1.5">
                  {ollamaStatus.models.map((m) => (
                    <span key={m} className="px-2 py-0.5 rounded bg-purple-950/60 border border-purple-800/50 text-purple-300 font-mono text-[10px]">
                      {m}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 안전 장치 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-slate-100 font-semibold border-b border-slate-800 pb-1.5">
              <Shield className="w-4 h-4 text-rose-400" />
              <span>{t('settings.safetySection')}</span>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between">
              <span className="text-slate-300">{t('settings.killSwitchLabel')}</span>
              <span className="px-2.5 py-1 rounded bg-slate-800 text-rose-400 font-mono font-bold">
                F12
              </span>
            </div>
          </div>
        </div>

        {/* 모달 푸터 */}
        <div className="px-6 py-3.5 bg-slate-800/80 border-t border-slate-700 flex items-center justify-end gap-2">
          {savedSuccess && (
            <span className="text-emerald-400 flex items-center gap-1 text-xs mr-auto">
              <Check className="w-4 h-4" /> {t('settings.savedSuccess')}
            </span>
          )}
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors text-xs font-medium"
          >
            {t('common.close')}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors text-xs font-semibold shadow-sm"
          >
            {saving ? t('common.saving') : t('settings.saveSettings')}
          </button>
        </div>
      </div>
    </div>
  );
};
