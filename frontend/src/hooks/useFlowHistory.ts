import { useState, useCallback, useRef } from 'react';
import { Node, Edge } from '@xyflow/react';

export interface FlowSnapshot {
  nodes: Node[];
  edges: Edge[];
}

export function useFlowHistory(maxHistory = 50) {
  const [past, setPast] = useState<FlowSnapshot[]>([]);
  const [future, setFuture] = useState<FlowSnapshot[]>([]);

  // 중복 스냅샷 저장 방지를 위한 직렬화 캐시
  const lastSnapshotRef = useRef<string>('');

  const takeSnapshot = useCallback((nodes: Node[], edges: Edge[]) => {
    try {
      const serialized = JSON.stringify({ nodes, edges });
      if (serialized === lastSnapshotRef.current) {
        return;
      }
      lastSnapshotRef.current = serialized;

      const snapshot: FlowSnapshot = {
        nodes: JSON.parse(JSON.stringify(nodes)),
        edges: JSON.parse(JSON.stringify(edges)),
      };

      setPast((prev) => {
        const next = [...prev, snapshot];
        if (next.length > maxHistory) {
          return next.slice(next.length - maxHistory);
        }
        return next;
      });
      setFuture([]);
    } catch (e) {
      console.error('takeSnapshot serialization error', e);
    }
  }, [maxHistory]);

  const undo = useCallback((currentNodes: Node[], currentEdges: Edge[]): FlowSnapshot | null => {
    if (past.length === 0) return null;

    const previous = past[past.length - 1];
    const newPast = past.slice(0, past.length - 1);

    const currentSnapshot: FlowSnapshot = {
      nodes: JSON.parse(JSON.stringify(currentNodes)),
      edges: JSON.parse(JSON.stringify(currentEdges)),
    };

    setPast(newPast);
    setFuture((prev) => [currentSnapshot, ...prev]);
    lastSnapshotRef.current = JSON.stringify(previous);

    return previous;
  }, [past]);

  const redo = useCallback((currentNodes: Node[], currentEdges: Edge[]): FlowSnapshot | null => {
    if (future.length === 0) return null;

    const next = future[0];
    const newFuture = future.slice(1);

    const currentSnapshot: FlowSnapshot = {
      nodes: JSON.parse(JSON.stringify(currentNodes)),
      edges: JSON.parse(JSON.stringify(currentEdges)),
    };

    setPast((prev) => [...prev, currentSnapshot]);
    setFuture(newFuture);
    lastSnapshotRef.current = JSON.stringify(next);

    return next;
  }, [future]);

  const clearHistory = useCallback((initialNodes?: Node[], initialEdges?: Edge[]) => {
    setPast([]);
    setFuture([]);
    if (initialNodes && initialEdges) {
      try {
        lastSnapshotRef.current = JSON.stringify({ nodes: initialNodes, edges: initialEdges });
      } catch {
        lastSnapshotRef.current = '';
      }
    } else {
      lastSnapshotRef.current = '';
    }
  }, []);

  return {
    takeSnapshot,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    clearHistory,
  };
}
