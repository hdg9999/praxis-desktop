import React, { useCallback, useMemo, useRef } from 'react';
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
import GroupNode from './GroupNode';
import SubflowNode from './SubflowNode';
import DeletableEdge from './DeletableEdge';
import { checkConnectionValidity } from '../../utils/flowValidator';
import { NodeType } from '../../types';

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
  const dragStartPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  const nodeTypes = useMemo(() => ({
    flow_start: StartNode,
    flow_end: EndNode,
    flow_group: GroupNode,
    flow_call: SubflowNode,
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

  // 그룹 접기/펼치기 토글 핸들러
  const handleToggleGroupCollapse = useCallback((groupId: string) => {
    setNodes((prevNodes) => {
      if (onSnapshot) onSnapshot(prevNodes, edges);
      return prevNodes.map((n) => {
        if (n.id === groupId && n.type === 'flow_group') {
          const currCfg = (n.data as any)?.config || {};
          return {
            ...n,
            data: {
              ...n.data,
              config: {
                ...currCfg,
                collapsed: !currCfg.collapsed,
              },
            },
          };
        }
        return n;
      });
    });
  }, [edges, setNodes, onSnapshot]);

  // 그룹 이름 인라인 수정 핸들러
  const handleRenameGroup = useCallback((groupId: string, newLabel: string) => {
    setNodes((prevNodes) =>
      prevNodes.map((n) => {
        if (n.id === groupId) {
          return {
            ...n,
            data: {
              ...n.data,
              label: newLabel,
            },
          };
        }
        return n;
      })
    );
  }, [setNodes]);

  // 그룹 영역 크기(width, height) 조절 핸들러
  const handleResizeGroup = useCallback((groupId: string, width: number, height: number) => {
    setNodes((prevNodes) =>
      prevNodes.map((n) => {
        if (n.id === groupId && n.type === 'flow_group') {
          const currCfg = (n.data as any)?.config || {};
          return {
            ...n,
            data: {
              ...n.data,
              config: {
                ...currCfg,
                width,
                height,
              },
            },
          };
        }
        return n;
      })
    );
  }, [setNodes]);

  // 그룹 노드 헤더의 [+ 노드 추가] 버튼으로 하위 스킬 노드를 그룹 내부에 생성 및 자동 그룹 편입
  const handleAddChildSkillToGroup = useCallback((
    groupId: string,
    skillType: NodeType,
    label: string,
    defaultConfig: Record<string, any>
  ) => {
    setNodes((prevNodes) => {
      const groupNode = prevNodes.find((n) => n.id === groupId && n.type === 'flow_group');
      if (!groupNode) return prevNodes;

      if (onSnapshot) onSnapshot(prevNodes, edges);

      const childrenInGroup = prevNodes.filter(
        (n) => (n.data as any)?.config?.group_id === groupId && n.type !== 'flow_group'
      );

      const groupX = groupNode.position.x;
      const groupY = groupNode.position.y;
      const currCfg = (groupNode.data as any)?.config || {};
      const currWidth = Math.max(320, Number(currCfg.width) || 560);
      const currHeight = Math.max(180, Number(currCfg.height) || 260);

      // 그룹 내 기존 자식 노드들 우측에 순차 배치
      let nextX = groupX + 30;
      let nextY = groupY + 75;
      if (childrenInGroup.length > 0) {
        const maxRightX = Math.max(...childrenInGroup.map((c) => c.position.x));
        nextX = maxRightX + 230;
        nextY = childrenInGroup[childrenInGroup.length - 1].position.y;
      }

      const finalConfig: Record<string, any> = {
        ...defaultConfig,
        group_id: groupId,
      };
      if ((skillType === 'ai_ollama' || skillType === 'agent_basic') && defaultLlmModel) {
        finalConfig.model = defaultLlmModel;
      }

      const newNode: Node = {
        id: `node_${Date.now()}`,
        type: skillType,
        position: { x: nextX, y: nextY },
        deletable: true,
        data: {
          label,
          type: skillType,
          config: finalConfig,
        },
      };

      // 새로 추가된 노드가 그룹 가로 폭을 넘어설 경우 그룹 박스를 자동으로 넓혀줌
      const neededWidth = Math.max(currWidth, (nextX - groupX) + 250);
      const updatedNodes = prevNodes.map((n) => {
        if (n.id === groupId) {
          return {
            ...n,
            data: {
              ...n.data,
              config: {
                ...currCfg,
                collapsed: false,
                width: neededWidth,
                height: currHeight,
              },
            },
          };
        }
        return n;
      });

      setTimeout(() => onSelectNode(newNode), 0);
      return [...updatedNodes, newNode];
    });
  }, [edges, setNodes, onSelectNode, onSnapshot, defaultLlmModel]);

  // 접힌 그룹(collapsed) 파악 및 렌더링용 노드 가공
  const collapsedGroupIds = useMemo(() => {
    const set = new Set<string>();
    for (const n of nodes) {
      if (n.type === 'flow_group' && (n.data as any)?.config?.collapsed) {
        set.add(n.id);
      }
    }
    return set;
  }, [nodes]);

  // 자식 노드 ID -> 소속된(접힌) 그룹 ID 매핑
  const hiddenChildToGroupMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of nodes) {
      if (n.type === 'flow_group' || n.type === 'flow_start' || n.type === 'flow_end') continue;
      const gId = (n.data as any)?.config?.group_id;
      if (gId && collapsedGroupIds.has(gId)) {
        map.set(n.id, gId);
      }
    }
    return map;
  }, [nodes, collapsedGroupIds]);

  const renderedNodes = useMemo(() => {
    // 그룹별 자식 노드 요약 계산
    const childrenByGroup = new Map<string, { id: string; label: string; type: string; x: number }[]>();
    for (const n of nodes) {
      if (n.type === 'flow_group') continue;
      const gId = (n.data as any)?.config?.group_id;
      if (gId) {
        if (!childrenByGroup.has(gId)) childrenByGroup.set(gId, []);
        childrenByGroup.get(gId)!.push({
          id: n.id,
          label: String((n.data as any)?.label || n.id),
          type: String(n.type || ''),
          x: n.position?.x || 0,
        });
      }
    }
    for (const list of childrenByGroup.values()) {
      list.sort((a, b) => a.x - b.x);
    }

    // 그룹 노드가 일반 노드보다 항상 뒤(아래 레이어)에 렌더링되도록 정렬
    const sorted = [...nodes].sort((a, b) => {
      if (a.type === 'flow_group' && b.type !== 'flow_group') return -1;
      if (a.type !== 'flow_group' && b.type === 'flow_group') return 1;
      return 0;
    });

    return sorted.map((node) => {
      if (node.type === 'flow_group') {
        const isCollapsed = !!(node.data as any)?.config?.collapsed;
        return {
          ...node,
          zIndex: isCollapsed ? 10 : -1,
          data: {
            ...node.data,
            childNodes: childrenByGroup.get(node.id) || [],
            onToggleCollapse: handleToggleGroupCollapse,
            onAddChildSkill: handleAddChildSkillToGroup,
            onRenameGroup: handleRenameGroup,
            onResizeGroup: handleResizeGroup,
          },
        };
      }

      const parentGroupId = (node.data as any)?.config?.group_id;
      const isHiddenByCollapsedGroup = !!(parentGroupId && collapsedGroupIds.has(parentGroupId));

      const isOrphan =
        orphanNodeIds.includes(node.id) &&
        node.type !== 'flow_start' &&
        node.type !== 'flow_end';

      return {
        ...node,
        hidden: isHiddenByCollapsedGroup,
        zIndex: 10,
        className: isOrphan
          ? `${node.className || ''} opacity-60 hover:opacity-100 transition-opacity`
          : node.className,
      };
    });
  }, [
    nodes,
    orphanNodeIds,
    collapsedGroupIds,
    handleToggleGroupCollapse,
    handleAddChildSkillToGroup,
    handleRenameGroup,
    handleResizeGroup,
  ]);

  // 그룹이 접혀 있을 때 외부 노드 <-> 접힌 그룹 내부 노드 간선을 그룹 노드로 임시 브릿징하여 끊김 없이 시각화
  const renderedEdges = useMemo(() => {
    if (hiddenChildToGroupMap.size === 0) return edges;

    const result: Edge[] = [];
    const bridgeKeys = new Set<string>();

    for (const edge of edges) {
      const srcGroup = hiddenChildToGroupMap.get(edge.source);
      const tgtGroup = hiddenChildToGroupMap.get(edge.target);

      // 같은 접힌 그룹 내부의 노드끼리 연결된 간선은 숨김
      if (srcGroup && tgtGroup && srcGroup === tgtGroup) {
        continue;
      }

      // 접힌 그룹 바깥 <-> 안쪽(또는 다른 접힌 그룹) 연결 간선은 접힌 그룹 노드로 리다이렉트 표시
      if (srcGroup || tgtGroup) {
        const bridgedSource = srcGroup || edge.source;
        const bridgedTarget = tgtGroup || edge.target;
        const key = `${bridgedSource}->${bridgedTarget}`;
        if (bridgeKeys.has(key)) continue;
        bridgeKeys.add(key);

        result.push({
          ...edge,
          id: `bridge_${edge.id}`,
          source: bridgedSource,
          target: bridgedTarget,
          animated: true,
          deletable: false,
          style: { stroke: '#14b8a6', strokeWidth: 2, strokeDasharray: '5 3' },
          data: { ...(edge.data || {}), isGroupBridge: true },
        });
        continue;
      }

      result.push(edge);
    }

    return result;
  }, [edges, hiddenChildToGroupMap]);

  const edgeTypes = useMemo(() => ({
    default: DeletableEdge,
    deletable: DeletableEdge,
  }), []);

  const isValidConnection = useCallback((connection: Connection | Edge) => {
    const srcNode = nodes.find((n) => n.id === connection.source);
    const tgtNode = nodes.find((n) => n.id === connection.target);
    if (srcNode?.type === 'flow_group' || tgtNode?.type === 'flow_group') {
      return false;
    }
    return checkConnectionValidity(connection, edges);
  }, [nodes, edges]);

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
    // 1) flow_start와 flow_end 노드의 remove 액션은 무조건 필터링하여 삭제 원천 차단
    const filteredChanges = changes.filter((change) => {
      if (change.type === 'remove') {
        const target = nodes.find((n) => n.id === change.id);
        if (target && (target.type === 'flow_start' || target.type === 'flow_end')) {
          return false;
        }
      }
      return true;
    });

    // 2) 그룹 노드가 드래그 이동 중일 때 소속된 하위 노드들도 동일한 델타(dx, dy)만큼 동반 이동
    const groupPosChanges = filteredChanges.filter(
      (c): c is NodeChange & { id: string; type: 'position'; position: { x: number; y: number } } =>
        c.type === 'position' && !!(c as any).position
    );

    if (groupPosChanges.length > 0) {
      const extraChildChanges: NodeChange[] = [];
      const directlyChangedIds = new Set(groupPosChanges.map((c) => c.id));

      for (const gChange of groupPosChanges) {
        const gNode = nodes.find((n) => n.id === gChange.id);
        if (gNode && gNode.type === 'flow_group') {
          const dx = gChange.position.x - gNode.position.x;
          const dy = gChange.position.y - gNode.position.y;
          if (dx !== 0 || dy !== 0) {
            for (const child of nodes) {
              if (
                child.id !== gNode.id &&
                !directlyChangedIds.has(child.id) &&
                (child.data as any)?.config?.group_id === gNode.id
              ) {
                extraChildChanges.push({
                  id: child.id,
                  type: 'position',
                  position: {
                    x: child.position.x + dx,
                    y: child.position.y + dy,
                  },
                });
              }
            }
          }
        }
      }

      if (extraChildChanges.length > 0) {
        onNodesChange([...filteredChanges, ...extraChildChanges]);
        return;
      }
    }

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

      // 드롭된 위치가 펼쳐진 그룹 노드 영역 내부인지 확인하여 자동 그룹 편입
      if (type !== 'flow_group' && type !== 'flow_start' && type !== 'flow_end') {
        const hitGroup = nodes.find((g) => {
          if (g.type !== 'flow_group') return false;
          const gCfg = (g.data as any)?.config || {};
          if (gCfg.collapsed) return false;
          const gw = Math.max(320, Number(gCfg.width) || 560);
          const gh = Math.max(180, Number(gCfg.height) || 260);
          return (
            position.x >= g.position.x &&
            position.x <= g.position.x + gw &&
            position.y >= g.position.y &&
            position.y <= g.position.y + gh
          );
        });
        if (hitGroup) {
          finalConfig.group_id = hitGroup.id;
        }
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

  const onNodeDragStart = useCallback((_: any, node: Node) => {
    dragStartPositionsRef.current.set(node.id, { ...node.position });
  }, []);

  // 노드 드래그 완료 시:
  // 1) 일반 스킬 노드를 펼쳐진 그룹 영역 안으로 드래그하면 해당 그룹에 자동 편입(group_id 설정)
  // 2) 그룹 밖으로 완전히 끌어내면 그룹 소속 해제(group_id 제거)
  const onNodeDragStop = useCallback((_: any, draggedNode: Node) => {
    if (onSnapshot) {
      onSnapshot(nodes, edges);
    }

    if (
      draggedNode.type === 'flow_group' ||
      draggedNode.type === 'flow_start' ||
      draggedNode.type === 'flow_end'
    ) {
      return;
    }

    const nodeCenterX = draggedNode.position.x + 95;
    const nodeCenterY = draggedNode.position.y + 35;

    const targetGroup = nodes.find((g) => {
      if (g.type !== 'flow_group') return false;
      const gCfg = (g.data as any)?.config || {};
      if (gCfg.collapsed) return false;
      const gw = Math.max(320, Number(gCfg.width) || 560);
      const gh = Math.max(180, Number(gCfg.height) || 260);
      return (
        nodeCenterX >= g.position.x &&
        nodeCenterX <= g.position.x + gw &&
        nodeCenterY >= g.position.y &&
        nodeCenterY <= g.position.y + gh
      );
    });

    const currentGroupId = (draggedNode.data as any)?.config?.group_id || undefined;
    const nextGroupId = targetGroup ? targetGroup.id : undefined;

    if (currentGroupId !== nextGroupId) {
      setNodes((prevNodes) =>
        prevNodes.map((n) => {
          if (n.id === draggedNode.id) {
            const nextCfg = { ...((n.data as any)?.config || {}) };
            if (nextGroupId) {
              nextCfg.group_id = nextGroupId;
            } else {
              delete nextCfg.group_id;
            }
            const updated = {
              ...n,
              data: {
                ...n.data,
                config: nextCfg,
              },
            };
            if (selectedNodeId === n.id) {
              onSelectNode(updated);
            }
            return updated;
          }
          return n;
        })
      );
    }
  }, [nodes, edges, setNodes, selectedNodeId, onSelectNode, onSnapshot]);

  const onDelete = useCallback((params: { nodes: Node[]; edges: Edge[] }) => {
    if (onSnapshot) {
      onSnapshot(nodes, edges);
    }
    const deletedGroupIds = new Set(
      params.nodes.filter((n) => n.type === 'flow_group').map((n) => n.id)
    );
    if (deletedGroupIds.size > 0) {
      // 그룹 노드가 삭제되더라도 내부 스킬 노드는 삭제하지 않고 그룹 소속만 해제하여 안전하게 보존
      setNodes((prev) =>
        prev.map((n) => {
          const gId = (n.data as any)?.config?.group_id;
          if (gId && deletedGroupIds.has(gId)) {
            const nextCfg = { ...((n.data as any)?.config || {}) };
            delete nextCfg.group_id;
            return {
              ...n,
              hidden: false,
              data: {
                ...n.data,
                config: nextCfg,
              },
            };
          }
          return n;
        })
      );
    }
    if (selectedNodeId && params.nodes.some((n) => n.id === selectedNodeId)) {
      onSelectNode(null);
    }
  }, [nodes, edges, setNodes, selectedNodeId, onSelectNode, onSnapshot]);

  return (
    <div
      className="flex-1 h-full w-full bg-slate-950 relative outline-none"
      onDrop={onDrop}
      onDragOver={onDragOver}
      tabIndex={0}
    >
      <ReactFlow
        nodes={renderedNodes}
        edges={renderedEdges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onNodeDragStart={onNodeDragStart}
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
