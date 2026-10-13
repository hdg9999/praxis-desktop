"""
Basic Agent Node (ReAct Tool-Calling Autonomous RPA Agent)
사용자의 자연어 지시에 따라 등록된 스킬셋을 자율적으로 선택 및 실행하여 작업을 완수하는 에이전트 노드입니다.
"""

import asyncio
import base64
import io
import json
import logging
from typing import Dict, Any, List, Optional

from app.nodes.base import BaseNode, ExecutionContext, NodeResult
from app.services.ollama_client import ollama_client
from app.services.screen_capture import screen_capture_service
from app.core.config import settings
from app.nodes.agent_tools import get_agent_tools_schema, execute_agent_tool

logger = logging.getLogger(__name__)

class AgentNode(BaseNode):
    """
    신규 AI 코어 스킬 노드: '기본 에이전트'
    - Ollama /api/chat 네이티브 Tool Calling
    - 스킬셋 프리셋/커스텀 필터링
    - 화면 캡처 비전 멀티모달 주입
    - ReAct 자율 실행 루프 & Thinking/ToolCall/ToolResult 실시간 이벤트
    - F12 KillSwitch 비상 중단 감시
    """

    def __init__(self, id: str, name: str, config: Dict[str, Any]):
        super().__init__(id, name, "AGENT", config)
        self.llm_backend: str = config.get("llm_backend", "ollama")
        self.model: str = config.get("model", "llama3.1")
        self.prompt: str = config.get("prompt", "")
        self.system_prompt: str = config.get("system_prompt", "")
        self.include_screen_capture: bool = config.get("include_screen_capture", False)
        self.skill_mode: str = config.get("skill_mode", "preset")
        self.preset_name: str = config.get("preset_name", "basic_interaction")
        self.custom_skills: List[str] = config.get("custom_skills", [])
        self.max_steps: int = int(config.get("max_steps", 10))
        self.temperature: float = float(config.get("temperature", 0.3))
        self.output_variable: str = config.get("output_variable", "agent_result")

    def _substitute_variables(self, text: str, variables: Dict[str, Any]) -> str:
        """{{variable}} 형태의 템플릿 치환"""
        if not text:
            return ""
        for k, v in variables.items():
            text = text.replace(f"{{{{{k}}}}}", str(v))
        return text

    async def run(self, context: ExecutionContext) -> NodeResult:
        logger.info(f"[AgentNode:{self.id}] Starting agent task: '{self.name}' with model '{self.model}'")

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
        # 사용자가 직접 입력한 시스템 프롬프트가 있을 때만 system 역할 메시지 추가 (히든 프롬프트 배제)
        messages: List[Dict[str, Any]] = []
        if resolved_sys_prompt and resolved_sys_prompt.strip():
            messages.append({"role": "system", "content": resolved_sys_prompt.strip()})

        user_message: Dict[str, Any] = {"role": "user", "content": resolved_prompt}
        if base64_screenshot:
            user_message["images"] = [base64_screenshot]
        messages.append(user_message)

        # 6. ReAct 에이전트 자율 실행 루프
        final_answer = ""
        completed_normally = False

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
                    temperature=self.temperature
                ):
                    if context.is_cancelled():
                        break

                    ev_type = event.get("type")
                    if ev_type == "thinking":
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

            # 도구 호출 전 추론 과정(Thinking / Thought) 타임라인 카드 확정 발행
            thought_text = thinking_content.strip() or (assistant_content.strip() if assistant_tool_calls else "")
            if thought_text:
                await context.emit_event(
                    node_id=self.id,
                    node_name=self.name,
                    node_type=self.node_type,
                    event_type="AGENT_THINKING",
                    content=f"💡 [생각 및 계획]\n{thought_text}"
                )

            # 모델 응답 대화록에 기록
            assistant_msg: Dict[str, Any] = {
                "role": "assistant",
                "content": assistant_content
            }
            if assistant_tool_calls:
                assistant_msg["tool_calls"] = assistant_tool_calls
            messages.append(assistant_msg)

            # 도구 호출(Tool Calling) 여부 판단
            if assistant_tool_calls:
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

                    # 스크린샷 등 도구에서 생성된 미리보기 이미지 추출
                    preview_img = getattr(context, "_last_screenshot_url", None)
                    if preview_img:
                        setattr(context, "_last_screenshot_url", None)

                    # 도구 결과 이벤트 알림
                    short_res = tool_result_str[:200] + "..." if len(tool_result_str) > 200 else tool_result_str
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

                # 도구 실행 후 다음 루프로 계속 진행
                await asyncio.sleep(0.3)
                continue

            else:
                # 도구 호출이 없으면 최종 답변으로 간주하고 루프 종료
                final_answer = assistant_content
                completed_normally = True
                logger.info(f"[AgentNode] Agent reached final answer at step {step}")
                break

        if not completed_normally and not final_answer:
            final_answer = f"에이전트가 최대 반복 횟수({self.max_steps}회) 내에 작업을 종료했습니다."

        # 7. 출력 변수 저장
        context.variables[self.output_variable] = final_answer

        # 8. 사후 스크린샷 촬영 (설정 활성화 시)
        screenshot_url = None
        if settings.CAPTURE_SCREEN_AFTER_EXECUTION:
            try:
                screenshot_url = screen_capture_service.capture(session_id=context.session_id)
            except Exception as e:
                logger.warning(f"[AgentNode] Capture after agent completion failed: {e}")

        # 9. 최종 완료 이벤트 발행
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
