import json
import asyncio
from datetime import datetime, timezone
from typing import Set, Dict, Any
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException, Depends, BackgroundTasks
from sqlmodel import Session
from app.core.database import get_session
from app.core.engine import flow_engine
from app.models.flow import Flow

router = APIRouter(tags=["Execution & WebSocket"])

class ConnectionManager:
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)

    async def broadcast(self, message: Dict[str, Any]):
        if not self.active_connections:
            return
        payload = json.dumps(message, ensure_ascii=False)
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_text(payload)
            except Exception:
                disconnected.append(connection)
        for dead in disconnected:
            self.disconnect(dead)

manager = ConnectionManager()

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # 클라이언트로부터 ping이나 메시지 수신 대기
            data = await websocket.receive_text()
            # 필요 시 클라이언트 요청 핸들링
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)

@router.post("/flows/{flow_id}/run")
async def trigger_run_flow(
    flow_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session)
):
    flow = db.get(Flow, flow_id)
    if not flow:
        raise HTTPException(status_code=404, detail="Flow를 찾을 수 없습니다.")

    graph_data = json.loads(flow.graph_data)
    session_id = f"ses_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}"

    async def run_flow_task():
        await flow_engine.run_flow(
            flow_id=flow.id,
            flow_name=flow.name,
            graph_data=graph_data,
            session_id=session_id,
            event_callback=manager.broadcast
        )

    # 비동기 백그라운드 태스크로 Flow 실행 시작
    asyncio.create_task(run_flow_task())

    return {
        "status": "STARTED",
        "session_id": session_id,
        "flow_id": flow.id,
        "flow_name": flow.name
    }

@router.post("/sessions/{session_id}/stop")
def stop_session(session_id: str):
    flow_engine.stop_session(session_id)
    return {"status": "STOP_REQUESTED", "session_id": session_id}
