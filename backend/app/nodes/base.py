from abc import ABC, abstractmethod
from typing import Dict, Any, Optional, Callable, Awaitable
from pydantic import BaseModel

class NodeResult(BaseModel):
    success: bool
    output: Any = None
    error: Optional[str] = None
    screenshot_url: Optional[str] = None

class ExecutionContext:
    def __init__(
        self,
        session_id: str,
        event_callback: Callable[[Dict[str, Any]], Awaitable[None]],
        check_cancelled: Callable[[], bool],
        variables: Optional[Dict[str, Any]] = None
    ):
        self.session_id = session_id
        self.event_callback = event_callback
        self.check_cancelled = check_cancelled
        self.variables: Dict[str, Any] = variables or {}

    def is_cancelled(self) -> bool:
        return self.check_cancelled()

    async def emit_event(
        self,
        node_id: str,
        node_name: str,
        node_type: str,
        event_type: str,
        content: str,
        image_path: Optional[str] = None
    ):
        await self.event_callback({
            "session_id": self.session_id,
            "node_id": node_id,
            "node_name": node_name,
            "node_type": node_type,
            "event_type": event_type,
            "content": content,
            "image_path": image_path
        })

class BaseNode(ABC):
    def __init__(self, id: str, name: str, node_type: str, config: Dict[str, Any]):
        self.id = id
        self.name = name
        self.node_type = node_type  # GENERAL, AI
        self.config = config

    @abstractmethod
    async def run(self, context: ExecutionContext) -> NodeResult:
        """노드 실행 비즈니스 로직"""
        pass
