import time
import uuid
import pytest
from unittest.mock import patch
from app.core.engine import flow_engine
from app.nodes.base import (
    ExecutionContext,
    coerce_variable_value,
    format_variable_for_template,
)
from app.nodes.general import render_template, GeneralNode
from app.nodes.ai import AINode
from app.nodes.agent import AgentNode


# =====================================================================
# 1. 이종 언어(TypeScript ↔ Python) 변수 타입 강제 변환 및 직렬화 테스트
# =====================================================================
def test_cross_language_variable_coercion_and_formatting():
    # 1) string
    assert coerce_variable_value(None, "string") == ""
    assert coerce_variable_value(True, "string") == "true"
    assert coerce_variable_value(False, "string") == "false"
    assert coerce_variable_value(42.0, "string") == "42"
    assert coerce_variable_value({"a": 1}, "string") == '{"a": 1}'

    # 2) number
    assert coerce_variable_value("123", "number") == 123
    assert isinstance(coerce_variable_value("123", "number"), int)
    assert coerce_variable_value("3.14", "number") == 3.14
    assert coerce_variable_value("10.0", "number") == 10
    assert coerce_variable_value("", "number") == 0
    assert coerce_variable_value(True, "number") == 1
    with pytest.raises(ValueError, match="숫자"):
        coerce_variable_value("not_a_number", "number")

    # 3) boolean
    assert coerce_variable_value("true", "boolean") is True
    assert coerce_variable_value("FALSE", "boolean") is False
    assert coerce_variable_value("1", "boolean") is True
    assert coerce_variable_value("0", "boolean") is False
    assert coerce_variable_value(1, "boolean") is True
    assert coerce_variable_value(0, "boolean") is False
    with pytest.raises(ValueError, match="논리형"):
        coerce_variable_value("invalid_bool", "boolean")

    # 4) json
    assert coerce_variable_value('{"name": "홍길동", "age": 30}', "json") == {"name": "홍길동", "age": 30}
    assert coerce_variable_value("[1, 2, 3]", "json") == [1, 2, 3]
    assert coerce_variable_value("", "json") == {}
    with pytest.raises(ValueError, match="JSON"):
        coerce_variable_value("{broken json", "json")

    # 5) 템플릿 문자열 치환 일관성 (Python True/False 대신 표준 true/false 등)
    vars_dict = {
        "flag": True,
        "count": 5.0,
        "payload": {"k": "v"},
        "empty": None,
    }
    rendered = render_template("flag={{flag}}, count={{count}}, payload={{payload}}, empty={{empty}}", vars_dict)
    assert rendered == 'flag=true, count=5, payload={"k": "v"}, empty='


# =====================================================================
# 2. ExecutionContext 엄격한 변수 스키마 검증 테스트
# =====================================================================
def test_execution_context_strict_variable_validation():
    schemas = {
        "user_name": {"name": "user_name", "type": "string", "defaultValue": "기본유저"},
        "retry_cnt": {"name": "retry_cnt", "type": "number", "defaultValue": "3"},
        "is_confirmed": {"name": "is_confirmed", "type": "boolean", "defaultValue": "false"},
        "meta_json": {"name": "meta_json", "type": "json", "defaultValue": '{"ok": true}'},
    }

    async def dummy_cb(ev):
        pass

    ctx = ExecutionContext(
        session_id="ses_var_test",
        event_callback=dummy_cb,
        check_cancelled=lambda: False,
        variable_schemas=schemas,
        strict_variables=True,
    )

    # 초기값 자동 정규화 검증
    assert ctx.variables["user_name"] == "기본유저"
    assert ctx.variables["retry_cnt"] == 3
    assert ctx.variables["is_confirmed"] is False
    assert ctx.variables["meta_json"] == {"ok": True}

    # 선언된 변수에 값 저장 시 선언 타입으로 자동 캐스팅 검증
    ctx.set_variable("retry_cnt", "42")
    assert ctx.variables["retry_cnt"] == 42

    ctx.set_variable("is_confirmed", "true")
    assert ctx.variables["is_confirmed"] is True

    # 선언되지 않은 변수에 저장 시도 -> ValueError 발생
    with pytest.raises(ValueError, match="선언되지 않은 출력 변수"):
        ctx.set_variable("undeclared_var", "hello")

    # 시스템 예약 변수에 사용자 출력 저장 시도 -> ValueError 발생
    with pytest.raises(ValueError, match="시스템 예약 변수"):
        ctx.set_variable("last_output", "hack", is_system=False)

    # 내부 시스템 플래그(is_system=True)로는 저장 가능
    ctx.set_variable("last_output", "system_ok", is_system=True)
    assert ctx.variables["last_output"] == "system_ok"


# =====================================================================
# 3. 워크플로우 전역 설정 (실행 속도 딜레이 및 기본 LLM 모델) 검증
# =====================================================================
@pytest.mark.asyncio
async def test_workflow_global_settings_execution_delay_and_default_model():
    # 1) 기본 LLM 모델명(default_llm_model)이 비어있는 AI 및 에이전트 노드에 주입되는지 검증
    flow_settings = {
        "execution_delay": 0.15,
        "default_llm_model": "qwen2.5:14b",
    }

    ai_node_data = {
        "id": "ai_1",
        "type": "ai_ollama",
        "data": {
            "label": "AI 요약",
            "config": {"model": "", "prompt": "안녕", "output_variable": "res"},
        },
    }
    agent_node_data = {
        "id": "ag_1",
        "type": "agent_basic",
        "data": {
            "label": "에이전트",
            "config": {"model": "", "prompt": "작업 수행", "output_variable": "res"},
        },
    }

    ai_instance = flow_engine.instantiate_node(ai_node_data, flow_settings=flow_settings)
    agent_instance = flow_engine.instantiate_node(agent_node_data, flow_settings=flow_settings)

    assert isinstance(ai_instance, AINode)
    assert ai_instance.model == "qwen2.5:14b"
    assert isinstance(agent_instance, AgentNode)
    assert agent_instance.model == "qwen2.5:14b"

    # 노드에 명시적인 모델이 설정된 경우 노드 설정이 우선됨을 검증
    custom_ai_data = {
        "id": "ai_2",
        "type": "ai_ollama",
        "data": {
            "label": "커스텀 AI",
            "config": {"model": "llama3.2:latest", "prompt": "안녕", "output_variable": "res"},
        },
    }
    custom_ai_instance = flow_engine.instantiate_node(custom_ai_data, flow_settings=flow_settings)
    assert custom_ai_instance.model == "llama3.2:latest"

    # 2) 워크플로우 실행 속도(execution_delay) 적용 검증
    events = []
    async def collect_ev(ev):
        events.append(ev)

    graph_data = {
        "settings": {"execution_delay": 0.15, "default_llm_model": "qwen2.5:7b"},
        "variables": [
            {"name": "clip_out", "type": "string", "defaultValue": "초기값", "description": "클립보드 결과"}
        ],
        "nodes": [
            {"id": "start", "type": "flow_start", "position": {"x": 0, "y": 0}, "data": {"label": "시작"}},
            {
                "id": "n1",
                "type": "general_clipboard_read",
                "position": {"x": 200, "y": 0},
                "data": {"label": "클립보드 읽기", "config": {"output_variable": "clip_out"}},
            },
            {"id": "end", "type": "flow_end", "position": {"x": 400, "y": 0}, "data": {"label": "끝"}},
        ],
        "edges": [
            {"id": "e1", "source": "start", "target": "n1"},
            {"id": "e2", "source": "n1", "target": "end"},
        ],
    }

    t0 = time.perf_counter()
    with patch("pyperclip.paste", return_value="클립보드데이터"):
        session = await flow_engine.run_flow(
            flow_id="flow_settings_test",
            flow_name="전역 설정 테스트",
            graph_data=graph_data,
            session_id=f"ses_settings_{uuid.uuid4().hex[:8]}",
            event_callback=collect_ev,
        )
    elapsed = time.perf_counter() - t0

    assert session.status == "SUCCESS"
    # n1 실행 직전 0.15초 딜레이가 들어갔으므로 최소 0.12초 이상 소요되어야 함
    assert elapsed >= 0.12


# =====================================================================
# 4. 미선언 출력 변수 및 미선언 템플릿 참조 차단 검증
# =====================================================================
@pytest.mark.asyncio
async def test_undeclared_variable_blocked_in_flow_engine():
    events = []
    async def collect_ev(ev):
        events.append(ev)

    # Case A: 선언되지 않은 출력 변수(output_variable) 사용 시 실행 차단
    graph_undeclared_out = {
        "settings": {"execution_delay": 0.0},
        "variables": [
            {"name": "declared_var", "type": "string", "defaultValue": ""}
        ],
        "nodes": [
            {"id": "start", "type": "flow_start", "position": {"x": 0, "y": 0}, "data": {"label": "시작"}},
            {
                "id": "n_clip",
                "type": "general_clipboard_read",
                "position": {"x": 200, "y": 0},
                "data": {"label": "클립보드 읽기", "config": {"output_variable": "not_declared_var"}},
            },
            {"id": "end", "type": "flow_end", "position": {"x": 400, "y": 0}, "data": {"label": "끝"}},
        ],
        "edges": [
            {"id": "e1", "source": "start", "target": "n_clip"},
            {"id": "e2", "source": "n_clip", "target": "end"},
        ],
    }

    ses_a = await flow_engine.run_flow(
        flow_id="flow_err_a",
        flow_name="미선언 출력변수 테스트",
        graph_data=graph_undeclared_out,
        session_id=f"ses_err_a_{uuid.uuid4().hex[:8]}",
        event_callback=collect_ev,
    )
    assert ses_a.status == "FAILED"
    assert any("선언되지 않은 출력 변수 'not_declared_var'" in ev.get("content", "") for ev in events)

    # Case B: 텍스트 입력 노드에 선언되지 않은 {{ghost_var}} 템플릿 참조 시 실행 차단
    events.clear()
    graph_undeclared_ref = {
        "settings": {"execution_delay": 0.0},
        "variables": [
            {"name": "declared_var", "type": "string", "defaultValue": "정상값"}
        ],
        "nodes": [
            {"id": "start", "type": "flow_start", "position": {"x": 0, "y": 0}, "data": {"label": "시작"}},
            {
                "id": "n_type",
                "type": "general_keyboard_type",
                "position": {"x": 200, "y": 0},
                "data": {"label": "텍스트 입력", "config": {"text": "안녕 {{ghost_var}}"}},
            },
            {"id": "end", "type": "flow_end", "position": {"x": 400, "y": 0}, "data": {"label": "끝"}},
        ],
        "edges": [
            {"id": "e1", "source": "start", "target": "n_type"},
            {"id": "e2", "source": "n_type", "target": "end"},
        ],
    }

    ses_b = await flow_engine.run_flow(
        flow_id="flow_err_b",
        flow_name="미선언 템플릿 참조 테스트",
        graph_data=graph_undeclared_ref,
        session_id=f"ses_err_b_{uuid.uuid4().hex[:8]}",
        event_callback=collect_ev,
    )
    assert ses_b.status == "FAILED"
    assert any("선언되지 않은 변수 '{{ghost_var}}'" in ev.get("content", "") for ev in events)

