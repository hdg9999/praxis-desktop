import { Node, Edge, Connection } from '@xyflow/react';
import { WorkflowVariable, FlowNodeData } from '../types';
import {
  SYSTEM_VARIABLE_NAMES,
  analyzeNodeVariableUsage,
  normalizeVariableValue,
} from './variableUtils';

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
 * 전체 워크플로우 그래프의 무결성 및 유효성 검사 (변수 선언 및 타입 일치성 검사 포함)
 */
export function validateFlow(
  nodes: Node[],
  edges: Edge[],
  t?: (key: string, params?: Record<string, any>) => string,
  variables?: WorkflowVariable[]
): FlowValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const tr = (key: string, fallback: string, params?: Record<string, any>) => {
    if (t) {
      const translated = t(key, params);
      if (translated && translated !== key) return translated;
    }
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

  // 7. 워크플로우 변수 선언 및 타입 정합성 검사 (variables가 제공된 경우)
  if (variables !== undefined) {
    const varMap = new Map<string, WorkflowVariable>();
    for (const v of variables) {
      const trimmedName = (v.name || '').trim();
      if (!trimmedName) continue;
      varMap.set(trimmedName, v);

      const norm = normalizeVariableValue(v.type, v.defaultValue);
      if (!norm.isValid) {
        errors.push(
          tr(
            'validation.invalidVariableDefault',
            `변수 '${trimmedName}'의 초기값이 선언된 타입(${v.type})과 일치하지 않습니다: ${norm.error}`,
            { name: trimmedName, type: v.type, reason: norm.error || '' }
          )
        );
      }
    }

    const nodeMap = new Map<string, Node>(nodes.map((n) => [n.id, n]));
    // 활성 실행 경로에 있는 노드(또는 전체 노드)의 변수 사용 검증
    const nodesToCheck = activeNodeIds.length > 0
      ? activeNodeIds.map((id) => nodeMap.get(id)).filter((n): n is Node => !!n)
      : nodes;

    for (const node of nodesToCheck) {
      if (node.type === 'flow_start' || node.type === 'flow_end') continue;
      const nodeData = (node.data as unknown as FlowNodeData) || { label: node.id, type: node.type as any, config: {} };
      const nodeLabel = nodeData.label || node.id;
      const usage = analyzeNodeVariableUsage(node);

      // (a) 출력 변수(output_variable) 선언 여부 및 타입 호환성 검사
      if (usage.outputVar !== null) {
        if (!usage.outputVar) {
          errors.push(
            tr(
              'validation.emptyOutputVar',
              `[${nodeLabel}] 출력 저장 변수명이 비어 있습니다. 선언된 변수를 선택해 주세요.`,
              { node: nodeLabel }
            )
          );
        } else if (SYSTEM_VARIABLE_NAMES.has(usage.outputVar)) {
          errors.push(
            tr(
              'validation.readonlyOutputVar',
              `[${nodeLabel}] 시스템 내장 변수('${usage.outputVar}')에는 출력값을 덮어쓸 수 없습니다.`,
              { node: nodeLabel, varName: usage.outputVar }
            )
          );
        } else if (!varMap.has(usage.outputVar)) {
          errors.push(
            tr(
              'validation.undeclaredOutputVar',
              `[${nodeLabel}] 선언되지 않은 출력 변수 '${usage.outputVar}'이(가) 지정되었습니다. 하단 변수 관리 패널에서 먼저 변수를 선언해 주세요.`,
              { node: nodeLabel, varName: usage.outputVar }
            )
          );
        } else {
          const declaredVar = varMap.get(usage.outputVar)!;
          if (
            usage.expectedOutputTypes.length > 0 &&
            !usage.expectedOutputTypes.includes(declaredVar.type)
          ) {
            errors.push(
              tr(
                'validation.incompatibleOutputVarType',
                `[${nodeLabel}] 출력 변수 '${usage.outputVar}'의 타입(${declaredVar.type})이 노드 출력 타입(${usage.expectedOutputTypes.join('/')})과 일치하지 않습니다.`,
                {
                  node: nodeLabel,
                  varName: usage.outputVar,
                  varType: declaredVar.type,
                  expected: usage.expectedOutputTypes.join('/'),
                }
              )
            );
          }
        }
      }

      // (b) 템플릿 참조 변수 {{변수명}} 선언 여부 검사
      for (const refVar of usage.referencedVars) {
        if (!SYSTEM_VARIABLE_NAMES.has(refVar) && !varMap.has(refVar)) {
          errors.push(
            tr(
              'validation.undeclaredRefVar',
              `[${nodeLabel}] 선언되지 않은 변수 '{{${refVar}}}'을(를) 참조하고 있습니다.`,
              { node: nodeLabel, varName: refVar }
            )
          );
        }
      }

      // (c) 숫자 전용 속성에 참조된 변수의 타입 검사
      for (const nf of usage.numericFieldVars) {
        const declaredVar = varMap.get(nf.varName);
        if (declaredVar && declaredVar.type !== 'number' && declaredVar.type !== 'string') {
          errors.push(
            tr(
              'validation.incompatibleNumericFieldVar',
              `[${nodeLabel}] 숫자 속성(${nf.field})에 숫자/문자열이 아닌 '${declaredVar.type}' 타입 변수 '{{${nf.varName}}}'이(가) 사용되었습니다.`,
              { node: nodeLabel, field: nf.field, varName: nf.varName, varType: declaredVar.type }
            )
          );
        }
      }
    }
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

