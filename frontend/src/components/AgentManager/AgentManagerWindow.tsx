import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Play,
  Workflow,
  History,
  Search,
  X,
  RefreshCw,
  ExternalLink,
  SlidersHorizontal,
  Clock,
  Variable,
  Loader2,
  ShieldAlert,
  Globe,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Bot,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { Flow, ExecutionSession, ExecutionMessage } from '../../types';
import { SessionSidebar } from '../AgentRunner/SessionSidebar';
import { ChatTimeline } from '../AgentRunner/ChatTimeline';
import { ScreenshotModal } from '../AgentRunner/ScreenshotModal';
import {
  fetchFlows,
  runFlow,
  stopSession,
  fetchSessions,
  fetchSessionMessages,
  deleteSession,
  connectWebSocket,
} from '../../services/api';
import { useI18n } from '../../i18n';

interface ManagerRunEntry {
  flowId: string;
  flowName: string;
  notified: boolean;
  lastError: string;
}

// Agent Manager 기본 가로 크기(560px) 이하 및 컴팩트 구간(<= 680px)에서 좌측 세션 사이드바 자동 접힘 임계값
const COMPACT_SIDEBAR_THRESHOLD = 680;

export const AgentManagerWindow: React.FC = () => {
  const { language, setLanguage, t } = useI18n();
  const [activeTab, setActiveTab] = useState<'workflows' | 'history'>('workflows');

  // 창 가로 길이에 따른 실행 세션 사이드바 자동 접힘 상태
  const [isCompactWidth, setIsCompactWidth] = useState<boolean>(
    () => typeof window !== 'undefined' && window.innerWidth <= COMPACT_SIDEBAR_THRESHOLD
  );
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(
    () => typeof window !== 'undefined' && window.innerWidth <= COMPACT_SIDEBAR_THRESHOLD
  );

  useEffect(() => {
    const handleResize = () => {
      const compact = window.innerWidth <= COMPACT_SIDEBAR_THRESHOLD;
      setIsCompactWidth((prevCompact) => {
        if (prevCompact !== compact) {
          // 기본 크기 이하로 줄어들면 자동으로 접고, 넓어지면 자동으로 펼침
          setIsSidebarCollapsed(compact);
        } else if (compact) {
          // 기본 크기 이하 구간 내에서 리사이징 시에도 자동 접힘 보장
          setIsSidebarCollapsed(true);
        }
        return compact;
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 저장된 워크플로우 목록 상태
  const [flows, setFlows] = useState<Flow[]>([]);
  const [isLoadingFlows, setIsLoadingFlows] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // 실행 상태
  const [isExecuting, setIsExecuting] = useState(false);
  const [runningFlowId, setRunningFlowId] = useState<string | null>(null);
  const isExecutingRef = useRef(false);
  const managerSessionsRef = useRef<Map<string, ManagerRunEntry>>(new Map());

  // 실행 기록 (Agent Runner와 동일 구조)
  const [sessions, setSessions] = useState<ExecutionSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ExecutionMessage[]>([]);
  const [streamingToken, setStreamingToken] = useState<string | null>(null);
  const [streamingNodeId, setStreamingNodeId] = useState<string | null>(null);
  const [modalImage, setModalImage] = useState<{ url: string; title?: string } | null>(null);

  // 웹 브라우저 폴백용 인앱 토스트 상태
  const [inAppToast, setInAppToast] = useState<{
    title: string;
    body: string;
    status: string;
  } | null>(null);

  useEffect(() => {
    isExecutingRef.current = isExecuting;
  }, [isExecuting]);

  const loadFlows = useCallback(async () => {
    try {
      const list = await fetchFlows();
      setFlows(list);
      setIsLoadingFlows(false);
      return list;
    } catch (e) {
      console.warn('[AgentManager] 워크플로우 목록 조회 실패:', e);
      setIsLoadingFlows(false);
      return [];
    }
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      const list = await fetchSessions();
      setSessions(list);
      setActiveSessionId((prev) => {
        if (!prev && list.length > 0) {
          return list[0].id;
        }
        return prev;
      });
      return list;
    } catch (e) {
      console.warn('[AgentManager] 실행 기록 조회 실패:', e);
      return [];
    }
  }, []);

  // OS Toast 알림 발송 헬퍼 (오류/실패/성공/중단 여부 상관없이 모두 출력, 창 복구는 하지 않음)
  const triggerToastNotification = useCallback(
    async (
      flowName: string,
      status: string,
      rawError?: string,
      flowId?: string,
      sessionId?: string
    ) => {
      let title = '';
      let body = '';
      const cleanErr = (rawError || '').replace(/^❌\s*/, '').trim();

      if (status === 'SUCCESS') {
        title = t('agentManager.toastSuccessTitle');
        body = t('agentManager.toastSuccessBody', { name: flowName });
      } else if (status === 'CANCELLED') {
        title = t('agentManager.toastCancelledTitle');
        body = t('agentManager.toastCancelledBody', { name: flowName });
      } else {
        title = t('agentManager.toastFailedTitle');
        body = t('agentManager.toastFailedBody', {
          name: flowName,
          error: cleanErr || t('agentManager.toastFailedDefault'),
        });
      }

      if (window.electronAPI?.showWorkflowNotification) {
        try {
          await window.electronAPI.showWorkflowNotification({
            title,
            body,
            status,
            flowId,
            flowName,
            sessionId,
          });
          return;
        } catch (err) {
          console.warn('[AgentManager] Electron Toast 알림 호출 실패:', err);
        }
      }

      // 웹 브라우저 단독 모드 폴백
      setInAppToast({ title, body, status });
      setTimeout(() => setInAppToast(null), 6000);
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body });
      }
    },
    [t]
  );

  // 초기 데이터 로드 및 창 포커스/표시 시 자동 동기화
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      for (let i = 0; i < 8; i++) {
        if (cancelled) return;
        try {
          const list = await fetchFlows();
          if (cancelled) return;
          setFlows(list);
          setIsLoadingFlows(false);
          await loadSessions();
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 800));
        }
      }
      setIsLoadingFlows(false);
    };
    init();

    const handleFocus = () => {
      loadFlows();
      loadSessions();
    };
    window.addEventListener('focus', handleFocus);

    if (window.electronAPI?.onAgentManagerShown) {
      window.electronAPI.onAgentManagerShown((payload) => {
        loadFlows();
        loadSessions();
        if (payload?.tab) {
          setActiveTab(payload.tab);
        }
        if (payload?.sessionId) {
          setActiveSessionId(payload.sessionId);
        }
      });
    }

    return () => {
      cancelled = true;
      window.removeEventListener('focus', handleFocus);
    };
  }, [loadFlows, loadSessions]);

  // WebSocket 실시간 이벤트 수신
  useEffect(() => {
    const cleanupWs = connectWebSocket(
      (event) => {
        if (event.event_type === 'SESSION_FINISHED') {
          setIsExecuting(false);
          setRunningFlowId(null);
          setStreamingToken(null);
          setStreamingNodeId(null);
          loadSessions();

          // Agent Manager에서 실행시킨 세션인 경우 Toast 알림 출력 (창 복구는 하지 않음)
          const entry = managerSessionsRef.current.get(event.session_id);
          if (entry && !entry.notified) {
            entry.notified = true;
            const finalStatus = event.status || 'SUCCESS';
            const errText = event.error || entry.lastError || '';
            triggerToastNotification(
              entry.flowName,
              finalStatus,
              errText,
              entry.flowId,
              event.session_id
            );
          }
          return;
        }

        if (event.event_type === 'STREAM_CHUNK') {
          if (event.session_id === activeSessionId) {
            setStreamingToken((prev) => (prev ? prev + event.content : event.content));
            setStreamingNodeId(event.node_id);
          }
          return;
        }

        const trackableEvents = [
          'START',
          'SUCCESS',
          'ERROR',
          'AGENT_STEP_START',
          'AGENT_THINKING',
          'AGENT_TOOL_CALL',
          'AGENT_TOOL_RESULT',
        ];
        if (trackableEvents.includes(event.event_type)) {
          if (event.event_type === 'ERROR') {
            const entry = managerSessionsRef.current.get(event.session_id);
            if (entry) {
              entry.lastError = event.content || '';
            }
          }

          if (event.session_id === activeSessionId) {
            setStreamingToken(null);
            setStreamingNodeId(null);
            const newMsg: ExecutionMessage = {
              id:
                event.message_id ||
                `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              session_id: event.session_id,
              node_id: event.node_id,
              node_name: event.node_name,
              node_type: event.node_type,
              event_type: event.event_type,
              content: event.content,
              image_path: event.image_path,
              created_at: new Date().toISOString(),
            };
            setMessages((prev) => [...prev, newMsg]);
          }
          loadSessions();
        }
      },
      (connected) => {
        if (connected) {
          loadFlows();
          loadSessions();
        }
      }
    );

    return cleanupWs;
  }, [activeSessionId, loadFlows, loadSessions, triggerToastNotification]);

  // 실행 중 세션 완료 감시 폴링 안전망 (WebSocket 유실 대비)
  useEffect(() => {
    if (!isExecuting) return;

    const interval = setInterval(async () => {
      try {
        const latestSessions = await fetchSessions();
        setSessions(latestSessions);

        for (const [sesId, entry] of managerSessionsRef.current.entries()) {
          if (entry.notified) continue;
          const found = latestSessions.find((s) => s.id === sesId);
          if (found && found.status !== 'RUNNING') {
            entry.notified = true;
            setIsExecuting(false);
            setRunningFlowId(null);
            await triggerToastNotification(
              entry.flowName,
              found.status,
              entry.lastError,
              entry.flowId,
              sesId
            );
          }
        }
      } catch (err) {
        console.warn('[AgentManager Polling] 세션 상태 확인 실패:', err);
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [isExecuting, triggerToastNotification]);

  // 선택된 실행 기록 변경 시 메시지 목록 로드
  useEffect(() => {
    if (activeSessionId) {
      fetchSessionMessages(activeSessionId).then(setMessages).catch(console.error);
    } else {
      setMessages([]);
    }
  }, [activeSessionId]);

  // '저장된 워크플로우' 탭에서 [실행] 버튼 클릭 시
  const handleRunSavedWorkflow = async (flow: Flow) => {
    if (isExecutingRef.current) return;

    setIsExecuting(true);
    setRunningFlowId(flow.id);

    try {
      // 1. Agent Manager 창을 시스템 트레이로 즉시 최소화(숨김)
      if (window.electronAPI?.hideAgentManagerToTray) {
        await window.electronAPI.hideAgentManagerToTray();
      }

      // 2. 워크플로우 실행 요청
      const runRes = await runFlow(flow.id);
      managerSessionsRef.current.set(runRes.session_id, {
        flowId: flow.id,
        flowName: flow.name,
        notified: false,
        lastError: '',
      });

      setActiveSessionId(runRes.session_id);
      await loadSessions();
    } catch (err: any) {
      console.error('[AgentManager] 워크플로우 실행 요청 오류:', err);
      setIsExecuting(false);
      setRunningFlowId(null);
      await triggerToastNotification(
        flow.name,
        'FAILED',
        err?.message || String(err),
        flow.id
      );
    }
  };

  const handleStopSession = async (sessionId: string) => {
    try {
      await stopSession(sessionId);
      await loadSessions();
    } catch (e) {
      console.error(e);
    } finally {
      setIsExecuting(false);
      setRunningFlowId(null);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    try {
      await deleteSession(sessionId);
      if (activeSessionId === sessionId) {
        setActiveSessionId(null);
      }
      await loadSessions();
    } catch (e) {
      console.error(e);
    }
  };

  // '실행 기록' 탭 상단의 'Flow Builder에서 보기' 클릭 시
  const handleOpenInFlowBuilder = async () => {
    const activeSession = sessions.find((s) => s.id === activeSessionId) || null;
    const payload = {
      flowId: activeSession?.flow_id,
      sessionId: activeSession?.id,
      tab: 'builder' as const,
    };

    if (window.electronAPI?.openFlowBuilderWindow) {
      await window.electronAPI.openFlowBuilderWindow(payload);
    } else {
      window.location.href = '/';
    }
  };

  const handleOpenRunnerSettings = async () => {
    if (window.electronAPI?.openRunnerSettingsWindow) {
      await window.electronAPI.openRunnerSettingsWindow();
    }
  };

  // 검색어로 필터링된 워크플로우 목록
  const filteredFlows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return flows;
    return flows.filter(
      (f) =>
        (f.name || '').toLowerCase().includes(q) ||
        (f.description || '').toLowerCase().includes(q)
    );
  }, [flows, searchQuery]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || null;

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    try {
      const d = new Date(dateStr);
      return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(
        d.getDate()
      ).padStart(2, '0')} ${d.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })}`;
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden font-sans select-none">
      {/* 컴팩트 상단 헤더 (1단: 타이틀 & 우측 유틸 버튼 / 2단: 탭 스위처) */}
      <header className="bg-slate-900 border-b border-slate-800 px-4 pt-3 pb-2.5 flex flex-col gap-2.5 shrink-0 shadow-md z-10">
        {/* 1단: 로고/타이틀 + 우측 액션 컨트롤 */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 shrink-0">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <div className="font-bold text-sm tracking-tight bg-gradient-to-r from-indigo-300 via-purple-300 to-blue-400 bg-clip-text text-transparent truncate">
                {t('agentManager.title')}
              </div>
              <div className="text-[10px] text-slate-400 font-mono leading-none mt-0.5 truncate">
                {t('agentManager.subtitle')}
              </div>
            </div>
          </div>

          {/* 우측 컨트롤 영역 (줄바꿈 방지 whitespace-nowrap) */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* 비상 정지 안내 (컴팩트 배지) */}
            <div
              className="flex items-center gap-1 text-[10px] text-rose-400/90 bg-rose-950/30 border border-rose-900/40 px-2 py-1 rounded-full whitespace-nowrap"
              title={`${t('nav.emergencyStop')}: F12`}
            >
              <ShieldAlert className="w-3 h-3 text-rose-400 shrink-0" />
              <span className="hidden sm:inline">{t('nav.emergencyStop')}:</span>
              <kbd className="font-mono font-bold text-rose-300">F12</kbd>
            </div>

            {/* 언어 스위처 */}
            <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[10px] font-semibold shrink-0">
              <div className="flex items-center pl-1.5 pr-0.5 text-slate-400">
                <Globe className="w-3 h-3 text-blue-400" />
              </div>
              <button
                type="button"
                onClick={() => setLanguage('ko')}
                className={`px-1.5 py-0.5 rounded transition-all ${
                  language === 'ko'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                KO
              </button>
              <button
                type="button"
                onClick={() => setLanguage('en')}
                className={`px-1.5 py-0.5 rounded transition-all ${
                  language === 'en'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                EN
              </button>
            </div>

            {/* 새로고침 버튼 */}
            <button
              type="button"
              onClick={() => {
                loadFlows();
                loadSessions();
              }}
              className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors border border-slate-800"
              title={t('common.refresh')}
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>

            {/* Runner 환경 설정 버튼 */}
            <button
              type="button"
              onClick={handleOpenRunnerSettings}
              className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors border border-slate-800"
              title={t('agentManager.runnerSettingsBtn')}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 2단: 2개 핵심 탭 ('저장된 워크플로우' | '실행 기록') */}
        <div className="grid grid-cols-2 gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            type="button"
            onClick={() => setActiveTab('workflows')}
            className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
              activeTab === 'workflows'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Workflow className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{t('agentManager.tabWorkflows')}</span>
            <span
              className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full shrink-0 ${
                activeTab === 'workflows'
                  ? 'bg-indigo-800 text-indigo-100'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {flows.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
              activeTab === 'history'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <History className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{t('agentManager.tabHistory')}</span>
            <span
              className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full shrink-0 ${
                activeTab === 'history'
                  ? 'bg-purple-800 text-purple-100'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {sessions.length}
            </span>
          </button>
        </div>
      </header>

      {/* 웹 브라우저 폴백 인앱 토스트 배너 */}
      {inAppToast && (
        <div className="fixed bottom-5 right-5 z-50 max-w-sm bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-4 flex items-start gap-3 animate-in fade-in slide-in-from-bottom-4">
          {inAppToast.status === 'SUCCESS' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          ) : inAppToast.status === 'CANCELLED' ? (
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold text-slate-100">{inAppToast.title}</div>
            <div className="text-[11px] text-slate-300 mt-1 break-words leading-relaxed">
              {inAppToast.body}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setInAppToast(null)}
            className="text-slate-500 hover:text-slate-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 메인 콘텐츠 영역 */}
      <main className="flex-1 flex overflow-hidden relative">
        {activeTab === 'workflows' ? (
          /* 1) '저장된 워크플로우' 탭 (1열 컴팩트 리스트) */
          <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-950">
            {/* 상단 검색 및 필터 바 */}
            <div className="px-4 py-3 bg-slate-900/60 border-b border-slate-800/80 flex items-center justify-between gap-3 shrink-0">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('agentManager.searchPlaceholder')}
                  className="w-full bg-slate-950 border border-slate-700/80 rounded-xl pl-8 pr-7 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-all"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-0.5 rounded-full hover:bg-slate-800"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="text-[11px] text-slate-400 font-mono whitespace-nowrap shrink-0">
                {t('agentManager.tabWorkflows')}:{' '}
                <strong className="text-slate-200">{filteredFlows.length}</strong>
              </div>
            </div>

            {/* 워크플로우 1열 카드 리스트 */}
            <div className="flex-1 overflow-y-auto p-4">
              {isLoadingFlows ? (
                <div className="flex flex-col items-center justify-center h-64 text-slate-400 text-xs gap-2">
                  <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
                  <span>{t('nav.loadingFlows')}</span>
                </div>
              ) : filteredFlows.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-slate-500 text-xs text-center max-w-sm mx-auto">
                  <Workflow className="w-10 h-10 mb-3 text-slate-700" />
                  <p className="text-slate-300 font-semibold text-sm mb-1">
                    {t('workflowTab.emptyList')}
                  </p>
                  <p className="text-slate-500 leading-relaxed">
                    {t('agentManager.noSavedWorkflows')}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {filteredFlows.map((flow) => {
                    const rawNodes = flow.graph_data?.nodes || [];
                    const actionNodeCount = rawNodes.filter(
                      (n: any) => n.type !== 'flow_start' && n.type !== 'flow_end'
                    ).length;
                    const varCount = (flow.graph_data?.variables || []).length;
                    const delaySec = flow.graph_data?.settings?.execution_delay ?? 0.3;
                    const descText =
                      flow.description?.trim() || t('workflowTab.noDescription');
                    const isThisRunning = isExecuting && runningFlowId === flow.id;

                    return (
                      <div
                        key={flow.id}
                        className="group flex flex-col justify-between p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-indigo-500/50 hover:bg-slate-900 transition-all shadow-sm hover:shadow-md"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-start gap-2.5 min-w-0 flex-1">
                            <div className="mt-0.5 p-2 rounded-lg bg-indigo-950/70 border border-indigo-800/60 text-indigo-400 shrink-0">
                              <Workflow className="w-4 h-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <h3 className="text-xs font-bold text-slate-100 group-hover:text-white truncate">
                                {flow.name}
                              </h3>
                              <p
                                className={`text-[11px] line-clamp-1 mt-0.5 leading-snug ${
                                  flow.description?.trim()
                                    ? 'text-slate-300'
                                    : 'text-slate-500 italic'
                                }`}
                                title={descText}
                              >
                                {descText}
                              </p>
                            </div>
                          </div>

                          {/* 각각의 워크플로우 실행 버튼 */}
                          <button
                            type="button"
                            disabled={isExecuting}
                            onClick={() => handleRunSavedWorkflow(flow)}
                            className={`shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold shadow-md transition-all whitespace-nowrap ${
                              isThisRunning
                                ? 'bg-indigo-900/80 text-indigo-200 border border-indigo-700 cursor-wait'
                                : isExecuting
                                ? 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                                : 'bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white shadow-indigo-500/20 active:scale-95'
                            }`}
                          >
                            {isThisRunning ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                <span>{t('agentManager.runningBtn')}</span>
                              </>
                            ) : (
                              <>
                                <Play className="w-3.5 h-3.5 fill-current" />
                                <span>{t('agentManager.runWorkflowBtn')}</span>
                              </>
                            )}
                          </button>
                        </div>

                        {/* 하단 메타 정보 배지 */}
                        <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-slate-800/70 text-[10px] text-slate-400 gap-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-300 font-mono">
                              {t('agentManager.nodeCount', { count: actionNodeCount })}
                            </span>
                            <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-emerald-300 font-mono">
                              <Variable className="w-2.5 h-2.5" />
                              {t('agentManager.varCount', { count: varCount })}
                            </span>
                            <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-amber-300 font-mono">
                              <Clock className="w-2.5 h-2.5" />
                              {t('agentManager.delayBadge', { sec: delaySec })}
                            </span>
                          </div>

                          <span className="text-[10px] text-slate-500 font-mono whitespace-nowrap shrink-0">
                            {t('agentManager.updatedAt', {
                              date: formatDate(flow.updated_at || flow.created_at),
                            })}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* 2) '실행 기록' 탭 (기존 Agent Runner와 동일한 템플릿 + 상단 'Flow Builder에서 보기' 버튼 + 컴팩트 시 사이드바 자동 접힘) */
          <div className="flex-1 flex flex-col w-full h-full overflow-hidden">
            {/* '실행 기록' 탭 전용 상단 바 (사이드바 접기/펼치기 토글 + 'Flow Builder에서 보기' 버튼 배치) */}
            <div className="px-4 py-2 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 text-xs text-slate-300 min-w-0">
                <button
                  type="button"
                  onClick={() => setIsSidebarCollapsed((prev) => !prev)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold transition-all shrink-0 ${
                    !isSidebarCollapsed
                      ? 'bg-purple-950/60 border-purple-700/60 text-purple-300 hover:bg-purple-900/60'
                      : 'bg-slate-800/90 border-slate-700 text-slate-200 hover:bg-slate-700'
                  }`}
                  title={t('runner.sidebarTitle')}
                >
                  {isSidebarCollapsed ? (
                    <PanelLeftOpen className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                  ) : (
                    <PanelLeftClose className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                  )}
                  <span className="whitespace-nowrap">{t('runner.sidebarTitle')}</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-slate-900/80 text-slate-300">
                    {sessions.length}
                  </span>
                </button>

                {activeSession && (
                  <span className="text-slate-400 font-mono text-[11px] truncate">
                    {activeSession.flow_name}
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={handleOpenInFlowBuilder}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-semibold transition-all shadow-sm whitespace-nowrap shrink-0 active:scale-95"
                title={t('agentManager.openInFlowBuilderTooltip')}
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>{t('agentManager.openInFlowBuilder')}</span>
              </button>
            </div>

            {/* Agent Runner 동일 템플릿: 좌측 SessionSidebar (기본 크기 이하 시 자동 접힘 & 오버레이 드로어 지원) + 우측 ChatTimeline */}
            <div className="flex-1 flex w-full min-h-0 overflow-hidden relative">
              {!isSidebarCollapsed && (
                isCompactWidth ? (
                  <>
                    {/* 컴팩트 창에서 세션 목록을 열었을 때 우측 가시성을 해치지 않는 슬라이드 오버레이 드로어 */}
                    <div
                      className="absolute inset-0 bg-black/50 backdrop-blur-[1px] z-20"
                      onClick={() => setIsSidebarCollapsed(true)}
                    />
                    <div className="absolute left-0 top-0 bottom-0 z-30 flex h-full shadow-2xl">
                      <SessionSidebar
                        sessions={sessions}
                        activeSessionId={activeSessionId}
                        onSelectSession={(id) => {
                          setActiveSessionId(id);
                          setIsSidebarCollapsed(true);
                        }}
                        onDeleteSession={handleDeleteSession}
                        compact
                      />
                    </div>
                  </>
                ) : (
                  <SessionSidebar
                    sessions={sessions}
                    activeSessionId={activeSessionId}
                    onSelectSession={setActiveSessionId}
                    onDeleteSession={handleDeleteSession}
                    compact
                  />
                )
              )}

              <ChatTimeline
                session={activeSession}
                messages={messages}
                streamingToken={streamingToken}
                streamingNodeId={streamingNodeId}
                onStopSession={handleStopSession}
                onSelectImage={(url, title) => setModalImage({ url, title })}
              />
            </div>
          </div>
        )}
      </main>

      {/* 스크린샷 원본 모달 뷰어 */}
      <ScreenshotModal
        imageUrl={modalImage?.url || null}
        title={modalImage?.title}
        onClose={() => setModalImage(null)}
      />
    </div>
  );
};
