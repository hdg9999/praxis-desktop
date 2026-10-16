import pytest
from pathlib import Path
from unittest.mock import patch
from app.nodes.base import ExecutionContext
from app.nodes.general import GeneralNode
from app.nodes.agent_tools import execute_agent_tool, AGENT_TOOLS


def make_ctx(variables=None):
    events = []
    async def mock_cb(ev):
        events.append(ev)
    return ExecutionContext(
        session_id="ses_test_six_nodes",
        event_callback=mock_cb,
        check_cancelled=lambda: False,
        variables=variables if variables is not None else {},
    )


# =====================================================================
# 1. 마우스 드래그 앤 드롭 (general_mouse_drag) 테스트
# =====================================================================
@pytest.mark.asyncio
async def test_mouse_drag_four_combinations():
    """좌표->좌표, 오브젝트->오브젝트, 좌표->오브젝트, 오브젝트->좌표 4가지 조합 및 instant/smooth 이동 검증"""
    ctx = make_ctx()

    # 1) 좌표 -> 좌표 (smooth)
    node_cc = GeneralNode(
        id="n_drag_1",
        name="드래그 좌->좌",
        subtype="mouse_drag",
        config={
            "start_mode": "coordinate",
            "start_x": 100,
            "start_y": 150,
            "end_mode": "coordinate",
            "end_x": 400,
            "end_y": 450,
            "button": "left",
            "move_mode": "smooth",
            "duration": 0.3,
        },
    )
    with patch("pyautogui.moveTo") as m_move, \
         patch("pyautogui.mouseDown") as m_down, \
         patch("pyautogui.mouseUp") as m_up:
        res = await node_cc.run(ctx)
        assert res.success is True
        assert "(100, 150)" in res.output
        assert "(400, 450)" in res.output
        assert "부드러운 이동" in res.output
        m_down.assert_called_once_with(x=100, y=150, button="left")
        m_up.assert_called_once_with(x=400, y=450, button="left")
        assert m_move.call_count == 2

    # 2) 오브젝트 -> 오브젝트 (instant)
    node_oo = GeneralNode(
        id="n_drag_2",
        name="드래그 오->오",
        subtype="mouse_drag",
        config={
            "start_mode": "object",
            "start_object_data": {"name": "파일아이콘", "x": 50, "y": 60},
            "end_mode": "object",
            "end_object_data": {"name": "폴더아이콘", "x": 300, "y": 350},
            "button": "left",
            "move_mode": "instant",
        },
    )
    with patch("app.nodes.general.resolve_target_point_async") as m_resolve, \
         patch("pyautogui.moveTo"), \
         patch("pyautogui.mouseDown"), \
         patch("pyautogui.mouseUp"):
        m_resolve.side_effect = [
            (55, 65, "오브젝트('파일아이콘' @ 55, 65)"),
            (310, 360, "오브젝트('폴더아이콘' @ 310, 360)"),
        ]
        res = await node_oo.run(ctx)
        assert res.success is True
        assert "파일아이콘" in res.output
        assert "폴더아이콘" in res.output
        assert "즉시(순간이동)" in res.output

    # 3) 좌표 -> 오브젝트
    node_co = GeneralNode(
        id="n_drag_3",
        name="드래그 좌->오",
        subtype="mouse_drag",
        config={
            "start_mode": "coordinate",
            "start_x": 120,
            "start_y": 130,
            "end_mode": "object",
            "end_object_data": {"name": "휴지통", "x": 800, "y": 900},
            "move_mode": "instant",
        },
    )
    with patch("app.nodes.general.resolve_target_point_async") as m_resolve, \
         patch("pyautogui.moveTo"), \
         patch("pyautogui.mouseDown"), \
         patch("pyautogui.mouseUp"):
        m_resolve.side_effect = [
            (120, 130, "좌표(120, 130)"),
            (800, 900, "오브젝트('휴지통' @ 800, 900)"),
        ]
        res = await node_co.run(ctx)
        assert res.success is True
        assert "좌표(120, 130)" in res.output
        assert "휴지통" in res.output

    # 4) 오브젝트 -> 좌표
    node_oc = GeneralNode(
        id="n_drag_4",
        name="드래그 오->좌",
        subtype="mouse_drag",
        config={
            "start_mode": "object",
            "start_object_data": {"name": "슬라이더핸들", "x": 200, "y": 500},
            "end_mode": "coordinate",
            "end_x": 500,
            "end_y": 500,
            "move_mode": "smooth",
            "duration": 0.4,
        },
    )
    with patch("app.nodes.general.resolve_target_point_async") as m_resolve, \
         patch("pyautogui.moveTo"), \
         patch("pyautogui.mouseDown"), \
         patch("pyautogui.mouseUp"):
        m_resolve.side_effect = [
            (200, 500, "오브젝트('슬라이더핸들' @ 200, 500)"),
            (500, 500, "좌표(500, 500)"),
        ]
        res = await node_oc.run(ctx)
        assert res.success is True
        assert "슬라이더핸들" in res.output
        assert "좌표(500, 500)" in res.output


# =====================================================================
# 2. 클립보드 읽기 (general_clipboard_read) 테스트
# =====================================================================
@pytest.mark.asyncio
async def test_clipboard_read_node():
    """클립보드 텍스트를 읽어 지정된 변수에 저장하는지 검증"""
    ctx = make_ctx()
    node = GeneralNode(
        id="n_clip_read",
        name="클립보드 읽기",
        subtype="clipboard_read",
        config={"output_variable": "my_clip"},
    )
    with patch("pyperclip.paste", return_value="복사된 테스트 문자열 123"):
        res = await node.run(ctx)
        assert res.success is True
        assert ctx.variables["my_clip"] == "복사된 테스트 문자열 123"
        assert ctx.variables["last_output"] == "복사된 테스트 문자열 123"
        assert "{{my_clip}}" in res.output


# =====================================================================
# 3. 텍스트 파일 읽기 (general_file_read) 테스트
# =====================================================================
@pytest.mark.asyncio
async def test_file_read_node(tmp_path):
    """로컬 텍스트 파일 읽기 및 변수 저장, 미존재 파일 예외 처리 검증"""
    sample_file = tmp_path / "sample.txt"
    sample_file.write_text("안녕하세요!\nPromptMacro 파일 읽기 테스트입니다.", encoding="utf-8")

    ctx = make_ctx({"folder": str(tmp_path)})
    node = GeneralNode(
        id="n_file_read",
        name="파일 읽기",
        subtype="file_read",
        config={
            "file_path": "{{folder}}\\sample.txt",
            "encoding": "utf-8",
            "output_variable": "loaded_text",
        },
    )
    res = await node.run(ctx)
    assert res.success is True
    assert "PromptMacro 파일 읽기 테스트입니다." in ctx.variables["loaded_text"]
    assert ctx.variables["last_output"] == ctx.variables["loaded_text"]

    # 존재하지 않는 파일 읽기 시 오류 검증
    node_missing = GeneralNode(
        id="n_file_read_err",
        name="없는 파일 읽기",
        subtype="file_read",
        config={"file_path": str(tmp_path / "no_such_file.txt")},
    )
    res_err = await node_missing.run(ctx)
    assert res_err.success is False
    assert "지정한 파일을 찾을 수 없습니다" in res_err.error


# =====================================================================
# 4. 파일 쓰기 (general_file_write) 테스트
# =====================================================================
@pytest.mark.asyncio
async def test_file_write_node_and_overwrite_protection(tmp_path):
    """파일 쓰기 및 덮어쓰기(overwrite) 체크 해제 시 오류 발생 검증"""
    target_file = tmp_path / "sub" / "output.txt"
    ctx = make_ctx({"user_msg": "초기 저장 데이터"})

    # 1) 새 파일 생성 (overwrite=False여도 파일이 없으므로 성공)
    node_write_1 = GeneralNode(
        id="n_write_1",
        name="파일 쓰기 1",
        subtype="file_write",
        config={
            "file_path": str(target_file),
            "content": "내용: {{user_msg}}",
            "overwrite": False,
        },
    )
    res1 = await node_write_1.run(ctx)
    assert res1.success is True
    assert target_file.exists()
    assert target_file.read_text(encoding="utf-8") == "내용: 초기 저장 데이터"

    # 2) 파일이 이미 존재하는데 overwrite=False인 경우 -> 오류 처리되어야 함
    node_write_fail = GeneralNode(
        id="n_write_2",
        name="덮어쓰기 해제 오류 테스트",
        subtype="file_write",
        config={
            "file_path": str(target_file),
            "content": "새로운 내용",
            "overwrite": False,
        },
    )
    res2 = await node_write_fail.run(ctx)
    assert res2.success is False
    assert "'덮어쓰기 허용'이 선택 해제되어 있습니다" in res2.error
    # 기존 파일 내용이 보존되었는지 확인
    assert target_file.read_text(encoding="utf-8") == "내용: 초기 저장 데이터"

    # 3) overwrite=True로 설정한 경우 -> 정상 덮어쓰기 성공
    node_write_overwrite = GeneralNode(
        id="n_write_3",
        name="덮어쓰기 허용 테스트",
        subtype="file_write",
        config={
            "file_path": str(target_file),
            "content": "덮어쓴 새로운 내용",
            "overwrite": True,
        },
    )
    res3 = await node_write_overwrite.run(ctx)
    assert res3.success is True
    assert target_file.read_text(encoding="utf-8") == "덮어쓴 새로운 내용"


# =====================================================================
# 5. 사용자 대화상자 출력 (general_message_box) 테스트
# =====================================================================
@pytest.mark.asyncio
async def test_message_box_all_button_types():
    """대화상자 확인만 / 예·아니오(boolean 변수 저장) / 계속·중지(중지 시 워크플로우 에러 종료) 검증"""
    ctx = make_ctx({"job_name": "정산 보고서"})

    # 1) '확인' 버튼만 (ok) -> IDOK(1) 반환 시 정상 성공
    node_ok = GeneralNode(
        id="n_msg_ok",
        name="확인 알림창",
        subtype="message_box",
        config={
            "title": "알림: {{job_name}}",
            "message_type": "info",
            "message": "작업이 완료되었습니다.",
            "button_type": "ok",
        },
    )
    with patch("app.nodes.general.show_topmost_message_box", return_value=1):
        res_ok = await node_ok.run(ctx)
        assert res_ok.success is True
        assert "사용자 대화상자 확인 완료" in res_ok.output

    # 2) '예/아니오' (yes_no) -> IDYES(6) 클릭 시 True, IDNO(7) 클릭 시 False 저장
    node_yn = GeneralNode(
        id="n_msg_yn",
        name="예 아니오 질문",
        subtype="message_box",
        config={
            "title": "진행 확인",
            "message_type": "warning",
            "message": "계속 할까요?",
            "button_type": "yes_no",
            "output_variable": "user_choice",
        },
    )
    with patch("app.nodes.general.show_topmost_message_box", return_value=6):
        res_yes = await node_yn.run(ctx)
        assert res_yes.success is True
        assert ctx.variables["user_choice"] is True

    with patch("app.nodes.general.show_topmost_message_box", return_value=7):
        res_no = await node_yn.run(ctx)
        assert res_no.success is True
        assert ctx.variables["user_choice"] is False

    # 3) '계속/중지' (continue_stop) -> '계속'(1)은 성공, '중지'(2)는 오류 발생시켜 워크플로우 중단
    node_cs = GeneralNode(
        id="n_msg_cs",
        name="계속 중지 선택",
        subtype="message_box",
        config={
            "title": "중요 점검",
            "message_type": "error",
            "message": "계속 진행하거나 중지하세요.",
            "button_type": "continue_stop",
        },
    )
    with patch("app.nodes.general.show_topmost_message_box", return_value=1):
        res_cont = await node_cs.run(ctx)
        assert res_cont.success is True
        assert "[계속] 선택됨" in res_cont.output

    with patch("app.nodes.general.show_topmost_message_box", return_value=2):
        res_stop = await node_cs.run(ctx)
        assert res_stop.success is False
        assert "'중지' 버튼을 선택하여 워크플로우를 종료합니다" in res_stop.error


# =====================================================================
# 6. 마우스 스크롤 (general_mouse_scroll) 테스트
# =====================================================================
@pytest.mark.asyncio
async def test_mouse_scroll_object_and_current_window_modes():
    """오브젝트 선택 모드(상하/좌우 및 5가지 거리 옵션)와 현재 활성창 모드(휠 칸수 전용) 검증"""
    ctx = make_ctx()

    # 1) 오브젝트 선택 모드 (기본값) - 한페이지 뒤로 (page_down)
    node_obj_scroll = GeneralNode(
        id="n_scroll_obj",
        name="오브젝트 스크롤",
        subtype="mouse_scroll",
        config={
            "target_mode": "object",
            "object_data": {"name": "문서뷰어", "window_title": "메모장", "x": 400, "y": 400},
            "direction": "vertical",
            "distance_mode": "page_down",
        },
    )
    with patch("app.nodes.general.resolve_target_point_async", return_value=(400, 400, "오브젝트('문서뷰어')")), \
         patch("app.services.uia_service.uia_service.scroll_target_element") as m_scroll:
        m_scroll.return_value = {
            "method_used": "UIA ScrollPattern",
            "at_start": False,
            "at_end": False,
        }
        res1 = await node_obj_scroll.run(ctx)
        assert res1.success is True
        assert "UIA ScrollPattern" in res1.output
        assert "한 페이지 뒤로" in res1.output
        m_scroll.assert_called_once()

    # 2) 현재 활성창 모드 - 좌우 방향 스크롤 (휠 칸수 전용 전송 검증)
    node_cur_scroll = GeneralNode(
        id="n_scroll_cur",
        name="현재창 가로 스크롤",
        subtype="mouse_scroll",
        config={
            "target_mode": "current",
            "direction": "horizontal",
            "distance_mode": "end",  # current 모드에서는 ticks로 강제 처리되어야 함
            "ticks": 7,
            "ticks_direction": "backward",
        },
    )
    with patch("app.services.uia_service.uia_service.send_mouse_wheel") as m_wheel:
        res2 = await node_cur_scroll.run(ctx)
        assert res2.success is True
        assert "[현재 활성창 모드]" in res2.output
        assert "7칸" in res2.output
        m_wheel.assert_called_once_with(
            direction="horizontal",
            signed_ticks=7,
            x=None,
            y=None,
        )


# =====================================================================
# 7. 에이전트 도구 패리티 (Agent Tools) 테스트
# =====================================================================
@pytest.mark.asyncio
async def test_new_six_agent_tools(tmp_path):
    """신규 6종 스킬이 모두 AGENT_TOOLS에 등록되어 있고 정상 실행되는지 검증"""
    for tool_name in ["mouse_drag", "mouse_scroll", "clipboard_read", "file_read", "file_write", "message_box"]:
        assert tool_name in AGENT_TOOLS

    ctx = make_ctx()

    # 1) mouse_drag
    with patch("pyautogui.moveTo"), patch("pyautogui.mouseDown"), patch("pyautogui.mouseUp"):
        r_drag = await execute_agent_tool("mouse_drag", {"start_x": 10, "start_y": 20, "end_x": 100, "end_y": 200}, context=ctx)
        assert "[성공]" in r_drag

    # 2) mouse_scroll
    with patch("app.services.uia_service.uia_service.send_mouse_wheel"):
        r_scroll = await execute_agent_tool("mouse_scroll", {"direction": "vertical", "ticks": 3, "ticks_direction": "backward"}, context=ctx)
        assert "[성공]" in r_scroll

    # 3) clipboard_read
    with patch("pyperclip.paste", return_value="클립보드 샘플"):
        r_clip = await execute_agent_tool("clipboard_read", {}, context=ctx)
        assert "[성공]" in r_clip
        assert "클립보드 샘플" in r_clip

    # 4) file_write & file_read
    f_path = str(tmp_path / "agent_test.txt")
    r_write = await execute_agent_tool("file_write", {"file_path": f_path, "content": "에이전트 기록 텍스트", "overwrite": False}, context=ctx)
    assert "[성공]" in r_write

    # 덮어쓰기 해제 상태에서 재쓰기 시 실패 반환
    r_write_dup = await execute_agent_tool("file_write", {"file_path": f_path, "content": "덮어쓰기 시도", "overwrite": False}, context=ctx)
    assert "[실패]" in r_write_dup

    r_read = await execute_agent_tool("file_read", {"file_path": f_path}, context=ctx)
    assert "[성공]" in r_read
    assert "에이전트 기록 텍스트" in r_read

    # 5) message_box ('중지' 클릭 시 [실패] 반환)
    with patch("app.nodes.general.show_topmost_message_box", return_value=2):
        r_msg_stop = await execute_agent_tool("message_box", {"title": "확인", "message": "중지 테스트", "button_type": "continue_stop"}, context=ctx)
        assert "[실패]" in r_msg_stop
        assert "중지" in r_msg_stop
