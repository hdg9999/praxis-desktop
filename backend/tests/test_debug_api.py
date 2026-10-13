import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

def test_debug_page_serving():
    """/debug 엔드포인트가 HTML 디버그 페이지를 정상 서빙하는지 검증"""
    response = client.get("/debug")
    assert response.status_code == 200
    assert "text/html" in response.headers.get("content-type", "")
    assert "에이전트 스킬 & UI 인식 정밀 진단기" in response.text

def test_debug_list_tools():
    """/api/debug/tools 엔드포인트가 사용 가능한 도구 목록을 반환하는지 검증"""
    response = client.get("/api/debug/tools")
    assert response.status_code == 200
    data = response.json()
    assert "tools" in data
    tool_keys = [t["key"] for t in data["tools"]]
    assert "mouse_click" in tool_keys
    assert "get_screen_elements" in tool_keys

def test_debug_list_models():
    """/api/debug/models 엔드포인트가 모델 목록을 정상 반환하는지 검증"""
    with patch("app.services.ollama_client.ollama_client.check_health", new_callable=AsyncMock) as mock_health, \
         patch("app.services.ollama_client.ollama_client.get_models", new_callable=AsyncMock) as mock_models:
        mock_health.return_value = True
        mock_models.return_value = ["qwen3.8:27b", "llama3.1:latest"]

        response = client.get("/api/debug/models")
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "qwen3.8:27b" in data["models"]
        assert "llama3.1:latest" in data["models"]

def test_debug_list_windows():
    """/api/debug/windows 엔드포인트가 윈도우 목록 응답을 정상 생성하는지 검증"""
    response = client.get("/api/debug/windows")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "windows" in data

def test_debug_scan_window():
    """/api/debug/scan 엔드포인트가 UI 스캔 및 가짜 스크린샷 결과를 안전하게 반환하는지 검증"""
    with patch("app.services.uia_service.uia_service.scan_active_window_elements") as mock_scan:
        mock_scan.return_value = {
            "window_title": "테스트 창",
            "hwnd": 12345,
            "window_rect": {"left": 0, "top": 0, "right": 800, "bottom": 600, "width": 800, "height": 600},
            "elements": [
                {
                    "id": 1,
                    "name": "네이버 증권",
                    "type_name": "링크",
                    "control_type": "HyperlinkControl",
                    "x": 300,
                    "y": 150,
                    "left": 280,
                    "top": 140,
                    "right": 320,
                    "bottom": 160,
                    "width": 40,
                    "height": 20,
                    "is_primary": True
                }
            ],
            "formatted_text": "[대상 창: 테스트 창]\n  #1 [링크] \"네이버 증권\" -> 좌표 (X: 300, Y: 150)",
            "total_count": 100,
            "offset": 10,
            "limit": 10,
            "has_more": True,
            "next_offset": 20,
            "prev_offset": 0,
            "current_page": 2,
            "total_pages": 10
        }

        response = client.post("/api/debug/scan", json={"hwnd": 12345, "offset": 10, "limit": 10})
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["window_title"] == "테스트 창"
        assert len(data["elements"]) == 1
        assert data["elements"][0]["name"] == "네이버 증권"
        assert data["total_count"] == 100
        assert data["offset"] == 10
        assert data["has_more"] is True
        assert data["current_page"] == 2

@pytest.mark.asyncio
async def test_debug_simulate_tool_call():
    """/api/debug/simulate-tool-call이 모델의 도구 호출을 시뮬레이션하고 진단하는지 검증"""
    mock_chat_response = {
        "content": "네이버 증권 메뉴를 클릭하겠습니다.",
        "tool_calls": [
            {
                "function": {
                    "name": "mouse_click",
                    "arguments": {"x": 300, "y": 150, "button": "left"}
                }
            }
        ]
    }

    with patch("app.services.ollama_client.ollama_client.chat", new_callable=AsyncMock) as mock_chat:
        mock_chat.return_value = mock_chat_response

        response = client.post("/api/debug/simulate-tool-call", json={
            "model": "qwen3.8:27b",
            "prompt": "네이버 증권 메뉴를 클릭해줘",
            "elements_text": "[대상 창: 네이버]\n  #1 [링크] \"네이버 증권\" -> 좌표 (X: 300, Y: 150)",
            "preset": "basic_interaction"
        })

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert len(data["tool_calls"]) == 1
        assert data["tool_calls"][0]["function"]["name"] == "mouse_click"
        assert data["diagnosis"]["status"] == "SUCCESS"
        assert "mouse_click" in data["diagnosis"]["summary"]
