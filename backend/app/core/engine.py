import json
import asyncio
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Callable, Awaitable
from sqlmodel import Session, select
from app.core.database import engine
from app.core.config import settings
from app.core.kill_switch import kill_switch
from app.models.session import ExecutionSession
from app.models.message import ExecutionMessage
from app.nodes.base import BaseNode, ExecutionContext, NodeResult
from app.nodes.general import GeneralNode
from app.nodes.ai import AINode
from app.nodes.agent import AgentNode

class PassthroughNode(BaseNode):
    def __init__(self, id: str, name: str, config: Optional[Dict[str, Any]] = None):
        super().__init__(id=id, name=name, node_type="MARKER", config=config or {})

    async def run(self, context: ExecutionContext) -> NodeResult:
        """시작/끝 마커 노드는 어떠한 대기나 외부 조작 없이 즉시 통과"""
        return NodeResult(success=True, output=None)

class FlowEngine:
    def __init__(self):
        self.active_runs: Dict[str, bool] = {}

    def instantiate_node(self, node_data: Dict[str, Any]) -> BaseNode:
        node_id = node_data.get("id", "")
        node_type = node_data.get("type", "")
        data = node_data.get("data", {})
        label = data.get("label", node_id)
        config = data.get("config", {})

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

        context = ExecutionContext(
            session_id=session_id,
            event_callback=internal_event_callback,
            check_cancelled=lambda: kill_switch.is_cancelled() or not self.active_runs.get(session_id, False),
            variables={}
        )

        overall_status = "SUCCESS"

        try:
            for node_data in ordered_nodes:
                if context.is_cancelled():
                    overall_status = "CANCELLED"
                    break

                node_instance = self.instantiate_node(node_data)
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
