import { Node, Edge, Connection } from '@xyflow/react';
import { WorkflowVariable, FlowNodeData, Flow, SubflowVariableMapping, WorkflowSettings } from '../types';
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
 * 워크플로우 간 정적 호출 그래프(Call Graph)에서
 * currentFlowId -> ... -> targetFlowId -> ... -> currentFlowId 형태의
 * 직·간접 순환 호출(무한 루프)이 형성되는지 탐지하고, 발견 시 순환 경로(이름 배열)를 반환합니다.
 */
export function detectSubflowCallCycle(
  currentFlowId: string | undefined,
  currentFlowName: string | undefined,
  targetFlowId: string,
  allFlows?: Flow[]
): string[] | null {
  const cleanTarget = (targetFlowId || '').trim();
  if (!cleanTarget) return null;

  const currId = (currentFlowId || '').trim();
  const currName = (currentFlowName || currId || '현재 워크플로우').trim();

  // 1) 자기 자신을 직접 호출하는 경우
  if (currId && cleanTarget === currId) {
    return [currName, currName];
  }

  if (!allFlows || allFlows.length === 0) {
    return null;
  }

  const flowMap = new Map<string, Flow>();
  for (const f of allFlows) {
    flowMap.set(f.id, f);
  }

  // targetFlowId에서 출발하여 다시 currId에 도달하는지, 혹은 서브플로우들끼리 순환이 있는지 DFS 탐색
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const dfs = (flowId: string, pathIds: string[], pathNames: string[]): string[] | null => {
    if (currId && flowId === currId) {
      return [...pathNames, currName];
    }
    if (visiting.has(flowId)) {
      const fObj = flowMap.get(flowId);
      return [...pathNames, fObj?.name || flowId];
    }
    if (visited.has(flowId)) {
      return null;
    }

    const fObj = flowMap.get(flowId);
    if (!fObj) return null;

    visiting.add(flowId);
    const nextPathIds = [...pathIds, flowId];
    const nextPathNames = [...pathNames, fObj.name || flowId];

    const subNodes = fObj.graph_data?.nodes || [];
    for (const sn of subNodes) {
      if (sn?.type === 'flow_call') {
        const nextTargetId = String(sn?.data?.config?.target_flow_id || '').trim();
        if (nextTargetId) {
          const cycle = dfs(nextTargetId, nextPathIds, nextPathNames);
          if (cycle) return cycle;
        }
      } else if (sn?.type === 'flow_group') {
        const gCfg = sn?.data?.config || {};
        const isCatch = gCfg.error_mode === 'catch_subflow' || !!gCfg.catch_subflow;
        const catchTargetId = String(gCfg.catch_subflow_id || '').trim();
        if (isCatch && catchTargetId) {
          const cycle = dfs(catchTargetId, nextPathIds, nextPathNames);
          if (cycle) return cycle;
        }
      }
    }

    const globalErrHandler = fObj.graph_data?.settings?.global_error_handler;
    if (globalErrHandler?.mode === 'subflow') {
      const errTargetId = String(globalErrHandler.error_subflow_id || '').trim();
      if (errTargetId) {
        const cycle = dfs(errTargetId, nextPathIds, nextPathNames);
        if (cycle) return cycle;
      }
    }

    visiting.delete(flowId);
    visited.add(flowId);
    return null;
  };

  return dfs(cleanTarget, currId ? [currId] : [], [currName]);
}

/**
 * 전체 워크플로우 그래프의 무결성 및 유효성 검사 (변수 선언 및 타입 일치성 검사 포함)
 */
export function validateFlow(
  nodes: Node[],
  edges: Edge[],
  t?: (key: string, params?: Record<string, any>) => string,
  variables?: WorkflowVariable[],
  allFlows?: Flow[],
  currentFlowId?: string,
  currentFlowName?: string,
  flowSettings?: WorkflowSettings
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
  // 그룹 노드(flow_group)는 순수 UI 시각적 컨테이너이므로 실행 체인 및 고립 노드 검사에서 제외
  const executableNodes = nodes.filter((n) => n.type !== 'flow_group');
  const realEdges = edges.filter((e) => !(e.data as any)?.isGroupBridge);

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
  for (const n of executableNodes) {
    adj.set(n.id, []);
  }
  for (const e of realEdges) {
    if (adj.has(e.source) && adj.has(e.target)) {
      adj.get(e.source)!.push(e.target);
    }
  }

  // 3. 무한루프 (사이클) 검출 (DFS 3-color)
  let hasCycle = false;
  const cycleNodeIds: string[] = [];
  const visitedState = new Map<string, 'unvisited' | 'visiting' | 'visited'>();
  for (const n of executableNodes) visitedState.set(n.id, 'unvisited');

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

  for (const n of executableNodes) {
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

  // 5. 고립 노드(Orphan Node) 탐지 (그룹 노드는 순수 시각적 묶음이므로 제외)
  const activeSet = new Set(activeNodeIds);
  const orphanNodeIds = executableNodes
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

  // 6-1. 그룹 노드(flow_group)의 Catch 서브플로우 유효성 및 순환 호출 검사
  const groupNodes = nodes.filter((n) => n.type === 'flow_group');
  for (const gn of groupNodes) {
    const gData = (gn.data as unknown as FlowNodeData) || { label: gn.id, type: 'flow_group', config: {} };
    const gLabel = gData.label || gn.id;
    const gCfg = gData.config || {};
    const isCatch = gCfg.error_mode === 'catch_subflow' || !!gCfg.catch_subflow || !!gCfg.catch_subflow_enabled;
    if (isCatch) {
      const catchId = String(gCfg.catch_subflow_id || '').trim();
      if (!catchId) {
        errors.push(`[${gLabel}] 그룹 Catch 서브 워크플로우가 선택되지 않았습니다.`);
      } else {
        const cycleChain = detectSubflowCallCycle(currentFlowId, currentFlowName, catchId, allFlows);
        if (cycleChain) {
          errors.push(`[${gLabel}] 그룹 Catch 서브 워크플로우 간 순환 호출(무한 루프)이 감지되었습니다: ${cycleChain.join(' ➔ ')}`);
        }
      }
    }
  }

  // 6-2. 전역 에러 핸들러(Global Error Handler) 서브플로우 유효성 및 순환 호출 검사
  const globalErr = flowSettings?.global_error_handler;
  if (globalErr?.mode === 'subflow') {
    const errSubflowId = String(globalErr.error_subflow_id || '').trim();
    if (!errSubflowId) {
      errors.push(`[전역 오류 처리] 실행할 에러 핸들러 서브플로우가 선택되지 않았습니다.`);
    } else {
      const cycleChain = detectSubflowCallCycle(currentFlowId, currentFlowName, errSubflowId, allFlows);
      if (cycleChain) {
        errors.push(`[전역 오류 처리] 에러 핸들러 서브플로우 간 순환 호출(무한 루프)이 감지되었습니다: ${cycleChain.join(' ➔ ')}`);
      }
    }
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

    const nodeMap = new Map<string, Node>(executableNodes.map((n) => [n.id, n]));
    // 활성 실행 경로에 있는 노드(또는 전체 실행 가능 노드)의 변수 사용 검증
    const nodesToCheck = activeNodeIds.length > 0
      ? activeNodeIds.map((id) => nodeMap.get(id)).filter((n): n is Node => !!n)
      : executableNodes;

    for (const node of nodesToCheck) {
      if (node.type === 'flow_start' || node.type === 'flow_end' || node.type === 'flow_group') continue;
      const nodeData = (node.data as unknown as FlowNodeData) || { label: node.id, type: node.type as any, config: {} };
      const nodeLabel = nodeData.label || node.id;
      const cfg = nodeData.config || {};

      // 서브 워크플로우 호출(flow_call) 노드의 대상 및 변수 매핑 유효성 검사
      if (node.type === 'flow_call') {
        const targetFlowId = String(cfg.target_flow_id || '').trim();
        if (!targetFlowId) {
          errors.push(
            tr(
              'validation.subflowTargetEmpty',
              `[${nodeLabel}] 호출할 대상 워크플로우가 선택되지 않았습니다.`,
              { node: nodeLabel }
            )
          );
        } else {
          const cycleChain = detectSubflowCallCycle(currentFlowId, currentFlowName, targetFlowId, allFlows);
          if (cycleChain) {
            errors.push(
              tr(
                'validation.subflowCycleDetected',
                `[${nodeLabel}] 서브 워크플로우 간 순환 호출(무한 루프)이 감지되었습니다: ${cycleChain.join(' ➔ ')}`,
                { node: nodeLabel, chain: cycleChain.join(' ➔ ') }
              )
            );
          } else if (allFlows && allFlows.length > 0 && !allFlows.some((f) => f.id === targetFlowId)) {
            errors.push(
              tr(
                'validation.subflowNotFound',
                `[${nodeLabel}] 호출 대상 워크플로우를 찾을 수 없습니다. (삭제되었거나 유효하지 않음)`,
                { node: nodeLabel }
              )
            );
          }
        }

        const mappings: SubflowVariableMapping[] = Array.isArray(cfg.variable_mappings) ? cfg.variable_mappings : [];
        const targetFlowObj = allFlows?.find((f) => f.id === targetFlowId);
        const subVars: WorkflowVariable[] = targetFlowObj?.graph_data?.variables || [];
        const subVarMap = new Map<string, WorkflowVariable>(subVars.map((sv) => [(sv.name || '').trim(), sv]));

        for (const mp of mappings) {
          const dir = mp.direction || 'in';
          const pVar = (mp.parent_var || '').trim();
          const sVar = (mp.sub_var || '').trim();
          if (!pVar && !sVar) continue;
          if (!pVar || !sVar) {
            errors.push(`[${nodeLabel}] 변수 매핑에 비어있는 항목이 있습니다. 현재 워크플로우 변수와 서브 워크플로우 변수를 모두 선택해 주세요.`);
            continue;
          }
          if ((dir === 'in' || dir === 'inout') && !varMap.has(pVar) && !SYSTEM_VARIABLE_NAMES.has(pVar)) {
            errors.push(`[${nodeLabel}] 입력(In) 매핑에 선언되지 않은 변수 '${pVar}'이(가) 지정되었습니다.`);
          }
          if (dir === 'out' || dir === 'inout') {
            if (SYSTEM_VARIABLE_NAMES.has(pVar)) {
              errors.push(`[${nodeLabel}] 시스템 내장 변수('${pVar}')에는 서브 워크플로우 출력(Out) 값을 덮어쓸 수 없습니다.`);
            } else if (!varMap.has(pVar)) {
              errors.push(`[${nodeLabel}] 출력(Out) 매핑에 선언되지 않은 변수 '${pVar}'이(가) 지정되었습니다.`);
            }
          }
          if (targetFlowObj && subVarMap.size > 0 && !subVarMap.has(sVar)) {
            warnings.push(`[${nodeLabel}] 매핑된 서브 워크플로우 변수 '${sVar}'이(가) 대상 워크플로우('${targetFlowObj.name}')에 선언되어 있지 않습니다.`);
          }
        }
        continue;
      }

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

