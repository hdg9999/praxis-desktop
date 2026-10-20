import json
import uuid
import pytest
from sqlmodel import Session
from app.core.database import engine, init_db
from app.core.engine import flow_engine
from app.models.flow import Flow
from app.models.session import ExecutionSession
from app.nodes.agent_tools import AGENT_TOOLS, PRESET_SKILLS


def _uid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


@pytest.fixture(autouse=True)
def setup_test_db():
    init_db()
    yield


def _save_flow_to_db(flow_id: str, name: str, graph_data: dict):
    with Session(engine) as db:
        existing = db.get(Flow, flow_id)
        if existing:
            existing.name = name
            existing.graph_data = json.dumps(graph_data, ensure_ascii=False)
            db.add(existing)
        else:
            db.add(
                Flow(
                    id=flow_id,
                    name=name,
                    description=f"Test flow {name}",
                    graph_data=json.dumps(graph_data, ensure_ascii=False),
                )
            )
        db.commit()


@pytest.mark.asyncio
async def test_group_node_is_ignored_in_execution_and_agent_tools():
    """
    1. 그룹 노드(flow_group)는 순수 프론트엔드 시각적 컨테이너이므로:
       - 에이전트 스킬셋(AGENT_TOOLS, PRESET_SKILLS)에 포함되지 않아야 함
       - get_execution_order 및 run_flow 실행 시 완전히 투명하게 무시되고 내부/연결된 일반 노드만 정상 실행되어야 함
    """
    assert "flow_group" not in AGENT_TOOLS
    assert "flow_call" not in AGENT_TOOLS
    for preset_list in PRESET_SKILLS.values():
        assert "flow_group" not in preset_list
        assert "flow_call" not in preset_list

    graph_data = {
        "nodes": [
            {"id": "n_start", "type": "flow_start", "position": {"x": 50, "y": 100}, "data": {"label": "시작", "config": {}}},
            {
                "id": "group_1",
                "type": "flow_group",
                "position": {"x": 200, "y": 50},
                "data": {"label": "초기화 그룹", "config": {"collapsed": False, "width": 500, "height": 240}},
            },
            {
                "id": "n_delay",
                "type": "general_delay",
                "position": {"x": 250, "y": 100},
                "data": {"label": "그룹 내 대기", "config": {"seconds": 0.01, "group_id": "group_1"}},
            },
            {"id": "n_end", "type": "flow_end", "position": {"x": 800, "y": 100}, "data": {"label": "끝", "config": {}}},
        ],
        "edges": [
            {"id": "e1", "source": "n_start", "target": "n_delay"},
            {"id": "e2", "source": "n_delay", "target": "n_end"},
            # 접힌 그룹에서 프론트엔드가 생성할 수 있는 가상 브릿지 간선도 백엔드는 무시해야 함
            {"id": "bridge_e1", "source": "n_start", "target": "group_1", "data": {"isGroupBridge": True}},
        ],
        "settings": {"execution_delay": 0.0},
        "variables": [],
    }

    ordered = flow_engine.get_execution_order(graph_data["nodes"], graph_data["edges"])
    ordered_ids = [n["id"] for n in ordered]
    assert "group_1" not in ordered_ids
    assert ordered_ids == ["n_start", "n_delay", "n_end"]

    events = []
    async def cb(ev):
        events.append(ev)

    session_res = await flow_engine.run_flow(
        flow_id="test_flow_with_group",
        flow_name="그룹 포함 테스트 플로우",
        graph_data=graph_data,
        session_id=_uid("ses_test_group"),
        event_callback=cb,
    )
    assert session_res.status == "SUCCESS"


@pytest.mark.asyncio
async def test_subflow_call_variable_isolation_and_mapping(tmp_path):
    """
    2. '다른 워크플로우 호출'(flow_call) 노드의 변수 독립 격리 및 In / Out / InOut 매핑 검증:
       - 메인 워크플로우와 서브 워크플로우에 동일한 이름의 변수('shared_name')가 있어도 매핑하지 않으면 서로 덮어쓰지 않고 독립 격리됨
       - In 매핑: 메인 변수 값을 서브 변수로 전달
       - Out 매핑: 서브 워크플로우 종료 시점의 서브 변수 값을 메인 변수로 반환
       - 서브 워크플로우 종료 후 메인 워크플로우의 다음 노드가 정상 실행됨
    """
    out_file_sub = tmp_path / "sub_written.txt"
    out_file_main = tmp_path / "main_after_sub.txt"

    # 서브 워크플로우 정의:
    # - sub_input (string): 메인으로부터 In 매핑으로 전달받음
    # - shared_name (string, 기본값 'SUB_INTERNAL'): 메인과 이름이 같지만 매핑하지 않음 -> 메인 값을 오염시키면 안 됨
    # - sub_result (string): 파일에서 읽거나 조합하여 Out 매핑으로 메인에 반환
    sub_graph = {
        "nodes": [
            {"id": "s_start", "type": "flow_start", "position": {"x": 50, "y": 100}, "data": {"label": "시작", "config": {}}},
            {
                "id": "s_write",
                "type": "general_file_write",
                "position": {"x": 250, "y": 100},
                "data": {
                    "label": "서브 파일 쓰기",
                    "config": {
                        "file_path": str(out_file_sub),
                        "content": "PROCESSED:{{sub_input}}:{{shared_name}}",
                        "overwrite": True,
                        "encoding": "utf-8",
                    },
                },
            },
            {
                "id": "s_read",
                "type": "general_file_read",
                "position": {"x": 450, "y": 100},
                "data": {
                    "label": "서브 결과 읽기",
                    "config": {
                        "file_path": str(out_file_sub),
                        "encoding": "utf-8",
                        "output_variable": "sub_result",
                    },
                },
            },
            {"id": "s_end", "type": "flow_end", "position": {"x": 650, "y": 100}, "data": {"label": "끝", "config": {}}},
        ],
        "edges": [
            {"id": "se1", "source": "s_start", "target": "s_write"},
            {"id": "se2", "source": "s_write", "target": "s_read"},
            {"id": "se3", "source": "s_read", "target": "s_end"},
        ],
        "settings": {"execution_delay": 0.0},
        "variables": [
            {"name": "sub_input", "type": "string", "defaultValue": "DEFAULT_IN"},
            {"name": "shared_name", "type": "string", "defaultValue": "SUB_INTERNAL"},
            {"name": "sub_result", "type": "string", "defaultValue": ""},
        ],
    }
    _save_flow_to_db("flow_sub_worker", "서브 워커 플로우", sub_graph)

    # 메인 워크플로우 정의:
    # - main_query = 'HELLO_RPA' (In -> sub_input)
    # - shared_name = 'MAIN_ORIGINAL' (매핑 안 함 -> 서브 종료 후에도 'MAIN_ORIGINAL' 유지되어야 함)
    # - main_received = '' (Out <- sub_result)
    main_graph = {
        "nodes": [
            {"id": "m_start", "type": "flow_start", "position": {"x": 50, "y": 100}, "data": {"label": "시작", "config": {}}},
            {
                "id": "m_call",
                "type": "flow_call",
                "position": {"x": 250, "y": 100},
                "data": {
                    "label": "서브 워커 호출",
                    "config": {
                        "target_flow_id": "flow_sub_worker",
                        "target_flow_name": "서브 워커 플로우",
                        "variable_mappings": [
                            {"direction": "in", "parent_var": "main_query", "sub_var": "sub_input"},
                            {"direction": "out", "parent_var": "main_received", "sub_var": "sub_result"},
                        ],
                    },
                },
            },
            {
                "id": "m_write_after",
                "type": "general_file_write",
                "position": {"x": 500, "y": 100},
                "data": {
                    "label": "메인 복귀 후 파일 기록",
                    "config": {
                        "file_path": str(out_file_main),
                        "content": "MAIN_AFTER=[{{main_received}}]|SHARED=[{{shared_name}}]",
                        "overwrite": True,
                        "encoding": "utf-8",
                    },
                },
            },
            {"id": "m_end", "type": "flow_end", "position": {"x": 750, "y": 100}, "data": {"label": "끝", "config": {}}},
        ],
        "edges": [
            {"id": "me1", "source": "m_start", "target": "m_call"},
            {"id": "me2", "source": "m_call", "target": "m_write_after"},
            {"id": "me3", "source": "m_write_after", "target": "m_end"},
        ],
        "settings": {"execution_delay": 0.0},
        "variables": [
            {"name": "main_query", "type": "string", "defaultValue": "HELLO_RPA"},
            {"name": "shared_name", "type": "string", "defaultValue": "MAIN_ORIGINAL"},
            {"name": "main_received", "type": "string", "defaultValue": ""},
        ],
    }

    events = []
    async def cb(ev):
        events.append(ev)

    session_res = await flow_engine.run_flow(
        flow_id="flow_main_caller",
        flow_name="메인 호출 플로우",
        graph_data=main_graph,
        session_id=_uid("ses_test_subflow"),
        event_callback=cb,
    )

    assert session_res.status == "SUCCESS"
    assert out_file_main.exists()
    final_text = out_file_main.read_text(encoding="utf-8")
    # 서브 워크플로우에서 조합한 결과('PROCESSED:HELLO_RPA:SUB_INTERNAL')가 main_received로 반환되고,
    # 매핑하지 않은 동명의 변수 shared_name은 'MAIN_ORIGINAL' 그대로 보존되었는지 검증
    assert final_text == "MAIN_AFTER=[PROCESSED:HELLO_RPA:SUB_INTERNAL]|SHARED=[MAIN_ORIGINAL]"


@pytest.mark.asyncio
async def test_subflow_indirect_infinite_loop_detection():
    """
    3. 간접 무한 루프(Flow A -> Flow B -> Flow C -> Flow A) 런타임 콜 스택 차단 검증:
       - 단일 워크플로우 내부 루프가 아닌 다단계 워크플로우 간 순환 참조 발생 시,
         call_stack에서 즉시 감지하여 무한 루프에 빠지지 않고 FAILED 상태로 안전하게 중단되어야 함
    """
    def make_calling_graph(target_id: str, target_name: str):
        return {
            "nodes": [
                {"id": "st", "type": "flow_start", "position": {"x": 0, "y": 0}, "data": {"label": "시작", "config": {}}},
                {
                    "id": "call_node",
                    "type": "flow_call",
                    "position": {"x": 200, "y": 0},
                    "data": {
                        "label": f"{target_name} 호출",
                        "config": {"target_flow_id": target_id, "target_flow_name": target_name, "variable_mappings": []},
                    },
                },
                {"id": "ed", "type": "flow_end", "position": {"x": 400, "y": 0}, "data": {"label": "끝", "config": {}}},
            ],
            "edges": [
                {"id": "e1", "source": "st", "target": "call_node"},
                {"id": "e2", "source": "call_node", "target": "ed"},
            ],
            "settings": {"execution_delay": 0.0},
            "variables": [],
        }

    graph_a = make_calling_graph("flow_cycle_b", "플로우 B")
    graph_b = make_calling_graph("flow_cycle_c", "플로우 C")
    graph_c = make_calling_graph("flow_cycle_a", "플로우 A")

    _save_flow_to_db("flow_cycle_a", "플로우 A", graph_a)
    _save_flow_to_db("flow_cycle_b", "플로우 B", graph_b)
    _save_flow_to_db("flow_cycle_c", "플로우 C", graph_c)

    events = []
    async def cb(ev):
        events.append(ev)

    session_res = await flow_engine.run_flow(
        flow_id="flow_cycle_a",
        flow_name="플로우 A",
        graph_data=graph_a,
        session_id=_uid("ses_test_cycle"),
        event_callback=cb,
    )

    assert session_res.status == "FAILED"
    error_events = [e for e in events if e.get("event_type") == "ERROR"]
    assert len(error_events) > 0
    assert "순환 호출(무한 루프)이 감지" in error_events[-1]["content"]
    assert "플로우 A ➔ 플로우 B ➔ 플로우 C ➔ 플로우 A" in error_events[-1]["content"]


@pytest.mark.asyncio
async def test_subflow_max_call_depth_limit():
    """
    4. 순환 루프가 아니더라도 서브 워크플로우를 과도하게 연쇄 호출(Max Call Depth 초과)할 경우 차단 검증
    """
    # D1 -> D2 -> D3 -> D4 (max_call_depth=3으로 설정 시 D3에서 D4 호출 시점에 차단되어야 함)
    graph_d4 = {
        "nodes": [
            {"id": "st", "type": "flow_start", "position": {"x": 0, "y": 0}, "data": {"label": "시작", "config": {}}},
            {"id": "dl", "type": "general_delay", "position": {"x": 150, "y": 0}, "data": {"label": "대기", "config": {"seconds": 0.01}}},
            {"id": "ed", "type": "flow_end", "position": {"x": 300, "y": 0}, "data": {"label": "끝", "config": {}}},
        ],
        "edges": [
            {"id": "e1", "source": "st", "target": "dl"},
            {"id": "e2", "source": "dl", "target": "ed"},
        ],
        "settings": {"execution_delay": 0.0},
        "variables": [],
    }
    _save_flow_to_db("flow_depth_4", "깊이 4 플로우", graph_d4)

    for depth, next_id, next_name in [
        (3, "flow_depth_4", "깊이 4 플로우"),
        (2, "flow_depth_3", "깊이 3 플로우"),
        (1, "flow_depth_2", "깊이 2 플로우"),
    ]:
        g = {
            "nodes": [
                {"id": "st", "type": "flow_start", "position": {"x": 0, "y": 0}, "data": {"label": "시작", "config": {}}},
                {
                    "id": "call_n",
                    "type": "flow_call",
                    "position": {"x": 150, "y": 0},
                    "data": {
                        "label": f"{next_name} 호출",
                        "config": {"target_flow_id": next_id, "target_flow_name": next_name, "variable_mappings": []},
                    },
                },
                {"id": "ed", "type": "flow_end", "position": {"x": 300, "y": 0}, "data": {"label": "끝", "config": {}}},
            ],
            "edges": [
                {"id": "e1", "source": "st", "target": "call_n"},
                {"id": "e2", "source": "call_n", "target": "ed"},
            ],
            "settings": {"execution_delay": 0.0, "max_call_depth": 3},
            "variables": [],
        }
        _save_flow_to_db(f"flow_depth_{depth}", f"깊이 {depth} 플로우", g)
        if depth == 1:
            graph_d1 = g

    events = []
    async def cb(ev):
        events.append(ev)

    session_res = await flow_engine.run_flow(
        flow_id="flow_depth_1",
        flow_name="깊이 1 플로우",
        graph_data=graph_d1,
        session_id=_uid("ses_test_depth"),
        event_callback=cb,
    )

    assert session_res.status == "FAILED"
    error_events = [e for e in events if e.get("event_type") == "ERROR"]
    assert len(error_events) > 0
    assert "최대 연쇄 호출 깊이(3단계)를 초과" in error_events[-1]["content"]
