"""
Playwright 기반 브라우저 전용 스킬 노드 구현체 (BrowserNode).
- 비표준 레거시 웹(다중 iframe, 독자 JS UI), SPA 동적 탭 제어
- 물리 마우스 커서 이동 없는 백그라운드(Headless / 최소화) 실행 지원
- 7종 서브타입 지원:
  1. navigate (웹 브라우저 열기 / URL 이동)
  2. click (웹 요소 클릭)
  3. fill (웹 텍스트 입력)
  4. extract (웹 데이터 / 본문 추출)
  5. action (웹 드롭다운 / 탭 / 다운로드 / 탐색 제어)
  6. get_info (현재 웹페이지 정보 읽기)
  7. evaluate (웹 자바스크립트(JS) 실행)
"""

from typing import Any, Dict, Optional
from app.core.config import settings
from app.nodes.base import BaseNode, ExecutionContext, NodeResult
from app.nodes.general import render_template
from app.services.playwright_service import playwright_service
from app.services.screen_capture import screen_capture_service


class BrowserNode(BaseNode):
    def __init__(self, id: str, name: str, subtype: str, config: Dict[str, Any]):
        super().__init__(id=id, name=name, node_type="GENERAL", config=config)
        self.subtype = subtype

    def _render(self, context: ExecutionContext, raw_val: Any) -> str:
        if raw_val is None:
            return ""
        declared_names = set(context.variable_schemas.keys()) if context.strict_variables else None
        return render_template(
            str(raw_val),
            context.variables,
            strict=context.strict_variables,
            declared_names=declared_names,
        )

    async def run(self, context: ExecutionContext) -> NodeResult:
        await context.emit_event(
            node_id=self.id,
            node_name=self.name,
            node_type=self.node_type,
            event_type="START",
            content=f"🌐 {self.name} 실행",
        )

        if context.is_cancelled():
            return NodeResult(success=False, error="사용자에 의해 취소됨")

        try:
            output_summary = ""
            output_value: Any = None

            # 1. 웹 브라우저 열기 / URL 이동 (browser_navigate)
            if self.subtype == "navigate":
                url = self._render(context, self.config.get("url", "")).strip()
                run_mode = str(self.config.get("run_mode", "headed") or "headed").strip()
                browser_channel = str(self.config.get("browser_channel", "chrome") or "chrome").strip()
                use_persistent_profile = bool(self.config.get("use_persistent_profile", True))
                new_tab = bool(self.config.get("new_tab", False))
                wait_until = str(self.config.get("wait_until", "domcontentloaded") or "domcontentloaded").strip()
                timeout_sec = float(self.config.get("timeout", 15.0) or 15.0)

                nav_res = await playwright_service.navigate(
                    url=url,
                    run_mode=run_mode,
                    browser_channel=browser_channel,
                    use_persistent_profile=use_persistent_profile,
                    new_tab=new_tab,
                    wait_until=wait_until,
                    timeout_sec=timeout_sec,
                )
                output_value = nav_res.get("url", url)
                context.set_variable("last_output", output_value, is_system=True)
                mode_kor = {
                    "headed": "일반 창",
                    "minimized": "최소화 백그라운드",
                    "headless": "Headless 완전 숨김",
                }.get(run_mode, run_mode)
                output_summary = f"페이지 이동 완료: '{nav_res.get('title') or output_value}' ({mode_kor})"

            # 2. 웹 요소 클릭 (browser_click)
            elif self.subtype == "click":
                selector_type = str(self.config.get("selector_type", "auto") or "auto").strip()
                selector = self._render(context, self.config.get("selector", "")).strip()
                iframe_auto_search = bool(self.config.get("iframe_auto_search", True))
                click_type = str(self.config.get("click_type", "single") or "single").strip()
                force_click = bool(self.config.get("force_click", False))
                timeout_sec = float(self.config.get("timeout", 5.0) or 5.0)

                click_res = await playwright_service.click_element(
                    selector_type=selector_type,
                    selector=selector,
                    iframe_auto_search=iframe_auto_search,
                    click_type=click_type,
                    force_click=force_click,
                    timeout_sec=timeout_sec,
                )
                output_value = click_res.get("current_url", "")
                context.set_variable("last_output", output_value, is_system=True)
                output_summary = f"웹 요소 클릭 완료: [{selector_type}] '{selector}'"

            # 3. 웹 텍스트 입력 (browser_fill)
            elif self.subtype == "fill":
                selector_type = str(self.config.get("selector_type", "auto") or "auto").strip()
                selector = self._render(context, self.config.get("selector", "")).strip()
                text = self._render(context, self.config.get("text", ""))
                input_method = str(self.config.get("input_method", "fill") or "fill").strip()
                press_enter = bool(self.config.get("press_enter", False))
                iframe_auto_search = bool(self.config.get("iframe_auto_search", True))
                timeout_sec = float(self.config.get("timeout", 5.0) or 5.0)

                await playwright_service.fill_element(
                    selector_type=selector_type,
                    selector=selector,
                    text=text,
                    input_method=input_method,
                    press_enter=press_enter,
                    iframe_auto_search=iframe_auto_search,
                    timeout_sec=timeout_sec,
                )
                output_value = text
                context.set_variable("last_output", output_value, is_system=True)
                enter_suffix = " + Enter 전송" if press_enter else ""
                preview = text[:20] + ("..." if len(text) > 20 else "")
                output_summary = f"웹 텍스트 입력 완료: '{selector}' ➔ \"{preview}\"{enter_suffix}"

            # 4. 웹 데이터 / 본문 추출 (browser_extract)
            elif self.subtype == "extract":
                extract_target = str(self.config.get("extract_target", "full_page") or "full_page").strip()
                selector_type = str(self.config.get("selector_type", "css") or "css").strip()
                selector = self._render(context, self.config.get("selector", "")).strip()
                extract_format = str(self.config.get("extract_format", "markdown") or "markdown").strip()
                attribute_name = self._render(context, self.config.get("attribute_name", "href")).strip() or "href"
                iframe_auto_search = bool(self.config.get("iframe_auto_search", True))
                max_length = int(self.config.get("max_length", 15000) or 15000)
                output_var = str(self.config.get("output_variable", "web_content") or "web_content").strip()

                extracted = await playwright_service.extract_content(
                    extract_target=extract_target,
                    selector_type=selector_type,
                    selector=selector,
                    extract_format=extract_format,
                    attribute_name=attribute_name,
                    iframe_auto_search=iframe_auto_search,
                    max_length=max_length,
                )
                output_value = context.set_variable(output_var, extracted)
                context.set_variable("last_output", output_value, is_system=True)
                output_summary = f"웹 데이터 추출 완료 ({len(str(extracted))}자) ➔ 변수 '{{{{{output_var}}}}}'"

            # 5. 웹 드롭다운 / 탭 / 다운로드 / 탐색 제어 (browser_action)
            elif self.subtype == "action":
                action_type = str(self.config.get("action_type", "switch_tab") or "switch_tab").strip()
                target_value = self._render(context, self.config.get("target_value", "")).strip()
                option_value = self._render(context, self.config.get("option_value", "")).strip()
                timeout_sec = float(self.config.get("timeout", 10.0) or 10.0)

                act_res = await playwright_service.perform_action(
                    action_type=action_type,
                    target_value=target_value,
                    option_value=option_value,
                    timeout_sec=timeout_sec,
                )
                if action_type == "wait_for_download":
                    file_path = act_res.get("file_path", "")
                    out_var = str(self.config.get("output_variable", "") or "").strip()
                    if out_var:
                        output_value = context.set_variable(out_var, file_path)
                    else:
                        output_value = file_path
                    context.set_variable("last_output", output_value, is_system=True)
                    output_summary = f"파일 다운로드 완료: {file_path}"
                else:
                    output_value = act_res.get("url") or act_res.get("status") or str(act_res)
                    context.set_variable("last_output", output_value, is_system=True)
                    output_summary = f"브라우저 제어({action_type}) 완료"

            # 6. 현재 웹페이지 정보 읽기 (browser_get_info)
            elif self.subtype == "get_info":
                info_type = str(self.config.get("info_type", "url") or "url").strip()
                output_var = str(self.config.get("output_variable", "web_info") or "web_info").strip()

                info_val = await playwright_service.get_page_info(info_type=info_type)
                output_value = context.set_variable(output_var, info_val)
                context.set_variable("last_output", output_value, is_system=True)
                preview = str(output_value)[:50] + ("..." if len(str(output_value)) > 50 else "")
                output_summary = f"웹 정보({info_type}) 읽기 완료: '{preview}' ➔ 변수 '{{{{{output_var}}}}}'"

            # 7. 웹 자바스크립트(JS) 실행 (browser_evaluate)
            elif self.subtype == "evaluate":
                script = self._render(context, self.config.get("script", ""))
                output_var = str(self.config.get("output_variable", "") or "").strip()

                js_result = await playwright_service.evaluate_js(script=script)
                if output_var:
                    output_value = context.set_variable(output_var, js_result)
                else:
                    output_value = js_result
                context.set_variable("last_output", output_value, is_system=True)
                preview = str(output_value)[:50] + ("..." if len(str(output_value)) > 50 else "")
                var_info = f" ➔ 변수 '{{{{{output_var}}}}}'" if output_var else ""
                output_summary = f"웹 JS 실행 완료 (반환값: {preview}){var_info}"

            else:
                raise ValueError(f"알 수 없는 브라우저 노드 서브타입입니다: {self.subtype}")

            screenshot_url: Optional[str] = None
            if settings.CAPTURE_SCREEN_AFTER_EXECUTION:
                screenshot_url = screen_capture_service.capture(context.session_id, self.id)

            success_msg = f"🌐 {self.name} 실행 성공 — {output_summary}" if output_summary else f"🌐 {self.name} 실행 성공"
            await context.emit_event(
                node_id=self.id,
                node_name=self.name,
                node_type=self.node_type,
                event_type="SUCCESS",
                content=success_msg,
                image_path=screenshot_url,
            )

            return NodeResult(success=True, output=output_value, screenshot_url=screenshot_url)

        except Exception as e:
            error_msg = f"{self.name} 실행 중 오류 발생. -- {str(e)}"
            await context.emit_event(
                node_id=self.id,
                node_name=self.name,
                node_type=self.node_type,
                event_type="ERROR",
                content=error_msg,
            )
            return NodeResult(success=False, error=error_msg)
