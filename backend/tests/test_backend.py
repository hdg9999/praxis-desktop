import os
import json
import pytest
from pathlib import Path
from fastapi.testclient import TestClient
from sqlmodel import Session, select
from PIL import Image

from app.main import app
from app.core.config import settings
from app.core.database import engine, init_db
from app.services.screen_capture import screen_capture_service
from app.core.engine import flow_engine
from app.models.flow import Flow
from app.models.session import ExecutionSession
from app.models.message import ExecutionMessage
from app.nodes.general import render_template, GeneralNode
from app.nodes.base import ExecutionContext

client = TestClient(app)

@pytest.fixture(autouse=True)
def setup_db():
    init_db()

def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

def test_screen_capture_webp_80():
    session_id = "test_ses_screenshot"
    url = screen_capture_service.capture(session_id, label="test_unit")
    
    # URL 형식 확인
    assert url.startswith("/api/static/screenshots/test_ses_screenshot/")
    assert url.endswith(".webp")

    # 실제 파일 존재 여부 및 WebP 형식 검증
    filename = url.split("/")[-1]
    file_path = settings.SCREENSHOTS_DIR / session_id / filename
    assert file_path.exists()

    with Image.open(file_path) as img:
        assert img.format == "WEBP"
        assert img.width > 0
        assert img.height > 0

def test_template_rendering():
    variables = {"name": "홍길동", "city": "서울"}
    text = "안녕하세요 {{name}}님, {{city}} 날씨가 좋습니다."
    rendered = render_template(text, variables)
    assert rendered == "안녕하세요 홍길동님, 서울 날씨가 좋습니다."

def test_dag_topological_sort():
    nodes = [
        {"id": "node_c", "position": {"x": 300, "y": 100}},
        {"id": "node_a", "position": {"x": 100, "y": 100}},
        {"id": "node_b", "position": {"x": 200, "y": 100}},
    ]
    edges = [
        {"source": "node_a", "target": "node_b"},
        {"source": "node_b", "target": "node_c"},
    ]
    ordered = flow_engine.get_execution_order(nodes, edges)
    ordered_ids = [n["id"] for n in ordered]
    assert ordered_ids == ["node_a", "node_b", "node_c"]

@pytest.mark.asyncio
async def test_general_node_execution():
    events = []
    async def mock_callback(event):
        events.append(event)

    context = ExecutionContext(
        session_id="test_ses_gen",
        event_callback=mock_callback,
        check_cancelled=lambda: False,
        variables={}
    )

    node = GeneralNode(
        id="delay_1",
        name="테스트 대기 노드",
        subtype="delay",
        config={"seconds": 0.1}
    )

    result = await node.run(context)
    assert result.success is True
    assert len(events) == 2
    # 1) 시작 메시지
    assert events[0]["event_type"] == "START"
    assert events[0]["content"] == "테스트 대기 노드 실행"
    # 2) 성공 메시지 + 스크린샷
    assert events[1]["event_type"] == "SUCCESS"
    assert events[1]["content"] == "테스트 대기 노드 실행 성공"
    assert events[1]["image_path"] is not None

def test_flow_crud_api():
    # 1. Flow 생성
    create_payload = {
        "name": "테스트 자동화 Flow",
        "description": "설명입니다",
        "graph_data": {
            "nodes": [
                {"id": "n1", "type": "general_delay", "position": {"x": 50, "y": 50}, "data": {"label": "대기", "config": {"seconds": 0.1}}}
            ],
            "edges": []
        }
    }
    create_res = client.post("/api/flows", json=create_payload)
    assert create_res.status_code == 200
    created_data = create_res.json()
    flow_id = created_data["id"]
    assert created_data["name"] == "테스트 자동화 Flow"

    # 2. Flow 단일 조회
    get_res = client.get(f"/api/flows/{flow_id}")
    assert get_res.status_code == 200
    assert get_res.json()["id"] == flow_id

    # 3. Flow 수정
    update_res = client.put(f"/api/flows/{flow_id}", json={"name": "수정된 Flow"})
    assert update_res.status_code == 200
    assert update_res.json()["name"] == "수정된 Flow"

    # 4. Flow 삭제
    del_res = client.delete(f"/api/flows/{flow_id}")
    assert del_res.status_code == 200

    # 5. 삭제 후 조회 확인
    assert client.get(f"/api/flows/{flow_id}").status_code == 404

@pytest.mark.asyncio
async def test_start_end_marker_nodes_and_orphan_skip():
    """시작/끝 마커 노드의 Passthrough 동작 및 고립 노드 실행 제외 검증"""
    nodes = [
        {"id": "n_start", "type": "flow_start", "position": {"x": 50, "y": 100}, "data": {"label": "시작"}},
        {"id": "n_delay", "type": "general_delay", "position": {"x": 250, "y": 100}, "data": {"label": "대기", "config": {"seconds": 0.05}}},
        {"id": "n_end", "type": "flow_end", "position": {"x": 500, "y": 100}, "data": {"label": "끝"}},
        {"id": "n_orphan", "type": "general_delay", "position": {"x": 800, "y": 500}, "data": {"label": "고립 노드", "config": {"seconds": 1.0}}},
    ]
    edges = [
        {"id": "e1", "source": "n_start", "target": "n_delay"},
        {"id": "e2", "source": "n_delay", "target": "n_end"},
    ]

    # 1. 실행 순서 검증: 고립 노드는 제외되고 시작->대기->끝만 순서대로 반환
    ordered = flow_engine.get_execution_order(nodes, edges)
    ordered_ids = [n["id"] for n in ordered]
    assert ordered_ids == ["n_start", "n_delay", "n_end"]
    assert "n_orphan" not in ordered_ids

    # 2. PassthroughNode 동작 검증: 시작/끝 노드는 0ms만에 성공 반환
    start_instance = flow_engine.instantiate_node(nodes[0])
    end_instance = flow_engine.instantiate_node(nodes[2])
    assert type(start_instance).__name__ == "PassthroughNode"
    assert type(end_instance).__name__ == "PassthroughNode"

    dummy_context = ExecutionContext(
        session_id="ses_test_passthrough",
        event_callback=lambda p: None,
        check_cancelled=lambda: False,
        variables={}
    )
    start_res = await start_instance.run(dummy_context)
    end_res = await end_instance.run(dummy_context)
    assert start_res.success is True
    assert end_res.success is True

