import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi.testclient import TestClient
from app.main import app
from app.core.config import settings
from app.nodes.general import GeneralNode
from app.nodes.ai import AINode
from app.nodes.base import ExecutionContext

client = TestClient(app)

def test_settings_api_capture_screen_flag():
    """Settings API에서 capture_screen_after_execution 조회 및 변경 검증"""
    # 1. GET 조회 시 기본값 확인
    res = client.get("/api/settings")
    assert res.status_code == 200
    data = res.json()
    assert "capture_screen_after_execution" in data
    assert data["capture_screen_after_execution"] is True

    try:
        # 2. POST로 False로 변경
        post_res = client.post("/api/settings", json={"capture_screen_after_execution": False})
        assert post_res.status_code == 200
        assert post_res.json()["capture_screen_after_execution"] is False
        assert settings.CAPTURE_SCREEN_AFTER_EXECUTION is False

        # 3. GET으로 반영 확인
        get_res = client.get("/api/settings")
        assert get_res.json()["capture_screen_after_execution"] is False
    finally:
        # 원래 값 복원
        client.post("/api/settings", json={"capture_screen_after_execution": True})
        assert settings.CAPTURE_SCREEN_AFTER_EXECUTION is True

@pytest.mark.asyncio
async def test_general_node_conditional_screenshot():
    """GeneralNode 실행 시 capture_screen_after_execution 플래그에 따른 조건부 캡처 검증"""
    events = []
    async def dummy_cb(event):
        events.append(event)

    ctx = ExecutionContext(
        session_id="ses_test_general_capture",
        event_callback=dummy_cb,
        check_cancelled=lambda: False
    )

    node = GeneralNode(
        id="n_delay_1",
        name="테스트 대기",
        subtype="delay",
        config={"seconds": 0.01}
    )

    # Case 1: CAPTURE_SCREEN_AFTER_EXECUTION = True -> 캡처 생성
    settings.CAPTURE_SCREEN_AFTER_EXECUTION = True
    events.clear()
    res_on = await node.run(ctx)
    assert res_on.success is True
    assert res_on.screenshot_url is not None
    assert "ses_test_general_capture" in res_on.screenshot_url
    # SUCCESS 이벤트에 image_path가 포함되어야 함
    success_events = [e for e in events if e["event_type"] == "SUCCESS"]
    assert len(success_events) == 1
    assert success_events[0]["image_path"] == res_on.screenshot_url

    # Case 2: CAPTURE_SCREEN_AFTER_EXECUTION = False -> 캡처 생략
    settings.CAPTURE_SCREEN_AFTER_EXECUTION = False
    events.clear()
    res_off = await node.run(ctx)
    assert res_off.success is True
    assert res_off.screenshot_url is None
    success_events = [e for e in events if e["event_type"] == "SUCCESS"]
    assert len(success_events) == 1
    assert success_events[0]["image_path"] is None

    # 원상 복구
    settings.CAPTURE_SCREEN_AFTER_EXECUTION = True

@pytest.mark.asyncio
async def test_ai_node_conditional_screenshot():
    """AINode 실행 시 capture_screen_after_execution 플래그에 따른 조건부 캡처 검증"""
    events = []
    async def dummy_cb(event):
        events.append(event)

    ctx = ExecutionContext(
        session_id="ses_test_ai_capture",
        event_callback=dummy_cb,
        check_cancelled=lambda: False
    )

    node = AINode(
        id="n_ai_1",
        name="테스트 AI",
        config={"model": "llama3", "prompt": "안녕"}
    )

    # ollama 스트리밍 mock
    async def mock_stream(*args, **kwargs):
        yield "테스트 "
        yield "답변입니다."

    with patch("app.nodes.ai.ollama_client.stream_generate", side_effect=mock_stream):
        # Case 1: On -> 실행 전/후 캡처 생성
        settings.CAPTURE_SCREEN_AFTER_EXECUTION = True
        events.clear()
        res_on = await node.run(ctx)
        assert res_on.success is True
        assert res_on.screenshot_url is not None
        start_events = [e for e in events if e["event_type"] == "START"]
        success_events = [e for e in events if e["event_type"] == "SUCCESS"]
        assert len(start_events) == 1
        assert start_events[0]["image_path"] is not None
        assert len(success_events) == 1
        assert success_events[0]["image_path"] == res_on.screenshot_url

        # Case 2: Off -> 실행 전/후 캡처 생략
        settings.CAPTURE_SCREEN_AFTER_EXECUTION = False
        events.clear()
        res_off = await node.run(ctx)
        assert res_off.success is True
        assert res_off.screenshot_url is None
        start_events = [e for e in events if e["event_type"] == "START"]
        success_events = [e for e in events if e["event_type"] == "SUCCESS"]
        assert len(start_events) == 1
        assert start_events[0]["image_path"] is None
        assert len(success_events) == 1
        assert success_events[0]["image_path"] is None

    # 원상 복구
    settings.CAPTURE_SCREEN_AFTER_EXECUTION = True
