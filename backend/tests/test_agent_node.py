import pytest
import uuid
from unittest.mock import patch, MagicMock, AsyncMock
from app.nodes.agent import AgentNode
from app.nodes.base import ExecutionContext, NodeResult
from app.core.engine import FlowEngine

@pytest.fixture
def mock_context():
    ctx = MagicMock(spec=ExecutionContext)
    ctx.session_id = "test_session_agent_123"
    ctx.variables = {}
    ctx.is_cancelled.return_value = False
    ctx.emit_event = AsyncMock()
    return ctx

def test_engine_instantiate_agent_node():
    engine = FlowEngine()
    node = engine.instantiate_node({
        "id": "node_agent_test",
        "type": "agent_basic",
        "data": {
            "label": "기본 에이전트 테스트",
            "config": {
                "model": "llama3.1",
                "prompt": "메모장을 열고 테스트라고 적어줘",
                "include_screen_capture": True,
                "skill_mode": "preset",
                "preset_name": "basic_interaction"
            }
        }
    })
    assert isinstance(node, AgentNode)
    assert node.id == "node_agent_test"
    assert node.name == "기본 에이전트 테스트"
    assert node.include_screen_capture is True
    assert node.preset_name == "basic_interaction"

@pytest.mark.asyncio
async def test_agent_node_direct_answer(mock_context):
    config = {
        "model": "llama3.1",
        "prompt": "간단한 질문입니다",
        "max_steps": 5,
        "output_variable": "agent_ans"
    }
    agent = AgentNode("agent_1", "테스트 에이전트", config)

    async def mock_stream_chat(*args, **kwargs):
        yield {"type": "content", "token": "네, "}
        yield {"type": "content", "token": "답변드립니다."}
        yield {"type": "done", "message": {"content": "네, 답변드립니다."}}

    with patch("app.services.ollama_client.ollama_client.stream_chat", side_effect=mock_stream_chat):
        result = await agent.run(mock_context)

    assert isinstance(result, NodeResult)
    assert result.success is True
    assert mock_context.variables["agent_ans"] == "네, 답변드립니다."
    assert mock_context.emit_event.call_count >= 2

@pytest.mark.asyncio
async def test_agent_node_tool_calling_loop(mock_context):
    config = {
        "model": "llama3.1",
        "prompt": "버튼을 찾아 클릭해줘",
        "max_steps": 5
    }
    agent = AgentNode("agent_2", "도구호출 에이전트", config)

    call_count = 0
    async def mock_multi_step_chat(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            # 1회차: get_screen_elements 도구 호출
            yield {
                "type": "done",
                "message": {
                    "content": "화면을 스캔하겠습니다.",
                    "tool_calls": [{
                        "function": {
                            "name": "get_screen_elements",
                            "arguments": {}
                        }
                    }]
                }
            }
        else:
            # 2회차: 최종 완료 답변
            yield {"type": "content", "token": "스캔 후 작업을 완료했습니다."}
            yield {
                "type": "done",
                "message": {
                    "content": "스캔 후 작업을 완료했습니다."
                }
            }

    with patch("app.services.ollama_client.ollama_client.stream_chat", side_effect=mock_multi_step_chat), \
         patch("app.nodes.agent.execute_agent_tool", return_value="#1 [버튼] 저장 (X: 100, Y: 200)") as mock_exec:
        result = await agent.run(mock_context)

    assert isinstance(result, NodeResult)
    assert result.success is True
    assert call_count == 2
    mock_exec.assert_called_once_with("get_screen_elements", {}, context=mock_context)
    assert mock_context.variables["agent_result"] == "스캔 후 작업을 완료했습니다."

@pytest.mark.asyncio
async def test_agent_node_cancellation(mock_context):
    mock_context.is_cancelled.return_value = True
    config = {"model": "llama3.1", "prompt": "중단 테스트"}
    agent = AgentNode("agent_3", "취소 에이전트", config)

    result = await agent.run(mock_context)

    assert isinstance(result, NodeResult)
    assert result.success is False
    assert "취소" in result.error or "중단" in result.error

@pytest.mark.asyncio
async def test_flow_engine_with_agent_node():
    """FlowEngine 전체 파이프라인에서 agent_basic 노드가 정상적으로 실행되고 성공하는지 검증"""
    engine = FlowEngine()
    session_id = f"ses_test_agent_{uuid.uuid4().hex[:8]}"

    graph_data = {
        "nodes": [
            {
                "id": "node_start",
                "type": "flow_start",
                "position": {"x": 0, "y": 0},
                "data": {"label": "시작", "config": {}}
            },
            {
                "id": "node_agent",
                "type": "agent_basic",
                "position": {"x": 200, "y": 0},
                "data": {
                    "label": "기본 에이전트",
                    "config": {
                        "model": "llama3.1",
                        "prompt": "테스트 에이전트 작업",
                        "include_screen_capture": False
                    }
                }
            },
            {
                "id": "node_end",
                "type": "flow_end",
                "position": {"x": 400, "y": 0},
                "data": {"label": "끝", "config": {}}
            }
        ],
        "edges": [
            {"id": "e1", "source": "node_start", "target": "node_agent"},
            {"id": "e2", "source": "node_agent", "target": "node_end"}
        ]
    }

    async def mock_stream_chat(*args, **kwargs):
        yield {"type": "content", "token": "에이전트가 작업을 완수했습니다."}
        yield {"type": "done", "message": {"content": "에이전트가 작업을 완수했습니다."}}

    events = []
    async def mock_callback(payload):
        events.append(payload)

    with patch("app.services.ollama_client.ollama_client.stream_chat", side_effect=mock_stream_chat):
        session = await engine.run_flow(
            flow_id="flow_agent_test",
            flow_name="에이전트 테스트 Flow",
            graph_data=graph_data,
            session_id=session_id,
            event_callback=mock_callback
        )

    assert session.status == "SUCCESS"
    assert any(e.get("event_type") == "START" and e.get("node_id") == "node_agent" for e in events)
    assert any(e.get("event_type") == "SUCCESS" and e.get("node_id") == "node_agent" for e in events)
    assert any(e.get("event_type") == "SESSION_FINISHED" and e.get("status") == "SUCCESS" for e in events)


@pytest.mark.asyncio
async def test_agent_node_custom_zero_skills_no_hidden_prompts(mock_context):
    """커스텀 모드에서 스킬 0개 선택 시 시스템 프롬프트 및 도구 정보가 일절 주입되지 않는지 검증"""
    config = {
        "model": "qwen3.8:27b",
        "prompt": "네이버 홈페이지 켰는데, 아무 버튼이나 클릭해봐?",
        "system_prompt": "",
        "skill_mode": "custom",
        "custom_skills": [],
        "include_screen_capture": False,
        "max_steps": 5
    }
    agent = AgentNode("agent_zero", "스킬0개 에이전트", config)

    captured_kwargs = {}
    async def mock_stream_chat(*args, **kwargs):
        nonlocal captured_kwargs
        captured_kwargs = kwargs
        yield {"type": "content", "token": "도구가 없어 직접 클릭할 수는 없지만 방법을 안내해 드립니다."}
        yield {"type": "done", "message": {"content": "도구가 없어 직접 클릭할 수는 없지만 방법을 안내해 드립니다."}}

    with patch("app.services.ollama_client.ollama_client.stream_chat", side_effect=mock_stream_chat):
        result = await agent.run(mock_context)

    assert result.success is True
    # 1. tools는 None이어야 함
    assert captured_kwargs.get("tools") is None

    # 2. messages에 미작성 시 기본 시스템 프롬프트가 포함되어야 하고 도구 프롬프트는 없어야 함
    messages = captured_kwargs.get("messages", [])
    from app.nodes.agent import DEFAULT_AGENT_SYSTEM_PROMPT
    assert messages[0]["role"] == "system"
    assert messages[0]["content"] == DEFAULT_AGENT_SYSTEM_PROMPT
    assert "get_screen_elements" not in messages[0]["content"]
    assert messages[1]["role"] == "user"
    assert messages[1]["content"] == "네이버 홈페이지 켰는데, 아무 버튼이나 클릭해봐?"
    assert "get_screen_elements" not in messages[1]["content"]


@pytest.mark.asyncio
async def test_agent_node_screenshot_no_prompt_text_tampering(mock_context):
    """스크린샷 포함 시 사용자 프롬프트 텍스트를 변조하지 않고 이미지만 첨부되는지 검증"""
    config = {
        "model": "qwen3.8:27b",
        "prompt": "현재 화면 요약해줘",
        "system_prompt": "지정된 시스템 프롬프트",
        "skill_mode": "custom",
        "custom_skills": [],
        "include_screen_capture": True,
        "max_steps": 3
    }
    agent = AgentNode("agent_shot", "화면캡처 에이전트", config)

    captured_kwargs = {}
    async def mock_stream_chat(*args, **kwargs):
        nonlocal captured_kwargs
        captured_kwargs = kwargs
        yield {"type": "content", "token": "화면을 확인했습니다."}
        yield {"type": "done", "message": {"content": "화면을 확인했습니다."}}

    # screen_capture_service 모킹 (실제 규격인 tuple[Image, dict] 반환)
    from PIL import Image
    real_img = Image.new("RGB", (10, 10), color="red")
    with patch("app.services.ollama_client.ollama_client.stream_chat", side_effect=mock_stream_chat), \
         patch("app.services.screen_capture.screen_capture_service.capture_display", return_value=(real_img, {"width": 10, "height": 10})), \
         patch("app.services.screen_capture.screen_capture_service.capture", return_value="/static/shot.webp"):
        result = await agent.run(mock_context)

    assert result.success is True
    messages = captured_kwargs.get("messages", [])
    # messages[0]: 시스템 프롬프트 (사용자가 직접 입력한 것만!)
    assert messages[0]["role"] == "system"
    assert messages[0]["content"] == "지정된 시스템 프롬프트"
    assert "get_screen_elements" not in messages[0]["content"]
    assert "base_system_instructions" not in messages[0]["content"]

    # messages[1]: 사용자 메시지 (텍스트 변조 없이 원문 유지, images 첨부)
    assert messages[1]["role"] == "user"
    assert messages[1]["content"] == "현재 화면 요약해줘"
    assert "현재 PC 화면 스크린샷이 첨부되었습니다" not in messages[1]["content"]
    assert "images" in messages[1]
    assert len(messages[1]["images"]) == 1

    # AGENT_THINKING 이벤트 발행 검증 (썸네일 image_path 포함)
    thinking_calls = [c for c in mock_context.emit_event.call_args_list if c.kwargs.get("event_type") == "AGENT_THINKING"]
    assert len(thinking_calls) >= 1
    assert "📷 실행 시점의 PC 화면 전체를 캡처하여 프롬프트에 첨부했습니다." in thinking_calls[0].kwargs.get("content", "")
    assert thinking_calls[0].kwargs.get("image_path") == "/static/shot.webp"

@pytest.mark.asyncio
async def test_agent_node_default_system_prompt_when_empty(mock_context):
    from app.nodes.agent import DEFAULT_AGENT_SYSTEM_PROMPT
    config = {
        "model": "llama3.1",
        "prompt": "시스템 프롬프트를 비워둔 테스트",
        "system_prompt": "",
        "max_steps": 2
    }
    agent = AgentNode("agent_sys_test", "기본 프롬프트 테스트", config)

    captured_kwargs = {}
    async def mock_stream_chat(*args, **kwargs):
        nonlocal captured_kwargs
        captured_kwargs = kwargs
        yield {"type": "content", "token": "테스트 답변"}
        yield {"type": "done", "message": {"content": "테스트 답변"}}

    with patch("app.services.ollama_client.ollama_client.stream_chat", side_effect=mock_stream_chat):
        result = await agent.run(mock_context)

    assert result.success is True
    messages = captured_kwargs.get("messages", [])
    assert len(messages) >= 2
    assert messages[0]["role"] == "system"
    assert messages[0]["content"] == DEFAULT_AGENT_SYSTEM_PROMPT

@pytest.mark.asyncio
async def test_agent_node_fallback_when_final_answer_empty(mock_context):
    config = {
        "model": "llama3.1",
        "prompt": "답변이 비어있는 경우 테스트",
        "output_variable": "out_res",
        "max_steps": 2
    }
    agent = AgentNode("agent_empty_test", "빈 답변 에이전트", config)

    async def mock_empty_stream_chat(*args, **kwargs):
        # content 없이 바로 done
        yield {"type": "done", "message": {"content": "", "tool_calls": []}}

    with patch("app.services.ollama_client.ollama_client.stream_chat", side_effect=mock_empty_stream_chat):
        result = await agent.run(mock_context)

    assert result.success is True
    assert result.output == "에이전트 자동화 작업을 완료했습니다."
    assert mock_context.variables["out_res"] == "에이전트 자동화 작업을 완료했습니다."


@pytest.mark.asyncio
async def test_agent_node_num_ctx_binding(mock_context):
    """노드 개별 설정 > 워크플로우 전역 설정 > 기본 8192 num_ctx 우선순위 검증"""
    # 1. 노드 개별 설정 num_ctx (16384)
    config = {
        "model": "llama3.1",
        "prompt": "컨텍스트 크기 테스트",
        "num_ctx": 16384
    }
    agent = AgentNode("agent_ctx_1", "컨텍스트 에이전트 1", config)
    mock_context.flow_settings = {"default_num_ctx": 32768}

    captured_kwargs = {}
    async def mock_stream_chat(*args, **kwargs):
        nonlocal captured_kwargs
        captured_kwargs = kwargs
        yield {"type": "content", "token": "완료"}
        yield {"type": "done", "message": {"content": "완료"}}

    with patch("app.services.ollama_client.ollama_client.stream_chat", side_effect=mock_stream_chat):
        res = await agent.run(mock_context)
    assert res.success is True
    assert captured_kwargs.get("num_ctx") == 16384

    # 2. 워크플로우 전역 설정 num_ctx (32768) 폴백
    config2 = {
        "model": "llama3.1",
        "prompt": "전역 컨텍스트 크기 테스트"
    }
    agent2 = AgentNode("agent_ctx_2", "컨텍스트 에이전트 2", config2)
    with patch("app.services.ollama_client.ollama_client.stream_chat", side_effect=mock_stream_chat):
        res2 = await agent2.run(mock_context)
    assert res2.success is True
    assert captured_kwargs.get("num_ctx") == 32768

    # 3. 미지정 시 기본 8192
    mock_context.flow_settings = {}
    agent3 = AgentNode("agent_ctx_3", "컨텍스트 에이전트 3", config2)
    with patch("app.services.ollama_client.ollama_client.stream_chat", side_effect=mock_stream_chat):
        res3 = await agent3.run(mock_context)
    assert res3.success is True
    assert captured_kwargs.get("num_ctx") == 8192


@pytest.mark.asyncio
async def test_agent_node_ollama_error_handling(mock_context):
    """Ollama 오류(HTTP 400 등) 발생 시 에이전트 노드가 성공이 아닌 실패(ERROR)로 처리되는지 검증"""
    config = {
        "model": "llama3.1",
        "prompt": "에러 발생 유도 테스트"
    }
    agent = AgentNode("agent_err", "에러 에이전트", config)

    async def mock_stream_chat_error(*args, **kwargs):
        yield {
            "type": "error",
            "error": "[Ollama 오류 (400): context window exceeded]"
        }

    with patch("app.services.ollama_client.ollama_client.stream_chat", side_effect=mock_stream_chat_error):
        res = await agent.run(mock_context)

    assert isinstance(res, NodeResult)
    assert res.success is False
    assert "context window exceeded" in res.error

    # ERROR 이벤트 방출 검증
    error_events = [c for c in mock_context.emit_event.call_args_list if c.kwargs.get("event_type") == "ERROR"]
    assert len(error_events) >= 1
    assert "context window exceeded" in error_events[0].kwargs.get("content", "")



