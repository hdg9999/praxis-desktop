import time
import base64
import io
import ctypes
from typing import Optional, List, Dict, Any
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel
from PIL import Image
import mss

from app.core.config import settings
from app.services.uia_service import uia_service, run_in_desktop_thread
from app.services.screen_capture import screen_capture_service
from app.services.ollama_client import ollama_client
from app.nodes.agent_tools import get_agent_tools_schema, AGENT_TOOLS

router = APIRouter(prefix="/debug", tags=["Debug"])

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
STATIC_DIR.mkdir(parents=True, exist_ok=True)
DEBUG_HTML_PATH = STATIC_DIR / "debug_agent.html"


class WindowInfo(BaseModel):
    hwnd: int
    title: str
    class_name: str
    rect: Dict[str, int]
    is_active: bool


class ScanRequest(BaseModel):
    hwnd: Optional[int] = None
    window_title: Optional[str] = None
    limit: int = 50
    offset: int = 0
    query: Optional[str] = None
    max_elements: Optional[int] = None
    max_depth: int = 16
    bring_to_front: bool = False


class SimulateToolCallRequest(BaseModel):
    model: str
    prompt: str
    system_prompt: Optional[str] = None
    preset: str = "basic_interaction"  # basic_interaction, all, custom
    custom_skills: Optional[List[str]] = None
    elements_text: Optional[str] = None
    window_title: Optional[str] = None


@router.get("/windows", response_model=Dict[str, Any])
def list_windows():
    """
    현재 화면에 열려 있는 가시 윈도우 목록을 Win32 EnumWindows로 수집하여 반환합니다.
    """
    def _enumerate():
        user32 = ctypes.windll.user32
        active_hwnd = user32.GetForegroundWindow()
        windows = []

        class RECT(ctypes.Structure):
            _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long),
                        ("right", ctypes.c_long), ("bottom", ctypes.c_long)]

        def enum_windows_callback(hwnd, extra):
            if not user32.IsWindowVisible(hwnd):
                return True

            length = user32.GetWindowTextLengthW(hwnd)
            if length == 0:
                return True

            buf = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buf, length + 1)
            title = buf.value.strip()
            if not title:
                return True

            cls_buf = ctypes.create_unicode_buffer(256)
            user32.GetClassNameW(hwnd, cls_buf, 256)
            class_name = cls_buf.value

            rect = RECT()
            user32.GetWindowRect(hwnd, ctypes.byref(rect))
            w = rect.right - rect.left
            h = rect.bottom - rect.top

            # 너무 작거나 음수 크기인 창 제외 (최소 100x100)
            if w < 100 or h < 100:
                return True

            # 프롬프트매크로 자체 창이나 기본 시스템 오버레이 등도 식별 가능하도록 포함
            windows.append({
                "hwnd": hwnd,
                "title": title,
                "class_name": class_name,
                "rect": {
                    "left": int(rect.left),
                    "top": int(rect.top),
                    "right": int(rect.right),
                    "bottom": int(rect.bottom),
                    "width": int(w),
                    "height": int(h)
                },
                "is_active": (hwnd == active_hwnd)
            })
            return True

        WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
        user32.EnumWindows(WNDENUMPROC(enum_windows_callback), 0)

        # 활성 창을 최상단으로 정렬
        windows.sort(key=lambda x: (0 if x["is_active"] else 1, x["title"].lower()))
        return windows

    try:
        wins = run_in_desktop_thread(_enumerate) or []
        return {"success": True, "windows": wins, "count": len(wins)}
    except Exception as e:
        return {"success": False, "error": str(e), "windows": []}


@router.post("/scan")
def scan_window(req: ScanRequest):
    """
    선택된 윈도우의 UI 요소를 스캔(RDB 스타일 OFFSET / LIMIT 페이지네이션 및 키워드 필터링 지원)하고
    해당 창의 스크린샷 이미지를 Base64로 인코딩하여 반환합니다.
    """
    start_time = time.time()

    # 1. 대상 창 활성화 (요청 시)
    if req.bring_to_front and req.hwnd:
        try:
            uia_service.activate_window(hwnd=req.hwnd)
            time.sleep(0.15)
        except Exception:
            pass

    # 2. UI 요소 스캔 (페이지네이션 지원)
    effective_limit = req.max_elements if req.max_elements is not None else req.limit
    scan_result = uia_service.scan_active_window_elements(
        window_title=req.window_title,
        hwnd=req.hwnd,
        limit=effective_limit,
        offset=req.offset,
        query=req.query
    )

    duration_ms = int((time.time() - start_time) * 1000)

    # 3. 대상 창 스크린샷 캡처
    screenshot_base64 = ""
    w_rect = scan_result.get("window_rect") or {}
    w = w_rect.get("width", 0)
    h = w_rect.get("height", 0)
    left = w_rect.get("left", 0)
    top = w_rect.get("top", 0)

    def _capture_window_image():
        if w > 10 and h > 10:
            with mss.MSS() as sct:
                try:
                    sct_img = sct.grab({"left": left, "top": top, "width": w, "height": h})
                    pil_img = Image.frombytes("RGB", sct_img.size, sct_img.bgra, "raw", "BGRX")
                    buf = io.BytesIO()
                    pil_img.save(buf, format="WEBP", quality=85)
                    return f"data:image/webp;base64,{base64.b64encode(buf.getvalue()).decode('utf-8')}"
                except Exception:
                    pass
        # 폴백: 주 화면 전체 캡처
        img, _, _ = screen_capture_service.capture_image()
        buf = io.BytesIO()
        img.save(buf, format="WEBP", quality=80)
        return f"data:image/webp;base64,{base64.b64encode(buf.getvalue()).decode('utf-8')}"

    try:
        screenshot_base64 = run_in_desktop_thread(_capture_window_image)
    except Exception:
        screenshot_base64 = ""

    return {
        "success": True,
        "window_title": scan_result.get("window_title", ""),
        "hwnd": scan_result.get("hwnd", 0),
        "window_rect": w_rect,
        "elements": scan_result.get("elements", []),
        "formatted_text": scan_result.get("formatted_text", ""),
        "element_count": len(scan_result.get("elements", [])),
        "total_count": scan_result.get("total_count", 0),
        "offset": scan_result.get("offset", 0),
        "limit": scan_result.get("limit", effective_limit),
        "has_more": scan_result.get("has_more", False),
        "next_offset": scan_result.get("next_offset"),
        "prev_offset": scan_result.get("prev_offset"),
        "current_page": scan_result.get("current_page", 1),
        "total_pages": scan_result.get("total_pages", 1),
        "screenshot_base64": screenshot_base64,
        "scan_duration_ms": duration_ms
    }


@router.get("/tools")
def list_available_tools():
    """
    디버거에서 선택 가능한 전체 스킬 목록 및 설명 반환
    """
    tools = []
    for key, spec in AGENT_TOOLS.items():
        tools.append({
            "key": key,
            "name": spec.display_name or spec.name,
            "function_name": spec.name,
            "category": spec.category,
            "description": spec.description,
            "parameters": spec.parameters
        })
    return {"tools": tools}


@router.get("/models")
async def list_models():
    """
    로컬 Ollama에 설치된 모델 목록 반환
    """
    try:
        is_healthy = await ollama_client.check_health()
        if not is_healthy:
            return {"success": False, "error": "Ollama 서버에 연결할 수 없습니다. Ollama가 실행 중인지 확인하세요.", "models": []}
        models = await ollama_client.get_models()
        return {"success": True, "models": models}
    except Exception as e:
        return {"success": False, "error": str(e), "models": []}


@router.post("/simulate-tool-call")
async def simulate_tool_call(req: SimulateToolCallRequest):
    """
    지정된 모델, 프롬프트, UI 스캔 컨텍스트로 1-step Tool Calling 시뮬레이션을 수행하고
    모델의 추론 과정(Thought), 선택한 도구(Tool Call), 정확성 진단 리포트를 생성합니다.
    """
    # 1. 도구 스키마 준비
    tools_schema = get_agent_tools_schema(
        skill_mode=req.preset,
        custom_skills=req.custom_skills
    )

    # 2. UI 스캔 컨텍스트 준비
    elements_text = req.elements_text
    if not elements_text:
        scan_res = uia_service.scan_active_window_elements(window_title=req.window_title, max_elements=50)
        elements_text = scan_res.get("formatted_text", "")

    # 3. 프롬프트 메시지 구성
    sys_prompt = req.system_prompt or (
        "너는 Windows 데스크톱 환경에서 사용자의 명령을 수행하는 스마트 AI 에이전트다.\n"
        "사용자가 어떤 동작을 지시하면 현재 화면에 감지된 상호작용 가능 UI 요소 목록을 확인하고,\n"
        "제공된 도구(Tool) 중 가장 적절한 도구를 호출하여 목표를 달성하라.\n"
        "중요 지침:\n"
        "1. 도구를 호출하기 전에 반드시 현재 화면 상황을 분석하고 어떤 도구를 왜 호출하는지 1-2줄의 생각(Thought)을 작성하라.\n"
        "2. UI 요소를 클릭할 때는 UI 요소 목록에 제공된 좌표 (X, Y)를 마우스 클릭 도구(mouse_click)의 인자로 정확히 입력하라.\n"
        "3. 만약 화면에 원하는 요소가 보이지 않으면 '화면 UI 요소 스캔(get_screen_elements)' 도구를 다시 호출하거나 사용자에게 알리라."
    )

    user_content = f"{elements_text}\n\n[사용자 명령]\n{req.prompt}"

    messages = [
        {"role": "system", "content": sys_prompt},
        {"role": "user", "content": user_content}
    ]

    # 4. Ollama 단일 스텝 호출
    start_time = time.time()
    try:
        response = await ollama_client.chat(
            model=req.model,
            messages=messages,
            tools=tools_schema if tools_schema else None
        )
    except Exception as e:
        return {
            "success": False,
            "error": f"Ollama 호출 실패: {str(e)}",
            "diagnosis": {
                "status": "ERROR",
                "summary": "Ollama 백엔드 통신 실패",
                "details": str(e)
            }
        }

    duration_ms = int((time.time() - start_time) * 1000)

    # 5. 응답 분석 (Thinking, Tool Calls)
    raw_content = response.get("content", "")
    raw_tool_calls = response.get("tool_calls", [])
    raw_thinking = response.get("thinking", "")

    # Qwen/DeepSeek 네이티브 thinking 필드 또는 <think> 태그 분리
    thought = ""
    if raw_thinking:
        thought = raw_thinking.strip()
        final_answer = raw_content.strip()
    elif "<think>" in raw_content and "</think>" in raw_content:
        parts = raw_content.split("</think>")
        thought = parts[0].replace("<think>", "").strip()
        final_answer = parts[1].strip()
    else:
        thought = raw_content.strip()
        final_answer = raw_content.strip()

    # 6. 진단(Diagnosis) 생성
    diagnosis_status = "SUCCESS"
    diagnosis_summary = ""
    diagnosis_hints = []

    if not tools_schema:
        diagnosis_status = "INFO"
        diagnosis_summary = "도구가 제공되지 않은 모드(스킬 0개)입니다. 일반 대화 답변이 생성되었습니다."
    elif not raw_tool_calls:
        diagnosis_status = "WARNING"
        diagnosis_summary = "모델이 도구(Tool Call)를 호출하지 않고 일반 텍스트로만 답변했습니다."
        diagnosis_hints.append("원인 1: 소형 모델이 시스템 프롬프트의 도구 호출 형식을 인지하지 못했을 수 있습니다.")
        diagnosis_hints.append("원인 2: 프롬프트에 '...을 클릭해줘' 대신 '...의 좌표를 찾아 클릭 도구를 실행해'와 같이 직접적인 행동 지시어를 사용해 보세요.")
        diagnosis_hints.append("원인 3: Tool Calling 능력이 더 뛰어난 모델(예: Qwen 2.5 14B/32B, Llama 3.1 8B 등)을 테스트해 보세요.")
    else:
        first_call = raw_tool_calls[0]
        fn_name = first_call.get("function", {}).get("name", "")
        fn_args = first_call.get("function", {}).get("arguments", {})

        diagnosis_status = "SUCCESS"
        diagnosis_summary = f"모델이 도구 '{fn_name}'을(를) 정상 호출했습니다."
        
        if fn_name == "mouse_click":
            x = fn_args.get("x")
            y = fn_args.get("y")
            diagnosis_hints.append(f"호출된 마우스 좌표: X={x}, Y={y}")
            diagnosis_hints.append("이 좌표가 좌측 화면 캡처 이미지 위의 목표 UI 요소(빨간색/노란색 박스)와 일치하는지 확인해 보세요.")

    return {
        "success": True,
        "model": req.model,
        "duration_ms": duration_ms,
        "thought": thought,
        "final_answer": final_answer,
        "tool_calls": raw_tool_calls,
        "tools_count": len(tools_schema),
        "diagnosis": {
            "status": diagnosis_status,
            "summary": diagnosis_summary,
            "hints": diagnosis_hints
        }
    }
