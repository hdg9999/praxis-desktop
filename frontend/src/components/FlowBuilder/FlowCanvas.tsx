import React, { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  addEdge,
  Connection,
  Edge,
  Node,
  NodeChange,
  EdgeChange,
  ConnectionMode,
  MarkerType,
} from '@xyflow/react';
import GeneralNode from './GeneralNode';
import AINode from './AINode';
import AgentNode from './AgentNode';
import StartNode from './StartNode';
import EndNode from './EndNode';
import DeletableEdge from './DeletableEdge';
import { checkConnectionValidity } from '../../utils/flowValidator';

interface FlowCanvasProps {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  onSelectNode: (node: Node | null) => void;
  selectedNodeId?: string | null;
  onSnapshot?: (nodes: Node[], edges: Edge[]) => void;
  orphanNodeIds?: string[];
  defaultLlmModel?: string;
}

export const FlowCanvas: React.FC<FlowCanvasProps> = ({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  setNodes,
  setEdges,
  onSelectNode,
  selectedNodeId,
  onSnapshot,
  orphanNodeIds = [],
  defaultLlmModel,
}) => {
  const nodeTypes = useMemo(() => ({
    flow_start: StartNode,
    flow_end: EndNode,
    general_mouse_click: GeneralNode,
    general_mouse_move: GeneralNode,
    general_mouse_drag: GeneralNode,
    general_mouse_scroll: GeneralNode,
    general_keyboard_type: GeneralNode,
    general_keyboard_hotkey: GeneralNode,
    general_delay: GeneralNode,
    general_clipboard_copy: GeneralNode,
    general_clipboard_read: GeneralNode,
    general_file_read: GeneralNode,
    general_file_write: GeneralNode,
    general_message_box: GeneralNode,
    general_window_activate: GeneralNode,
    general_window_maximize: GeneralNode,
    general_window_minimize: GeneralNode,
    general_window_close: GeneralNode,
    general_screenshot: GeneralNode,
    general_launch_program: GeneralNode,
    general_close_program: GeneralNode,
    general_kill_process: GeneralNode,
    ai_ollama: AINode,
    agent_basic: AgentNode,
  }), []);

  const renderedNodes = useMemo(() => {
    return nodes.map((node) => {
      const isOrphan =
        orphanNodeIds.includes(node.id) &&
        node.type !== 'flow_start' &&
        node.type !== 'flow_end';
      if (isOrphan) {
        return {
          ...node,
          className: `${node.className || ''} opacity-60 hover:opacity-100 transition-opacity`,
        };
      }
      return node;
    });
  }, [nodes, orphanNodeIds]);

  const edgeTypes = useMemo(() => ({
    default: DeletableEdge,
    deletable: DeletableEdge,
  }), []);

  const isValidConnection = useCallback((connection: Connection | Edge) => {
    return checkConnectionValidity(connection, edges);
  }, [edges]);

  const onConnect = useCallback((params: Connection) => {
    if (onSnapshot) {
      onSnapshot(nodes, edges);
    }
    setEdges((eds) => addEdge({
      ...params,
      type: 'deletable',
      animated: true,
      style: { stroke: '#3b82f6', strokeWidth: 2 },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: '#3b82f6',
      },
    }, eds));
  }, [nodes, edges, setEdges, onSnapshot]);

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    // flow_start와 flow_end 노드의 remove 액션은 무조건 필터링하여 삭제 원천 차단
    const filteredChanges = changes.filter((change) => {
      if (change.type === 'remove') {
        const target = nodes.find((n) => n.id === change.id);
        if (target && (target.type === 'flow_start' || target.type === 'flow_end')) {
          return false;
        }
      }
      return true;
    });
    onNodesChange(filteredChanges);
  }, [nodes, onNodesChange]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const dataStr = event.dataTransfer.getData('application/reactflow');
    if (!dataStr) return;

    try {
      const { type, label, defaultConfig } = JSON.parse(dataStr);
      // 시작/끝 노드는 중복 생성 방지
      if (type === 'flow_start' && nodes.some((n) => n.type === 'flow_start')) return;
      if (type === 'flow_end' && nodes.some((n) => n.type === 'flow_end')) return;

      const reactFlowBounds = event.currentTarget.getBoundingClientRect();
      const position = {
        x: event.clientX - reactFlowBounds.left - 100,
        y: event.clientY - reactFlowBounds.top - 30,
      };

      const finalConfig = { ...defaultConfig };
      if ((type === 'ai_ollama' || type === 'agent_basic') && defaultLlmModel) {
        finalConfig.model = defaultLlmModel;
      }

      const newNode: Node = {
        id: `node_${Date.now()}`,
        type,
        position,
        deletable: type !== 'flow_start' && type !== 'flow_end',
        data: {
          label,
          type,
          config: finalConfig,
        },
      };

      if (onSnapshot) {
        onSnapshot(nodes, edges);
      }
      setNodes((nds) => nds.concat(newNode));
      onSelectNode(newNode);
    } catch (err) {
      console.error('Drop parsing error', err);
    }
  }, [nodes, edges, setNodes, onSelectNode, onSnapshot, defaultLlmModel]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    onSelectNode(node);
  }, [onSelectNode]);

  const onPaneClick = useCallback(() => {
    onSelectNode(null);
  }, [onSelectNode]);

  const onNodeDragStop = useCallback(() => {
    if (onSnapshot) {
      onSnapshot(nodes, edges);
    }
  }, [nodes, edges, onSnapshot]);

  const onDelete = useCallback((params: { nodes: Node[]; edges: Edge[] }) => {
    if (onSnapshot) {
      onSnapshot(nodes, edges);
    }
    if (selectedNodeId && params.nodes.some((n) => n.id === selectedNodeId)) {
      onSelectNode(null);
    }
  }, [nodes, edges, selectedNodeId, onSelectNode, onSnapshot]);

  return (
    <div
      className="flex-1 h-full w-full bg-slate-950 relative outline-none"
      onDrop={onDrop}
      onDragOver={onDragOver}
      tabIndex={0}
    >
      <ReactFlow
        nodes={renderedNodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onNodeDragStop={onNodeDragStop}
        onDelete={onDelete}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={ConnectionMode.Strict}
        connectionRadius={25}
        deleteKeyCode="Delete"
        fitView
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#334155" />
        <Controls className="flow-builder-controls" />
      </ReactFlow>
    </div>
  );
};
