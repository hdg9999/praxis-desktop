import os
from pathlib import Path
from pydantic import BaseModel

class Settings(BaseModel):
    APP_NAME: str = "Praxis Desktop"
    API_PREFIX: str = "/api"
    
    # 디렉터리 경로
    BASE_DIR: Path = Path(__file__).resolve().parent.parent.parent
    STORAGE_DIR: Path = Path(__file__).resolve().parent.parent.parent / "storage"
    SCREENSHOTS_DIR: Path = Path(__file__).resolve().parent.parent.parent / "storage" / "screenshots"
    OBJECTS_DIR: Path = Path(__file__).resolve().parent.parent.parent / "storage" / "objects"
    DATABASE_URL: str = f"sqlite:///{(Path(__file__).resolve().parent.parent.parent / 'storage' / 'praxis.db').as_posix()}"
    
    # 스크린샷 최적화 기본 설정 (요구사항: WebP 80% 압축 기본 적용)
    SCREENSHOT_FORMAT: str = "WEBP"
    SCREENSHOT_QUALITY: int = 80
    CAPTURE_SCREEN_AFTER_EXECUTION: bool = True
    
    # 실행 이력 관리 (기본값: False, 필요 시 활성화)
    AUTO_CLEAN_SESSIONS: bool = False
    MAX_SESSION_HISTORY: int = 50
    
    # Ollama 설정
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    
    # 비상 정지 핫키 (전역 단축키)
    KILL_SWITCH_HOTKEY: str = "f12"

settings = Settings()

# 필요한 저장소 폴더 자동 생성
settings.STORAGE_DIR.mkdir(parents=True, exist_ok=True)
settings.SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
settings.OBJECTS_DIR.mkdir(parents=True, exist_ok=True)

# 레거시 데이터베이스 승계 (기존 데이터 보존)
legacy_db = settings.STORAGE_DIR / "promptmacro.db"
target_db = settings.STORAGE_DIR / "praxis.db"
if legacy_db.exists() and not target_db.exists():
    import shutil
    try:
        shutil.copy2(legacy_db, target_db)
    except Exception:
        pass
