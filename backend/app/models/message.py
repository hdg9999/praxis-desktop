from datetime import datetime, timezone
from typing import Optional
from sqlmodel import SQLModel, Field

class ExecutionMessage(SQLModel, table=True):
    __tablename__ = "execution_messages"

    id: str = Field(primary_key=True)  # msg_...
    session_id: str = Field(index=True)
    node_id: str
    node_name: str
    node_type: str = Field(index=True)  # GENERAL, AI
    event_type: str = Field(index=True)  # START, SUCCESS, ERROR, STREAM_CHUNK
    content: str
    image_path: Optional[str] = Field(default=None)  # relative web path or filename
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
