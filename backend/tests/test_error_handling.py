import json
import uuid
import pytest
from unittest.mock import AsyncMock, patch
from sqlmodel import Session

from app.core.database import engine
from app.core.engine import FlowEngine
from app.models.flow import Flow
from app.nodes.base import NodeResult
from app.nodes.general import render_template
from app.nodes.agent_tools import (
    get_default_skills_for_failed_node,
    get_self_healing_tools_schema,
    execute_agent_tool,
)
from app.nodes.agent import (
    sanitize_failed_node_digest,
)


def _make_base_graph(middle_nodes, edges, settings=None, variables=None):
    nodes = [
        {
            "id": "node_start",
            "type": "flow_start",
            "position": {"x": 0, "y": 100},
            "data": {"label": "시작", "type": "flow_start", "config": {}},
        },
        *middle_nodes,
        {
            "id": "node_end",
            "type": "flow_end",
            "position": {"x": 1000, "y": 100},
            "data": {"label": "끝", "type": "flow_end", "config": {}},
        },
    ]
    return {
        "nodes": nodes,
        "edges": edges,
        "settings": settings or {"execution_delay": 0.0, "default_llm_model": "llama3"},
        "variables": variables or [],
    }


@pytest.mark.asyncio
async def test_node_retry_logs_attempt_number_and_succeeds():
    """
    1-1) 개별 노드 재시도(M초 간격 N회) 선택 시:
    첫 시도 실패 후 1차 재시도에서 성공하면 Agent Runner 기록에 '(재시도 1/2)'가 명시되고 워크플로우가 성공 완료되는지 검증
    """
    flow_engine = FlowEngine()
    events = []

    async def capture_event(ev):
        events.append(ev)

    attempt_counter = {"count": 0}

    async def flaky_file_read_run(self, context):
        attempt_counter["count"] += 1
        if attempt_counter["count"] == 1:
            return NodeResult(success=False, error="일시적 파일 잠금 오류")
        context.set_variable("out_var", "읽기 성공 데이터")
        return NodeResult(success=True, output="읽기 성공 데이터")

    graph_data = _make_base_graph(
        middle_nodes=[
            {
                "id": "node_flaky",
                "type": "general_file_read",
                "position": {"x": 250, "y": 100},
                "data": {
                    "label": "보고서 파일 읽기",
                    "type": "general_file_read",
                    "config": {
                        "file_path": "C:/temp/report.txt",
                        "output_variable": "out_var",
                        "retry_enabled": True,
                        "retry_count": 2,
                        "retry_interval": 0.01,
                        "continue_on_error": False,
                    },
                },
            }
        ],
        edges=[
            {"id": "e1", "source": "node_start", "target": "node_flaky"},
            {"id": "e2", "source": "node_flaky", "target": "node_end"},
        ],
        variables=[{"name": "out_var", "type": "string", "defaultValue": ""}],
    )

    with patch("app.nodes.general.GeneralNode.run", new=flaky_file_read_run):
        session_rec = await flow_engine.run_flow(
            flow_id="test_retry_success",
            flow_name="재시도 성공 테스트",
            graph_data=graph_data,
            session_id=f"ses_{uuid.uuid4().hex[:8]}",
            event_callback=capture_event,
        )

    assert session_rec.status == "SUCCESS"
    assert attempt_counter["count"] == 2

    # Agent Runner 기록에서 재시도 회차 '(재시도 1/2)' 확인 가능 여부 검증
    retry_events = [
        e for e in events if "(재시도 1/2)" in str(e.get("node_name", "")) or "(재시도 1/2)" in str(e.get("content", ""))
    ]
    assert len(retry_events) >= 1


@pytest.mark.asyncio
async def test_node_retry_then_continue_on_error_priority():
    """
    1-2) 재시도와 오류 무시 후 진행(Continue On Error)을 둘 다 선택한 경우:
    재시도가 먼저 모두 수행된 뒤에도 최종 실패하면 오류 무시 후 진행이 작동하여 다음 노드로 넘어가는지 검증
    """
    flow_engine = FlowEngine()
    events = []

    async def capture_event(ev):
        events.append(ev)

    call_log = []

    async def custom_general_run(self, context):
        call_log.append(self.id)
        if self.id == "node_always_fail":
            return NodeResult(success=False, error="대상 버튼을 찾을 수 없음")
        if self.id == "node_next":
            err_captured = render_template("이전오류={{last_error_node_name}}:{{last_error_message}}", context.variables)
            context.set_variable("result_var", err_captured)
            return NodeResult(success=True, output=err_captured)
        return NodeResult(success=True, output="ok")

    graph_data = _make_base_graph(
        middle_nodes=[
            {
                "id": "node_always_fail",
                "type": "general_mouse_click",
                "position": {"x": 200, "y": 100},
                "data": {
                    "label": "팝업 닫기 클릭",
                    "type": "general_mouse_click",
                    "config": {
                        "retry_enabled": True,
                        "retry_count": 2,
                        "retry_interval": 0.01,
                        "continue_on_error": True,
                    },
                },
            },
            {
                "id": "node_next",
                "type": "general_clipboard_copy",
                "position": {"x": 500, "y": 100},
                "data": {
                    "label": "후속 단계 실행",
                    "type": "general_clipboard_copy",
                    "config": {"text": "done"},
                },
            },
        ],
        edges=[
            {"id": "e1", "source": "node_start", "target": "node_always_fail"},
            {"id": "e2", "source": "node_always_fail", "target": "node_next"},
            {"id": "e3", "source": "node_next", "target": "node_end"},
        ],
        variables=[{"name": "result_var", "type": "string", "defaultValue": ""}],
    )

    with patch("app.nodes.general.GeneralNode.run", new=custom_general_run):
        session_rec = await flow_engine.run_flow(
            flow_id="test_retry_and_continue",
            flow_name="재시도 후 무시 진행 테스트",
            graph_data=graph_data,
            session_id=f"ses_{uuid.uuid4().hex[:8]}",
            event_callback=capture_event,
        )

    assert session_rec.status == "SUCCESS"
    # 최초 1회 + 재시도 2회 = 총 3회 실행 후 node_next로 진행되어야 함
    assert call_log == ["node_always_fail", "node_always_fail", "node_always_fail", "node_next"]
    assert any("오류 무시 후 진행" in str(e.get("content", "")) for e in events)


@pytest.mark.asyncio
async def test_group_break_on_error_skips_remaining_group_nodes():
    """
    2-1) 그룹 노드 '그룹 건너뛰기(Break Group)' 설정 시:
    그룹 내 첫 노드 실패 시 같은 그룹 안의 나머지 노드를 건너뛰고 그룹 바깥의 다음 노드로 탈출하는지 검증
    """
    flow_engine = FlowEngine()
    events = []
    executed_ids = []

    async def capture_event(ev):
        events.append(ev)

    async def custom_general_run(self, context):
        executed_ids.append(self.id)
        if self.id == "node_g1":
            return NodeResult(success=False, error="그룹 내부 1번 노드 에러")
        return NodeResult(success=True, output="ok")

    graph_data = _make_base_graph(
        middle_nodes=[
            {
                "id": "group_1",
                "type": "flow_group",
                "position": {"x": 150, "y": 50},
                "data": {
                    "label": "로그인 시도 그룹",
                    "type": "flow_group",
                    "config": {"error_mode": "break_group"},
                },
            },
            {
                "id": "node_g1",
                "type": "general_mouse_click",
                "position": {"x": 200, "y": 100},
                "data": {
                    "label": "그룹노드 1 (실패)",
                    "type": "general_mouse_click",
                    "config": {"group_id": "group_1"},
                },
            },
            {
                "id": "node_g2",
                "type": "general_keyboard_type",
                "position": {"x": 400, "y": 100},
                "data": {
                    "label": "그룹노드 2 (건너뛰어야 함)",
                    "type": "general_keyboard_type",
                    "config": {"group_id": "group_1"},
                },
            },
            {
                "id": "node_outside",
                "type": "general_delay",
                "position": {"x": 700, "y": 100},
                "data": {
                    "label": "그룹 외부 후속 노드",
                    "type": "general_delay",
                    "config": {"seconds": 0.01},
                },
            },
        ],
        edges=[
            {"id": "e1", "source": "node_start", "target": "node_g1"},
            {"id": "e2", "source": "node_g1", "target": "node_g2"},
            {"id": "e3", "source": "node_g2", "target": "node_outside"},
            {"id": "e4", "source": "node_outside", "target": "node_end"},
        ],
    )

    with patch("app.nodes.general.GeneralNode.run", new=custom_general_run):
        session_rec = await flow_engine.run_flow(
            flow_id="test_group_break",
            flow_name="그룹 Break 테스트",
            graph_data=graph_data,
            session_id=f"ses_{uuid.uuid4().hex[:8]}",
            event_callback=capture_event,
        )

    assert session_rec.status == "SUCCESS"
    # node_g2는 건너뛰고 node_outside만 실행되어야 함
    assert executed_ids == ["node_g1", "node_outside"]
    assert any("그룹 건너뛰기" in str(e.get("content", "")) for e in events)


@pytest.mark.asyncio
async def test_group_catch_subflow_executes_recovery_flow_and_continues():
    """
    2-2) 그룹 노드 'Catch 서브플로우 실행' 설정 시:
    그룹 내 에러 발생 시 저장된 Catch 서브플로우를 호출하고 그룹 바깥 노드로 정상 진행하는지 검증
    """
    catch_flow_id = "catch_subflow_001"
    catch_graph = _make_base_graph(
        middle_nodes=[
            {
                "id": "sub_recover_node",
                "type": "general_clipboard_copy",
                "position": {"x": 300, "y": 100},
                "data": {
                    "label": "에러 복구 클립보드 기록",
                    "type": "general_clipboard_copy",
                    "config": {"text": "복구됨:{{last_error_message}}"},
                },
            }
        ],
        edges=[
            {"id": "se1", "source": "node_start", "target": "sub_recover_node"},
            {"id": "se2", "source": "sub_recover_node", "target": "node_end"},
        ],
    )
    with Session(engine) as db:
        existing = db.get(Flow, catch_flow_id)
        if existing:
            db.delete(existing)
            db.commit()
        db.add(
            Flow(
                id=catch_flow_id,
                name="그룹 에러 복구 서브플로우",
                description="Catch 복구 플로우",
                graph_data=json.dumps(catch_graph, ensure_ascii=False),
            )
        )
        db.commit()

    flow_engine = FlowEngine()
    executed_ids = []
    captured_sub_text = {"val": ""}

    async def custom_general_run(self, context):
        executed_ids.append(self.id)
        if self.id == "node_g_fail":
            return NodeResult(success=False, error="데이터 추출 타임아웃")
        if self.id == "sub_recover_node":
            captured_sub_text["val"] = render_template(self.config.get("text", ""), context.variables)
            return NodeResult(success=True, output=captured_sub_text["val"])
        return NodeResult(success=True, output="ok")

    main_graph = _make_base_graph(
        middle_nodes=[
            {
                "id": "group_catch",
                "type": "flow_group",
                "position": {"x": 150, "y": 50},
                "data": {
                    "label": "크롤링 그룹",
                    "type": "flow_group",
                    "config": {
                        "error_mode": "catch_subflow",
                        "catch_subflow_id": catch_flow_id,
                    },
                },
            },
            {
                "id": "node_g_fail",
                "type": "general_mouse_click",
                "position": {"x": 200, "y": 100},
                "data": {
                    "label": "크롤링 클릭 실패",
                    "type": "general_mouse_click",
                    "config": {"group_id": "group_catch"},
                },
            },
            {
                "id": "node_g_skipped",
                "type": "general_delay",
                "position": {"x": 400, "y": 100},
                "data": {
                    "label": "건너뛸 그룹 노드",
                    "type": "general_delay",
                    "config": {"group_id": "group_catch"},
                },
            },
            {
                "id": "node_after_group",
                "type": "general_delay",
                "position": {"x": 700, "y": 100},
                "data": {
                    "label": "그룹 이후 정상 노드",
                    "type": "general_delay",
                    "config": {"seconds": 0.01},
                },
            },
        ],
        edges=[
            {"id": "e1", "source": "node_start", "target": "node_g_fail"},
            {"id": "e2", "source": "node_g_fail", "target": "node_g_skipped"},
            {"id": "e3", "source": "node_g_skipped", "target": "node_after_group"},
            {"id": "e4", "source": "node_after_group", "target": "node_end"},
        ],
    )

    with patch("app.nodes.general.GeneralNode.run", new=custom_general_run):
        session_rec = await flow_engine.run_flow(
            flow_id="test_group_catch",
            flow_name="그룹 Catch 서브플로우 테스트",
            graph_data=main_graph,
            session_id=f"ses_{uuid.uuid4().hex[:8]}",
            event_callback=AsyncMock(),
        )

    assert session_rec.status == "SUCCESS"
    assert executed_ids == ["node_g_fail", "sub_recover_node", "node_after_group"]
    assert "데이터 추출 타임아웃" in captured_sub_text["val"]


@pytest.mark.asyncio
async def test_global_error_handler_self_healing_agent_context_and_continue():
    """
    3) 워크플로우 전역 에러 핸들러 - 오류 복구 AI 에이전트(Self-Healing Agent):
    - 실패 노드의 주석(note) 및 파라미터 경량화 검증 (base64_image 제거)
    - 실패 노드 타입에 대응하는 에이전트 스킬 자동 기본 로드 + 추가 허용 스킬 병합 검증
    - 워크플로우 개요(이름, 설명) 및 세션 실행 기록(get_session_logs) 제공 검증
    - after_agent_action == 'continue_next' 설정 시 에이전트 복구 완료 후 다음 노드로 이어서 실행되는지 검증
    - after_agent_action == 'stop_workflow' 설정 시 에이전트 조치 완료 후 워크플로우가 종료되는지 검증
    """
    # 1. 실패 노드 타입별 기본 스킬 자동 로드 검증
    default_click_skills = get_default_skills_for_failed_node("general_mouse_click")
    assert "mouse_click" in default_click_skills
    assert "get_screen_elements" in default_click_skills

    schema = get_self_healing_tools_schema(
        failed_node_type="browser_click",
        skill_mode="custom",
        preset_name="basic_interaction",
        custom_skills=["keyboard_hotkey"],
    )
    tool_names = [t["function"]["name"] for t in schema]
    # browser_click의 기본 스킬(web_click, web_get_snapshot) + get_session_logs + 사용자 추가(keyboard_hotkey)가 모두 포함되어야 함
    assert "web_click" in tool_names
    assert "web_get_snapshot" in tool_names
    assert "get_session_logs" in tool_names
    assert "keyboard_hotkey" in tool_names

    # 2. 실패 노드 digest가 주석(note)은 보존하고 base64_image는 제거하는지 검증
    failed_node_sample = {
        "id": "node_btn_click",
        "type": "general_mouse_click",
        "data": {
            "label": "결제 승인 버튼 클릭",
            "type": "general_mouse_click",
            "config": {
                "note": "결제 팝업 우측 하단의 파란색 [승인] 버튼을 클릭해야 합니다.",
                "click_mode": "object",
                "object_data": {
                    "name": "승인",
                    "control_type": "Button",
                    "window_title": "결제 창",
                    "base64_image": "A" * 50000,
                },
            },
        },
    }
    digest = sanitize_failed_node_digest(failed_node_sample)
    assert digest["node_note"] == "결제 팝업 우측 하단의 파란색 [승인] 버튼을 클릭해야 합니다."
    assert "base64_image" not in json.dumps(digest, ensure_ascii=False)

    # 3. 실제 엔진 런타임에서 Self-Healing Agent 호출 후 다음 노드 진행(continue_next) 검증
    flow_engine = FlowEngine()
    executed_nodes = []
    captured_agent_prompt = {"prompt": "", "system_prompt": "", "tools": []}

    async def custom_general_run(self, context):
        executed_nodes.append(self.id)
        if self.id == "node_fail_step":
            return NodeResult(success=False, error="승인 버튼 UIA 요소를 찾지 못했습니다.")
        return NodeResult(success=True, output="다음 노드 정상 완료")

    async def mock_agent_run(self, context):
        executed_nodes.append(self.id)
        assert self.max_steps == 100
        captured_agent_prompt["prompt"] = self.config.get("prompt", "")
        captured_agent_prompt["system_prompt"] = self.config.get("system_prompt", "")
        captured_agent_prompt["tools"] = [
            t["function"]["name"] for t in (self.config.get("override_tools_schema") or [])
        ]
        # 에이전트가 get_session_logs 도구를 호출해 세션 기록을 열람할 수 있는지 검증
        log_res_raw = await execute_agent_tool("get_session_logs", {"limit": 5}, context)
        assert "[현 세션 실행 기록 조회]" in log_res_raw
        assert "승인 버튼 클릭" in log_res_raw
        return NodeResult(success=True, output="팝업을 닫고 승인 버튼을 대신 클릭하여 복구 완료했습니다.")

    graph_data = _make_base_graph(
        middle_nodes=[
            {
                "id": "node_fail_step",
                "type": "general_mouse_click",
                "position": {"x": 250, "y": 100},
                "data": {
                    "label": "승인 버튼 클릭",
                    "type": "general_mouse_click",
                    "config": {
                        "note": "결제창의 승인 버튼을 누르는 핵심 단계입니다.",
                    },
                },
            },
            {
                "id": "node_after_heal",
                "type": "general_clipboard_copy",
                "position": {"x": 550, "y": 100},
                "data": {
                    "label": "완료 메시지 복사",
                    "type": "general_clipboard_copy",
                    "config": {"text": "완료"},
                },
            },
        ],
        edges=[
            {"id": "e1", "source": "node_start", "target": "node_fail_step"},
            {"id": "e2", "source": "node_fail_step", "target": "node_after_heal"},
            {"id": "e3", "source": "node_after_heal", "target": "node_end"},
        ],
        settings={
            "execution_delay": 0.0,
            "default_llm_model": "llama3",
            "global_error_handler": {
                "mode": "self_healing_agent",
                "after_agent_action": "continue_next",
                "skill_mode": "custom",
                "custom_skills": ["keyboard_hotkey"],
                "user_prompt": "",
                "max_steps": 100,
            },
        },
    )

    with patch("app.nodes.general.GeneralNode.run", new=custom_general_run), patch(
        "app.nodes.agent.AgentNode.run", new=mock_agent_run
    ):
        session_rec = await flow_engine.run_flow(
            flow_id="test_self_healing_continue",
            flow_name="결제 자동화 워크플로우",
            flow_description="사내 ERP 결제 승인을 자동으로 처리하는 워크플로우입니다.",
            graph_data=graph_data,
            session_id=f"ses_{uuid.uuid4().hex[:8]}",
            event_callback=AsyncMock(),
        )

    assert session_rec.status == "SUCCESS"
    # 실패 노드 -> Self-Healing 에이전트 -> 원래 워크플로우의 다음 노드(node_after_heal) 순으로 실행되어야 함
    assert executed_nodes == [
        "node_fail_step",
        "self_healing_node_fail_step",
        "node_after_heal",
    ]
    # 에이전트 프롬프트에 워크플로우 이름, 설명, 노드 주석, 에러 메시지가 모두 포함되었는지 검증
    assert "결제 자동화 워크플로우" in captured_agent_prompt["prompt"]
    assert "사내 ERP 결제 승인을 자동으로 처리하는 워크플로우입니다." in captured_agent_prompt["prompt"]
    assert "결제창의 승인 버튼을 누르는 핵심 단계입니다." in captured_agent_prompt["prompt"]
    assert "승인 버튼 UIA 요소를 찾지 못했습니다." in captured_agent_prompt["prompt"]
    # 실패 노드의 기본 스킬(mouse_click) + 추가 허용 스킬(keyboard_hotkey) + 세션 로그 열람(get_session_logs) 로드 확인
    assert "mouse_click" in captured_agent_prompt["tools"]
    assert "keyboard_hotkey" in captured_agent_prompt["tools"]
    assert "get_session_logs" in captured_agent_prompt["tools"]

    # 4. after_agent_action == 'stop_workflow' 일 때는 에이전트 조치 후 워크플로우가 종료되는지 검증
    executed_nodes.clear()
    stop_graph = json.loads(json.dumps(graph_data))
    stop_graph["settings"]["global_error_handler"]["after_agent_action"] = "stop_workflow"

    with patch("app.nodes.general.GeneralNode.run", new=custom_general_run), patch(
        "app.nodes.agent.AgentNode.run", new=mock_agent_run
    ):
        stop_session_rec = await flow_engine.run_flow(
            flow_id="test_self_healing_stop",
            flow_name="결제 자동화 워크플로우",
            graph_data=stop_graph,
            session_id=f"ses_{uuid.uuid4().hex[:8]}",
            event_callback=AsyncMock(),
        )

    assert stop_session_rec.status == "FAILED"
    assert executed_nodes == ["node_fail_step", "self_healing_node_fail_step"]


@pytest.mark.asyncio
async def test_global_error_handler_subflow_mode_executes_recovery_workflow():
    """
    3-1) 워크플로우 전역 에러 핸들러 - '워크플로우 실행(mode: subflow)' 설정 시:
    미처리 오류 발생 시 지정된 에러 핸들러 서브플로우가 실행되고 {{last_error_message}}, {{last_error_node_name}}을 전달받는지 검증
    """
    err_subflow_id = "global_err_subflow_001"
    err_subflow_graph = _make_base_graph(
        middle_nodes=[
            {
                "id": "global_err_notify",
                "type": "general_clipboard_copy",
                "position": {"x": 300, "y": 100},
                "data": {
                    "label": "전역 오류 알림 기록",
                    "type": "general_clipboard_copy",
                    "config": {"text": "[전역복구] {{last_error_node_name}} -> {{last_error_message}}"},
                },
            }
        ],
        edges=[
            {"id": "ge1", "source": "node_start", "target": "global_err_notify"},
            {"id": "ge2", "source": "global_err_notify", "target": "node_end"},
        ],
    )
    with Session(engine) as db:
        existing = db.get(Flow, err_subflow_id)
        if existing:
            db.delete(existing)
            db.commit()
        db.add(
            Flow(
                id=err_subflow_id,
                name="전역 에러 핸들러 플로우",
                description="전역 에러 후처리",
                graph_data=json.dumps(err_subflow_graph, ensure_ascii=False),
            )
        )
        db.commit()

    flow_engine = FlowEngine()
    executed_ids = []
    captured_global_msg = {"val": ""}

    async def custom_general_run(self, context):
        executed_ids.append(self.id)
        if self.id == "node_crash":
            return NodeResult(success=False, error="DB 연결 끊김")
        if self.id == "global_err_notify":
            captured_global_msg["val"] = render_template(self.config.get("text", ""), context.variables)
            return NodeResult(success=True, output=captured_global_msg["val"])
        return NodeResult(success=True, output="ok")

    main_graph = _make_base_graph(
        middle_nodes=[
            {
                "id": "node_crash",
                "type": "general_mouse_click",
                "position": {"x": 250, "y": 100},
                "data": {
                    "label": "원격 설정 읽기",
                    "type": "general_mouse_click",
                    "config": {},
                },
            }
        ],
        edges=[
            {"id": "e1", "source": "node_start", "target": "node_crash"},
            {"id": "e2", "source": "node_crash", "target": "node_end"},
        ],
        settings={
            "execution_delay": 0.0,
            "default_llm_model": "llama3",
            "global_error_handler": {
                "mode": "subflow",
                "error_subflow_id": err_subflow_id,
            },
        },
    )

    with patch("app.nodes.general.GeneralNode.run", new=custom_general_run):
        session_rec = await flow_engine.run_flow(
            flow_id="test_global_subflow",
            flow_name="전역 에러 서브플로우 테스트",
            graph_data=main_graph,
            session_id=f"ses_{uuid.uuid4().hex[:8]}",
            event_callback=AsyncMock(),
        )

    assert session_rec.status == "FAILED"
    assert executed_ids == ["node_crash", "global_err_notify"]
    assert captured_global_msg["val"] == "[전역복구] 원격 설정 읽기 -> DB 연결 끊김"

