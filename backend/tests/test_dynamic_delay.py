import pytest
import asyncio
from unittest.mock import patch, MagicMock
from app.nodes.general import GeneralNode
from app.nodes.base import ExecutionContext
from app.services.uia_service import uia_service

@pytest.fixture
def mock_context():
    events = []
    async def mock_callback(event):
        events.append(event)

    context = ExecutionContext(
        session_id="test_ses_dynamic_delay",
        event_callback=mock_callback,
        check_cancelled=lambda: False,
        variables={}
    )
    return context

@pytest.mark.asyncio
async def test_manual_delay_backward_compatibility(mock_context):
    """동적 대기 Off (수동 대기) 시 기존 방식대로 정상 대기 완료 검증"""
    with patch("app.services.screen_capture.screen_capture_service.capture", return_value="/test.webp"):
        node = GeneralNode(
            id="delay_1",
            name="수동 대기",
            subtype="delay",
            config={
                "dynamic_wait": False,
                "seconds": 0.2
            }
        )
        result = await node.run(mock_context)
        assert result.success is True
        assert "Waited 0.2 seconds" in result.output

@pytest.mark.asyncio
async def test_dynamic_delay_partial_loading_uia_success(mock_context):
    """동적 대기 On - 부분로딩 모드: UIA 컨트롤 감지 시 즉시 성공 반환 검증"""
    with patch.object(uia_service, "find_control", return_value=(250, 400)) as mock_find, \
         patch("app.services.screen_capture.screen_capture_service.capture", return_value="/test.webp"):

        node = GeneralNode(
            id="delay_2",
            name="동적 대기 (부분로딩)",
            subtype="delay",
            config={
                "dynamic_wait": True,
                "wait_mode": "element",
                "seconds": 2.0,
                "object_data": {
                    "name": "저장 버튼",
                    "control_type": "Button",
                    "automation_id": "btnSave"
                },
                "fail_on_timeout": True
            }
        )
        result = await node.run(mock_context)
        assert result.success is True
        assert "동적 대기 성공: 부분로딩 대기" in result.output
        assert "저장 버튼" in result.output
        assert "UIA 객체 일치" in result.output

@pytest.mark.asyncio
async def test_dynamic_delay_partial_loading_image_success(mock_context):
    """동적 대기 On - 부분로딩 모드: UIA 미검출 시 이미지 매칭 성공 검증"""
    with patch.object(uia_service, "find_control", return_value=None), \
         patch("app.nodes.general.load_template_image", return_value=(MagicMock(), "아이콘")), \
         patch("app.nodes.general.find_image_on_screen", return_value=(300, 500, 0.95)), \
         patch("app.services.screen_capture.screen_capture_service.capture", return_value="/test.webp"):

        node = GeneralNode(
            id="delay_3",
            name="동적 대기 (이미지 매칭)",
            subtype="delay",
            config={
                "dynamic_wait": True,
                "wait_mode": "element",
                "seconds": 2.0,
                "object_data": {
                    "name": "아이콘",
                    "image_url": "test.png"
                },
                "fail_on_timeout": True
            }
        )
        result = await node.run(mock_context)
        assert result.success is True
        assert "동적 대기 성공: 부분로딩 대기" in result.output
        assert "이미지 일치: 95.0%" in result.output

@pytest.mark.asyncio
async def test_dynamic_delay_window_ready_success(mock_context):
    """동적 대기 On - 완전로딩 모드: 대상 윈도우 Idle 및 UI 오브젝트 로딩 완료 검증"""
    with patch.object(uia_service, "find_window_target", return_value=(999, "계산기")), \
         patch.object(uia_service, "is_window_idle", return_value=True) as mock_idle, \
         patch.object(uia_service, "find_control", return_value=(100, 200)), \
         patch("app.services.screen_capture.screen_capture_service.capture", return_value="/test.webp"):

        node = GeneralNode(
            id="delay_4",
            name="동적 대기 (완전로딩)",
            subtype="delay",
            config={
                "dynamic_wait": True,
                "wait_mode": "window_ready",
                "seconds": 2.0,
                "object_data": {
                    "name": "계산기 버튼",
                    "window_title": "계산기"
                },
                "post_delay": 0.05,
                "fail_on_timeout": True
            }
        )
        result = await node.run(mock_context)
        assert result.success is True
        assert "동적 대기 성공: 완전로딩 대기" in result.output
        assert "안정 지연 +0.05초" in result.output
        mock_idle.assert_called_with(999)

@pytest.mark.asyncio
async def test_dynamic_delay_timeout_fail(mock_context):
    """동적 대기 On - 타임아웃 발생 시 fail_on_timeout: True일 때 실패/중단 처리 검증"""
    with patch.object(uia_service, "find_control", return_value=None), \
         patch("app.nodes.general.load_template_image", return_value=(None, "미검출버튼")):

        node = GeneralNode(
            id="delay_5",
            name="동적 대기 타임아웃 실패",
            subtype="delay",
            config={
                "dynamic_wait": True,
                "wait_mode": "element",
                "seconds": 0.2,
                "object_data": {
                    "name": "미검출버튼"
                },
                "fail_on_timeout": True
            }
        )
        result = await node.run(mock_context)
        assert result.success is False
        assert "동적 대기 타임아웃" in result.error
        assert "미검출버튼" in result.error

@pytest.mark.asyncio
async def test_dynamic_delay_timeout_continue(mock_context):
    """동적 대기 On - 타임아웃 발생 시 fail_on_timeout: False일 때 다음 노드 계속 진행 검증"""
    with patch.object(uia_service, "find_control", return_value=None), \
         patch("app.nodes.general.load_template_image", return_value=(None, "선택적오브젝트")), \
         patch("app.services.screen_capture.screen_capture_service.capture", return_value="/test.webp"):

        node = GeneralNode(
            id="delay_6",
            name="동적 대기 타임아웃 통과",
            subtype="delay",
            config={
                "dynamic_wait": True,
                "wait_mode": "element",
                "seconds": 0.2,
                "object_data": {
                    "name": "선택적오브젝트"
                },
                "fail_on_timeout": False
            }
        )
        result = await node.run(mock_context)
        assert result.success is True
        assert "동적 대기 타임아웃 무시" in result.output
        assert "다음 노드를 계속 진행합니다" in result.output

@pytest.mark.asyncio
async def test_find_control_signature_with_max_search_seconds(mock_context):
    """uia_service.find_control 실제 메서드가 max_search_seconds 인자를 정상 수용하는지 검증 (Mocking 없이 호출)"""
    # 실제 uia_service.find_control 호출 시 unexpected keyword argument 예외가 발생하지 않아야 함
    pos = uia_service.find_control(
        name="NonExistentControl_Test_12345",
        control_type="Button",
        automation_id="btnTest",
        orig_name="NonExistentControl",
        window_title="NonExistentWindow",
        class_name="NonExistentClass",
        max_search_seconds=0.01
    )
    # 미존재 요소이므로 None 반환되어야 하며 TypeError 예외가 발생하지 않아야 함
    assert pos is None

