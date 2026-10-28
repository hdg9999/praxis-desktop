import asyncio
from unittest.mock import AsyncMock, patch
import pytest

from app.core.engine import FlowEngine
from app.nodes.agent import build_self_healing_agent_node
from app.nodes.base import ExecutionContext


def make_ctx(session_id: str, variables=None, max_total_steps: int = 1000):
    return ExecutionContext(
        session_id=session_id,
        event_callback=AsyncMock(),
        check_cancelled=lambda: False,
        variables=variables or {},
        max_total_steps=max_total_steps,
    )


@pytest.mark.asyncio
async def test_branch_node_variable_true_and_false_routing():
    """
    flow_branch 노드가 변수/값 비교 결과에 따라 'true' 또는 'false' 핸들 경로로 분기하고,
    이후 합류(Merge) 노드로 정상 도달하는지 검증합니다.
    """
    engine = FlowEngine()

    def make_graph(initial_score: int):
        return {
            "settings": {"execution_delay": 0},
            "variables": [
                {"name": "score", "type": "number", "defaultValue": initial_score},
                {"name": "grade", "type": "string", "defaultValue": ""},
                {"name": "merged_msg", "type": "string", "defaultValue": ""},
            ],
            "nodes": [
                {"id": "start", "type": "flow_start", "data": {"label": "시작", "config": {}}},
                {
                    "id": "branch_1",
                    "type": "flow_branch",
                    "data": {
                        "label": "점수 80점 이상인가?",
                        "config": {
                            "condition_mode": "variable",
                            "left_value": "{{score}}",
                            "operator": "greater_or_equal",
                            "right_value": "80",
                        },
                    },
                },
                {
                    "id": "set_pass",
                    "type": "flow_set_variable",
                    "data": {
                        "label": "합격 설정",
                        "config": {
                            "target_variable": "grade",
                            "operation": "set",
                            "value": "PASS",
                        },
                    },
                },
                {
                    "id": "set_fail",
                    "type": "flow_set_variable",
                    "data": {
                        "label": "불합격 설정",
                        "config": {
                            "target_variable": "grade",
                            "operation": "set",
                            "value": "FAIL",
                        },
                    },
                },
                {
                    "id": "merge_step",
                    "type": "flow_set_variable",
                    "data": {
                        "label": "최종 메시지 합류",
                        "config": {
                            "target_variable": "merged_msg",
                            "operation": "set",
                            "value": "Result={{grade}}",
                        },
                    },
                },
                {"id": "end", "type": "flow_end", "data": {"label": "끝", "config": {}}},
            ],
            "edges": [
                {"source": "start", "target": "branch_1"},
                {"source": "branch_1", "sourceHandle": "true", "target": "set_pass"},
                {"source": "branch_1", "sourceHandle": "false", "target": "set_fail"},
                {"source": "set_pass", "target": "merge_step"},
                {"source": "set_fail", "target": "merge_step"},
                {"source": "merge_step", "target": "end"},
            ],
        }

    # Case 1: score = 90 -> True 경로 (set_pass -> merge_step)
    graph_pass = make_graph(90)
    ctx_pass = make_ctx(
        session_id="test_branch_pass",
        variables={"score": 90, "grade": "", "merged_msg": ""},
    )
    ok_pass, err_pass = await engine.execute_subflow_graph("PassFlow", graph_pass, ctx_pass)
    assert ok_pass is True, err_pass
    assert ctx_pass.variables["grade"] == "PASS"
    assert ctx_pass.variables["merged_msg"] == "Result=PASS"
    assert ctx_pass.variables["branch_result"] is True

    # Case 2: score = 50 -> False 경로 (set_fail -> merge_step)
    graph_fail = make_graph(50)
    ctx_fail = make_ctx(
        session_id="test_branch_fail",
        variables={"score": 50, "grade": "", "merged_msg": ""},
    )
    ok_fail, err_fail = await engine.execute_subflow_graph("FailFlow", graph_fail, ctx_fail)
    assert ok_fail is True, err_fail
    assert ctx_fail.variables["grade"] == "FAIL"
    assert ctx_fail.variables["merged_msg"] == "Result=FAIL"
    assert ctx_fail.variables["branch_result"] is False


@pytest.mark.asyncio
async def test_branch_node_ui_and_web_element_exists():
    """
    flow_branch 노드의 'ui_element_exists' 및 'web_element_exists' 조건 판별 모드를 검증합니다.
    """
    engine = FlowEngine()
    ctx = make_ctx(session_id="test_branch_ui_web")

    # 1) वेब 요소 존재 여부 (Playwright check_element_exists 모킹)
    web_branch_node = engine.instantiate_node(
        {
            "id": "b_web",
            "type": "flow_branch",
            "data": {
                "label": "웹 로그인 버튼 확인",
                "config": {
                    "condition_mode": "web_element_exists",
                    "selector_type": "css",
                    "selector": "#login-btn",
                    "timeout": 1.0,
                },
            },
        }
    )

    with patch(
        "app.services.playwright_service.playwright_service.check_element_exists",
        new=AsyncMock(return_value=True),
    ):
        res_true = await web_branch_node.run(ctx)
        assert res_true.success is True
        assert res_true.next_handle == "true"
        assert ctx.variables["branch_result"] is True

    with patch(
        "app.services.playwright_service.playwright_service.check_element_exists",
        new=AsyncMock(return_value=False),
    ):
        res_false = await web_branch_node.run(ctx)
        assert res_false.success is True
        assert res_false.next_handle == "false"
        assert ctx.variables["branch_result"] is False


@pytest.mark.asyncio
async def test_loop_node_count_mode_and_set_variable():
    """
    flow_loop 노드의 지정 횟수 반복(count=4)과 flow_set_variable(increment)이 결합되어
    정확히 4회 반복 후 'exit' 핸들로 탈출하는지 검증합니다.
    """
    engine = FlowEngine()
    graph = {
        "settings": {"execution_delay": 0},
        "variables": [
            {"name": "total", "type": "number", "defaultValue": 0},
            {"name": "done_flag", "type": "boolean", "defaultValue": False},
        ],
        "nodes": [
            {"id": "start", "type": "flow_start", "data": {"label": "시작", "config": {}}},
            {
                "id": "loop_1",
                "type": "flow_loop",
                "data": {
                    "label": "4회 반복",
                    "config": {"loop_mode": "count", "loop_count": 4},
                },
            },
            {
                "id": "inc_total",
                "type": "flow_set_variable",
                "data": {
                    "label": "합계 +10",
                    "config": {
                        "target_variable": "total",
                        "operation": "increment",
                        "value": "10",
                    },
                },
            },
            {
                "id": "mark_done",
                "type": "flow_set_variable",
                "data": {
                    "label": "완료 플래그 반전",
                    "config": {
                        "target_variable": "done_flag",
                        "operation": "toggle",
                    },
                },
            },
            {"id": "end", "type": "flow_end", "data": {"label": "끝", "config": {}}},
        ],
        "edges": [
            {"source": "start", "target": "loop_1"},
            {"source": "loop_1", "sourceHandle": "loop", "target": "inc_total"},
            {"source": "inc_total", "target": "loop_1"},
            {"source": "loop_1", "sourceHandle": "exit", "target": "mark_done"},
            {"source": "mark_done", "target": "end"},
        ],
    }

    ctx = make_ctx(
        session_id="test_loop_count",
        variables={"total": 0, "done_flag": False},
    )
    ok, err = await engine.execute_subflow_graph("LoopCountFlow", graph, ctx)
    assert ok is True, err
    assert ctx.variables["total"] == 40
    assert ctx.variables["done_flag"] is True
    assert ctx.variables["loop_index"] == 4


@pytest.mark.asyncio
async def test_infinite_loop_with_conditional_break_and_step_limit():
    """
    1) 무한 반복(infinite) 루프 내부에서 flow_branch를 통해 특정 조건 도달 시 끝 노드로 탈출하는 패턴 검증
    2) 탈출 조건이 없는 무한 루프가 max_total_steps 안전 가드레일에 의해 중단되는지 검증
    """
    engine = FlowEngine()

    # 1) 무한 루프 + 조건 분기 탈출 (counter == 3 도달 시 종료)
    graph_with_break = {
        "settings": {"execution_delay": 0},
        "variables": [{"name": "counter", "type": "number", "defaultValue": 0}],
        "nodes": [
            {"id": "start", "type": "flow_start", "data": {"label": "시작", "config": {}}},
            {
                "id": "inf_loop",
                "type": "flow_loop",
                "data": {"label": "상시 모니터링 루프", "config": {"loop_mode": "infinite"}},
            },
            {
                "id": "inc_cnt",
                "type": "flow_set_variable",
                "data": {
                    "label": "카운터 +1",
                    "config": {"target_variable": "counter", "operation": "increment", "value": "1"},
                },
            },
            {
                "id": "check_done",
                "type": "flow_branch",
                "data": {
                    "label": "3회 도달 확인",
                    "config": {
                        "condition_mode": "variable",
                        "left_value": "{{counter}}",
                        "operator": "equals",
                        "right_value": "3",
                    },
                },
            },
            {"id": "end", "type": "flow_end", "data": {"label": "끝", "config": {}}},
        ],
        "edges": [
            {"source": "start", "target": "inf_loop"},
            {"source": "inf_loop", "sourceHandle": "loop", "target": "inc_cnt"},
            {"source": "inc_cnt", "target": "check_done"},
            {"source": "check_done", "sourceHandle": "false", "target": "inf_loop"},
            {"source": "check_done", "sourceHandle": "true", "target": "end"},
        ],
    }

    ctx_break = make_ctx(session_id="test_inf_break", variables={"counter": 0})
    ok, err = await engine.execute_subflow_graph("MonitorWithBreak", graph_with_break, ctx_break)
    assert ok is True, err
    assert ctx_break.variables["counter"] == 3

    # 2) 탈출 조건 없는 무한 루프 -> max_total_steps=15에서 안전 차단
    graph_no_break = {
        "settings": {"execution_delay": 0},
        "nodes": [
            {"id": "start", "type": "flow_start", "data": {"label": "시작", "config": {}}},
            {
                "id": "inf_loop",
                "type": "flow_loop",
                "data": {"label": "무한 루프", "config": {"loop_mode": "infinite"}},
            },
        ],
        "edges": [
            {"source": "start", "target": "inf_loop"},
            {"source": "inf_loop", "sourceHandle": "loop", "target": "inf_loop"},
        ],
    }
    ctx_limit = make_ctx(session_id="test_inf_limit", max_total_steps=15)
    ok_limit, err_limit = await engine.execute_subflow_graph("RunawayLoop", graph_no_break, ctx_limit)
    assert ok_limit is False
    assert "최대 누적" in (err_limit or "")


@pytest.mark.asyncio
async def test_group_break_in_graph_engine():
    """
    그래프 탐색 엔진에서 그룹 내 노드 실패 시 break_group 설정이 작동하면
    find_group_exit_node를 통해 그룹 바깥의 다음 노드로 정확히 점프하는지 검증합니다.
    """
    engine = FlowEngine()
    graph = {
        "settings": {"execution_delay": 0},
        "variables": [{"name": "after_group", "type": "string", "defaultValue": "no"}],
        "nodes": [
            {"id": "start", "type": "flow_start", "data": {"label": "시작", "config": {}}},
            {
                "id": "grp_1",
                "type": "flow_group",
                "data": {"label": "트랜잭션 그룹", "config": {"error_mode": "break_group"}},
            },
            {
                "id": "fail_in_group",
                "type": "general_file_read",
                "data": {
                    "label": "없는 파일 읽기",
                    "config": {
                        "group_id": "grp_1",
                        "file_path": "Z:\\non_existent_path_12345.txt",
                        "output_variable": "after_group",
                    },
                },
            },
            {
                "id": "skipped_in_group",
                "type": "flow_set_variable",
                "data": {
                    "label": "건너뛰어야 할 그룹 내 노드",
                    "config": {
                        "group_id": "grp_1",
                        "target_variable": "after_group",
                        "operation": "set",
                        "value": "should_be_skipped",
                    },
                },
            },
            {
                "id": "outside_node",
                "type": "flow_set_variable",
                "data": {
                    "label": "그룹 외부 후속 노드",
                    "config": {
                        "target_variable": "after_group",
                        "operation": "set",
                        "value": "jumped_outside",
                    },
                },
            },
            {"id": "end", "type": "flow_end", "data": {"label": "끝", "config": {}}},
        ],
        "edges": [
            {"source": "start", "target": "fail_in_group"},
            {"source": "fail_in_group", "target": "skipped_in_group"},
            {"source": "skipped_in_group", "target": "outside_node"},
            {"source": "outside_node", "target": "end"},
        ],
    }

    ctx = make_ctx(session_id="test_grp_jump", variables={"after_group": "no"})
    ok, err = await engine.execute_subflow_graph("GroupJumpFlow", graph, ctx)
    assert ok is True, err
    assert ctx.variables["after_group"] == "jumped_outside"


def test_self_healing_agent_linearized_trajectory_and_lookahead():
    """
    복잡한 분기/루프 워크플로우에서 Self-Healing AI 에이전트 프롬프트에
    1) 실제 실행된 과거 선형 궤적(executed_trajectory)과
    2) 직후 예정 경로(downstream_lookahead)가 명확히 포함되는지 검증합니다.
    """
    engine = FlowEngine()
    edges = [
        {"source": "n_fail", "target": "n_next_1"},
        {"source": "n_next_1", "target": "b_after"},
        {"source": "b_after", "sourceHandle": "true", "target": "n_true"},
        {"source": "b_after", "sourceHandle": "false", "target": "n_false"},
    ]
    node_map = {
        "n_fail": {"id": "n_fail", "type": "browser_click", "data": {"label": "결제 버튼 클릭", "config": {"note": "결제창 진행"}}},
        "n_next_1": {"id": "n_next_1", "type": "general_delay", "data": {"label": "로딩 대기", "config": {}}},
        "b_after": {"id": "b_after", "type": "flow_branch", "data": {"label": "결제 성공 분기", "config": {}}},
        "n_true": {"id": "n_true", "type": "general_message_box", "data": {"label": "성공 알림", "config": {}}},
        "n_false": {"id": "n_false", "type": "general_message_box", "data": {"label": "실패 알림", "config": {}}},
    }
    _, outgoing_edges, _ = engine.build_graph_routing(list(node_map.values()), edges)
    lookahead = engine.build_downstream_lookahead("n_fail", node_map, outgoing_edges)

    agent_node = build_self_healing_agent_node(
        handler_config={"after_agent_action": "continue_next"},
        failed_node_data=node_map["n_fail"],
        error_message="Element #pay-btn not found",
        retry_attempts=0,
        flow_name="주문 자동화",
        flow_description="장바구니 결제 프로세스",
        ordered_nodes=list(node_map.values()),
        session_logs=[],
        flow_settings={"default_llm_model": "qwen2.5:7b"},
        executed_trajectory=[
            "[#1] 로그인 완료(browser_click)",
            "[#2] 조건 분기(flow_branch) — 결과: 참(True)",
            "[#3] 결제 버튼 클릭(browser_click) (주석: 결제창 진행)",
        ],
        downstream_lookahead=lookahead,
    )

    prompt = agent_node.config["prompt"]
    assert "실제 실행 진행 경로 (선형 궤적)" in prompt
    assert "[#2] 조건 분기(flow_branch) — 결과: 참(True)" in prompt
    assert "복구 후 직후 예정 단계 (Downstream Lookahead)" in prompt
    assert "로딩 대기" in prompt
    assert "TRUE:성공 알림 / FALSE:실패 알림" in prompt
