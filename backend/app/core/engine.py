import json
import asyncio
import re
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Callable, Awaitable, Tuple
from sqlmodel import Session, select
from app.core.database import engine
from app.core.config import settings
from app.core.kill_switch import kill_switch
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
        """시작/끝 마커 노드는 어떠한 대기나 외부 조작 없이 즉시 통과"""
        return NodeResult(success=True, output=None)


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

        if node_type in ["flow_start", "flow_end"]:
            return PassthroughNode(id=node_id, name=label, config=config)
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
            if node_type in ("flow_start", "flow_end"):
                continue

            data = node.get("data", {}) or {}
            label = data.get("label", node_id)
            config = data.get("config", {}) or {}

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
        """Left-to-Right 엣지 연결에 따른 순차 실행 순서 결정 (위상 정렬 기반)"""
        node_map = {n["id"]: n for n in nodes}
        in_degree = {n["id"]: 0 for n in nodes}
        adj: Dict[str, List[str]] = {n["id"]: [] for n in nodes}

        for edge in edges:
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
        start_nodes = [n for n in nodes if n.get("type") == "flow_start"]
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
        for n in nodes:
            if n["id"] not in visited:
                ordered_nodes.append(n)

        return ordered_nodes

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
                    await internal_event_callback({
                        "node_id": err_node_id,
                        "node_name": err_node_name,
                        "node_type": "GENERAL",
                        "event_type": "ERROR",
                        "content": f"❌ {err_text}",
                    })

            if overall_status == "SUCCESS":
                context = ExecutionContext(
                    session_id=session_id,
                    event_callback=internal_event_callback,
                    check_cancelled=lambda: kill_switch.is_cancelled() or not self.active_runs.get(session_id, False),
                    variables={},
                    variable_schemas=variable_schemas,
                    strict_variables=strict_variables,
                    flow_settings=flow_settings,
                )

                for node_data in ordered_nodes:
                    if context.is_cancelled():
                        overall_status = "CANCELLED"
                        break

                    # 각 스킬 노드 실행 직전 고정 딜레이 적용 (시작/끝 마커 노드는 제외)
                    node_type = node_data.get("type", "")
                    if node_type not in ("flow_start", "flow_end") and execution_delay > 0:
                        await self._sleep_interruptible(execution_delay, context.is_cancelled)
                        if context.is_cancelled():
                            overall_status = "CANCELLED"
                            break

                    node_instance = self.instantiate_node(node_data, flow_settings=flow_settings)
                    result: NodeResult = await node_instance.run(context)

                    if not result or not result.success:
                        overall_status = "FAILED"
                        err_msg = getattr(result, "error", None) or "노드 실행에 실패했습니다."
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
            print(f"Error during flow run: {e}")
            curr_node_id = node_data.get("id", "") if 'node_data' in locals() else ""
            curr_node_name = node_data.get("data", {}).get("label", "실행 노드") if 'node_data' in locals() else "엔진 오류"
            await internal_event_callback({
                "node_id": curr_node_id,
                "node_name": curr_node_name,
                "node_type": "GENERAL",
                "event_type": "ERROR",
                "content": f"❌ 노드 실행 중 치명적 예외 발생: {str(e)}"
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
                "event_type": "SESSION_FINISHED",
                "status": overall_status,
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
