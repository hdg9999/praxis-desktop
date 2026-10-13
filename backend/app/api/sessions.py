import shutil
from typing import List
from fastapi import APIRouter, HTTPException, Depends
from sqlmodel import Session, select
from app.core.database import get_session
from app.core.config import settings
from app.models.session import ExecutionSession
from app.models.message import ExecutionMessage

router = APIRouter(prefix="/sessions", tags=["Sessions"])

@router.get("", response_model=List[ExecutionSession])
def get_sessions(db: Session = Depends(get_session)):
    """전체 실행 세션 목록 반환 (최신순)"""
    sessions = db.exec(
        select(ExecutionSession).order_by(ExecutionSession.started_at.desc())
    ).all()
    return sessions

@router.get("/{session_id}", response_model=ExecutionSession)
def get_session_detail(session_id: str, db: Session = Depends(get_session)):
    session_item = db.get(ExecutionSession, session_id)
    if not session_item:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다.")
    return session_item

@router.get("/{session_id}/messages", response_model=List[ExecutionMessage])
def get_session_messages(session_id: str, db: Session = Depends(get_session)):
    """특정 세션의 채팅방 메시지 이력 반환 (시간순)"""
    messages = db.exec(
        select(ExecutionMessage)
        .where(ExecutionMessage.session_id == session_id)
        .order_by(ExecutionMessage.created_at.asc())
    ).all()
    return messages

@router.delete("/{session_id}")
def delete_session(session_id: str, db: Session = Depends(get_session)):
    session_item = db.get(ExecutionSession, session_id)
    if not session_item:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다.")

    # 메시지 레코드 삭제
    messages = db.exec(
        select(ExecutionMessage).where(ExecutionMessage.session_id == session_id)
    ).all()
    for m in messages:
        db.delete(m)

    # 세션 레코드 삭제
    db.delete(session_item)
    db.commit()

    # 스크린샷 폴더 정리
    session_dir = settings.SCREENSHOTS_DIR / session_id
    if session_dir.exists():
        shutil.rmtree(session_dir, ignore_errors=True)

    return {"success": True, "deleted_session_id": session_id}
