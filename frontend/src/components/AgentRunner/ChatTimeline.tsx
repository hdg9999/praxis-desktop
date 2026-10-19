import React, { useEffect, useRef } from 'react';
import { ExecutionSession, ExecutionMessage } from '../../types';
import {
  Square,
  Bot,
  Terminal,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  Image as ImageIcon,
  Maximize2,
  Wrench,
  BrainCircuit,
  Layers,
} from 'lucide-react';
import { resolveImageUrl } from '../../services/api';
import { useI18n } from '../../i18n';

interface ChatTimelineProps {
  session: ExecutionSession | null;
  messages: ExecutionMessage[];
  streamingToken: string | null;
  streamingNodeId: string | null;
  onStopSession: (sessionId: string) => void;
  onSelectImage: (imageUrl: string, title?: string) => void;
}

export const ChatTimeline: React.FC<ChatTimelineProps> = ({
  session,
  messages,
  streamingToken,
  streamingNodeId,
  onStopSession,
  onSelectImage,
}) => {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);

  // 새 메시지 또는 스트리밍 토큰 발생 시 하단 자동 스크롤
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingToken]);

  if (!session) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center h-full bg-slate-950 text-slate-500 text-sm">
        <Terminal className="w-10 h-10 mb-3 text-slate-600 opacity-60" />
        <p className="font-semibold text-slate-400 mb-1">{t('runner.emptyTimelineTitle')}</p>
        <p className="text-xs text-slate-500">{t('runner.emptyTimelineDesc')}</p>
      </div>
    );
  }

  const isRunning = session.status === 'RUNNING';

  const formatTime = (isoStr: string) => {
    try {
      const d = new Date(isoStr);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return '';
    }
  };

  return (
    <div className="flex-1 min-w-0 flex flex-col h-full bg-slate-950 overflow-hidden select-text">
      {/* 채팅방 상단 헤더 */}
      <div className="px-4 sm:px-6 py-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between gap-3 shadow-sm shrink-0">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="p-2 rounded-xl bg-blue-950/60 border border-blue-800/60 text-blue-400 shrink-0">
            <Terminal className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <h1
                className="text-sm font-semibold text-slate-100 truncate"
                title={session.flow_name}
              >
                {session.flow_name}
              </h1>
              <span
                className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono truncate max-w-[130px] sm:max-w-[200px] shrink-0"
                title={`#${session.id}`}
              >
                #{session.id}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5 truncate">
              {new Date(session.started_at).toLocaleString()}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isRunning && (
            <button
              onClick={() => onStopSession(session.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-950 text-red-300 border border-red-800 hover:bg-red-900 hover:text-white transition-colors text-xs font-semibold shadow-sm whitespace-nowrap shrink-0"
              title={`${t('runner.stopSessionButton')} (F12)`}
            >
              <Square className="w-3.5 h-3.5 fill-current shrink-0" />
              <span>{t('runner.stopSessionButton')} (F12)</span>
            </button>
          )}

          <div className="text-[11px] px-2.5 py-1 rounded-full border border-slate-700 bg-slate-800/80 text-slate-300 font-mono whitespace-nowrap shrink-0">
            {t('common.status')}: {session.status}
          </div>
        </div>
      </div>

      {/* 채팅 메시지 타임라인 (말풍선 목록) */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
        {messages.map((msg) => {
          const isAi = msg.node_type === 'AI';
          const isAgent = msg.node_type === 'AGENT';
          const isError = msg.event_type === 'ERROR';
          const isSuccess = msg.event_type === 'SUCCESS';
          const isStart = msg.event_type === 'START';
          const isThinking = msg.event_type === 'AGENT_THINKING';
          const isToolCall = msg.event_type === 'AGENT_TOOL_CALL';
          const isToolResult = msg.event_type === 'AGENT_TOOL_RESULT';
          const isStepStart = msg.event_type === 'AGENT_STEP_START';

          return (
            <div
              key={msg.id}
              className={`flex flex-col max-w-3xl min-w-0 overflow-hidden rounded-2xl border p-4 transition-all shadow-sm ${
                isError
                  ? 'bg-rose-950/20 border-rose-900/60 text-rose-200 ml-1 mr-auto'
                  : isThinking
                  ? 'bg-indigo-950/20 border-indigo-900/40 text-indigo-200 ml-2 sm:ml-4 mr-auto'
                  : isToolCall
                  ? 'bg-sky-950/25 border-sky-800/50 text-sky-200 ml-2 sm:ml-4 mr-auto'
                  : isToolResult
                  ? 'bg-slate-900/90 border-slate-700/60 text-slate-200 ml-3 sm:ml-6 mr-auto'
                  : isStepStart
                  ? 'bg-slate-900/50 border-slate-800/80 text-indigo-300 ml-1 mr-auto py-2'
                  : isAgent
                  ? 'bg-slate-900/95 border-indigo-900/50 text-slate-200 ml-1 mr-auto'
                  : isAi
                  ? 'bg-slate-900/90 border-purple-900/40 text-slate-200 ml-1 mr-auto'
                  : 'bg-slate-900/90 border-slate-800/90 text-slate-200 ml-1 mr-auto'
              }`}
            >
              {/* 메시지 발신자 / 노드 헤더 */}
              <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-slate-800/60 text-xs min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                  <div
                    className={`p-1 rounded-md shrink-0 ${
                      isError
                        ? 'bg-rose-900/40 text-rose-400'
                        : isThinking
                        ? 'bg-indigo-950 text-indigo-400'
                        : isToolCall
                        ? 'bg-sky-950 text-sky-400'
                        : isToolResult
                        ? 'bg-slate-800 text-teal-400'
                        : isStepStart
                        ? 'bg-indigo-950/60 text-indigo-300'
                        : isAgent
                        ? 'bg-indigo-950 text-indigo-400'
                        : isAi
                        ? 'bg-purple-950 text-purple-400'
                        : 'bg-slate-800 text-blue-400'
                    }`}
                  >
                    {isError ? (
                      <AlertCircle className="w-3.5 h-3.5" />
                    ) : isThinking ? (
                      <BrainCircuit className="w-3.5 h-3.5" />
                    ) : isToolCall ? (
                      <Wrench className="w-3.5 h-3.5" />
                    ) : isToolResult ? (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    ) : isStepStart ? (
                      <Layers className="w-3.5 h-3.5" />
                    ) : isAgent ? (
                      <Bot className="w-3.5 h-3.5" />
                    ) : isAi ? (
                      <Bot className="w-3.5 h-3.5" />
                    ) : (
                      <Terminal className="w-3.5 h-3.5" />
                    )}
                  </div>
                  <span className="font-semibold text-slate-200 truncate">{msg.node_name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800/60 text-slate-400 font-mono whitespace-nowrap shrink-0">
                    {msg.node_type}
                  </span>
                  {isSuccess && (
                    <span className="flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-800/40 whitespace-nowrap shrink-0">
                      <CheckCircle2 className="w-3 h-3 shrink-0" /> {t('common.success')}
                    </span>
                  )}
                  {isError && (
                    <span className="flex items-center gap-1 text-[10px] text-rose-400 bg-rose-950/40 px-1.5 py-0.5 rounded border border-rose-800/40 whitespace-nowrap shrink-0">
                      <AlertCircle className="w-3 h-3 shrink-0" /> {t('common.error')}
                    </span>
                  )}
                  {isThinking && (
                    <span className="text-[10px] text-indigo-300 bg-indigo-950/50 px-1.5 py-0.5 rounded border border-indigo-800/50 whitespace-nowrap shrink-0">
                      {t('runner.agentThinking')}
                    </span>
                  )}
                  {isToolCall && (
                    <span className="text-[10px] text-sky-300 bg-sky-950/50 px-1.5 py-0.5 rounded border border-sky-800/50 font-mono whitespace-nowrap shrink-0">
                      {t('runner.agentToolCall')}
                    </span>
                  )}
                  {isToolResult && (
                    <span className="text-[10px] text-teal-300 bg-teal-950/50 px-1.5 py-0.5 rounded border border-teal-800/50 font-mono whitespace-nowrap shrink-0">
                      {t('runner.agentToolResult')}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-slate-500 font-mono whitespace-nowrap shrink-0">
                  {formatTime(msg.created_at)}
                </div>
              </div>

              {/* 본문 메시지 */}
              {isToolCall ? (
                <div className="text-xs font-mono bg-slate-950/80 p-2.5 rounded-lg border border-sky-900/40 text-sky-200 whitespace-pre-wrap break-words">
                  {msg.content}
                </div>
              ) : isToolResult ? (
                <div className="text-xs font-mono bg-slate-950/70 p-2.5 rounded-lg border border-slate-800 max-h-48 overflow-y-auto text-slate-300 whitespace-pre-wrap break-words">
                  {msg.content}
                </div>
              ) : isThinking ? (
                <div className="text-xs leading-relaxed italic text-indigo-300/90 whitespace-pre-wrap break-words">
                  {msg.content}
                </div>
              ) : (
                <div className="text-xs leading-relaxed whitespace-pre-wrap break-words text-slate-200 font-sans">
                  {msg.content}
                </div>
              )}

              {/* 스크린샷 썸네일 (WebP 80% 압축 이미지, 좁은 버블 밖으로 튀어나오지 않도록 max-w-full 보장) */}
              {msg.image_path && (
                <div className="mt-3 pt-2 border-t border-slate-800/60 min-w-0">
                  <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mb-1.5">
                    <ImageIcon className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                    <span className="truncate">{t('settings.captureScreenLabel')}:</span>
                  </div>
                  <div
                    onClick={() => onSelectImage(resolveImageUrl(msg.image_path)!, `${msg.node_name} - ${msg.content}`)}
                    className="group relative inline-block max-w-full rounded-xl overflow-hidden border border-slate-700/80 cursor-pointer bg-slate-950 hover:border-blue-500 transition-all shadow-md"
                  >
                    <img
                      src={resolveImageUrl(msg.image_path)}
                      alt="Capture Thumbnail"
                      className="block max-h-48 w-full max-w-full sm:max-w-sm object-cover group-hover:scale-[1.02] transition-transform duration-200"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 text-white text-xs font-medium backdrop-blur-[2px]">
                      <Maximize2 className="w-4 h-4" />
                      {t('runner.viewFullScreenshot')}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* AI 및 에이전트 노드 토큰 실시간 스트리밍 중 표시 (Append 실시간 렌더링) */}
        {streamingToken && (
          <div className="flex flex-col max-w-3xl rounded-2xl border border-indigo-700/60 bg-indigo-950/25 p-4 text-indigo-100 ml-2 shadow-md">
            <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-indigo-300">
              <Sparkles className="w-4 h-4 animate-spin text-indigo-400" />
              <span>{t('runner.streamingText')}</span>
            </div>
            <div className="text-xs leading-relaxed whitespace-pre-wrap break-words font-sans text-slate-100">
              {streamingToken}
              <span className="inline-block w-1.5 h-3.5 bg-indigo-400 ml-1 translate-y-0.5 animate-pulse" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
