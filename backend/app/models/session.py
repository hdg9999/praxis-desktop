from datetime import datetime, timezone
from typing import Optional
from sqlmodel import SQLModel, Field

class ExecutionSession(SQLModel, table=True):
    __tablename__ = "execution_sessions"

    id: str = Field(primary_key=True)  # e.g., ses_20261007_181500_abcd
    flow_id: str = Field(index=True)
    flow_name: str
    status: str = Field(default="RUNNING", index=True)  # RUNNING, SUCCESS, FAILED, CANCELLED
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    ended_at: Optional[datetime] = Field(default=None)
