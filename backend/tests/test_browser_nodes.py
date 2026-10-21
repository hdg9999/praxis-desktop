"""
Playwright 기반 브라우저 전용 스킬 노드 7종 (BrowserNode),
PlaywrightService (iframe 관통 로케이터 및 ref 스냅샷),
그리고 에이전트용 웹 전용 스킬 6종 (web_*) 및 'web_playwright' 프리셋 단위/통합 테스트.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from app.core.engine import FlowEngine
from app.nodes.base import ExecutionContext
from app.nodes.browser import BrowserNode
from app.nodes.agent_tools import (
    AGENT_TOOLS,
    PRESET_SKILLS,
    get_agent_tools_schema,
    execute_agent_tool,
)
from app.services.playwright_service import PlaywrightService


@pytest.fixture
def exec_context():
    events = []

    async def on_event(payload):
        events.append(payload)

    ctx = ExecutionContext(
        session_id="ses_browser_test",
        event_callback=on_event,
        check_cancelled=lambda: False,
        variables={
            "search_keyword": "인공지능 에이전트",
            "web_content": "",
            "web_info": "",
            "js_result": "",
            "downloaded_file_path": "",
        },
        variable_schemas={
            "search_keyword": {"name": "search_keyword", "type": "string", "defaultValue": "인공지능 에이전트"},
            "web_content": {"name": "web_content", "type": "string", "defaultValue": ""},
            "web_info": {"name": "web_info", "type": "string", "defaultValue": ""},
            "js_result": {"name": "js_result", "type": "string", "defaultValue": ""},
            "downloaded_file_path": {"name": "downloaded_file_path", "type": "string", "defaultValue": ""},
        },
        strict_variables=True,
    )
    ctx._emitted_events = events
    return ctx


# ---------------------------------------------------------------------------
# 1. FlowEngine 인스턴스화 및 변수 사전 검증 테스트
# ---------------------------------------------------------------------------
def test_flow_engine_instantiate_browser_nodes():
    fe = FlowEngine()
    subtypes = ["navigate", "click", "fill", "extract", "action", "get_info", "evaluate"]
    for st in subtypes:
        node = fe.instantiate_node({
            "id": f"n_{st}",
            "type": f"browser_{st}",
            "data": {"label": f"브라우저 {st}", "config": {}},
        })
        assert isinstance(node, BrowserNode)
        assert node.subtype == st


def test_flow_engine_validate_browser_variables():
    fe = FlowEngine()
    ordered_nodes = [
        {
            "id": "b_nav",
            "type": "browser_navigate",
            "data": {"label": "웹 열기", "config": {"url": "https://example.com?q={{undeclared_var}}"}},
        }
    ]
    err = fe.validate_flow_variables(ordered_nodes, {"declared_var": {"name": "declared_var", "type": "string"}})
    assert err is not None
    assert "undeclared_var" in err[2]

    # 출력 변수 미선언 검사 (browser_extract)
    ordered_extract = [
        {
            "id": "b_ext",
            "type": "browser_extract",
            "data": {"label": "웹 추출", "config": {"output_variable": "missing_out"}},
        }
    ]
    err2 = fe.validate_flow_variables(ordered_extract, {})
    assert err2 is not None
    assert "missing_out" in err2[2]


# ---------------------------------------------------------------------------
# 2. BrowserNode 7종 서브타입 실행 테스트
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_browser_node_all_seven_subtypes(exec_context):
    with patch("app.services.screen_capture.screen_capture_service.capture", return_value=None):
        # 1) browser_navigate
        with patch(
            "app.services.playwright_service.playwright_service.navigate",
            new=AsyncMock(return_value={"url": "https://www.naver.com/", "title": "NAVER", "run_mode": "headless"}),
        ) as mock_nav:
            n_nav = BrowserNode(
                id="b1",
                name="웹 열기",
                subtype="navigate",
                config={"url": "naver.com", "run_mode": "headless", "use_persistent_profile": True},
            )
            res1 = await n_nav.run(exec_context)
            assert res1.success is True
            assert exec_context.variables["last_output"] == "https://www.naver.com/"
            mock_nav.assert_awaited_once()

        # 2) browser_click
        with patch(
            "app.services.playwright_service.playwright_service.click_element",
            new=AsyncMock(return_value={"clicked_selector": "로그인", "current_url": "https://nid.naver.com", "current_title": "로그인"}),
        ) as mock_click:
            n_click = BrowserNode(
                id="b2",
                name="웹 클릭",
                subtype="click",
                config={"selector_type": "text", "selector": "로그인", "iframe_auto_search": True, "force_click": True},
            )
            res2 = await n_click.run(exec_context)
            assert res2.success is True
            mock_click.assert_awaited_once()

        # 3) browser_fill (템플릿 변수 치환 포함)
        with patch(
            "app.services.playwright_service.playwright_service.fill_element",
            new=AsyncMock(return_value={"filled_selector": "#query", "text_length": 9, "pressed_enter": True, "current_url": "https://search.naver.com"}),
        ) as mock_fill:
            n_fill = BrowserNode(
                id="b3",
                name="웹 입력",
                subtype="fill",
                config={"selector_type": "css", "selector": "#query", "text": "{{search_keyword}}", "press_enter": True},
            )
            res3 = await n_fill.run(exec_context)
            assert res3.success is True
            assert exec_context.variables["last_output"] == "인공지능 에이전트"
            mock_fill.assert_awaited_once()

        # 4) browser_extract
        with patch(
            "app.services.playwright_service.playwright_service.extract_content",
            new=AsyncMock(return_value="# 주요 뉴스\n| 제목 | 요약 |\n| --- | --- |\n| AI 혁신 | 로컬 에이전트 확산 |"),
        ):
            n_ext = BrowserNode(
                id="b4",
                name="웹 추출",
                subtype="extract",
                config={"extract_target": "full_page", "extract_format": "markdown", "output_variable": "web_content"},
            )
            res4 = await n_ext.run(exec_context)
            assert res4.success is True
            assert "AI 혁신" in exec_context.variables["web_content"]

        # 5) browser_action (wait_for_download)
        with patch(
            "app.services.playwright_service.playwright_service.perform_action",
            new=AsyncMock(return_value={"action": "wait_for_download", "file_path": "C:\\Temp\\report.pdf", "filename": "report.pdf"}),
        ):
            n_act = BrowserNode(
                id="b5",
                name="다운로드 대기",
                subtype="action",
                config={"action_type": "wait_for_download", "target_value": "#dl-btn", "output_variable": "downloaded_file_path"},
            )
            res5 = await n_act.run(exec_context)
            assert res5.success is True
            assert exec_context.variables["downloaded_file_path"] == "C:\\Temp\\report.pdf"

        # 6) browser_get_info
        with patch(
            "app.services.playwright_service.playwright_service.get_page_info",
            new=AsyncMock(return_value="https://news.naver.com"),
        ):
            n_info = BrowserNode(
                id="b6",
                name="웹 정보 읽기",
                subtype="get_info",
                config={"info_type": "url", "output_variable": "web_info"},
            )
            res6 = await n_info.run(exec_context)
            assert res6.success is True
            assert exec_context.variables["web_info"] == "https://news.naver.com"

        # 7) browser_evaluate
        with patch(
            "app.services.playwright_service.playwright_service.evaluate_js",
            new=AsyncMock(return_value="LegacyGridLoaded"),
        ):
            n_eval = BrowserNode(
                id="b7",
                name="웹 JS 실행",
                subtype="evaluate",
                config={"script": "return window.getLegacyStatus();", "output_variable": "js_result"},
            )
            res7 = await n_eval.run(exec_context)
            assert res7.success is True
            assert exec_context.variables["js_result"] == "LegacyGridLoaded"


# ---------------------------------------------------------------------------
# 3. PlaywrightService 중첩 iframe 관통 로케이터 단위 테스트
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_playwright_service_iframe_locator_resolution():
    svc = PlaywrightService()

    # 메인 프레임에는 요소가 없고(count=0), 자식 iframe에만 요소가 있는 레거시 웹 시나리오 모킹
    main_frame = MagicMock()
    empty_loc = MagicMock()
    empty_loc.count = AsyncMock(return_value=0)
    empty_loc.first = empty_loc
    main_frame.locator.return_value = empty_loc
    main_frame.get_by_role.return_value = empty_loc
    main_frame.get_by_text.return_value = empty_loc
    main_frame.get_by_placeholder.return_value = empty_loc
    main_frame.get_by_label.return_value = empty_loc

    child_iframe = MagicMock()
    found_loc = MagicMock()
    found_loc.count = AsyncMock(return_value=1)
    found_loc.is_visible = AsyncMock(return_value=True)
    found_loc.nth.return_value = found_loc
    found_loc.first = found_loc
    child_iframe.locator.return_value = found_loc

    fake_page = MagicMock()
    fake_page.main_frame = main_frame
    fake_page.frames = [main_frame, child_iframe]

    # ref ID (예: "e5")로 탐색 시 메인 프레임을 지나 자식 iframe에서 정상 검출되는지 확인
    resolved = await svc.resolve_locator(
        page=fake_page,
        selector_type="auto",
        selector="e5",
        iframe_auto_search=True,
        timeout_sec=1.0,
    )
    assert resolved == found_loc
    child_iframe.locator.assert_called_with('[data-pm-ref="e5"]')


# ---------------------------------------------------------------------------
# 4. 에이전트 웹 전용 스킬 6종 및 'web_playwright' 프리셋 테스트
# ---------------------------------------------------------------------------
def test_agent_web_playwright_preset_schema():
    assert "web_playwright" in PRESET_SKILLS
    schema = get_agent_tools_schema("preset", "web_playwright")
    names = [item["function"]["name"] for item in schema]
    assert "web_navigate" in names
    assert "web_get_snapshot" in names
    assert "web_click" in names
    assert "web_fill" in names
    assert "web_read_page" in names
    assert "web_control" in names
    assert len(names) == 7  # 소형 모델 추론 최적화를 위해 7개 이내로 경량 유지


@pytest.mark.asyncio
async def test_execute_agent_web_tools(exec_context):
    with patch(
        "app.services.playwright_service.playwright_service.navigate",
        new=AsyncMock(return_value={"url": "https://example.com", "title": "Example Domain"}),
    ), patch(
        "app.services.playwright_service.playwright_service.get_interactive_snapshot",
        new=AsyncMock(
            return_value={
                "url": "https://example.com",
                "title": "Example Domain",
                "total_elements": 2,
                "elements": [
                    {"ref": "e1", "tag": "input", "type": "text", "label": "검색어", "value": "", "selector_hint": "#q"},
                    {"ref": "e2", "tag": "button", "type": "button", "label": "검색", "value": "", "selector_hint": "#btn", "in_iframe": True},
                ],
            }
        ),
    ):
        res_nav = await execute_agent_tool("web_navigate", {"url": "https://example.com", "headless": True}, context=exec_context)
        assert "[성공]" in res_nav
        assert "[e1]" in res_nav
        assert "[e2]" in res_nav
        assert "[iframe]" in res_nav

        res_snap = await execute_agent_tool("web_get_snapshot", {"query": "검색"}, context=exec_context)
        assert "[웹 스냅샷]" in res_snap
        assert "selector: #btn" in res_snap

    with patch(
        "app.services.playwright_service.playwright_service.click_element",
        new=AsyncMock(return_value={"clicked_selector": "e2", "current_url": "https://example.com/res", "current_title": "결과"}),
    ):
        res_click = await execute_agent_tool("web_click", {"target": "e2"}, context=exec_context)
        assert "[성공]" in res_click
        assert "e2" in res_click

    with patch(
        "app.services.playwright_service.playwright_service.fill_element",
        new=AsyncMock(return_value={"filled_selector": "e1", "text_length": 4, "pressed_enter": True, "current_url": "https://example.com/search"}),
    ):
        res_fill = await execute_agent_tool("web_fill", {"target": "e1", "text": "환율조회", "press_enter": True}, context=exec_context)
        assert "[성공]" in res_fill
        assert "환율조회" in res_fill
        assert "Enter 전송" in res_fill

    with patch(
        "app.services.playwright_service.playwright_service.extract_content",
        new=AsyncMock(return_value="오늘의 환율: 1,380원"),
    ):
        res_read = await execute_agent_tool("web_read_page", {"max_length": 2000}, context=exec_context)
        assert "[성공]" in res_read
        assert "오늘의 환율: 1,380원" in res_read
        assert exec_context.variables["last_output"] == "오늘의 환율: 1,380원"

    with patch(
        "app.services.playwright_service.playwright_service.evaluate_js",
        new=AsyncMock(return_value={"ok": True}),
    ):
        res_ctrl = await execute_agent_tool("web_control", {"action": "eval_js", "value": "return {ok: true};"}, context=exec_context)
        assert "[성공]" in res_ctrl
        assert "{'ok': True}" in res_ctrl


# ---------------------------------------------------------------------------
# 5. FlowEngine 브라우저 워크플로우 E2E 실행 통합 테스트
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_flow_engine_browser_workflow_e2e():
    from app.core.database import init_db
    from app.core.engine import flow_engine

    init_db()
    graph_data = {
        "settings": {"execution_delay": 0.0, "default_llm_model": "llama3.1"},
        "variables": [
            {"name": "target_url", "type": "string", "defaultValue": "https://example.com"},
            {"name": "page_markdown", "type": "string", "defaultValue": ""},
            {"name": "current_title", "type": "string", "defaultValue": ""},
        ],
        "nodes": [
            {"id": "start", "type": "flow_start", "position": {"x": 0, "y": 0}, "data": {"label": "시작"}},
            {
                "id": "b_nav",
                "type": "browser_navigate",
                "position": {"x": 150, "y": 0},
                "data": {
                    "label": "웹 열기",
                    "config": {"url": "{{target_url}}", "run_mode": "headless"},
                },
            },
            {
                "id": "b_ext",
                "type": "browser_extract",
                "position": {"x": 300, "y": 0},
                "data": {
                    "label": "본문 추출",
                    "config": {
                        "extract_target": "full_page",
                        "extract_format": "markdown",
                        "output_variable": "page_markdown",
                    },
                },
            },
            {
                "id": "b_info",
                "type": "browser_get_info",
                "position": {"x": 450, "y": 0},
                "data": {
                    "label": "제목 읽기",
                    "config": {"info_type": "title", "output_variable": "current_title"},
                },
            },
            {"id": "end", "type": "flow_end", "position": {"x": 600, "y": 0}, "data": {"label": "끝"}},
        ],
        "edges": [
            {"id": "e1", "source": "start", "target": "b_nav"},
            {"id": "e2", "source": "b_nav", "target": "b_ext"},
            {"id": "e3", "source": "b_ext", "target": "b_info"},
            {"id": "e4", "source": "b_info", "target": "end"},
        ],
    }

    events = []

    async def cb(ev):
        events.append(ev)

    with patch("app.services.screen_capture.screen_capture_service.capture", return_value=None), \
         patch("app.services.playwright_service.playwright_service.navigate", new=AsyncMock(return_value={"url": "https://example.com/", "title": "Example Domain"})), \
         patch("app.services.playwright_service.playwright_service.extract_content", new=AsyncMock(return_value="# Example Domain\nThis domain is for use in illustrative examples.")), \
         patch("app.services.playwright_service.playwright_service.get_page_info", new=AsyncMock(return_value="Example Domain")):
        session = await flow_engine.run_flow(
            flow_id="flow_browser_e2e",
            flow_name="브라우저 E2E 테스트",
            graph_data=graph_data,
            session_id="ses_browser_e2e_001",
            event_callback=cb,
        )
        assert session.status == "SUCCESS"
        success_events = [e for e in events if e.get("event_type") == "SUCCESS"]
        assert len(success_events) == 3


# ---------------------------------------------------------------------------
# 6. 브라우저 창 닫힘 후 재실행 시 "Target page, context or browser has been closed" 자동 복구 회귀 테스트
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_playwright_service_relaunch_after_browser_window_closed():
    """
    첫 번째 '웹 브라우저 열기' 실행 후 사용자가 브라우저 창을 닫아
    기존 BrowserContext가 닫힌 상태(pages=[] 또는 new_page 호출 시 TargetClosedError 발생)에서
    두 번째 실행을 수행할 때 오류 없이 새 브라우저 세션을 자동 재시작하는지 검증합니다.
    """
    svc = PlaywrightService()

    # 1) 죽은(닫힌) 이전 컨텍스트 상태 시뮬레이션:
    # Playwright에서 창이 닫히면 context.pages는 빈 리스트([])를 반환하고 new_page() 호출 시 예외가 발생함
    dead_context = MagicMock()
    dead_context.pages = []
    dead_context.new_page = AsyncMock(
        side_effect=Exception("BrowserContext.new_page: Target page, context or browser has been closed")
    )
    dead_context.close = AsyncMock()

    svc._context = dead_context
    svc._context_closed = False
    svc._current_config = {
        "run_mode": "headed",
        "is_headless": False,
        "browser_channel": "chrome",
        "use_persistent_profile": True,
    }

    # 2) 새로 실행될 정상 페이지 및 컨텍스트 모킹
    fresh_page = MagicMock()
    fresh_page.is_closed.return_value = False
    fresh_page.title = AsyncMock(return_value="NAVER")
    fresh_page.goto = AsyncMock()
    fresh_page.wait_for_load_state = AsyncMock()
    fresh_page.bring_to_front = AsyncMock()
    fresh_page.url = "https://www.naver.com/"

    fresh_context = MagicMock()
    fresh_context.pages = [fresh_page]

    async def fake_launch(run_mode, browser_channel, use_persistent_profile):
        svc._context = fresh_context
        svc._context_closed = False
        svc._current_page = fresh_page
        svc._current_config = {
            "run_mode": run_mode,
            "is_headless": (run_mode == "headless"),
            "browser_channel": browser_channel,
            "use_persistent_profile": use_persistent_profile,
        }

    with patch.object(svc, "_launch_unlocked", side_effect=fake_launch) as mock_relaunch:
        nav_res = await svc.navigate(url="https://www.naver.com", run_mode="headed")
        assert nav_res["url"] == "https://www.naver.com/"
        assert nav_res["title"] == "NAVER"
        # 죽은 컨텍스트를 감지하고 _launch_unlocked를 호출하여 정상 복구했는지 확인
        mock_relaunch.assert_awaited_once()
        dead_context.close.assert_awaited()


# ---------------------------------------------------------------------------
# 7. 비주얼 웹 요소 선택기 (Web Picker) 시작·프레임 감지·취소 테스트
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_playwright_service_web_picker_flow_and_iframe():
    import asyncio

    svc = PlaywrightService()

    main_frame = MagicMock()
    child_iframe = MagicMock()

    # 메인 프레임은 결과 없음(null), 자식 iframe에서 사용자가 요소를 클릭하여 picked 결과 반환 시뮬레이션
    async def main_eval(script, *args):
        if "__pm_picker_mode" in script and "|| 'pick'" in script:
            return "pick"
        if "__pm_picker_result" in script:
            return None
        return {"status": "injected"}

    picked_payload = {
        "status": "picked",
        "element": {
            "tag": "input",
            "input_type": "text",
            "display_name": "검색어를 입력해 주세요",
            "placeholder": "검색어를 입력해 주세요",
            "css_selector": "#query",
            "xpath": '//*[@id="query"]',
            "recommended_type": "css",
            "recommended_selector": "#query",
            "in_iframe": True,
        },
    }
    child_call_count = {"n": 0}

    async def child_eval(script, *args):
        if "__pm_picker_result" in script:
            child_call_count["n"] += 1
            if child_call_count["n"] >= 1:
                return picked_payload
            return None
        return {"status": "injected"}

    main_frame.evaluate = AsyncMock(side_effect=main_eval)
    child_iframe.evaluate = AsyncMock(side_effect=child_eval)

    fake_page = MagicMock()
    fake_page.is_closed.return_value = False
    fake_page.url = "https://www.naver.com/"
    fake_page.title = AsyncMock(return_value="NAVER")
    fake_page.goto = AsyncMock()
    fake_page.bring_to_front = AsyncMock()
    fake_page.main_frame = main_frame
    fake_page.frames = [main_frame, child_iframe]

    fake_context = MagicMock()
    fake_context.pages = [fake_page]

    svc._context = fake_context
    svc._context_closed = False
    svc._current_page = fake_page
    svc._current_config = {
        "run_mode": "headed",
        "is_headless": False,
        "browser_channel": "chrome",
        "use_persistent_profile": True,
    }

    start_res = await svc.start_web_picker(url="https://www.naver.com")
    assert start_res["status"] == "picking"

    # 백그라운드 폴링 루프가 자식 iframe의 선택 결과를 수집할 때까지 대기
    for _ in range(20):
        st = svc.get_web_picker_status()
        if st["status"] == "picked":
            break
        await asyncio.sleep(0.05)

    final_status = svc.get_web_picker_status()
    assert final_status["active"] is False
    assert final_status["status"] == "picked"
    assert final_status["element"]["css_selector"] == "#query"
    assert final_status["element"]["in_iframe"] is True
    assert final_status["element"]["page_title"] == "NAVER"



