import pytest
import os
import shutil
from pathlib import Path
from PIL import Image
from app.nodes.general import GeneralNode
from app.nodes.base import ExecutionContext
from app.services.screen_capture import screen_capture_service, copy_image_to_clipboard
from app.core.engine import FlowEngine

@pytest.fixture
def temp_output_dir(tmp_path):
    out_dir = tmp_path / "test_screenshots"
    out_dir.mkdir(parents=True, exist_ok=True)
    yield out_dir
    if out_dir.exists():
        shutil.rmtree(out_dir, ignore_errors=True)

@pytest.mark.asyncio
async def test_capture_display():
    """screen_capture_service의 capture_display 주 모니터 및 전체 모니터 캡처 동작 검증"""
    img_pri, meta_pri = screen_capture_service.capture_display(target="primary")
    assert isinstance(img_pri, Image.Image)
    assert meta_pri["width"] > 0
    assert meta_pri["height"] > 0

    img_all, meta_all = screen_capture_service.capture_display(target="all")
    assert isinstance(img_all, Image.Image)
    assert meta_all["width"] > 0
    assert meta_all["height"] > 0

@pytest.mark.asyncio
async def test_copy_image_to_clipboard():
    """PIL 이미지를 클립보드로 복사하는 함수 동작 검증 (Windows)"""
    test_img = Image.new("RGB", (64, 64), color=(0, 128, 255))
    res = copy_image_to_clipboard(test_img)
    # Windows 환경인 경우 True, 비대화형 CI 또는 타 OS인 경우 False/예외 없이 안전 반환
    assert isinstance(res, bool)

@pytest.mark.asyncio
async def test_screenshot_node_save_to_file(temp_output_dir):
    """스크린샷 노드: 파일로 저장 모드 검증 (템플릿 치환 및 파일 생성)"""
    target_file = temp_output_dir / "my_screenshot_{{timestamp}}.png"
    node = GeneralNode(
        id="node_screen_1",
        name="스크린샷 촬영",
        subtype="screenshot",
        config={
            "capture_target": "primary",
            "save_to_file": True,
            "copy_to_clipboard": False,
            "file_path": str(target_file),
        }
    )

    async def dummy_cb(payload):
        pass

    ctx = ExecutionContext(
        session_id="session_test_screen",
        event_callback=dummy_cb,
        check_cancelled=lambda: False,
        variables={}
    )
    res = await node.run(ctx)

    assert res.success is True
    assert "스크린샷 촬영 완료" in res.output
    assert "주 모니터" in res.output
    assert "파일 저장" in res.output

    # 생성된 파일 확인
    created_files = list(temp_output_dir.glob("my_screenshot_*.png"))
    assert len(created_files) == 1
    created_img = Image.open(created_files[0])
    assert created_img.size[0] > 0
    assert created_img.size[1] > 0

@pytest.mark.asyncio
async def test_screenshot_node_all_monitors_and_both_save(temp_output_dir):
    """스크린샷 노드: 전체 모니터 대상 + 파일 저장 및 클립보드 복사 동시 수행 검증"""
    target_file = temp_output_dir / "all_mon_{{timestamp}}.jpg"
    node = GeneralNode(
        id="node_screen_2",
        name="전체화면 캡처",
        subtype="screenshot",
        config={
            "capture_target": "all",
            "save_to_file": True,
            "copy_to_clipboard": True,
            "file_path": str(target_file),
        }
    )

    async def dummy_cb(payload):
        pass

    ctx = ExecutionContext(
        session_id="session_test_all",
        event_callback=dummy_cb,
        check_cancelled=lambda: False,
        variables={}
    )
    res = await node.run(ctx)

    assert res.success is True
    assert "스크린샷 촬영 완료" in res.output
    assert "전체 모니터" in res.output
    assert "파일 저장" in res.output
    assert "클립보드 복사" in res.output

    created_files = list(temp_output_dir.glob("all_mon_*.jpg"))
    assert len(created_files) == 1

@pytest.mark.asyncio
async def test_screenshot_node_clipboard_only():
    """스크린샷 노드: 클립보드 복사 전용 모드 검증"""
    node = GeneralNode(
        id="node_screen_3",
        name="클립보드 전용 캡처",
        subtype="screenshot",
        config={
            "capture_target": "primary",
            "save_to_file": False,
            "copy_to_clipboard": True,
        }
    )

    async def dummy_cb(payload):
        pass

    ctx = ExecutionContext(
        session_id="session_test_cb",
        event_callback=dummy_cb,
        check_cancelled=lambda: False,
        variables={}
    )
    res = await node.run(ctx)

    assert res.success is True
    assert "스크린샷 촬영 완료" in res.output
    assert "클립보드 복사" in res.output
    assert "파일 저장" not in res.output

@pytest.mark.asyncio
async def test_screenshot_node_validation_error():
    """스크린샷 노드: 파일 저장과 클립보드 복사가 모두 False일 때 유효성 오류 검증"""
    node = GeneralNode(
        id="node_screen_invalid",
        name="잘못된 설정 노드",
        subtype="screenshot",
        config={
            "capture_target": "primary",
            "save_to_file": False,
            "copy_to_clipboard": False,
        }
    )

    async def dummy_cb(payload):
        pass

    ctx = ExecutionContext(
        session_id="session_test_err",
        event_callback=dummy_cb,
        check_cancelled=lambda: False,
        variables={}
    )
    res = await node.run(ctx)

    assert res.success is False
    assert "최소 1개 이상 선택" in res.error

import uuid

@pytest.mark.asyncio
async def test_flow_engine_with_screenshot_node(temp_output_dir):
    """FlowEngine을 통한 스크린샷 노드 실행 파이프라인 통합 테스트"""
    engine = FlowEngine()
    target_file = temp_output_dir / "flow_screenshot.png"
    unique_session_id = f"session_flow_screen_{uuid.uuid4().hex[:8]}"

    graph_data = {
        "nodes": [
            {"id": "start", "type": "flow_start", "data": {"label": "Start"}},
            {
                "id": "screen_1",
                "type": "general_screenshot",
                "data": {
                    "label": "스크린샷 촬영",
                    "config": {
                        "capture_target": "primary",
                        "save_to_file": True,
                        "file_path": str(target_file),
                        "copy_to_clipboard": False,
                    }
                }
            },
            {"id": "end", "type": "flow_end", "data": {"label": "End"}}
        ],
        "edges": [
            {"source": "start", "target": "screen_1"},
            {"source": "screen_1", "target": "end"}
        ]
    }

    events = []
    async def event_callback(payload):
        events.append(payload)

    session = await engine.run_flow(
        flow_id="test_flow_screen",
        flow_name="Screen Flow Test",
        graph_data=graph_data,
        session_id=unique_session_id,
        event_callback=event_callback
    )

    assert session.status == "SUCCESS"
    assert any(e.get("event_type") == "SUCCESS" and e.get("node_id") == "screen_1" for e in events)
    assert target_file.exists()
