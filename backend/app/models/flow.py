from datetime import datetime, timezone
from typing import Optional
from sqlmodel import SQLModel, Field

class Flow(SQLModel, table=True):
    __tablename__ = "flows"

    id: str = Field(primary_key=True)
    name: str = Field(index=True)
    description: Optional[str] = Field(default=None)
    graph_data: str = Field(description="JSON serialized nodes, edges and settings")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
