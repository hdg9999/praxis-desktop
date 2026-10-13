import { Node, Edge, Connection } from '@xyflow/react';

export interface FlowValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  activeNodeIds: string[];
  orphanNodeIds: string[];
  hasCycle: boolean;
  cycleNodeIds: string[];
  startNodeId?: string;
  endNodeId?: string;
}

/**
 * 주어진 간선 목록을 기준으로 targetId에서 sourceId로 도달 가능한 경로가 있는지 확인
 * (경로가 있다면 sourceId -> targetId 연결 시 사이클이 생성됨)
 */
export function wouldCreateCycle(
  sourceId: string,
  targetId: string,
  edges: Edge[]
): boolean {
  if (sourceId === targetId) return true;

  const adj = new Map<string, string[]>();
  for (const edge of edges) {
    if (!adj.has(edge.source)) adj.set(edge.source, []);
    adj.get(edge.source)!.push(edge.target);
  }

  // BFS로 targetId에서 시작하여 sourceId에 도달 가능한지 탐색
  const visited = new Set<string>();
  const queue = [targetId];

  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (curr === sourceId) return true;
    if (visited.has(curr)) continue;
    visited.add(curr);

    const neighbors = adj.get(curr) || [];
    for (const nxt of neighbors) {
      if (!visited.has(nxt)) {
        queue.push(nxt);
      }
    }
  }

  return false;
}

/**
 * React Flow isValidConnection 검증 콜백
 * 1. 자기 자신 연결 차단
 * 2. 출발 노드의 다중 분기 차단 (Out-degree <= 1)
 * 3. 도착 노드의 다중 합류 차단 (In-degree <= 1)
 * 4. 무한루프(사이클)를 생성하는 역방향 연결 사전 차단
 */
export function checkConnectionValidity(
  connection: Connection | Edge,
  edges: Edge[]
): boolean {
  const source = connection.source;
  const target = connection.target;
  if (!source || !target) return false;
  if (source === target) return false;

  // 1) 다중 분기 차단: 이미 해당 source에서 나가는 간선이 있는 경우
  const alreadyHasOutgoing = edges.some(
    (e) => e.source === source && e.target !== target
  );
  if (alreadyHasOutgoing) return false;

  // 2) 다중 합류 차단: 이미 해당 target으로 들어오는 간선이 있는 경우
  const alreadyHasIncoming = edges.some(
    (e) => e.target === target && e.source !== source
  );
  if (alreadyHasIncoming) return false;

  // 3) 사이클(무한루프) 형성 차단
  if (wouldCreateCycle(source, target, edges)) {
    return false;
  }

  return true;
}

/**
 * 전체 워크플로우 그래프의 무결성 및 유효성 검사
 */
export function validateFlow(
  nodes: Node[],
  edges: Edge[],
  t?: (key: string, params?: Record<string, any>) => string
): FlowValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const tr = (key: string, fallback: string, params?: Record<string, any>) => {
    if (t) return t(key, params);
    if (!params) return fallback;
    let res = fallback;
    Object.entries(params).forEach(([k, v]) => {
      res = res.replace(`{${k}}`, String(v));
    });
    return res;
  };

  const startNodes = nodes.filter((n) => n.type === 'flow_start');
  const endNodes = nodes.filter((n) => n.type === 'flow_end');

  const startNode = startNodes[0];
  const endNode = endNodes[0];

  // 1. 시작 노드 검사
  if (startNodes.length === 0) {
    errors.push(tr('validation.noStartNode', "'시작' 노드가 존재하지 않습니다."));
  } else if (startNodes.length > 1) {
    errors.push(tr('validation.multipleStartNodes', "'시작' 노드는 워크플로우에 오직 1개만 존재해야 합니다."));
  }

  // 2. 끝 노드 검사
  if (endNodes.length === 0) {
    errors.push(tr('validation.noEndNode', "'끝' 노드가 존재하지 않습니다."));
  } else if (endNodes.length > 1) {
    errors.push(tr('validation.multipleEndNodes', "'끝' 노드는 워크플로우에 오직 1개만 존재해야 합니다."));
  }

  // 인접 리스트 생성
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    adj.set(n.id, []);
  }
  for (const e of edges) {
    if (adj.has(e.source)) {
      adj.get(e.source)!.push(e.target);
    }
  }

  // 3. 무한루프 (사이클) 검출 (DFS 3-color)
  let hasCycle = false;
  const cycleNodeIds: string[] = [];
  const visitedState = new Map<string, 'unvisited' | 'visiting' | 'visited'>();
  for (const n of nodes) visitedState.set(n.id, 'unvisited');

  const dfsCycle = (currId: string, path: string[]): boolean => {
    visitedState.set(currId, 'visiting');
    path.push(currId);

    const neighbors = adj.get(currId) || [];
    for (const nxt of neighbors) {
      const state = visitedState.get(nxt);
      if (state === 'visiting') {
        // 사이클 감지
        hasCycle = true;
        const cycleStartIndex = path.indexOf(nxt);
        if (cycleStartIndex !== -1) {
          cycleNodeIds.push(...path.slice(cycleStartIndex));
        } else {
          cycleNodeIds.push(nxt, currId);
        }
        return true;
      }
      if (state === 'unvisited') {
        if (dfsCycle(nxt, path)) return true;
      }
    }

    path.pop();
    visitedState.set(currId, 'visited');
    return false;
  };

  for (const n of nodes) {
    if (visitedState.get(n.id) === 'unvisited') {
      if (dfsCycle(n.id, [])) break;
    }
  }

  if (hasCycle) {
    errors.push(tr('validation.cycleDetected', '워크플로우에 무한루프(순환 참조)가 감지되었습니다.'));
  }

  // 4. 시작 노드에서 끝 노드까지의 유효 실행 경로 탐색 (순차 체인)
  const activeNodeIds: string[] = [];
  let reachedEnd = false;

  if (startNode && endNode && !hasCycle) {
    let curr: string | undefined = startNode.id;
    const visitedInChain = new Set<string>();

    while (curr) {
      if (visitedInChain.has(curr)) break;
      visitedInChain.add(curr);
      activeNodeIds.push(curr);

      if (curr === endNode.id) {
        reachedEnd = true;
        break;
      }

      const nextList: string[] = adj.get(curr) || [];
      curr = nextList.length > 0 ? nextList[0] : undefined;
    }

    if (!reachedEnd) {
      errors.push(tr('validation.disconnectedStartEnd', "'시작' 노드와 '끝' 노드가 끊김 없이 연결되어 있어야 합니다."));
    }
  } else if (!hasCycle && startNode && !endNode) {
    errors.push(tr('validation.cannotCompleteNoEnd', "'끝' 노드가 없어 워크플로우를 완료할 수 없습니다."));
  }

  // 5. 고립 노드(Orphan Node) 탐지
  const activeSet = new Set(activeNodeIds);
  const orphanNodeIds = nodes
    .filter((n) => !activeSet.has(n.id))
    .map((n) => n.id);

  if (orphanNodeIds.length > 0) {
    warnings.push(
      tr('validation.orphanWarning', `연결되지 않은 고립 노드가 ${orphanNodeIds.length}개 있습니다. (실행 시 무시됨)`, {
        count: orphanNodeIds.length,
      })
    );
  }

  // 6. 시작 노드와 끝 노드 사이에 최소 1개 이상의 스킬 노드가 있는지 안내 (옵션 체크)
  const intermediateNodes = activeNodeIds.filter(
    (id) => id !== startNode?.id && id !== endNode?.id
  );
  if (reachedEnd && intermediateNodes.length === 0) {
    warnings.push(tr('validation.noIntermediateNodes', '시작과 끝 노드 사이에 실행할 동작(스킬 노드)이 없습니다.'));
  }

  const isValid = errors.length === 0 && reachedEnd;

  return {
    isValid,
    errors,
    warnings,
    activeNodeIds,
    orphanNodeIds,
    hasCycle,
    cycleNodeIds: Array.from(new Set(cycleNodeIds)),
    startNodeId: startNode?.id,
    endNodeId: endNode?.id,
  };
}
