import ctypes
import threading

try:
    import uiautomation as auto
    import comtypes
    UIA_AVAILABLE = True
except Exception:
    auto = None
    comtypes = None
    UIA_AVAILABLE = False

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
    신규 독립 스레드에서 default 데스크톱 바인딩 및 UIA/GDI 캡처를 안전하게 실행.
    """
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
