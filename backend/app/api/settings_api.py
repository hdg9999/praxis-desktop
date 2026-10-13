from typing import List, Optional
from fastapi import APIRouter
from pydantic import BaseModel
from app.core.config import settings
from app.services.ollama_client import ollama_client

router = APIRouter(prefix="/settings", tags=["Settings"])

class SettingsUpdate(BaseModel):
    auto_clean_sessions: Optional[bool] = None
    max_session_history: Optional[int] = None
    ollama_base_url: Optional[str] = None
    kill_switch_hotkey: Optional[str] = None
    capture_screen_after_execution: Optional[bool] = None

@router.get("")
def get_current_settings():
    return {
        "auto_clean_sessions": settings.AUTO_CLEAN_SESSIONS,
        "max_session_history": settings.MAX_SESSION_HISTORY,
        "ollama_base_url": settings.OLLAMA_BASE_URL,
        "kill_switch_hotkey": settings.KILL_SWITCH_HOTKEY,
        "screenshot_format": settings.SCREENSHOT_FORMAT,
        "screenshot_quality": settings.SCREENSHOT_QUALITY,
        "capture_screen_after_execution": settings.CAPTURE_SCREEN_AFTER_EXECUTION
    }

@router.post("")
def update_settings(data: SettingsUpdate):
    if data.auto_clean_sessions is not None:
        settings.AUTO_CLEAN_SESSIONS = data.auto_clean_sessions
    if data.max_session_history is not None:
        settings.MAX_SESSION_HISTORY = data.max_session_history
    if data.ollama_base_url is not None:
        settings.OLLAMA_BASE_URL = data.ollama_base_url
        ollama_client.base_url = data.ollama_base_url.rstrip("/")
    if data.kill_switch_hotkey is not None:
        settings.KILL_SWITCH_HOTKEY = data.kill_switch_hotkey
    if data.capture_screen_after_execution is not None:
        settings.CAPTURE_SCREEN_AFTER_EXECUTION = data.capture_screen_after_execution

    return get_current_settings()

@router.get("/ollama/info")
async def get_ollama_info():
    is_healthy = await ollama_client.check_health()
    models = await ollama_client.get_models() if is_healthy else []
    return {
        "connected": is_healthy,
        "base_url": settings.OLLAMA_BASE_URL,
        "models": models
    }
