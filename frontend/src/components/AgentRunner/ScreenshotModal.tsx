import React from 'react';
import { X, ExternalLink } from 'lucide-react';
import { useI18n } from '../../i18n';

interface ScreenshotModalProps {
  imageUrl: string | null;
  title?: string;
  onClose: () => void;
}

export const ScreenshotModal: React.FC<ScreenshotModalProps> = ({ imageUrl, title, onClose }) => {
  const { t } = useI18n();
  if (!imageUrl) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative max-w-5xl max-h-[90vh] bg-slate-900 border border-slate-700 rounded-xl overflow-hidden shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 bg-slate-800/80 border-b border-slate-700">
          <div className="text-xs font-medium text-slate-200 truncate">
            {title || t('modal.screenshotViewer')}
          </div>
          <div className="flex items-center gap-2">
            <a
              href={imageUrl}
              target="_blank"
              rel="noreferrer"
              className="p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-700 transition-colors"
              title="Open in new tab"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
            <button
              onClick={onClose}
              className="p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-700 transition-colors"
              title={t('modal.close')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-2 bg-slate-950 flex items-center justify-center">
          <img
            src={imageUrl}
            alt="PC Screenshot"
            className="max-h-[80vh] w-auto object-contain rounded border border-slate-800"
          />
        </div>
      </div>
    </div>
  );
};
