import os
import sys
import tempfile
from pathlib import Path

# backend 루트 디렉터리를 sys.path에 추가
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

# 테스트 실행 시 사용자의 실제 운영 DB(storage/praxis.db)가 오염되지 않도록
# app.core.database 모듈이 임포트되기 전에 임시 테스트 전용 SQLite DB로 격리
from app.core.config import settings

_test_db_dir = Path(tempfile.gettempdir()) / "praxis_pytest_db"
_test_db_dir.mkdir(parents=True, exist_ok=True)
_test_db_path = _test_db_dir / f"test_praxis_{os.getpid()}.db"
settings.DATABASE_URL = f"sqlite:///{_test_db_path.as_posix()}"

from app.models.flow import Flow  # noqa: F401, E402
from app.models.session import ExecutionSession  # noqa: F401, E402
from app.models.message import ExecutionMessage  # noqa: F401, E402
from app.core.database import init_db  # noqa: E402

init_db()


