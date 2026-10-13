import pytest
from unittest.mock import patch, MagicMock
from app.nodes.general import GeneralNode
from app.nodes.base import ExecutionContext

@pytest.mark.asyncio
async def test_mouse_click_instant_mode():
    events = []
    async def mock_callback(event):
        events.append(event)

    context = ExecutionContext(
        session_id="test_ses_instant",
        event_callback=mock_callback,
        check_cancelled=lambda: False,
        variables={}
    )

    node = GeneralNode(
        id="click_instant",
        name="즉시 클릭 노드",
        subtype="mouse_click",
        config={
            "click_mode": "coordinate",
            "x": 250,
            "y": 350,
            "button": "left",
            "clicks": 1,
            "move_mode": "instant",
            "duration": 0.2
        }
    )

    with patch("app.nodes.general.pyautogui.click") as mock_click, \
         patch("app.nodes.general.pyautogui.moveTo") as mock_move, \
         patch("app.services.screen_capture.screen_capture_service.capture", return_value="/dummy.webp"):
        result = await node.run(context)
        assert result.success is True
        # instant 모드에서는 moveTo가 호출되지 않고 바로 click(x=250, y=350, ...) 호출
        mock_move.assert_not_called()
        mock_click.assert_called_once_with(x=250, y=350, button="left", clicks=1)

@pytest.mark.asyncio
async def test_mouse_click_smooth_mode():
    events = []
    async def mock_callback(event):
        events.append(event)

    context = ExecutionContext(
        session_id="test_ses_smooth",
        event_callback=mock_callback,
        check_cancelled=lambda: False,
        variables={}
    )

    node = GeneralNode(
        id="click_smooth",
        name="천천히 이동 클릭 노드",
        subtype="mouse_click",
        config={
            "click_mode": "coordinate",
            "x": 400,
            "y": 600,
            "button": "right",
            "clicks": 2,
            "move_mode": "smooth",
            "duration": 0.5
        }
    )

    with patch("app.nodes.general.pyautogui.click") as mock_click, \
         patch("app.nodes.general.pyautogui.moveTo") as mock_move, \
         patch("app.services.screen_capture.screen_capture_service.capture", return_value="/dummy.webp"):
        result = await node.run(context)
        assert result.success is True
        # smooth 모드에서는 moveTo(400, 600, duration=0.5) 호출 후 click(button="right", clicks=2) 호출
        mock_move.assert_called_once_with(400, 600, duration=0.5)
        mock_click.assert_called_once_with(button="right", clicks=2)

@pytest.mark.asyncio
async def test_mouse_click_current_position():
    events = []
    async def mock_callback(event):
        events.append(event)

    context = ExecutionContext(
        session_id="test_ses_curpos",
        event_callback=mock_callback,
        check_cancelled=lambda: False,
        variables={}
    )

    # 좌표가 None일 때 (현재 위치 클릭)
    node = GeneralNode(
        id="click_curpos",
        name="현재 위치 클릭",
        subtype="mouse_click",
        config={
            "click_mode": "coordinate",
            "x": None,
            "y": None,
            "button": "left",
            "clicks": 1,
            "move_mode": "smooth",
            "duration": 0.5
        }
    )

    with patch("app.nodes.general.pyautogui.click") as mock_click, \
         patch("app.nodes.general.pyautogui.moveTo") as mock_move, \
         patch("app.services.screen_capture.screen_capture_service.capture", return_value="/dummy.webp"):
        result = await node.run(context)
        assert result.success is True
        mock_move.assert_not_called()
        mock_click.assert_called_once_with(button="left", clicks=1)

@pytest.mark.asyncio
async def test_mouse_click_object_smooth_mode():
    events = []
    async def mock_callback(event):
        events.append(event)

    context = ExecutionContext(
        session_id="test_ses_obj_smooth",
        event_callback=mock_callback,
        check_cancelled=lambda: False,
        variables={}
    )

    node = GeneralNode(
        id="click_obj_smooth",
        name="오브젝트 천천히 클릭",
        subtype="mouse_click",
        config={
            "click_mode": "object",
            "object_data": {
                "name": "저장 버튼",
                "orig_name": "Save",
                "control_type": "ButtonControl",
                "x": 100,
                "y": 200,
                "width": 50,
                "height": 30
            },
            "button": "left",
            "clicks": 1,
            "move_mode": "smooth",
            "duration": 0.4,
            "search_mode": "uia_only"
        }
    )

    # UIA가 (125, 215)를 찾았을 때
    with patch("app.nodes.general.uia_service.find_control", return_value=(125, 215)), \
         patch("app.nodes.general.pyautogui.click") as mock_click, \
         patch("app.nodes.general.pyautogui.moveTo") as mock_move, \
         patch("app.services.screen_capture.screen_capture_service.capture", return_value="/dummy.webp"):
        result = await node.run(context)
        assert result.success is True
        mock_move.assert_called_once_with(125, 215, duration=0.4)
        mock_click.assert_called_once_with(button="left", clicks=1)
