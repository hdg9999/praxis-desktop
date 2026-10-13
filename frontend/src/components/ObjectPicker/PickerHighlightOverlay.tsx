import React, { useState, useEffect } from 'react';
import { connectWebSocket } from '../../services/api';

interface HighlightBox {
  name: string;
  control_type: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export const PickerHighlightOverlay: React.FC = () => {
  const [highlightBox, setHighlightBox] = useState<HighlightBox | null>(null);
  const [isLocked, setIsLocked] = useState<boolean>(false);
  const [isHidden, setIsHidden] = useState<boolean>(false);

  useEffect(() => {
    // 배경 투명화 보장
    const origHtmlBg = document.documentElement.style.backgroundColor;
    const origBodyBg = document.body.style.backgroundColor;
    document.documentElement.style.backgroundColor = 'transparent';
    document.body.style.backgroundColor = 'transparent';

    // ESC 키로 선택 취소
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (window.electronAPI?.cancelObjectPicker) {
          window.electronAPI.cancelObjectPicker();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    // Electron IPC 다시 선택 이벤트 리스너
    if (window.electronAPI?.onPickerResetHighlight) {
      window.electronAPI.onPickerResetHighlight(() => {
        setIsLocked(false);
        setIsHidden(false);
        setHighlightBox(null);
      });
    }

    // 백엔드 전역 UIA 마우스 피커 WebSocket 실시간 이벤트 구독
    const disconnectWs = connectWebSocket((event) => {
      if (!event || !event.type) return;

      if (event.type === 'picker_hide_overlay') {
        // 크롭 캡처 직전: 하이라이트 박스를 즉각 숨겨 순수 원본 화면만 캡처되도록 보장
        setIsHidden(true);
      } else if (event.type === 'picker_hover') {
        if (!isLocked) {
          setIsHidden(false);
          setHighlightBox(event.data || null);
        }
      } else if (event.type === 'picker_selected') {
        setIsLocked(true);
        setIsHidden(false);
        if (event.data) {
          setHighlightBox(event.data);
        }
      } else if (event.type === 'picker_reset') {
        setIsLocked(false);
        setIsHidden(false);
        setHighlightBox(null);
      }
    });

    return () => {
      document.documentElement.style.backgroundColor = origHtmlBg;
      document.body.style.backgroundColor = origBodyBg;
      window.removeEventListener('keydown', handleKeyDown);
      disconnectWs();
    };
  }, [isLocked]);

  // URL 파라미터에서 가상 화면 시작 오프셋 파싱
  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const offsetX = searchParams ? parseFloat(searchParams.get('offsetX') || '0') || 0 : 0;
  const offsetY = searchParams ? parseFloat(searchParams.get('offsetY') || '0') || 0 : 0;

  // 디스플레이 배율(DPI Scaling) 계산
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  const cssLeft = highlightBox ? (highlightBox.x - offsetX) / dpr : 0;
  const cssTop = highlightBox ? (highlightBox.y - offsetY) / dpr : 0;
  const cssWidth = highlightBox ? highlightBox.width / dpr : 0;
  const cssHeight = highlightBox ? highlightBox.height / dpr : 0;

  return (
    <div
      className="fixed inset-0 select-none overflow-hidden pointer-events-none bg-transparent"
      style={{
        width: '100vw',
        height: '100vh',
        backgroundColor: 'transparent',
      }}
    >
      {/* 하이라이트 사각형 (노란색: 실시간 탐색 중 / 빨간색: 클릭 선택 완료, 크롭 캡처 시 완전 은닉) */}
      {!isHidden && highlightBox && (
        <div
          style={{
            position: 'absolute',
            left: `${cssLeft}px`,
            top: `${cssTop}px`,
            width: `${cssWidth}px`,
            height: `${cssHeight}px`,
          }}
          className={`pointer-events-none transition-all duration-75 ${
            isLocked
              ? 'border-[3px] border-red-500 bg-red-500/20 shadow-[0_0_18px_rgba(239,68,68,0.8)] ring-2 ring-red-400/80'
              : 'border-[3px] border-yellow-400 bg-yellow-400/20 shadow-[0_0_14px_rgba(234,179,8,0.7)] ring-2 ring-yellow-400/60'
          }`}
        >
          {/* 코너 앵커 포인트 */}
          <div className={`absolute -top-1.5 -left-1.5 w-3 h-3 ${isLocked ? 'bg-red-500' : 'bg-yellow-400'} rounded-xs`} />
          <div className={`absolute -top-1.5 -right-1.5 w-3 h-3 ${isLocked ? 'bg-red-500' : 'bg-yellow-400'} rounded-xs`} />
          <div className={`absolute -bottom-1.5 -left-1.5 w-3 h-3 ${isLocked ? 'bg-red-500' : 'bg-yellow-400'} rounded-xs`} />
          <div className={`absolute -bottom-1.5 -right-1.5 w-3 h-3 ${isLocked ? 'bg-red-500' : 'bg-yellow-400'} rounded-xs`} />

          {/* 상단 레이블 태그 */}
          <div
            className={`absolute -top-7 left-0 px-2.5 py-0.5 text-[11px] font-bold rounded shadow-lg flex items-center gap-1.5 whitespace-nowrap z-50 ${
              isLocked
                ? 'bg-red-600 text-white'
                : 'bg-yellow-400 text-slate-950 font-semibold'
            }`}
          >
            <span>{isLocked ? '🔴 선택 완료' : '🟡 UIA 오브젝트'}</span>
            {highlightBox.control_type && (
              <span className="font-mono opacity-90">[{highlightBox.control_type}]</span>
            )}
            <span className="max-w-[160px] truncate">{highlightBox.name}</span>
            <span className="opacity-75 font-normal">
              ({highlightBox.width}×{highlightBox.height})
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
