import pytest
from unittest.mock import patch
from app.nodes.ai import AINode
from app.nodes.base import ExecutionContext

@pytest.mark.asyncio
async def test_ai_node_streaming_lifecycle():
    events = []
    async def mock_callback(event):
        events.append(event)

    context = ExecutionContext(
        session_id="test_ses_ai",
        event_callback=mock_callback,
        check_cancelled=lambda: False,
        variables={"prev_text": "샘플 데이터입니다."}
    )

    node = AINode(
        id="ai_summarize_1",
        name="요약 AI 노드",
        config={
            "model": "qwen2.5:7b",
            "prompt": "다음 내용을 요약해: {{prev_text}}",
            "temperature": 0.3,
            "output_variable": "summary"
        }
    )

    # OllamaClient stream_generate mock
    async def mock_stream_generate(*args, **kwargs):
        tokens = ["요약된 ", "결과 ", "문장입니다."]
        for t in tokens:
            yield t

    with patch("app.nodes.ai.ollama_client.stream_generate", side_effect=mock_stream_generate):
        result = await node.run(context)

    assert result.success is True
    assert result.output == "요약된 결과 문장입니다."
    assert context.variables["summary"] == "요약된 결과 문장입니다."

    # 이벤트 검증
    # 1) 시작 이벤트 (프롬프트 포함 + 스크린샷)
    start_event = events[0]
    assert start_event["event_type"] == "START"
    assert "프롬프트: 다음 내용을 요약해: 샘플 데이터입니다." in start_event["content"]
    assert start_event["image_path"] is not None

    # 2) 스트리밍 청크 이벤트들
    chunk_events = [e for e in events if e["event_type"] == "STREAM_CHUNK"]
    assert len(chunk_events) == 3
    assert chunk_events[-1]["content"] == "요약된 결과 문장입니다."

    # 3) 완료 이벤트 (스크린샷 포함)
    success_event = events[-1]
    assert success_event["event_type"] == "SUCCESS"
    assert success_event["content"] == "요약된 결과 문장입니다."
    assert success_event["image_path"] is not None


@pytest.mark.asyncio
async def test_ai_node_error_handling():
    """Ollama 오류 문자열 수신 시 AI 노드가 실패(NodeResult(success=False))로 처리되는지 검증"""
    events = []
    async def mock_callback(event):
        events.append(event)

    context = ExecutionContext(
        session_id="test_ses_ai_err",
        event_callback=mock_callback,
        check_cancelled=lambda: False,
        variables={}
    )

    node = AINode(
        id="ai_err_1",
        name="에러 AI 노드",
        config={"model": "non_existent_model", "prompt": "질문"}
    )

    async def mock_stream_generate_err(*args, **kwargs):
        yield "[Ollama 오류 (404 Not Found): 모델 'non_existent_model'을(를) 찾을 수 없습니다.]"

    with patch("app.nodes.ai.ollama_client.stream_generate", side_effect=mock_stream_generate_err):
        result = await node.run(context)

    assert result.success is False
    assert "404 Not Found" in result.error
    assert any(e["event_type"] == "ERROR" and "404 Not Found" in e["content"] for e in events)

