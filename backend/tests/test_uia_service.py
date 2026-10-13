import pytest
from unittest.mock import patch, MagicMock
from app.services.uia_service import uia_service
from app.api.picker_api import detect_uia_element, capture_uia_element, UIADetectRequest, UIACaptureRequest
from app.nodes.general import GeneralNode
from app.nodes.base import ExecutionContext

@pytest.fixture
def dummy_context():
    context = MagicMock(spec=ExecutionContext)
    context.session_id = "test_ses_uia_001"
    context.variables = {}
    context.is_cancelled.return_value = False
    context.emit_event = MagicMock()
    return context

def test_uia_capture_rect():
    # 50, 50, 100, 40 물리 사각형 크롭 테스트
    res = uia_service.capture_rect(50, 50, 100, 40, "테스트 UIA 버튼")
    assert res is not None
    assert res["name"] == "테스트 UIA 버튼"
    assert res["width"] == 100
    assert res["height"] == 40
    assert res["image_url"].startswith("/api/static/objects/")
    assert res["base64_image"].startswith("data:image/png;base64,")

def test_uia_detect_api():
    # API 요청 엔드포인트 테스트
    req = UIADetectRequest(x=500, y=500)
    res = detect_uia_element(req)
    # found는 True이거나 False (데스크톱 상태에 따름), 타입 무결성 검증
    assert isinstance(res.found, bool)

    # 캡처 API 테스트
    cap_req = UIACaptureRequest(x=10, y=10, width=80, height=30, name="API 캡처")
    cap_res = capture_uia_element(cap_req)
    assert cap_res.name == "API 캡처"
    assert cap_res.width == 80
    assert cap_res.height == 30

@pytest.mark.asyncio
async def test_general_node_uia_direct_click(dummy_context):
    node = GeneralNode(
        id="test_click_uia",
        name="UIA 직접 클릭 노드",
        subtype="mouse_click",
        config={
            "click_mode": "object",
            "object_data": {
                "name": "저장 버튼",
                "control_type": "ButtonControl",
                "automation_id": "btn_save"
            },
            "button": "left",
            "clicks": 1
        }
    )

    with patch.object(uia_service, "find_control", return_value=(450, 320)), \
         patch("pyautogui.click") as mock_click:
        result_output = await node.execute_action(dummy_context)
        assert "UIA 객체 일치" in result_output
        assert "저장 버튼" in result_output
        mock_click.assert_called_once_with(x=450, y=320, button="left", clicks=1)
