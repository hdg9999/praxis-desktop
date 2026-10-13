from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.core.config import settings
from app.core.database import init_db
from app.core.kill_switch import kill_switch
from app.api.flows import router as flows_router
from app.api.sessions import router as sessions_router
from app.api.websocket import router as ws_router
from app.api.settings_api import router as settings_router
from app.api.picker_api import router as picker_router
from app.api.debug_api import router as debug_router, DEBUG_HTML_PATH
from fastapi.responses import FileResponse

import asyncio
from app.api.websocket import manager as ws_manager
from app.services.uia_picker_worker import uia_picker_worker

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 시작 시 DB 초기화 및 킬 스위치 리스너 구동
    init_db()
    kill_switch.start_listener()
    loop = asyncio.get_running_loop()
    uia_picker_worker.set_broadcaster(ws_manager.broadcast, loop)
    print("[Praxis Desktop 백엔드 엔진] 초기화 완료 및 준비됨 (포트 8000)")
    yield
    uia_picker_worker.stop()
    print("[Praxis Desktop 백엔드 엔진] 종료 완료")

app = FastAPI(
    title="Praxis Desktop Core Engine API",
    version="0.1.0",
    lifespan=lifespan
)

# CORS 설정 (Electron 및 Vite 로컬 프론트엔드 연동)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 스크린샷 정적 파일 서빙
app.mount(
    "/api/static/screenshots",
    StaticFiles(directory=str(settings.SCREENSHOTS_DIR)),
    name="screenshots"
)

# 오브젝트 템플릿 정적 파일 서빙
app.mount(
    "/api/static/objects",
    StaticFiles(directory=str(settings.OBJECTS_DIR)),
    name="objects"
)

# 라우터 등록
app.include_router(flows_router, prefix=settings.API_PREFIX)
app.include_router(sessions_router, prefix=settings.API_PREFIX)
app.include_router(ws_router, prefix=settings.API_PREFIX)
app.include_router(settings_router, prefix=settings.API_PREFIX)
app.include_router(picker_router, prefix=settings.API_PREFIX)
app.include_router(debug_router, prefix=settings.API_PREFIX)

@app.get("/health")
def health_check():
    return {"status": "ok", "app": settings.APP_NAME}

@app.get("/debug")
def serve_debug_page():
    """독립 에이전트 스킬 진단 디버거 HTML 웹 페이지 서빙"""
    if DEBUG_HTML_PATH.exists():
        return FileResponse(str(DEBUG_HTML_PATH), media_type="text/html")
    return {"error": "debug_agent.html not found"}

