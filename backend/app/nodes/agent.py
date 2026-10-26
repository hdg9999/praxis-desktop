"""
Basic Agent Node (ReAct Tool-Calling Autonomous RPA Agent)
사용자의 자연어 지시에 따라 등록된 스킬셋을 자율적으로 선택 및 실행하여 작업을 완수하는 에이전트 노드입니다.
"""

import asyncio
import base64
import io
import json
import logging
import re
from typing import Dict, Any, List, Optional

from app.nodes.base import BaseNode, ExecutionContext, NodeResult
from app.nodes.general import render_template
from app.services.ollama_client import ollama_client
from app.services.screen_capture import screen_capture_service
from app.core.config import settings
from app.nodes.agent_tools import get_agent_tools_schema, execute_agent_tool

logger = logging.getLogger(__name__)

DEFAULT_AGENT_SYSTEM_PROMPT = "당신은 데스크톱 자동화 전문 AI 에이전트입니다. 주어진 도구(스킬)를 활용하여 사용자의 지시 목표를 완수하세요."

# Ollama /api/chat Structured Outputs (format 파라미터) 전용 JSON Schema
# 사용자의 시스템 프롬프트(system_prompt) 수정 여부와 무관하게 API 디코더(Grammar) 레벨에서
# 최종 완료 여부(is_complete) 및 목표 달성 성공 여부(is_success)를 구조화된 JSON으로 강제 판정합니다.
AGENT_VERDICT_JSON_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "thought": {
            "type": "string",
            "description": "에이전트의 도구 실행 이력과 응답을 바탕으로 작업 완료 및 성공 여부를 판단한 근거",
        },
        "is_complete": {
            "type": "boolean",
            "description": "추가 도구 호출이나 다음 단계 없이 모든 작업이 종료되었는지 여부 (다음 단계 확인/실행이 더 필요하면 false)",
        },
        "is_success": {
            "type": "boolean",
            "description": "사용자의 지시 목표를 실제로 완수했는지 여부 (완수 시 true, 실패했거나 미완료 상태면 false)",
        },
        "reason": {
            "type": "string",
            "description": "최종 성공 요약 또는 실패/미완료 사유",
        },
    },
    "required": ["thought", "is_complete", "is_success", "reason"],
}

_JSON_CODEBLOCK_RE = re.compile(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", re.IGNORECASE)

# 도구 호출 없이 텍스트만 출력되었을 때 '아직 완료된 것이 아니라 다음 단계를 진행하겠다는 미완료 계획'인지 판별하는 패턴
_INCOMPLETE_PLANNING_ENDINGS = (
    "해 보겠습니다",
    "해보겠습니다",
    "해 보겠어요",
    "해보겠어요",
    "확인해 보겠습니다",
    "확인해보겠습니다",
    "찾아보겠습니다",
    "찾아 보겠습니다",
    "열어보겠습니다",
    "열어 보겠습니다",
    "시도해 보겠습니다",
    "시도해보겠습니다",
    "살펴보겠습니다",
    "살펴 보겠습니다",
    "진행하겠습니다",
    "진행해 보겠습니다",
    "진행해보겠습니다",
    "클릭하겠습니다",
    "클릭해 보겠습니다",
    "실행하겠습니다",
    "실행해 보겠습니다",
    "스캔하겠습니다",
    "스캔해 보겠습니다",
    "촬영하겠습니다",
    "촬영해 보겠습니다",
    "확인하겠습니다",
    "열어야 합니다",
    "확인이 필요합니다",
    "필요가 있습니다",
)

_INCOMPLETE_PLANNING_EN_PHRASES = (
    "let me check",
    "let me try",
    "let me open",
    "let me take",
    "let me first",
    "let me scan",
    "let me click",
    "let me find",
    "let's check",
    "i will now",
    "i'll check",
    "i'll try",
    "i need to check",
    "i need to open",
)

_PLAIN_FAILURE_KEYWORDS = (
    "찾을 수 없어",
    "찾을 수 없습니다",
    "실행할 수 없어",
    "실행할 수 없습니다",
    "수행할 수 없어",
    "수행할 수 없습니다",
    "완료하지 못했",
    "완료할 수 없",
    "실패했습니다",
    "실패하였습니다",
    "불가능합니다",
    "도구가 없어",
    "권한이 없어",
    "작업을 진행할 수 없",
)


def extract_agent_json_decision(text: str) -> Optional[Dict[str, Any]]:
    """
    모델 응답 문자열에서 에이전트 최종 판정 JSON 객체({"thought": ..., "is_success": ..., "result": ...})를 추출합니다.
    JSON 판정 키("is_success" 또는 "success" 또는 "task_success")가 포함된 유효한 JSON이 없으면 None을 반환합니다.
    """
    if not text or not str(text).strip():
        return None

    cleaned = str(text).strip()
    candidates: List[str] = []

    # 1. 전체 텍스트가 JSON 객체인 경우
    if cleaned.startswith("{") and cleaned.endswith("}"):
        candidates.append(cleaned)

    # 2. ```json ... ``` 코드블록 추출
    for match in _JSON_CODEBLOCK_RE.finditer(cleaned):
        candidates.append(match.group(1).strip())

    # 3. 본문 내 가장 바깥쪽 중괄호 블록 후보 추출 (뒤에서부터 탐색 우선)
    last_brace_end = cleaned.rfind("}")
    if last_brace_end != -1:
        for idx, ch in enumerate(cleaned):
            if ch == "{" and idx < last_brace_end:
                sub = cleaned[idx : last_brace_end + 1]
                if "is_success" in sub or "success" in sub:
                    candidates.append(sub)

    for cand in candidates:
        try:
            parsed = json.loads(cand)
        except Exception:
            continue

        if not isinstance(parsed, dict):
            continue

        # 판정 키 확인
        success_key = None
        for k in ("is_success", "success", "task_success", "completed"):
            if k in parsed:
                success_key = k
                break

        if success_key is None:
            continue

        raw_val = parsed[success_key]
        if isinstance(raw_val, bool):
            is_success = raw_val
        elif isinstance(raw_val, (int, float)):
            is_success = bool(raw_val)
        else:
            val_str = str(raw_val).strip().lower()
            is_success = val_str in ("true", "1", "yes", "y", "success", "성공")

        thought = str(
            parsed.get("thought")
            or parsed.get("reasoning")
            or parsed.get("reason")
            or parsed.get("plan")
            or ""
        ).strip()

        result_text = str(
            parsed.get("result")
            or parsed.get("final_answer")
            or parsed.get("answer")
            or parsed.get("output")
            or parsed.get("message")
            or parsed.get("content")
            or ""
        ).strip()

        return {
            "is_success": is_success,
            "thought": thought,
            "result": result_text,
            "raw": parsed,
        }

    return None


def is_incomplete_planning_text(text: str) -> bool:
    """
    도구 호출 없이 반환된 텍스트가 '최종 작업 완료 보고'가 아니라
    '다음 단계를 확인/시도해 보겠다'는 미완료 중간 추론인지 판별합니다.
    """
    if not text or not str(text).strip():
        return False

    cleaned = str(text).strip()
    # 문장 부호 제거 후 끝부분 검사
    stripped_tail = cleaned.rstrip(".!?~…\"'` \n\r\t")

    for ending in _INCOMPLETE_PLANNING_ENDINGS:
        if stripped_tail.endswith(ending):
            return True

    lower_text = cleaned.lower()
    # 마지막 문단 기준 영어 계획 표현 확인
    last_paragraph = lower_text.split("\n")[-1].strip()
    for phrase in _INCOMPLETE_PLANNING_EN_PHRASES:
        if phrase in last_paragraph:
            return True

    return False


def is_failure_plain_text(
    text: str,
    any_tool_called: bool,
    any_tool_succeeded: bool,
    last_tool_failed: bool,
) -> bool:
    """
    모델이 JSON 포맷 없이 평문으로만 답변했을 때,
    직전 도구 실행이 실패했거나 명시적인 작업 실패/불가 사유를 보고하는 응답인지 판별합니다.
    """
    if not text or not str(text).strip():
        return False

    cleaned = str(text).strip()
    has_fail_keyword = any(kw in cleaned for kw in _PLAIN_FAILURE_KEYWORDS)

    # 도구를 호출했으나 마지막 도구가 실패(또는 성공한 도구가 전무)하고 실패 키워드가 있는 경우
    if any_tool_called and (last_tool_failed or not any_tool_succeeded) and has_fail_keyword:
        return True

    # 도구 호출 없이도 명백하게 작업을 수행할 수 없다고 실패 선언한 경우
    explicit_abort_phrases = (
        "작업을 완료할 수 없습니다",
        "작업을 수행할 수 없습니다",
        "작업을 완료하지 못했습니다",
        "작업에 실패했습니다",
        "진행할 수 없습니다",
    )
    if any(p in cleaned for p in explicit_abort_phrases):
        return True

    return False


class AgentNode(BaseNode):
    """
    신규 AI 코어 스킬 노드: '기본 에이전트'
    - Ollama /api/chat 네이티브 Tool Calling
    - 스킬셋 프리셋/커스텀 필터링
    - 화면 캡처 비전 멀티모달 주입
    - ReAct 자율 실행 루프 & Thinking/ToolCall/ToolResult 실시간 이벤트
    - 최종 성공 여부(is_success) 검증 및 루프 횟수 초과 시 엄격한 실패(ERROR) 처리
    - F12 KillSwitch 비상 중단 감시
    """

    def __init__(self, id: str, name: str, config: Dict[str, Any]):
        super().__init__(id, name, "AGENT", config)
        self.llm_backend: str = config.get("llm_backend", "ollama")
        raw_model = str(config.get("model") or "").strip()
        default_model = str(config.get("default_llm_model") or "").strip()
        self.model: str = raw_model or default_model or "llama3.1"
        self.prompt: str = config.get("prompt", "")
        self.system_prompt: str = config.get("system_prompt", "")
        self.include_screen_capture: bool = config.get("include_screen_capture", False)
        self.skill_mode: str = config.get("skill_mode", "preset")
        self.preset_name: str = config.get("preset_name", "basic_interaction")
        self.custom_skills: List[str] = config.get("custom_skills", [])
        self.max_steps: int = int(config.get("max_steps", 10))
        self.temperature: float = float(config.get("temperature", 0.3))
        self.num_ctx: int = int(config.get("num_ctx", 8192))
        self.output_variable: str = config.get("output_variable", "agent_result")

    def _substitute_variables(self, text: str, variables: Dict[str, Any]) -> str:
        """{{variable}} 형태의 템플릿 치환 (이종 언어 타입 안전 직렬화 포함)"""
        if not text:
            return ""
        return render_template(text, variables)

    async def _verify_completion_with_schema(
        self,
        goal_prompt: str,
        tool_history: List[str],
        thinking_text: str,
        assistant_text: str,
    ) -> Optional[Dict[str, Any]]:
        """
        Ollama /api/chat의 format(JSON Schema) 파라미터를 사용하여
        사용자의 시스템 프롬프트 설정과 무관하게 API 디코더(Grammar) 레벨에서
        작업 완료 여부(is_complete)와 목표 달성 성공 여부(is_success)를 구조화된 JSON으로 검증합니다.
        """
        stream_is_mocked = hasattr(ollama_client.stream_chat, "_mock_name") or hasattr(
            ollama_client.stream_chat, "assert_called"
        )
        chat_is_mocked = hasattr(ollama_client.chat, "_mock_name") or hasattr(
            ollama_client.chat, "assert_called"
        )
        if stream_is_mocked and not chat_is_mocked:
            # 단위 테스트에서 stream_chat만 모킹하고 chat은 모킹하지 않은 경우 로컬 HTTP 호출 생략
            return None

        history_block = "\n".join(tool_history[-15:]) if tool_history else "실행된 도구 없음"
        verdict_messages = [
            {
                "role": "system",
                "content": (
                    "당신은 데스크톱 자동화 워크플로우 엔진의 작업 완료 검증기(Task Completion Verifier)입니다. "
                    "사용자의 원래 지시 목표, 도구 실행 결과 이력, 에이전트의 마지막 추론 및 응답을 대조하여 "
                    "작업이 실제로 완료되었는지(is_complete) 그리고 목표를 성공적으로 달성했는지(is_success)를 엄격하게 판정하세요."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"[사용자의 원래 지시 목표]\n{goal_prompt}\n\n"
                    f"[도구 실행 이력]\n{history_block}\n\n"
                    f"[에이전트의 마지막 추론(Thinking)]\n{thinking_text or '없음'}\n\n"
                    f"[에이전트의 최종 응답]\n{assistant_text}\n\n"
                    "판정 기준:\n"
                    "1. 에이전트가 아직 다음 단계를 수행해야 하거나('~해 보겠습니다', '~확인이 필요합니다' 등) 중간 추론 상태에서 멈췄다면 is_complete=false, is_success=false로 설정하세요.\n"
                    "2. 필수 도구 실행이 실패하여 목표를 달성하지 못했거나 작업 불가/실패를 안내하고 있다면 is_complete=true, is_success=false로 설정하세요.\n"
                    "3. 사용자의 지시 목표가 실제로 달성되었거나 질문에 대한 정상적인 최종 답변이 완료된 경우에만 is_complete=true, is_success=true로 설정하세요."
                ),
            },
        ]

        try:
            resp_msg = await ollama_client.chat(
                model=self.model,
                messages=verdict_messages,
                tools=None,
                temperature=0.0,
                num_ctx=self.num_ctx,
                format=AGENT_VERDICT_JSON_SCHEMA,
            )
            if not isinstance(resp_msg, dict) or resp_msg.get("error"):
                return None
            content_str = str(resp_msg.get("content") or "").strip()
            if not content_str:
                return None
            parsed = json.loads(content_str)
            if not isinstance(parsed, dict):
                return None
            return {
                "thought": str(parsed.get("thought") or "").strip(),
                "is_complete": bool(parsed.get("is_complete", True)),
                "is_success": bool(parsed.get("is_success", False)),
                "reason": str(parsed.get("reason") or "").strip(),
            }
        except Exception as e:
            logger.debug(f"[AgentNode:{self.id}] Structured output verification fallback: {e}")
            return None

    async def run(self, context: ExecutionContext) -> NodeResult:
        raw_cfg_model = str(self.config.get("model") or "").strip()
        flow_settings = getattr(context, "flow_settings", None)
        flow_default_model = ""
        if isinstance(flow_settings, dict):
            flow_default_model = str(flow_settings.get("default_llm_model") or "").strip()
        active_model = raw_cfg_model or flow_default_model or self.model
        self.model = active_model

        # num_ctx 추출 (노드 개별 설정 > 워크플로우 전역 설정 > 기본 8192)
        raw_num_ctx = self.config.get("num_ctx")
        flow_default_num_ctx = None
        if isinstance(flow_settings, dict):
            flow_default_num_ctx = flow_settings.get("default_num_ctx")
        active_num_ctx = 8192
        if raw_num_ctx is not None and str(raw_num_ctx).isdigit() and int(raw_num_ctx) > 0:
            active_num_ctx = int(raw_num_ctx)
        elif flow_default_num_ctx is not None and str(flow_default_num_ctx).isdigit() and int(flow_default_num_ctx) > 0:
            active_num_ctx = int(flow_default_num_ctx)
        self.num_ctx = active_num_ctx

        logger.info(f"[AgentNode:{self.id}] Starting agent task: '{self.name}' with model '{self.model}', num_ctx: {self.num_ctx}")

        if context.is_cancelled():
            return NodeResult(success=False, error="실행이 취소되었습니다.")

        # 1. 프롬프트 변수 치환
        resolved_prompt = self._substitute_variables(self.prompt, context.variables)
        resolved_sys_prompt = self._substitute_variables(self.system_prompt, context.variables)

        # 2. 작업 시작 안내 이벤트
        short_prompt = resolved_prompt[:50] + "..." if len(resolved_prompt) > 50 else resolved_prompt
        await context.emit_event(
            node_id=self.id,
            node_name=self.name,
            node_type=self.node_type,
            event_type="START",
            content=f"🤖 에이전트 작업을 시작합니다 (모델: {self.model})\n지시 내용: \"{short_prompt}\""
        )

        # 3. 화면 캡처 멀티모달 처리 (옵션)
        base64_screenshot: Optional[str] = None
        screenshot_preview_url: Optional[str] = None
        if self.include_screen_capture:
            try:
                capture_res = screen_capture_service.capture_display(target="all")
                img = capture_res[0] if isinstance(capture_res, tuple) else capture_res
                buf = io.BytesIO()
                img.save(buf, format="PNG")
                base64_screenshot = base64.b64encode(buf.getvalue()).decode("utf-8")

                # 타임라인 썸네일 미리보기용 WebP 파일 저장
                try:
                    screenshot_preview_url = screen_capture_service.capture(
                        session_id=context.session_id,
                        label=f"agent_{self.id}_initial",
                        target="all"
                    )
                except Exception as save_err:
                    logger.debug(f"[AgentNode] Optional screenshot save error: {save_err}")

                # 순수 이미지 첨부 (프롬프트 텍스트 변조 제거)
                await context.emit_event(
                    node_id=self.id,
                    node_name=self.name,
                    node_type=self.node_type,
                    event_type="AGENT_THINKING",
                    content="📷 실행 시점의 PC 화면 전체를 캡처하여 프롬프트에 첨부했습니다.",
                    image_path=screenshot_preview_url
                )
            except Exception as e:
                logger.error(f"[AgentNode] Failed to capture initial screenshot: {e}", exc_info=True)

        # 4. 스킬셋(Tool Schemas) 필터링 생성
        tools_schema = get_agent_tools_schema(
            skill_mode=self.skill_mode,
            preset_name=self.preset_name,
            custom_skills=self.custom_skills
        )

        tool_names_str = ", ".join([t["function"]["name"] for t in tools_schema]) if tools_schema else "없음 (도구 비활성화)"
        logger.info(f"[AgentNode:{self.id}] Loaded {len(tools_schema)} tools: {tool_names_str}")

        # 5. 시스템 프롬프트 및 대화 메시지 구성
        # 사용자가 직접 입력한 시스템 프롬프트가 있을 때만 우선 적용하고, 미작성 시 인스펙터 플레이스홀더에 안내된 기본 시스템 프롬프트 적용
        messages: List[Dict[str, Any]] = []
        if resolved_sys_prompt and resolved_sys_prompt.strip():
            messages.append({"role": "system", "content": resolved_sys_prompt.strip()})
        else:
            messages.append({"role": "system", "content": DEFAULT_AGENT_SYSTEM_PROMPT})

        user_message: Dict[str, Any] = {"role": "user", "content": resolved_prompt}
        if base64_screenshot:
            user_message["images"] = [base64_screenshot]
        messages.append(user_message)

        # 6. ReAct 에이전트 자율 실행 루프
        final_answer = ""
        completed_normally = False
        task_succeeded = False
        failure_reason = ""
        last_step_thought = ""
        any_tool_called = False
        any_tool_succeeded = False
        last_tool_failed = False
        retried_incomplete = False
        tool_history: List[str] = []

        for step in range(1, self.max_steps + 1):
            if context.is_cancelled():
                await context.emit_event(
                    node_id=self.id,
                    node_name=self.name,
                    node_type=self.node_type,
                    event_type="ERROR",
                    content="⚠️ 사용자에 의해 작업이 비상 중단(F12)되었습니다."
                )
                return NodeResult(success=False, error="사용자에 의해 작업이 비상 중단(F12)되었습니다.")

            logger.info(f"[AgentNode:{self.id}] Starting Loop Step {step}/{self.max_steps}")
            await context.emit_event(
                node_id=self.id,
                node_name=self.name,
                node_type=self.node_type,
                event_type="AGENT_STEP_START",
                content=f"🔄 에이전트 추론 루프 #{step} 진행 중..."
            )

            # LLM 호출 및 스트리밍 처리
            assistant_content = ""
            thinking_content = ""
            assistant_tool_calls: List[Dict[str, Any]] = []

            try:
                async for event in ollama_client.stream_chat(
                    model=self.model,
                    messages=messages,
                    tools=tools_schema if tools_schema else None,
                    temperature=self.temperature,
                    num_ctx=self.num_ctx
                ):
                    if context.is_cancelled():
                        break

                    ev_type = event.get("type")
                    if ev_type == "error":
                        err_msg = event.get("error", "Ollama 모델 실행 중 오류가 발생했습니다.")
                        logger.error(f"[AgentNode:{self.id}] Ollama error event received: {err_msg}")
                        await context.emit_event(
                            node_id=self.id,
                            node_name=self.name,
                            node_type=self.node_type,
                            event_type="ERROR",
                            content=f"❌ {err_msg}"
                        )
                        return NodeResult(success=False, error=err_msg)
                    elif ev_type == "thinking":
                        token = event.get("token", "")
                        thinking_content += token
                        await context.emit_event(
                            node_id=self.id,
                            node_name=self.name,
                            node_type=self.node_type,
                            event_type="STREAM_CHUNK",
                            content=token
                        )
                    elif ev_type == "content":
                        token = event.get("token", "")
                        assistant_content += token
                        await context.emit_event(
                            node_id=self.id,
                            node_name=self.name,
                            node_type=self.node_type,
                            event_type="STREAM_CHUNK",
                            content=token
                        )
                    elif ev_type == "done":
                        msg = event.get("message", {})
                        if not assistant_content and msg.get("content"):
                            assistant_content = msg.get("content", "")
                        if msg.get("tool_calls"):
                            assistant_tool_calls = msg.get("tool_calls", [])

            except Exception as llm_err:
                logger.error(f"[AgentNode] LLM call error: {llm_err}", exc_info=True)
                await context.emit_event(
                    node_id=self.id,
                    node_name=self.name,
                    node_type=self.node_type,
                    event_type="ERROR",
                    content=f"❌ LLM 호출 중 오류가 발생했습니다: {str(llm_err)}"
                )
                return NodeResult(success=False, error=str(llm_err))

            if context.is_cancelled():
                await context.emit_event(
                    node_id=self.id,
                    node_name=self.name,
                    node_type=self.node_type,
                    event_type="ERROR",
                    content="⚠️ 비상 중단(F12)되었습니다."
                )
                return NodeResult(success=False, error="비상 중단(F12)되었습니다.")

            # Ollama 에러 문자열이 assistant_content에 포함된 경우 즉시 실패 처리
            if assistant_content.startswith("[Ollama 오류") or assistant_content.startswith("[오류: Ollama"):
                logger.error(f"[AgentNode:{self.id}] Detected Ollama error in assistant content: {assistant_content}")
                await context.emit_event(
                    node_id=self.id,
                    node_name=self.name,
                    node_type=self.node_type,
                    event_type="ERROR",
                    content=f"❌ {assistant_content}"
                )
                return NodeResult(success=False, error=assistant_content)

            # 모델 응답 대화록에 기록
            assistant_msg: Dict[str, Any] = {
                "role": "assistant",
                "content": assistant_content
            }
            if assistant_tool_calls:
                assistant_msg["tool_calls"] = assistant_tool_calls
            messages.append(assistant_msg)

            # ---------------------------------------------------------
            # Case A: 도구 호출(Tool Calling)이 존재하는 턴 (중간 실행 단계)
            # ---------------------------------------------------------
            if assistant_tool_calls:
                raw_thought = thinking_content.strip() or assistant_content.strip()
                parsed_mid = extract_agent_json_decision(raw_thought)
                thought_text = parsed_mid["thought"] if (parsed_mid and parsed_mid.get("thought")) else raw_thought

                if thought_text:
                    last_step_thought = thought_text
                    await context.emit_event(
                        node_id=self.id,
                        node_name=self.name,
                        node_type=self.node_type,
                        event_type="AGENT_THINKING",
                        content=f"💡 [생각 및 계획]\n{thought_text}"
                    )

                for tc in assistant_tool_calls:
                    if context.is_cancelled():
                        break

                    fn = tc.get("function", {})
                    fn_name = fn.get("name", "")
                    fn_args = fn.get("arguments", {})

                    # 문자열 JSON일 경우 파싱
                    if isinstance(fn_args, str):
                        try:
                            fn_args = json.loads(fn_args)
                        except Exception:
                            fn_args = {}

                    args_repr = ", ".join([f"{k}={v}" for k, v in fn_args.items()])
                    logger.info(f"[AgentNode] Executing tool: {fn_name}({args_repr})")

                    # 도구 호출 이벤트 알림
                    await context.emit_event(
                        node_id=self.id,
                        node_name=self.name,
                        node_type=self.node_type,
                        event_type="AGENT_TOOL_CALL",
                        content=f"🔧 [스킬 호출] {fn_name}({args_repr})"
                    )

                    # 실제 도구 실행
                    tool_result_str = await execute_agent_tool(fn_name, fn_args, context=context)
                    any_tool_called = True
                    trimmed_res = str(tool_result_str).strip()
                    if trimmed_res.startswith("[실패]") or trimmed_res.startswith("[오류]"):
                        last_tool_failed = True
                    else:
                        last_tool_failed = False
                        any_tool_succeeded = True

                    # 스크린샷 등 도구에서 생성된 미리보기 이미지 추출
                    preview_img = getattr(context, "_last_screenshot_url", None)
                    if preview_img:
                        setattr(context, "_last_screenshot_url", None)

                    # 도구 결과 이벤트 알림
                    short_res = tool_result_str[:200] + "..." if len(tool_result_str) > 200 else tool_result_str
                    tool_history.append(f"[Step {step}] {fn_name}({args_repr}) -> {short_res}")
                    await context.emit_event(
                        node_id=self.id,
                        node_name=self.name,
                        node_type=self.node_type,
                        event_type="AGENT_TOOL_RESULT",
                        content=f"📋 [실행 결과] {short_res}",
                        image_path=preview_img
                    )

                    # 대화 메시지에 도구 결과 누적
                    messages.append({
                        "role": "tool",
                        "content": tool_result_str
                    })

                # 도구 실행 후 다음 루프로 계속 진행 (이 스텝이 max_steps라면 루프가 종료되며 completed_normally=False 유지)
                await asyncio.sleep(0.3)
                continue

            # ---------------------------------------------------------
            # Case B: 도구 호출이 없는 턴 (최종 성공/실패 판정 또는 도구 호출 누락 검증)
            # ---------------------------------------------------------
            decision = extract_agent_json_decision(assistant_content) or extract_agent_json_decision(thinking_content)

            # B-1. 모델이 명시적 JSON 판정({"thought": ..., "is_success": true/false, "result": ...})을 반환한 경우
            if decision is not None:
                thought_to_show = thinking_content.strip() or decision.get("thought", "")
                if thought_to_show:
                    last_step_thought = thought_to_show
                    await context.emit_event(
                        node_id=self.id,
                        node_name=self.name,
                        node_type=self.node_type,
                        event_type="AGENT_THINKING",
                        content=f"💡 [생각 및 계획]\n{thought_to_show}"
                    )

                if decision["is_success"] is True:
                    final_answer = (
                        decision.get("result")
                        or decision.get("thought")
                        or "에이전트 자동화 작업을 완료했습니다."
                    )
                    completed_normally = True
                    task_succeeded = True
                    logger.info(f"[AgentNode:{self.id}] Agent reported explicit JSON success at step {step}")
                    break
                else:
                    # is_success == False인 경우:
                    # 만약 에이전트가 '다음 단계를 시도하겠다'는 생각으로 도구 호출만 빠뜨린 경우이고 아직 스텝이 남았다면 1회 도구 호출 유도
                    combined_reason = decision.get("result") or decision.get("thought") or ""
                    if (
                        not retried_incomplete
                        and step < self.max_steps
                        and tools_schema
                        and (
                            is_incomplete_planning_text(decision.get("thought", ""))
                            or is_incomplete_planning_text(decision.get("result", ""))
                        )
                    ):
                        retried_incomplete = True
                        messages.append({
                            "role": "user",
                            "content": (
                                "[시스템 알림] 아직 작업이 완료되지 않아 다음 단계가 필요한 상태입니다. "
                                "즉시 필요한 도구(Tool)를 직접 호출하여 다음 단계를 실행하세요."
                            ),
                        })
                        await asyncio.sleep(0.2)
                        continue

                    failure_reason = (
                        combined_reason
                        or "에이전트가 목표 작업을 완수하지 못했다고 판단했습니다 (is_success: false)."
                    )
                    completed_normally = True
                    task_succeeded = False
                    logger.warning(f"[AgentNode:{self.id}] Agent reported explicit JSON failure at step {step}: {failure_reason}")
                    break

            # B-2. JSON 판정이 없는 일반 텍스트 / Thinking 단독 응답 처리
            if thinking_content.strip():
                last_step_thought = thinking_content.strip()
                await context.emit_event(
                    node_id=self.id,
                    node_name=self.name,
                    node_type=self.node_type,
                    event_type="AGENT_THINKING",
                    content=f"💡 [생각 및 계획]\n{thinking_content.strip()}"
                )

            cleaned_assistant = assistant_content.strip()

            # (1) 본문(assistant_content)이 비어있고 thinking_content만 출력된 경우
            if not cleaned_assistant and thinking_content.strip():
                if is_incomplete_planning_text(thinking_content) or any_tool_called:
                    if not retried_incomplete and step < self.max_steps:
                        retried_incomplete = True
                        messages.append({
                            "role": "user",
                            "content": (
                                "[시스템 알림] 생각(Thinking)만 출력되고 도구 호출이나 최종 응답이 누락되었습니다. "
                                "다음 단계가 필요하다면 즉시 도구(Tool)를 호출하고, 모든 작업이 끝났다면 최종 결과를 답변하세요."
                            ),
                        })
                        await asyncio.sleep(0.2)
                        continue
                    else:
                        # 마지막 스텝이거나 재시도 후에도 답변/도구 호출이 없으면 미완료 실패 처리
                        completed_normally = False
                        break
                else:
                    final_answer = thinking_content.strip()
                    completed_normally = True
                    task_succeeded = True
                    break

            # (2) 본문과 thinking이 모두 완전히 비어있는 경우
            if not cleaned_assistant and not thinking_content.strip():
                if last_tool_failed:
                    completed_normally = True
                    task_succeeded = False
                    failure_reason = "도구 실행 실패 후 에이전트가 유효한 최종 응답을 생성하지 못했습니다."
                    break
                final_answer = "에이전트 자동화 작업을 완료했습니다."
                completed_normally = True
                task_succeeded = True
                break

            # (3) 본문(cleaned_assistant)이 미완료 계획('~해 보겠습니다' 등)인데 도구 호출을 누락한 경우
            if is_incomplete_planning_text(cleaned_assistant):
                last_step_thought = cleaned_assistant
                if not thinking_content.strip():
                    await context.emit_event(
                        node_id=self.id,
                        node_name=self.name,
                        node_type=self.node_type,
                        event_type="AGENT_THINKING",
                        content=f"💡 [생각 및 계획]\n{cleaned_assistant}"
                    )
                if not retried_incomplete and step < self.max_steps and tools_schema:
                    retried_incomplete = True
                    messages.append({
                        "role": "user",
                        "content": (
                            "[시스템 알림] 다음 단계를 진행하겠다고 추론했으나 도구(Tool)가 호출되지 않았습니다. "
                            "작업을 계속 수행하려면 반드시 도구를 호출하고, 모든 작업이 완료되었거나 불가능하다면 최종 결과를 답변하세요."
                        ),
                    })
                    await asyncio.sleep(0.2)
                    continue
                else:
                    # 루프 횟수가 남지 않았거나 재시도 후에도 계획만 말하고 멈춘 경우 -> 미완료 실패
                    completed_normally = False
                    break

            # (4) 평문 응답이 작업 실패/불가를 보고하는 내용인 경우
            if is_failure_plain_text(cleaned_assistant, any_tool_called, any_tool_succeeded, last_tool_failed):
                completed_normally = True
                task_succeeded = False
                failure_reason = cleaned_assistant
                logger.warning(f"[AgentNode:{self.id}] Agent plain text indicates failure at step {step}: {failure_reason}")
                break

            # (5) Ollama API format(JSON Schema) 구조화 검증 (시스템 프롬프트 수정과 무관하게 동작)
            verdict = await self._verify_completion_with_schema(
                goal_prompt=resolved_prompt,
                tool_history=tool_history,
                thinking_text=thinking_content.strip(),
                assistant_text=cleaned_assistant,
            )
            if verdict is not None:
                if not verdict["is_complete"]:
                    last_step_thought = verdict.get("reason") or verdict.get("thought") or cleaned_assistant
                    if not retried_incomplete and step < self.max_steps and tools_schema:
                        retried_incomplete = True
                        messages.append({
                            "role": "user",
                            "content": (
                                "[시스템 알림] 아직 작업이 완료되지 않아 다음 단계가 필요한 상태입니다. "
                                "텍스트로만 계획하지 말고 즉시 필요한 도구(Tool)를 호출하여 다음 단계를 실행하세요."
                            ),
                        })
                        await asyncio.sleep(0.2)
                        continue
                    else:
                        completed_normally = False
                        break

                if not verdict["is_success"]:
                    completed_normally = True
                    task_succeeded = False
                    failure_reason = (
                        verdict.get("reason")
                        or verdict.get("thought")
                        or cleaned_assistant
                    )
                    logger.warning(
                        f"[AgentNode:{self.id}] Structured schema verifier marked task as failed at step {step}: {failure_reason}"
                    )
                    break

            # (6) 최종 작업 완료 및 성공 확정
            final_answer = cleaned_assistant
            completed_normally = True
            task_succeeded = True
            logger.info(f"[AgentNode:{self.id}] Agent reached verified final answer at step {step}")
            break

        # 7. 사후 스크린샷 촬영 (설정 활성화 시 성공/실패 모두 현 상태 기록)
        screenshot_url = None
        if settings.CAPTURE_SCREEN_AFTER_EXECUTION:
            try:
                screenshot_url = screen_capture_service.capture(session_id=context.session_id)
            except Exception as e:
                logger.warning(f"[AgentNode] Capture after agent completion failed: {e}")

        # 8. 루프 횟수 초과(미완료) 또는 에이전트 작업 실패 판정 시 엄격한 실패(ERROR) 처리
        if not completed_normally:
            thought_suffix = f"\n(마지막 추론 상태: {last_step_thought})" if last_step_thought else ""
            err_msg = (
                f"최대 추론 루프 횟수({self.max_steps}회)를 초과하여 에이전트가 작업을 완료하지 못했습니다."
                f"{thought_suffix}"
            )
            logger.warning(f"[AgentNode:{self.id}] Agent failed due to max_steps ({self.max_steps}) exceeded.")
            await context.emit_event(
                node_id=self.id,
                node_name=self.name,
                node_type=self.node_type,
                event_type="ERROR",
                content=f"❌ {err_msg}",
                image_path=screenshot_url
            )
            return NodeResult(success=False, error=err_msg, screenshot_url=screenshot_url)

        if not task_succeeded:
            err_msg = f"에이전트가 목표 작업을 완수하지 못했습니다: {failure_reason}"
            logger.warning(f"[AgentNode:{self.id}] Agent task evaluated as failed: {err_msg}")
            await context.emit_event(
                node_id=self.id,
                node_name=self.name,
                node_type=self.node_type,
                event_type="ERROR",
                content=f"❌ {err_msg}",
                image_path=screenshot_url
            )
            return NodeResult(success=False, error=err_msg, screenshot_url=screenshot_url)

        # 9. 최종 성공(task_succeeded == True)인 경우에만 출력 변수 저장 및 SUCCESS 반환
        if not final_answer or not str(final_answer).strip():
            final_answer = "에이전트 자동화 작업을 완료했습니다."

        try:
            is_strict = getattr(context, "strict_variables", False) is True
            raw_out = self.config.get("output_variable")
            out_var = str(raw_out).strip() if raw_out is not None else ""
            if not out_var and not is_strict:
                out_var = getattr(self, "output_variable", "agent_result") or "agent_result"

            if hasattr(context, "set_variable"):
                try:
                    context.set_variable(out_var, final_answer)
                except Exception:
                    if is_strict:
                        raise
            if hasattr(context, "set_variable"):
                try:
                    context.set_variable("last_output", final_answer, is_system=True)
                except Exception:
                    pass
            if hasattr(context, "variables") and isinstance(context.variables, dict):
                context.variables[out_var] = final_answer
                context.variables["last_output"] = final_answer
        except Exception as var_err:
            err_msg = f"{self.name} 출력 변수 저장 오류: {str(var_err)}"
            await context.emit_event(
                node_id=self.id,
                node_name=self.name,
                node_type=self.node_type,
                event_type="ERROR",
                content=f"❌ {err_msg}"
            )
            return NodeResult(success=False, error=err_msg)

        # 10. 최종 완료 이벤트 발행
        await context.emit_event(
            node_id=self.id,
            node_name=self.name,
            node_type=self.node_type,
            event_type="SUCCESS",
            content=final_answer,
            image_path=screenshot_url
        )
        logger.info(f"[AgentNode:{self.id}] Successfully completed agent run.")
        return NodeResult(success=True, output=final_answer, screenshot_url=screenshot_url)
