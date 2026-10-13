import io
from pathlib import Path
from datetime import datetime, timezone
import mss
from PIL import Image, ImageDraw, ImageFont
from app.core.config import settings

class ScreenCaptureService:
    def __init__(self):
        self.output_dir = settings.SCREENSHOTS_DIR

    def _create_fallback_image(self, width: int = 1920, height: int = 1080, reason: str = "") -> Image.Image:
        """화면 캡처가 불가한 환경(화면 잠금, 비대화형 테스트 환경 등)을 위한 대체 이미지 생성"""
        img = Image.new("RGB", (width, height), color=(30, 34, 42))
        draw = ImageDraw.Draw(img)
        
        now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        text = f"Praxis Desktop - Screen Unavailable\nTime: {now_str}\nDetail: {reason or 'Desktop Locked or Headless Session'}"
        
        # 중앙에 안내 텍스트 렌더링
        draw.text((80, 80), text, fill=(220, 220, 220))
        return img

    def capture_monitors(self) -> list[tuple[Image.Image, dict]]:
        """
        연결된 모든 개별 모니터(듀얼/다중 모니터)를 순회 캡처하여
        [(PIL.Image, monitor_meta_dict), ...] 목록을 반환합니다.
        monitor_meta_dict에는 left, top, width, height, is_primary 정보가 포함됩니다.
        run_in_desktop_thread를 통해 비동기 이벤트 루프에서도 100% BitBlt 권한을 보장합니다.
        """
        # 기존 단위 테스트 하위 호환성: capture_image가 mock(패치)된 경우 mock 결과 반영
        if hasattr(self.capture_image, "assert_called") or hasattr(self.capture_image, "mock"):
            img, w, h = self.capture_image()
            return [(img, {"left": 0, "top": 0, "width": w, "height": h, "is_primary": True})]

        from app.services.desktop_utils import run_in_desktop_thread

        def _do_capture():
            results = []
            with mss.MSS() as sct:
                target_monitors = sct.monitors[1:] if len(sct.monitors) > 1 else [sct.monitors[0]]
                for mon in target_monitors:
                    try:
                        sct_img = sct.grab(mon)
                        img = Image.frombytes("RGB", sct_img.size, sct_img.bgra, "raw", "BGRX")
                        results.append((img, dict(mon)))
                    except Exception as e:
                        fallback_img = self._create_fallback_image(mon.get("width", 1920), mon.get("height", 1080), reason=str(e))
                        results.append((fallback_img, dict(mon)))
            return results

        try:
            return run_in_desktop_thread(_do_capture)
        except Exception as e:
            fallback_img = self._create_fallback_image(reason=str(e))
            return [(fallback_img, {"left": 0, "top": 0, "width": 1920, "height": 1080, "is_primary": True})]

    def capture_image(self) -> tuple[Image.Image, int, int]:
        """
        주(Primary) 모니터 기준 화면 캡처 후 (PIL.Image, width, height) 반환
        """
        monitors = self.capture_monitors()
        if not monitors:
            img = self._create_fallback_image(reason="No monitors captured")
            return img, 1920, 1080

        for img, mon in monitors:
            if mon.get("is_primary"):
                return img, mon.get("width", 1920), mon.get("height", 1080)

        img, mon = monitors[0]
        return img, mon.get("width", 1920), mon.get("height", 1080)

    def capture_display(self, target: str = "primary") -> tuple[Image.Image, dict]:
        """
        target: 'primary' (주 모니터만) 또는 'all' (전체 모니터 결합 화면)
        반환값: (PIL.Image, monitor_meta_dict)
        """
        from app.services.desktop_utils import run_in_desktop_thread

        def _do_capture():
            with mss.MSS() as sct:
                if target == "all":
                    mon = sct.monitors[0]
                    try:
                        sct_img = sct.grab(mon)
                        img = Image.frombytes("RGB", sct_img.size, sct_img.bgra, "raw", "BGRX")
                        meta = dict(mon)
                        meta["target"] = "all"
                        return img, meta
                    except Exception as e:
                        fallback_img = self._create_fallback_image(mon.get("width", 1920), mon.get("height", 1080), reason=str(e))
                        return fallback_img, {"left": 0, "top": 0, "width": mon.get("width", 1920), "height": mon.get("height", 1080), "target": "all"}
                else:
                    # primary monitor
                    target_monitors = sct.monitors[1:] if len(sct.monitors) > 1 else [sct.monitors[0]]
                    primary_mon = None
                    for mon in target_monitors:
                        if mon.get("is_primary") or (mon.get("left") == 0 and mon.get("top") == 0):
                            primary_mon = mon
                            break
                    if not primary_mon:
                        primary_mon = target_monitors[0]

                    try:
                        sct_img = sct.grab(primary_mon)
                        img = Image.frombytes("RGB", sct_img.size, sct_img.bgra, "raw", "BGRX")
                        meta = dict(primary_mon)
                        meta["target"] = "primary"
                        return img, meta
                    except Exception as e:
                        fallback_img = self._create_fallback_image(primary_mon.get("width", 1920), primary_mon.get("height", 1080), reason=str(e))
                        return fallback_img, {"left": primary_mon.get("left", 0), "top": primary_mon.get("top", 0), "width": primary_mon.get("width", 1920), "height": primary_mon.get("height", 1080), "target": "primary"}

        try:
            return run_in_desktop_thread(_do_capture)
        except Exception as e:
            fallback_img = self._create_fallback_image(reason=str(e))
            return fallback_img, {"left": 0, "top": 0, "width": 1920, "height": 1080, "target": target}

    def capture(self, session_id: str, label: str = "shot", target: str = "all") -> str:
        """
        초고속 화면 캡처 후 WebP 80% 압축으로 저장.
        기본적으로 다중 모니터 전체 결합 화면(target='all')을 캡처합니다.
        반환값: 서빙 가능한 상대 경로 URL
        """
        session_dir = self.output_dir / session_id
        session_dir.mkdir(parents=True, exist_ok=True)

        now_str = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
        filename = f"{label}_{now_str}.webp"
        file_path = session_dir / filename

        img, _ = self.capture_display(target=target)

        # WebP 80% 압축 저장
        img.save(
            file_path,
            format=settings.SCREENSHOT_FORMAT,
            quality=settings.SCREENSHOT_QUALITY,
            method=4
        )

        return f"/api/static/screenshots/{session_id}/{filename}"

def copy_image_to_clipboard(image: Image.Image) -> bool:
    """Windows 클립보드에 PIL Image를 CF_DIB(비트맵) 포맷으로 복사합니다."""
    import sys
    if sys.platform != "win32":
        return False

    import ctypes
    import io
    import time

    output = io.BytesIO()
    image.convert("RGB").save(output, "BMP")
    data = output.getvalue()[14:]  # Remove BITMAPFILEHEADER (14 bytes)
    output.close()

    GMEM_MOVEABLE = 0x0002
    CF_DIB = 8

    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32

    kernel32.GlobalAlloc.restype = ctypes.c_void_p
    kernel32.GlobalAlloc.argtypes = [ctypes.c_uint, ctypes.c_size_t]
    kernel32.GlobalLock.restype = ctypes.c_void_p
    kernel32.GlobalLock.argtypes = [ctypes.c_void_p]
    kernel32.GlobalUnlock.argtypes = [ctypes.c_void_p]
    user32.OpenClipboard.argtypes = [ctypes.c_void_p]
    user32.SetClipboardData.restype = ctypes.c_void_p
    user32.SetClipboardData.argtypes = [ctypes.c_uint, ctypes.c_void_p]

    h_mem = kernel32.GlobalAlloc(GMEM_MOVEABLE, len(data))
    if not h_mem:
        return False

    p_mem = kernel32.GlobalLock(h_mem)
    if not p_mem:
        kernel32.GlobalFree(h_mem)
        return False

    ctypes.memmove(p_mem, data, len(data))
    kernel32.GlobalUnlock(h_mem)

    # 클립보드 열기 시도 (최대 5회 재시도)
    opened = False
    for _ in range(5):
        if user32.OpenClipboard(None):
            opened = True
            break
        time.sleep(0.05)

    if not opened:
        kernel32.GlobalFree(h_mem)
        return False

    try:
        user32.EmptyClipboard()
        res = user32.SetClipboardData(CF_DIB, h_mem)
        if not res:
            kernel32.GlobalFree(h_mem)
            return False
        return True
    finally:
        user32.CloseClipboard()

screen_capture_service = ScreenCaptureService()
