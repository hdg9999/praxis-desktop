import json
import asyncio
import re
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Callable, Awaitable, Tuple
from sqlmodel import Session, select
from app.core.database import engine
from app.core.config import settings
from app.core.kill_switch import kill_switch
from app.models.flow import Flow
from app.models.session import ExecutionSession
from app.models.message import ExecutionMessage
from app.nodes.base import (
    BaseNode,
    ExecutionContext,
    NodeResult,
    SYSTEM_VARIABLE_NAMES,
    VALID_VARIABLE_NAME_RE,
    coerce_variable_value,
)
from app.nodes.general import GeneralNode
from app.nodes.ai import AINode
from app.nodes.agent import AgentNode

TEMPLATE_VAR_RE = re.compile(r"\{\{\s*([^}\s]+)\s*\}\}")


class PassthroughNode(BaseNode):
    def __init__(self, id: str, name: str, config: Optional[Dict[str, Any]] = None):
        super().__init__(id=id, name=name, node_type="MARKER", config=config or {})

    async def run(self, context: ExecutionContext) -> NodeResult:
        """시작/끝/그룹 마커 노드는 어떠한 대기나 외부 조작 없이 즉시 통과"""
        return NodeResult(success=True, output=None)


class SubflowNode(BaseNode):
    """
    기존에 저장된 다른 워크플로우(서브 워크플로우)를 호출하여 실행하고,
    종료 후 다시 메인 워크플로우의 다음 노드로 복귀하는 노드입니다.
    - 변수 격리(Isolated Context) 기본 보장 + In / Out / InOut 명시적 변수 매핑 지원
    - 3중 안전 방어선:
      1) 콜 스택(call_stack) 기반 직·간접 순환 참조(무한 루프) 즉시 차단
      2) 최대 호출 깊이(max_call_depth, 기본 5단계) 초과 차단
      3) 세션당 누적 노드 실행 횟수(max_total_steps, 기본 500회) 초과 차단
    """

    def __init__(self, id: str, name: str, config: Optional[Dict[str, Any]], flow_engine_ref: "FlowEngine"):
        super().__init__(id=id, name=name, node_type="GENERAL", config=config or {})
        self.flow_engine_ref = flow_engine_ref

    async def run(self, context: ExecutionContext) -> NodeResult:
        target_flow_id = str(self.config.get("target_flow_id") or "").strip()
        target_flow_name_hint = str(self.config.get("target_flow_name") or "").strip()
        raw_mappings = self.config.get("variable_mappings") or []

        if not target_flow_id:
            return NodeResult(
                success=False,
                error=f"[{self.name}] 호출할 대상 워크플로우가 선택되지 않았습니다.",
            )

        # 1. 방어선 1: 콜 스택 기반 순환 호출(직·간접 무한 루프) 감지
        if target_flow_id in context.call_stack:
            idx = context.call_stack.index(target_flow_id)
            cycle_names = context.call_stack_names[idx:] + [target_flow_name_hint or target_flow_id]
            cycle_chain_str = " ➔ ".join(cycle_names)
            return NodeResult(
                success=False,
                error=f"[{self.name}] 워크플로우 간 순환 호출(무한 루프)이 감지되어 실행을 차단했습니다: ({cycle_chain_str})",
            )

        # 2. 방어선 2: 최대 호출 깊이(Max Call Depth) 초과 검사
        current_depth = len(context.call_stack)
        if current_depth >= context.max_call_depth:
            chain_str = " ➔ ".join(context.call_stack_names + [target_flow_name_hint or target_flow_id])
            return NodeResult(
                success=False,
                error=(
                    f"[{self.name}] 서브 워크플로우 최대 연쇄 호출 깊이({context.max_call_depth}단계)를 초과하여 "
                    f"실행을 차단했습니다: ({chain_str})"
                ),
            )

        # 3. DB에서 대상 서브 워크플로우 조회
        with Session(engine) as db:
            target_flow = db.get(Flow, target_flow_id)

        if not target_flow:
            return NodeResult(
                success=False,
                error=f"[{self.name}] 호출 대상 워크플로우(ID: '{target_flow_id}')를 찾을 수 없습니다. 삭제되었거나 존재하지 않습니다.",
            )

        target_flow_name = target_flow.name or target_flow_name_hint or target_flow_id
        try:
            sub_graph_data = json.loads(target_flow.graph_data) if isinstance(target_flow.graph_data, str) else (target_flow.graph_data or {})
        except Exception as e:
            return NodeResult(
                success=False,
                error=f"[{self.name}] 서브 워크플로우 '{target_flow_name}'의 그래프 데이터를 파싱할 수 없습니다: {e}",
            )

        # 4. 서브 워크플로우의 선언 변수 스키마 파싱 (독립 격리 공간)
        sub_raw_variables = sub_graph_data.get("variables")
        sub_strict_variables = isinstance(sub_raw_variables, list)
        sub_variable_schemas: Dict[str, Dict[str, Any]] = {}

        if sub_strict_variables:
            for item in sub_raw_variables:
                if not isinstance(item, dict):
                    continue
                v_name = str(item.get("name") or "").strip()
                v_type = str(item.get("type") or "string").strip().lower()
                v_default = item.get("defaultValue", "")
                if not v_name:
                    continue
                try:
                    coerce_variable_value(v_default, v_type)
                except ValueError as ve:
                    return NodeResult(
                        success=False,
                        error=f"[{self.name}] 서브 워크플로우 '{target_flow_name}'의 변수 '{v_name}' 초기값 오류: {ve}",
                    )
                sub_variable_schemas[v_name] = {
                    "name": v_name,
                    "type": v_type,
                    "defaultValue": v_default,
                    "description": item.get("description", ""),
                }

        # 5. In / InOut 매핑 변수 추출 및 타입 정규화하여 서브 컨텍스트 초기값 준비
        initial_sub_vars: Dict[str, Any] = {}
        in_mapped_summary: List[str] = []

        if isinstance(raw_mappings, list):
            for mp in raw_mappings:
                if not isinstance(mp, dict):
                    continue
                direction = str(mp.get("direction") or "in").strip().lower()
                parent_var = str(mp.get("parent_var") or "").strip()
                sub_var = str(mp.get("sub_var") or "").strip()
                if not parent_var or not sub_var:
                    continue

                if direction in ("in", "inout"):
                    try:
                        parent_val = context.get_variable(parent_var)
                    except ValueError as ve:
                        return NodeResult(
                            success=False,
                            error=f"[{self.name}] 입력(In) 매핑 오류: 메인 워크플로우에 '{parent_var}' 변수가 존재하지 않습니다. ({ve})",
                        )
                    if sub_strict_variables and sub_var not in sub_variable_schemas:
                        return NodeResult(
                            success=False,
                            error=f"[{self.name}] 입력(In) 매핑 오류: 서브 워크플로우 '{target_flow_name}'에 '{sub_var}' 변수가 선언되어 있지 않습니다.",
                        )
                    target_type = sub_variable_schemas.get(sub_var, {}).get("type", "string")
                    try:
                        coerced_in = coerce_variable_value(parent_val, target_type)
                    except ValueError as ve:
                        return NodeResult(
                            success=False,
                            error=f"[{self.name}] 입력(In) 매핑 타입 불일치 ('{parent_var}' ➔ '{sub_var}'): {ve}",
                        )
                    initial_sub_vars[sub_var] = coerced_in
                    in_mapped_summary.append(f"{parent_var}➔{sub_var}")

        # 6. 서브 워크플로우 호출 시작 이벤트 기록
        in_info_str = f" (입력 매핑: {', '.join(in_mapped_summary)})" if in_mapped_summary else ""
        await context.emit_event(
            node_id=self.id,
            node_name=self.name,
            node_type="GENERAL",
            event_type="START",
            content=f"🔗 [{self.name}] 서브 워크플로우 '{target_flow_name}' 호출 시작{in_info_str}",
        )

        # 7. 서브 워크플로우 실행 (독립된 변수 컨텍스트, 콜 스택 Push, 누적 스텝 카운터 공유)
        sub_flow_settings = sub_graph_data.get("settings") or context.flow_settings
        sub_context = ExecutionContext(
            session_id=context.session_id,
            event_callback=context.event_callback,
            check_cancelled=context.check_cancelled,
            variables=initial_sub_vars,
            variable_schemas=sub_variable_schemas,
            strict_variables=sub_strict_variables,
            flow_settings=sub_flow_settings,
            call_stack=context.call_stack + [target_flow_id],
            call_stack_names=context.call_stack_names + [target_flow_name],
            max_call_depth=context.max_call_depth,
            step_counter=context.step_counter,
            max_total_steps=context.max_total_steps,
        )

        sub_success, sub_err = await self.flow_engine_ref.execute_subflow_graph(
            flow_name=target_flow_name,
            graph_data=sub_graph_data,
            sub_context=sub_context,
        )

        if not sub_success:
            return NodeResult(
                success=False,
                error=sub_err or f"서브 워크플로우 '{target_flow_name}' 실행 중 오류가 발생했습니다.",
            )

        # 8. 서브 워크플로우 정상 종료 후 Out / InOut 매핑 변수를 메인 워크플로우 컨텍스트로 반환
        out_mapped_summary: List[str] = []
        if isinstance(raw_mappings, list):
            for mp in raw_mappings:
                if not isinstance(mp, dict):
                    continue
                direction = str(mp.get("direction") or "in").strip().lower()
                parent_var = str(mp.get("parent_var") or "").strip()
                sub_var = str(mp.get("sub_var") or "").strip()
                if not parent_var or not sub_var:
                    continue

                if direction in ("out", "inout"):
                    if sub_strict_variables and sub_var not in sub_variable_schemas and sub_var not in sub_context.variables:
                        return NodeResult(
                            success=False,
                            error=f"[{self.name}] 출력(Out) 매핑 오류: 서브 워크플로우 '{target_flow_name}'에 '{sub_var}' 변수가 존재하지 않습니다.",
                        )
                    sub_val = sub_context.variables.get(sub_var)
                    try:
                        context.set_variable(parent_var, sub_val)
                    except ValueError as ve:
                        return NodeResult(
                            success=False,
                            error=f"[{self.name}] 출력(Out) 매핑 오류 ('{sub_var}' ➔ '{parent_var}'): {ve}",
                        )
                    out_mapped_summary.append(f"{sub_var}➔{parent_var}")

        # 직전 출력(last_output) 갱신
        sub_last_out = sub_context.variables.get("last_output")
        if sub_last_out is not None:
            context.set_variable("last_output", sub_last_out, is_system=True)

        out_info_str = f" (출력 반환: {', '.join(out_mapped_summary)})" if out_mapped_summary else ""
        done_msg = f"✅ [{self.name}] 서브 워크플로우 '{target_flow_name}' 실행 완료{out_info_str}"
        await context.emit_event(
            node_id=self.id,
            node_name=self.name,
            node_type="GENERAL",
            event_type="SUCCESS",
            content=done_msg,
        )
        return NodeResult(success=True, output=done_msg)


class FlowEngine:
    def __init__(self):
        self.active_runs: Dict[str, bool] = {}

    def instantiate_node(
        self,
        node_data: Dict[str, Any],
        flow_settings: Optional[Dict[str, Any]] = None,
    ) -> BaseNode:
        node_id = node_data.get("id", "")
        node_type = node_data.get("type", "")
        data = node_data.get("data", {})
        label = data.get("label", node_id)
        config = dict(data.get("config", {}) or {})

        # 워크플로우 전역 설정의 기본 LLM 모델(default_llm_model) 주입
        if flow_settings:
            default_llm = str(flow_settings.get("default_llm_model") or "").strip()
            if default_llm:
                config["default_llm_model"] = default_llm
                if not str(config.get("model") or "").strip():
                    config["model"] = default_llm

        if node_type in ["flow_start", "flow_end", "flow_group"]:
            return PassthroughNode(id=node_id, name=label, config=config)
        elif node_type == "flow_call":
            return SubflowNode(id=node_id, name=label, config=config, flow_engine_ref=self)
        elif node_type.startswith("general_"):
            subtype = node_type.replace("general_", "")
            return GeneralNode(id=node_id, name=label, subtype=subtype, config=config)
        elif node_type in ["agent_basic", "agent"]:
            return AgentNode(id=node_id, name=label, config=config)
        elif node_type.startswith("ai_") or node_type == "ai_ollama":
            return AINode(id=node_id, name=label, config=config)
        else:
            # 기본값 일반 노드
            return GeneralNode(id=node_id, name=label, subtype="delay", config={"seconds": 1.0})

    def validate_flow_variables(
        self,
        ordered_nodes: List[Dict[str, Any]],
        variable_schemas: Dict[str, Dict[str, Any]],
    ) -> Optional[Tuple[str, str, str]]:
        """
        워크플로우 실행 전 활성 노드들의 출력 변수(output_variable) 및 템플릿 참조({{var}})가
        모두 선언된 변수인지, 그리고 변수 타입이 일치하는지 사전 검증합니다.
        오류 발견 시 (node_id, node_name, error_message) 튜플을 반환합니다.
        """
        template_keys = [
            "text",
            "window_title",
            "file_path",
            "program_path",
            "arguments",
            "process_name",
            "content",
            "title",
            "message",
            "prompt",
            "system_prompt",
        ]

        for node in ordered_nodes:
            node_id = node.get("id", "")
            node_type = node.get("type", "")
            if node_type in ("flow_start", "flow_end", "flow_group"):
                continue

            data = node.get("data", {}) or {}
            label = data.get("label", node_id)
            config = data.get("config", {}) or {}

            # 0. 서브 워크플로우 호출(flow_call) 노드의 변수 매핑 검사
            if node_type == "flow_call":
                raw_mappings = config.get("variable_mappings") or []
                if isinstance(raw_mappings, list):
                    for mp in raw_mappings:
                        if not isinstance(mp, dict):
                            continue
                        direction = str(mp.get("direction") or "in").strip().lower()
                        parent_var = str(mp.get("parent_var") or "").strip()
                        sub_var = str(mp.get("sub_var") or "").strip()
                        if not parent_var and not sub_var:
                            continue
                        if not parent_var or not sub_var:
                            return (
                                node_id,
                                label,
                                f"[{label}] 변수 매핑에 비어있는 변수명이 있습니다. 현재 워크플로우 변수와 서브 워크플로우 변수를 모두 지정해 주세요.",
                            )
                        if direction in ("in", "inout"):
                            if parent_var not in variable_schemas and parent_var not in SYSTEM_VARIABLE_NAMES:
                                return (
                                    node_id,
                                    label,
                                    f"[{label}] 입력(In) 매핑에 선언되지 않은 변수 '{parent_var}'가 지정되었습니다. 하단 '워크플로우 변수 관리' 패널에서 먼저 변수를 선언해 주세요.",
                                )
                        if direction in ("out", "inout"):
                            if parent_var in SYSTEM_VARIABLE_NAMES:
                                return (
                                    node_id,
                                    label,
                                    f"[{label}] 시스템 예약 변수('{parent_var}')에는 서브 워크플로우의 출력(Out) 값을 덮어쓸 수 없습니다.",
                                )
                            if parent_var not in variable_schemas:
                                return (
                                    node_id,
                                    label,
                                    f"[{label}] 출력(Out) 매핑에 선언되지 않은 변수 '{parent_var}'가 지정되었습니다. 하단 '워크플로우 변수 관리' 패널에서 먼저 변수를 선언해 주세요.",
                                )
                continue

            # 1. 출력 변수(output_variable) 선언 및 타입 호환성 검사
            requires_output = False
            expected_types = ("string", "number", "boolean", "json")

            if node_type in ("general_clipboard_read", "general_file_read", "ai_ollama", "agent_basic", "agent"):
                requires_output = True
            elif node_type == "general_message_box" and str(config.get("button_type", "ok")).lower() == "yes_no":
                requires_output = True
                expected_types = ("boolean", "string")

            if requires_output:
                out_var = str(config.get("output_variable") or "").strip()
                if not out_var:
                    return (
                        node_id,
                        label,
                        f"[{label}] 결과를 저장할 출력 변수가 지정되지 않았습니다. 하단 '워크플로우 변수 관리' 패널에서 변수를 선언하고 선택해 주세요.",
                    )
                if not VALID_VARIABLE_NAME_RE.match(out_var):
                    return (
                        node_id,
                        label,
                        f"[{label}] 출력 변수 이름 '{out_var}'의 형식이 올바르지 않습니다.",
                    )
                if out_var in SYSTEM_VARIABLE_NAMES:
                    return (
                        node_id,
                        label,
                        f"[{label}] 시스템 예약 변수('{out_var}')에는 결과를 덮어쓸 수 없습니다. 직접 선언한 변수를 선택해 주세요.",
                    )
                if out_var not in variable_schemas:
                    return (
                        node_id,
                        label,
                        f"[{label}] 선언되지 않은 출력 변수 '{out_var}'가 설정되어 있습니다. 하단 '워크플로우 변수 관리' 패널에서 먼저 변수를 등록해 주세요.",
                    )
                declared_type = variable_schemas[out_var].get("type", "string")
                if declared_type not in expected_types:
                    return (
                        node_id,
                        label,
                        f"[{label}] 출력 변수 '{out_var}'의 타입({declared_type})이 노드 출력 형식({', '.join(expected_types)})과 호환되지 않습니다.",
                    )

            # 2. 텍스트/템플릿 속성 내 {{변수}} 참조 검사
            for key in template_keys:
                raw_val = config.get(key)
                if isinstance(raw_val, str) and "{{" in raw_val:
                    for match in TEMPLATE_VAR_RE.finditer(raw_val):
                        ref_var = match.group(1).strip()
                        if ref_var not in variable_schemas and ref_var not in SYSTEM_VARIABLE_NAMES:
                            return (
                                node_id,
                                label,
                                f"[{label}] 속성에 선언되지 않은 변수 '{{{{{ref_var}}}}}'가 사용되었습니다. 하단 '워크플로우 변수 관리' 패널에서 변수를 먼저 선언해 주세요.",
                            )

        return None

    def get_execution_order(self, nodes: List[Dict[str, Any]], edges: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Left-to-Right 엣지 연결에 따른 순차 실행 순서 결정 (위상 정렬 기반).
        그룹 노드(flow_group)는 순수 UI 시각적 컨테이너이므로 실행 대상에서 완전히 제외합니다.
        """
        executable_nodes = [n for n in nodes if n.get("type") != "flow_group"]
        node_map = {n["id"]: n for n in executable_nodes}
        in_degree = {n["id"]: 0 for n in executable_nodes}
        adj: Dict[str, List[str]] = {n["id"]: [] for n in executable_nodes}

        for edge in edges:
            # 프론트엔드 가상 브릿지 간선(isGroupBridge)이 혹시 포함되어 있더라도 무시
            if edge.get("data", {}) and edge.get("data", {}).get("isGroupBridge"):
                continue
            src = edge.get("source")
            tgt = edge.get("target")
            if src in adj and tgt in in_degree:
                adj[src].append(tgt)
                in_degree[tgt] += 1

        # in-degree가 0인 노드부터 큐에 삽입 (왼쪽 노드들)
        # x 좌표 순으로 정렬하여 동일 계층 시 더 왼쪽 노드 우선
        queue = [nid for nid, deg in in_degree.items() if deg == 0]
        queue.sort(key=lambda nid: node_map[nid].get("position", {}).get("x", 0))

        ordered_nodes = []
        visited = set()

        while queue:
            curr_id = queue.pop(0)
            if curr_id in visited:
                continue
            visited.add(curr_id)
            ordered_nodes.append(node_map[curr_id])

            next_nodes = adj.get(curr_id, [])
            for nxt in next_nodes:
                in_degree[nxt] -= 1
                if in_degree[nxt] <= 0:
                    queue.append(nxt)

        # flow_start 노드가 존재하는 경우: 시작 노드로부터 도달 가능한 경로 상의 노드만 실행하고
        # 간선으로 이어지지 않은 고립 노드는 실행에서 제외 (무시)
        start_nodes = [n for n in executable_nodes if n.get("type") == "flow_start"]
        if start_nodes:
            start_id = start_nodes[0]["id"]
            reachable = set()
            q = [start_id]
            while q:
                curr = q.pop(0)
                if curr in reachable:
                    continue
                reachable.add(curr)
                for nxt in adj.get(curr, []):
                    if nxt not in reachable:
                        q.append(nxt)

            return [n for n in ordered_nodes if n["id"] in reachable]

        # 레거시 플로우 (flow_start 노드가 없는 경우): 연결되지 않은 노드도 x좌표 순으로 추가
        for n in executable_nodes:
            if n["id"] not in visited:
                ordered_nodes.append(n)

        return ordered_nodes

    async def execute_subflow_graph(
        self,
        flow_name: str,
        graph_data: Dict[str, Any],
        sub_context: ExecutionContext,
    ) -> Tuple[bool, Optional[str]]:
        """
        서브 워크플로우의 그래프를 위상 정렬하여 순차 실행합니다.
        실행 완료 후 (성공 여부, 오류 메시지)를 반환합니다.
        """
        nodes_data = graph_data.get("nodes", [])
        edges_data = graph_data.get("edges", [])
        flow_settings = graph_data.get("settings") or sub_context.flow_settings or {}

        try:
            execution_delay = max(0.0, float(flow_settings.get("execution_delay", 0.3)))
        except (ValueError, TypeError):
            execution_delay = 0.3

        ordered_nodes = self.get_execution_order(nodes_data, edges_data)

        if sub_context.strict_variables:
            validation_err = self.validate_flow_variables(ordered_nodes, sub_context.variable_schemas)
            if validation_err:
                _, _, err_text = validation_err
                return False, f"[서브 워크플로우: {flow_name}] {err_text}"

        for node_data in ordered_nodes:
            if sub_context.is_cancelled():
                return False, f"[서브 워크플로우: {flow_name}] 실행이 사용자에 의해 취소되었습니다."

            node_type = node_data.get("type", "")
            if node_type in ("flow_start", "flow_end", "flow_group"):
                continue

            # 방어선 3: 세션당 총 누적 노드 실행 스텝 제한 확인
            try:
                sub_context.increment_and_check_step_limit()
            except RuntimeError as limit_err:
                return False, str(limit_err)

            if execution_delay > 0:
                await self._sleep_interruptible(execution_delay, sub_context.is_cancelled)
                if sub_context.is_cancelled():
                    return False, f"[서브 워크플로우: {flow_name}] 실행이 사용자에 의해 취소되었습니다."

            # 서브 워크플로우 내부 노드 실행 시 타임라인에서 식별하기 쉽도록 라벨에 서브플로우 접두사 표기 가능
            sub_node_copy = dict(node_data)
            sub_data_copy = dict(node_data.get("data", {}) or {})
            orig_label = sub_data_copy.get("label", node_data.get("id", ""))
            sub_data_copy["label"] = f"[{flow_name}] {orig_label}"
            sub_node_copy["data"] = sub_data_copy

            node_instance = self.instantiate_node(sub_node_copy, flow_settings=flow_settings)
            result: NodeResult = await node_instance.run(sub_context)

            if not result or not result.success:
                err_msg = getattr(result, "error", None) or f"서브 워크플로우 '{flow_name}'의 노드 '{orig_label}' 실행에 실패했습니다."
                return False, err_msg

        return True, None

    async def _sleep_interruptible(self, seconds: float, is_cancelled_fn: Callable[[], bool]) -> None:
        """취소(KillSwitch) 여부를 주기적으로 확인하며 지정된 시간(초)만큼 대기합니다."""
        if seconds <= 0:
            return
        elapsed = 0.0
        while elapsed < seconds:
            if is_cancelled_fn():
                break
            step = min(0.05, seconds - elapsed)
            await asyncio.sleep(step)
            elapsed += step

    async def run_flow(
        self,
        flow_id: str,
        flow_name: str,
        graph_data: Dict[str, Any],
        session_id: str,
        event_callback: Callable[[Dict[str, Any]], Awaitable[None]]
    ) -> ExecutionSession:
        """단일 Flow 실행 및 실시간 DB 기록"""
        kill_switch.reset()
        self.active_runs[session_id] = True

        nodes_data = graph_data.get("nodes", [])
        edges_data = graph_data.get("edges", [])
        flow_settings = graph_data.get("settings") or {}
        raw_variables = graph_data.get("variables")

        # 워크플로우 실행 속도 (각 스킬 노드 실행 직전 고정 딜레이, 기본값 0.3초)
        try:
            execution_delay = max(0.0, float(flow_settings.get("execution_delay", 0.3)))
        except (ValueError, TypeError):
            execution_delay = 0.3

        ordered_nodes = self.get_execution_order(nodes_data, edges_data)

        # 1. DB에 ExecutionSession 생성
        with Session(engine) as db:
            session_record = ExecutionSession(
                id=session_id,
                flow_id=flow_id,
                flow_name=flow_name,
                status="RUNNING",
                started_at=datetime.now(timezone.utc)
            )
            db.add(session_record)
            db.commit()

        # 이벤트 브로드캐스트 & DB 기록 래퍼 콜백
        msg_idx = 0
        async def internal_event_callback(event_payload: Dict[str, Any]):
            nonlocal msg_idx
            msg_idx += 1
            msg_id = f"msg_{session_id}_{msg_idx:04d}"

            # DB에 메시지 영구 저장 (스트리밍 청크는 너무 빈번하므로 제외하고 영구 저장)
            event_type = event_payload.get("event_type", "")
            if event_type in ["START", "SUCCESS", "ERROR", "AGENT_TOOL_CALL", "AGENT_TOOL_RESULT", "AGENT_THINKING", "AGENT_STEP_START"]:
                with Session(engine) as db:
                    msg_record = ExecutionMessage(
                        id=msg_id,
                        session_id=session_id,
                        node_id=event_payload.get("node_id", ""),
                        node_name=event_payload.get("node_name", ""),
                        node_type=event_payload.get("node_type", "GENERAL"),
                        event_type=event_type,
                        content=event_payload.get("content", ""),
                        image_path=event_payload.get("image_path"),
                        created_at=datetime.now(timezone.utc)
                    )
                    db.add(msg_record)
                    db.commit()

            # 웹소켓 등으로 실시간 전송
            event_payload["message_id"] = msg_id
            await event_callback(event_payload)

        overall_status = "SUCCESS"
        last_error_msg: Optional[str] = None

        try:
            # 2. 워크플로우 변수 스키마 파싱 및 사전 유효성 검증
            strict_variables = isinstance(raw_variables, list)
            variable_schemas: Dict[str, Dict[str, Any]] = {}

            if strict_variables:
                for item in raw_variables:
                    if not isinstance(item, dict):
                        continue
                    v_name = str(item.get("name") or "").strip()
                    v_type = str(item.get("type") or "string").strip().lower()
                    v_default = item.get("defaultValue", "")
                    if not v_name:
                        continue
                    # 초기 기본값의 타입 유효성 검증
                    coerce_variable_value(v_default, v_type)
                    variable_schemas[v_name] = {
                        "name": v_name,
                        "type": v_type,
                        "defaultValue": v_default,
                        "description": item.get("description", ""),
                    }

                validation_err = self.validate_flow_variables(ordered_nodes, variable_schemas)
                if validation_err:
                    err_node_id, err_node_name, err_text = validation_err
                    overall_status = "FAILED"
                    last_error_msg = err_text
                    await internal_event_callback({
                        "node_id": err_node_id,
                        "node_name": err_node_name,
                        "node_type": "GENERAL",
                        "event_type": "ERROR",
                        "content": f"❌ {err_text}",
                    })

            if overall_status == "SUCCESS":
                max_call_depth = int(flow_settings.get("max_call_depth", 5) or 5)
                max_total_steps = int(flow_settings.get("max_total_steps", 500) or 500)
                context = ExecutionContext(
                    session_id=session_id,
                    event_callback=internal_event_callback,
                    check_cancelled=lambda: kill_switch.is_cancelled() or not self.active_runs.get(session_id, False),
                    variables={},
                    variable_schemas=variable_schemas,
                    strict_variables=strict_variables,
                    flow_settings=flow_settings,
                    call_stack=[flow_id] if flow_id else [],
                    call_stack_names=[flow_name or flow_id] if (flow_name or flow_id) else [],
                    max_call_depth=max_call_depth,
                    step_counter={"count": 0},
                    max_total_steps=max_total_steps,
                )

                for node_data in ordered_nodes:
                    if context.is_cancelled():
                        overall_status = "CANCELLED"
                        break

                    # 각 스킬 노드 실행 직전 고정 딜레이 적용 (시작/끝/그룹 마커 노드는 제외)
                    node_type = node_data.get("type", "")
                    if node_type not in ("flow_start", "flow_end", "flow_group"):
                        context.increment_and_check_step_limit()
                        if execution_delay > 0:
                            await self._sleep_interruptible(execution_delay, context.is_cancelled)
                            if context.is_cancelled():
                                overall_status = "CANCELLED"
                                break

                    node_instance = self.instantiate_node(node_data, flow_settings=flow_settings)
                    result: NodeResult = await node_instance.run(context)

                    if not result or not result.success:
                        overall_status = "FAILED"
                        err_msg = getattr(result, "error", None) or "노드 실행에 실패했습니다."
                        last_error_msg = err_msg
                        await internal_event_callback({
                            "node_id": node_data.get("id", ""),
                            "node_name": node_data.get("data", {}).get("label", node_instance.name),
                            "node_type": getattr(node_instance, "node_type", "GENERAL"),
                            "event_type": "ERROR",
                            "content": f"❌ {err_msg}"
                        })
                        break

        except Exception as e:
            overall_status = "FAILED"
            last_error_msg = f"노드 실행 중 치명적 예외 발생: {str(e)}"
            print(f"Error during flow run: {e}")
            curr_node_id = node_data.get("id", "") if 'node_data' in locals() else ""
            curr_node_name = node_data.get("data", {}).get("label", "실행 노드") if 'node_data' in locals() else "엔진 오류"
            await internal_event_callback({
                "node_id": curr_node_id,
                "node_name": curr_node_name,
                "node_type": "GENERAL",
                "event_type": "ERROR",
                "content": f"❌ {last_error_msg}"
            })

        finally:
            self.active_runs[session_id] = False
            # 세션 완료 상태 갱신
            with Session(engine) as db:
                session_record = db.get(ExecutionSession, session_id)
                if session_record:
                    session_record.status = overall_status
                    session_record.ended_at = datetime.now(timezone.utc)
                    db.add(session_record)
                    db.commit()
                    db.refresh(session_record)

            # 세션 완료 이벤트 전송
            await event_callback({
                "session_id": session_id,
                "flow_id": flow_id,
                "flow_name": flow_name,
                "event_type": "SESSION_FINISHED",
                "status": overall_status,
                "error": last_error_msg,
                "ended_at": datetime.now(timezone.utc).isoformat()
            })

            # 자동 정리 옵션 활성화 시 오래된 세션 정리
            if settings.AUTO_CLEAN_SESSIONS:
                self.clean_old_sessions()

        return session_record

    def stop_session(self, session_id: str):
        self.active_runs[session_id] = False
        kill_switch.trigger_cancel()

    def clean_old_sessions(self):
        """최근 N개 세션만 유지하고 오래된 세션 및 스크린샷 삭제"""
        with Session(engine) as db:
            sessions = db.exec(
                select(ExecutionSession).order_by(ExecutionSession.started_at.desc())
            ).all()

            if len(sessions) > settings.MAX_SESSION_HISTORY:
                to_delete = sessions[settings.MAX_SESSION_HISTORY:]
                for old_ses in to_delete:
                    # 메시지 삭제
                    messages = db.exec(
                        select(ExecutionMessage).where(ExecutionMessage.session_id == old_ses.id)
                    ).all()
                    for m in messages:
                        db.delete(m)
                    db.delete(old_ses)
                db.commit()

flow_engine = FlowEngine()
