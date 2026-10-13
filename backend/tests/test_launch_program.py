import os
import pytest
from unittest.mock import patch, MagicMock
from app.nodes.base import ExecutionContext
from app.nodes.general import GeneralNode
from app.nodes.agent_tools import execute_agent_tool, AGENT_TOOLS
from app.services.uia_service import get_process_executable_path, resolve_desktop_target

@pytest.mark.asyncio
async def test_launch_program_without_args():
    """인자 없이 기본 프로그램 실행 성공 검증"""
    events = []
    async def mock_callback(event):
        events.append(event)

    ctx = ExecutionContext(
        session_id="ses_test_launch",
        event_callback=mock_callback,
        check_cancelled=lambda: False,
        variables={}
    )

    node = GeneralNode(
        id="node_launch_1",
        name="메모장 실행",
        subtype="launch_program",
        config={
            "program_path": "notepad.exe"
        }
    )

    with patch("os.startfile") as mock_start:
        res = await node.run(ctx)
        assert res.success is True
        assert "프로그램 실행 성공" in res.output
        assert "notepad.exe" in res.output
        mock_start.assert_called_once_with("notepad.exe")

@pytest.mark.asyncio
async def test_launch_program_with_args_and_variables():
    """인자 및 템플릿 변수 치환 포함 프로그램 실행 검증"""
    events = []
    async def mock_callback(event):
        events.append(event)

    ctx = ExecutionContext(
        session_id="ses_test_launch_args",
        event_callback=mock_callback,
        check_cancelled=lambda: False,
        variables={
            "app_name": "notepad.exe",
            "doc_path": "C:\\temp\\memo.txt"
        }
    )

    node = GeneralNode(
        id="node_launch_2",
        name="문서 열기",
        subtype="launch_program",
        config={
            "program_path": "{{app_name}}",
            "arguments": "{{doc_path}}"
        }
    )

    with patch("os.startfile") as mock_start:
        res = await node.run(ctx)
        assert res.success is True
        assert "notepad.exe" in res.output
        assert "C:\\temp\\memo.txt" in res.output
        mock_start.assert_called_once_with("notepad.exe", arguments="C:\\temp\\memo.txt")

@pytest.mark.asyncio
async def test_launch_program_missing_path():
    """경로 누락 시 오류 반환 검증"""
    events = []
    async def mock_callback(event):
        events.append(event)

    ctx = ExecutionContext(
        session_id="ses_test_launch_err",
        event_callback=mock_callback,
        check_cancelled=lambda: False,
        variables={}
    )

    node = GeneralNode(
        id="node_launch_err",
        name="빈 경로 실행",
        subtype="launch_program",
        config={
            "program_path": "   "
        }
    )

    res = await node.run(ctx)
    assert res.success is False
    assert "실행할 프로그램 파일 경로가 지정되지 않았습니다" in res.error

@pytest.mark.asyncio
async def test_launch_program_fallback_to_subprocess():
    """os.startfile 실패 시 subprocess.Popen 2차 시도 검증"""
    events = []
    async def mock_callback(event):
        events.append(event)

    ctx = ExecutionContext(
        session_id="ses_test_fallback",
        event_callback=mock_callback,
        check_cancelled=lambda: False,
        variables={}
    )

    node = GeneralNode(
        id="node_launch_fb",
        name="폴백 실행",
        subtype="launch_program",
        config={
            "program_path": "my_app.exe",
            "arguments": "--flag"
        }
    )

    with patch("os.startfile", side_effect=OSError("Access denied")), \
         patch("subprocess.Popen") as mock_popen:
        res = await node.run(ctx)
        assert res.success is True
        assert "프로그램 실행 성공" in res.output
        mock_popen.assert_called_once()

@pytest.mark.asyncio
async def test_agent_tool_launch_program():
    """기본 에이전트 도구 launch_program 호출 검증"""
    assert "launch_program" in AGENT_TOOLS

    # 1. 정상 호출
    with patch("os.startfile") as mock_start:
        res = await execute_agent_tool("launch_program", {
            "program_path": "calc.exe",
            "arguments": ""
        })
        assert "[성공]" in res
        assert "calc.exe" in res
        mock_start.assert_called_once_with("calc.exe")

    # 2. 경로 누락 호출
    res_err = await execute_agent_tool("launch_program", {})
    assert "[실패]" in res_err
    assert "program_path" in res_err

def test_get_process_executable_path():
    """현재 프로세스 PID를 통한 실행 경로 추출 검증"""
    current_pid = os.getpid()
    path = get_process_executable_path(current_pid)
    assert path is not None
    assert "python" in path.lower()

    # 잘못된 PID
    assert get_process_executable_path(0) is None
    assert get_process_executable_path(-1) is None
