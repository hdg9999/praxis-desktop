import pytest
from unittest.mock import patch, MagicMock
from app.nodes.agent_tools import (
    AGENT_TOOLS,
    PRESET_SKILLS,
    get_agent_tools_schema,
    execute_agent_tool,
)

def test_preset_skills_and_schemas():
    # 1. basic_interaction 프리셋 스키마 검증
    basic_tools = get_agent_tools_schema("preset", "basic_interaction")
    assert len(basic_tools) == len(PRESET_SKILLS["basic_interaction"])
    tool_names = [t["function"]["name"] for t in basic_tools]
    assert "get_screen_elements" in tool_names
    assert "mouse_click" in tool_names
    assert "keyboard_type" in tool_names
    assert "take_screenshot" in tool_names

    # 2. all 프리셋 검증
    all_tools = get_agent_tools_schema("preset", "all")
    assert len(all_tools) == len(AGENT_TOOLS)

    # 3. custom 모드 검증
    custom_tools = get_agent_tools_schema(
        skill_mode="custom",
        custom_skills=["mouse_click", "keyboard_type", "non_existent_skill"]
    )
    assert len(custom_tools) == 2
    c_names = [t["function"]["name"] for t in custom_tools]
    assert "mouse_click" in c_names
    assert "keyboard_type" in c_names

    # 4. custom 모드에서 모든 스킬 체크 해제(0개) 검증
    empty_tools = get_agent_tools_schema(
        skill_mode="custom",
        custom_skills=[]
    )
    assert empty_tools == []
    assert len(empty_tools) == 0

@pytest.mark.asyncio
async def test_execute_agent_tool_unknown():
    res = await execute_agent_tool("unknown_tool", {})
    assert "[오류]" in res
    assert "unknown_tool" in res

@pytest.mark.asyncio
async def test_execute_agent_tool_cancelled():
    mock_ctx = MagicMock()
    mock_ctx.is_cancelled.return_value = True
    res = await execute_agent_tool("mouse_click", {"x": 100, "y": 200}, context=mock_ctx)
    assert "[실행 중단]" in res

@pytest.mark.asyncio
async def test_execute_mouse_click():
    with patch("pyautogui.click") as mock_click:
        res = await execute_agent_tool("mouse_click", {"x": 500, "y": 300, "button": "left"})
        assert "[성공]" in res
        mock_click.assert_called_once_with(500, 300)

@pytest.mark.asyncio
async def test_execute_keyboard_type():
    with patch("pyperclip.copy") as mock_copy, patch("pyautogui.hotkey") as mock_hotkey:
        res = await execute_agent_tool("keyboard_type", {"text": "자동화 테스트"})
        assert "[성공]" in res
        assert "자동화 테스트" in res
        mock_copy.assert_called_once_with("자동화 테스트")
        mock_hotkey.assert_called_once_with("ctrl", "v")

@pytest.mark.asyncio
async def test_execute_get_screen_elements():
    with patch("app.services.uia_service.uia_service.scan_active_window_elements") as mock_scan:
        mock_scan.return_value = {
            "window_title": "메모장",
            "elements": [{"id": 1, "name": "저장", "type_name": "버튼", "x": 100, "y": 200}],
            "formatted_text": "#1 [버튼] 저장 -> (X: 100, Y: 200)"
        }
        res = await execute_agent_tool("get_screen_elements", {})
        assert "#1 [버튼] 저장" in res
        mock_scan.assert_called_once()

@pytest.mark.asyncio
async def test_execute_take_screenshot(tmp_path):
    from PIL import Image
    test_img = Image.new("RGB", (100, 100), color="blue")
    test_file = str(tmp_path / "subfolder" / "test_screen.png")

    with patch("app.services.screen_capture.screen_capture_service.capture_display", return_value=(test_img, {"width": 100, "height": 100})), \
         patch("app.services.screen_capture.copy_image_to_clipboard", return_value=True) as mock_clip:
        
        # 1. 파일 경로 지정 및 클립보드 복사 동시 테스트
        res = await execute_agent_tool("take_screenshot", {
            "file_path": test_file,
            "copy_to_clipboard": True
        })

        assert "[성공]" in res
        assert "파일 저장됨" in res
        assert "클립보드에 복사됨" in res
        assert "100x100" in res
        mock_clip.assert_called_once_with(test_img)

        # 파일이 실제로 디렉터리 자동 생성되어 저장되었는지 검증
        from pathlib import Path
        assert Path(test_file).exists()

    # 2. 파일 경로 미지정 시 자동 기본 경로 저장 테스트
    with patch("app.services.screen_capture.screen_capture_service.capture_display", return_value=(test_img, {"width": 100, "height": 100})):
        res_default = await execute_agent_tool("take_screenshot", {})
        assert "[성공]" in res_default
        assert "파일 저장됨" in res_default

@pytest.mark.asyncio
async def test_execute_window_tools():
    with patch("app.services.uia_service.uia_service.find_window_target", return_value=(12345, "메모장")), \
         patch("app.services.uia_service.uia_service.find_window_by_title", return_value=12345), \
         patch("app.services.uia_service.uia_service.activate_window", return_value=True) as mock_act, \
         patch("app.services.uia_service.uia_service.maximize_window", return_value=True) as mock_max, \
         patch("app.services.uia_service.uia_service.minimize_window", return_value=True) as mock_min:

        # 창 활성화
        res_act = await execute_agent_tool("window_activate", {"title": "메모장"})
        assert "[성공]" in res_act
        mock_act.assert_called_once_with(12345)

        # 창 최대화
        res_max = await execute_agent_tool("window_maximize", {"title": "메모장"})
        assert "[성공]" in res_max
        mock_max.assert_called_once_with(12345)

        # 창 최소화
        res_min = await execute_agent_tool("window_minimize", {"title": "메모장"})
        assert "[성공]" in res_min
        mock_min.assert_called_once_with(12345)

@pytest.mark.asyncio
async def test_execute_delay_and_clipboard():
    with patch("pyperclip.copy") as mock_copy:
        res_clip = await execute_agent_tool("clipboard_copy", {"text": "테스트 텍스트"})
        assert "[성공]" in res_clip
        mock_copy.assert_called_once_with("테스트 텍스트")

    res_delay = await execute_agent_tool("delay", {"seconds": 0.05})
    assert "[성공]" in res_delay

@pytest.mark.asyncio
async def test_execute_get_screen_elements_pagination():
    """get_screen_elements 호출 시 offset, limit, query가 UIA 서비스로 정상 전달되는지 검증"""
    with patch("app.services.uia_service.uia_service.scan_active_window_elements") as mock_scan:
        mock_scan.return_value = {
            "window_title": "테스트 브라우저",
            "total_count": 120,
            "offset": 50,
            "limit": 50,
            "has_more": True,
            "next_offset": 100,
            "formatted_text": "[대상 창: '테스트 브라우저'] (총 120개 중 #51~#100 표시)\n  #51 [링크] \"네이버 증권\" -> 좌표 (X: 350, Y: 180)\n👉 [추가 요소 안내] get_screen_elements(offset=100, limit=50)"
        }

        res = await execute_agent_tool("get_screen_elements", {
            "window_title": "테스트 브라우저",
            "offset": 50,
            "limit": 50,
            "query": "증권"
        })

        mock_scan.assert_called_once_with(
            window_title="테스트 브라우저",
            offset=50,
            limit=50,
            query="증권"
        )
        assert "총 120개 중 #51~#100 표시" in res
        assert "네이버 증권" in res


