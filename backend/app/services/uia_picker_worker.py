import asyncio
import threading
import time
import queue
from typing import Optional, Dict, Any
from pynput import mouse
from app.services.uia_service import uia_service, ensure_desktop_and_com

class UIAPickerWorker:
    def __init__(self):
        self._listener: Optional[mouse.Listener] = None
        self._worker_thread: Optional[threading.Thread] = None
        self._pos_event = threading.Event()
        self._click_queue = queue.Queue()
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._broadcast_func = None
        self._is_running = False
        self._is_locked = False
        self._pending_pos = None
        self._current_element: Optional[Dict[str, Any]] = None
        self._lock = threading.Lock()

    def set_broadcaster(self, broadcast_func, loop: asyncio.AbstractEventLoop):
        """WebSocket 브로드캐스트 함수 및 메인 asyncio 이벤트 루프 설정"""
        self._broadcast_func = broadcast_func
        self._loop = loop

    def _safe_broadcast(self, msg: Dict[str, Any]):
        """스레드 안전한 WebSocket 메시지 발행"""
        if self._broadcast_func and self._loop and self._loop.is_running():
            try:
                res = self._broadcast_func(msg)
                if asyncio.iscoroutine(res):
                    asyncio.run_coroutine_threadsafe(res, self._loop)
            except Exception as e:
                print(f"[PickerWorker] Broadcast error: {e}")

    def start(self):
        """피커 워커 및 전역 마우스 리스너 시작"""
        with self._lock:
            if self._is_running:
                self.reselect()
                return

            self._is_running = True
            self._is_locked = False
            self._current_element = None
            self._pending_pos = None
            while not self._click_queue.empty():
                try:
                    self._click_queue.get_nowait()
                except queue.Empty:
                    break
            self._pos_event.clear()

            print("[PickerWorker] 전역 UIA 마우스 피커 및 백그라운드 워커 시작됨")

            # 1. UIA 전담 백그라운드 쿼리 워커 스레드 시작
            self._worker_thread = threading.Thread(target=self._worker_loop, daemon=True)
            self._worker_thread.start()

            # 2. pynput 마우스 리스너 시작 (초경량 훅)
            self._listener = mouse.Listener(
                on_move=self._on_move,
                on_click=self._on_click
            )
            self._listener.daemon = True
            self._listener.start()

    def stop(self):
        """피커 워커 및 리스너 완전 중지"""
        with self._lock:
            self._is_running = False
            self._is_locked = False
            self._pos_event.set()

            if self._listener:
                try:
                    self._listener.stop()
                except Exception:
                    pass
                self._listener = None

            self._current_element = None
            self._pending_pos = None
            print("[PickerWorker] 전역 UIA 마우스 피커 중지됨")
            self._safe_broadcast({"type": "picker_reset"})

    def reselect(self):
        """선택 잠금 해제 및 다시 탐색 시작"""
        with self._lock:
            self._is_locked = False
            self._current_element = None
            self._pending_pos = None
            while not self._click_queue.empty():
                try:
                    self._click_queue.get_nowait()
                except queue.Empty:
                    break
            print("[PickerWorker] 오브젝트 다시 선택 모드로 전환")
            self._safe_broadcast({"type": "picker_reset"})

    def _on_move(self, x: int, y: int):
        """전역 마우스 이동 이벤트 핸들러 (지연 0ms의 초경량 훅)"""
        if not self._is_running or self._is_locked:
            return
        self._pending_pos = (int(x), int(y))
        self._pos_event.set()

    def _on_click(self, x: int, y: int, button, pressed: bool):
        """전역 마우스 클릭 이벤트 핸들러 (지연 0ms의 초경량 훅)"""
        if not self._is_running or self._is_locked:
            return
        if button == mouse.Button.left and pressed:
            self._click_queue.put((int(x), int(y)))
            self._pos_event.set()

    def _worker_loop(self):
        """UIA COM 및 스레드 데스크톱에 바인딩된 백그라운드 쿼리 전용 스레드"""
        ensure_desktop_and_com()
        last_detect_time = 0.0
        last_processed_pos = (-1, -1)

        while self._is_running:
            # 40ms 대기 또는 이벤트 트리거
            self._pos_event.wait(timeout=0.04)
            self._pos_event.clear()

            if not self._is_running:
                break

            # 1. 클릭 이벤트 우선 처리
            if not self._click_queue.empty():
                try:
                    cx, cy = self._click_queue.get_nowait()
                except queue.Empty:
                    cx, cy = None, None

                if cx is not None and not self._is_locked:
                    self._handle_click(cx, cy)
                    continue

            # 2. 호버 탐색 처리
            if self._is_locked:
                continue

            pos = self._pending_pos
            if not pos:
                continue

            now = time.time()
            if now - last_detect_time < 0.035:
                continue

            dx = abs(pos[0] - last_processed_pos[0])
            dy = abs(pos[1] - last_processed_pos[1])
            if dx < 3 and dy < 3:
                continue

            last_detect_time = now
            last_processed_pos = pos

            try:
                elem = uia_service.get_element_at_point(pos[0], pos[1])
                if elem:
                    prev = self._current_element
                    if (not prev or 
                        prev.get("x") != elem.get("x") or 
                        prev.get("y") != elem.get("y") or
                        prev.get("width") != elem.get("width") or
                        prev.get("height") != elem.get("height")):
                        self._current_element = elem
                        self._safe_broadcast({
                            "type": "picker_hover",
                            "data": elem
                        })
                else:
                    if self._current_element is not None:
                        self._current_element = None
                        self._safe_broadcast({
                            "type": "picker_hover",
                            "data": None
                        })
            except Exception as e:
                print(f"[PickerWorker] hover error: {e}")

    def _handle_click(self, x: int, y: int):
        print(f"[PickerWorker] 마우스 클릭 확정 처리 시작: ({x}, {y})")
        target_elem = self._current_element
        if not target_elem:
            target_elem = uia_service.get_element_at_point(x, y)

        if target_elem:
            self._is_locked = True
            print(f"[PickerWorker] 선택 완료: {target_elem.get('name')}")

            # 1. 크롭 직전: 프론트엔드에 하이라이트 오버레이 일시 숨김 브로드캐스트
            self._safe_broadcast({"type": "picker_hide_overlay"})
            # 2. DWM 화면 컴포지터 갱신 대기 (약 80ms)
            time.sleep(0.08)

            # 3. 하이라이트가 100% 제거된 깨끗한 화면에서 1:1 무손실 크롭 캡처 수행
            cropped = uia_service.capture_rect(
                x=target_elem["x"],
                y=target_elem["y"],
                width=target_elem["width"],
                height=target_elem["height"],
                name=target_elem["name"],
                executable_path=target_elem.get("executable_path", "")
            )

            payload = {
                **(cropped or {}),
                "name": target_elem["name"],
                "orig_name": target_elem.get("orig_name", target_elem["name"]),
                "control_type": target_elem.get("control_type", ""),
                "class_name": target_elem.get("class_name", ""),
                "automation_id": target_elem.get("automation_id", ""),
                "window_title": target_elem.get("window_title", ""),
                "process_id": target_elem.get("process_id", 0),
                "executable_path": target_elem.get("executable_path", ""),
                "x": target_elem["x"],
                "y": target_elem["y"],
                "width": target_elem["width"],
                "height": target_elem["height"],
                "confidence": 0.8
            }

            # 4. 크롭 완료 후 결과 데이터와 함께 선택 완료 이벤트 브로드캐스트 (선택 완료 빨간색 하이라이트 복원)
            self._safe_broadcast({
                "type": "picker_selected",
                "data": payload
            })

uia_picker_worker = UIAPickerWorker()
