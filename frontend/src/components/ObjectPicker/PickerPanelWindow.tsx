import React, { useState, useEffect } from 'react';
import { X, Check, RotateCcw, Crosshair, Tag, Layers } from 'lucide-react';
import { UIObjectData } from '../../types';
import { resolveImageUrl, connectWebSocket } from '../../services/api';
import { useI18n } from '../../i18n';

export const PickerPanelWindow: React.FC = () => {
  const { t } = useI18n();
  const [selectedObject, setSelectedObject] = useState<UIObjectData | null>(null);
  const [objectName, setObjectName] = useState<string>('');

  useEffect(() => {
    // 1. Electron IPC 이벤트 수신 (하위 호환)
    if (window.electronAPI?.onPickerUpdateSelection) {
      window.electronAPI.onPickerUpdateSelection((data: any) => {
        setSelectedObject(data);
        setObjectName(data.name || `UI_${data.x}_${data.y}`);
      });
    }

    // 2. 백엔드 전역 UIA 마우스 피커 WebSocket 실시간 이벤트 수신
    const disconnectWs = connectWebSocket((event) => {
      if (!event || !event.type) return;

      if (event.type === 'picker_selected' && event.data) {
        setSelectedObject(event.data);
        setObjectName(event.data.name || `UI_${event.data.x}_${event.data.y}`);
      } else if (event.type === 'picker_reset') {
        setSelectedObject(null);
        setObjectName('');
      }
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      disconnectWs();
    };
  }, []);

  const handleConfirm = () => {
    if (!selectedObject) return;
    const finalData: UIObjectData = {
      ...selectedObject,
      name: objectName.trim() || selectedObject.name,
      confidence: selectedObject.confidence ?? 0.8,
    };
    if (window.electronAPI?.confirmObjectPicker) {
      window.electronAPI.confirmObjectPicker(finalData);
    }
  };

  const handleCancel = () => {
    if (window.electronAPI?.cancelObjectPicker) {
      window.electronAPI.cancelObjectPicker();
    }
  };

  const handleReselect = () => {
    setSelectedObject(null);
    setObjectName('');
    if (window.electronAPI?.reselectObjectPicker) {
      window.electronAPI.reselectObjectPicker();
    }
  };

  return (
    <div className="w-screen h-screen bg-slate-900 text-slate-200 flex flex-col select-none overflow-hidden border border-slate-700/80 rounded-xl shadow-2xl">
      {/* 드래그 가능한 타이틀 헤더 */}
      <div
        className="shrink-0 px-4 py-2.5 bg-slate-800/90 border-b border-slate-700/70 flex items-center justify-between"
        style={{ WebkitAppRegion: 'drag' } as any}
      >
        <div className="flex items-center gap-2">
          <Crosshair className="w-4 h-4 text-blue-400" />
          <h1 className="text-xs font-bold text-slate-100 tracking-wide">{t('picker.panelTitle')}</h1>
        </div>
        <button
          onClick={handleCancel}
          style={{ WebkitAppRegion: 'no-drag' } as any}
          className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-700/60 transition-colors"
          title={t('modal.close')}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 본문 콘텐츠 (flex-1 min-h-0 overflow-y-auto로 스크롤 가능) */}
      <div className="flex-1 min-h-0 p-3.5 overflow-y-auto space-y-3 text-xs">
        {/* 상태 배지 */}
        {!selectedObject ? (
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-[11px]">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              {t('picker.waitingSelection')}
            </div>
            <p className="text-[11px] text-amber-200/80 leading-relaxed">
              Hover over UI elements to highlight them in yellow. Click to select.
            </p>
          </div>
        ) : (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-[11px]">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              {t('picker.selectedBadge')}
            </div>
            <p className="text-[11px] text-red-200/80 leading-relaxed">
              Windows UIA object detected. Review the cropped template below and click [{t('common.confirm')}].
            </p>
          </div>
        )}

        {/* 선택 완료 시 세부 정보 */}
        {selectedObject && (
          <div className="space-y-3 pt-1">
            {/* 크롭된 이미지 카드 */}
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1.5">
                {t('picker.cropPreviewTitle')}
              </label>
              <div className="relative rounded-xl bg-slate-950 border border-slate-800 p-2.5 flex items-center justify-center min-h-[90px] max-h-[140px] overflow-hidden">
                {selectedObject.base64_image || selectedObject.image_url ? (
                  <img
                    src={selectedObject.base64_image || resolveImageUrl(selectedObject.image_url)}
                    alt="UIA Object"
                    className="max-h-[110px] max-w-full object-contain rounded border border-slate-700/60 shadow"
                  />
                ) : (
                  <div className="text-[11px] text-slate-500">{t('common.loading')}</div>
                )}
                <div className="absolute bottom-1.5 right-2 text-[10px] text-slate-400 bg-slate-900/90 px-1.5 py-0.5 rounded font-mono border border-slate-800">
                  {selectedObject.width} × {selectedObject.height} px
                </div>
              </div>
            </div>

            {/* 오브젝트 이름 입력 */}
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                {t('picker.elementNameLabel')}
              </label>
              <input
                type="text"
                value={objectName}
                onChange={(e) => setObjectName(e.target.value)}
                placeholder="e.g. Login Button, OK Button"
                className="w-full px-3 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* UIA 컨트롤 타입 및 메타 정보 */}
            <div className="bg-slate-950/70 p-2.5 rounded-xl border border-slate-800 text-[11px] space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 flex items-center gap-1">
                  <Layers className="w-3 h-3 text-blue-400" /> {t('picker.controlTypeLabel')}:
                </span>
                <span className="text-blue-300 font-mono font-medium">
                  {selectedObject.control_type || 'CustomControl'}
                </span>
              </div>
              {selectedObject.window_title && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">{t('picker.targetWindowLabel')}:</span>
                  <span className="text-slate-200 font-medium truncate max-w-[190px]" title={selectedObject.window_title}>
                    {selectedObject.window_title}
                  </span>
                </div>
              )}
              {selectedObject.automation_id && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">{t('picker.automationIdLabel')}:</span>
                  <span className="text-purple-300 font-mono truncate max-w-[190px]">
                    {selectedObject.automation_id}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-slate-400 flex items-center gap-1">
                  <Tag className="w-3 h-3 text-emerald-400" /> {t('picker.coordsLabel')}:
                </span>
                <span className="text-slate-200 font-mono">
                  ({selectedObject.x}, {selectedObject.y})
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Size:</span>
                <span className="text-slate-200 font-mono">
                  {selectedObject.width} × {selectedObject.height} px
                </span>
              </div>
              {selectedObject.executable_path && (
                <div className="flex items-start justify-between gap-1 pt-1 border-t border-slate-800/80">
                  <span className="text-amber-400 font-medium shrink-0">Executable:</span>
                  <span className="text-amber-200 font-mono text-[10px] break-all text-right max-w-[240px]" title={selectedObject.executable_path}>
                    {selectedObject.executable_path}
                  </span>
                </div>
              )}
            </div>

            {/* 하이브리드 안내 배지 */}
            <div className="p-2 rounded-lg bg-blue-950/40 border border-blue-800/40 text-[10px] text-blue-300/90 flex items-center gap-1.5">
              <span>✨</span>
              <span>UIA metadata & cropped image saved for <strong>hybrid execution</strong>.</span>
            </div>
          </div>
        )}
      </div>

      {/* 하단 액션 버튼 바 (항상 고정 노출) */}
      <div className="shrink-0 p-3 bg-slate-800/90 border-t border-slate-700/70 flex items-center justify-between gap-2 z-10">
        {selectedObject ? (
          <>
            <button
              onClick={handleReselect}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-700/80 text-slate-200 hover:bg-slate-700 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-300" />
              {t('picker.reselect')}
            </button>
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleCancel}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-700/60 transition-colors"
              >
                {t('picker.cancel')}
              </button>
              <button
                onClick={handleConfirm}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-md shadow-blue-500/20 transition-all"
              >
                <Check className="w-3.5 h-3.5" />
                {t('picker.confirm')}
              </button>
            </div>
          </>
        ) : (
          <div className="w-full flex justify-end">
            <button
              onClick={handleCancel}
              className="px-4 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:bg-slate-700/80 transition-colors"
            >
              {t('picker.cancel')} (ESC)
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
