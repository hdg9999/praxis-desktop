import asyncio
import base64
import io
import os
import re
import subprocess
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional, Tuple
import cv2
import numpy as np
from PIL import Image
import pyautogui
import pyperclip
from app.core.config import settings
from app.nodes.base import BaseNode, ExecutionContext, NodeResult
from app.services.screen_capture import screen_capture_service, copy_image_to_clipboard
from app.services.uia_service import uia_service

# PyAutoGUI 안전 설정 (코너 이동 시 FailSafe 방지 대신 커스텀 킬 스위치 사용)
pyautogui.FAILSAFE = False

def render_template(template: str, variables: Dict[str, Any]) -> str:
    """{{variable}} 형태의 플레이스홀더를 context 변수 값으로 치환"""
    if not isinstance(template, str):
        return str(template)
    
    def replacer(match):
        key = match.group(1).strip()
        return str(variables.get(key, match.group(0)))

    return re.sub(r"\{\{([^}]+)\}\}", replacer, template)

# 한글 유니코드 및 2벌식 키보드 변환 테이블
HANGUL_BASE = 0xAC00
HANGUL_END = 0xD7A3

CHOSUNG_LIST = [
    'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
    'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'
]

JUNGSUNG_LIST = [
    'ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ',
    'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'
]

JONGSUNG_LIST = [
    '', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ',
    'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ',
    'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'
]

COMPLEX_JUNGSUNG = {
    'ㅘ': ['ㅗ', 'ㅏ'],
    'ㅙ': ['ㅗ', 'ㅐ'],
    'ㅚ': ['ㅗ', 'ㅣ'],
    'ㅝ': ['ㅜ', 'ㅓ'],
    'ㅞ': ['ㅜ', 'ㅔ'],
    'ㅟ': ['ㅜ', 'ㅣ'],
    'ㅢ': ['ㅡ', 'ㅣ'],
}

COMPLEX_JONGSUNG = {
    'ㄳ': ['ㄱ', 'ㅅ'],
    'ㄵ': ['ㄴ', 'ㅈ'],
    'ㄶ': ['ㄴ', 'ㅎ'],
    'ㄺ': ['ㄹ', 'ㄱ'],
    'ㄻ': ['ㄹ', 'ㅁ'],
    'ㄼ': ['ㄹ', 'ㅂ'],
    'ㄽ': ['ㄹ', 'ㅅ'],
    'ㄾ': ['ㄹ', 'ㅌ'],
    'ㄿ': ['ㄹ', 'ㅍ'],
    'ㅀ': ['ㄹ', 'ㅎ'],
    'ㅄ': ['ㅂ', 'ㅅ'],
}

KOR_JAMO_TO_KEY = {
    'ㄱ': 'r', 'ㄲ': 'R', 'ㄴ': 's', 'ㄷ': 'e', 'ㄸ': 'E',
    'ㄹ': 'f', 'ㅁ': 'a', 'ㅂ': 'q', 'ㅃ': 'Q', 'ㅅ': 't',
    'ㅆ': 'T', 'ㅇ': 'd', 'ㅈ': 'w', 'ㅉ': 'W', 'ㅊ': 'c',
    'ㅋ': 'z', 'ㅌ': 'x', 'ㅍ': 'v', 'ㅎ': 'g',
    'ㅏ': 'k', 'ㅐ': 'o', 'ㅑ': 'i', 'ㅒ': 'O', 'ㅓ': 'j',
    'ㅔ': 'p', 'ㅕ': 'u', 'ㅖ': 'P', 'ㅗ': 'h', 'ㅛ': 'y',
    'ㅜ': 'n', 'ㅠ': 'b', 'ㅡ': 'm', 'ㅣ': 'l'
}

def decompose_hangul_to_keys(text: str) -> list[tuple[str, Optional[str]]]:
    """
    한글 텍스트를 초성/중성/종성 및 2벌식 가상 키(QWERTY)로 분해합니다.
    반환 형태: list[(문자표시, 매핑된_키코드_또는_None)]
    """
    items: list[tuple[str, Optional[str]]] = []
    for ch in text:
        code = ord(ch)
        if HANGUL_BASE <= code <= HANGUL_END:
            s_idx = code - HANGUL_BASE
            cho = CHOSUNG_LIST[s_idx // (21 * 28)]
            jung = JUNGSUNG_LIST[(s_idx // 28) % 21]
            jong = JONGSUNG_LIST[s_idx % 28]

            # 초성
            items.append((cho, KOR_JAMO_TO_KEY.get(cho, cho)))

            # 중성 (이중모음 분해)
            if jung in COMPLEX_JUNGSUNG:
                for sub in COMPLEX_JUNGSUNG[jung]:
                    items.append((sub, KOR_JAMO_TO_KEY.get(sub, sub)))
            else:
                items.append((jung, KOR_JAMO_TO_KEY.get(jung, jung)))

            # 종성 (겹받침 분해)
            if jong:
                if jong in COMPLEX_JONGSUNG:
                    for sub in COMPLEX_JONGSUNG[jong]:
                        items.append((sub, KOR_JAMO_TO_KEY.get(sub, sub)))
                else:
                    items.append((jong, KOR_JAMO_TO_KEY.get(jong, jong)))

        elif ch in KOR_JAMO_TO_KEY:
            items.append((ch, KOR_JAMO_TO_KEY[ch]))
        elif ch in COMPLEX_JUNGSUNG:
            for sub in COMPLEX_JUNGSUNG[ch]:
                items.append((sub, KOR_JAMO_TO_KEY.get(sub, sub)))
        elif ch in COMPLEX_JONGSUNG:
            for sub in COMPLEX_JONGSUNG[ch]:
                items.append((sub, KOR_JAMO_TO_KEY.get(sub, sub)))
        else:
            items.append((ch, None))
    return items

def load_template_image(object_data: Dict[str, Any], config: Dict[str, Any]) -> Tuple[Optional[np.ndarray], str]:
    """
    object_data 또는 config에서 템플릿 이미지를 numpy array(BGR) 형태로 로드
    """
    img_url = object_data.get("image_url") or config.get("object_image")
    b64_data = object_data.get("base64_image") or config.get("object_base64")
    obj_name = object_data.get("name") or config.get("object_name", "오브젝트")

    # 1. 파일 시스템 경로 확인
    if img_url:
        filename = Path(img_url).name
        file_path = settings.OBJECTS_DIR / filename
        if file_path.exists():
            cv_img = cv2.imread(str(file_path))
            if cv_img is not None:
                return cv_img, obj_name

    # 2. Base64 데이터 확인
    if b64_data:
        try:
            if "," in b64_data:
                b64_data = b64_data.split(",", 1)[1]
            raw_bytes = base64.b64decode(b64_data)
            pil_img = Image.open(io.BytesIO(raw_bytes)).convert("RGB")
            cv_img = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
            return cv_img, obj_name
        except Exception as e:
            print(f"[Object Click] Base64 디코딩 실패: {e}")

    return None, obj_name

def find_image_on_screen(tpl_img: np.ndarray, confidence: float = 0.8) -> Optional[Tuple[int, int, float]]:
    """연결된 모든 모니터(다중 모니터)를 순회 캡처하여 tpl_img 템플릿 이미지가 존재하는지 매칭하고 (global_x, global_y, max_val)을 반환합니다."""
    try:
        monitors_data = screen_capture_service.capture_monitors()
        tpl_h, tpl_w = tpl_img.shape[:2]
        is_low_std = np.std(tpl_img) < 1.0

        best_score = -1.0
        best_pos = None

        for screen_pil, mon_meta in monitors_data:
            screen_cv = cv2.cvtColor(np.array(screen_pil), cv2.COLOR_RGB2BGR)
            if screen_cv.shape[0] < tpl_h or screen_cv.shape[1] < tpl_w:
                continue

            if is_low_std:
                res = cv2.matchTemplate(screen_cv, tpl_img, cv2.TM_SQDIFF_NORMED)
                min_val, _, min_loc, _ = cv2.minMaxLoc(res)
                max_val = max(0.0, 1.0 - min_val)
                max_loc = min_loc
            else:
                res = cv2.matchTemplate(screen_cv, tpl_img, cv2.TM_CCOEFF_NORMED)
                res = np.nan_to_num(res, nan=-1.0)
                _, max_val, _, max_loc = cv2.minMaxLoc(res)

            if max_val > best_score:
                best_score = float(max_val)
                offset_x = mon_meta.get("left", 0)
                offset_y = mon_meta.get("top", 0)
                center_x = offset_x + max_loc[0] + tpl_w // 2
                center_y = offset_y + max_loc[1] + tpl_h // 2
                best_pos = (center_x, center_y, best_score)

        if best_pos and best_score >= confidence:
            return best_pos
    except Exception as e:
        print(f"[find_image_on_screen] 매칭 에러: {e}")
    return None

def show_topmost_message_box(
    title: str,
    message: str,
    message_type: str = "info",
    button_type: str = "ok"
) -> int:
    """
    Windows 네이티브 MessageBoxW를 화면 최상단(MB_TOPMOST | MB_SETFOREGROUND)으로 출력하고
    사용자가 클릭한 버튼의 반환 코드(IDOK=1, IDCANCEL=2, IDYES=6, IDNO=7)를 반환합니다.
    'continue_stop' 모드에서는 스레드 로컬 WH_CBT 훅을 통해 버튼 텍스트를 ['계속', '중지']로 렌더링합니다.
    """
    import ctypes
    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32

    MB_OK = 0x00000000
    MB_OKCANCEL = 0x00000001
    MB_YESNO = 0x00000004

    MB_ICONERROR = 0x00000010
    MB_ICONWARNING = 0x00000030
    MB_ICONINFORMATION = 0x00000040

    MB_SETFOREGROUND = 0x00010000
    MB_TOPMOST = 0x00040000

    icon_map = {
        "info": MB_ICONINFORMATION,
        "warning": MB_ICONWARNING,
        "error": MB_ICONERROR,
    }
    icon_flag = icon_map.get(str(message_type).lower(), MB_ICONINFORMATION)

    btn_key = str(button_type).lower()
    if btn_key == "yes_no":
        btn_flag = MB_YESNO
    elif btn_key == "continue_stop":
        btn_flag = MB_OKCANCEL
    else:
        btn_flag = MB_OK

    flags = btn_flag | icon_flag | MB_TOPMOST | MB_SETFOREGROUND

    if btn_key == "continue_stop":
        WH_CBT = 5
        HCBT_ACTIVATE = 5
        IDOK = 1
        IDCANCEL = 2

        HOOKPROC = ctypes.WINFUNCTYPE(ctypes.c_ssize_t, ctypes.c_int, ctypes.wintypes.WPARAM, ctypes.wintypes.LPARAM)
        h_hook = [None]

        def _cbt_proc(nCode, wParam, lParam):
            if nCode == HCBT_ACTIVATE:
                try:
                    hwnd_dlg = int(wParam)
                    user32.SetDlgItemTextW(hwnd_dlg, IDOK, "계속")
                    user32.SetDlgItemTextW(hwnd_dlg, IDCANCEL, "중지")
                except Exception:
                    pass
                finally:
                    if h_hook[0]:
                        user32.UnhookWindowsHookEx(h_hook[0])
                        h_hook[0] = None
            return user32.CallNextHookEx(h_hook[0], nCode, wParam, lParam)

        cb_func = HOOKPROC(_cbt_proc)
        tid = kernel32.GetCurrentThreadId()
        try:
            h_hook[0] = user32.SetWindowsHookExW(WH_CBT, cb_func, None, tid)
            return int(user32.MessageBoxW(0, str(message), str(title), flags))
        finally:
            if h_hook[0]:
                user32.UnhookWindowsHookEx(h_hook[0])
                h_hook[0] = None

    return int(user32.MessageBoxW(0, str(message), str(title), flags))


async def resolve_target_point_async(
    mode: str,
    x: Optional[Any],
    y: Optional[Any],
    object_data: Optional[Dict[str, Any]],
    config: Dict[str, Any],
    context: ExecutionContext,
    point_label: str = "대상"
) -> Tuple[int, int, str]:
    """
    좌표('coordinate') 또는 UI 오브젝트('object') 모드에 따라 화면상의 (x, y) 좌표와 설명 문자열을 반환합니다.
    """
    obj = object_data or {}
    has_obj = bool(obj and (obj.get("name") or obj.get("orig_name") or obj.get("automation_id") or obj.get("image_url") or obj.get("base64_image") or obj.get("x") is not None))

    if mode == "object" or (mode != "coordinate" and has_obj):
        if not has_obj:
            raise ValueError(f"{point_label} UI 오브젝트가 선택되지 않았습니다.")

        obj_name = obj.get("name") or obj.get("orig_name") or point_label
        search_mode = config.get("search_mode", "hybrid")
        fallback_coords = bool(config.get("fallback_to_coords", True))
        auto_focus_scroll = bool(config.get("auto_focus_scroll", True))
        confidence = float(config.get("confidence", obj.get("confidence", 0.8)))
        timeout = float(config.get("timeout", 3.0))

        # 1단계: Windows UIA 객체 속성 탐색
        if search_mode in ("hybrid", "uia_only"):
            uia_target_name = obj.get("name")
            uia_orig_name = obj.get("orig_name")
            uia_ctrl_type = obj.get("control_type")
            uia_auto_id = obj.get("automation_id")
            uia_win_title = obj.get("window_title")
            uia_cls_name = obj.get("class_name")

            if uia_target_name or uia_orig_name or uia_auto_id:
                uia_pos = uia_service.find_control(
                    name=uia_target_name,
                    control_type=uia_ctrl_type,
                    automation_id=uia_auto_id,
                    orig_name=uia_orig_name,
                    window_title=uia_win_title,
                    class_name=uia_cls_name,
                    auto_focus_scroll=auto_focus_scroll
                )
                if uia_pos:
                    ux, uy = int(uia_pos[0]), int(uia_pos[1])
                    return ux, uy, f"[UIA 객체: '{obj_name}'] ({ux}, {uy})"

            if search_mode == "uia_only":
                if fallback_coords and obj.get("x") is not None and obj.get("y") is not None:
                    ox = int(obj.get("x")) + int(obj.get("width", 0)) // 2
                    oy = int(obj.get("y")) + int(obj.get("height", 0)) // 2
                    return ox, oy, f"[UIA 폴백 좌표: '{obj_name}'] ({ox}, {oy})"
                raise RuntimeError(f"화면에서 {point_label} UIA 컨트롤 '{obj_name}'를 찾지 못했습니다.")

        # 2단계: OpenCV 템플릿 이미지 매칭 탐색
        tpl_img, _ = load_template_image(obj, config)
        if tpl_img is not None:
            start_time = time.time()
            while time.time() - start_time <= timeout:
                if context.is_cancelled():
                    raise asyncio.CancelledError("사용자 또는 비상 핫키에 의해 중단되었습니다.")
                match_res = find_image_on_screen(tpl_img, confidence=confidence)
                if match_res:
                    cx, cy, score = match_res
                    return int(cx), int(cy), f"[이미지 일치({score:.0%}): '{obj_name}'] ({int(cx)}, {int(cy)})"
                await asyncio.sleep(0.15)

        # 3단계: 원래 선택 좌표 폴백
        if fallback_coords and obj.get("x") is not None and obj.get("y") is not None:
            ox = int(obj.get("x")) + int(obj.get("width", 0)) // 2
            oy = int(obj.get("y")) + int(obj.get("height", 0)) // 2
            return ox, oy, f"[폴백 좌표: '{obj_name}'] ({ox}, {oy})"

        raise RuntimeError(f"화면에서 {point_label} UI 오브젝트 '{obj_name}'를 찾지 못했습니다.")

    # 좌표 모드
    if x is None or y is None or str(x).strip() == "" or str(y).strip() == "":
        raise ValueError(f"{point_label} 좌표(X, Y)가 지정되지 않았습니다.")
    rx = int(float(render_template(str(x), context.variables)))
    ry = int(float(render_template(str(y), context.variables)))
    return rx, ry, f"좌표 ({rx}, {ry})"


class GeneralNode(BaseNode):

    def __init__(self, id: str, name: str, subtype: str, config: Dict[str, Any]):
        super().__init__(id, name, "GENERAL", config)
        self.subtype = subtype

    async def execute_action(self, context: ExecutionContext) -> Any:
        subtype = self.subtype

        if subtype == "mouse_click":
            click_mode = self.config.get("click_mode", "coordinate")
            object_data = self.config.get("object_data", {})
            has_object = bool(object_data and (object_data.get("image_url") or object_data.get("base64_image")))

            button = self.config.get("button", "left")
            clicks = int(self.config.get("clicks", 1))
            move_mode = self.config.get("move_mode", "instant")  # instant | smooth
            duration = float(self.config.get("duration", 0.2))

            def _perform_click(target_x: Optional[Any], target_y: Optional[Any]) -> None:
                if target_x is not None and target_y is not None:
                    tx, ty = int(target_x), int(target_y)
                    if move_mode == "smooth" and duration > 0:
                        pyautogui.moveTo(tx, ty, duration=duration)
                        pyautogui.click(button=button, clicks=clicks)
                    else:
                        pyautogui.click(x=tx, y=ty, button=button, clicks=clicks)
                else:
                    pyautogui.click(button=button, clicks=clicks)

            # UI 오브젝트 / 일치 이미지 클릭 모드
            if click_mode == "object" or has_object:
                obj_name = object_data.get("name") or self.config.get("object_name", "오브젝트")
                search_mode = self.config.get("search_mode", "hybrid")  # hybrid | uia_only | image_only
                fallback_coords = bool(self.config.get("fallback_to_coords", True))

                # 1단계: Windows UIA 속성(orig_name, name, control_type, automation_id, window_title) 기반 실시간 직접 탐색
                if search_mode in ("hybrid", "uia_only"):
                    uia_target_name = object_data.get("name")
                    uia_orig_name = object_data.get("orig_name")
                    uia_ctrl_type = object_data.get("control_type")
                    uia_auto_id = object_data.get("automation_id")
                    uia_win_title = object_data.get("window_title")
                    uia_cls_name = object_data.get("class_name")
                    auto_focus_scroll = bool(self.config.get("auto_focus_scroll", True))

                    if uia_target_name or uia_orig_name or uia_auto_id:
                        uia_pos = uia_service.find_control(
                            name=uia_target_name,
                            control_type=uia_ctrl_type,
                            automation_id=uia_auto_id,
                            orig_name=uia_orig_name,
                            window_title=uia_win_title,
                            class_name=uia_cls_name,
                            auto_focus_scroll=auto_focus_scroll
                        )
                        if uia_pos:
                            ux, uy = uia_pos
                            _perform_click(ux, uy)
                            prefix = "[하이브리드 1단계: UIA 객체 일치]" if search_mode == "hybrid" else "[UIA 객체 일치]"
                            scroll_msg = " (자동 포커싱/스크롤 적용)" if auto_focus_scroll else ""
                            return f"{prefix} '{obj_name}' 컨트롤 감지{scroll_msg} 및 클릭 성공 (좌표: ({ux}, {uy}))"

                    if search_mode == "uia_only":
                        if fallback_coords and object_data.get("x") is not None:
                            orig_x = int(object_data.get("x")) + int(object_data.get("width", 0)) // 2
                            orig_y = int(object_data.get("y")) + int(object_data.get("height", 0)) // 2
                            _perform_click(orig_x, orig_y)
                            return f"[UIA 미검출 폴백] '{obj_name}' UIA 컨트롤 미발견 -> 원래 좌표 ({orig_x}, {orig_y}) 클릭 완료"
                        raise RuntimeError(f"화면에서 Windows UIA 컨트롤 '{obj_name}'를 찾지 못했습니다.")

                # 2단계: UIA 미검출 시 OpenCV 템플릿 매칭 수행
                tpl_img, _ = load_template_image(object_data, self.config)
                if tpl_img is None:
                    orig_x = object_data.get("x")
                    orig_y = object_data.get("y")
                    if orig_x is not None and orig_y is not None:
                        orig_w = object_data.get("width", 0)
                        orig_h = object_data.get("height", 0)
                        cx = int(orig_x) + int(orig_w) // 2
                        cy = int(orig_y) + int(orig_h) // 2
                        _perform_click(cx, cy)
                        return f"[하이브리드 폴백] 오브젝트 이미지 부재: 원래 지정 좌표 ({cx}, {cy}) 클릭 수행"
                    raise ValueError(f"오브젝트 '{obj_name}'의 템플릿 이미지를 찾을 수 없습니다.")

                confidence = float(self.config.get("confidence", 0.8))
                timeout = float(self.config.get("timeout", 3.0))

                start_time = time.time()
                best_match = None
                max_val_found = 0.0
                tpl_h, tpl_w = tpl_img.shape[:2]

                while time.time() - start_time <= timeout:
                    if context.is_cancelled():
                        raise asyncio.CancelledError("사용자 또는 비상 핫키에 의해 중단되었습니다.")

                    monitors_data = screen_capture_service.capture_monitors()
                    is_low_std = np.std(tpl_img) < 1.0

                    for screen_pil, mon_meta in monitors_data:
                        screen_cv = cv2.cvtColor(np.array(screen_pil), cv2.COLOR_RGB2BGR)
                        if screen_cv.shape[0] < tpl_h or screen_cv.shape[1] < tpl_w:
                            continue

                        # 템플릿 매칭 (단색/저분산 이미지 안정화 및 정규화 상관계수)
                        if is_low_std:
                            res = cv2.matchTemplate(screen_cv, tpl_img, cv2.TM_SQDIFF_NORMED)
                            min_val, _, min_loc, _ = cv2.minMaxLoc(res)
                            max_val = max(0.0, 1.0 - min_val)
                            max_loc = min_loc
                        else:
                            res = cv2.matchTemplate(screen_cv, tpl_img, cv2.TM_CCOEFF_NORMED)
                            res = np.nan_to_num(res, nan=-1.0)
                            _, max_val, _, max_loc = cv2.minMaxLoc(res)

                        if max_val > max_val_found:
                            max_val_found = max_val

                        if max_val >= confidence:
                            offset_x = mon_meta.get("left", 0)
                            offset_y = mon_meta.get("top", 0)
                            center_x = offset_x + max_loc[0] + tpl_w // 2
                            center_y = offset_y + max_loc[1] + tpl_h // 2
                            best_match = (center_x, center_y, max_val)
                            break

                    if best_match:
                        break

                    await asyncio.sleep(0.2)

                if best_match:
                    cx, cy, score = best_match
                    _perform_click(cx, cy)
                    return f"[하이브리드 2단계: 이미지 일치] UI 오브젝트 '{obj_name}' 감지 및 클릭 성공 (좌표: ({cx}, {cy}), 유사도: {score:.1%})"

                # 3단계: 타임아웃 발생 시 폴백 처리
                if fallback_coords and object_data.get("x") is not None:
                    orig_x = int(object_data.get("x")) + int(object_data.get("width", 0)) // 2
                    orig_y = int(object_data.get("y")) + int(object_data.get("height", 0)) // 2
                    _perform_click(orig_x, orig_y)
                    return f"[하이브리드 3단계: 좌표 폴백] '{obj_name}' 매칭 대기 초과(최대 유사도: {max_val_found:.1%} < {confidence:.0%}). 원래 좌표 ({orig_x}, {orig_y}) 폴백 클릭 완료"

                raise RuntimeError(
                    f"화면에서 UI 오브젝트 '{obj_name}'를 찾지 못했습니다. (최대 유사도: {max_val_found:.1%} < 기준치 {confidence:.0%}, 대기 {timeout}초 초과)"
                )

            # 기존 좌표 클릭 모드
            x = self.config.get("x")
            y = self.config.get("y")

            _perform_click(x, y)
            move_info = f" (스무스 이동: {duration}s)" if (move_mode == "smooth" and duration > 0 and x is not None and y is not None) else ""
            return f"Clicked {button} button ({clicks} times) at ({x}, {y}){move_info}"

        elif subtype == "mouse_move":
            x = int(self.config.get("x", 0))
            y = int(self.config.get("y", 0))
            duration = float(self.config.get("duration", 0.2))
            pyautogui.moveTo(x, y, duration=duration)
            return f"Moved to ({x}, {y})"

        elif subtype == "keyboard_type":
            text = self.config.get("text", "")
            resolved_text = render_template(text, context.variables)
            type_mode = self.config.get("type_mode", "instant")
            interval = max(0.005, float(self.config.get("interval", 0.05)))
            decompose_korean = bool(self.config.get("decompose_korean", True))

            if type_mode == "smooth":
                await self._type_smooth(resolved_text, interval, decompose_korean, context)
                korean_note = " (한글 자모 순서 타이핑)" if decompose_korean else ""
                return f"Typed text (천천히 입력, 간격 {interval}s{korean_note}): {resolved_text}"
            else:
                # 즉시 입력: 클립보드를 통한 고속 붙여넣기
                pyperclip.copy(resolved_text)
                pyautogui.hotkey("ctrl", "v")
                await asyncio.sleep(0.05)
                return f"Typed text (즉시 입력): {resolved_text}"

        elif subtype == "keyboard_hotkey":
            keys = self.config.get("keys", [])
            if isinstance(keys, str):
                keys = [k.strip() for k in keys.split("+")]
            pyautogui.hotkey(*keys)
            return f"Pressed hotkey: {'+'.join(keys)}"

        elif subtype == "delay":
            dynamic_wait = bool(self.config.get("dynamic_wait", False))
            seconds = float(self.config.get("seconds", 1.0))

            # 1. 수동 고정 대기 모드 (Off: 기존 동작 100% 호환)
            if not dynamic_wait:
                elapsed = 0.0
                while elapsed < seconds:
                    if context.is_cancelled():
                        raise asyncio.CancelledError("사용자 또는 비상 핫키에 의해 중단되었습니다.")
                    step = min(0.2, seconds - elapsed)
                    await asyncio.sleep(step)
                    elapsed += step
                return f"Waited {seconds} seconds"

            # 2. 동적 대기 모드 (On: seconds는 최대 타임아웃으로 동작)
            wait_mode = self.config.get("wait_mode", "element")  # element (부분로딩) | window_ready (완전로딩)
            object_data = self.config.get("object_data", {}) or {}
            fail_on_timeout = bool(self.config.get("fail_on_timeout", True))
            post_delay = max(0.0, float(self.config.get("post_delay", 0.0)))
            confidence = float(self.config.get("confidence", 0.8))

            obj_name = object_data.get("name") or self.config.get("object_name", "오브젝트")
            tpl_img, _ = load_template_image(object_data, self.config)

            # UIA 식별 메타데이터 추출
            uia_target_name = object_data.get("name")
            uia_orig_name = object_data.get("orig_name")
            uia_ctrl_type = object_data.get("control_type")
            uia_auto_id = object_data.get("automation_id")
            uia_win_title = object_data.get("window_title")
            uia_cls_name = object_data.get("class_name")

            start_time = time.time()
            detected = False
            detect_desc = ""

            while (time.time() - start_time) < seconds:
                if context.is_cancelled():
                    raise asyncio.CancelledError("사용자 또는 비상 핫키에 의해 중단되었습니다.")

                # A. 완전로딩 대기 (window_ready): 대상 윈도우의 블로킹 해제 및 Idle 상태 검사
                if wait_mode == "window_ready":
                    hwnd, found_title = uia_service.find_window_target(
                        target_mode="object",
                        object_data=object_data
                    )
                    if hwnd:
                        is_idle = uia_service.is_window_idle(hwnd)
                        if not is_idle:
                            # 윈도우가 아직 로딩/블로킹 중
                            await asyncio.sleep(0.15)
                            continue
                    else:
                        # 아직 대상 윈도우 자체가 생성/감지되지 않음
                        await asyncio.sleep(0.15)
                        continue

                # B. UI 오브젝트 감지 검사 (UIA or 이미지)
                # 1단계: Windows UIA 컨트롤 실시간 직접 탐색
                if uia_target_name or uia_orig_name or uia_auto_id:
                    orig_w = object_data.get("width")
                    orig_h = object_data.get("height")
                    pos = uia_service.find_control(
                        name=uia_target_name,
                        control_type=uia_ctrl_type,
                        automation_id=uia_auto_id,
                        orig_name=uia_orig_name,
                        window_title=uia_win_title,
                        class_name=uia_cls_name,
                        orig_w=orig_w,
                        orig_h=orig_h,
                        max_search_seconds=0.3
                    )
                    if pos:
                        detected = True
                        detect_desc = f"[UIA 객체 일치] ({pos[0]}, {pos[1]})"
                        break

                # 2단계: UIA 미검출 시 OpenCV 템플릿 이미지 매칭
                if not detected and tpl_img is not None:
                    match_res = find_image_on_screen(tpl_img, confidence=confidence)
                    if match_res:
                        detected = True
                        cx, cy, score = match_res
                        detect_desc = f"[이미지 일치: {score:.1%}] ({cx}, {cy})"
                        break

                await asyncio.sleep(0.15)

            elapsed_total = round(time.time() - start_time, 2)
            mode_label = "완전로딩 대기" if wait_mode == "window_ready" else "부분로딩 대기"

            if detected:
                # 추가 안정 지연이 지정되어 있다면 적용
                if post_delay > 0:
                    await asyncio.sleep(post_delay)
                    post_info = f" (안정 지연 +{post_delay}초)"
                else:
                    post_info = ""

                return f"⚡ [동적 대기 성공: {mode_label}] '{obj_name}' 로딩 완료 ({elapsed_total}초 소요 / 최대 {seconds}초) {detect_desc}{post_info}"

            # 타임아웃 발생 처리
            if fail_on_timeout:
                raise TimeoutError(
                    f"[동적 대기 타임아웃] '{obj_name}' {mode_label} 실패: 최대 대기 시간 {seconds}초 동안 로딩이 완료되지 않았습니다."
                )
            else:
                return (
                    f"⚠️ [동적 대기 타임아웃 무시] '{obj_name}' {mode_label} 미완료 ({seconds}초 초과). 설정에 따라 다음 노드를 계속 진행합니다."
                )


        elif subtype == "clipboard_copy":
            text = self.config.get("text", "")
            resolved_text = render_template(text, context.variables)
            pyperclip.copy(resolved_text)
            return f"Copied to clipboard: {resolved_text}"

        elif subtype in ("window_activate", "window_maximize", "window_minimize", "window_close"):
            target_mode = self.config.get("target_mode", "object")  # object | title | current
            object_data = self.config.get("object_data")
            window_title = self.config.get("window_title", "")
            match_type = self.config.get("match_type", "contains")  # contains | exact | startswith

            if window_title:
                window_title = render_template(window_title, context.variables)

            hwnd, found_title = uia_service.find_window_target(
                target_mode=target_mode,
                object_data=object_data,
                window_title=window_title,
                match_type=match_type
            )

            if not hwnd:
                target_desc = ""
                if target_mode == "object" and object_data:
                    target_desc = f"오브젝트 '{object_data.get('name', '오브젝트')}' (상위 윈도우: '{object_data.get('window_title', '')}')"
                elif target_mode == "title":
                    target_desc = f"창 제목 '{window_title}' (일치 방식: {match_type})"
                elif target_mode == "current":
                    target_desc = "현재 활성 윈도우"
                else:
                    target_desc = "지정되지 않은 타겟"

                raise RuntimeError(f"대상 윈도우를 찾지 못했습니다: {target_desc}")

            title_display = found_title if found_title else f"HWND:{hwnd}"

            if subtype == "window_activate":
                success = uia_service.activate_window(hwnd)
                if not success:
                    raise RuntimeError(f"윈도우 '{title_display}' 활성화에 실패했습니다.")
                return f"윈도우 활성화 성공: '{title_display}' 창을 맨 앞으로 가져와 포커스를 획득했습니다."

            elif subtype == "window_maximize":
                success = uia_service.maximize_window(hwnd)
                if not success:
                    raise RuntimeError(f"윈도우 '{title_display}' 최대화에 실패했습니다.")
                return f"윈도우 최대화 성공: '{title_display}' 창을 화면 최대 크기로 확장했습니다."

            elif subtype == "window_minimize":
                success = uia_service.minimize_window(hwnd)
                if not success:
                    raise RuntimeError(f"윈도우 '{title_display}' 최소화에 실패했습니다.")
                return f"윈도우 최소화 성공: '{title_display}' 창을 작업표시줄로 최소화했습니다."

            elif subtype == "window_close":
                success = uia_service.close_window(hwnd)
                if not success:
                    raise RuntimeError(f"윈도우 '{title_display}' 닫기에 실패했습니다.")
                return f"윈도우 닫기 성공: '{title_display}' 창을 닫았습니다."

        elif subtype == "screenshot":
            capture_target = self.config.get("capture_target", "primary")  # primary | all
            save_to_file = bool(self.config.get("save_to_file", True))
            copy_to_clipboard = bool(self.config.get("copy_to_clipboard", False))
            file_path_template = self.config.get("file_path", "")

            # 1. 저장 방식 유효성 검사 (최소 1개 이상 선택 필수)
            if not save_to_file and not copy_to_clipboard:
                raise ValueError("스크린샷 저장 방식(파일로 저장 또는 클립보드로 복사)을 최소 1개 이상 선택해야 합니다.")

            # 2. 지정된 대상(주 모니터 / 전체 모니터) 화면 캡처
            target_label = "전체 모니터" if capture_target == "all" else "주 모니터"
            captured_img, meta = screen_capture_service.capture_display(target=capture_target)

            result_details = []

            # 3. 파일로 저장
            if save_to_file:
                now = datetime.now()
                # 기본 저장 경로 설정 (사용자가 비워둔 경우)
                if not file_path_template or not str(file_path_template).strip():
                    file_path_template = str(settings.SCREENSHOTS_DIR / "screenshot_{{timestamp}}.png")

                # 템플릿 변수 및 타임스탬프 치환
                resolved_path_str = render_template(file_path_template, context.variables)
                resolved_path_str = resolved_path_str.replace("{{timestamp}}", now.strftime("%Y%m%d_%H%M%S"))
                resolved_path_str = resolved_path_str.replace("{{date}}", now.strftime("%Y%m%d"))
                resolved_path_str = resolved_path_str.replace("{{time}}", now.strftime("%H%M%S"))

                target_path = Path(resolved_path_str)
                if not target_path.suffix:
                    target_path = target_path.with_suffix(".png")

                # 상위 디렉터리 자동 생성
                target_path.parent.mkdir(parents=True, exist_ok=True)

                # 확장자별 저장 포맷 매핑
                ext = target_path.suffix.lstrip(".").upper()
                fmt = "JPEG" if ext == "JPG" else (ext if ext in ("PNG", "JPEG", "WEBP", "BMP") else "PNG")

                if fmt == "JPEG":
                    captured_img.convert("RGB").save(target_path, format=fmt, quality=95)
                elif fmt == "WEBP":
                    captured_img.save(target_path, format=fmt, quality=90, method=4)
                else:
                    captured_img.save(target_path, format=fmt)

                result_details.append(f"파일 저장: {target_path}")

            # 4. 클립보드로 복사
            if copy_to_clipboard:
                cb_success = copy_image_to_clipboard(captured_img)
                if cb_success:
                    result_details.append("클립보드 복사 완료")
                else:
                    result_details.append("클립보드 복사 실패(권한/환경 제한)")

            details_msg = ", ".join(result_details)
            return f"스크린샷 촬영 완료 (대상: {target_label}, {details_msg})"

        elif subtype == "launch_program":
            program_path_raw = self.config.get("program_path", "")
            arguments_raw = self.config.get("arguments", "")

            if not program_path_raw or not str(program_path_raw).strip():
                raise ValueError("실행할 프로그램 파일 경로가 지정되지 않았습니다.")

            resolved_path = render_template(str(program_path_raw).strip(), context.variables)
            resolved_args = render_template(str(arguments_raw).strip(), context.variables) if arguments_raw else ""

            resolved_path = resolved_path.strip().strip('"').strip("'")

            try:
                if hasattr(os, "startfile"):
                    if resolved_args:
                        os.startfile(resolved_path, arguments=resolved_args)
                    else:
                        os.startfile(resolved_path)
                else:
                    cmd = [resolved_path]
                    if resolved_args:
                        cmd.extend(resolved_args.split())
                    subprocess.Popen(cmd)
            except Exception as e:
                try:
                    cmd_line = f'start "" "{resolved_path}"'
                    if resolved_args:
                        cmd_line += f' {resolved_args}'
                    subprocess.Popen(cmd_line, shell=True)
                except Exception as inner_e:
                    raise RuntimeError(f"프로그램 실행 실패 ('{resolved_path}'): {e} (2차 시도 오류: {inner_e})")

            await asyncio.sleep(0.05)

            args_desc = f" (인자: '{resolved_args}')" if resolved_args else ""
            return f"프로그램 실행 성공: '{resolved_path}'{args_desc}"

        elif subtype == "close_program":
            raw_proc_name = self.config.get("process_name", "")
            if not raw_proc_name or not str(raw_proc_name).strip():
                raise ValueError("종료할 프로그램 프로세스명이 지정되지 않았습니다.")

            resolved_name = render_template(str(raw_proc_name).strip(), context.variables)
            from app.services.process_service import process_service
            ok, msg, count = process_service.close_program_softly(resolved_name)
            if not ok:
                raise RuntimeError(msg)
            return f"프로그램 정상 종료 성공: {msg}"

        elif subtype == "kill_process":
            raw_proc_name = self.config.get("process_name", "")
            if not raw_proc_name or not str(raw_proc_name).strip():
                raise ValueError("강제 종료할 프로세스명이 지정되지 않았습니다.")

            resolved_name = render_template(str(raw_proc_name).strip(), context.variables)
            from app.services.process_service import process_service
            ok, msg, count = process_service.kill_process_by_name(resolved_name)
            if not ok:
                raise RuntimeError(msg)
            return f"프로세스 강제 종료 성공: {msg}"

        elif subtype == "mouse_drag":
            start_mode = self.config.get("start_mode", "coordinate")  # coordinate | object
            end_mode = self.config.get("end_mode", "coordinate")      # coordinate | object
            start_obj = self.config.get("start_object_data") or (self.config.get("object_data") if start_mode == "object" else None)
            end_obj = self.config.get("end_object_data")
            button = self.config.get("button", "left")
            move_mode = self.config.get("move_mode", "smooth")        # instant | smooth
            duration = max(0.0, float(self.config.get("duration", 0.5)))

            sx, sy, start_desc = await resolve_target_point_async(
                mode=start_mode,
                x=self.config.get("start_x"),
                y=self.config.get("start_y"),
                object_data=start_obj,
                config=self.config,
                context=context,
                point_label="드래그 시작점"
            )
            ex, ey, end_desc = await resolve_target_point_async(
                mode=end_mode,
                x=self.config.get("end_x"),
                y=self.config.get("end_y"),
                object_data=end_obj,
                config=self.config,
                context=context,
                point_label="드래그 끝점"
            )

            if context.is_cancelled():
                raise asyncio.CancelledError("사용자 또는 비상 핫키에 의해 중단되었습니다.")

            pyautogui.moveTo(sx, sy, duration=0)
            await asyncio.sleep(0.05)
            pyautogui.mouseDown(x=sx, y=sy, button=button)
            try:
                await asyncio.sleep(0.05)
                if move_mode == "smooth" and duration > 0:
                    pyautogui.moveTo(ex, ey, duration=duration)
                else:
                    pyautogui.moveTo(ex, ey, duration=0)
                await asyncio.sleep(0.05)
            finally:
                pyautogui.mouseUp(x=ex, y=ey, button=button)

            move_label = f"부드러운 이동({duration}s)" if (move_mode == "smooth" and duration > 0) else "즉시(순간이동)"
            return f"마우스 드래그 앤 드롭 완료: {start_desc} ➔ {end_desc} (방식: {move_label}, 버튼: {button})"

        elif subtype == "clipboard_read":
            output_var = str(self.config.get("output_variable", "clipboard_text")).strip() or "clipboard_text"
            clip_text = pyperclip.paste()
            if clip_text is None:
                clip_text = ""
            else:
                clip_text = str(clip_text)

            context.variables[output_var] = clip_text
            context.variables["last_output"] = clip_text

            preview = clip_text[:50] + ("..." if len(clip_text) > 50 else "")
            return f"클립보드 읽기 성공 (변수 '{{{{{output_var}}}}}'에 {len(clip_text)}자 저장): {preview}"

        elif subtype == "file_read":
            raw_path = self.config.get("file_path", "")
            if not raw_path or not str(raw_path).strip():
                raise ValueError("읽어올 텍스트 파일 경로가 지정되지 않았습니다.")

            resolved_path_str = render_template(str(raw_path).strip(), context.variables).strip().strip('"').strip("'")
            target_path = Path(resolved_path_str)

            if not target_path.exists():
                raise FileNotFoundError(f"지정한 파일을 찾을 수 없습니다: '{target_path}'")
            if target_path.is_dir():
                raise IsADirectoryError(f"지정한 경로는 파일이 아닌 디렉터리입니다: '{target_path}'")

            encoding = str(self.config.get("encoding", "utf-8")).strip() or "utf-8"
            try:
                text_content = target_path.read_text(encoding=encoding if encoding != "utf-8" else "utf-8-sig")
            except UnicodeDecodeError:
                try:
                    text_content = target_path.read_text(encoding="cp949")
                except Exception:
                    text_content = target_path.read_text(encoding="utf-8", errors="replace")

            output_var = str(self.config.get("output_variable", "file_content")).strip() or "file_content"
            context.variables[output_var] = text_content
            context.variables["last_output"] = text_content

            preview = text_content[:50].replace("\n", " ") + ("..." if len(text_content) > 50 else "")
            return f"텍스트 파일 읽기 성공 ('{target_path}', 변수 '{{{{{output_var}}}}}'에 {len(text_content)}자 저장): {preview}"

        elif subtype == "file_write":
            raw_path = self.config.get("file_path", "")
            if not raw_path or not str(raw_path).strip():
                raise ValueError("저장할 파일 경로가 지정되지 않았습니다.")

            now = datetime.now()
            resolved_path_str = render_template(str(raw_path).strip(), context.variables).strip().strip('"').strip("'")
            resolved_path_str = resolved_path_str.replace("{{timestamp}}", now.strftime("%Y%m%d_%H%M%S"))
            resolved_path_str = resolved_path_str.replace("{{date}}", now.strftime("%Y%m%d"))
            resolved_path_str = resolved_path_str.replace("{{time}}", now.strftime("%H%M%S"))

            target_path = Path(resolved_path_str)
            overwrite = bool(self.config.get("overwrite", False))

            if target_path.exists() and not overwrite:
                raise FileExistsError(
                    f"파일 쓰기 오류: 대상 파일이 이미 존재하며 '덮어쓰기 허용'이 선택 해제되어 있습니다. ('{target_path}')"
                )

            raw_content = self.config.get("content", "")
            resolved_content = render_template(str(raw_content), context.variables)
            resolved_content = resolved_content.replace("{{timestamp}}", now.strftime("%Y%m%d_%H%M%S"))
            resolved_content = resolved_content.replace("{{date}}", now.strftime("%Y%m%d"))
            resolved_content = resolved_content.replace("{{time}}", now.strftime("%H%M%S"))

            target_path.parent.mkdir(parents=True, exist_ok=True)
            encoding = str(self.config.get("encoding", "utf-8")).strip() or "utf-8"
            target_path.write_text(resolved_content, encoding=encoding)

            overwrite_label = "덮어쓰기 허용" if overwrite else "신규 생성"
            return f"파일 쓰기 성공 ('{target_path}', {len(resolved_content)}자 기록, 모드: {overwrite_label})"

        elif subtype == "message_box":
            raw_title = self.config.get("title", "알림")
            raw_message = self.config.get("message", "")
            message_type = str(self.config.get("message_type", "info")).lower()    # info | warning | error
            button_type = str(self.config.get("button_type", "ok")).lower()        # ok | yes_no | continue_stop
            output_var = str(self.config.get("output_variable", "dialog_result")).strip() or "dialog_result"

            resolved_title = render_template(str(raw_title), context.variables)
            resolved_message = render_template(str(raw_message), context.variables)

            ret_code = await asyncio.to_thread(
                show_topmost_message_box,
                resolved_title,
                resolved_message,
                message_type,
                button_type
            )

            if button_type == "yes_no":
                # IDYES = 6, IDNO = 7
                is_yes = (ret_code == 6)
                context.variables[output_var] = is_yes
                context.variables["last_output"] = is_yes
                choice_str = "예 (True)" if is_yes else "아니오 (False)"
                return f"사용자 대화상자 응답 완료: [{choice_str}] 선택됨 (변수 '{{{{{output_var}}}}}' = {is_yes})"

            elif button_type == "continue_stop":
                # IDOK(1) = 계속, IDCANCEL(2) = 중지
                if ret_code == 1:
                    return f"사용자 대화상자 응답 완료: [계속] 선택됨 -> 후속 노드 실행을 진행합니다."
                else:
                    raise RuntimeError(
                        f"사용자 대화상자('{resolved_title}')에서 '중지' 버튼을 선택하여 워크플로우를 종료합니다."
                    )

            else:
                return f"사용자 대화상자 확인 완료 (제목: '{resolved_title}')"

        elif subtype == "mouse_scroll":
            target_mode = self.config.get("target_mode", "object")       # object (기본값) | current (현재 활성창)
            direction = self.config.get("direction", "vertical")         # vertical (상하) | horizontal (좌우)
            distance_mode = self.config.get("distance_mode", "ticks")    # ticks | page_down | page_up | end | home
            ticks = int(self.config.get("ticks", 5))
            ticks_direction = self.config.get("ticks_direction", "backward")  # backward (아래/오른쪽) | forward (위/왼쪽)

            dir_label = "좌우(가로)" if direction == "horizontal" else "상하(세로)"

            # 1) 현재 활성창 모드: 스크롤 가능 여부와 무관하게 무조건 휠 칸수 신호 전송
            if target_mode == "current":
                abs_ticks = max(1, abs(ticks))
                is_backward = (ticks < 0) or (ticks > 0 and ticks_direction != "forward")
                if direction == "vertical":
                    signed_ticks = -abs_ticks if is_backward else abs_ticks
                    sub_label = f"아래로 {abs_ticks}칸" if is_backward else f"위로 {abs_ticks}칸"
                else:
                    signed_ticks = abs_ticks if is_backward else -abs_ticks
                    sub_label = f"오른쪽으로 {abs_ticks}칸" if is_backward else f"왼쪽으로 {abs_ticks}칸"

                uia_service.send_mouse_wheel(direction=direction, signed_ticks=signed_ticks, x=None, y=None)
                await asyncio.sleep(0.05)
                return f"마우스 스크롤 완료 [현재 활성창 모드]: {dir_label} 방향으로 휠 {sub_label} 신호 전송"

            # 2) 오브젝트 선택 모드 (기본값): UI 오브젝트 탐색 ➔ 포커스 부여 ➔ 비-키보드 스크롤 제어 및 경계 인식
            tx, ty, obj_desc = await resolve_target_point_async(
                mode="object",
                x=self.config.get("x"),
                y=self.config.get("y"),
                object_data=self.config.get("object_data"),
                config=self.config,
                context=context,
                point_label="스크롤 대상 오브젝트"
            )

            scroll_res = uia_service.scroll_target_element(
                target_x=tx,
                target_y=ty,
                object_data=self.config.get("object_data"),
                direction=direction,
                distance_mode=distance_mode,
                ticks=ticks,
                ticks_direction=ticks_direction
            )

            context.variables["scroll_at_start"] = bool(scroll_res.get("at_start", False))
            context.variables["scroll_at_end"] = bool(scroll_res.get("at_end", False))

            dist_label_map = {
                "ticks": f"휠 {abs(ticks)}칸 ({'아래/오른쪽' if ((ticks < 0) or (ticks > 0 and ticks_direction != 'forward')) else '위/왼쪽'})",
                "page_down": "한 페이지 뒤로 (Page Down 효과)",
                "page_up": "한 페이지 앞으로 (Page Up 효과)",
                "end": "맨 끝으로 (End 효과)",
                "home": "맨 처음으로 (Home 효과)",
            }
            dist_label = dist_label_map.get(distance_mode, distance_mode)
            boundary_note = ""
            if scroll_res.get("at_end"):
                boundary_note = " [스크롤 맨 끝 도달]"
            elif scroll_res.get("at_start"):
                boundary_note = " [스크롤 맨 처음 도달]"

            method_used = scroll_res.get("method_used", "Hybrid")
            return f"마우스 스크롤 완료 [오브젝트 모드]: {obj_desc} | 방향: {dir_label} | 거리: {dist_label} (제어방식: {method_used}){boundary_note}"

        else:
            raise ValueError(f"지원하지 않는 일반 노드 타입입니다: {subtype}")

    async def _type_smooth(
        self,
        text: str,
        interval: float,
        decompose_korean: bool,
        context: ExecutionContext,
    ) -> None:
        """
        한 글자씩 또는 한글 자모 순서대로 키보드 타이핑 효과를 시뮬레이션합니다.
        """
        if decompose_korean:
            items = decompose_hangul_to_keys(text)
        else:
            items = [(ch, None) for ch in text]

        for ch, key_code in items:
            if context.is_cancelled():
                raise asyncio.CancelledError("사용자 또는 비상 핫키에 의해 중단되었습니다.")

            if key_code:
                # 2벌식 가상 키보드 입력 (쌍자음/복합모음은 Shift 조합)
                if key_code.isupper():
                    pyautogui.hotkey("shift", key_code.lower())
                else:
                    pyautogui.press(key_code)
            else:
                # 일반 문자 및 특수키
                if ch == "\n":
                    pyautogui.press("enter")
                elif ch == "\t":
                    pyautogui.press("tab")
                elif ch == " ":
                    pyautogui.press("space")
                elif ch.isascii() and ch.isalnum():
                    if ch.isupper():
                        pyautogui.hotkey("shift", ch.lower())
                    else:
                        pyautogui.press(ch)
                else:
                    # 유니코드 기호, 이모지 또는 한글 비분해 글자
                    pyperclip.copy(ch)
                    pyautogui.hotkey("ctrl", "v")

            if context.is_cancelled():
                raise asyncio.CancelledError("사용자 또는 비상 핫키에 의해 중단되었습니다.")

            await asyncio.sleep(interval)

    async def run(self, context: ExecutionContext) -> NodeResult:
        if context.is_cancelled():
            return NodeResult(success=False, error="실행이 취소되었습니다.")

        # 1) 노드 실행 직전 메시지 전송: "{노드이름} 실행"
        await context.emit_event(
            node_id=self.id,
            node_name=self.name,
            node_type="GENERAL",
            event_type="START",
            content=f"{self.name} 실행"
        )

        try:
            # 액션 비즈니스 로직 수행
            result_output = await self.execute_action(context)

            if context.is_cancelled():
                return NodeResult(success=False, error="실행이 취소되었습니다.")

            # 2) 노드 실행 성공 후: PC 화면 캡처 + "{노드이름} 실행 성공" (환경설정 On일 때만 캡처)
            screenshot_url = None
            if settings.CAPTURE_SCREEN_AFTER_EXECUTION:
                screenshot_url = screen_capture_service.capture(
                    session_id=context.session_id,
                    label=f"node_{self.id}_success",
                    target="all"
                )

            await context.emit_event(
                node_id=self.id,
                node_name=self.name,
                node_type="GENERAL",
                event_type="SUCCESS",
                content=f"{self.name} 실행 성공",
                image_path=screenshot_url
            )

            return NodeResult(
                success=True,
                output=result_output,
                screenshot_url=screenshot_url
            )

        except (Exception, asyncio.CancelledError) as e:
            # 3) 노드 실행 실패/오류: "{노드이름} 실행 중 오류 발생. -- {Exception}"
            error_msg = f"{self.name} 실행 중 오류 발생. -- {str(e)}"
            await context.emit_event(
                node_id=self.id,
                node_name=self.name,
                node_type="GENERAL",
                event_type="ERROR",
                content=error_msg
            )
            return NodeResult(success=False, error=error_msg)
