import pytest
from unittest.mock import patch, MagicMock
from PIL import Image
import numpy as np
import io
import base64

from app.nodes.general import GeneralNode, load_template_image
from app.nodes.base import ExecutionContext
from app.api.picker_api import detect_element_at_point, crop_element, capture_for_picker, DetectElementRequest, CropElementRequest

@pytest.fixture
def dummy_context():
    context = MagicMock(spec=ExecutionContext)
    context.session_id = "test_ses_001"
    context.variables = {}
    context.is_cancelled.return_value = False
    context.emit_event = MagicMock()
    return context

def test_picker_capture_and_crop(tmp_path):
    # 1. 캡처 API 테스트
    capture_res = capture_for_picker()
    assert capture_res.width > 0
    assert capture_res.height > 0
    assert capture_res.image_url.startswith("/api/static/objects/")
    assert capture_res.base64_image.startswith("data:image/webp;base64,")

    # 2. 엘리먼트 감지 API 테스트
    detect_res = detect_element_at_point(DetectElementRequest(x=100, y=100))
    assert detect_res.width > 0
    assert detect_res.height > 0

    # 3. 크롭 API 테스트
    crop_res = crop_element(CropElementRequest(
        x=50,
        y=50,
        width=120,
        height=60,
        name="테스트 버튼"
    ))
    assert crop_res.name == "테스트 버튼"
    assert crop_res.width == 120
    assert crop_res.height == 60
    assert crop_res.image_url.startswith("/api/static/objects/")
    assert crop_res.base64_image.startswith("data:image/png;base64,")

@pytest.mark.asyncio
async def test_general_node_object_click_success(dummy_context):
    from PIL import ImageDraw
    # 30x30 크기의 패턴이 있는 템플릿 이미지 생성 (Base64)
    img = Image.new("RGB", (30, 30), color=(240, 240, 240))
    draw = ImageDraw.Draw(img)
    draw.rectangle((5, 5, 25, 25), fill=(255, 0, 0))
    draw.line((0, 0, 30, 30), fill=(0, 0, 255))

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64_str = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()

    node = GeneralNode(
        id="test_click_obj",
        name="오브젝트 마우스 클릭",
        subtype="mouse_click",
        config={
            "click_mode": "object",
            "object_data": {
                "name": "빨간 사각형 버튼",
                "base64_image": b64_str,
                "x": 100,
                "y": 100,
                "width": 30,
                "height": 30
            },
            "confidence": 0.8,
            "timeout": 1.0,
            "button": "left",
            "clicks": 1
        }
    )

    # 화면에 해당 이미지가 (150, 200) 위치에 삽입되도록 mock 설정
    big_screen = Image.new("RGB", (500, 500), color=(30, 30, 30))
    big_screen.paste(img, (150, 200))

    with patch("app.services.screen_capture.screen_capture_service.capture_image", return_value=(big_screen, 500, 500)), \
         patch("pyautogui.click") as mock_click:
        
        result_output = await node.execute_action(dummy_context)
        assert "성공" in result_output
        assert "빨간 사각형 버튼" in result_output
        # 중심 좌표: 150 + 15 = 165, 200 + 15 = 215
        mock_click.assert_called_once_with(x=165, y=215, button="left", clicks=1)

@pytest.mark.asyncio
async def test_general_node_object_click_fallback(dummy_context):
    from PIL import ImageDraw
    # 패턴 있는 이미지
    img = Image.new("RGB", (30, 30), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    draw.rectangle((5, 5, 25, 25), fill=(255, 0, 0))

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64_str = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()

    node = GeneralNode(
        id="test_click_fallback",
        name="폴백 클릭 테스트",
        subtype="mouse_click",
        config={
            "click_mode": "object",
            "object_data": {
                "name": "미존재 버튼",
                "base64_image": b64_str,
                "x": 80,
                "y": 90,
                "width": 40,
                "height": 20
            },
            "confidence": 0.95,
            "timeout": 0.3,
            "fallback_to_coords": True,
            "button": "left",
            "clicks": 1
        }
    )

    # 템플릿과 전혀 다른 화면 (파란색 단색 화면)
    blue_screen = Image.new("RGB", (300, 300), color=(0, 0, 200))

    with patch("app.services.screen_capture.screen_capture_service.capture_image", return_value=(blue_screen, 300, 300)), \
         patch("pyautogui.click") as mock_click:
        
        result_output = await node.execute_action(dummy_context)
        assert "폴백 클릭 완료" in result_output
        # 폴백 좌표: 80 + 20 = 100, 90 + 10 = 100
        mock_click.assert_called_once_with(x=100, y=100, button="left", clicks=1)
