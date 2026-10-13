import pytest
from unittest.mock import patch, MagicMock
from app.nodes.general import GeneralNode
from app.nodes.base import ExecutionContext
from app.services.uia_service import uia_service

@pytest.fixture
def mock_context():
    events = []
    async def mock_callback(event):
        events.append(event)

    context = ExecutionContext(
        session_id="test_ses_window_nodes",
        event_callback=mock_callback,
        check_cancelled=lambda: False,
        variables={}
    )
    return context

@pytest.mark.asyncio
async def test_window_activate_not_found(mock_context):
    """존재하지 않는 창 제목으로 활성화 시도 시 실패 처리 검증"""
    node = GeneralNode(
        id="node_act_1",
        name="창 활성화 노드",
        subtype="window_activate",
        config={
            "target_mode": "title",
            "window_title": "NonExistentWindow_999999_xyz",
            "match_type": "exact"
        }
    )
    result = await node.run(mock_context)
    assert result.success is False
    assert "대상 윈도우를 찾지 못했습니다" in result.error

@pytest.mark.asyncio
async def test_window_activate_success(mock_context):
    """창 활성화 정상 수행 검증 (mocking uia_service)"""
    with patch.object(uia_service, "find_window_target", return_value=(12345, "테스트 창 - 메모장")) as mock_find, \
         patch.object(uia_service, "activate_window", return_value=True) as mock_act, \
         patch("app.services.screen_capture.screen_capture_service.capture", return_value="/api/static/screenshots/test.webp"):

        node = GeneralNode(
            id="node_act_2",
            name="메모장 활성화",
            subtype="window_activate",
            config={
                "target_mode": "title",
                "window_title": "메모장",
                "match_type": "contains"
            }
        )

        result = await node.run(mock_context)
        assert result.success is True
        assert "윈도우 활성화 성공" in result.output
        assert "테스트 창 - 메모장" in result.output
        mock_find.assert_called_once()
        mock_act.assert_called_once_with(12345)

@pytest.mark.asyncio
async def test_window_maximize_success(mock_context):
    """창 최대화 정상 수행 검증"""
    with patch.object(uia_service, "find_window_target", return_value=(23456, "Google Chrome")) as mock_find, \
         patch.object(uia_service, "maximize_window", return_value=True) as mock_max, \
         patch("app.services.screen_capture.screen_capture_service.capture", return_value="/api/static/screenshots/test.webp"):

        node = GeneralNode(
            id="node_max_1",
            name="브라우저 최대화",
            subtype="window_maximize",
            config={
                "target_mode": "current"
            }
        )

        result = await node.run(mock_context)
        assert result.success is True
        assert "윈도우 최대화 성공" in result.output
        assert "Google Chrome" in result.output
        mock_find.assert_called_once()
        mock_max.assert_called_once_with(23456)

@pytest.mark.asyncio
async def test_window_minimize_success(mock_context):
    """창 최소화 정상 수행 검증"""
    with patch.object(uia_service, "find_window_target", return_value=(34567, "계산기")) as mock_find, \
         patch.object(uia_service, "minimize_window", return_value=True) as mock_min, \
         patch("app.services.screen_capture.screen_capture_service.capture", return_value="/api/static/screenshots/test.webp"):

        node = GeneralNode(
            id="node_min_1",
            name="계산기 최소화",
            subtype="window_minimize",
            config={
                "target_mode": "object",
                "object_data": {
                    "name": "계산기 버튼",
                    "window_title": "계산기",
                    "control_type": "ButtonControl"
                }
            }
        )

        result = await node.run(mock_context)
        assert result.success is True
        assert "윈도우 최소화 성공" in result.output
        assert "계산기" in result.output
        mock_find.assert_called_once()
        mock_min.assert_called_once_with(34567)

@pytest.mark.asyncio
async def test_window_template_variable_title(mock_context):
    """컨텍스트 템플릿 변수가 창 제목에 정상 치환되는지 검증"""
    mock_context.variables["app_name"] = "메모장"

    with patch.object(uia_service, "find_window_target", return_value=(45678, "메모장")) as mock_find, \
         patch.object(uia_service, "activate_window", return_value=True) as mock_act, \
         patch("app.services.screen_capture.screen_capture_service.capture", return_value="/api/static/screenshots/test.webp"):

        node = GeneralNode(
            id="node_var_1",
            name="동적 창 활성화",
            subtype="window_activate",
            config={
                "target_mode": "title",
                "window_title": "{{app_name}}",
                "match_type": "contains"
            }
        )

        result = await node.run(mock_context)
        assert result.success is True
        # find_window_target의 window_title 파라미터가 '메모장'으로 치환되어 전달되었는지 확인
        mock_find.assert_called_once_with(
            target_mode="title",
            object_data=None,
            window_title="메모장",
            match_type="contains"
        )

@pytest.mark.asyncio
async def test_flow_engine_with_window_node():
    """FlowEngine을 통한 윈도우 노드 + 마우스 노드 DAG 순차 실행 테스트"""
    from app.core.engine import flow_engine
    from app.models.flow import Flow
    import json

    flow_data = {
        "nodes": [
            {
                "id": "node_win_act",
                "type": "general_window_activate",
                "position": {"x": 100, "y": 100},
                "data": {
                    "label": "브라우저 활성화",
                    "type": "general_window_activate",
                    "config": {
                        "target_mode": "title",
                        "window_title": "Chrome",
                        "match_type": "contains"
                    }
                }
            },
            {
                "id": "node_click",
                "type": "general_mouse_click",
                "position": {"x": 300, "y": 100},
                "data": {
                    "label": "화면 클릭",
                    "type": "general_mouse_click",
                    "config": {
                        "x": 200,
                        "y": 200,
                        "button": "left"
                    }
                }
            }
        ],
        "edges": [
            {
                "id": "e1",
                "source": "node_win_act",
                "target": "node_click"
            }
        ]
    }

    events = []
    async def mock_event_cb(evt):
        events.append(evt)

    with patch.object(uia_service, "find_window_target", return_value=(99999, "Google Chrome")), \
         patch.object(uia_service, "activate_window", return_value=True), \
         patch("pyautogui.click"), \
         patch("app.services.screen_capture.screen_capture_service.capture", return_value="/api/static/screenshots/test.webp"):

        import uuid
        session = await flow_engine.run_flow(
            flow_id="flow_test_window_pipeline",
            flow_name="윈도우 활성화 후 클릭 Flow",
            graph_data=flow_data,
            session_id=f"ses_test_win_{uuid.uuid4().hex[:8]}",
            event_callback=mock_event_cb
        )
        assert session.status == "SUCCESS"
        assert len(events) >= 4  # 시작, 성공 x 2 노드

