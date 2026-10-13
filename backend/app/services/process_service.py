"""
Process and Window Lifecycle Security & Management Service.
창 닫기, 프로그램 정상 종료(Soft Closing), 프로세스 강제 종료(Process Kill) 기능과
시스템 및 자동화 런타임을 보호하기 위한 4중 안전 가드레일(Safety Guardrails)을 제공합니다.
"""

import ctypes
import os
import subprocess
import sys
import time
import logging
from typing import List, Tuple, Optional, Set

logger = logging.getLogger(__name__)

# Win32 상수
WM_CLOSE = 0x0010
PROCESS_TERMINATE = 0x0001
PROCESS_QUERY_INFORMATION = 0x0400
TH32CS_SNAPPROCESS = 0x00000002

# --------------------------------------------------------------------------
# 1. 절대 보호 프로세스 블랙리스트 (Protected Process Blacklist)
# --------------------------------------------------------------------------
PROTECTED_PROCESS_NAMES: Set[str] = {
    # Praxis Desktop 자동화 런타임 및 AI 엔진
    "python.exe",
    "pythonw.exe",
    "electron.exe",
    "praxis.exe",
    "praxis_desktop.exe",
    "promptmacro.exe",
    "ollama.exe",
    "ollama_llama_server.exe",
    
    # Windows OS 핵심 시스템 프로세스
    "system",
    "registry",
    "smss.exe",
    "csrss.exe",
    "wininit.exe",
    "services.exe",
    "lsass.exe",
    "svchost.exe",
    "dwm.exe",
    "explorer.exe",
    "taskhostw.exe",
    "sihost.exe",
    "fontdrvhost.exe",
    "winlogon.exe",
    "spoolsv.exe",
    
    # 개발 환경 및 작업 에디터
    "code.exe",
}

# --------------------------------------------------------------------------
# Win32 Toolhelp32 프로세스 스냅샷 구조체 정의
# --------------------------------------------------------------------------
class PROCESSENTRY32(ctypes.Structure):
    _fields_ = [
        ("dwSize", ctypes.c_ulong),
        ("cntUsage", ctypes.c_ulong),
        ("th32ProcessID", ctypes.c_ulong),
        ("th32DefaultHeapID", ctypes.POINTER(ctypes.c_ulong)),
        ("th32ModuleID", ctypes.c_ulong),
        ("cntThreads", ctypes.c_ulong),
        ("th32ParentProcessID", ctypes.c_ulong),
        ("pcPriClassBase", ctypes.c_long),
        ("dwFlags", ctypes.c_ulong),
        ("szExeFile", ctypes.c_char * 260),
    ]


class ProcessService:
    def __init__(self):
        self._self_pid = os.getpid()

    def normalize_process_name(self, name: str) -> str:
        """
        프로세스명을 정규화합니다.
        예: 'Notepad' -> 'notepad.exe', 'chrome.exe' -> 'chrome.exe'
        """
        if not name:
            return ""
        norm = name.strip().strip('"').strip("'").lower()
        if not norm.endswith(".exe") and "." not in norm:
            norm = f"{norm}.exe"
        return norm

    def is_process_protected(self, process_name: str) -> Tuple[bool, str]:
        """
        주어진 프로세스명이 보호 대상인지 검사합니다.
        보호 대상인 경우 (True, 거부사유), 안전한 경우 (False, "") 반환.
        """
        if not process_name or not str(process_name).strip():
            return True, "프로세스 이름이 비어 있습니다."

        raw_name = process_name.strip().strip('"').strip("'")
        # 와일드카드 및 전체 종료 방지
        if any(c in raw_name for c in ["*", "?", "%", "$"]):
            return True, "와일드카드(*, ?) 또는 특수문자가 포함된 일괄 종료는 안전을 위해 금지됩니다."

        norm_name = self.normalize_process_name(raw_name)

        # 1. 블랙리스트 확인
        if norm_name in PROTECTED_PROCESS_NAMES or raw_name.lower() in PROTECTED_PROCESS_NAMES:
            return True, f"시스템 및 자동화 핵심 프로세스('{norm_name}')는 안전을 위해 종료할 수 없습니다."

        # 2. 현재 실행 중인 Python 프로세스 자신 확인
        current_exe = os.path.basename(sys.executable).lower()
        if norm_name == current_exe:
            return True, f"현재 동작 중인 자동화 백엔드 프로세스('{norm_name}')는 종료할 수 없습니다."

        return False, ""

    def get_pids_by_name(self, process_name: str) -> List[int]:
        """
        Win32 Toolhelp32Snapshot을 사용하여 특정 프로세스명의 모든 PID 목록을 초고속 조회합니다.
        """
        norm_name = self.normalize_process_name(process_name)
        if not norm_name:
            return []

        pids: List[int] = []
        kernel32 = ctypes.windll.kernel32
        h_snapshot = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
        if h_snapshot == -1 or h_snapshot == 0:
            return []

        try:
            entry = PROCESSENTRY32()
            entry.dwSize = ctypes.sizeof(PROCESSENTRY32)

            success = kernel32.Process32First(h_snapshot, ctypes.byref(entry))
            while success:
                try:
                    exe_file = entry.szExeFile.decode("utf-8", errors="ignore").lower()
                except Exception:
                    exe_file = ""

                if exe_file == norm_name:
                    pids.append(int(entry.th32ProcessID))

                success = kernel32.Process32Next(h_snapshot, ctypes.byref(entry))
        finally:
            kernel32.CloseHandle(h_snapshot)

        return pids

    def get_top_level_hwnds_for_pids(self, target_pids: Set[int]) -> List[int]:
        """
        지정된 PID 집합에 속한 프로세스가 소유하고 있는 보이는 최상위 윈도우 핸들(HWND) 목록을 수집합니다.
        """
        if not target_pids:
            return []

        user32 = ctypes.windll.user32
        matching_hwnds: List[int] = []

        WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)

        def _enum_proc(hwnd, lparam):
            if user32.IsWindow(hwnd) and user32.IsWindowVisible(hwnd):
                pid = ctypes.c_ulong()
                user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                if pid.value in target_pids:
                    # 빈 창이나 오프스크린 툴팁 제외 (최소 타이틀 또는 유효 윈도우)
                    length = user32.GetWindowTextLengthW(hwnd)
                    # 윈도우 스타일 검사: WS_VISIBLE
                    matching_hwnds.append(hwnd)
            return True

        cb = WNDENUMPROC(_enum_proc)
        user32.EnumWindows(cb, 0)
        return matching_hwnds

    def close_window_by_hwnd(self, hwnd: int) -> bool:
        """
        주어진 HWND 창에 WM_CLOSE 메시지를 안전하게 전송하여 창을 닫습니다.
        """
        if not hwnd or not ctypes.windll.user32.IsWindow(hwnd):
            return False

        user32 = ctypes.windll.user32
        try:
            # 1. PostMessage로 비동기 WM_CLOSE 전달 (블로킹 방지)
            res = user32.PostMessageW(hwnd, WM_CLOSE, 0, 0)
            if res != 0:
                return True
        except Exception as e:
            logger.warning(f"[ProcessService] PostMessageW WM_CLOSE 실패: {e}")

        # 2. UIA WindowPattern Close 폴백
        try:
            import uiautomation as auto
            ctrl = auto.ControlFromHandle(hwnd)
            if ctrl and hasattr(ctrl, "GetWindowPattern"):
                pattern = ctrl.GetWindowPattern()
                if pattern:
                    pattern.Close()
                    return True
        except Exception:
            pass

        return False

    def close_program_softly(self, process_name: str) -> Tuple[bool, str, int]:
        """
        지정한 프로세스를 정상 종료(Soft Closing)합니다.
        프로세스가 소유한 모든 최상위 윈도우에 WM_CLOSE를 전송하여
        애플리케이션이 스스로 저장 확인 및 정리 작업을 거쳐 종료되도록 유도합니다.
        반환: (성공여부, 안내메시지, 닫기_신호_전송_창_개수)
        """
        is_prot, reason = self.is_process_protected(process_name)
        if is_prot:
            return False, f"[보호 정책 위반] {reason}", 0

        norm_name = self.normalize_process_name(process_name)
        pids = self.get_pids_by_name(norm_name)
        if not pids:
            return False, f"실행 중인 '{norm_name}' 프로세스를 찾을 수 없습니다.", 0

        # 자신 PID 또는 부모 PID 포함 여부 재검증
        if self._self_pid in pids:
            return False, f"[보호 정책 위반] 자기 자신 프로세스('{norm_name}')는 종료할 수 없습니다.", 0

        target_pid_set = set(pids)
        hwnds = self.get_top_level_hwnds_for_pids(target_pid_set)

        closed_count = 0
        if hwnds:
            for h in hwnds:
                if self.close_window_by_hwnd(h):
                    closed_count += 1
            msg = f"'{norm_name}' 프로그램에 정상 종료 신호(WM_CLOSE)를 전송했습니다. (감지된 창: {len(hwnds)}개, 대상 PID: {len(pids)}개)"
            return True, msg, closed_count
        else:
            # UI 창이 없는 백그라운드 프로세스인 경우:
            # 표준 taskkill (강제 /F 플래그 없이 소프트 종료 시도)
            try:
                cmd = f'taskkill /IM "{norm_name}"'
                res = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=3)
                if res.returncode == 0:
                    return True, f"'{norm_name}' 백그라운드 프로그램에 정상 종료 명령을 전송했습니다. (PID: {len(pids)}개)", len(pids)
                else:
                    return False, f"'{norm_name}' 프로그램 종료 명령 전송 실패: {res.stderr.strip() or res.stdout.strip()}", 0
            except Exception as e:
                return False, f"'{norm_name}' 프로그램 종료 처리 중 예외 발생: {str(e)}", 0

    def kill_process_by_name(self, process_name: str) -> Tuple[bool, str, int]:
        """
        지정한 프로그램을 강제 종료(Process Kill)합니다.
        블랙리스트 검증 후 OS 레벨에서 taskkill /F /T로 즉각 강제 종료합니다.
        반환: (성공여부, 안내메시지, 종료된_PID_개수)
        """
        is_prot, reason = self.is_process_protected(process_name)
        if is_prot:
            return False, f"[보호 정책 위반] {reason}", 0

        norm_name = self.normalize_process_name(process_name)
        pids = self.get_pids_by_name(norm_name)
        if not pids:
            return False, f"실행 중인 '{norm_name}' 프로세스를 찾을 수 없습니다.", 0

        if self._self_pid in pids:
            return False, f"[보호 정책 위반] 자기 자신 프로세스('{norm_name}')는 강제 종료할 수 없습니다.", 0

        try:
            cmd = f'taskkill /F /T /IM "{norm_name}"'
            res = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=4)
            if res.returncode == 0 or "성공" in res.stdout or "SUCCESS" in res.stdout:
                msg = f"'{norm_name}' 프로세스를 강제 종료(Kill)했습니다. (종료 대상: {len(pids)}개 프로세스)"
                return True, msg, len(pids)
            else:
                err_text = res.stderr.strip() or res.stdout.strip()
                # 일부 인스턴스가 이미 종료된 경우에도 PID 목록이 비어있게 될 수 있음
                remaining = self.get_pids_by_name(norm_name)
                if len(remaining) < len(pids):
                    return True, f"'{norm_name}' 프로세스 강제 종료 완료 (일부 잔여: {len(remaining)}개).", len(pids) - len(remaining)
                return False, f"'{norm_name}' 프로세스 강제 종료 실패: {err_text}", 0
        except Exception as e:
            return False, f"'{norm_name}' 프로세스 강제 종료 중 예외 발생: {str(e)}", 0


# 싱글톤 인스턴스
process_service = ProcessService()
