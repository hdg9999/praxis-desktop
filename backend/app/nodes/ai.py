from typing import Dict, Any, Optional
from app.core.config import settings
from app.nodes.base import BaseNode, ExecutionContext, NodeResult
from app.nodes.general import render_template
from app.services.screen_capture import screen_capture_service
from app.services.ollama_client import ollama_client

class AINode(BaseNode):
    def __init__(self, id: str, name: str, config: Dict[str, Any]):
        super().__init__(id, name, "AI", config)
        self.model = config.get("model", "llama3")
        self.prompt_template = config.get("prompt", "")
        self.system_prompt = config.get("system_prompt", None)
        self.temperature = float(config.get("temperature", 0.7))
        self.output_variable = config.get("output_variable", "ai_output")

    async def run(self, context: ExecutionContext) -> NodeResult:
        if context.is_cancelled():
            return NodeResult(success=False, error="실행이 취소되었습니다.")

        # 템플릿 변수 치환 적용
        resolved_prompt = render_template(self.prompt_template, context.variables)

        # 1) 노드 실행 직전: 화면 캡처 + "{노드이름} 실행 - 프롬프트: {프롬프트}" + 실행 직전 PC 스크린샷 이미지 (설정 On일 때만)
        before_screenshot_url = None
        if settings.CAPTURE_SCREEN_AFTER_EXECUTION:
            before_screenshot_url = screen_capture_service.capture(
                session_id=context.session_id,
                label=f"node_{self.id}_before",
                target="all"
            )

        await context.emit_event(
            node_id=self.id,
            node_name=self.name,
            node_type="AI",
            event_type="START",
            content=f"{self.name} 실행 - 프롬프트: {resolved_prompt}",
            image_path=before_screenshot_url
        )

        accumulated_response = ""

        try:
            # 2) AI 응답 스트리밍
            async for token in ollama_client.stream_generate(
                model=self.model,
                prompt=resolved_prompt,
                system_prompt=self.system_prompt,
                temperature=self.temperature
            ):
                if context.is_cancelled():
                    return NodeResult(success=False, error="실행이 취소되었습니다.")

                accumulated_response += token
                # 실시간 토큰 청크 이벤트 방출
                await context.emit_event(
                    node_id=self.id,
                    node_name=self.name,
                    node_type="AI",
                    event_type="STREAM_CHUNK",
                    content=accumulated_response
                )

            # 스트리밍 완료 후 화면 캡처 (설정 On일 때만)
            after_screenshot_url = None
            if settings.CAPTURE_SCREEN_AFTER_EXECUTION:
                after_screenshot_url = screen_capture_service.capture(
                    session_id=context.session_id,
                    label=f"node_{self.id}_after",
                    target="all"
                )

            # 완료 이벤트 전송 (최종 응답 + 해당 시점 스크린샷)
            await context.emit_event(
                node_id=self.id,
                node_name=self.name,
                node_type="AI",
                event_type="SUCCESS",
                content=accumulated_response,
                image_path=after_screenshot_url
            )

            # 다음 노드에서 사용할 수 있도록 context 변수 저장
            context.variables[self.output_variable] = accumulated_response
            context.variables["last_output"] = accumulated_response

            return NodeResult(
                success=True,
                output=accumulated_response,
                screenshot_url=after_screenshot_url
            )

        except Exception as e:
            error_msg = f"{self.name} 실행 중 오류 발생. -- {str(e)}"
            await context.emit_event(
                node_id=self.id,
                node_name=self.name,
                node_type="AI",
                event_type="ERROR",
                content=error_msg
            )
            return NodeResult(success=False, error=error_msg)
