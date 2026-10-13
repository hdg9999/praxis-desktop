import pytest
from unittest.mock import patch, MagicMock
from PIL import Image, ImageDraw
import io
import base64
import numpy as np

from app.nodes.general import GeneralNode
from app.nodes.base import ExecutionContext
from app.services.uia_picker_worker import UIAPickerWorker

@pytest.fixture
def dummy_context():
    context = MagicMock(spec=ExecutionContext)
    context.session_id = "test_ses_hybrid"
    context.variables = {}
    context.is_cancelled.return_value = False
    context.emit_event = MagicMock()
    return context

@pytest.mark.asyncio
async def test_hybrid_click_stage1_uia_success(dummy_context):
    """1단계: UIA 객체 일치 발견 시 즉시 클릭 테스트"""
    node = GeneralNode(
        id="test_hybrid_stage1",
        name="하이브리드 UIA 1단계",
        subtype="mouse_click",
        config={
            "click_mode": "object",
            "search_mode": "hybrid",
            "object_data": {
                "name": "도전만화",
                "orig_name": "도전만화",
                "control_type": "HyperlinkControl",
                "automation_id": "btn_comic",
                "window_title": "네이버 웹툰",
                "class_name": "Chrome_RenderWidgetHostHWND",
                "x": 600,
                "y": 200,
                "width": 90,
                "height": 50,
                "image_url": "/api/static/objects/fake.png"
            },
            "button": "left",
            "clicks": 1
        }
    )

    with patch("app.services.uia_service.uia_service.find_control", return_value=(645, 225)) as mock_find, \
         patch("pyautogui.click") as mock_click:

        result = await node.execute_action(dummy_context)
        assert "[하이브리드 1단계: UIA 객체 일치]" in result
        assert "도전만화" in result
        mock_find.assert_called_once_with(
            name="도전만화",
            control_type="HyperlinkControl",
            automation_id="btn_comic",
            orig_name="도전만화",
            window_title="네이버 웹툰",
            class_name="Chrome_RenderWidgetHostHWND",
            auto_focus_scroll=True
        )
        mock_click.assert_called_once_with(x=645, y=225, button="left", clicks=1)

@pytest.mark.asyncio
async def test_hybrid_click_stage2_image_fallback_success(dummy_context):
    """2단계: UIA 미검출 시 2단계 이미지 템플릿 매칭으로 전환하여 클릭 테스트"""
    img = Image.new("RGB", (30, 30), color=(240, 240, 240))
    draw = ImageDraw.Draw(img)
    draw.rectangle((5, 5, 25, 25), fill=(0, 200, 0))

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64_str = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()

    node = GeneralNode(
        id="test_hybrid_stage2",
        name="하이브리드 이미지 2단계",
        subtype="mouse_click",
        config={
            "click_mode": "object",
            "search_mode": "hybrid",
            "object_data": {
                "name": "초록 사각형 버튼",
                "orig_name": "초록 사각형 버튼",
                "base64_image": b64_str,
                "x": 100,
                "y": 100,
                "width": 30,
                "height": 30
            },
            "confidence": 0.8,
            "timeout": 0.5,
            "button": "left",
            "clicks": 1
        }
    )

    # 화면의 (200, 300) 위치에 템플릿 이미지 존재
    big_screen = Image.new("RGB", (600, 600), color=(10, 10, 10))
    big_screen.paste(img, (200, 300))

    with patch("app.services.uia_service.uia_service.find_control", return_value=None), \
         patch("app.services.screen_capture.screen_capture_service.capture_image", return_value=(big_screen, 600, 600)), \
         patch("pyautogui.click") as mock_click:

        result = await node.execute_action(dummy_context)
        assert "[하이브리드 2단계: 이미지 일치]" in result
        assert "초록 사각형 버튼" in result
        # 200 + 15 = 215, 300 + 15 = 315
        mock_click.assert_called_once_with(x=215, y=315, button="left", clicks=1)

def test_picker_worker_hide_overlay_broadcast():
    """크롭 캡처 직전 하이라이트 은닉 브로드캐스트 이벤트 발행 테스트"""
    worker = UIAPickerWorker()
    broadcast_events = []

    def mock_broadcast(msg):
        broadcast_events.append(msg)

    loop = MagicMock()
    loop.is_running.return_value = False
    worker._broadcast_func = mock_broadcast
    worker._safe_broadcast = lambda msg: broadcast_events.append(msg)

    fake_elem = {
        "name": "확인 버튼",
        "orig_name": "확인 버튼",
        "control_type": "ButtonControl",
        "class_name": "Button",
        "automation_id": "btn_ok",
        "window_title": "테스트 윈도우",
        "x": 100,
        "y": 100,
        "width": 50,
        "height": 30
    }

    with patch("app.services.uia_service.uia_service.capture_rect", return_value={"object_id": "obj_test", "image_url": "/fake.png"}), \
         patch("time.sleep"):
        worker._current_element = fake_elem
        worker._handle_click(125, 115)

    assert len(broadcast_events) >= 2
    # 첫 번째: 하이라이트 은닉 이벤트
    assert broadcast_events[0]["type"] == "picker_hide_overlay"
    # 두 번째: 선택 완료 이벤트 (메타데이터 포함)
    assert broadcast_events[1]["type"] == "picker_selected"
    data = broadcast_events[1]["data"]
    assert data["name"] == "확인 버튼"
    assert data["window_title"] == "테스트 윈도우"
    assert data["automation_id"] == "btn_ok"

@pytest.mark.asyncio
async def test_hybrid_click_auto_focus_scroll_disabled(dummy_context):
    """사용자가 auto_focus_scroll=False 로 비활성화한 경우 정상 반영 검증"""
    node = GeneralNode(
        id="test_hybrid_no_scroll",
        name="하이브리드 스크롤 비활성화",
        subtype="mouse_click",
        config={
            "click_mode": "object",
            "search_mode": "hybrid",
            "auto_focus_scroll": False,
            "object_data": {
                "name": "설정",
                "control_type": "ButtonControl"
            }
        }
    )

    with patch("app.services.uia_service.uia_service.find_control", return_value=(300, 400)) as mock_find, \
         patch("pyautogui.click") as mock_click:

        result = await node.execute_action(dummy_context)
        assert "설정" in result
        mock_find.assert_called_once_with(
            name="설정",
            control_type="ButtonControl",
            automation_id=None,
            orig_name=None,
            window_title=None,
            class_name=None,
            auto_focus_scroll=False
        )
        mock_click.assert_called_once_with(x=300, y=400, button="left", clicks=1)

@pytest.mark.asyncio
async def test_image_only_mode_skips_uia(dummy_context):
    """이미지 일치 전용 모드(image_only) 시 UIA 탐색 및 포커싱을 건너뛰는지 검증"""
    img = Image.new("RGB", (30, 30), color=(240, 240, 240))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64_str = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()

    node = GeneralNode(
        id="test_image_only_mode",
        name="이미지 일치 전용 모드",
        subtype="mouse_click",
        config={
            "click_mode": "object",
            "search_mode": "image_only",
            "object_data": {
                "name": "이미지버튼",
                "base64_image": b64_str,
                "x": 100,
                "y": 100,
                "width": 30,
                "height": 30
            },
            "confidence": 0.8,
            "timeout": 0.5,
            "button": "left",
            "clicks": 1
        }
    )

    big_screen = Image.new("RGB", (600, 600), color=(10, 10, 10))
    big_screen.paste(img, (200, 300))

    with patch("app.services.uia_service.uia_service.find_control") as mock_find, \
         patch("app.services.screen_capture.screen_capture_service.capture_image", return_value=(big_screen, 600, 600)), \
         patch("pyautogui.click") as mock_click:

        result = await node.execute_action(dummy_context)
        assert "[하이브리드 2단계: 이미지 일치]" in result
        assert "이미지버튼" in result
        mock_find.assert_not_called()
        mock_click.assert_called_once_with(x=215, y=315, button="left", clicks=1)

def test_bring_control_into_view_unit():
    """UIAService.bring_control_into_view의 패턴 탐색 및 SetFocus 동작 검증"""
    from app.services.uia_service import uia_service
    
    mock_ctrl = MagicMock()
    mock_top = MagicMock()
    mock_top.NativeWindowHandle = 12345
    mock_ctrl.GetTopLevelControl.return_value = mock_top
    
    mock_pattern = MagicMock()
    mock_ctrl.GetPattern.return_value = mock_pattern
    
    mock_rect = MagicMock()
    mock_rect.width.return_value = 100
    mock_rect.height.return_value = 50
    mock_rect.left = 200
    mock_rect.top = 300
    mock_ctrl.BoundingRectangle = mock_rect

    with patch.object(uia_service, "activate_window") as mock_activate, \
         patch("time.sleep"):
        pos = uia_service.bring_control_into_view(mock_ctrl)
        
        assert pos == (250, 325)
        mock_activate.assert_called_once_with(12345)
        mock_pattern.ScrollIntoView.assert_called_once_with(waitTime=0.05)
        mock_ctrl.SetFocus.assert_called_once()

