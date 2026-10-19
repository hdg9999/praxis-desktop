import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNodesState, useEdgesState, Node, Edge } from '@xyflow/react';
import { Navbar } from './components/Navbar';
import { SkillPanel } from './components/FlowBuilder/SkillPanel';
import { FlowCanvas } from './components/FlowBuilder/FlowCanvas';
import { PropertyInspector } from './components/FlowBuilder/PropertyInspector';
import { FlowSettingsModal } from './components/FlowBuilder/FlowSettingsModal';
import { VariableManagerPanel } from './components/FlowBuilder/VariableManagerPanel';
import { SessionSidebar } from './components/AgentRunner/SessionSidebar';
import { ChatTimeline } from './components/AgentRunner/ChatTimeline';
import { ScreenshotModal } from './components/AgentRunner/ScreenshotModal';
import { SettingsModal } from './components/SettingsModal';
import { StatusBar } from './components/StatusBar';
import { ObjectPickerOverlay } from './components/ObjectPicker/ObjectPickerOverlay';
import {
  Flow,
  ExecutionSession,
  ExecutionMessage,
  NodeType,
  UIObjectData,
  FlowNodeData,
  WorkflowSettings,
  WorkflowVariable,
} from './types';
import { useFlowHistory } from './hooks/useFlowHistory';
import { validateFlow } from './utils/flowValidator';
import { extractVariablesFromLegacyNodes } from './utils/variableUtils';
import { useI18n } from './i18n';
import {
  fetchFlows,
  createFlow,
  updateFlow,
  deleteFlow,
  runFlow,
  stopSession,
  fetchSessions,
  fetchSessionMessages,
  deleteSession,
  fetchOllamaInfo,
  connectWebSocket,
} from './services/api';

const DEFAULT_FLOW_NAME = '샘플 AI 자동화 Flow';
const DEFAULT_FLOW_DESC = '업무 시작 전 AI 브리핑을 생성하고 클립보드에 자동 복사하는 샘플 워크플로우입니다.';

const DEFAULT_FLOW_SETTINGS: WorkflowSettings = {
  execution_delay: 0.3,
  default_llm_model: '',
  default_num_ctx: 8192,
};

const INITIAL_VARIABLES: WorkflowVariable[] = [
  {
    name: 'ai_brief',
    type: 'string',
    defaultValue: '',
    description: '작업 브리핑 AI 요약 결과',
  },
];

const INITIAL_NODES: Node[] = [
  {
    id: 'node_start',
    type: 'flow_start',
    position: { x: 50, y: 150 },
    deletable: false,
    data: {
      label: '시작',
      type: 'flow_start',
      config: {},
    },
  },
  {
    id: 'node_1',
    type: 'general_delay',
    position: { x: 260, y: 150 },
    data: {
      label: '준비 대기 (1초)',
      type: 'general_delay',
      config: { seconds: 1.0 },
    },
  },
  {
    id: 'node_2',
    type: 'ai_ollama',
    position: { x: 520, y: 130 },
    data: {
      label: '작업 브리핑 AI',
      type: 'ai_ollama',
      config: {
        model: 'llama3',
        prompt: 'PC 작업을 시작합니다. 오늘의 업무 자동화 준비 상태를 1줄로 요약해줘.',
        temperature: 0.7,
        output_variable: 'ai_brief',
      },
    },
  },
  {
    id: 'node_3',
    type: 'general_clipboard_copy',
    position: { x: 810, y: 150 },
    data: {
      label: 'AI 결과 클립보드 복사',
      type: 'general_clipboard_copy',
      config: { text: '{{ai_brief}}' },
    },
  },
  {
    id: 'node_end',
    type: 'flow_end',
    position: { x: 1070, y: 150 },
    deletable: false,
    data: {
      label: '끝',
      type: 'flow_end',
      config: {},
    },
  },
];

const INITIAL_EDGES: Edge[] = [
  {
    id: 'e_start-1',
    source: 'node_start',
    target: 'node_1',
    animated: true,
    style: { stroke: '#10b981', strokeWidth: 2 },
  },
  {
    id: 'e1-2',
    source: 'node_1',
    target: 'node_2',
    animated: true,
    style: { stroke: '#3b82f6', strokeWidth: 2 },
  },
  {
    id: 'e2-3',
    source: 'node_2',
    target: 'node_3',
    animated: true,
    style: { stroke: '#8b5cf6', strokeWidth: 2 },
  },
  {
    id: 'e3-end',
    source: 'node_3',
    target: 'node_end',
    animated: true,
    style: { stroke: '#f43f5e', strokeWidth: 2 },
  },
];

export function App() {
  const { t } = useI18n();
  const [currentTab, setCurrentTab] = useState<'builder' | 'runner'>('builder');

  // 백엔드 & Ollama 상태
  const [backendConnected, setBackendConnected] = useState(false);
  const [ollamaConnected, setOllamaConnected] = useState(false);

  // Flow Builder 상태
  const [flows, setFlows] = useState<Flow[]>([]);
  const [activeFlow, setActiveFlow] = useState<Flow | null>(null);
  const [isLoadingFlows, setIsLoadingFlows] = useState(true);
  const [nodes, setNodes, onNodesChange] = useNodesState(INITIAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(INITIAL_EDGES);
  const [flowSettings, setFlowSettings] = useState<WorkflowSettings>(DEFAULT_FLOW_SETTINGS);
  const [variables, setVariables] = useState<WorkflowVariable[]>(INITIAL_VARIABLES);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const isExecutingRef = React.useRef(false);
  const isSavingRef = React.useRef(false);
  const minimizedByRunRef = React.useRef(false);

  useEffect(() => {
    isExecutingRef.current = isExecuting;
  }, [isExecuting]);

  useEffect(() => {
    isSavingRef.current = isSaving;
  }, [isSaving]);

  // Flow 실행으로 인해 최소화된 메인 윈도우 원상 복귀 (성공, 실패, F12 비상정지 포함)
  const restoreWindowIfMinimized = useCallback(async () => {
    if (minimizedByRunRef.current) {
      minimizedByRunRef.current = false;
      if (window.electronAPI?.restoreMainWindow) {
        try {
          await window.electronAPI.restoreMainWindow();
        } catch (e) {
          console.warn('[Window] 메인 윈도우 복원 실패:', e);
        }
      }
    }
  }, []);

  // 변수 클릭 삽입 트리거 (하단 패널 -> 우측 Inspector)
  const [externalInsertTrigger, setExternalInsertTrigger] = useState<{
    varName: string;
    timestamp: number;
  } | null>(null);

  // 실시간 워크플로우 유효성 검사 (시작-끝 도달성, 무한루프, 고립 노드, 변수 선언/타입 검증 포함)
  const validation = useMemo(
    () => validateFlow(nodes, edges, t, variables),
    [nodes, edges, t, variables]
  );

  // 실행 취소(Undo) / 다시 실행(Redo) 히스토리 훅
  const { takeSnapshot, undo, redo, canUndo, canRedo, clearHistory } = useFlowHistory();

  // Agent Runner 상태
  const [sessions, setSessions] = useState<ExecutionSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ExecutionMessage[]>([]);
  const [streamingToken, setStreamingToken] = useState<string | null>(null);
  const [streamingNodeId, setStreamingNodeId] = useState<string | null>(null);

  // 모달 상태
  const [modalImage, setModalImage] = useState<{ url: string; title?: string } | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFlowSettingsOpen, setIsFlowSettingsOpen] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickingNodeId, setPickingNodeId] = useState<string | null>(null);
  const pickingTargetFieldRef = React.useRef<string>('object_data');

  // 오브젝트 선택기 오픈/확인/취소 핸들러
  const handleOpenObjectPicker = (nodeId: string, targetField?: string | any) => {
    setPickingNodeId(nodeId);
    pickingTargetFieldRef.current = typeof targetField === 'string' ? targetField : 'object_data';
    if (window.electronAPI?.startObjectPicker) {
      window.electronAPI.startObjectPicker(nodeId);
      return;
    }
    // 웹 브라우저 모드 폴백
    setIsPickerOpen(true);
  };

  const applyObjectDataToNode = useCallback((nodeId: string, objectData: UIObjectData) => {
    setNodes((prevNodes) =>
      prevNodes.map((n) => {
        if (n.id === nodeId) {
          const nodeData = n.data as unknown as FlowNodeData;
          const currentCfg = nodeData.config || {};
          let updatedCfg: Record<string, any>;

          if (nodeData.type === 'general_launch_program') {
            const detectedPath = objectData.executable_path || objectData.name || '';
            updatedCfg = {
              ...currentCfg,
              program_path: detectedPath,
              object_data: objectData,
            };
          } else if (nodeData.type === 'general_close_program' || nodeData.type === 'general_kill_process') {
            let detectedProcess = '';
            if (objectData.executable_path) {
              const parts = objectData.executable_path.split(/[\\/]/);
              detectedProcess = parts[parts.length - 1] || '';
            }
            if (!detectedProcess && objectData.name) {
              detectedProcess = objectData.name.includes('.') ? objectData.name : `${objectData.name}.exe`;
            }
            updatedCfg = {
              ...currentCfg,
              process_name: detectedProcess,
              object_data: objectData,
            };
          } else if (nodeData.type === 'general_mouse_drag') {
            const targetField = pickingTargetFieldRef.current === 'end_object_data' ? 'end_object_data' : 'start_object_data';
            const modeKey = targetField === 'end_object_data' ? 'end_mode' : 'start_mode';
            const confKey = targetField === 'end_object_data' ? 'end_confidence' : 'start_confidence';
            updatedCfg = {
              ...currentCfg,
              [modeKey]: 'object',
              [targetField]: objectData,
              [confKey]: objectData.confidence ?? 0.8,
            };
          } else if (
            nodeData.type === 'general_mouse_scroll' ||
            nodeData.type === 'general_window_close' ||
            nodeData.type === 'general_window_activate' ||
            nodeData.type === 'general_window_maximize' ||
            nodeData.type === 'general_window_minimize'
          ) {
            updatedCfg = {
              ...currentCfg,
              target_mode: 'object',
              object_data: objectData,
            };
          } else {
            updatedCfg = {
              ...currentCfg,
              click_mode: 'object',
              object_data: objectData,
              confidence: objectData.confidence ?? 0.8,
            };
          }

          const updated = {
            ...n,
            data: {
              ...n.data,
              config: updatedCfg,
            },
          };
          setSelectedNode(updated);
          return updated;
        }
        return n;
      })
    );
  }, [setNodes]);

  const handleConfirmObjectPicker = (objectData: UIObjectData) => {
    if (pickingNodeId) {
      applyObjectDataToNode(pickingNodeId, objectData);
    }
    setIsPickerOpen(false);
    setPickingNodeId(null);
  };

  const handleCancelObjectPicker = () => {
    setIsPickerOpen(false);
    setPickingNodeId(null);
  };

  // Electron 독립 피커 창 결과 수신 리스너
  useEffect(() => {
    if (window.electronAPI?.onPickerResult) {
      window.electronAPI.onPickerResult((objectData: UIObjectData) => {
        const targetId = pickingNodeId || selectedNode?.id;
        if (targetId) {
          applyObjectDataToNode(targetId, objectData);
        }
      });
    }
  }, [pickingNodeId, selectedNode, applyObjectDataToNode]);

  // 초기 Flow 및 Ollama 정보 안전 재시도 로드 (콜드 스타트 백엔드 대기)
  useEffect(() => {
    let isCancelled = false;
    let attempts = 0;
    const maxAttempts = 10;
    const intervalMs = 1000;

    const retryLoadInitialData = async () => {
      while (!isCancelled && attempts < maxAttempts) {
        attempts++;
        try {
          const list = await fetchFlows();
          if (isCancelled) return;
          setFlows(list);
          if (list.length > 0) {
            selectFlow(list[0]);
          }
          setIsLoadingFlows(false);
          setBackendConnected(true);

          loadSessions().catch(console.error);
          fetchOllamaInfo()
            .then((res) => {
              setOllamaConnected(true);
              if (res.models.length > 0) setOllamaModels(res.models);
            })
            .catch((e) => {
              setOllamaConnected(false);
              console.error(e);
            });

          console.log(`[Praxis Desktop] 백엔드 초기 데이터 동기화 완료 (${attempts}회차 시도 성공)`);
          return;
        } catch (err) {
          console.log(`[Praxis Desktop] 백엔드 기동 대기 중... (${attempts}/${maxAttempts}회 재시도 중)`);
          if (attempts >= maxAttempts) {
            console.error('[Praxis Desktop] 백엔드 연결 최대 재시도 횟수 초과:', err);
            setIsLoadingFlows(false);
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
      }
    };

    retryLoadInitialData();

    return () => {
      isCancelled = true;
    };
  }, []);

  // WebSocket 실시간 이벤트 리스너 및 자동 재연결
  useEffect(() => {
    const cleanupWs = connectWebSocket(
      (event) => {
        // 1) 세션 완료 이벤트 (성공, 실패, F12 비상정지 취소 모두 포함)
        if (event.event_type === 'SESSION_FINISHED') {
          setIsExecuting(false);
          loadSessions();
          setStreamingToken(null);
          setStreamingNodeId(null);
          restoreWindowIfMinimized();
          return;
        }

        // 2) 스트리밍 청크 이벤트 (토큰 누적 Append)
        if (event.event_type === 'STREAM_CHUNK') {
          if (event.session_id === activeSessionId) {
            setStreamingToken((prev) => (prev ? prev + event.content : event.content));
            setStreamingNodeId(event.node_id);
          }
          return;
        }

        // 3) 일반/AI/에이전트 노드 실행 및 실시간 중간 상태 이벤트
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
          if (event.session_id === activeSessionId) {
            setStreamingToken(null);
            setStreamingNodeId(null);
            const newMsg: ExecutionMessage = {
              id: event.message_id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
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
        setBackendConnected(connected);
        if (connected) {
          // 소켓 연결/재연결 시 워크플로우 목록이 비어있다면 자동 갱신
          fetchFlows()
            .then((list) => {
              setFlows(list);
              if (list.length > 0) {
                setActiveFlow((prev) => {
                  if (!prev || prev.id.startsWith('temp_')) {
                    selectFlow(list[0]);
                    return list[0];
                  }
                  return prev;
                });
              }
              setIsLoadingFlows(false);
            })
            .catch(() => {});
          loadSessions().catch(() => {});
        }
      }
    );

    return cleanupWs;
  }, [activeSessionId, restoreWindowIfMinimized]);

  // 실행 중(isExecuting) 상태일 때 세션 종료 여부 감시 폴링 (웹소켓 단절 대비 안전망)
  useEffect(() => {
    if (!isExecuting || !activeSessionId) return;

    const interval = setInterval(async () => {
      try {
        const latestSessions = await fetchSessions();
        const curSession = latestSessions.find((s) => s.id === activeSessionId);
        if (curSession && curSession.status !== 'RUNNING') {
          setIsExecuting(false);
          setSessions(latestSessions);
          await restoreWindowIfMinimized();
        }
      } catch (err) {
        console.warn('[Session Polling] 세션 상태 확인 실패:', err);
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [isExecuting, activeSessionId, restoreWindowIfMinimized]);

  // 활성 세션 변경 시 메시지 목록 로드
  useEffect(() => {
    if (activeSessionId) {
      fetchSessionMessages(activeSessionId).then(setMessages).catch(console.error);
    } else {
      setMessages([]);
    }
  }, [activeSessionId]);

  const loadFlows = async () => {
    try {
      const list = await fetchFlows();
      setFlows(list);
      if (list.length > 0 && (!activeFlow || activeFlow.id.startsWith('temp_'))) {
        selectFlow(list[0]);
      }
      setIsLoadingFlows(false);
      return list;
    } catch (e) {
      console.warn('[Flows] 목록 조회 지연 또는 실패:', e);
      throw e;
    }
  };

  const loadSessions = async () => {
    try {
      const list = await fetchSessions();
      setSessions(list);
      if (list.length > 0 && !activeSessionId) {
        setActiveSessionId(list[0].id);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // 기존 Flow 로드 시 '시작'/'끝' 노드 부재 시 자동 마이그레이션
  const ensureStartAndEndNodes = (rawNodes: Node[], rawEdges: Edge[]): { nodes: Node[]; edges: Edge[] } => {
    let currentNodes = [...rawNodes];
    let currentEdges = [...rawEdges];

    if (currentNodes.length === 0) {
      return { nodes: INITIAL_NODES, edges: INITIAL_EDGES };
    }

    const hasStart = currentNodes.some((n) => n.type === 'flow_start');
    const hasEnd = currentNodes.some((n) => n.type === 'flow_end');

    if (!hasStart) {
      const minX = Math.min(...currentNodes.map((n) => n.position.x));
      const avgY = currentNodes[0].position.y;

      const startNode: Node = {
        id: `node_start_${Date.now()}`,
        type: 'flow_start',
        position: { x: Math.max(20, minX - 220), y: avgY },
        deletable: false,
        data: {
          label: '시작',
          type: 'flow_start',
          config: {},
        },
      };

      const targetsWithIncoming = new Set(currentEdges.map((e) => e.target));
      const firstNode = currentNodes.find((n) => !targetsWithIncoming.has(n.id));

      currentNodes = [startNode, ...currentNodes];

      if (firstNode) {
        currentEdges.push({
          id: `e_${startNode.id}-${firstNode.id}`,
          source: startNode.id,
          target: firstNode.id,
          animated: true,
          style: { stroke: '#10b981', strokeWidth: 2 },
        });
      }
    }

    if (!hasEnd) {
      const maxX = Math.max(...currentNodes.map((n) => n.position.x));
      const lastY = currentNodes[currentNodes.length - 1].position.y;

      const endNode: Node = {
        id: `node_end_${Date.now()}`,
        type: 'flow_end',
        position: { x: maxX + 280, y: lastY },
        deletable: false,
        data: {
          label: '끝',
          type: 'flow_end',
          config: {},
        },
      };

      const sourcesWithOutgoing = new Set(currentEdges.map((e) => e.source));
      const lastNode = currentNodes.find(
        (n) => n.type !== 'flow_start' && !sourcesWithOutgoing.has(n.id)
      );

      currentNodes.push(endNode);

      if (lastNode) {
        currentEdges.push({
          id: `e_${lastNode.id}-${endNode.id}`,
          source: lastNode.id,
          target: endNode.id,
          animated: true,
          style: { stroke: '#f43f5e', strokeWidth: 2 },
        });
      }
    }

    currentNodes = currentNodes.map((n) => ({
      ...n,
      deletable: n.type !== 'flow_start' && n.type !== 'flow_end',
    }));

    return { nodes: currentNodes, edges: currentEdges };
  };

  const selectFlow = (flow: Flow) => {
    setActiveFlow(flow);
    const rawNodes = flow.graph_data?.nodes || [];
    const rawEdges = flow.graph_data?.edges || [];
    const migrated = ensureStartAndEndNodes(rawNodes, rawEdges);

    // 전역 설정 동기화 (기본값: 실행 딜레이 0.3초)
    const loadedSettings: WorkflowSettings = {
      execution_delay:
        typeof flow.graph_data?.settings?.execution_delay === 'number'
          ? flow.graph_data.settings.execution_delay
          : 0.3,
      default_llm_model: flow.graph_data?.settings?.default_llm_model || '',
    };
    setFlowSettings(loadedSettings);

    // 워크플로우 변수 동기화 (레거시 저장본일 경우 노드 내 출력/참조 변수를 자동 추출하여 호환성 보장)
    const loadedVars: WorkflowVariable[] = Array.isArray(flow.graph_data?.variables)
      ? flow.graph_data.variables
      : extractVariablesFromLegacyNodes(migrated.nodes);
    setVariables(loadedVars);

    setNodes(migrated.nodes);
    setEdges(migrated.edges);
    setSelectedNode(null);
    clearHistory(migrated.nodes, migrated.edges);
  };

  const handleSelectFlowById = (id: string) => {
    if (activeFlow && activeFlow.id === id) return;
    const target = flows.find((f) => f.id === id);
    if (target) selectFlow(target);
  };

  // Agent Manager의 '실행 기록' 탭에서 'Flow Builder에서 보기' 버튼 클릭 시 연동
  useEffect(() => {
    if (window.electronAPI?.onOpenFromManager) {
      window.electronAPI.onOpenFromManager(async (payload) => {
        try {
          const latestFlows = await fetchFlows();
          setFlows(latestFlows);
          if (payload?.flowId) {
            const target = latestFlows.find((f) => f.id === payload.flowId);
            if (target) {
              selectFlow(target);
            }
          }
          const latestSessions = await fetchSessions();
          setSessions(latestSessions);
          if (payload?.sessionId) {
            setActiveSessionId(payload.sessionId);
          }
          setCurrentTab(payload?.tab || 'builder');
        } catch (err) {
          console.warn('[FlowBuilder] Agent Manager 연동 처리 중 오류:', err);
        }
      });
    }
  }, []);

  const handleNewFlow = () => {
    const defaultModel = flowSettings.default_llm_model || ollamaModels[0] || 'llama3';
    const nextSettings: WorkflowSettings = {
      execution_delay: 0.3,
      default_llm_model: flowSettings.default_llm_model || ollamaModels[0] || '',
    };
    const nextNodes = INITIAL_NODES.map((n) =>
      n.type === 'ai_ollama'
        ? {
            ...n,
            data: {
              ...n.data,
              config: { ...(n.data as any).config, model: defaultModel },
            },
          }
        : n
    );
    const newF: Flow = {
      id: `temp_${Date.now()}`,
      name: `새 워크플로우 ${flows.length + 1}`,
      description: DEFAULT_FLOW_DESC,
      graph_data: {
        nodes: nextNodes,
        edges: INITIAL_EDGES,
        settings: nextSettings,
        variables: INITIAL_VARIABLES,
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setActiveFlow(newF);
    setFlowSettings(nextSettings);
    setVariables(INITIAL_VARIABLES);
    setNodes(nextNodes);
    setEdges(INITIAL_EDGES);
    setSelectedNode(null);
    clearHistory(nextNodes, INITIAL_EDGES);
  };

  const handleUpdateFlowName = (name: string) => {
    if (!activeFlow) return;
    setActiveFlow((prev) => (prev ? { ...prev, name } : null));
  };

  // 워크플로우 전역 설정 적용 핸들러
  const handleApplyFlowSettings = (
    name: string,
    description: string,
    nextSettings: WorkflowSettings,
    applyModelToExistingNodes?: boolean
  ) => {
    setFlowSettings(nextSettings);

    let updatedNodes = nodes;
    if (applyModelToExistingNodes && nextSettings.default_llm_model.trim()) {
      const targetModel = nextSettings.default_llm_model.trim();
      updatedNodes = nodes.map((n) => {
        if (n.type === 'ai_ollama' || n.type === 'agent_basic') {
          const nd = n.data as unknown as FlowNodeData;
          return {
            ...n,
            data: {
              ...nd,
              config: {
                ...(nd.config || {}),
                model: targetModel,
              },
            },
          };
        }
        return n;
      });
      setNodes(updatedNodes);
      if (
        selectedNode &&
        (selectedNode.type === 'ai_ollama' || selectedNode.type === 'agent_basic')
      ) {
        const refreshed = updatedNodes.find((n) => n.id === selectedNode.id) || null;
        setSelectedNode(refreshed);
      }
    }

    setActiveFlow((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        name,
        description,
        graph_data: {
          ...prev.graph_data,
          nodes: updatedNodes,
          edges,
          settings: nextSettings,
          variables,
        },
      };
    });

    // 저장된 목록에서도 즉시 이름/설명/설정이 반영되어 보이도록 동기화
    setFlows((prev) =>
      prev.map((f) =>
        activeFlow && f.id === activeFlow.id
          ? {
              ...f,
              name,
              description,
              graph_data: {
                ...f.graph_data,
                nodes: updatedNodes,
                edges,
                settings: nextSettings,
                variables,
              },
            }
          : f
      )
    );
  };

  // 워크플로우 변수 목록 변경 핸들러
  const handleChangeVariables = (nextVars: WorkflowVariable[]) => {
    setVariables(nextVars);
    setActiveFlow((prev) =>
      prev
        ? {
            ...prev,
            graph_data: {
              ...prev.graph_data,
              nodes,
              edges,
              settings: flowSettings,
              variables: nextVars,
            },
          }
        : null
    );
  };

  // Inspector에서 신규 변수 즉시 선언 시 호출
  const handleDeclareVariable = (newVar: WorkflowVariable) => {
    setVariables((prev) => {
      if (prev.some((v) => v.name === newVar.name)) return prev;
      const updated = [...prev, newVar];
      setActiveFlow((af) =>
        af
          ? {
              ...af,
              graph_data: {
                ...af.graph_data,
                nodes,
                edges,
                settings: flowSettings,
                variables: updated,
              },
            }
          : null
      );
      return updated;
    });
  };

  const handleSaveFlow = async (): Promise<Flow | null> => {
    if (!activeFlow) return null;
    setIsSaving(true);
    try {
      const graphData = {
        nodes,
        edges,
        settings: flowSettings,
        variables,
      };
      const flowName = (activeFlow.name || '').trim() || DEFAULT_FLOW_NAME;
      const flowDesc = (activeFlow.description || '').trim();
      let saved: Flow;
      if (activeFlow.id.startsWith('temp_') || !flows.some((f) => f.id === activeFlow.id)) {
        saved = await createFlow(flowName, graphData, flowDesc);
      } else {
        saved = await updateFlow(activeFlow.id, flowName, graphData, flowDesc);
      }
      setActiveFlow(saved);
      // 신규 워크플로우 저장 시 '워크플로우' 탭에서도 즉시 반영되도록 상태 즉시 갱신 후 서버 목록 재동기화
      setFlows((prev) => {
        const exists = prev.some((f) => f.id === saved.id);
        return exists ? prev.map((f) => (f.id === saved.id ? saved : f)) : [saved, ...prev];
      });
      const latestList = await fetchFlows();
      setFlows(latestList);
      return saved;
    } catch (e) {
      console.error(e);
      return null;
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteFlow = async (flowId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const target = flows.find((f) => f.id === flowId);
    if (!target) return;
    if (!window.confirm(t('workflowTab.deleteConfirm', { name: target.name }))) {
      return;
    }
    try {
      await deleteFlow(flowId);
      const remaining = flows.filter((f) => f.id !== flowId);
      setFlows(remaining);
      if (activeFlow?.id === flowId) {
        if (remaining.length > 0) {
          selectFlow(remaining[0]);
        } else {
          handleNewFlow();
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleRunFlow = async () => {
    if (!activeFlow) return;
    if (isExecutingRef.current) {
      console.warn('[RunFlow] 이미 워크플로우가 실행 중입니다.');
      return;
    }
    if (!validation.isValid) {
      alert(`워크플로우를 실행할 수 없습니다.\n\n확인된 문제점:\n${validation.errors.map((e) => `• ${e}`).join('\n')}`);
      return;
    }

    setIsExecuting(true);

    try {
      // 1. 실행 전 자동 저장 (신규 워크플로우도 저장된 ID로 실행 보장)
      const savedFlow = await handleSaveFlow();
      const targetFlowId = savedFlow?.id || activeFlow.id;

      // 2. Flow 실행 시 메인 윈도우 창 최소화 (데스크톱 대상 창 가림 방지)
      if (window.electronAPI?.minimizeMainWindow) {
        try {
          await window.electronAPI.minimizeMainWindow();
          minimizedByRunRef.current = true;
        } catch (minErr) {
          console.warn('[Window] 메인 윈도우 최소화 실패:', minErr);
        }
      }

      // 3. 백엔드 Flow 실행 요청
      const runRes = await runFlow(targetFlowId);

      // Agent Runner 화면으로 자동 전환 및 새 세션 활성화
      setActiveSessionId(runRes.session_id);
      setCurrentTab('runner');
      await loadSessions();
    } catch (e) {
      console.error('[RunFlow] 실행 실패:', e);
      setIsExecuting(false);
      await restoreWindowIfMinimized();
      alert(`워크플로우 실행 중 오류가 발생했습니다: ${e}`);
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
      await restoreWindowIfMinimized();
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

  const handleAddNodeFromPanel = (type: NodeType, label: string, defaultConfig: Record<string, any>) => {
    takeSnapshot(nodes, edges);
    const finalConfig = { ...defaultConfig };
    if (type === 'agent_basic' || type === 'ai_ollama') {
      const preferredModel =
        flowSettings.default_llm_model?.trim() ||
        (ollamaModels.length > 0 ? ollamaModels[0] : finalConfig.model);
      if (preferredModel) {
        finalConfig.model = preferredModel;
      }
    }
    const newNode: Node = {
      id: `node_${Date.now()}`,
      type,
      position: { x: 300 + (nodes.length * 30), y: 150 + (nodes.length * 20) },
      data: {
        label,
        type,
        config: finalConfig,
      },
    };
    setNodes((nds) => [...nds, newNode]);
    setSelectedNode(newNode);
  };

  const handleUpdateNodeData = (nodeId: string, label: string, config: Record<string, any>) => {
    takeSnapshot(nodes, edges);
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id === nodeId) {
          const updated = {
            ...n,
            data: {
              ...n.data,
              label,
              config,
            },
          };
          if (selectedNode?.id === nodeId) setSelectedNode(updated);
          return updated;
        }
        return n;
      })
    );
  };

  const handleDeleteNode = useCallback((nodeId: string) => {
    const target = nodes.find((n) => n.id === nodeId);
    if (target && (target.type === 'flow_start' || target.type === 'flow_end')) {
      return; // 시작 및 끝 노드는 어떤 방법으로도 삭제 불가
    }
    takeSnapshot(nodes, edges);
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    setSelectedNode((prev) => (prev?.id === nodeId ? null : prev));
  }, [nodes, edges, setNodes, setEdges, takeSnapshot]);

  const handleUndo = useCallback(() => {
    const previous = undo(nodes, edges);
    if (previous) {
      setNodes(previous.nodes);
      setEdges(previous.edges);
      if (selectedNode && !previous.nodes.some((n) => n.id === selectedNode.id)) {
        setSelectedNode(null);
      }
    }
  }, [undo, nodes, edges, setNodes, setEdges, selectedNode]);

  const handleRunFlowRef = React.useRef(handleRunFlow);
  useEffect(() => {
    handleRunFlowRef.current = handleRunFlow;
  }, [handleRunFlow]);

  // 전역 단축키 리스너: F5(Flow 실행), Delete(노드/간선 삭제), Ctrl+Z(실행 취소)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 1) F5 - Flow 실행 (웹/Electron 새로고침 방지 및 포커스 무관 전역 실행)
      if (e.key === 'F5' || e.key === 'f5') {
        e.preventDefault(); // 새로고침 원천 차단
        if (!isExecutingRef.current && !isSavingRef.current) {
          handleRunFlowRef.current();
        }
        return;
      }

      const activeEl = document.activeElement;
      const isInput = activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        (activeEl as HTMLElement).isContentEditable
      );
      if (isInput) return;

      // 2) Ctrl+Z (Cmd+Z) - 실행 취소 (Undo)
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
        if (currentTab === 'builder') {
          e.preventDefault();
          handleUndo();
        }
        return;
      }

      // 3) Delete 키 - 선택된 노드 및 간선 삭제 (사용자 요청에 따라 Backspace 제외)
      if (e.key === 'Delete') {
        if (currentTab === 'builder') {
          const hasSelectedNode = selectedNode || nodes.some((n) => n.selected);
          const hasSelectedEdge = edges.some((e) => e.selected);

          if (hasSelectedNode || hasSelectedEdge) {
            e.preventDefault();
            takeSnapshot(nodes, edges);

            if (selectedNode) {
              if (selectedNode.type !== 'flow_start' && selectedNode.type !== 'flow_end') {
                handleDeleteNode(selectedNode.id);
              }
            } else if (nodes.some((n) => n.selected)) {
              const selectedIds = new Set(
                nodes
                  .filter((n) => n.selected && n.type !== 'flow_start' && n.type !== 'flow_end')
                  .map((n) => n.id)
              );
              if (selectedIds.size > 0) {
                setNodes((nds) => nds.filter((n) => !selectedIds.has(n.id)));
                setEdges((eds) => eds.filter((e) => !selectedIds.has(e.source) && !selectedIds.has(e.target)));
                setSelectedNode(null);
              }
            }

            if (hasSelectedEdge) {
              setEdges((eds) => eds.filter((e) => !e.selected));
            }
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentTab, handleUndo, selectedNode, nodes, edges, handleDeleteNode, takeSnapshot, setNodes, setEdges]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || null;

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* 상단 네비게이션 툴바 */}
      <Navbar
        currentTab={currentTab}
        onChangeTab={setCurrentTab}
        flows={flows}
        activeFlow={activeFlow}
        onSelectFlow={handleSelectFlowById}
        onUpdateFlowName={handleUpdateFlowName}
        onNewFlow={handleNewFlow}
        onSaveFlow={handleSaveFlow}
        onRunFlow={handleRunFlow}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenFlowSettings={() => setIsFlowSettingsOpen(true)}
        isSaving={isSaving}
        isLoadingFlows={isLoadingFlows}
        isExecuting={isExecuting}
        validation={validation}
      />

      {/* 메인 뷰포트 (Builder or Runner) */}
      <main className="flex-1 flex overflow-hidden relative">
        {currentTab === 'builder' ? (
          <div className="flex-1 flex w-full h-full overflow-hidden">
            {/* 좌측 패널 ('스킬' 탭 & '워크플로우' 탭) */}
            <SkillPanel
              onAddNode={handleAddNodeFromPanel}
              flows={flows}
              activeFlow={activeFlow}
              isLoadingFlows={isLoadingFlows}
              onSelectFlow={handleSelectFlowById}
              onNewFlow={handleNewFlow}
              onDeleteFlow={handleDeleteFlow}
              onOpenFlowSettings={() => setIsFlowSettingsOpen(true)}
            />

            {/* 중앙 영역: 상단 워크플로우 캔버스 + 하단 워크플로우 변수 관리 패널 */}
            <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
              <div className="flex-1 min-h-0 relative">
                <FlowCanvas
                  nodes={nodes}
                  edges={edges}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  setNodes={setNodes}
                  setEdges={setEdges}
                  onSelectNode={setSelectedNode}
                  selectedNodeId={selectedNode?.id}
                  onSnapshot={takeSnapshot}
                  orphanNodeIds={validation.orphanNodeIds}
                  defaultLlmModel={
                    flowSettings.default_llm_model?.trim() ||
                    (ollamaModels.length > 0 ? ollamaModels[0] : undefined)
                  }
                />
              </div>

              {/* 메인 윈도우 하단 워크플로우 변수 관리 패널 */}
              <VariableManagerPanel
                variables={variables}
                onChangeVariables={handleChangeVariables}
                nodes={nodes}
                onInsertVariable={(varName) =>
                  setExternalInsertTrigger({ varName, timestamp: Date.now() })
                }
              />
            </div>

            {/* 우측 속성 설정 패널 */}
            {selectedNode && (
              <PropertyInspector
                selectedNode={selectedNode}
                ollamaModels={ollamaModels}
                onUpdateNodeData={handleUpdateNodeData}
                onDeleteNode={handleDeleteNode}
                onClose={() => setSelectedNode(null)}
                onOpenObjectPicker={(targetField?: string) => handleOpenObjectPicker(selectedNode.id, targetField)}
                variables={variables}
                onDeclareVariable={handleDeclareVariable}
                externalInsertTrigger={externalInsertTrigger}
              />
            )}
          </div>
        ) : (
          <div className="flex-1 flex w-full h-full overflow-hidden">
            {/* 좌측 세션 히스토리 목록 */}
            <SessionSidebar
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSelectSession={setActiveSessionId}
              onDeleteSession={handleDeleteSession}
            />

            {/* 우측 채팅방 스타일 실행 타임라인 로그 */}
            <ChatTimeline
              session={activeSession}
              messages={messages}
              streamingToken={streamingToken}
              streamingNodeId={streamingNodeId}
              onStopSession={handleStopSession}
              onSelectImage={(url, title) => setModalImage({ url, title })}
            />
          </div>
        )}
      </main>

      {/* 전문 스튜디오 하단 상태표시줄 (Status Bar) */}
      <StatusBar
        backendConnected={backendConnected}
        ollamaConnected={ollamaConnected}
        activeNodesCount={nodes.length}
        validation={validation}
      />

      {/* 오브젝트 선택기 풀스크린 오버레이 및 소형 창 */}
      <ObjectPickerOverlay
        isOpen={isPickerOpen}
        onConfirm={handleConfirmObjectPicker}
        onCancel={handleCancelObjectPicker}
      />

      {/* 스크린샷 원본 모달 뷰어 */}
      <ScreenshotModal
        imageUrl={modalImage?.url || null}
        title={modalImage?.title}
        onClose={() => setModalImage(null)}
      />

      {/* 환경설정 모달 */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      {/* 워크플로우 전역 설정 모달 */}
      <FlowSettingsModal
        isOpen={isFlowSettingsOpen}
        onClose={() => setIsFlowSettingsOpen(false)}
        flowName={activeFlow?.name || DEFAULT_FLOW_NAME}
        flowDescription={activeFlow?.description || ''}
        settings={flowSettings}
        ollamaModels={ollamaModels}
        onApplySettings={handleApplyFlowSettings}
      />
    </div>
  );
}

export default App;
