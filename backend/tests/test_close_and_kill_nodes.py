import pytest
from unittest.mock import patch, MagicMock
from app.nodes.base import ExecutionContext
from app.nodes.general import GeneralNode
from app.nodes.agent_tools import execute_agent_tool, AGENT_TOOLS, PRESET_SKILLS
from app.services.process_service import process_service, PROTECTED_PROCESS_NAMES


# --------------------------------------------------------------------------
# 1. ProcessService 단위 테스트
# --------------------------------------------------------------------------
def test_normalize_process_name():
    assert process_service.normalize_process_name("Notepad") == "notepad.exe"
    assert process_service.normalize_process_name("chrome.exe") == "chrome.exe"
    assert process_service.normalize_process_name(' "Calculator" ') == "calculator.exe"
    assert process_service.normalize_process_name("") == ""


def test_is_process_protected_blacklist():
    # 블랙리스트 시스템/런타임 프로세스
    for proc in ["python.exe", "python", "electron.exe", "explorer.exe", "svchost.exe", "code.exe"]:
        is_prot, reason = process_service.is_process_protected(proc)
        assert is_prot is True
        assert "안전을 위해 종료할 수 없습니다" in reason or "종료할 수 없습니다" in reason

    # 와일드카드 및 빈 값
    assert process_service.is_process_protected("*")[0] is True
    assert process_service.is_process_protected("*.exe")[0] is True
    assert process_service.is_process_protected("")[0] is True

    # 일반 안전 프로세스
    is_prot, reason = process_service.is_process_protected("custom_test_dummy.exe")
    assert is_prot is False
    assert reason == ""


def test_close_program_softly_protected_block():
    # 보호 대상 프로세스 정상 종료 시도 시 즉각 차단
    ok, msg, count = process_service.close_program_softly("python.exe")
    assert ok is False
    assert "[보호 정책 위반]" in msg
    assert count == 0


def test_kill_process_by_name_protected_block():
    # 보호 대상 프로세스 강제 종료 시도 시 즉각 차단
    ok, msg, count = process_service.kill_process_by_name("explorer.exe")
    assert ok is False
    assert "[보호 정책 위반]" in msg
    assert count == 0


# --------------------------------------------------------------------------
# 2. GeneralNode 실행 단위 테스트
# --------------------------------------------------------------------------
@pytest.fixture
def mock_context():
    events = []
    async def mock_callback(event):
        events.append(event)
    return ExecutionContext(
        session_id="test_session_id",
        event_callback=mock_callback,
        check_cancelled=lambda: False,
        variables={}
    )


@pytest.mark.asyncio
async def test_general_node_window_close(mock_context):
    node = GeneralNode(
        id="node_win_close_1",
        name="창 닫기 노드",
        subtype="window_close",
        config={
            "target_mode": "title",
            "window_title": "테스트창",
            "match_type": "contains"
        }
    )

    with patch("app.services.uia_service.uia_service.find_window_target") as mock_find, \
         patch("app.services.uia_service.uia_service.close_window") as mock_close, \
         patch("app.services.screen_capture.screen_capture_service.capture", return_value="/api/static/screenshots/test.webp"):
        mock_find.return_value = (12345, "테스트창 - 메모장")
        mock_close.return_value = True

        res = await node.run(mock_context)
        assert res.success is True
        assert "윈도우 닫기 성공" in res.output
        mock_close.assert_called_once_with(12345)


@pytest.mark.asyncio
async def test_general_node_close_program_protected_raises(mock_context):
    node = GeneralNode(
        id="node_close_prog_1",
        name="프로그램 종료 노드",
        subtype="close_program",
        config={
            "process_name": "python.exe"
        }
    )

    # 보호 대상이므로 RuntimeError 발생 검증
    res = await node.run(mock_context)
    assert res.success is False
    assert "보호 정책 위반" in res.error


@pytest.mark.asyncio
async def test_general_node_close_program_safe_call(mock_context):
    node = GeneralNode(
        id="node_close_prog_2",
        name="프로그램 종료 노드",
        subtype="close_program",
        config={
            "process_name": "dummy_calc.exe"
        }
    )

    with patch("app.services.process_service.process_service.close_program_softly") as mock_close, \
         patch("app.services.screen_capture.screen_capture_service.capture", return_value="/api/static/screenshots/test.webp"):
        mock_close.return_value = (True, "'dummy_calc.exe' 종료 신호 전송 완료", 1)

        res = await node.run(mock_context)
        assert res.success is True
        assert "프로그램 정상 종료 성공" in res.output
        mock_close.assert_called_once_with("dummy_calc.exe")


@pytest.mark.asyncio
async def test_general_node_kill_process_protected_raises(mock_context):
    node = GeneralNode(
        id="node_kill_1",
        name="프로세스 강제 종료",
        subtype="kill_process",
        config={
            "process_name": "explorer.exe"
        }
    )

    res = await node.run(mock_context)
    assert res.success is False
    assert "보호 정책 위반" in res.error


@pytest.mark.asyncio
async def test_general_node_kill_process_safe_call(mock_context):
    node = GeneralNode(
        id="node_kill_2",
        name="프로세스 강제 종료",
        subtype="kill_process",
        config={
            "process_name": "my_worker.exe"
        }
    )

    with patch("app.services.process_service.process_service.kill_process_by_name") as mock_kill, \
         patch("app.services.screen_capture.screen_capture_service.capture", return_value="/api/static/screenshots/test.webp"):
        mock_kill.return_value = (True, "'my_worker.exe' 프로세스를 강제 종료(Kill)했습니다.", 1)

        res = await node.run(mock_context)
        assert res.success is True
        assert "프로세스 강제 종료 성공" in res.output
        mock_kill.assert_called_once_with("my_worker.exe")


# --------------------------------------------------------------------------
# 3. Agent Tool Dispatcher 단위 테스트
# --------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_agent_tools_specs_and_presets():
    # AGENT_TOOLS 등록 여부
    assert "window_close" in AGENT_TOOLS
    assert "close_program" in AGENT_TOOLS
    assert "kill_process" in AGENT_TOOLS

    # 창 닫기는 기본 interaction 프리셋에 포함
    assert "window_close" in PRESET_SKILLS["basic_interaction"]

    # 프로그램 종료 / 강제 종료는 기본 프리셋에서 제외 (안전 가드레일 Opt-in)
    assert "close_program" not in PRESET_SKILLS["basic_interaction"]
    assert "kill_process" not in PRESET_SKILLS["basic_interaction"]

    # all 목록에는 포함
    assert "close_program" in PRESET_SKILLS["all"]
    assert "kill_process" in PRESET_SKILLS["all"]


@pytest.mark.asyncio
async def test_agent_tool_window_close_dispatcher():
    with patch("app.services.uia_service.uia_service.find_window_target") as mock_find, \
         patch("app.services.process_service.process_service.close_window_by_hwnd") as mock_close:
        mock_find.return_value = (9999, "메모장")
        mock_close.return_value = True

        out = await execute_agent_tool("window_close", {"title": "메모장"})
        assert "[성공]" in out
        assert "메모장" in out


@pytest.mark.asyncio
async def test_agent_tool_close_program_guard():
    # 에이전트가 python.exe 종료 시도 시 방어벽 작동 확인
    out = await execute_agent_tool("close_program", {"process_name": "python.exe"})
    assert "[실패]" in out
    assert "[보호 정책 위반]" in out


@pytest.mark.asyncio
async def test_agent_tool_kill_process_guard():
    # 에이전트가 explorer.exe 종료 시도 시 방어벽 작동 확인
    out = await execute_agent_tool("kill_process", {"process_name": "explorer.exe"})
    assert "[실패]" in out
    assert "[보호 정책 위반]" in out


@pytest.mark.asyncio
async def test_agent_tool_safe_kill_process():
    with patch("app.services.process_service.process_service.kill_process_by_name") as mock_kill:
        mock_kill.return_value = (True, "'safe_task.exe' 프로세스를 강제 종료했습니다.", 1)

        out = await execute_agent_tool("kill_process", {"process_name": "safe_task.exe"})
        assert "[성공]" in out
