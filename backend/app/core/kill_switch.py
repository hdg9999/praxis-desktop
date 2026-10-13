import threading
from typing import Callable, List
from pynput import keyboard
from app.core.config import settings

class KillSwitch:
    def __init__(self):
        self._cancelled = False
        self._callbacks: List[Callable[[], None]] = []
        self._listener = None
        self._lock = threading.Lock()

    def start_listener(self):
        if self._listener is not None:
            return

        def on_press(key):
            try:
                # F12 키 확인
                if key == keyboard.Key.f12:
                    self.trigger_cancel()
            except Exception:
                pass

        self._listener = keyboard.Listener(on_press=on_press)
        self._listener.daemon = True
        self._listener.start()

    def trigger_cancel(self):
        with self._lock:
            if not self._cancelled:
                self._cancelled = True
                print("[비상 정지] 전역 비상 정지 핫키(F12)가 작동하여 실행을 강제 중단합니다!")
                for cb in self._callbacks:
                    try:
                        cb()
                    except Exception:
                        pass

    def is_cancelled(self) -> bool:
        with self._lock:
            return self._cancelled

    def reset(self):
        with self._lock:
            self._cancelled = False

    def register_callback(self, cb: Callable[[], None]):
        self._callbacks.append(cb)

kill_switch = KillSwitch()
