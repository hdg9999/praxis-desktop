import pytest
import numpy as np
from PIL import Image, ImageDraw
from unittest.mock import patch

from app.services.screen_capture import screen_capture_service
from app.nodes.general import find_image_on_screen
import cv2

def test_screen_capture_monitors_structure():
    """다중 모니터 capture_monitors() 반환 구조 및 메타데이터 필드 검증"""
    monitors_data = screen_capture_service.capture_monitors()
    assert isinstance(monitors_data, list)
    assert len(monitors_data) >= 1

    for img, mon_meta in monitors_data:
        assert isinstance(img, Image.Image)
        assert "left" in mon_meta
        assert "top" in mon_meta
        assert "width" in mon_meta
        assert "height" in mon_meta

def test_find_image_on_screen_multimon_offset():
    """보조 모니터(left=1920, top=100)에 템플릿 이미지가 있을 때 전역 오프셋 정상 가산 검증"""
    # 패턴 있는 30x30 템플릿
    tpl = Image.new("RGB", (30, 30), color=(240, 240, 240))
    draw = ImageDraw.Draw(tpl)
    draw.rectangle((5, 5, 25, 25), fill=(0, 200, 0))
    draw.line((0, 0, 30, 30), fill=(200, 0, 0))

    tpl_cv = cv2.cvtColor(np.array(tpl), cv2.COLOR_RGB2BGR)

    # 모니터 1: 빈 배경 (left=0, top=0)
    screen1 = Image.new("RGB", (600, 600), color=(10, 10, 10))
    mon1_meta = {"left": 0, "top": 0, "width": 600, "height": 600, "is_primary": True}

    # 모니터 2: 템플릿 포함 화면 (left=1920, top=100), 템플릿 삽입 위치 (100, 150)
    screen2 = Image.new("RGB", (600, 600), color=(10, 10, 10))
    screen2.paste(tpl, (100, 150))
    mon2_meta = {"left": 1920, "top": 100, "width": 600, "height": 600, "is_primary": False}

    mock_monitors = [(screen1, mon1_meta), (screen2, mon2_meta)]

    with patch.object(screen_capture_service, "capture_monitors", return_value=mock_monitors):
        res = find_image_on_screen(tpl_cv, confidence=0.8)
        assert res is not None
        cx, cy, score = res
        # 전역 좌표: left(1920) + 100 + 15 = 2035, top(100) + 150 + 15 = 265
        assert cx == 2035
        assert cy == 265
        assert score >= 0.99
