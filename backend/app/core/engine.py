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
from app.nodes.general import (
    GeneralNode,
    render_template,
    load_template_image,
    find_image_on_screen,
)
from app.nodes.browser import BrowserNode
from app.nodes.ai import AINode
from app.nodes.agent import AgentNode, build_self_healing_agent_node
from app.services.uia_service import uia_service
from app.services.playwright_service import playwright_service

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

        # 7. 서브 워크플로우 실행 (독립된 변수 컨텍스트, 콜 스택 Push, 누적 스텝 카운터 및 세션 로그 공유)
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
            session_logs=context.session_logs,
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


class ConditionBranchNode(BaseNode):
    """
    조건 분기 (If / Else) 제어 노드 (flow_branch).
    지원하는 조건 판별 모드(condition_mode):
    1) 'variable' (변수/값 비교: ==, !=, contains, not_contains, starts_with, ends_with, >, >=, <, <=, is_empty, is_not_empty, is_true, is_false, regex)
    2) 'ui_element_exists' (PC 화면 UI 오브젝트 존재 여부 확인 - Windows UIA & OpenCV 이미지 하이브리드 탐색)
    3) 'web_element_exists' (웹 브라우저 요소 존재 여부 확인 - Playwright DOM/iframe 탐색)
    판별 결과에 따라 NodeResult.next_handle = 'true' 또는 'false'를 반환하여 그래프 분기 경로를 결정합니다.
    """

    def __init__(self, id: str, name: str, config: Optional[Dict[str, Any]] = None):
        super().__init__(id=id, name=name, node_type="GENERAL", config=config or {})

    def _resolve_operand(self, raw_val: Any, context: ExecutionContext) -> Any:
        if raw_val is None:
            return ""
        if not isinstance(raw_val, str):
            return raw_val
        s_val = raw_val.strip()
        # 단일 변수명(예: "count" 또는 "{{count}}")이 컨텍스트에 존재하면 원본 타입 값 반환
        single_match = re.match(r"^\{\{\s*([^}\s]+)\s*\}\}$", s_val)
        if single_match:
            var_key = single_match.group(1).strip()
            if var_key in context.variables:
                return context.variables[var_key]
        elif s_val in context.variables:
            return context.variables[s_val]

        declared = set(context.variable_schemas.keys()) if context.strict_variables else None
        return render_template(s_val, context.variables, strict=context.strict_variables, declared_names=declared)

    @staticmethod
    def _to_float(val: Any) -> float:
        if isinstance(val, bool):
            return 1.0 if val else 0.0
        if isinstance(val, (int, float)):
            return float(val)
        s = str(val or "").strip().replace(",", "")
        return float(s)

    @staticmethod
    def _to_bool(val: Any) -> bool:
        if isinstance(val, bool):
            return val
        if isinstance(val, (int, float)):
            return val != 0
        s = str(val or "").strip().lower()
        return s in ("true", "1", "yes", "y", "예", "on", "참")

    def _evaluate_variable_condition(self, context: ExecutionContext) -> Tuple[bool, str]:
        op = str(self.config.get("operator") or "equals").strip().lower()
        raw_left = self.config.get("left_value", "")
        raw_right = self.config.get("right_value", "")

        left_val = self._resolve_operand(raw_left, context)
        right_val = self._resolve_operand(raw_right, context)
        left_str = "" if left_val is None else str(left_val).strip()
        right_str = "" if right_val is None else str(right_val).strip()

        if op in ("equals", "==", "eq"):
            # 숫자 또는 불리언 간 동치 비교 지원
            try:
                is_true = self._to_float(left_val) == self._to_float(right_val)
            except Exception:
                if left_str.lower() in ("true", "false") and right_str.lower() in ("true", "false"):
                    is_true = left_str.lower() == right_str.lower()
                else:
                    is_true = left_str == right_str
            desc = f"'{left_str}' == '{right_str}'"
        elif op in ("not_equals", "!=", "neq"):
            try:
                is_true = self._to_float(left_val) != self._to_float(right_val)
            except Exception:
                if left_str.lower() in ("true", "false") and right_str.lower() in ("true", "false"):
                    is_true = left_str.lower() != right_str.lower()
                else:
                    is_true = left_str != right_str
            desc = f"'{left_str}' != '{right_str}'"
        elif op == "contains":
            is_true = right_str in left_str
            desc = f"'{left_str}' contains '{right_str}'"
        elif op == "not_contains":
            is_true = right_str not in left_str
            desc = f"'{left_str}' not contains '{right_str}'"
        elif op == "starts_with":
            is_true = left_str.startswith(right_str)
            desc = f"'{left_str}' starts with '{right_str}'"
        elif op == "ends_with":
            is_true = left_str.endswith(right_str)
            desc = f"'{left_str}' ends with '{right_str}'"
        elif op in ("gt", ">", "greater_than"):
            is_true = self._to_float(left_val) > self._to_float(right_val)
            desc = f"{left_val} > {right_val}"
        elif op in ("gte", ">=", "greater_or_equal"):
            is_true = self._to_float(left_val) >= self._to_float(right_val)
            desc = f"{left_val} >= {right_val}"
        elif op in ("lt", "<", "less_than"):
            is_true = self._to_float(left_val) < self._to_float(right_val)
            desc = f"{left_val} < {right_val}"
        elif op in ("lte", "<=", "less_or_equal"):
            is_true = self._to_float(left_val) <= self._to_float(right_val)
            desc = f"{left_val} <= {right_val}"
        elif op == "is_empty":
            is_true = left_val is None or left_str in ("", "None", "null", "{}", "[]")
            desc = f"'{left_str}' is empty"
        elif op == "is_not_empty":
            is_true = not (left_val is None or left_str in ("", "None", "null", "{}", "[]"))
            desc = f"'{left_str}' is not empty"
        elif op == "is_true":
            is_true = self._to_bool(left_val)
            desc = f"'{left_str}' is True"
        elif op == "is_false":
            is_true = not self._to_bool(left_val)
            desc = f"'{left_str}' is False"
        elif op == "regex":
            is_true = bool(re.search(right_str, left_str))
            desc = f"'{left_str}' matches /{right_str}/"
        else:
            is_true = left_str == right_str
            desc = f"'{left_str}' == '{right_str}'"

        return is_true, desc

    async def _evaluate_ui_element_exists(self, context: ExecutionContext) -> Tuple[bool, str]:
        import time

        object_data = self.config.get("object_data") or {}
        search_mode = str(self.config.get("search_mode") or "hybrid").strip().lower()
        try:
            timeout_sec = max(0.1, min(60.0, float(self.config.get("timeout", 2.0) or 2.0)))
        except (ValueError, TypeError):
            timeout_sec = 2.0
        try:
            confidence = max(0.3, min(1.0, float(self.config.get("confidence", 0.8) or 0.8)))
        except (ValueError, TypeError):
            confidence = 0.8

        obj_name = object_data.get("name") or self.config.get("object_name") or "UI 오브젝트"
        tpl_img, _ = load_template_image(object_data, self.config)

        uia_target_name = object_data.get("name")
        uia_orig_name = object_data.get("orig_name")
        uia_ctrl_type = object_data.get("control_type")
        uia_auto_id = object_data.get("automation_id")
        uia_win_title = object_data.get("window_title")
        uia_cls_name = object_data.get("class_name")
        orig_w = object_data.get("width")
        orig_h = object_data.get("height")

        start_t = time.time()
        while True:
            if context.is_cancelled():
                raise asyncio.CancelledError("사용자에 의해 실행이 중단되었습니다.")

            if search_mode in ("hybrid", "uia_only") and (uia_target_name or uia_orig_name or uia_auto_id):
                pos = uia_service.find_control(
                    name=uia_target_name,
                    control_type=uia_ctrl_type,
                    automation_id=uia_auto_id,
                    orig_name=uia_orig_name,
                    window_title=uia_win_title,
                    class_name=uia_cls_name,
                    orig_w=orig_w,
                    orig_h=orig_h,
                    max_search_seconds=0.25,
                )
                if pos:
                    return True, f"UI 오브젝트 '{obj_name}' 감지됨 (UIA 좌표: {pos[0]}, {pos[1]})"

            if search_mode in ("hybrid", "image_only") and tpl_img is not None:
                match_res = find_image_on_screen(tpl_img, confidence=confidence)
                if match_res:
                    cx, cy, score = match_res
                    return True, f"UI 오브젝트 '{obj_name}' 감지됨 (이미지 유사도 {score:.1%}, 좌표: {cx}, {cy})"

            if (time.time() - start_t) >= timeout_sec:
                break
            await asyncio.sleep(0.15)

        return False, f"UI 오브젝트 '{obj_name}' 미감지 (탐색 시간 {timeout_sec}초)"

    async def _evaluate_web_element_exists(self, context: ExecutionContext) -> Tuple[bool, str]:
        selector_type = str(self.config.get("selector_type") or "auto").strip()
        raw_selector = str(self.config.get("selector") or "").strip()
        declared = set(context.variable_schemas.keys()) if context.strict_variables else None
        selector = render_template(raw_selector, context.variables, strict=context.strict_variables, declared_names=declared).strip()
        iframe_auto_search = bool(self.config.get("iframe_auto_search", True))
        try:
            timeout_sec = max(0.1, min(60.0, float(self.config.get("timeout", 2.0) or 2.0)))
        except (ValueError, TypeError):
            timeout_sec = 2.0

        exists = await playwright_service.check_element_exists(
            selector_type=selector_type,
            selector=selector,
            iframe_auto_search=iframe_auto_search,
            timeout_sec=timeout_sec,
        )
        state_kor = "존재함" if exists else "존재하지 않음"
        return exists, f"웹 요소 [{selector_type}] '{selector}' ➔ {state_kor}"

    async def run(self, context: ExecutionContext) -> NodeResult:
        await context.emit_event(
            node_id=self.id,
            node_name=self.name,
            node_type="GENERAL",
            event_type="START",
            content=f"🔀 [{self.name}] 조건 분기 판별 시작",
        )
        try:
            mode = str(self.config.get("condition_mode") or "variable").strip().lower()
            if mode == "ui_element_exists":
                is_true, detail = await self._evaluate_ui_element_exists(context)
            elif mode == "web_element_exists":
                is_true, detail = await self._evaluate_web_element_exists(context)
            else:
                is_true, detail = self._evaluate_variable_condition(context)

            context.set_variable("branch_result", is_true, is_system=True)
            context.set_variable("last_output", is_true, is_system=True)

            out_var = str(self.config.get("output_variable") or "").strip()
            if out_var:
                context.set_variable(out_var, is_true)

            next_handle = "true" if is_true else "false"
            branch_label = "참(True)" if is_true else "거짓(False)"
            msg = f"🔀 [{self.name}] 조건 판별 결과: {branch_label} ({detail}) ➔ '{next_handle.upper()}' 경로로 이동합니다."

            await context.emit_event(
                node_id=self.id,
                node_name=self.name,
                node_type="GENERAL",
                event_type="SUCCESS",
                content=msg,
            )
            return NodeResult(success=True, output=is_true, next_handle=next_handle)
        except Exception as e:
            err_msg = f"[{self.name}] 조건 분기 판별 중 오류 발생: {e}"
            await context.emit_event(
                node_id=self.id,
                node_name=self.name,
                node_type="GENERAL",
                event_type="ERROR",
                content=f"❌ {err_msg}",
            )
            return NodeResult(success=False, error=err_msg)


class LoopNode(BaseNode):
    """
    반복 실행 제어 노드 (flow_loop).
    - loop_mode == 'count': 지정된 횟수(loop_count)만큼 'loop' 핸들로 순환 실행한 뒤, 횟수 도달 시 카운터를 초기화하고 'exit' 핸들로 탈출합니다.
    - loop_mode == 'infinite': 24시간 상시 모니터링 등을 위해 중단 전까지 계속 'loop' 핸들로 순환합니다.
    """

    def __init__(self, id: str, name: str, config: Optional[Dict[str, Any]] = None):
        super().__init__(id=id, name=name, node_type="GENERAL", config=config or {})

    async def run(self, context: ExecutionContext) -> NodeResult:
        try:
            loop_mode = str(self.config.get("loop_mode") or "count").strip().lower()
            out_var = str(self.config.get("output_variable") or "").strip()

            if loop_mode == "infinite":
                curr_iter = context.loop_states.get(self.id, 0) + 1
                context.loop_states[self.id] = curr_iter
                context.set_variable("loop_index", curr_iter, is_system=True)
                context.set_variable("last_output", curr_iter, is_system=True)
                if out_var:
                    context.set_variable(out_var, curr_iter)

                msg = f"♾️ [{self.name}] 무한 반복 실행 #{curr_iter}회차 진행 ➔ '반복(LOOP)' 경로로 이동합니다."
                await context.emit_event(
                    node_id=self.id,
                    node_name=self.name,
                    node_type="GENERAL",
                    event_type="SUCCESS",
                    content=msg,
                )
                return NodeResult(success=True, output=curr_iter, next_handle="loop")

            # 지정 횟수 반복 (count 모드)
            raw_count = self.config.get("loop_count", self.config.get("count", 3))
            if isinstance(raw_count, str) and "{{" in raw_count:
                declared = set(context.variable_schemas.keys()) if context.strict_variables else None
                rendered_cnt = render_template(raw_count, context.variables, strict=context.strict_variables, declared_names=declared).strip()
                target_count = max(0, int(float(rendered_cnt or 0)))
            else:
                target_count = max(0, int(float(raw_count if raw_count is not None else 3)))

            curr_iter = context.loop_states.get(self.id, 0) + 1
            if curr_iter <= target_count:
                context.loop_states[self.id] = curr_iter
                context.set_variable("loop_index", curr_iter, is_system=True)
                context.set_variable("last_output", curr_iter, is_system=True)
                if out_var:
                    context.set_variable(out_var, curr_iter)

                msg = f"🔁 [{self.name}] 반복 실행 ({curr_iter}/{target_count}회차) ➔ '반복(LOOP)' 경로로 이동합니다."
                await context.emit_event(
                    node_id=self.id,
                    node_name=self.name,
                    node_type="GENERAL",
                    event_type="SUCCESS",
                    content=msg,
                )
                return NodeResult(success=True, output=curr_iter, next_handle="loop")
            else:
                # 지정된 횟수 모두 완료 -> 카운터 리셋 후 'exit' 핸들로 이동
                context.loop_states[self.id] = 0
                msg = f"✅ [{self.name}] 총 {target_count}회 반복 완료 ➔ '반복 종료(EXIT)' 경로로 이동합니다."
                await context.emit_event(
                    node_id=self.id,
                    node_name=self.name,
                    node_type="GENERAL",
                    event_type="SUCCESS",
                    content=msg,
                )
                return NodeResult(success=True, output=target_count, next_handle="exit")

        except Exception as e:
            err_msg = f"[{self.name}] 반복 제어 노드 실행 오류: {e}"
            await context.emit_event(
                node_id=self.id,
                node_name=self.name,
                node_type="GENERAL",
                event_type="ERROR",
                content=f"❌ {err_msg}",
            )
            return NodeResult(success=False, error=err_msg)


class SetVariableNode(BaseNode):
    """
    워크플로우 변수 값 설정 및 연산 노드 (flow_set_variable).
    - operation:
      * 'set' (값 대입, 기본값)
      * 'increment' (숫자 더하기 +)
      * 'decrement' (숫자 빼기 -)
      * 'append' (문자열 뒤에 이어붙이기)
      * 'toggle' (불리언 True/False 반전)
    """

    def __init__(self, id: str, name: str, config: Optional[Dict[str, Any]] = None):
        super().__init__(id=id, name=name, node_type="GENERAL", config=config or {})

    async def run(self, context: ExecutionContext) -> NodeResult:
        target_var = str(self.config.get("target_variable") or self.config.get("output_variable") or "").strip()
        operation = str(self.config.get("operation") or "set").strip().lower()
        raw_val = self.config.get("value", "")

        if not target_var:
            err = f"[{self.name}] 값을 변경할 대상 변수가 지정되지 않았습니다."
            await context.emit_event(
                node_id=self.id,
                node_name=self.name,
                node_type="GENERAL",
                event_type="ERROR",
                content=f"❌ {err}",
            )
            return NodeResult(success=False, error=err)

        try:
            declared = set(context.variable_schemas.keys()) if context.strict_variables else None
            rendered_val = (
                render_template(str(raw_val), context.variables, strict=context.strict_variables, declared_names=declared)
                if isinstance(raw_val, str)
                else raw_val
            )

            curr_val = context.variables.get(target_var)

            if operation == "increment":
                step_num = float(rendered_val) if str(rendered_val).strip() != "" else 1.0
                base_num = float(curr_val) if curr_val not in (None, "") else 0.0
                res_num = base_num + step_num
                new_val: Any = int(res_num) if res_num.is_integer() else res_num
            elif operation == "decrement":
                step_num = float(rendered_val) if str(rendered_val).strip() != "" else 1.0
                base_num = float(curr_val) if curr_val not in (None, "") else 0.0
                res_num = base_num - step_num
                new_val = int(res_num) if res_num.is_integer() else res_num
            elif operation == "append":
                base_str = "" if curr_val is None else str(curr_val)
                new_val = base_str + str(rendered_val)
            elif operation == "toggle":
                if isinstance(curr_val, bool):
                    new_val = not curr_val
                else:
                    new_val = str(curr_val or "").strip().lower() not in ("true", "1", "yes", "y", "예", "on")
            else:
                new_val = rendered_val

            coerced = context.set_variable(target_var, new_val)
            context.set_variable("last_output", coerced, is_system=True)

            msg = f"📝 [{self.name}] 변수 '{{{{{target_var}}}}}' 업데이트 완료 ({operation}) ➔ {coerced}"
            await context.emit_event(
                node_id=self.id,
                node_name=self.name,
                node_type="GENERAL",
                event_type="SUCCESS",
                content=msg,
            )
            return NodeResult(success=True, output=coerced)
        except Exception as e:
            err = f"[{self.name}] 변수 '{target_var}' 설정 중 오류 발생: {e}"
            await context.emit_event(
                node_id=self.id,
                node_name=self.name,
                node_type="GENERAL",
                event_type="ERROR",
                content=f"❌ {err}",
            )
            return NodeResult(success=False, error=err)


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
        elif node_type == "flow_branch":
            return ConditionBranchNode(id=node_id, name=label, config=config)
        elif node_type == "flow_loop":
            return LoopNode(id=node_id, name=label, config=config)
        elif node_type in ("flow_set_variable", "general_set_variable"):
            return SetVariableNode(id=node_id, name=label, config=config)
        elif node_type.startswith("general_"):
            subtype = node_type.replace("general_", "")
            return GeneralNode(id=node_id, name=label, subtype=subtype, config=config)
        elif node_type.startswith("browser_"):
            subtype = node_type.replace("browser_", "")
            return BrowserNode(id=node_id, name=label, subtype=subtype, config=config)
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
            "url",
            "selector",
            "attribute_name",
            "target_value",
            "option_value",
            "script",
            "left_value",
            "right_value",
            "value",
            "loop_count",
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

            # 0-1. 변수 값 설정/연산(flow_set_variable) 노드의 대상 변수 검사
            if node_type in ("flow_set_variable", "general_set_variable"):
                target_var = str(config.get("target_variable") or config.get("output_variable") or "").strip()
                if not target_var:
                    return (
                        node_id,
                        label,
                        f"[{label}] 값을 변경할 대상 변수가 지정되지 않았습니다. 하단 '워크플로우 변수 관리' 패널에서 변수를 선언하고 선택해 주세요.",
                    )
                if target_var in SYSTEM_VARIABLE_NAMES:
                    return (
                        node_id,
                        label,
                        f"[{label}] 시스템 예약 변수('{target_var}')의 값은 변경할 수 없습니다. 직접 선언한 변수를 선택해 주세요.",
                    )
                if target_var not in variable_schemas:
                    return (
                        node_id,
                        label,
                        f"[{label}] 선언되지 않은 변수 '{target_var}'가 지정되었습니다. 하단 '워크플로우 변수 관리' 패널에서 먼저 변수를 등록해 주세요.",
                    )

            # 1. 출력 변수(output_variable) 선언 및 타입 호환성 검사
            requires_output = False
            expected_types = ("string", "number", "boolean", "json")

            if node_type in (
                "general_clipboard_read",
                "general_file_read",
                "browser_extract",
                "browser_get_info",
                "browser_evaluate",
                "ai_ollama",
                "agent_basic",
                "agent",
            ):
                requires_output = True
            elif node_type == "browser_action" and str(config.get("action_type", "")).lower() == "wait_for_download":
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
        Left-to-Right 엣지 연결에 따른 실행 가능 노드 목록 및 정적 순서 결정.
        - 그룹 노드(flow_group)는 순수 UI 시각적 컨테이너이므로 실행 대상에서 완전히 제외합니다.
        - 사이클(반복 루프)이 포함된 그래프에서도 flow_start로부터 도달 가능한 모든 활성 노드를 누락 없이 반환합니다.
        """
        executable_nodes = [n for n in nodes if n.get("type") != "flow_group" and n.get("id")]
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

        # flow_start 노드가 존재하는 경우: 시작 노드로부터 도달 가능한 경로(분기 및 루프 포함) 상의 노드만 반환하고
        # 간선으로 이어지지 않은 고립 노드는 실행에서 제외 (무시)
        start_nodes = [n for n in executable_nodes if n.get("type") == "flow_start"]
        if start_nodes:
            start_id = start_nodes[0]["id"]
            reachable_order: List[str] = []
            reachable_set = set()
            q = [start_id]
            while q:
                curr = q.pop(0)
                if curr in reachable_set:
                    continue
                reachable_set.add(curr)
                reachable_order.append(curr)
                for nxt in adj.get(curr, []):
                    if nxt not in reachable_set:
                        q.append(nxt)

            result_list = [n for n in ordered_nodes if n["id"] in reachable_set]
            existing_ids = {n["id"] for n in result_list}
            # 사이클(반복 루프)로 인해 위상 정렬 큐(in_degree == 0)에 진입하지 못했던 도달 가능 노드들을 BFS 순서대로 보충
            for rid in reachable_order:
                if rid not in existing_ids and rid in node_map:
                    result_list.append(node_map[rid])
                    existing_ids.add(rid)
            return result_list

        # 레거시 플로우 (flow_start 노드가 없는 경우): 사이클 노드나 미연결 노드도 x좌표 순으로 추가
        remaining = [n for n in executable_nodes if n["id"] not in visited]
        remaining.sort(key=lambda n: n.get("position", {}).get("x", 0))
        ordered_nodes.extend(remaining)

        return ordered_nodes

    def build_graph_routing(
        self,
        nodes: List[Dict[str, Any]],
        edges: List[Dict[str, Any]],
    ) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, List[Dict[str, Any]]], Optional[str]]:
        """
        런타임 상태 포인터(current_node_id) 기반 그래프 탐색을 위한 해시맵 구조 생성:
        - node_map: {node_id: node_data}
        - outgoing_edges: {source_node_id: [edge_dict, ...]}
        - start_node_id: 탐색 시작 노드 ID
        """
        executable_nodes = [n for n in nodes if n.get("type") != "flow_group" and n.get("id")]
        node_map: Dict[str, Dict[str, Any]] = {n["id"]: n for n in executable_nodes}
        outgoing_edges: Dict[str, List[Dict[str, Any]]] = {n["id"]: [] for n in executable_nodes}

        real_edges: List[Dict[str, Any]] = []
        for e in edges:
            if (e.get("data") or {}).get("isGroupBridge"):
                continue
            src = e.get("source")
            tgt = e.get("target")
            if src in node_map and tgt in node_map:
                real_edges.append(e)
                outgoing_edges[src].append(e)

        # 동일 핸들 내 다중 간선 존재 시 좌표 기준 결정론적 정렬
        for src_id, e_list in outgoing_edges.items():
            if len(e_list) > 1:
                e_list.sort(
                    key=lambda ed: (
                        node_map[ed["target"]].get("position", {}).get("x", 0),
                        node_map[ed["target"]].get("position", {}).get("y", 0),
                    )
                )

        if not executable_nodes:
            return node_map, outgoing_edges, None

        start_nodes = [n for n in executable_nodes if n.get("type") == "flow_start"]
        if start_nodes:
            start_id = start_nodes[0]["id"]
            # 레거시 단위 테스트 대비: flow_start는 있으나 간선(real_edges)이 아예 없는 경우 정적 순서로 가상 연결
            if not real_edges and len(executable_nodes) > 1:
                ordered = self.get_execution_order(nodes, edges)
                for idx in range(len(ordered) - 1):
                    u_id = ordered[idx]["id"]
                    v_id = ordered[idx + 1]["id"]
                    outgoing_edges[u_id].append({"source": u_id, "target": v_id})
            return node_map, outgoing_edges, start_id

        # 레거시 플로우 (flow_start 노드가 없는 경우): 위상 정렬 순서 기반으로 시작점 및 끊긴 구간 자동 체이닝
        ordered = self.get_execution_order(nodes, edges)
        if not ordered:
            return node_map, outgoing_edges, None

        start_id = ordered[0]["id"]
        for idx in range(len(ordered) - 1):
            u_id = ordered[idx]["id"]
            v_id = ordered[idx + 1]["id"]
            if not outgoing_edges.get(u_id):
                outgoing_edges[u_id].append({"source": u_id, "target": v_id})

        return node_map, outgoing_edges, start_id

    @staticmethod
    def resolve_next_node_id(
        curr_id: str,
        outgoing_edges: Dict[str, List[Dict[str, Any]]],
        next_handle: Optional[str] = None,
        node_type: str = "",
    ) -> Optional[str]:
        """
        현재 노드 ID와 실행 결과의 분기 핸들(next_handle: 'true'|'false'|'loop'|'exit'|None)을 바탕으로
        다음에 실행할 도착 노드 ID(O(1))를 반환합니다.
        """
        edges_from_curr = outgoing_edges.get(curr_id) or []
        if not edges_from_curr:
            return None

        if next_handle:
            target_h = next_handle.strip().lower()
            # 1) 명시적으로 일치하는 sourceHandle 또는 data.branch 탐색
            for e in edges_from_curr:
                eh = str(
                    e.get("sourceHandle")
                    or (e.get("data") or {}).get("branch")
                    or ""
                ).strip().lower()
                if eh == target_h:
                    return e.get("target")

            # 2) 분기/루프 노드에서 일부 핸들만 연결된 경우, 다른 핸들로 잘못 넘어가지 않도록 차단
            has_any_explicit_handle = any(
                bool(str(e.get("sourceHandle") or (e.get("data") or {}).get("branch") or "").strip())
                for e in edges_from_curr
            )
            if has_any_explicit_handle or node_type in ("flow_branch", "flow_loop"):
                # 단, 테스트 코드 등에서 sourceHandle 없이 단일 간선만 연결하고 'true'/'loop'가 나온 경우는 허용
                if not has_any_explicit_handle and len(edges_from_curr) == 1 and target_h in ("true", "loop", "default"):
                    return edges_from_curr[0].get("target")
                return None

        return edges_from_curr[0].get("target")

    @staticmethod
    def find_group_exit_node(
        curr_id: str,
        group_id: str,
        node_map: Dict[str, Dict[str, Any]],
        outgoing_edges: Dict[str, List[Dict[str, Any]]],
    ) -> Optional[str]:
        """
        그룹 내부 노드(curr_id)에서 오류 발생 시(Break Group 또는 Catch Subflow 완료 후),
        간선 그래프를 따라 BFS 탐색하여 해당 그룹(group_id) 바깥으로 나가는 첫 번째 후속 노드 ID를 반환합니다.
        """
        if not group_id:
            return None
        visited = {curr_id}
        queue = [curr_id]
        while queue:
            u = queue.pop(0)
            for e in outgoing_edges.get(u, []):
                v = e.get("target")
                if not v or v not in node_map:
                    continue
                v_node = node_map[v]
                v_group = str(((v_node.get("data") or {}).get("config") or {}).get("group_id") or "").strip()
                if v_group != group_id:
                    return v
                if v not in visited:
                    visited.add(v)
                    queue.append(v)
        return None

    @staticmethod
    def build_downstream_lookahead(
        curr_id: str,
        node_map: Dict[str, Dict[str, Any]],
        outgoing_edges: Dict[str, List[Dict[str, Any]]],
        max_depth: int = 3,
    ) -> str:
        """
        오류가 발생한 노드(curr_id) 직후에 예정된 1~3단계 후속 그래프 경로를 요약하여
        Self-Healing AI 에이전트가 복구 범위와 직후 단계의 의도를 정확히 파악할 수 있도록 지원합니다.
        """
        first_edges = outgoing_edges.get(curr_id) or []
        if not first_edges:
            return "이후 연결된 후속 노드 없음 (워크플로우 종료 예정)"

        branches_desc: List[str] = []
        for e in first_edges:
            h_raw = str(e.get("sourceHandle") or (e.get("data") or {}).get("branch") or "").strip()
            h_prefix = f"[{h_raw.upper()} 분기] " if h_raw else ""

            chain_labels: List[str] = []
            ptr = e.get("target")
            depth = 0
            seen_in_lookahead = {curr_id}

            while ptr and ptr in node_map and depth < max_depth:
                n_obj = node_map[ptr]
                n_type = n_obj.get("type", "")
                n_lbl = (n_obj.get("data") or {}).get("label", ptr)
                if n_type == "flow_end":
                    chain_labels.append("끝(종료)")
                    break
                chain_labels.append(n_lbl)
                seen_in_lookahead.add(ptr)
                depth += 1

                nxt_edges = outgoing_edges.get(ptr) or []
                if len(nxt_edges) == 1:
                    nxt_target = nxt_edges[0].get("target")
                    if nxt_target in seen_in_lookahead:
                        chain_labels.append(f"↺({(node_map.get(nxt_target, {}).get('data') or {}).get('label', nxt_target)} 루프 복귀)")
                        break
                    ptr = nxt_target
                elif len(nxt_edges) > 1:
                    sub_Targets = []
                    for se in nxt_edges:
                        sh = str(se.get("sourceHandle") or "").strip().upper()
                        st = se.get("target")
                        st_lbl = (node_map.get(st, {}).get("data") or {}).get("label", st) if st else "종료"
                        sub_Targets.append(f"{sh}:{st_lbl}" if sh else st_lbl)
                    chain_labels.append(f"(분기 ➔ {' / '.join(sub_Targets)})")
                    break
                else:
                    break

            if chain_labels:
                branches_desc.append(f"{h_prefix}{' ➔ '.join(chain_labels)}")

        return " | ".join(branches_desc) if branches_desc else "이후 연결된 후속 노드 없음"

    @staticmethod
    def _resolve_group_error_mode(group_cfg: Dict[str, Any]) -> str:
        """
        그룹 노드 설정에서 Try-Catch 오류 조치 모드를 추출합니다.
        반환값: 'break_group' | 'catch_subflow' | 'none'
        """
        if not isinstance(group_cfg, dict):
            return "none"
        explicit_mode = str(group_cfg.get("error_mode") or "").strip().lower()
        if explicit_mode in ("break_group", "catch_subflow"):
            return explicit_mode
        if bool(group_cfg.get("break_group", False)):
            return "break_group"
        if bool(group_cfg.get("catch_subflow", False)):
            return "catch_subflow"
        return "none"

    async def _execute_error_handler_subflow(
        self,
        target_flow_id: str,
        caller_node_id: str,
        caller_label: str,
        parent_context: ExecutionContext,
    ) -> Tuple[bool, Optional[str]]:
        """
        그룹 Catch 서브 워크플로우 또는 전역 에러 핸들러 서브 워크플로우를 실행합니다.
        실행 전 부모 컨텍스트의 오류 관련 시스템 변수(last_error_message 등)를 서브 컨텍스트로 전달합니다.
        """
        clean_id = str(target_flow_id or "").strip()
        if not clean_id:
            err = f"[{caller_label}] 호출할 예외 처리 서브 워크플로우가 선택되지 않았습니다."
            await parent_context.emit_event(
                node_id=caller_node_id,
                node_name=caller_label,
                node_type="GENERAL",
                event_type="ERROR",
                content=f"❌ {err}",
            )
            return False, err

        if clean_id in parent_context.call_stack:
            idx = parent_context.call_stack.index(clean_id)
            cycle_names = parent_context.call_stack_names[idx:] + [clean_id]
            err = f"[{caller_label}] 예외 처리 서브 워크플로우 순환 호출(무한 루프)이 감지되어 차단했습니다: ({' ➔ '.join(cycle_names)})"
            await parent_context.emit_event(
                node_id=caller_node_id,
                node_name=caller_label,
                node_type="GENERAL",
                event_type="ERROR",
                content=f"❌ {err}",
            )
            return False, err

        if len(parent_context.call_stack) >= parent_context.max_call_depth:
            err = f"[{caller_label}] 서브 워크플로우 최대 호출 깊이({parent_context.max_call_depth}단계)를 초과하여 실행을 차단했습니다."
            await parent_context.emit_event(
                node_id=caller_node_id,
                node_name=caller_label,
                node_type="GENERAL",
                event_type="ERROR",
                content=f"❌ {err}",
            )
            return False, err

        with Session(engine) as db:
            target_flow = db.get(Flow, clean_id)

        if not target_flow:
            err = f"[{caller_label}] 예외 처리 대상 워크플로우(ID: '{clean_id}')를 찾을 수 없습니다."
            await parent_context.emit_event(
                node_id=caller_node_id,
                node_name=caller_label,
                node_type="GENERAL",
                event_type="ERROR",
                content=f"❌ {err}",
            )
            return False, err

        target_flow_name = target_flow.name or clean_id
        try:
            sub_graph_data = (
                json.loads(target_flow.graph_data)
                if isinstance(target_flow.graph_data, str)
                else (target_flow.graph_data or {})
            )
        except Exception as e:
            err = f"[{caller_label}] 서브 워크플로우 '{target_flow_name}' 그래프 파싱 실패: {e}"
            return False, err

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
                sub_variable_schemas[v_name] = {
                    "name": v_name,
                    "type": v_type,
                    "defaultValue": v_default,
                    "description": item.get("description", ""),
                }

        # 오류 시스템 변수를 서브 컨텍스트로 그대로 승계
        initial_sub_vars: Dict[str, Any] = {}
        for sys_key in (
            "last_error_message",
            "last_error_node_id",
            "last_error_node_name",
            "retry_count",
            "last_output",
        ):
            if sys_key in parent_context.variables:
                initial_sub_vars[sys_key] = parent_context.variables[sys_key]

        await parent_context.emit_event(
            node_id=caller_node_id,
            node_name=caller_label,
            node_type="GENERAL",
            event_type="START",
            content=f"🛡️ [{caller_label}] 예외 처리 워크플로우 '{target_flow_name}' 호출 시작",
        )

        sub_flow_settings = sub_graph_data.get("settings") or parent_context.flow_settings
        sub_context = ExecutionContext(
            session_id=parent_context.session_id,
            event_callback=parent_context.event_callback,
            check_cancelled=parent_context.check_cancelled,
            variables=initial_sub_vars,
            variable_schemas=sub_variable_schemas,
            strict_variables=sub_strict_variables,
            flow_settings=sub_flow_settings,
            call_stack=parent_context.call_stack + [clean_id],
            call_stack_names=parent_context.call_stack_names + [target_flow_name],
            max_call_depth=parent_context.max_call_depth,
            step_counter=parent_context.step_counter,
            max_total_steps=parent_context.max_total_steps,
            session_logs=parent_context.session_logs,
        )

        sub_ok, sub_err = await self.execute_subflow_graph(
            flow_name=target_flow_name,
            graph_data=sub_graph_data,
            sub_context=sub_context,
        )
        if not sub_ok:
            fail_msg = sub_err or f"예외 처리 워크플로우 '{target_flow_name}' 실행 중 오류가 발생했습니다."
            await parent_context.emit_event(
                node_id=caller_node_id,
                node_name=caller_label,
                node_type="GENERAL",
                event_type="ERROR",
                content=f"❌ [{caller_label}] 예외 처리 워크플로우 '{target_flow_name}' 실패: {fail_msg}",
            )
            return False, fail_msg

        sub_last_out = sub_context.variables.get("last_output")
        if sub_last_out is not None:
            parent_context.set_variable("last_output", sub_last_out, is_system=True)

        await parent_context.emit_event(
            node_id=caller_node_id,
            node_name=caller_label,
            node_type="GENERAL",
            event_type="SUCCESS",
            content=f"✅ [{caller_label}] 예외 처리 워크플로우 '{target_flow_name}' 실행 완료",
        )
        return True, None

    async def _run_node_with_retry(
        self,
        node_data: Dict[str, Any],
        flow_settings: Dict[str, Any],
        context: ExecutionContext,
        error_emitted_node_ids: Optional[set] = None,
        label_prefix: str = "",
    ) -> Tuple[NodeResult, int]:
        """
        단일 노드를 실행하고 실패 시 노드 속성에 설정된 재시도(M초 간격 N회) 정책을 수행합니다.
        재시도 시 Agent Runner 타임라인에서 몇 번째 재시도인지 즉시 식별할 수 있도록
        노드 라벨 및 이벤트 메시지에 재시도 회차를 명시하여 기록합니다.
        반환값: (최종 NodeResult, 수행한 재시도 횟수)
        """
        nid = node_data.get("id", "")
        data = node_data.get("data", {}) or {}
        orig_label = data.get("label", nid)
        cfg = data.get("config", {}) or {}
        display_base_label = f"{label_prefix}{orig_label}" if label_prefix else orig_label

        context.set_variable("retry_count", 0, is_system=True)

        first_copy = dict(node_data)
        first_data_copy = dict(data)
        first_data_copy["label"] = display_base_label
        first_copy["data"] = first_data_copy

        node_instance = self.instantiate_node(first_copy, flow_settings=flow_settings)
        result: NodeResult = await node_instance.run(context)

        if (result and result.success) or context.is_cancelled():
            return result, 0

        # 1차 시도 실패 시 노드가 자체 ERROR 이벤트를 발행하지 않은 경우 발행
        err_msg = getattr(result, "error", None) or "노드 실행에 실패했습니다."
        if error_emitted_node_ids is not None and nid not in error_emitted_node_ids:
            await context.emit_event(
                node_id=nid,
                node_name=display_base_label,
                node_type=getattr(node_instance, "node_type", "GENERAL"),
                event_type="ERROR",
                content=f"❌ {err_msg}",
            )

        retry_enabled = bool(cfg.get("retry_enabled", False))
        try:
            retry_count = max(0, min(20, int(cfg.get("retry_count", 3) or 0))) if retry_enabled else 0
        except (ValueError, TypeError):
            retry_count = 3 if retry_enabled else 0

        try:
            retry_interval = max(0.0, min(60.0, float(cfg.get("retry_interval", 1.0) or 0.0)))
        except (ValueError, TypeError):
            retry_interval = 1.0

        attempts_done = 0
        for attempt in range(1, retry_count + 1):
            if context.is_cancelled():
                break

            attempts_done = attempt
            context.set_variable("retry_count", attempt, is_system=True)
            retry_label = f"{display_base_label} (재시도 {attempt}/{retry_count})"

            await context.emit_event(
                node_id=nid,
                node_name=retry_label,
                node_type=getattr(node_instance, "node_type", "GENERAL"),
                event_type="START",
                content=(
                    f"🔄 [{display_base_label}] 오류 발생 — {retry_interval}초 대기 후 "
                    f"재시도합니다 ({attempt}/{retry_count}회차)"
                ),
            )

            if retry_interval > 0:
                await self._sleep_interruptible(retry_interval, context.is_cancelled)
                if context.is_cancelled():
                    break

            context.increment_and_check_step_limit()

            if error_emitted_node_ids is not None:
                error_emitted_node_ids.discard(nid)

            retry_copy = dict(node_data)
            retry_data_copy = dict(data)
            retry_data_copy["label"] = retry_label
            retry_copy["data"] = retry_data_copy

            retry_instance = self.instantiate_node(retry_copy, flow_settings=flow_settings)
            result = await retry_instance.run(context)

            if result and result.success:
                return result, attempts_done

            err_msg = getattr(result, "error", None) or "노드 재시도 실행에 실패했습니다."
            if error_emitted_node_ids is not None and nid not in error_emitted_node_ids:
                await context.emit_event(
                    node_id=nid,
                    node_name=retry_label,
                    node_type=getattr(retry_instance, "node_type", "GENERAL"),
                    event_type="ERROR",
                    content=f"❌ {err_msg}",
                )

        return result, attempts_done

    async def execute_subflow_graph(
        self,
        flow_name: str,
        graph_data: Dict[str, Any],
        sub_context: ExecutionContext,
    ) -> Tuple[bool, Optional[str]]:
        """
        서브 워크플로우의 그래프를 상태 포인터(current_node_id) 기반 그래프 탐색 방식으로 실행합니다.
        분기(flow_branch) 및 반복(flow_loop) 제어를 완벽히 지원하며,
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
        node_map, outgoing_edges, start_node_id = self.build_graph_routing(nodes_data, edges_data)
        group_map = {
            n["id"]: n for n in nodes_data if n.get("type") == "flow_group" and n.get("id")
        }

        if sub_context.strict_variables:
            validation_err = self.validate_flow_variables(ordered_nodes, sub_context.variable_schemas)
            if validation_err:
                _, _, err_text = validation_err
                return False, f"[서브 워크플로우: {flow_name}] {err_text}"

        current_node_id = start_node_id
        while current_node_id and current_node_id in node_map:
            if sub_context.is_cancelled():
                return False, f"[서브 워크플로우: {flow_name}] 실행이 사용자에 의해 취소되었습니다."

            node_data = node_map[current_node_id]
            node_type = node_data.get("type", "")
            nid = node_data.get("id", "")

            if node_type == "flow_end":
                break
            if node_type in ("flow_start", "flow_group"):
                current_node_id = self.resolve_next_node_id(nid, outgoing_edges, None, node_type)
                continue

            n_data = node_data.get("data", {}) or {}
            orig_label = n_data.get("label", nid)
            cfg = n_data.get("config", {}) or {}
            group_id = str(cfg.get("group_id") or "").strip()

            # 방어선 3: 세션당 총 누적 노드 실행 스텝 제한 확인
            try:
                sub_context.increment_and_check_step_limit()
            except RuntimeError as limit_err:
                return False, str(limit_err)

            if execution_delay > 0:
                await self._sleep_interruptible(execution_delay, sub_context.is_cancelled)
                if sub_context.is_cancelled():
                    return False, f"[서브 워크플로우: {flow_name}] 실행이 사용자에 의해 취소되었습니다."

            result, _ = await self._run_node_with_retry(
                node_data=node_data,
                flow_settings=flow_settings,
                context=sub_context,
                error_emitted_node_ids=None,
                label_prefix=f"[{flow_name}] ",
            )

            if result and result.success:
                next_handle = getattr(result, "next_handle", None)
                if next_handle:
                    sub_context.record_trajectory(f"[{flow_name}] {orig_label}({next_handle.upper()})")
                else:
                    sub_context.record_trajectory(f"[{flow_name}] {orig_label}")
                current_node_id = self.resolve_next_node_id(nid, outgoing_edges, next_handle, node_type)
                continue

            # 노드 실행 실패 시 예외처리 파이프라인
            if sub_context.is_cancelled():
                return False, f"[서브 워크플로우: {flow_name}] 실행이 사용자에 의해 취소되었습니다."

            err_msg = getattr(result, "error", None) or f"서브 워크플로우 '{flow_name}'의 노드 '{orig_label}' 실행에 실패했습니다."
            sub_context.set_variable("last_error_message", err_msg, is_system=True)
            sub_context.set_variable("last_error_node_id", nid, is_system=True)
            sub_context.set_variable("last_error_node_name", orig_label, is_system=True)

            # 1) 개별 노드 오류 무시 후 진행 (Continue On Error)
            if bool(cfg.get("continue_on_error", False)):
                await sub_context.emit_event(
                    node_id=nid,
                    node_name=f"[{flow_name}] {orig_label}",
                    node_type="GENERAL",
                    event_type="SUCCESS",
                    content=(
                        f"⏭️ [[{flow_name}] {orig_label}] 최종 오류가 발생했으나 "
                        f"'오류 무시 후 진행(Continue On Error)' 설정에 따라 다음 노드로 진행합니다. (사유: {err_msg})"
                    ),
                )
                sub_context.record_trajectory(f"[{flow_name}] {orig_label}(오류무시)")
                current_node_id = self.resolve_next_node_id(nid, outgoing_edges, None, node_type)
                continue

            # 2) 그룹 노드 Try-Catch (Break Group / Catch Subflow)
            if group_id and group_id in group_map:
                g_node = group_map[group_id]
                g_data = g_node.get("data", {}) or {}
                g_label = g_data.get("label", group_id)
                g_cfg = g_data.get("config", {}) or {}
                g_mode = self._resolve_group_error_mode(g_cfg)

                if g_mode == "break_group":
                    await sub_context.emit_event(
                        node_id=group_id,
                        node_name=f"[{flow_name} 그룹] {g_label}",
                        node_type="GENERAL",
                        event_type="START",
                        content=(
                            f"⏭️ [{g_label}] 하위 노드 '{orig_label}' 오류 발생 — "
                            f"'그룹 건너뛰기(Break Group)'가 작동하여 그룹 내 나머지 노드를 건너뛰고 다음 노드로 이동합니다."
                        ),
                    )
                    sub_context.record_trajectory(f"[{flow_name}] {orig_label}(그룹건너뛰기➔{g_label} 탈출)")
                    current_node_id = self.find_group_exit_node(nid, group_id, node_map, outgoing_edges)
                    continue
                elif g_mode == "catch_subflow":
                    catch_flow_id = str(g_cfg.get("catch_subflow_id") or "").strip()
                    c_ok, c_err = await self._execute_error_handler_subflow(
                        target_flow_id=catch_flow_id,
                        caller_node_id=group_id,
                        caller_label=f"그룹 Catch: {g_label}",
                        parent_context=sub_context,
                    )
                    if c_ok:
                        sub_context.record_trajectory(f"[{flow_name}] {orig_label}(그룹Catch복구➔{g_label} 탈출)")
                        current_node_id = self.find_group_exit_node(nid, group_id, node_map, outgoing_edges)
                        continue
                    err_msg = c_err or err_msg

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
        event_callback: Callable[[Dict[str, Any]], Awaitable[None]],
        flow_description: str = "",
    ) -> ExecutionSession:
        """단일 Flow 상태 포인터 그래프 탐색 실행 및 실시간 DB 기록"""
        kill_switch.reset()
        self.active_runs[session_id] = True

        nodes_data = graph_data.get("nodes", [])
        edges_data = graph_data.get("edges", [])
        flow_settings = graph_data.get("settings") or {}
        raw_variables = graph_data.get("variables")
        resolved_flow_desc = str(flow_description or graph_data.get("description") or "").strip()

        # 워크플로우 실행 속도 (각 스킬 노드 실행 직전 고정 딜레이, 기본값 0.3초)
        try:
            execution_delay = max(0.0, float(flow_settings.get("execution_delay", 0.3)))
        except (ValueError, TypeError):
            execution_delay = 0.3

        ordered_nodes = self.get_execution_order(nodes_data, edges_data)
        node_map, outgoing_edges, start_node_id = self.build_graph_routing(nodes_data, edges_data)
        group_map = {
            n["id"]: n for n in nodes_data if n.get("type") == "flow_group" and n.get("id")
        }

        # 1. DB에 ExecutionSession 생성 및 설명 보완
        with Session(engine) as db:
            if not resolved_flow_desc and flow_id:
                flow_obj = db.get(Flow, flow_id)
                if flow_obj and flow_obj.description:
                    resolved_flow_desc = flow_obj.description

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
        error_emitted_node_ids = set()
        session_logs: List[Dict[str, Any]] = []

        async def internal_event_callback(event_payload: Dict[str, Any]):
            nonlocal msg_idx
            msg_idx += 1
            msg_id = f"msg_{session_id}_{msg_idx:04d}"

            # DB에 메시지 영구 저장 (스트리밍 청크는 너무 빈번하므로 제외하고 영구 저장)
            event_type = event_payload.get("event_type", "")
            if event_type == "ERROR" and event_payload.get("node_id"):
                error_emitted_node_ids.add(event_payload.get("node_id"))
            if event_type in ["START", "SUCCESS", "ERROR", "AGENT_TOOL_CALL", "AGENT_TOOL_RESULT", "AGENT_THINKING", "AGENT_STEP_START"]:
                session_logs.append({
                    "node_id": event_payload.get("node_id", ""),
                    "node_name": event_payload.get("node_name", ""),
                    "node_type": event_payload.get("node_type", "GENERAL"),
                    "event_type": event_type,
                    "content": event_payload.get("content", ""),
                })
                # 장기 실행(24시간 모니터링 루프 등) 시 인메모리 session_logs 폭증 방지 (최대 최근 500건 유지)
                if len(session_logs) > 500:
                    del session_logs[:-500]

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
                raw_max_steps = flow_settings.get("max_total_steps")
                if bool(flow_settings.get("unlimited_steps", False)):
                    max_total_steps = 0
                elif raw_max_steps is not None:
                    try:
                        max_total_steps = int(raw_max_steps)
                    except (ValueError, TypeError):
                        max_total_steps = 1000
                else:
                    max_total_steps = 1000

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
                    session_logs=session_logs,
                )

                current_node_id = start_node_id
                while current_node_id and current_node_id in node_map:
                    if context.is_cancelled():
                        overall_status = "CANCELLED"
                        break

                    node_data = node_map[current_node_id]
                    node_type = node_data.get("type", "")
                    nid = node_data.get("id", "")

                    if node_type == "flow_end":
                        break
                    if node_type in ("flow_start", "flow_group"):
                        current_node_id = self.resolve_next_node_id(nid, outgoing_edges, None, node_type)
                        continue

                    n_data = node_data.get("data", {}) or {}
                    orig_label = n_data.get("label", nid)
                    cfg = n_data.get("config", {}) or {}
                    group_id = str(cfg.get("group_id") or "").strip()

                    # 각 스킬 노드 실행 직전 누적 스텝 체크 및 고정 딜레이 적용
                    context.increment_and_check_step_limit()
                    if execution_delay > 0:
                        await self._sleep_interruptible(execution_delay, context.is_cancelled)
                        if context.is_cancelled():
                            overall_status = "CANCELLED"
                            break

                    result, retry_attempts = await self._run_node_with_retry(
                        node_data=node_data,
                        flow_settings=flow_settings,
                        context=context,
                        error_emitted_node_ids=error_emitted_node_ids,
                        label_prefix="",
                    )

                    if result and result.success:
                        next_handle = getattr(result, "next_handle", None)
                        if next_handle:
                            context.record_trajectory(f"{orig_label}({next_handle.upper()} 분기)")
                        else:
                            context.record_trajectory(orig_label)
                        current_node_id = self.resolve_next_node_id(nid, outgoing_edges, next_handle, node_type)
                        continue

                    # -----------------------------------------------------------
                    # 노드 실행 실패 시 3계층 예외처리 파이프라인 (그래프 포인터 전이 연동)
                    # -----------------------------------------------------------
                    if context.is_cancelled():
                        overall_status = "CANCELLED"
                        break

                    err_msg = getattr(result, "error", None) or "노드 실행에 실패했습니다."
                    context.set_variable("last_error_message", err_msg, is_system=True)
                    context.set_variable("last_error_node_id", nid, is_system=True)
                    context.set_variable("last_error_node_name", orig_label, is_system=True)

                    # [1단계] 개별 노드 '오류 무시 후 진행 (Continue On Error)'
                    if bool(cfg.get("continue_on_error", False)):
                        await internal_event_callback({
                            "node_id": nid,
                            "node_name": orig_label,
                            "node_type": "GENERAL",
                            "event_type": "SUCCESS",
                            "content": (
                                f"⏭️ [{orig_label}] 최종 오류가 발생했으나 "
                                f"'오류 무시 후 진행(Continue On Error)' 설정에 따라 다음 노드로 진행합니다. (사유: {err_msg})"
                            ),
                        })
                        context.record_trajectory(f"{orig_label}(오류무시)")
                        current_node_id = self.resolve_next_node_id(nid, outgoing_edges, None, node_type)
                        continue

                    # [2단계] 소속 그룹 노드 Try-Catch ('그룹 건너뛰기' / 'Catch 서브플로우 실행')
                    if group_id and group_id in group_map:
                        g_node = group_map[group_id]
                        g_data = g_node.get("data", {}) or {}
                        g_label = g_data.get("label", group_id)
                        g_cfg = g_data.get("config", {}) or {}
                        g_mode = self._resolve_group_error_mode(g_cfg)

                        if g_mode == "break_group":
                            await internal_event_callback({
                                "node_id": group_id,
                                "node_name": f"[그룹] {g_label}",
                                "node_type": "GENERAL",
                                "event_type": "START",
                                "content": (
                                    f"⏭️ [{g_label}] 하위 노드 '{orig_label}' 오류 발생 — "
                                    f"'그룹 건너뛰기(Break Group)'가 작동하여 그룹 내 나머지 노드를 모두 건너뛰고 그룹 다음 단계로 이동합니다."
                                ),
                            })
                            context.record_trajectory(f"{orig_label}(그룹건너뛰기➔{g_label} 탈출)")
                            current_node_id = self.find_group_exit_node(nid, group_id, node_map, outgoing_edges)
                            continue
                        elif g_mode == "catch_subflow":
                            catch_flow_id = str(g_cfg.get("catch_subflow_id") or "").strip()
                            c_ok, c_err = await self._execute_error_handler_subflow(
                                target_flow_id=catch_flow_id,
                                caller_node_id=group_id,
                                caller_label=f"그룹 Catch: {g_label}",
                                parent_context=context,
                            )
                            if c_ok:
                                context.record_trajectory(f"{orig_label}(그룹Catch복구➔{g_label} 탈출)")
                                current_node_id = self.find_group_exit_node(nid, group_id, node_map, outgoing_edges)
                                continue
                            err_msg = c_err or err_msg

                    # [3단계] 워크플로우 전역 에러 핸들러 ('워크플로우 실행' / '오류 복구 AI 에이전트 호출')
                    global_handler = (
                        flow_settings.get("global_error_handler")
                        or flow_settings.get("error_handler")
                    )
                    if not isinstance(global_handler, dict):
                        global_handler = {}
                    g_handler_mode = str(global_handler.get("mode") or "none").strip().lower()

                    if g_handler_mode == "subflow":
                        err_subflow_id = str(global_handler.get("error_subflow_id") or "").strip()
                        await self._execute_error_handler_subflow(
                            target_flow_id=err_subflow_id,
                            caller_node_id=nid,
                            caller_label="전역 오류 처리 워크플로우",
                            parent_context=context,
                        )
                        overall_status = "FAILED"
                        last_error_msg = err_msg
                        break

                    elif g_handler_mode == "self_healing_agent":
                        lookahead_str = self.build_downstream_lookahead(nid, node_map, outgoing_edges, max_depth=3)
                        healing_agent = build_self_healing_agent_node(
                            flow_name=flow_name,
                            flow_description=resolved_flow_desc,
                            ordered_nodes=ordered_nodes,
                            failed_node_data=node_data,
                            error_message=err_msg,
                            retry_attempts=retry_attempts,
                            session_logs=list(session_logs),
                            handler_config=global_handler,
                            flow_settings=flow_settings,
                            executed_trajectory=list(context.executed_trajectory),
                            downstream_lookahead=lookahead_str,
                        )
                        after_action = str(global_handler.get("after_agent_action") or "continue_next").strip().lower()
                        agent_res = await healing_agent.run(context)

                        if agent_res and agent_res.success:
                            if after_action == "continue_next":
                                await internal_event_callback({
                                    "node_id": healing_agent.id,
                                    "node_name": healing_agent.name,
                                    "node_type": "AGENT",
                                    "event_type": "SUCCESS",
                                    "content": (
                                        f"✅ [오류 복구 AI 에이전트] '{orig_label}' 오류 복구 완료 — "
                                        f"설정('원래 워크플로우의 다음 노드 실행')에 따라 다음 노드로 진행합니다."
                                    ),
                                })
                                context.record_trajectory(f"{orig_label}(AI자가복구 완료)")
                                current_node_id = self.resolve_next_node_id(nid, outgoing_edges, None, node_type)
                                continue
                            else:
                                await internal_event_callback({
                                    "node_id": healing_agent.id,
                                    "node_name": healing_agent.name,
                                    "node_type": "AGENT",
                                    "event_type": "SUCCESS",
                                    "content": (
                                        f"🛑 [오류 복구 AI 에이전트] '{orig_label}' 오류 조치 완료 — "
                                        f"설정('워크플로우 종료')에 따라 워크플로우를 종료합니다."
                                    ),
                                })
                                overall_status = "FAILED"
                                last_error_msg = err_msg
                                break
                        else:
                            agent_err = getattr(agent_res, "error", None) or "오류 복구 AI 에이전트 실행 실패"
                            overall_status = "FAILED"
                            last_error_msg = f"{err_msg} (복구 에이전트 실패: {agent_err})"
                            break

                    overall_status = "FAILED"
                    last_error_msg = err_msg
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
