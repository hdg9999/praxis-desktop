"""
Agent Tool Specifications and Dispatcher Module.
에이전트가 호출할 수 있는 도구(스킬)들의 표준 스키마, 프리셋 및 실행 디스패처를 정의합니다.
OpenAI / Ollama / MCP Tool Calling 규격(JSON Schema)과 100% 호환됩니다.
"""

import asyncio
import os
import json
import logging
import pyautogui
import pyperclip
from typing import Dict, Any, List, Optional, Callable
from pathlib import Path
from pydantic import BaseModel, Field

from app.services.uia_service import uia_service
from app.services.screen_capture import screen_capture_service

logger = logging.getLogger(__name__)

# ---------------------------------------------------------
# 1. 도구 정의 메타데이터 모델
# ---------------------------------------------------------
class AgentToolDefinition(BaseModel):
    name: str = Field(..., description="LLM이 호출할 도구 함수명")
    display_name: str = Field(..., description="UI 표기용 한글 이름")
    description: str = Field(..., description="LLM에게 제공할 도구 설명")
    category: str = Field(..., description="스킬 카테고리 (mouse, keyboard, window, system, ai)")
    parameters: Dict[str, Any] = Field(..., description="JSON Schema parameters")


# ---------------------------------------------------------
# 2. 전체 지원 도구(Tool) 레지스트리
# ---------------------------------------------------------
AGENT_TOOLS: Dict[str, AgentToolDefinition] = {
    "get_screen_elements": AgentToolDefinition(
        name="get_screen_elements",
        display_name="화면 UI 요소 스캔",
        description="현재 전면 활성 윈도우(또는 특정 창)에서 클릭/입력 가능한 UI 요소(버튼, 입력창, 링크 등) 목록과 해당 요소들의 화면 (X, Y) 좌표를 스캔합니다. 목록에 원하는 요소가 없을 때는 offset을 늘려 다음 페이지를 탐색하거나 query로 특정 단어를 집중 검색할 수 있습니다.",
        category="ai",
        parameters={
            "type": "object",
            "properties": {
                "window_title": {
                    "type": "string",
                    "description": "스캔할 대상 윈도우 제목 (생략 시 현재 가장 앞에 활성화된 창을 스캔)"
                },
                "offset": {
                    "type": "integer",
                    "description": "페이지네이션 시작 오프셋 (이전 목록에 원하는 요소가 없을 때 다음 단위를 탐색하기 위해 사용, 예: 0, 50, 100...)",
                    "default": 0
                },
                "limit": {
                    "type": "integer",
                    "description": "한 번에 조회할 최대 UI 요소 수 (기본값: 50)",
                    "default": 50
                },
                "query": {
                    "type": "string",
                    "description": "특정 이름이나 텍스트를 포함하는 요소만 집중 검색할 때 사용하는 키워드 (예: '증권', '로그인', '검색')"
                }
            },
            "required": []
        }
    ),
    "mouse_click": AgentToolDefinition(
        name="mouse_click",
        display_name="마우스 클릭",
        description="지정한 화면 좌표 (x, y) 위치를 마우스로 클릭합니다. get_screen_elements로 확인한 좌표나 특정 위치를 클릭할 때 사용합니다.",
        category="mouse",
        parameters={
            "type": "object",
            "properties": {
                "x": {
                    "type": "integer",
                    "description": "클릭할 화면 X 절대 좌표"
                },
                "y": {
                    "type": "integer",
                    "description": "클릭할 화면 Y 절대 좌표"
                },
                "button": {
                    "type": "string",
                    "enum": ["left", "right", "double"],
                    "description": "마우스 클릭 종류: left(왼쪽 단일 클릭), right(오른쪽 클릭), double(더블 클릭). 기본값은 left"
                }
            },
            "required": ["x", "y"]
        }
    ),
    "mouse_move": AgentToolDefinition(
        name="mouse_move",
        display_name="마우스 이동",
        description="마우스 커서를 화면의 특정 좌표 (x, y)로 이동시킵니다.",
        category="mouse",
        parameters={
            "type": "object",
            "properties": {
                "x": {"type": "integer", "description": "이동할 목표 X 좌표"},
                "y": {"type": "integer", "description": "이동할 목표 Y 좌표"}
            },
            "required": ["x", "y"]
        }
    ),
    "keyboard_type": AgentToolDefinition(
        name="keyboard_type",
        display_name="텍스트 입력",
        description="현재 포커스가 있는 입력창에 텍스트를 입력합니다. 한글, 영문, 긴 문장 모두 지원합니다.",
        category="keyboard",
        parameters={
            "type": "object",
            "properties": {
                "text": {
                    "type": "string",
                    "description": "입력할 텍스트 내용"
                }
            },
            "required": ["text"]
        }
    ),
    "keyboard_hotkey": AgentToolDefinition(
        name="keyboard_hotkey",
        display_name="단축키 실행",
        description="키보드 단축키 조합을 실행합니다. 예: ['ctrl', 'c'], ['ctrl', 'v'], ['enter'], ['esc'], ['alt', 'tab']",
        category="keyboard",
        parameters={
            "type": "object",
            "properties": {
                "keys": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "동시에 누를 키 이름 목록 (예: ['ctrl', 'c'] 또는 ['enter'])"
                }
            },
            "required": ["keys"]
        }
    ),
    "window_activate": AgentToolDefinition(
        name="window_activate",
        display_name="창 활성화 (맨 앞으로)",
        description="지정한 제목의 프로그램 윈도우를 화면 맨 앞으로 가져오고 포커스를 부여합니다.",
        category="window",
        parameters={
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "description": "활성화할 윈도우 제목 (부분 일치 지원, 예: '메모장', 'Chrome')"
                }
            },
            "required": ["title"]
        }
    ),
    "window_maximize": AgentToolDefinition(
        name="window_maximize",
        display_name="창 최대화",
        description="지정한 창을 전체 화면 크기로 최대화합니다.",
        category="window",
        parameters={
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "description": "최대화할 윈도우 제목 (부분 일치 지원)"
                }
            },
            "required": ["title"]
        }
    ),
    "window_minimize": AgentToolDefinition(
        name="window_minimize",
        display_name="창 최소화",
        description="지정한 창을 작업 표시줄로 최소화하여 숨깁니다.",
        category="window",
        parameters={
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "description": "최소화할 윈도우 제목 (부분 일치 지원)"
                }
            },
            "required": ["title"]
        }
    ),
    "take_screenshot": AgentToolDefinition(
        name="take_screenshot",
        display_name="스크린샷 촬영",
        description="현재 PC 화면 전체를 촬영하여 로컬 파일로 저장하거나 클립보드에 복사합니다.",
        category="system",
        parameters={
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "저장할 이미지 파일 전체 경로 (생략 시 기본 임시 폴더에 저장)"
                },
                "copy_to_clipboard": {
                    "type": "boolean",
                    "description": "클립보드로 복사할지 여부 (기본값: false)"
                }
            },
            "required": []
        }
    ),
    "delay": AgentToolDefinition(
        name="delay",
        display_name="대기",
        description="지정된 시간(초) 동안 아무 작업도 하지 않고 대기합니다.",
        category="system",
        parameters={
            "type": "object",
            "properties": {
                "seconds": {
                    "type": "number",
                    "description": "대기할 시간(초, 예: 1.0, 0.5)"
                }
            },
            "required": ["seconds"]
        }
    ),
    "clipboard_copy": AgentToolDefinition(
        name="clipboard_copy",
        display_name="클립보드 복사",
        description="지정한 텍스트를 Windows 클립보드에 복사합니다.",
        category="system",
        parameters={
            "type": "object",
            "properties": {
                "text": {
                    "type": "string",
                    "description": "클립보드에 복사할 텍스트"
                }
            },
            "required": ["text"]
        }
    ),
    "launch_program": AgentToolDefinition(
        name="launch_program",
        display_name="프로그램 실행",
        description="지정한 실행 파일(.exe) 또는 바로가기(.lnk) 프로그램을 실행합니다. 경로와 선택적 커맨드라인 인자(arguments)를 전달할 수 있습니다.",
        category="system",
        parameters={
            "type": "object",
            "properties": {
                "program_path": {
                    "type": "string",
                    "description": "실행할 파일 또는 프로그램의 전체 절대 경로 (예: 'C:\\Windows\\System32\\notepad.exe')"
                },
                "arguments": {
                    "type": "string",
                    "description": "프로그램에 전달할 커맨드라인 인자/파라미터 (선택 사항, 예: '--incognito' 또는 파일 경로)"
                }
            },
            "required": ["program_path"]
        }
    ),
    "window_close": AgentToolDefinition(
        name="window_close",
        display_name="창 닫기",
        description="지정한 제목의 프로그램 윈도우(또는 현재 전면 활성 창)를 닫습니다. 저장되지 않은 내용이 있을 경우 저장 확인 대화상자가 표시될 수 있습니다.",
        category="window",
        parameters={
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "description": "닫을 윈도우 제목 (생략 시 현재 가장 앞에 활성화된 창을 닫음)"
                }
            },
            "required": []
        }
    ),
    "close_program": AgentToolDefinition(
        name="close_program",
        display_name="프로그램 정상 종료",
        description="지정한 실행 파일/프로세스명(예: 'notepad.exe', 'calculator.exe')을 정상 종료(Soft Closing)합니다. 안전 가드레일이 적용되어 시스템 및 자동화 핵심 프로세스는 종료가 원천 차단됩니다.",
        category="system",
        parameters={
            "type": "object",
            "properties": {
                "process_name": {
                    "type": "string",
                    "description": "종료할 프로그램 프로세스명 (예: 'notepad.exe', 'calc.exe', 'chrome.exe')"
                }
            },
            "required": ["process_name"]
        }
    ),
    "kill_process": AgentToolDefinition(
        name="kill_process",
        display_name="프로세스 강제 종료",
        description="지정한 프로그램 프로세스를 즉시 강제 종료(Process Kill)합니다. 데이터 유실이 발생할 수 있으므로 주의해야 하며, 안전 가드레일에 의해 시스템 핵심 프로세스는 종료가 원천 차단됩니다.",
        category="system",
        parameters={
            "type": "object",
            "properties": {
                "process_name": {
                    "type": "string",
                    "description": "강제 종료할 대상 프로세스명 (예: 'notepad.exe')"
                }
            },
            "required": ["process_name"]
        }
    )
}

# ---------------------------------------------------------
# 3. 프리셋 정의
# ---------------------------------------------------------
PRESET_SKILLS = {
    "basic_interaction": [
        "get_screen_elements",
        "mouse_click",
        "mouse_move",
        "keyboard_type",
        "keyboard_hotkey",
        "window_activate",
        "window_maximize",
        "window_close",
        "take_screenshot"
    ],
    "all": list(AGENT_TOOLS.keys())
}


# ---------------------------------------------------------
# 4. LLM용 Tool Schema(OpenAI / Ollama 규격) 생성
# ---------------------------------------------------------
def get_agent_tools_schema(
    skill_mode: str = "preset",
    preset_name: str = "basic_interaction",
    custom_skills: Optional[List[str]] = None
) -> List[Dict[str, Any]]:
    """
    설정된 모드(preset 또는 custom)에 따라 선별된 스킬 목록을
    Ollama / OpenAI 호환 tools 리스트([{'type': 'function', 'function': {...}}])로 반환합니다.
    """
    if skill_mode == "custom":
        if custom_skills is not None:
            target_keys = [k for k in custom_skills if k in AGENT_TOOLS]
        else:
            target_keys = []
    else:
        target_keys = PRESET_SKILLS.get(preset_name, PRESET_SKILLS["basic_interaction"])

    tools_schema = []
    for key in target_keys:
        tool_def = AGENT_TOOLS.get(key)
        if tool_def:
            tools_schema.append({
                "type": "function",
                "function": {
                    "name": tool_def.name,
                    "description": tool_def.description,
                    "parameters": tool_def.parameters
                }
            })

    return tools_schema


# ---------------------------------------------------------
# 5. 스킬 실행 디스패처 (Tool Dispatcher)
# ---------------------------------------------------------
async def execute_agent_tool(
    name: str,
    args: Dict[str, Any],
    context: Any = None
) -> str:
    """
    에이전트가 호출한 도구(함수)를 실행하고, LLM에 피드백할 결과 문자열을 반환합니다.
    F12 비상 탈출 플래그를 주기적으로 검사합니다.
    """
    if context and hasattr(context, "is_cancelled") and context.is_cancelled():
        return "[실행 중단] 사용자에 의해 비상 중단(F12)되었습니다."

    tool_def = AGENT_TOOLS.get(name)
    if not tool_def:
        return f"[오류] 알 수 없는 스킬입니다: '{name}'"

    logger.info(f"[AgentToolDispatcher] Executing '{name}' with args: {args}")

    try:
        # 1. UI 요소 스캔
        if name == "get_screen_elements":
            win_title = args.get("window_title")
            offset = int(args.get("offset", 0))
            limit = int(args.get("limit", 50))
            query = args.get("query")
            res = uia_service.scan_active_window_elements(
                window_title=win_title,
                offset=offset,
                limit=limit,
                query=query
            )
            return res.get("formatted_text", "스캔 완료 (감지된 요소 없음)")

        # 2. 마우스 클릭
        elif name == "mouse_click":
            x = int(float(args.get("x", 0)))
            y = int(float(args.get("y", 0)))
            btn = str(args.get("button", "left")).lower()

            if btn == "double":
                pyautogui.doubleClick(x, y)
                return f"[성공] ({x}, {y}) 위치를 마우스 더블클릭했습니다."
            elif btn == "right":
                pyautogui.rightClick(x, y)
                return f"[성공] ({x}, {y}) 위치를 마우스 우클릭했습니다."
            else:
                pyautogui.click(x, y)
                return f"[성공] ({x}, {y}) 위치를 마우스 좌클릭했습니다."

        # 3. 마우스 이동
        elif name == "mouse_move":
            x = int(float(args.get("x", 0)))
            y = int(float(args.get("y", 0)))
            pyautogui.moveTo(x, y, duration=0.1)
            return f"[성공] 마우스 커서를 ({x}, {y}) 위치로 이동했습니다."

        # 4. 텍스트 입력
        elif name == "keyboard_type":
            text = str(args.get("text", ""))
            # 안전하고 빠른 클립보드 붙여넣기 방식 사용
            pyperclip.copy(text)
            await asyncio.sleep(0.05)
            pyautogui.hotkey("ctrl", "v")
            await asyncio.sleep(0.05)
            return f"[성공] '{text}' 텍스트를 입력했습니다."

        # 5. 키보드 단축키
        elif name == "keyboard_hotkey":
            keys = args.get("keys", [])
            if isinstance(keys, str):
                keys = [k.strip() for k in keys.split("+")]
            if not keys:
                return "[오류] 누를 키 목록(keys)이 비어 있습니다."
            pyautogui.hotkey(*keys)
            return f"[성공] 단축키 [{' + '.join(keys)}]를 실행했습니다."

        # 6. 창 활성화
        elif name == "window_activate":
            title = str(args.get("title", ""))
            hwnd, _ = uia_service.find_window_target(target_mode="title", window_title=title, match_type="contains")
            if hwnd:
                success = uia_service.activate_window(hwnd)
                if success:
                    return f"[성공] '{title}' 윈도우를 화면 맨 앞으로 활성화했습니다."
                return f"[실패] '{title}' 윈도우를 활성화하지 못했습니다."
            return f"[실패] 제목에 '{title}'이(가) 포함된 윈도우를 찾을 수 없습니다."

        # 7. 창 최대화
        elif name == "window_maximize":
            title = str(args.get("title", ""))
            hwnd, _ = uia_service.find_window_target(target_mode="title", window_title=title, match_type="contains")
            if hwnd:
                success = uia_service.maximize_window(hwnd)
                if success:
                    return f"[성공] '{title}' 윈도우를 최대화했습니다."
                return f"[실패] '{title}' 윈도우를 최대화하지 못했습니다."
            return f"[실패] 제목에 '{title}'이(가) 포함된 윈도우를 찾을 수 없습니다."

        # 8. 창 최소화
        elif name == "window_minimize":
            title = str(args.get("title", ""))
            hwnd, _ = uia_service.find_window_target(target_mode="title", window_title=title, match_type="contains")
            if hwnd:
                success = uia_service.minimize_window(hwnd)
                if success:
                    return f"[성공] '{title}' 윈도우를 최소화했습니다."
                return f"[실패] '{title}' 윈도우를 최소화하지 못했습니다."
            return f"[실패] 제목에 '{title}'이(가) 포함된 윈도우를 찾을 수 없습니다."

        # 9. 스크린샷 촬영
        elif name == "take_screenshot":
            file_path = args.get("file_path")
            copy_clip = args.get("copy_to_clipboard", False)

            # capture_display는 (PIL.Image, dict) 튜플을 반환하므로 언패킹 수행
            capture_res = screen_capture_service.capture_display(target="all")
            img = capture_res[0] if isinstance(capture_res, tuple) else capture_res

            result_msgs = []

            if copy_clip:
                from app.services.screen_capture import copy_image_to_clipboard
                cb_ok = copy_image_to_clipboard(img)
                if cb_ok:
                    result_msgs.append("클립보드에 복사됨")
                else:
                    result_msgs.append("클립보드 복사 불가(권한 제한)")

            if not file_path or not str(file_path).strip():
                from app.core.config import settings
                from datetime import datetime
                os.makedirs(settings.SCREENSHOTS_DIR, exist_ok=True)
                file_path = str(settings.SCREENSHOTS_DIR / f"agent_screenshot_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png")

            target_path = Path(file_path).resolve()
            if not target_path.suffix:
                target_path = target_path.with_suffix(".png")

            target_path.parent.mkdir(parents=True, exist_ok=True)

            ext = target_path.suffix.lstrip(".").upper()
            fmt = "JPEG" if ext == "JPG" else (ext if ext in ("PNG", "JPEG", "WEBP", "BMP") else "PNG")

            if fmt == "JPEG":
                img.convert("RGB").save(str(target_path), format=fmt, quality=95)
            elif fmt == "WEBP":
                img.save(str(target_path), format=fmt, quality=90, method=4)
            else:
                img.save(str(target_path), format=fmt)

            result_msgs.append(f"파일 저장됨: {target_path}")

            # 타임라인 UI 서빙용 미리보기 WebP 생성 및 컨텍스트 바인딩 (세션 ID 존재 시)
            if context and hasattr(context, "session_id") and context.session_id:
                try:
                    preview_url = screen_capture_service.capture(
                        session_id=context.session_id,
                        label="agent_tool_screenshot",
                        target="all"
                    )
                    setattr(context, "_last_screenshot_url", preview_url)
                except Exception as prev_err:
                    logger.debug(f"[AgentToolDispatcher] Optional preview capture error: {prev_err}")

            return f"[성공] 화면 스크린샷 촬영 완료 ({', '.join(result_msgs)}, 해상도: {img.width}x{img.height})"

        # 10. 대기
        elif name == "delay":
            secs = float(args.get("seconds", 1.0))
            # 0.1초 단위로 쪼개어 F12 취소 감지
            elapsed = 0.0
            while elapsed < secs:
                if context and hasattr(context, "is_cancelled") and context.is_cancelled():
                    return "[실행 중단] 대기 중 비상 중단(F12)되었습니다."
                step = min(0.1, secs - elapsed)
                await asyncio.sleep(step)
                elapsed += step
            return f"[성공] {secs}초 동안 대기했습니다."

        # 11. 클립보드 복사
        elif name == "clipboard_copy":
            text = str(args.get("text", ""))
            pyperclip.copy(text)
            return f"[성공] '{text}' 텍스트를 클립보드에 복사했습니다."

        # 12. 프로그램 실행
        elif name == "launch_program":
            prog_path = str(args.get("program_path", "")).strip().strip('"').strip("'")
            arguments = str(args.get("arguments", "")).strip() if args.get("arguments") else ""
            if not prog_path:
                return "[실패] program_path (실행 파일 경로)가 지정되지 않았습니다."

            try:
                if hasattr(os, "startfile"):
                    if arguments:
                        os.startfile(prog_path, arguments=arguments)
                    else:
                        os.startfile(prog_path)
                else:
                    import subprocess
                    cmd = [prog_path]
                    if arguments:
                        cmd.extend(arguments.split())
                    subprocess.Popen(cmd)
            except Exception as e:
                try:
                    import subprocess
                    cmd_line = f'start "" "{prog_path}"'
                    if arguments:
                        cmd_line += f' {arguments}'
                    subprocess.Popen(cmd_line, shell=True)
                except Exception as inner_e:
                    return f"[오류] 프로그램 실행 실패 ('{prog_path}'): {e} (2차 시도 오류: {inner_e})"

            args_desc = f" (인자: '{arguments}')" if arguments else ""
            return f"[성공] 프로그램 실행 완료: '{prog_path}'{args_desc}"

        # 13. 창 닫기
        elif name == "window_close":
            title = args.get("title")
            from app.services.process_service import process_service
            if title and str(title).strip():
                t_str = str(title).strip()
                hwnd, found_title = uia_service.find_window_target(target_mode="title", window_title=t_str, match_type="contains")
                if not hwnd:
                    return f"[실패] 제목에 '{t_str}'이(가) 포함된 윈도우를 찾을 수 없습니다."
                ok = process_service.close_window_by_hwnd(hwnd)
                if ok:
                    return f"[성공] '{found_title or t_str}' 윈도우를 닫았습니다."
                return f"[실패] '{found_title or t_str}' 윈도우 닫기 신호 전송 실패."
            else:
                hwnd, found_title = uia_service.find_window_target(target_mode="current")
                if not hwnd:
                    return "[실패] 현재 활성화된 윈도우를 찾을 수 없습니다."
                ok = process_service.close_window_by_hwnd(hwnd)
                if ok:
                    return f"[성공] 현재 활성 윈도우('{found_title or '알 수 없음'}')를 닫았습니다."
                return "[실패] 현재 활성 윈도우 닫기 신호 전송 실패."

        # 14. 프로그램 정상 종료
        elif name == "close_program":
            p_name = str(args.get("process_name", "")).strip()
            if not p_name:
                return "[실패] process_name (프로세스명)이 지정되지 않았습니다."
            from app.services.process_service import process_service
            ok, msg, count = process_service.close_program_softly(p_name)
            if ok:
                return f"[성공] {msg}"
            return f"[실패] {msg}"

        # 15. 프로세스 강제 종료
        elif name == "kill_process":
            p_name = str(args.get("process_name", "")).strip()
            if not p_name:
                return "[실패] process_name (프로세스명)이 지정되지 않았습니다."
            from app.services.process_service import process_service
            ok, msg, count = process_service.kill_process_by_name(p_name)
            if ok:
                return f"[성공] {msg}"
            return f"[실패] {msg}"

        else:
            return f"[오류] 미구현된 스킬입니다: '{name}'"

    except Exception as e:
        logger.error(f"[AgentToolDispatcher] Error executing '{name}': {e}", exc_info=True)
        return f"[오류 발생] {name} 실행 실패: {str(e)}"
