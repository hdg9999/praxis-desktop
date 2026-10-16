from typing import Dict, Any, Optional
from app.core.config import settings
from app.nodes.base import BaseNode, ExecutionContext, NodeResult
from app.nodes.general import render_template
from app.services.screen_capture import screen_capture_service
from app.services.ollama_client import ollama_client

class AINode(BaseNode):
    def __init__(self, id: str, name: str, config: Dict[str, Any]):
        super().__init__(id, name, "AI", config)
        raw_model = str(config.get("model") or "").strip()
        default_model = str(config.get("default_llm_model") or "").strip()
        self.model = raw_model or default_model or "llama3"
        self.prompt_template = config.get("prompt", "")
        self.system_prompt = config.get("system_prompt", None)
        self.temperature = float(config.get("temperature", 0.7))
        self.output_variable = config.get("output_variable", "ai_output")

    async def run(self, context: ExecutionContext) -> NodeResult:
        if context.is_cancelled():
            return NodeResult(success=False, error="실행이 취소되었습니다.")

        # 워크플로우 전역 설정의 기본 LLM 모델 폴백 지원
        raw_cfg_model = str(self.config.get("model") or "").strip()
        flow_settings = getattr(context, "flow_settings", None)
        flow_default_model = ""
        if isinstance(flow_settings, dict):
            flow_default_model = str(flow_settings.get("default_llm_model") or "").strip()
        active_model = raw_cfg_model or flow_default_model or self.model

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
                model=active_model,
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

            # 다음 노드에서 사용할 수 있도록 context 변수 저장 (선언 및 타입 검증 포함)
            raw_out = self.config.get("output_variable")
            out_var = str(raw_out).strip() if raw_out is not None else ""
            if not out_var and not context.strict_variables:
                out_var = "ai_output"
            context.set_variable(out_var, accumulated_response)
            context.set_variable("last_output", accumulated_response, is_system=True)
            if hasattr(context, "variables") and isinstance(context.variables, dict):
                context.variables[out_var] = accumulated_response
                context.variables["last_output"] = accumulated_response

            # 완료 이벤트 전송 (최종 응답 + 해당 시점 스크린샷)
            await context.emit_event(
                node_id=self.id,
                node_name=self.name,
                node_type="AI",
                event_type="SUCCESS",
                content=accumulated_response,
                image_path=after_screenshot_url
            )

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
