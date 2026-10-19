import React from 'react';
import { ExecutionSession } from '../../types';
import { History, Play, CheckCircle2, XCircle, AlertTriangle, Trash2 } from 'lucide-react';
import { useI18n } from '../../i18n';

interface SessionSidebarProps {
  sessions: ExecutionSession[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  compact?: boolean;
}

export const SessionSidebar: React.FC<SessionSidebarProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onDeleteSession,
  compact = false,
}) => {
  const { t } = useI18n();

  const getStatusBadge = (status: ExecutionSession['status']) => {
    switch (status) {
      case 'RUNNING':
        return (
          <span className="flex items-center gap-1 text-[10px] text-blue-400 font-medium shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping" />
            {t('runner.statusRunning')}
          </span>
        );
      case 'SUCCESS':
        return (
          <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium shrink-0">
            <CheckCircle2 className="w-3 h-3" />
            {t('runner.statusSuccess')}
          </span>
        );
      case 'FAILED':
        return (
          <span className="flex items-center gap-1 text-[10px] text-rose-400 font-medium shrink-0">
            <XCircle className="w-3 h-3" />
            {t('runner.statusFailed')}
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="flex items-center gap-1 text-[10px] text-amber-400 font-medium shrink-0">
            <AlertTriangle className="w-3 h-3" />
            {t('runner.statusCancelled')}
          </span>
        );
      default:
        return null;
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    } catch {
      return dateStr;
    }
  };

  return (
    <aside
      className={`${
        compact ? 'w-48 sm:w-56' : 'w-72'
      } shrink-0 bg-slate-900 border-r border-slate-800 flex flex-col h-full select-none`}
    >
      <div className="p-3.5 border-b border-slate-800 flex items-center gap-2">
        <History className="w-4 h-4 text-slate-400 shrink-0" />
        <h2 className="text-xs font-semibold text-slate-200 truncate">{t('runner.sidebarTitle')}</h2>
        <span className="ml-auto text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full font-mono shrink-0">
          {sessions.length}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {sessions.length === 0 ? (
          <div className="text-center py-12 text-slate-500 text-xs">
            {t('runner.noSessions')}
          </div>
        ) : (
          sessions.map((s) => {
            const isSelected = s.id === activeSessionId;
            return (
              <div
                key={s.id}
                onClick={() => onSelectSession(s.id)}
                className={`group relative flex flex-col p-2.5 rounded-xl border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-blue-950/30 border-blue-500/60 shadow-sm'
                    : 'bg-slate-800/40 border-slate-800 hover:bg-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="text-xs font-semibold text-slate-200 truncate pr-2">
                    {s.flow_name}
                  </div>
                  {getStatusBadge(s.status)}
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span className="font-mono text-[10px] text-slate-500">{formatDate(s.started_at)}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSession(s.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-red-400 transition-opacity"
                    title={t('runner.deleteSessionTooltip')}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};
