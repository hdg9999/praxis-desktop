import base64
import io
import time
import uuid
import ctypes
from pathlib import Path
from typing import Optional, Dict, Any, Tuple
from PIL import Image
import mss

from app.core.config import settings
from app.services.screen_capture import screen_capture_service

# uiautomation 동적 로드 (Windows 전용 환경)
try:
    import uiautomation as auto
    import comtypes
    UIA_AVAILABLE = True
except Exception as e:
    auto = None
    comtypes = None
    UIA_AVAILABLE = False
    print(f"[UIAService] uiautomation/comtypes 로드 불가: {e}")

from ctypes import wintypes
import os

def get_process_executable_path(pid: int) -> Optional[str]:
    """
    Win32 QueryFullProcessImageNameW를 사용하여 주어진 PID 프로세스의 실행 파일 전체 경로를 추출.
    """
    if not pid or pid <= 0:
        return None
    try:
        kernel32 = ctypes.windll.kernel32
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        PROCESS_QUERY_INFORMATION = 0x0400
        h_proc = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not h_proc:
            h_proc = kernel32.OpenProcess(PROCESS_QUERY_INFORMATION, False, pid)
        if not h_proc:
            return None
        try:
            buf = ctypes.create_unicode_buffer(1024)
            size = wintypes.DWORD(1024)
            if kernel32.QueryFullProcessImageNameW(h_proc, 0, buf, ctypes.byref(size)):
                return buf.value
        finally:
            kernel32.CloseHandle(h_proc)
    except Exception:
        pass
    return None

def resolve_desktop_target(name: str) -> Optional[str]:
    """
    바탕화면 아이콘의 이름(예: 'Google Chrome', '카카오톡')을 바탕으로
    사용자/공용 바탕화면 및 시작 메뉴의 바로가기(.lnk) 또는 실행파일을 탐색하여 반환.
    """
    if not name or not name.strip():
        return None
    name_clean = name.strip()
    desktop_dirs = [
        os.path.expanduser(r"~\Desktop"),
        os.path.join(os.environ.get("PUBLIC", r"C:\Users\Public"), "Desktop"),
        os.path.expanduser(r"~\AppData\Roaming\Microsoft\Windows\Start Menu\Programs"),
        r"C:\ProgramData\Microsoft\Windows\Start Menu\Programs",
    ]
    for d in desktop_dirs:
        if not os.path.exists(d):
            continue
        # 1. 완전 일치 (name.lnk / name.exe)
        for ext in [".lnk", ".exe"]:
            candidate = os.path.join(d, f"{name_clean}{ext}")
            if os.path.exists(candidate):
                return candidate
        # 2. 대소문자 무시 또는 부분 일치 검색
        try:
            for f in os.listdir(d):
                stem, ext = os.path.splitext(f)
                if ext.lower() in [".lnk", ".exe"] and (stem.lower() == name_clean.lower() or name_clean.lower() in stem.lower()):
                    return os.path.join(d, f)
        except Exception:
            continue
    return None

def ensure_desktop_and_com():
    """스레드를 대화형 default 데스크톱에 바인딩하고 comtypes.CoInitialize 수행"""
    try:
        user32 = ctypes.windll.user32
        h_desk = user32.OpenDesktopW("default", 0, False, 0x01FF)
        if not h_desk:
            h_desk = user32.OpenInputDesktop(0, False, 0x01FF)
        if h_desk:
            user32.SetThreadDesktop(h_desk)
    except Exception:
        pass
    try:
        if comtypes:
            comtypes.CoInitialize()
    except Exception:
        pass

def run_in_desktop_thread(func, *args, **kwargs):
    """
    메인/비동기 스레드의 COM 상태 및 윈도우 스테이션과 완전히 격리된
    신규 독립 스레드에서 default 데스크톱 바인딩 및 UIA를 안전하게 실행.
    """
    import threading
    result = [None]
    exception = [None]

    def _worker():
        try:
            ensure_desktop_and_com()
            if auto is not None:
                with auto.UIAutomationInitializerInThread():
                    result[0] = func(*args, **kwargs)
            else:
                result[0] = func(*args, **kwargs)
        except Exception as e:
            exception[0] = e
        finally:
            try:
                if comtypes:
                    comtypes.CoUninitialize()
            except Exception:
                pass

    t = threading.Thread(target=_worker)
    t.start()
    t.join()
    if exception[0]:
        raise exception[0]
    return result[0]

class UIAService:
    def __init__(self):
        self.objects_dir = settings.OBJECTS_DIR
        self.objects_dir.mkdir(parents=True, exist_ok=True)

    def _find_leaf_control(self, parent_ctrl, x: int, y: int, depth: int = 0, max_depth: int = 7):
        """
        parent_ctrl 하위에서 (x, y)를 포함하는 가장 구체적인 컨트롤(버튼, 텍스트박스 등)을 재귀 탐색.
        """
        if depth >= max_depth or not parent_ctrl:
            return parent_ctrl
        try:
            children = parent_ctrl.GetChildren()
            best = None
            for child in children:
                if getattr(child, "IsOffscreen", False):
                    continue
                rect = child.BoundingRectangle
                if not rect:
                    continue
                if rect.left <= x <= rect.right and rect.top <= y <= rect.bottom:
                    if rect.width() < 4 or rect.height() < 4:
                        continue
                    best = child
                    break
            if best and best != parent_ctrl:
                return self._find_leaf_control(best, x, y, depth + 1, max_depth)
        except Exception:
            pass
        return parent_ctrl

    def _find_window_under_overlay(self, x: int, y: int, root_w: int, root_h: int):
        """
        전체 화면 오버레이 창 바로 아래에 위치하는 실제 대상 애플리케이션 윈도우를 Z-Order 순서로 탐색.
        """
        try:
            root = auto.GetRootControl()
            if not root:
                return None
            windows = root.GetChildren()
            for win in windows:
                try:
                    if getattr(win, "IsOffscreen", False):
                        continue
                    rect = win.BoundingRectangle
                    if not rect:
                        continue
                    if rect.left <= x <= rect.right and rect.top <= y <= rect.bottom:
                        w = rect.width()
                        h = rect.height()
                        # 1. 화면 전체를 덮는 투명 오버레이 창 스킵
                        if w >= root_w - 20 and h >= root_h - 20:
                            continue
                        cls = str(win.ClassName or "")
                        # 2. 시스템 바탕화면 창 스킵
                        if cls in ["#32769", "Progman", "WorkerW"]:
                            continue
                        name = str(win.Name or "").lower()
                        # 3. 소형 피커 패널 창 스킵
                        if "오브젝트 선택기" in name:
                            continue
                        return win
                except Exception:
                    continue
        except Exception as e:
            print(f"[UIAService] _find_window_under_overlay error: {e}")
        return None

    def get_element_at_point(self, x: int, y: int) -> Optional[Dict[str, Any]]:
        """
        주어진 화면 절대 좌표 (x, y)에 있는 실제 Visible UI 컨트롤 정보를 반환.
        오버레이 창이 화면을 덮고 있는 경우 오버레이를 투과하여 그 아래의 실제 애플리케이션 컨트롤을 감지.
        바탕화면 빈 공간, 오프스크린 컨트롤 등은 필터링하여 None 반환.
        """
        if not UIA_AVAILABLE or auto is None:
            return None

        ensure_desktop_and_com()

        try:
            with auto.UIAutomationInitializerInThread():
                root = auto.GetRootControl()
                root_w = root.BoundingRectangle.width() if (root and root.BoundingRectangle) else 1920
                root_h = root.BoundingRectangle.height() if (root and root.BoundingRectangle) else 1080

                # 1단계: ElementFromPoint 시도
                elem = auto.ControlFromPoint(x, y)

                # 2단계: 미검출 또는 데스크톱 루트인 경우 ControlFromPoint2 (WindowFromPoint 기반) 시도
                if not elem or (root and elem.NativeWindowHandle == root.NativeWindowHandle):
                    try:
                        elem = auto.ControlFromPoint2(x, y)
                    except Exception:
                        pass

                if not elem:
                    return None

                # 데스크톱 루트인 경우 필터링 (바탕화면 허공)
                if root and elem.NativeWindowHandle == root.NativeWindowHandle:
                    return None

                rect = elem.BoundingRectangle
                if not rect:
                    return None

                w = rect.width()
                h = rect.height()

                # 화면 전체 크기와 동일한 대형 창(바탕화면 배경 Pane)인 경우 필터링
                if w >= root_w - 20 and h >= root_h - 20:
                    # 단, 하위에 대상 컨트롤이 있는지 깊이 탐색 시도
                    child_elem = self._find_leaf_control(elem, x, y, max_depth=4)
                    if child_elem and child_elem != elem:
                        c_rect = child_elem.BoundingRectangle
                        if c_rect and not (c_rect.width() >= root_w - 20 and c_rect.height() >= root_h - 20):
                            elem = child_elem
                            rect = c_rect
                        else:
                            return None
                    else:
                        return None

                # 3단계: 큰 창이나 컨테이너가 잡힌 경우, (x, y)에 위치한 가장 구체적인 자식 컨트롤(버튼, 텍스트 등) 정밀 탐색
                refined = self._find_leaf_control(elem, x, y, max_depth=5)
                if refined and refined != elem:
                    r_rect = refined.BoundingRectangle
                    if r_rect and r_rect.width() >= 6 and r_rect.height() >= 6:
                        elem = refined
                        rect = r_rect

                if not elem or getattr(elem, "IsOffscreen", False):
                    return None

                rect = elem.BoundingRectangle
                if not rect:
                    return None

                left = int(rect.left)
                top = int(rect.top)
                width = int(rect.width())
                height = int(rect.height())

                # 너무 작거나 음수인 크기 필터링
                if width < 6 or height < 6:
                    return None

                # 여전히 전체 화면 크기인 경우(바탕화면 전체 등) 필터링
                if width >= root_w - 20 and height >= root_h - 20:
                    return None

                window_title = ""
                try:
                    top_win = elem.GetTopLevelControl()
                    if top_win and root and top_win.NativeWindowHandle != root.NativeWindowHandle:
                        window_title = str(top_win.Name or "").strip()
                except Exception:
                    pass

                ctrl_type = str(elem.ControlTypeName or "")
                name = str(elem.Name or "").strip()
                cls_name = str(elem.ClassName or "").strip()
                auto_id = str(elem.AutomationId or "").strip()

                display_name = name if name else f"{ctrl_type}_{left}_{top}"

                pid = int(getattr(elem, "ProcessId", 0) or 0)
                proc_path = get_process_executable_path(pid) if pid > 0 else ""
                if proc_path and os.path.basename(proc_path).lower() == "explorer.exe":
                    desktop_target = resolve_desktop_target(name or display_name)
                    if desktop_target:
                        proc_path = desktop_target
                elif not proc_path:
                    desktop_target = resolve_desktop_target(name or display_name)
                    if desktop_target:
                        proc_path = desktop_target

                res = {
                    "name": display_name,
                    "orig_name": name,
                    "control_type": ctrl_type,
                    "class_name": cls_name,
                    "automation_id": auto_id,
                    "window_title": window_title,
                    "x": left,
                    "y": top,
                    "width": width,
                    "height": height,
                    "handle": int(elem.NativeWindowHandle or 0),
                    "process_id": pid,
                    "executable_path": proc_path or ""
                }
                return res
        except Exception as e:
            print(f"[UIAService] Exception during get_element_at_point: {e}")
            return None

    def capture_rect(self, x: int, y: int, width: int, height: int, name: Optional[str] = None, executable_path: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Windows 물리 좌표 (x, y, width, height)에 해당하는 화면 영역을
        DPI 오차 없이 1:1 무손실 크롭하여 PNG 파일 및 Base64로 저장 및 반환.
        """
        cropped: Image.Image
        try:
            with mss.MSS() as sct:
                # 좌표가 포함된 모니터 탐색
                target_mon = sct.monitors[0]  # 전체 가상 화면 (모든 모니터 통합)
                for mon in sct.monitors[1:]:
                    if mon["left"] <= x < mon["left"] + mon["width"] and mon["top"] <= y < mon["top"] + mon["height"]:
                        target_mon = mon
                        break

                grab_rect = {
                    "left": x,
                    "top": y,
                    "width": max(8, width),
                    "height": max(8, height)
                }
                sct_img = sct.grab(grab_rect)
                cropped = Image.frombytes("RGB", sct_img.size, sct_img.bgra, "raw", "BGRX")
        except Exception as e:
            # GDI BitBlt 접근 차단(화면 잠금, 비대화형 CI/헤드리스 세션 등) 환경 폴백
            cropped = screen_capture_service._create_fallback_image(max(8, width), max(8, height), reason=str(e))

        try:
            timestamp = time.strftime("%Y%m%d_%H%M%S")
            rand_id = uuid.uuid4().hex[:6]
            obj_id = f"obj_{timestamp}_{rand_id}"
            filename = f"{obj_id}.png"
            file_path = self.objects_dir / filename

            # PNG 무손실 저장
            cropped.save(file_path, format="PNG")

            # Base64 인코딩
            buffer = io.BytesIO()
            cropped.save(buffer, format="PNG")
            b64_str = base64.b64encode(buffer.getvalue()).decode("utf-8")

            obj_name = name.strip() if name and name.strip() else f"오브젝트_{x}_{y}"

            return {
                "object_id": obj_id,
                "name": obj_name,
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                "image_url": f"/api/static/objects/{filename}",
                "base64_image": f"data:image/png;base64,{b64_str}",
                "executable_path": executable_path or ""
            }
        except Exception as e:
            print(f"[UIAService] 크롭 저장 실패: {e}")
            return None

    def bring_control_into_view(self, ctrl) -> Optional[Tuple[int, int]]:
        """
        Windows UIA 컨트롤을 화면 뷰포트 내로 자동으로 스크롤하고 활성화/포커싱한 뒤,
        최신 BoundingRectangle의 중심 좌표 (center_x, center_y)를 반환합니다.
        UiPath 등 상용 RPA 솔루션의 ScrollIntoView + SetFocus + Activate 동작을 수행합니다.
        """
        if not ctrl:
            return None
        try:
            # 1. 대상 컨트롤의 최상위 윈도우 식별 및 화면 전면 활성화
            top_win = None
            try:
                top_win = ctrl.GetTopLevelControl()
            except Exception:
                pass
            if top_win and getattr(top_win, "NativeWindowHandle", 0):
                try:
                    self.activate_window(top_win.NativeWindowHandle)
                except Exception as e:
                    print(f"[UIAService] bring_control_into_view 윈도우 활성화 실패: {e}")

            # 2. UIA 표준 ScrollItemPattern::ScrollIntoView 시도 (컨트롤 본인 또는 상위 부모 3단계까지)
            curr = ctrl
            for _ in range(4):
                if not curr:
                    break
                try:
                    if auto is not None:
                        pattern = curr.GetPattern(auto.PatternId.ScrollItemPattern)
                        if pattern:
                            pattern.ScrollIntoView(waitTime=0.05)
                            break
                except Exception:
                    pass
                try:
                    curr = curr.GetParentControl()
                except Exception:
                    break

            # 3. SetFocus 호출 (웹 브라우저 및 일반 GUI 컨트롤은 포커스 요소를 뷰포트로 자동 스크롤)
            try:
                ctrl.SetFocus()
            except Exception:
                try:
                    p = ctrl.GetParentControl()
                    if p:
                        p.SetFocus()
                except Exception:
                    pass

            # 4. 스크롤 애니메이션 및 브라우저/앱 레이아웃 갱신 안정화 대기
            time.sleep(0.08)

            # 5. 스크롤 이동 후 최신 BoundingRectangle 재계측(Re-fetch)
            rect = ctrl.BoundingRectangle
            if rect and rect.width() > 0 and rect.height() > 0:
                cx = int(rect.left + rect.width() // 2)
                cy = int(rect.top + rect.height() // 2)
                return (cx, cy)
        except Exception as e:
            print(f"[UIAService] bring_control_into_view 예외: {e}")
        return None

    def find_control(
        self,
        name: Optional[str] = None,
        control_type: Optional[str] = None,
        automation_id: Optional[str] = None,
        orig_name: Optional[str] = None,
        window_title: Optional[str] = None,
        class_name: Optional[str] = None,
        orig_w: Optional[int] = None,
        orig_h: Optional[int] = None,
        max_search_seconds: float = 0.5,
        auto_focus_scroll: bool = True
    ) -> Optional[tuple[int, int]]:
        """
        실행 엔진용: UIA 속성을 기반으로 화면에 떠 있는 컨트롤을 정밀 탐색하여 (center_x, center_y) 반환.
        auto_focus_scroll이 True이면 가려진 컨트롤 발견 시 자동 스크롤/포커싱 후 최신 좌표 반환.
        독립 Desktop 스레드에서 격리 실행하여 COM/데스크톱 바인딩 간섭을 원천 차단.
        """
        if not UIA_AVAILABLE or auto is None:
            return None

        import re

        def _worker():
            def _norm_str(s: Optional[str]) -> str:
                if not s:
                    return ""
                return re.sub(r'[\s\xa0]+', '', str(s)).lower()

            search_names = []
            if orig_name and orig_name.strip():
                search_names.append(orig_name.strip())
            if name and name.strip() and name.strip() not in search_names:
                search_names.append(name.strip())

            norm_targets = [_norm_str(sn) for sn in search_names if _norm_str(sn)]
            root = auto.GetRootControl()

            def _match_in_container(container) -> Optional[tuple[int, int]]:
                if not container:
                    return None
                try:
                    # 1. AutomationId 우선 매칭
                    if automation_id and automation_id.strip():
                        ctrl = container.Control(AutomationId=automation_id.strip(), searchDepth=24)
                        if ctrl.Exists(maxSearchSeconds=max_search_seconds):
                            if auto_focus_scroll:
                                pos = self.bring_control_into_view(ctrl)
                                if pos:
                                    return pos
                            rect = ctrl.BoundingRectangle
                            if rect and rect.width() > 0 and rect.height() > 0:
                                return (int(rect.left + rect.width() // 2), int(rect.top + rect.height() // 2))

                    # 2. 정확 일치 (Name + ControlType / ClassName)
                    for s_name in search_names:
                        kwargs: Dict[str, Any] = {"Name": s_name, "searchDepth": 24}
                        if control_type and control_type.strip():
                            kwargs["ControlTypeName"] = control_type.strip()
                        if class_name and class_name.strip():
                            kwargs["ClassName"] = class_name.strip()
                        ctrl = container.Control(**kwargs)
                        if ctrl.Exists(maxSearchSeconds=0.1):
                            if auto_focus_scroll:
                                pos = self.bring_control_into_view(ctrl)
                                if pos:
                                    return pos
                            rect = ctrl.BoundingRectangle
                            if rect and rect.width() > 0 and rect.height() > 0:
                                return (int(rect.left + rect.width() // 2), int(rect.top + rect.height() // 2))

                    # 3. 스마트 텍스트 정규화 순회 탐색 (공백, NBSP \xa0 불일치 원천 해결 + 오프스크린 후보 포함)
                    candidates = []

                    def _walk_tree(ctrl, depth=0):
                        if depth > 24:
                            return
                        try:
                            children = ctrl.GetChildren()
                            for ch in children:
                                c_rect = ch.BoundingRectangle
                                c_name = ch.Name or ""
                                c_norm = _norm_str(c_name)
                                c_type = str(ch.ControlTypeName or "")
                                is_offscreen = getattr(ch, "IsOffscreen", False)

                                type_match = True
                                if control_type and control_type.strip():
                                    type_match = (c_type.lower() == control_type.strip().lower())

                                # A. 정규화 완전 일치 (score: 0)
                                if c_norm and any(nt == c_norm for nt in norm_targets):
                                    if type_match:
                                        candidates.append({
                                            "ctrl": ch,
                                            "rect": c_rect,
                                            "score": 0,
                                            "offscreen": is_offscreen,
                                            "depth": depth,
                                            "w": c_rect.width() if c_rect else 0,
                                            "h": c_rect.height() if c_rect else 0
                                        })
                                # B. 정규화 부분 일치 (score: 1)
                                elif type_match and c_norm and any(nt in c_norm for nt in norm_targets):
                                    candidates.append({
                                        "ctrl": ch,
                                        "rect": c_rect,
                                        "score": 1,
                                        "offscreen": is_offscreen,
                                        "depth": depth,
                                        "w": c_rect.width() if c_rect else 0,
                                        "h": c_rect.height() if c_rect else 0
                                    })

                                _walk_tree(ch, depth + 1)
                        except Exception:
                            pass

                    _walk_tree(container)

                    if candidates:
                        def _sort_key(c):
                            size_diff = 0
                            if orig_w and orig_h:
                                size_diff = abs(c["w"] - orig_w) + abs(c["h"] - orig_h)
                            return (c["score"], 1 if c["offscreen"] else 0, -c["depth"], size_diff)

                        candidates.sort(key=_sort_key)
                        best = candidates[0]
                        best_ctrl = best["ctrl"]
                        if auto_focus_scroll:
                            pos = self.bring_control_into_view(best_ctrl)
                            if pos:
                                return pos
                        b_rect = best_ctrl.BoundingRectangle or best["rect"]
                        if b_rect and b_rect.width() > 0 and b_rect.height() > 0:
                            return (int(b_rect.left + b_rect.width() // 2), int(b_rect.top + b_rect.height() // 2))

                except Exception as e:
                    print(f"[UIAService] _match_in_container error: {e}")
                return None

            # 1단계: 상위 윈도우 스코프 고속 탐색
            if window_title and window_title.strip():
                try:
                    target_hwnd, _ = self.find_window_target(
                        target_mode="title",
                        window_title=window_title.strip(),
                        match_type="contains"
                    )
                    target_win = None
                    if target_hwnd:
                        try:
                            target_win = auto.ControlFromHandle(target_hwnd)
                        except Exception:
                            pass

                    if not target_win:
                        target_win = auto.WindowControl(SubName=window_title.strip(), searchDepth=3)
                        if not target_win.Exists(maxSearchSeconds=0.3):
                            target_win = None

                    if target_win:
                        # 스마트 컨테이너 스코핑: 크롬 렌더러 창, 문서 컨트롤 우선 탐색
                        search_containers = []
                        try:
                            render_win = target_win.Control(ClassName="Chrome_RenderWidgetHostHWND", searchDepth=10)
                            if render_win.Exists(maxSearchSeconds=0.3):
                                search_containers.append(render_win)
                        except Exception:
                            pass

                        try:
                            doc_ctrl = target_win.DocumentControl(searchDepth=12)
                            if doc_ctrl.Exists(maxSearchSeconds=0.2):
                                search_containers.append(doc_ctrl)
                        except Exception:
                            pass

                        search_containers.append(target_win)

                        for container in search_containers:
                            found = _match_in_container(container)
                            if found:
                                return found
                except Exception as e:
                    print(f"[UIAService] window_title scope error: {e}")

            # 2단계: Foreground 활성 윈도우 내 탐색
            try:
                fg_win = auto.GetForegroundControl()
                if fg_win and fg_win != root:
                    search_containers = []
                    try:
                        render_win = fg_win.Control(ClassName="Chrome_RenderWidgetHostHWND", searchDepth=10)
                        if render_win.Exists(maxSearchSeconds=0.2):
                            search_containers.append(render_win)
                    except Exception:
                        pass
                    try:
                        doc = fg_win.DocumentControl(searchDepth=10)
                        if doc.Exists(maxSearchSeconds=0.2):
                            search_containers.append(doc)
                    except Exception:
                        pass
                    search_containers.append(fg_win)
                    for container in search_containers:
                        found = _match_in_container(container)
                        if found:
                            return found
            except Exception:
                pass

            # 3단계: 전체 보이는 Top-Level 창 순회 탐색 (Win32 EnumWindows 연계)
            try:
                top_hwnds = [h for h, _, _ in self._get_all_top_windows()]
                for h in top_hwnds:
                    try:
                        w_ctrl = auto.ControlFromHandle(h)
                        if w_ctrl and not getattr(w_ctrl, "IsOffscreen", False):
                            found = _match_in_container(w_ctrl)
                            if found:
                                return found
                    except Exception:
                        continue
            except Exception:
                pass

            # 4단계: UIA Root Children 순회 폴백
            if root:
                try:
                    for win in root.GetChildren():
                        if getattr(win, "IsOffscreen", False):
                            continue
                        cls = str(win.ClassName or "")
                        if cls in ["#32769", "Progman", "WorkerW"]:
                            continue
                        if "오브젝트 선택기" in str(win.Name or ""):
                            continue
                        found = _match_in_container(win)
                        if found:
                            return found
                except Exception:
                    pass

            return None

        return run_in_desktop_thread(_worker)

    def _get_all_top_windows(self) -> list[Tuple[int, str, str]]:
        """시스템의 모든 보이는 상위 창 (hwnd, title, class_name) 목록 반환"""
        ensure_desktop_and_com()
        user32 = ctypes.windll.user32
        results = []

        def enum_proc(h, lParam):
            if user32.IsWindowVisible(h):
                length = user32.GetWindowTextLengthW(h)
                if length > 0:
                    buff = ctypes.create_unicode_buffer(length + 1)
                    user32.GetWindowTextW(h, buff, length + 1)
                    title = buff.value.strip()

                    cls_buff = ctypes.create_unicode_buffer(256)
                    user32.GetClassNameW(h, cls_buff, 256)
                    cls_name = cls_buff.value.strip()

                    if title and cls_name not in ["Progman", "WorkerW", "Shell_TrayWnd", "NotifyIconOverflowWindow"]:
                        if "오브젝트 선택기" not in title:
                            results.append((h, title, cls_name))
            return True

        WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_int, ctypes.c_int)
        cb = WNDENUMPROC(enum_proc)
        try:
            user32.EnumWindows(cb, 0)
        except Exception:
            pass
        return results

    def find_window_target(
        self,
        target_mode: str = "object",
        object_data: Optional[Dict[str, Any]] = None,
        window_title: Optional[str] = None,
        match_type: str = "contains",
    ) -> Tuple[Optional[int], Optional[str]]:
        """
        작업 대상 윈도우의 (hwnd, title)을 찾아 반환합니다.
        브라우저 등 동일 앱의 다중 창 환경에서도 최적의 창을 식별합니다.
        """
        ensure_desktop_and_com()
        user32 = ctypes.windll.user32

        def _get_window_title(h: int) -> str:
            try:
                length = user32.GetWindowTextLengthW(h)
                if length > 0:
                    buff = ctypes.create_unicode_buffer(length + 1)
                    user32.GetWindowTextW(h, buff, length + 1)
                    return buff.value.strip()
            except Exception:
                pass
            return ""

        def _get_top_level_windows() -> list[Tuple[int, str, str]]:
            return self._get_all_top_windows()

        # 1. 현재 활성 창 모드
        if target_mode == "current":
            hwnd = user32.GetForegroundWindow()
            if hwnd:
                return hwnd, _get_window_title(hwnd)
            return None, None

        # 2. UI 오브젝트 기반 모드
        if target_mode == "object" and object_data:
            # 2-1: UIA를 통한 최상위 윈도우 탐색
            if UIA_AVAILABLE and auto is not None:
                ensure_desktop_and_com()
                try:
                    with auto.UIAutomationInitializerInThread():
                        root = auto.GetRootControl()
                        uia_target_name = object_data.get("name")
                        uia_orig_name = object_data.get("orig_name")
                        uia_ctrl_type = object_data.get("control_type")
                        uia_auto_id = object_data.get("automation_id")
                        uia_cls_name = object_data.get("class_name")
                        uia_win_title = object_data.get("window_title")

                        search_names = []
                        if uia_orig_name and uia_orig_name.strip():
                            search_names.append(uia_orig_name.strip())
                        if uia_target_name and uia_target_name.strip() and uia_target_name.strip() not in search_names:
                            search_names.append(uia_target_name.strip())

                        def _find_top_win_of_ctrl(container):
                            if not container:
                                return None
                            if uia_auto_id and uia_auto_id.strip():
                                ctrl = container.Control(AutomationId=uia_auto_id.strip(), searchDepth=8)
                                if ctrl.Exists(maxSearchSeconds=0.2):
                                    top = ctrl.GetTopLevelControl()
                                    if top and top.NativeWindowHandle != (root.NativeWindowHandle if root else 0):
                                        return int(top.NativeWindowHandle), str(top.Name or "")
                            for s_name in search_names:
                                kwargs: Dict[str, Any] = {"Name": s_name, "searchDepth": 8}
                                if uia_ctrl_type and uia_ctrl_type.strip():
                                    kwargs["ControlTypeName"] = uia_ctrl_type.strip()
                                if uia_cls_name and uia_cls_name.strip():
                                    kwargs["ClassName"] = uia_cls_name.strip()
                                ctrl = container.Control(**kwargs)
                                if ctrl.Exists(maxSearchSeconds=0.2):
                                    top = ctrl.GetTopLevelControl()
                                    if top and top.NativeWindowHandle != (root.NativeWindowHandle if root else 0):
                                        return int(top.NativeWindowHandle), str(top.Name or "")
                            return None

                        # 상위 윈도우 스코프 우선 탐색
                        if uia_win_title and uia_win_title.strip():
                            target_win = auto.WindowControl(SubName=uia_win_title.strip(), searchDepth=3)
                            if target_win.Exists(maxSearchSeconds=0.3):
                                res = _find_top_win_of_ctrl(target_win)
                                if res:
                                    return res
                                return int(target_win.NativeWindowHandle), str(target_win.Name or "")

                        # 전체 최상위 창 순회 탐색
                        if root:
                            for win in root.GetChildren():
                                if getattr(win, "IsOffscreen", False):
                                    continue
                                cls = str(win.ClassName or "")
                                if cls in ["#32769", "Progman", "WorkerW"]:
                                    continue
                                if "오브젝트 선택기" in str(win.Name or ""):
                                    continue
                                res = _find_top_win_of_ctrl(win)
                                if res:
                                    return res
                except Exception as e:
                    print(f"[UIAService] find_window_target (UIA) error: {e}")

            # 2-2: 저장된 handle 유효성 검사
            obj_handle = object_data.get("handle")
            if obj_handle and user32.IsWindow(int(obj_handle)):
                h = int(obj_handle)
                top_hwnd = user32.GetAncestor(h, 2)  # GA_ROOT = 2
                if top_hwnd and user32.IsWindow(top_hwnd):
                    h = top_hwnd
                title = _get_window_title(h)
                expected_title = object_data.get("window_title", "")
                if not expected_title or expected_title.lower() in title.lower() or title.lower() in expected_title.lower():
                    return h, title

            # 2-3: 저장된 window_title로 검색
            target_title = object_data.get("window_title")
            if target_title and target_title.strip():
                windows = _get_top_level_windows()
                t_lower = target_title.strip().lower()
                for h, title, _ in windows:
                    if t_lower in title.lower():
                        return h, title

            # 2-4: 저장된 class_name으로 검색
            target_cls = object_data.get("class_name")
            if target_cls and target_cls.strip():
                windows = _get_top_level_windows()
                for h, title, c_name in windows:
                    if target_cls == c_name:
                        return h, title

        # 3. 창 제목 직접 지정 모드
        if window_title and window_title.strip():
            target_text = window_title.strip()
            windows = _get_top_level_windows()

            for h, title, _ in windows:
                if match_type == "exact":
                    if title == target_text:
                        return h, title
                elif match_type == "startswith":
                    if title.startswith(target_text):
                        return h, title
                else:  # contains
                    if target_text.lower() in title.lower():
                        return h, title

        return None, None

    def find_window_by_title(self, title: str, match_type: str = "contains") -> Optional[int]:
        """
        제목(부분 일치 지원)으로 최적의 윈도우 핸들(hwnd)을 검색하여 반환합니다.
        """
        hwnd, _ = self.find_window_target(
            target_mode="title",
            window_title=title,
            match_type=match_type
        )
        return hwnd

    def activate_window(self, hwnd: int) -> bool:
        """
        주어진 hwnd 윈도우를 맨 앞으로 가져오고 포커스를 획득합니다.
        최소화 상태이면 SW_RESTORE로 정상 복원합니다.
        Windows 포커스 스틸링 방지를 우회하기 위해 AttachThreadInput 기법을 사용합니다.
        """
        if not hwnd or not ctypes.windll.user32.IsWindow(hwnd):
            return False

        user32 = ctypes.windll.user32

        # 1. 최소화되어 있는 경우 정상 크기로 복원 (SW_RESTORE = 9)
        if user32.IsIconic(hwnd):
            user32.ShowWindow(hwnd, 9)
        else:
            user32.ShowWindow(hwnd, 5)  # SW_SHOW

        # 2. AttachThreadInput을 통한 포커스 스틸링 방지 우회
        fg_hwnd = user32.GetForegroundWindow()
        fg_tid = user32.GetWindowThreadProcessId(fg_hwnd, None)
        cur_tid = ctypes.windll.kernel32.GetCurrentThreadId()

        if fg_tid != cur_tid:
            user32.AttachThreadInput(cur_tid, fg_tid, True)

        user32.BringWindowToTop(hwnd)
        user32.SetForegroundWindow(hwnd)

        if fg_tid != cur_tid:
            user32.AttachThreadInput(cur_tid, fg_tid, False)

        # 3. 추가 보조 활성화
        try:
            user32.SwitchToThisWindow(hwnd, True)
        except Exception:
            pass

        # 4. UIA 포커스 동기화
        if UIA_AVAILABLE and auto is not None:
            ensure_desktop_and_com()
            try:
                with auto.UIAutomationInitializerInThread():
                    ctrl = auto.ControlFromHandle(hwnd)
                    if ctrl:
                        ctrl.SetActive()
                        ctrl.SetFocus()
            except Exception:
                pass

        time.sleep(0.1)
        return True

    def maximize_window(self, hwnd: int) -> bool:
        """
        주어진 hwnd 윈도우를 현재 모니터 해상도의 최대 크기로 확장(최대화)합니다.
        """
        if not hwnd or not ctypes.windll.user32.IsWindow(hwnd):
            return False

        user32 = ctypes.windll.user32

        # 최소화 상태인 경우 복원 후 최대화
        if user32.IsIconic(hwnd):
            user32.ShowWindow(hwnd, 9)  # SW_RESTORE
            time.sleep(0.05)

        user32.ShowWindow(hwnd, 3)  # SW_MAXIMIZE = 3
        user32.SetForegroundWindow(hwnd)

        if UIA_AVAILABLE and auto is not None:
            ensure_desktop_and_com()
            try:
                with auto.UIAutomationInitializerInThread():
                    ctrl = auto.ControlFromHandle(hwnd)
                    if ctrl:
                        ctrl.Maximize()
            except Exception:
                pass

        time.sleep(0.1)
        return True

    def minimize_window(self, hwnd: int) -> bool:
        """
        주어진 hwnd 윈도우를 작업표시줄로 내려서 가려버립니다(최소화).
        """
        if not hwnd or not ctypes.windll.user32.IsWindow(hwnd):
            return False

        user32 = ctypes.windll.user32
        user32.ShowWindow(hwnd, 6)  # SW_MINIMIZE = 6

        if UIA_AVAILABLE and auto is not None:
            ensure_desktop_and_com()
            try:
                with auto.UIAutomationInitializerInThread():
                    ctrl = auto.ControlFromHandle(hwnd)
                    if ctrl:
                        ctrl.Minimize()
            except Exception:
                pass

        time.sleep(0.1)
        return True

    def close_window(self, hwnd: int) -> bool:
        """
        주어진 hwnd 윈도우에 WM_CLOSE를 전송하여 창을 닫습니다.
        """
        if not hwnd or not ctypes.windll.user32.IsWindow(hwnd):
            return False

        from app.services.process_service import process_service
        return process_service.close_window_by_hwnd(hwnd)

    def is_window_idle(self, hwnd: int) -> bool:
        """
        주어진 hwnd 윈도우 및 해당 프로세스가 로딩/블로킹 상태가 아닌 사용자 입력 준비 완료(Idle) 상태인지 검사합니다.
        1. Win32 IsHungAppWindow 확인 (응답 없음/블로킹 여부)
        2. Win32 WaitForInputIdle 확인 (프로세스 메시지 루프 대기 상태)
        3. UIA WindowInteractionState 확인 (ReadyForUserInteraction / Running 상태)
        """
        if not hwnd or not ctypes.windll.user32.IsWindow(hwnd):
            return False

        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32

        # 1. 윈도우 응답 없음(Hung/Not Responding) 체크
        if user32.IsHungAppWindow(hwnd):
            return False

        # 2. 프로세스 WaitForInputIdle 체크 (메시지 루프가 입력 수신 대기 상태인지 확인)
        pid = ctypes.c_ulong()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value:
            # PROCESS_QUERY_LIMITED_INFORMATION(0x1000) or PROCESS_QUERY_INFORMATION(0x0400) | SYNCHRONIZE(0x00100000)
            h_process = kernel32.OpenProcess(0x1000 | 0x00100000, False, pid.value)
            if not h_process:
                h_process = kernel32.OpenProcess(0x0410 | 0x00100000, False, pid.value)
            if h_process:
                try:
                    # 30ms 동안 입력 대기 상태인지 폴링
                    res = user32.WaitForInputIdle(h_process, 30)
                    if res == 258:  # WAIT_TIMEOUT (아직 메시지 큐 초기화 중)
                        return False
                finally:
                    kernel32.CloseHandle(h_process)

        # 3. UIA WindowPattern 상호작용 상태(WindowInteractionState) 체크
        if UIA_AVAILABLE and auto is not None:
            ensure_desktop_and_com()
            try:
                with auto.UIAutomationInitializerInThread():
                    win_ctrl = auto.ControlFromHandle(hwnd)
                    if win_ctrl and win_ctrl.Exists(0, 0):
                        win_pattern = win_ctrl.GetWindowPattern()
                        if win_pattern:
                            state = getattr(win_pattern, "WindowInteractionState", None)
                            # 3: BlockedByModalWindow, 4: NotResponding
                            if state in (3, 4):
                                return False
            except Exception:
                pass

        return True

    def scan_active_window_elements(
        self,
        window_title: Optional[str] = None,
        hwnd: Optional[int] = None,
        limit: int = 50,
        offset: int = 0,
        query: Optional[str] = None,
        max_elements: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        지정 윈도우(또는 현재 전면 활성 창)의 상호작용 가능한 UI 요소들을
        RDB 스타일 OFFSET / LIMIT 페이지네이션 및 키워드 필터링(query)을 지원하여 고속 스캔합니다.
        브라우저(Chrome, Edge 등) 웹페이지 본문 깊은 DOM(depth 16+)도 완벽 스캔 지원.
        """
        effective_limit = max_elements if max_elements is not None else limit
        effective_limit = max(1, effective_limit)
        effective_offset = max(0, offset)

        def _scan_worker():
            if not UIA_AVAILABLE or auto is None:
                return {
                    "window_title": "알 수 없음 (UIA 불가)",
                    "hwnd": 0,
                    "window_rect": {},
                    "elements": [],
                    "total_count": 0,
                    "offset": effective_offset,
                    "limit": effective_limit,
                    "has_more": False,
                    "next_offset": None,
                    "prev_offset": None,
                    "current_page": 1,
                    "total_pages": 1,
                    "formatted_text": "UIA를 지원하지 않는 환경입니다."
                }

            user32 = ctypes.windll.user32
            target_hwnd = hwnd if (hwnd and user32.IsWindow(hwnd)) else None
            resolved_title = ""

            if not target_hwnd and window_title and str(window_title).strip():
                h, t = self.find_window_target(target_mode="title", window_title=str(window_title).strip(), match_type="contains")
                if h:
                    target_hwnd = h
                    resolved_title = t or ""

            if not target_hwnd:
                target_hwnd = user32.GetForegroundWindow()

            if not target_hwnd or not user32.IsWindow(target_hwnd):
                return {
                    "window_title": "활성 창 없음",
                    "hwnd": 0,
                    "window_rect": {},
                    "elements": [],
                    "total_count": 0,
                    "offset": effective_offset,
                    "limit": effective_limit,
                    "has_more": False,
                    "next_offset": None,
                    "prev_offset": None,
                    "current_page": 1,
                    "total_pages": 1,
                    "formatted_text": "활성화된 윈도우를 찾을 수 없습니다."
                }

            # 윈도우 제목 취득
            if not resolved_title:
                length = user32.GetWindowTextLengthW(target_hwnd)
                if length > 0:
                    buf = ctypes.create_unicode_buffer(length + 1)
                    user32.GetWindowTextW(target_hwnd, buf, length + 1)
                    resolved_title = buf.value
                else:
                    resolved_title = "제목 없음"

            # 윈도우 물리 Rect 취득
            class RECT(ctypes.Structure):
                _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long),
                            ("right", ctypes.c_long), ("bottom", ctypes.c_long)]
            w_rect = RECT()
            user32.GetWindowRect(target_hwnd, ctypes.byref(w_rect))
            window_rect = {
                "left": int(w_rect.left),
                "top": int(w_rect.top),
                "right": int(w_rect.right),
                "bottom": int(w_rect.bottom),
                "width": max(0, int(w_rect.right - w_rect.left)),
                "height": max(0, int(w_rect.bottom - w_rect.top))
            }

            # 최소화 상태인 경우 복원
            if user32.IsIconic(target_hwnd):
                user32.ShowWindow(target_hwnd, 9)  # SW_RESTORE
                time.sleep(0.1)

            win_ctrl = auto.ControlFromHandle(target_hwnd)
            if not win_ctrl or not win_ctrl.Exists(0, 0):
                return {
                    "window_title": resolved_title,
                    "hwnd": target_hwnd,
                    "window_rect": window_rect,
                    "elements": [],
                    "total_count": 0,
                    "offset": effective_offset,
                    "limit": effective_limit,
                    "has_more": False,
                    "next_offset": None,
                    "prev_offset": None,
                    "current_page": 1,
                    "total_pages": 1,
                    "formatted_text": f"[{resolved_title}] UIA 바인딩 실패"
                }

            interactive_types = {
                auto.ControlType.ButtonControl: "버튼",
                auto.ControlType.EditControl: "입력창",
                auto.ControlType.CheckBoxControl: "체크박스",
                auto.ControlType.RadioButtonControl: "라디오버튼",
                auto.ControlType.MenuItemControl: "메뉴항목",
                auto.ControlType.TabItemControl: "탭",
                auto.ControlType.HyperlinkControl: "링크",
                auto.ControlType.ComboBoxControl: "콤보박스",
                auto.ControlType.ListItemControl: "리스트항목",
                auto.ControlType.TreeItemControl: "트리항목",
                auto.ControlType.TextControl: "텍스트",
            }

            elements = []
            visited_rects = set()

            # 브라우저(Chrome, Edge 등) 스마트 스코핑: 웹 렌더러 영역 직접 타겟팅
            scan_roots = []
            is_browser = False
            try:
                render_win = win_ctrl.Control(ClassName="Chrome_RenderWidgetHostHWND", searchDepth=10)
                if render_win.Exists(maxSearchSeconds=0.15):
                    scan_roots.append((render_win, 16))
                    is_browser = True
            except Exception:
                pass

            if not is_browser:
                try:
                    doc_ctrl = win_ctrl.DocumentControl(searchDepth=12)
                    if doc_ctrl.Exists(maxSearchSeconds=0.15):
                        scan_roots.append((doc_ctrl, 16))
                        is_browser = True
                except Exception:
                    pass

            # 브라우저가 아니거나 렌더러 탐색 실패 시 최상위 창 전체 탐색
            if not scan_roots:
                scan_roots.append((win_ctrl, 14))

            # 페이지네이션 오프셋과 리밋을 커버할 수 있도록 최대 350개까지 수집
            target_collect_limit = max(300, effective_offset + effective_limit * 3)

            def _traverse(ctrl, max_depth, depth=0):
                if depth > max_depth or len(elements) >= target_collect_limit:
                    return

                try:
                    children = ctrl.GetChildren()
                except Exception:
                    return

                for child in children:
                    try:
                        c_type = child.ControlType
                        c_name = (child.Name or "").strip()
                        c_auto_id = getattr(child, "AutomationId", "") or ""

                        # 텍스트 컨트롤인 경우 이름이 없거나 너무 길면 스킵
                        if c_type == auto.ControlType.TextControl:
                            if not c_name or len(c_name) > 80:
                                _traverse(child, max_depth, depth + 1)
                                continue

                        if c_type in interactive_types:
                            rect = child.BoundingRectangle
                            w = rect.right - rect.left
                            h = rect.bottom - rect.top

                            # 가시 크기 검사 (최소 6x6 이상, 비정상 음수 좌표 제외)
                            if w >= 6 and h >= 6 and rect.left > -4000 and rect.top > -4000:
                                center_x = rect.left + w // 2
                                center_y = rect.top + h // 2
                                rect_key = (center_x, center_y)

                                if rect_key not in visited_rects:
                                    # 의미 있는 표시명 정제
                                    display_name = c_name or c_auto_id or interactive_types[c_type]
                                    if len(display_name) > 40:
                                        display_name = display_name[:37] + "..."

                                    visited_rects.add(rect_key)
                                    elements.append({
                                        "name": display_name,
                                        "type_name": interactive_types[c_type],
                                        "control_type": auto.ControlTypeNames.get(c_type, "Control"),
                                        "x": center_x,
                                        "y": center_y,
                                        "left": rect.left,
                                        "top": rect.top,
                                        "right": rect.right,
                                        "bottom": rect.bottom,
                                        "width": w,
                                        "height": h,
                                        "is_primary": c_type in (
                                            auto.ControlType.ButtonControl,
                                            auto.ControlType.EditControl,
                                            auto.ControlType.HyperlinkControl,
                                            auto.ControlType.TabItemControl
                                        )
                                    })
                    except Exception:
                        pass

                    _traverse(child, max_depth, depth + 1)

            for root_elem, limit_depth in scan_roots:
                _traverse(root_elem, limit_depth, 0)

            # 버튼/입력창/링크 우선 정렬 후 Y좌표, X좌표 순의 결정론적(Deterministic) 정렬
            elements.sort(key=lambda e: (0 if e["is_primary"] else 1, e["y"], e["x"]))

            # 1. 키워드 검색(query) 필터링 지원
            if query and str(query).strip():
                q_lower = str(query).strip().lower()
                filtered_elements = [
                    e for e in elements
                    if q_lower in e["name"].lower() or q_lower in e["type_name"].lower() or q_lower in e["control_type"].lower()
                ]
            else:
                filtered_elements = elements

            # 2. RDB 스타일 OFFSET & LIMIT 페이지네이션 슬라이싱
            total_count = len(filtered_elements)
            selected_elements = filtered_elements[effective_offset : effective_offset + effective_limit]
            has_more = (effective_offset + effective_limit) < total_count
            next_offset = effective_offset + effective_limit if has_more else None
            prev_offset = max(0, effective_offset - effective_limit) if effective_offset > 0 else None
            current_page = (effective_offset // effective_limit) + 1 if effective_limit > 0 else 1
            total_pages = max(1, (total_count + effective_limit - 1) // effective_limit) if effective_limit > 0 else 1

            # 1-indexed ID 부여 (오프셋 순번 반영)
            for idx, el in enumerate(selected_elements, start=effective_offset + 1):
                el["id"] = idx

            # LLM 주입용 텍스트 포맷팅 (페이지 안내 및 다음 페이지 탐색 유도 힌트)
            range_end = effective_offset + len(selected_elements)
            header_sub = f"검색어 '{query}' 일치 요소 " if query and str(query).strip() else ""
            lines = [f"[대상 창: '{resolved_title}'] ({header_sub}총 {total_count}개 중 #{effective_offset + 1}~#{range_end} 표시, {current_page}/{total_pages}페이지)"]

            if not selected_elements:
                if total_count == 0:
                    lines.append("  (일치하는 상호작용 가능 UI 요소를 감지하지 못했습니다)")
                else:
                    lines.append(f"  (오프셋 {effective_offset}에 해당하는 요소가 없습니다. 유효 범위: 0 ~ {max(0, total_count - 1)})")
            else:
                for el in selected_elements:
                    lines.append(f"  #{el['id']} [{el['type_name']}] \"{el['name']}\" -> 좌표 (X: {el['x']}, Y: {el['y']})")

            if has_more:
                remaining = total_count - range_end
                lines.append(f"\n👉 [추가 요소 안내] 아직 표시되지 않은 UI 요소가 {remaining}개 더 있습니다.")
                lines.append(f"   원하는 UI 요소가 위 목록에 없다면 다음 도구를 호출하여 다음 페이지를 확인하세요: get_screen_elements(offset={next_offset}, limit={effective_limit})")
            elif total_count > 0:
                lines.append("\n(마지막 페이지입니다. 모든 감지된 UI 요소가 표시되었습니다)")

            return {
                "window_title": resolved_title,
                "hwnd": target_hwnd,
                "window_rect": window_rect,
                "elements": selected_elements,
                "total_count": total_count,
                "offset": effective_offset,
                "limit": effective_limit,
                "has_more": has_more,
                "next_offset": next_offset,
                "prev_offset": prev_offset,
                "current_page": current_page,
                "total_pages": total_pages,
                "formatted_text": "\n".join(lines)
            }

        return run_in_desktop_thread(_scan_worker) or {
            "window_title": "알 수 없음",
            "hwnd": 0,
            "window_rect": {},
            "elements": [],
            "total_count": 0,
            "offset": effective_offset,
            "limit": effective_limit,
            "has_more": False,
            "next_offset": None,
            "prev_offset": None,
            "current_page": 1,
            "total_pages": 1,
            "formatted_text": "UI 요소 스캔 실패"
        }

    def send_mouse_wheel(
        self,
        direction: str = "vertical",
        signed_ticks: int = -5,
        x: Optional[int] = None,
        y: Optional[int] = None
    ) -> None:
        """
        Win32 mouse_event를 통해 물리 마우스 휠(상하 MOUSEEVENTF_WHEEL / 좌우 MOUSEEVENTF_HWHEEL) 신호를 전송합니다.
        - vertical: signed_ticks > 0 (위로/앞으로), signed_ticks < 0 (아래로/뒤로)
        - horizontal: signed_ticks > 0 (오른쪽으로/뒤로), signed_ticks < 0 (왼쪽으로/앞으로)
        """
        import pyautogui
        user32 = ctypes.windll.user32
        MOUSEEVENTF_WHEEL = 0x0800
        MOUSEEVENTF_HWHEEL = 0x01000
        WHEEL_DELTA = 120

        if x is not None and y is not None:
            try:
                pyautogui.moveTo(int(x), int(y))
            except Exception:
                pass

        if signed_ticks == 0:
            return

        flag = MOUSEEVENTF_HWHEEL if direction == "horizontal" else MOUSEEVENTF_WHEEL
        # 한 번에 너무 큰 delta를 보내면 일부 앱에서 무시할 수 있으므로 최대 5틱 단위로 분할 전송
        remaining = int(signed_ticks)
        step_sign = 1 if remaining > 0 else -1
        remaining_abs = abs(remaining)

        while remaining_abs > 0:
            chunk = min(5, remaining_abs)
            delta = step_sign * chunk * WHEEL_DELTA
            try:
                user32.mouse_event(flag, 0, 0, ctypes.c_ulong(delta & 0xFFFFFFFF).value, 0)
            except Exception:
                if direction == "vertical":
                    pyautogui.scroll(step_sign * chunk)
                else:
                    try:
                        pyautogui.hscroll(step_sign * chunk)
                    except Exception:
                        pass
            remaining_abs -= chunk
            if remaining_abs > 0:
                time.sleep(0.015)

    def _capture_region_signature(self, rect_tuple: Tuple[int, int, int, int]) -> Optional[bytes]:
        """
        지정 영역 (left, top, right, bottom)의 축소 그레이스케일 픽셀 시그니처를 캡처하여
        스크롤 전후 화면 변화(처음/끝 도달 여부 및 스크롤 작동 여부)를 비-AI 방식으로 판별합니다.
        """
        try:
            left, top, right, bottom = rect_tuple
            w = max(0, right - left)
            h = max(0, bottom - top)
            if w < 10 or h < 10:
                return None
            with mss.mss() as sct:
                raw = sct.grab({"left": int(left), "top": int(top), "width": int(w), "height": int(h)})
                img = Image.frombytes("RGB", raw.size, raw.bgra, "raw", "BGRX").convert("L")
                img_small = img.resize((32, 32))
                return img_small.tobytes()
        except Exception:
            return None

    def _regions_differ(self, sig1: Optional[bytes], sig2: Optional[bytes]) -> bool:
        """두 영역 시그니처 간 유의미한 픽셀 변화가 발생했는지 검사"""
        if not sig1 or not sig2 or len(sig1) != len(sig2):
            return False
        diff_sum = sum(abs(a - b) for a, b in zip(sig1, sig2))
        mean_diff = diff_sum / len(sig1)
        return mean_diff > 0.8

    def scroll_target_element(
        self,
        target_x: int,
        target_y: int,
        object_data: Optional[Dict[str, Any]] = None,
        direction: str = "vertical",
        distance_mode: str = "ticks",
        ticks: int = 5,
        ticks_direction: str = "backward"
    ) -> Dict[str, Any]:
        """
        오브젝트 선택 모드 전용 비-키보드(Non-Keyboard), 비-AI(Non-AI) 정밀 스크롤 엔진.
        1. 대상 UI 오브젝트에 포커스(SetFocus 및 마우스 커서 이동) 부여
        2. 다중 하위 스크롤바 환경에서 해당 요소가 속한 가장 가까운 스크롤 컨테이너 탐색
        3. 단축키 입력 없이 UIA ScrollPattern ➔ Win32 WM_VSCROLL/WM_HSCROLL ➔ 하드웨어 마우스 휠 순으로 제어
        4. 스크롤 존재 여부 및 처음(0%)/끝(100%) 도달 상태를 감지하여 반환
        """
        import pyautogui

        def _scroll_worker() -> Dict[str, Any]:
            user32 = ctypes.windll.user32
            cx, cy = int(target_x), int(target_y)

            # 1. 마우스 커서를 대상 오브젝트 중심 좌표로 이동
            try:
                pyautogui.moveTo(cx, cy)
            except Exception:
                pass

            ctrl = None
            scroll_container = None
            scroll_pattern = None
            container_hwnd = None
            container_rect = (max(0, cx - 200), max(0, cy - 200), cx + 200, cy + 200)

            if UIA_AVAILABLE and auto is not None:
                try:
                    ctrl = auto.ControlFromPoint(cx, cy)
                except Exception:
                    ctrl = None

            # 2. 상위 창 활성화 및 대상 UI 오브젝트에 Focus 부여
            if ctrl:
                try:
                    top_win = ctrl.GetTopLevelControl()
                    if top_win and top_win.NativeWindowHandle:
                        fg_hwnd = user32.GetForegroundWindow()
                        if fg_hwnd != int(top_win.NativeWindowHandle):
                            self.activate_window(int(top_win.NativeWindowHandle))
                            pyautogui.moveTo(cx, cy)
                except Exception:
                    pass

                try:
                    ctrl.SetFocus()
                except Exception:
                    pass

                # 3. 다중 하위 스크롤 컨테이너 탐색 (자신 ➔ 자식 ➔ 부모 순회)
                candidates = [ctrl]
                try:
                    for ch in ctrl.GetChildren():
                        r = ch.BoundingRectangle
                        if r and r.left <= cx <= r.right and r.top <= cy <= r.bottom:
                            candidates.append(ch)
                except Exception:
                    pass

                curr_p = ctrl
                for _ in range(8):
                    try:
                        parent = curr_p.GetParentControl()
                        if not parent or parent.ControlType == auto.ControlType.PaneControl and parent == auto.GetRootControl():
                            break
                        candidates.append(parent)
                        curr_p = parent
                    except Exception:
                        break

                for cand in candidates:
                    try:
                        sp = cand.GetScrollPattern()
                        if sp:
                            is_scrollable = (
                                bool(getattr(sp, "VerticallyScrollable", False))
                                if direction == "vertical"
                                else bool(getattr(sp, "HorizontallyScrollable", False))
                            )
                            view_size = (
                                float(getattr(sp, "VerticalViewSize", 100.0))
                                if direction == "vertical"
                                else float(getattr(sp, "HorizontalViewSize", 100.0))
                            )
                            if is_scrollable or view_size < 100.0:
                                scroll_container = cand
                                scroll_pattern = sp
                                break
                            if scroll_pattern is None:
                                scroll_container = cand
                                scroll_pattern = sp
                    except Exception:
                        continue

                target_for_rect = scroll_container or ctrl
                try:
                    r = target_for_rect.BoundingRectangle
                    if r and r.width() > 10 and r.height() > 10:
                        container_rect = (int(r.left), int(r.top), int(r.right), int(r.bottom))
                except Exception:
                    pass

                try:
                    h = getattr(target_for_rect, "NativeWindowHandle", 0)
                    if not h and ctrl:
                        h = getattr(ctrl, "NativeWindowHandle", 0)
                    if h:
                        container_hwnd = int(h)
                except Exception:
                    pass

            if not container_hwnd:
                try:
                    pt = wintypes.POINT(cx, cy)
                    h_pt = user32.WindowFromPoint(pt)
                    if h_pt:
                        container_hwnd = int(h_pt)
                except Exception:
                    pass

            # 헬퍼: 현재 UIA 스크롤 퍼센트 조회 (0.0 ~ 100.0, 미지원 시 None)
            def _get_scroll_pct() -> Optional[float]:
                if not scroll_pattern:
                    return None
                try:
                    val = (
                        getattr(scroll_pattern, "VerticalScrollPercent", -1.0)
                        if direction == "vertical"
                        else getattr(scroll_pattern, "HorizontalScrollPercent", -1.0)
                    )
                    val_f = float(val)
                    if 0.0 <= val_f <= 100.0:
                        return val_f
                except Exception:
                    pass
                return None

            before_pct = _get_scroll_pct()
            before_sig = self._capture_region_signature(container_rect)
            method_used = "Wheel"

            # Win32 메시지 상수
            WM_HSCROLL = 0x0114
            WM_VSCROLL = 0x0115
            wm_msg = WM_HSCROLL if direction == "horizontal" else WM_VSCROLL
            SB_LINEUP = 0      # 위로 / 왼쪽으로 1줄
            SB_LINEDOWN = 1    # 아래로 / 오른쪽으로 1줄
            SB_PAGEUP = 2      # 한 페이지 앞으로 (PageUp / PageLeft)
            SB_PAGEDOWN = 3    # 한 페이지 뒤로 (PageDown / PageRight)
            SB_TOP = 6         # 맨 처음 (Home / Left)
            SB_BOTTOM = 7      # 맨 끝 (End / Right)

            # UIA ScrollAmount 상수 (0: LargeDecrement, 1: SmallDecrement, 2: NoAmount, 3: LargeIncrement, 4: SmallIncrement)
            UIA_LargeDecrement = getattr(auto.ScrollAmount, "LargeDecrement", 0) if auto else 0
            UIA_SmallDecrement = getattr(auto.ScrollAmount, "SmallDecrement", 1) if auto else 1
            UIA_NoAmount = getattr(auto.ScrollAmount, "NoAmount", 2) if auto else 2
            UIA_LargeIncrement = getattr(auto.ScrollAmount, "LargeIncrement", 3) if auto else 3
            UIA_SmallIncrement = getattr(auto.ScrollAmount, "SmallIncrement", 4) if auto else 4

            def _uia_scroll_step(amount_const: int) -> bool:
                if not scroll_pattern:
                    return False
                try:
                    if direction == "vertical":
                        scroll_pattern.Scroll(UIA_NoAmount, amount_const)
                    else:
                        scroll_pattern.Scroll(amount_const, UIA_NoAmount)
                    return True
                except Exception:
                    return False

            def _uia_set_percent(target_pct: float) -> bool:
                if not scroll_pattern:
                    return False
                try:
                    if direction == "vertical":
                        scroll_pattern.SetScrollPercent(-1.0, float(target_pct))
                    else:
                        scroll_pattern.SetScrollPercent(float(target_pct), -1.0)
                    return True
                except Exception:
                    return False

            # 뷰포트 크기 비례 1페이지 휠 틱 수 산출
            rect_w = max(100, container_rect[2] - container_rect[0])
            rect_h = max(100, container_rect[3] - container_rect[1])
            page_ticks = max(3, min(12, round((rect_h if direction == "vertical" else rect_w) / 90)))

            # 4. 거리 모드별 비-키보드 스크롤 실행
            if distance_mode == "ticks":
                abs_ticks = max(1, abs(int(ticks)))
                # backward: 아래로(vertical: 음수 휠) / 오른쪽으로(horizontal: 양수 휠)
                # forward: 위로(vertical: 양수 휠) / 왼쪽으로(horizontal: 음수 휠)
                is_backward = (int(ticks) < 0) or (int(ticks) > 0 and ticks_direction != "forward")
                if direction == "vertical":
                    wheel_ticks = -abs_ticks if is_backward else abs_ticks
                else:
                    wheel_ticks = abs_ticks if is_backward else -abs_ticks

                self.send_mouse_wheel(direction=direction, signed_ticks=wheel_ticks, x=cx, y=cy)
                time.sleep(0.06)
                after_sig_temp = self._capture_region_signature(container_rect)
                after_pct_temp = _get_scroll_pct()

                # 만약 하드웨어 휠로 변화가 없고 UIA ScrollPattern 또는 Win32 핸들이 있으면 보조 실행
                moved_by_wheel = (
                    (before_pct is not None and after_pct_temp is not None and abs(after_pct_temp - before_pct) > 0.05)
                    or self._regions_differ(before_sig, after_sig_temp)
                )
                if not moved_by_wheel:
                    uia_amt = UIA_SmallIncrement if is_backward else UIA_SmallDecrement
                    if scroll_pattern:
                        for _ in range(min(abs_ticks, 10)):
                            if _uia_scroll_step(uia_amt):
                                method_used = "UIA ScrollPattern (Ticks)"
                    elif container_hwnd:
                        sb_cmd = SB_LINEDOWN if is_backward else SB_LINEUP
                        for _ in range(min(abs_ticks, 10)):
                            user32.SendMessageW(container_hwnd, wm_msg, sb_cmd, 0)
                        method_used = "Win32 ScrollMessage (Ticks)"

            elif distance_mode in ("page_down", "page_up"):
                is_down = (distance_mode == "page_down")
                uia_amt = UIA_LargeIncrement if is_down else UIA_LargeDecrement
                sb_cmd = SB_PAGEDOWN if is_down else SB_PAGEUP

                # 1순위: UIA ScrollPattern (LargeIncrement / LargeDecrement)
                used_uia = _uia_scroll_step(uia_amt)
                if used_uia:
                    time.sleep(0.06)
                    method_used = "UIA ScrollPattern (Page)"

                mid_pct = _get_scroll_pct()
                mid_sig = self._capture_region_signature(container_rect)
                moved = (
                    (before_pct is not None and mid_pct is not None and abs(mid_pct - before_pct) > 0.05)
                    or self._regions_differ(before_sig, mid_sig)
                )

                # 2순위: Win32 WM_VSCROLL / WM_HSCROLL (SB_PAGEDOWN / SB_PAGEUP)
                if not moved and container_hwnd:
                    user32.SendMessageW(container_hwnd, wm_msg, sb_cmd, 0)
                    time.sleep(0.06)
                    mid_pct = _get_scroll_pct()
                    mid_sig = self._capture_region_signature(container_rect)
                    moved = (
                        (before_pct is not None and mid_pct is not None and abs(mid_pct - before_pct) > 0.05)
                        or self._regions_differ(before_sig, mid_sig)
                    )
                    if moved:
                        method_used = "Win32 WM_SCROLL (Page)"

                # 3순위: 뷰포트 크기 비례 물리 마우스 휠
                if not moved:
                    if direction == "vertical":
                        wheel_ticks = -page_ticks if is_down else page_ticks
                    else:
                        wheel_ticks = page_ticks if is_down else -page_ticks
                    self.send_mouse_wheel(direction=direction, signed_ticks=wheel_ticks, x=cx, y=cy)
                    time.sleep(0.06)
                    method_used = "Viewport Mouse Wheel (Page)"

            elif distance_mode in ("end", "home"):
                is_end = (distance_mode == "end")
                target_pct = 100.0 if is_end else 0.0
                sb_cmd = SB_BOTTOM if is_end else SB_TOP
                uia_amt = UIA_LargeIncrement if is_end else UIA_LargeDecrement

                # 1순위: UIA SetScrollPercent(100.0 / 0.0)
                if _uia_set_percent(target_pct):
                    time.sleep(0.08)
                    method_used = "UIA SetScrollPercent"

                curr_pct = _get_scroll_pct()
                reached = (
                    (curr_pct is not None and ((is_end and curr_pct >= 99.5) or (not is_end and curr_pct <= 0.5)))
                )

                # 2순위: Win32 SB_BOTTOM / SB_TOP
                if not reached and container_hwnd:
                    user32.SendMessageW(container_hwnd, wm_msg, sb_cmd, 0)
                    time.sleep(0.06)
                    curr_pct = _get_scroll_pct()
                    if curr_pct is not None and ((is_end and curr_pct >= 99.5) or (not is_end and curr_pct <= 0.5)):
                        reached = True
                        method_used = "Win32 SB_TOP/BOTTOM"

                # 3순위: 경계(처음/끝) 도달 시까지 연속 페이지/휠 스크롤 루프 (변화량 0 감지)
                if not reached:
                    prev_sig = self._capture_region_signature(container_rect)
                    prev_pct = _get_scroll_pct()
                    for _ in range(25):
                        step_ok = _uia_scroll_step(uia_amt)
                        if not step_ok:
                            if direction == "vertical":
                                w_ticks = -(page_ticks * 2) if is_end else (page_ticks * 2)
                            else:
                                w_ticks = (page_ticks * 2) if is_end else -(page_ticks * 2)
                            self.send_mouse_wheel(direction=direction, signed_ticks=w_ticks, x=cx, y=cy)
                        time.sleep(0.05)

                        now_pct = _get_scroll_pct()
                        now_sig = self._capture_region_signature(container_rect)

                        if now_pct is not None:
                            if (is_end and now_pct >= 99.5) or (not is_end and now_pct <= 0.5):
                                method_used = "Boundary Loop (UIA Percent)"
                                break
                            if prev_pct is not None and abs(now_pct - prev_pct) < 0.05:
                                break
                        elif not self._regions_differ(prev_sig, now_sig):
                            # 더 이상 화면 픽셀이 변하지 않으면 처음/끝 도달 완료
                            method_used = "Boundary Loop (Pixel Delta)"
                            break

                        prev_sig = now_sig
                        prev_pct = now_pct

            after_pct = _get_scroll_pct()
            after_sig = self._capture_region_signature(container_rect)
            visual_changed = self._regions_differ(before_sig, after_sig)
            pct_changed = (
                before_pct is not None and after_pct is not None and abs(after_pct - before_pct) > 0.05
            )
            scroll_detected = bool(scroll_pattern is not None or visual_changed or pct_changed)

            at_start = False
            at_end = False
            if after_pct is not None:
                at_start = after_pct <= 0.5
                at_end = after_pct >= 99.5
            else:
                if distance_mode == "home" or (distance_mode == "page_up" and not visual_changed):
                    at_start = not visual_changed or distance_mode == "home"
                if distance_mode == "end" or (distance_mode == "page_down" and not visual_changed):
                    at_end = not visual_changed or distance_mode == "end"

            return {
                "success": True,
                "method_used": method_used,
                "scroll_detected": scroll_detected,
                "before_percent": before_pct,
                "after_percent": after_pct,
                "visual_changed": visual_changed,
                "at_start": at_start,
                "at_end": at_end,
                "coords": (cx, cy),
            }

        return run_in_desktop_thread(_scroll_worker) or {
            "success": False,
            "method_used": "None",
            "scroll_detected": False,
            "at_start": False,
            "at_end": False,
            "coords": (target_x, target_y),
        }

uia_service = UIAService()


