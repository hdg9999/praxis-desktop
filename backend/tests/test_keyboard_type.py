import pytest
import asyncio
from unittest.mock import patch, MagicMock, call
from app.nodes.general import GeneralNode, decompose_hangul_to_keys
from app.nodes.base import ExecutionContext

def test_decompose_hangul_to_keys():
    # 1. '자동화' 초성/중성/종성 및 2벌식 키 분해 검증
    # ㅈ(w), ㅏ(k), ㄷ(e), ㅗ(h), ㅇ(d), ㅎ(g), ㅗ(h), ㅏ(k)
    res = decompose_hangul_to_keys("자동화")
    expected = [
        ('ㅈ', 'w'), ('ㅏ', 'k'), ('ㄷ', 'e'), ('ㅗ', 'h'),
        ('ㅇ', 'd'), ('ㅎ', 'g'), ('ㅗ', 'h'), ('ㅏ', 'k')
    ]
    assert res == expected

    # 2. 겹받침 '값' -> ㄱ(r), ㅏ(k), ㅂ(q), ㅅ(t)
    res_gap = decompose_hangul_to_keys("값")
    assert res_gap == [('ㄱ', 'r'), ('ㅏ', 'k'), ('ㅂ', 'q'), ('ㅅ', 't')]

    # 3. 이중모음 '왜' -> ㅇ(d), ㅗ(h), ㅐ(o)
    res_wae = decompose_hangul_to_keys("왜")
    assert res_wae == [('ㅇ', 'd'), ('ㅗ', 'h'), ('ㅐ', 'o')]

    # 4. 쌍자음 '꽃' -> ㄲ(R), ㅗ(h), ㅊ(c)
    res_flower = decompose_hangul_to_keys("꽃")
    assert res_flower == [('ㄲ', 'R'), ('ㅗ', 'h'), ('ㅊ', 'c')]

    # 5. 영문 및 숫자 'Hi 1'
    res_eng = decompose_hangul_to_keys("Hi 1")
    assert res_eng == [('H', None), ('i', None), (' ', None), ('1', None)]


@pytest.mark.asyncio
async def test_keyboard_type_instant_mode():
    events = []
    async def mock_callback(event):
        events.append(event)

    context = ExecutionContext(
        session_id="test_ses_type_instant",
        event_callback=mock_callback,
        check_cancelled=lambda: False,
        variables={"target": "세계"}
    )

    node = GeneralNode(
        id="type_instant",
        name="즉시 텍스트 입력",
        subtype="keyboard_type",
        config={
            "text": "안녕 {{target}}!",
            "type_mode": "instant"
        }
    )

    with patch("app.nodes.general.pyperclip.copy") as mock_copy, \
         patch("app.nodes.general.pyautogui.hotkey") as mock_hotkey, \
         patch("app.services.screen_capture.screen_capture_service.capture", return_value="/dummy.webp"):
        result = await node.run(context)
        assert result.success is True
        assert "Typed text (즉시 입력): 안녕 세계!" in result.output
        mock_copy.assert_called_once_with("안녕 세계!")
        mock_hotkey.assert_called_once_with("ctrl", "v")


@pytest.mark.asyncio
async def test_keyboard_type_smooth_mode_korean_decompose():
    events = []
    async def mock_callback(event):
        events.append(event)

    context = ExecutionContext(
        session_id="test_ses_type_smooth",
        event_callback=mock_callback,
        check_cancelled=lambda: False,
        variables={}
    )

    node = GeneralNode(
        id="type_smooth",
        name="천천히 입력 노드 (한글 자모 분해)",
        subtype="keyboard_type",
        config={
            "text": "자동화",
            "type_mode": "smooth",
            "interval": 0.01,
            "decompose_korean": True
        }
    )

    press_calls = []
    hotkey_calls = []

    def fake_press(key):
        press_calls.append(key)

    def fake_hotkey(*args):
        hotkey_calls.append(args)

    with patch("app.nodes.general.pyautogui.press", side_effect=fake_press), \
         patch("app.nodes.general.pyautogui.hotkey", side_effect=fake_hotkey), \
         patch("app.services.screen_capture.screen_capture_service.capture", return_value="/dummy.webp"):
        result = await node.run(context)
        assert result.success is True
        assert "천천히 입력" in result.output
        assert "한글 자모 순서 타이핑" in result.output
        # '자동화'의 8개 자모 순서대로 press 호출 확인: w, k, e, h, d, g, h, k
        assert press_calls == ['w', 'k', 'e', 'h', 'd', 'g', 'h', 'k']


@pytest.mark.asyncio
async def test_keyboard_type_smooth_mode_non_decompose():
    events = []
    async def mock_callback(event):
        events.append(event)

    context = ExecutionContext(
        session_id="test_ses_type_smooth_nodecomp",
        event_callback=mock_callback,
        check_cancelled=lambda: False,
        variables={}
    )

    node = GeneralNode(
        id="type_smooth_nodecomp",
        name="천천히 입력 노드 (비분해 모드)",
        subtype="keyboard_type",
        config={
            "text": "안녕",
            "type_mode": "smooth",
            "interval": 0.01,
            "decompose_korean": False
        }
    )

    copy_calls = []
    hotkey_calls = []

    def fake_copy(txt):
        copy_calls.append(txt)

    def fake_hotkey(*args):
        hotkey_calls.append(args)

    with patch("app.nodes.general.pyperclip.copy", side_effect=fake_copy), \
         patch("app.nodes.general.pyautogui.hotkey", side_effect=fake_hotkey), \
         patch("app.services.screen_capture.screen_capture_service.capture", return_value="/dummy.webp"):
        result = await node.run(context)
        assert result.success is True
        assert "천천히 입력" in result.output
        # 비분해 모드에서는 '안', '녕' 각 글자 단위로 클립보드 복사+붙여넣기
        assert copy_calls == ['안', '녕']
        assert hotkey_calls == [('ctrl', 'v'), ('ctrl', 'v')]


@pytest.mark.asyncio
async def test_keyboard_type_smooth_mode_cancellation():
    events = []
    async def mock_callback(event):
        events.append(event)

    # 3번째 글자 입력 후 취소 상태로 변경되는 mock
    counter = 0
    def check_cancelled():
        nonlocal counter
        return counter >= 3

    context = ExecutionContext(
        session_id="test_ses_type_cancel",
        event_callback=mock_callback,
        check_cancelled=check_cancelled,
        variables={}
    )

    node = GeneralNode(
        id="type_cancel",
        name="타이핑 중단 노드",
        subtype="keyboard_type",
        config={
            "text": "아주긴문장자동화테스트입니다",
            "type_mode": "smooth",
            "interval": 0.001,
            "decompose_korean": True
        }
    )

    def fake_press(key):
        nonlocal counter
        counter += 1

    with patch("app.nodes.general.pyautogui.press", side_effect=fake_press), \
         patch("app.services.screen_capture.screen_capture_service.capture", return_value="/dummy.webp"):
        result = await node.run(context)
        # 루프 도중 CancelledError가 발생하여 노드 에러/실패 처리됨
        assert result.success is False
        assert "오류 발생" in result.error or "중단되었습니다" in result.error
