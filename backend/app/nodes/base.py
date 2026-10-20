from abc import ABC, abstractmethod
import json
import re
from typing import Dict, Any, Optional, Callable, Awaitable, Set, List
from pydantic import BaseModel

# 시스템 내장 읽기 전용 예약 변수 목록
SYSTEM_VARIABLE_NAMES: Set[str] = {
    "last_output",
    "timestamp",
    "date",
    "time",
    "scroll_at_start",
    "scroll_at_end",
}

VALID_VARIABLE_NAME_RE = re.compile(r"^[a-zA-Z_\uAC00-\uD7A3][a-zA-Z0-9_\uAC00-\uD7A3]*$")


def coerce_variable_value(value: Any, var_type: str = "string") -> Any:
    """
    프론트엔드(TypeScript/JSON)와 백엔드(Python) 간 이종 언어 변수 타입 불일치를 방지하기 위해
    지정된 변수 타입(string | number | boolean | json)으로 안전하게 변환 및 검증합니다.
    """
    normalized_type = (var_type or "string").strip().lower()

    if normalized_type == "string":
        if value is None:
            return ""
        if isinstance(value, bool):
            return "true" if value else "false"
        if isinstance(value, (dict, list)):
            return json.dumps(value, ensure_ascii=False)
        if isinstance(value, float) and value.is_integer():
            return str(int(value))
        return str(value)

    elif normalized_type == "number":
        if isinstance(value, bool):
            return 1 if value else 0
        if isinstance(value, int):
            return value
        if isinstance(value, float):
            return int(value) if value.is_integer() else value
        if isinstance(value, str):
            s = value.strip()
            if s == "":
                return 0
            try:
                if "." in s or "e" in s.lower():
                    f_val = float(s)
                    return int(f_val) if f_val.is_integer() else f_val
                return int(s)
            except ValueError:
                raise ValueError(f"변수 값을 숫자(number) 타입으로 변환할 수 없습니다: '{value}'")
        raise ValueError(f"변수 값을 숫자(number) 타입으로 변환할 수 없습니다: '{value}'")

    elif normalized_type == "boolean":
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return bool(value)
        if isinstance(value, str):
            s = value.strip().lower()
            if s in ("true", "1", "yes", "y", "예", "on"):
                return True
            if s in ("false", "0", "no", "n", "아니오", "off", ""):
                return False
            raise ValueError(f"변수 값을 논리형(boolean) 타입으로 변환할 수 없습니다: '{value}'")
        raise ValueError(f"변수 값을 논리형(boolean) 타입으로 변환할 수 없습니다: '{value}'")

    elif normalized_type == "json":
        if value is None:
            return {}
        if isinstance(value, (dict, list)):
            return value
        if isinstance(value, str):
            s = value.strip()
            if s == "":
                return {}
            try:
                return json.loads(s)
            except Exception as e:
                raise ValueError(f"변수 값을 유효한 JSON으로 파싱할 수 없습니다: '{value}' ({e})")
        if isinstance(value, (int, float, bool)):
            return value
        raise ValueError(f"변수 값을 JSON 타입으로 변환할 수 없습니다: '{value}'")

    # 알 수 없는 타입인 경우 문자열로 안전하게 폴백
    return str(value) if value is not None else ""


def format_variable_for_template(value: Any) -> str:
    """
    템플릿 문자열({{var}}) 치환 시 Python 고유 표현(True/False, None, dict repr 등)으로 인한
    언어 간 표현 차이를 없애고 표준 문자열로 일관되게 직렬화합니다.
    """
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (dict, list)):
        try:
            return json.dumps(value, ensure_ascii=False)
        except Exception:
            return str(value)
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


class NodeResult(BaseModel):
    success: bool
    output: Any = None
    error: Optional[str] = None
    screenshot_url: Optional[str] = None


class ExecutionContext:
    session_id: str = ""
    variable_schemas: Dict[str, Dict[str, Any]] = {}
    strict_variables: bool = False
    flow_settings: Dict[str, Any] = {}
    variables: Dict[str, Any] = {}
    call_stack: List[str] = []
    call_stack_names: List[str] = []
    max_call_depth: int = 5
    step_counter: Dict[str, int] = {}
    max_total_steps: int = 500

    def __init__(
        self,
        session_id: str,
        event_callback: Callable[[Dict[str, Any]], Awaitable[None]],
        check_cancelled: Callable[[], bool],
        variables: Optional[Dict[str, Any]] = None,
        variable_schemas: Optional[Dict[str, Dict[str, Any]]] = None,
        strict_variables: bool = False,
        flow_settings: Optional[Dict[str, Any]] = None,
        call_stack: Optional[List[str]] = None,
        call_stack_names: Optional[List[str]] = None,
        max_call_depth: int = 5,
        step_counter: Optional[Dict[str, int]] = None,
        max_total_steps: int = 500,
    ):
        self.session_id = session_id
        self.event_callback = event_callback
        self.check_cancelled = check_cancelled
        self.variable_schemas: Dict[str, Dict[str, Any]] = variable_schemas or {}
        self.strict_variables: bool = strict_variables
        self.flow_settings: Dict[str, Any] = flow_settings or {}
        self.variables: Dict[str, Any] = {}
        self.call_stack: List[str] = list(call_stack) if call_stack is not None else []
        self.call_stack_names: List[str] = list(call_stack_names) if call_stack_names is not None else []
        self.max_call_depth: int = max_call_depth
        self.step_counter: Dict[str, int] = step_counter if step_counter is not None else {"count": 0}
        self.max_total_steps: int = max_total_steps

        # 1. 선언된 변수 스키마가 있으면 기본값(defaultValue)을 타입 정규화하여 초기화
        for var_name, schema in self.variable_schemas.items():
            var_type = schema.get("type", "string")
            default_val = schema.get("defaultValue", "")
            self.variables[var_name] = coerce_variable_value(default_val, var_type)

        # 2. 초기 전달된 런타임 변수 병합
        if variables:
            for k, v in variables.items():
                if k in self.variable_schemas:
                    self.variables[k] = coerce_variable_value(v, self.variable_schemas[k].get("type", "string"))
                else:
                    self.variables[k] = v

    def increment_and_check_step_limit(self) -> None:
        """세션 전체(서브 워크플로우 포함) 누적 실행 스텝 수를 증가시키고 한계 초과 시 예외를 발생시킵니다."""
        self.step_counter["count"] = self.step_counter.get("count", 0) + 1
        if self.step_counter["count"] > self.max_total_steps:
            raise RuntimeError(
                f"세션당 최대 누적 노드 실행 횟수({self.max_total_steps}회)를 초과하여 안전을 위해 실행을 강제 중단했습니다. "
                f"(과도한 서브 워크플로우 연쇄 호출 또는 반복 실행 감지)"
            )

    def is_cancelled(self) -> bool:
        return self.check_cancelled()

    def set_variable(self, name: str, value: Any, is_system: bool = False) -> Any:
        """
        노드 실행 결과 등을 컨텍스트 변수에 저장합니다.
        - is_system=True: 시스템 예약 변수(last_output 등) 직접 갱신
        - strict_variables=True: 선언되지 않은 변수나 시스템 예약 변수 덮어쓰기 차단 및 선언된 타입으로 강제 변환
        """
        clean_name = (name or "").strip()
        if not clean_name:
            raise ValueError("출력 변수 이름이 지정되지 않았습니다.")

        if is_system:
            self.variables[clean_name] = value
            return value

        if clean_name in SYSTEM_VARIABLE_NAMES and self.strict_variables:
            raise ValueError(
                f"시스템 예약 변수('{clean_name}')에는 출력값을 저장할 수 없습니다. "
                f"워크플로우 변수 관리 패널에서 선언한 변수를 선택해 주세요."
            )

        if self.strict_variables and clean_name not in self.variable_schemas:
            raise ValueError(
                f"선언되지 않은 출력 변수 '{clean_name}'입니다. "
                f"하단 '워크플로우 변수 관리' 패널에서 변수를 먼저 선언해 주세요."
            )

        if clean_name in self.variable_schemas:
            target_type = self.variable_schemas[clean_name].get("type", "string")
            coerced_val = coerce_variable_value(value, target_type)
            self.variables[clean_name] = coerced_val
            return coerced_val

        self.variables[clean_name] = value
        return value

    def get_variable(self, name: str, default: Any = None) -> Any:
        clean_name = (name or "").strip()
        if self.strict_variables and clean_name not in self.variables and clean_name not in self.variable_schemas and clean_name not in SYSTEM_VARIABLE_NAMES:
            raise ValueError(f"선언되지 않은 변수 '{clean_name}'를 참조할 수 없습니다.")
        return self.variables.get(clean_name, default)

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
        self.node_type = node_type  # GENERAL, AI, AGENT, MARKER
        self.config = config

    @abstractmethod
    async def run(self, context: ExecutionContext) -> NodeResult:
        """노드 실행 비즈니스 로직"""
        pass

