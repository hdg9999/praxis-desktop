import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Check, RotateCcw, Crosshair, Move, Sparkles } from 'lucide-react';
import { UIObjectData } from '../../types';
import { captureForPicker, detectElementAtPoint, cropElement, resolveImageUrl } from '../../services/api';
import { useI18n } from '../../i18n';

interface ObjectPickerOverlayProps {
  isOpen: boolean;
  onConfirm: (objectData: UIObjectData) => void;
  onCancel: () => void;
}

interface HighlightBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const ObjectPickerOverlay: React.FC<ObjectPickerOverlayProps> = ({
  isOpen,
  onConfirm,
  onCancel,
}) => {
  const { t, language } = useI18n();
  const isEn = language === 'en';
  const [screenImage, setScreenImage] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number }>({ width: 1920, height: 1080 });
  const [highlightBox, setHighlightBox] = useState<HighlightBox | null>(null);
  const [isLocked, setIsLocked] = useState<boolean>(false);
  const [isLoadingCapture, setIsLoadingCapture] = useState<boolean>(false);
  const [isCropping, setIsCropping] = useState<boolean>(false);
  const [selectedObject, setSelectedObject] = useState<UIObjectData | null>(null);
  const [objectName, setObjectName] = useState<string>('');

  // 플로팅 소형 창 드래그 위치 상태
  const [panelPos, setPanelPos] = useState<{ x: number; y: number }>({ x: window.innerWidth - 380, y: 40 });
  const isDraggingPanel = useRef(false);
  const dragOffset = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const imgRef = useRef<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const detectTimerRef = useRef<any>(null);

  // 화면 캡처 및 초기화
  const initializePicker = useCallback(async () => {
    setIsLoadingCapture(true);
    setIsLocked(false);
    setHighlightBox(null);
    setSelectedObject(null);

    try {
      // Electron인 경우 메인 윈도우 최소화 호출
      if (window.electronAPI?.minimizeMainWindow) {
        await window.electronAPI.minimizeMainWindow();
        // 최소화 애니메이션 대기
        await new Promise((resolve) => setTimeout(resolve, 350));
      }

      const res = await captureForPicker();
      setScreenImage(res.base64_image || resolveImageUrl(res.image_url) || null);
      setNaturalSize({ width: res.width, height: res.height });
    } catch (err) {
      console.error('오브젝트 선택기 화면 캡처 실패:', err);
      alert('화면 캡처에 실패했습니다. 백엔드 상태를 확인해주세요.');
      handleCancel();
    } finally {
      setIsLoadingCapture(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      initializePicker();
      setPanelPos({ x: Math.max(20, window.innerWidth - 380), y: 40 });
    } else {
      setScreenImage(null);
      setIsLocked(false);
      setHighlightBox(null);
      setSelectedObject(null);
    }
  }, [isOpen, initializePicker]);

  // ESC 키로 닫기
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        handleCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // 마우스 커서 위치 -> 이미지 실제 해상도 좌표 변환
  const getScreenCoordinates = useCallback((e: React.MouseEvent) => {
    if (!imgRef.current) {
      return {
        screenX: Math.round(e.clientX),
        screenY: Math.round(e.clientY),
        clientX: e.clientX,
        clientY: e.clientY,
        scaleX: 1,
        scaleY: 1,
      };
    }

    const rect = imgRef.current.getBoundingClientRect();
    const scaleX = naturalSize.width / (rect.width || 1);
    const scaleY = naturalSize.height / (rect.height || 1);

    const screenX = Math.round((e.clientX - rect.left) * scaleX);
    const screenY = Math.round((e.clientY - rect.top) * scaleY);

    return {
      screenX: Math.max(0, Math.min(screenX, naturalSize.width)),
      screenY: Math.max(0, Math.min(screenY, naturalSize.height)),
      clientX: e.clientX,
      clientY: e.clientY,
      scaleX,
      scaleY,
      rect,
    };
  }, [naturalSize]);

  // 마우스 이동 시 스마트 하이라이트 (노란색)
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isLocked || isLoadingCapture || isDraggingPanel.current) return;

    const coords = getScreenCoordinates(e);
    if (!coords) return;

    // 즉시 기본 박스 표시 (반응성 극대화)
    const baseW = 100;
    const baseH = 36;
    const instantBox: HighlightBox = {
      x: Math.max(0, coords.screenX - baseW / 2),
      y: Math.max(0, coords.screenY - baseH / 2),
      width: baseW,
      height: baseH,
    };
    setHighlightBox(instantBox);

    // 디바운스로 백엔드 정밀 엣지/윤곽선 감지
    if (detectTimerRef.current) clearTimeout(detectTimerRef.current);
    detectTimerRef.current = setTimeout(async () => {
      try {
        const detected = await detectElementAtPoint(coords.screenX, coords.screenY);
        if (!isLocked) {
          setHighlightBox(detected);
        }
      } catch (err) {
        // 에러 시 기존 박스 유지
      }
    }, 60);
  }, [isLocked, isLoadingCapture, getScreenCoordinates]);

  // 마우스 클릭 시 빨간색 고정 & 크롭 수행
  const handleCanvasClick = async (e: React.MouseEvent) => {
    // 소형 패널 내부 클릭 무시
    if ((e.target as HTMLElement).closest('.picker-control-panel')) return;
    if (isLocked || !highlightBox) return;

    setIsLocked(true);
    setIsCropping(true);

    try {
      const defaultName = `UI_오브젝트_${highlightBox.x}_${highlightBox.y}`;
      setObjectName(defaultName);

      const cropped = await cropElement({
        x: highlightBox.x,
        y: highlightBox.y,
        width: highlightBox.width,
        height: highlightBox.height,
        name: defaultName,
      });

      setSelectedObject({
        ...cropped,
        confidence: 0.8,
      });
    } catch (err) {
      console.error('크롭 실패:', err);
      alert('오브젝트 이미지 생성 중 오류가 발생했습니다.');
      setIsLocked(false);
    } finally {
      setIsCropping(false);
    }
  };

  // 다시 선택 (빨간색 고정 해제 -> 노란색 탐색 모드로 복귀)
  const handleReselect = () => {
    setIsLocked(false);
    setSelectedObject(null);
  };

  // 확인 클릭 시 메인 윈도우 원상복구 및 데이터 전달
  const handleConfirm = async () => {
    if (!selectedObject) return;

    const finalObjectData: UIObjectData = {
      ...selectedObject,
      name: objectName.trim() || selectedObject.name,
      confidence: selectedObject.confidence ?? 0.8,
    };

    if (window.electronAPI?.restoreMainWindow) {
      await window.electronAPI.restoreMainWindow();
    }

    onConfirm(finalObjectData);
  };

  // 취소 클릭 시 닫기 및 메인 윈도우 복원
  const handleCancel = async () => {
    if (window.electronAPI?.restoreMainWindow) {
      await window.electronAPI.restoreMainWindow();
    }
    onCancel();
  };

  // 플로팅 패널 드래그 핸들러
  const handlePanelMouseDown = (e: React.MouseEvent) => {
    isDraggingPanel.current = true;
    dragOffset.current = {
      x: e.clientX - panelPos.x,
      y: e.clientY - panelPos.y,
    };
  };

  const handleGlobalMouseMove = (e: React.MouseEvent) => {
    if (isDraggingPanel.current) {
      setPanelPos({
        x: Math.max(10, Math.min(window.innerWidth - 360, e.clientX - dragOffset.current.x)),
        y: Math.max(10, Math.min(window.innerHeight - 300, e.clientY - dragOffset.current.y)),
      });
    }
  };

  const handleGlobalMouseUp = () => {
    isDraggingPanel.current = false;
  };

  if (!isOpen) return null;

  // 화면 스케일 계산 (하이라이트 박스를 뷰포트 CSS 픽셀로 변환)
  const getRenderedBoxStyle = () => {
    if (!highlightBox || !imgRef.current) return null;

    const rect = imgRef.current.getBoundingClientRect();
    const scaleX = rect.width / naturalSize.width;
    const scaleY = rect.height / naturalSize.height;

    const left = rect.left + highlightBox.x * scaleX;
    const top = rect.top + highlightBox.y * scaleY;
    const width = Math.max(12, highlightBox.width * scaleX);
    const height = Math.max(12, highlightBox.height * scaleY);

    return {
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
    };
  };

  const boxStyle = getRenderedBoxStyle();

  return (
    <div
      ref={containerRef}
      onMouseMove={(e) => {
        handleGlobalMouseMove(e);
        handleMouseMove(e);
      }}
      onMouseUp={handleGlobalMouseUp}
      onClick={handleCanvasClick}
      className="fixed inset-0 z-[999999] select-none overflow-hidden cursor-crosshair bg-slate-950"
      style={{ userSelect: 'none' }}
    >
      {/* 배경 전체 화면 캡처 이미지 */}
      {screenImage ? (
        <img
          ref={imgRef}
          src={screenImage}
          alt="Screen Capture"
          className="w-full h-full object-contain pointer-events-none select-none block"
          draggable={false}
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center text-slate-300 gap-3">
          <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-medium">화면을 캡처하고 오브젝트 선택기를 준비 중입니다...</p>
        </div>
      )}

      {/* 하이라이트 사각형 (노란색: 탐색 호버 / 빨간색: 선택 고정) */}
      {boxStyle && (
        <div
          style={boxStyle}
          className={`absolute pointer-events-none transition-all duration-75 ${
            isLocked
              ? 'border-[3px] border-red-500 bg-red-500/20 shadow-[0_0_15px_rgba(239,68,68,0.5)] ring-2 ring-red-400/60'
              : 'border-[3px] border-yellow-400 bg-yellow-400/20 shadow-[0_0_12px_rgba(234,179,8,0.4)] ring-2 ring-yellow-400/50'
          }`}
        >
          {/* 사각형 코너 앵커 포인트 */}
          <div className={`absolute -top-1.5 -left-1.5 w-3 h-3 ${isLocked ? 'bg-red-500' : 'bg-yellow-400'} rounded-xs`} />
          <div className={`absolute -top-1.5 -right-1.5 w-3 h-3 ${isLocked ? 'bg-red-500' : 'bg-yellow-400'} rounded-xs`} />
          <div className={`absolute -bottom-1.5 -left-1.5 w-3 h-3 ${isLocked ? 'bg-red-500' : 'bg-yellow-400'} rounded-xs`} />
          <div className={`absolute -bottom-1.5 -right-1.5 w-3 h-3 ${isLocked ? 'bg-red-500' : 'bg-yellow-400'} rounded-xs`} />

          {/* 사각형 상단 배지 */}
          <div
            className={`absolute -top-7 left-0 px-2 py-0.5 text-[10px] font-bold rounded shadow flex items-center gap-1 whitespace-nowrap ${
              isLocked
                ? 'bg-red-600 text-white'
                : 'bg-yellow-400 text-slate-950 font-semibold'
            }`}
          >
            {isLocked ? '🔴 선택된 UI 오브젝트' : '🟡 UI 오브젝트 감지'}
            <span className="opacity-80">
              ({highlightBox?.width}x{highlightBox?.height})
            </span>
          </div>
        </div>
      )}

      {/* 우측 상단 플로팅 소형 창: '오브젝트 선택기' */}
      <div
        className="picker-control-panel absolute w-[360px] bg-slate-900/95 backdrop-blur-md border border-slate-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden transition-shadow"
        style={{
          left: `${panelPos.x}px`,
          top: `${panelPos.y}px`,
          zIndex: 1000000,
          cursor: 'default',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 드래그 가능한 타이틀 헤더 */}
        <div
          onMouseDown={handlePanelMouseDown}
          className="px-4 py-3 bg-slate-800/90 border-b border-slate-700/60 flex items-center justify-between cursor-move select-none"
        >
          <div className="flex items-center gap-2">
            <Crosshair className="w-4 h-4 text-blue-400" />
            <h3 className="text-xs font-bold text-slate-100 tracking-wide">
              {isEn ? 'Object Picker' : '오브젝트 선택기'}
            </h3>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-slate-400 flex items-center gap-1 mr-1">
              <Move className="w-3 h-3" /> {isEn ? 'Drag' : '드래그 이동'}
            </span>
            <button
              onClick={handleCancel}
              className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-700/60 transition-colors"
              title={isEn ? 'Close (ESC)' : '닫기 (ESC)'}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 본문 콘텐츠 */}
        <div className="p-4 space-y-3.5 text-xs">
          {/* 상태 배지 및 설명 */}
          <div>
            {!isLocked ? (
              <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-[11px]">
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  {isEn ? 'Scanning Objects' : '오브젝트 탐색 중'}
                </div>
                <p className="text-[11px] text-amber-200/80 leading-relaxed">
                  {isEn ? (
                    <>Hovering over UI objects detects them in a <strong className="text-amber-300">yellow box</strong>. Click to select.</>
                  ) : (
                    <>화면의 UI 오브젝트 위에 마우스를 올리면 <strong className="text-amber-300">노란색 사각형</strong>으로 감지됩니다. 클릭하면 오브젝트가 선택됩니다.</>
                  )}
                </p>
              </div>
            ) : (
              <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-[11px]">
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  {isEn ? 'Object Selected (Locked in Red)' : '오브젝트 선택 완료 (빨간색 고정)'}
                </div>
                <p className="text-[11px] text-red-200/80 leading-relaxed">
                  {isEn
                    ? 'UI object has been selected. Review the cropped image below and click [Confirm].'
                    : 'UI 오브젝트가 성공적으로 선택되었습니다. 아래 크롭 이미지를 확인하고 [확인]을 누르세요.'}
                </p>
              </div>
            )}
          </div>

          {/* 선택된 오브젝트 상세 정보 및 크롭 이미지 */}
          {isLocked && selectedObject && (
            <div className="space-y-3 pt-1">
              {/* 크롭된 이미지 미리보기 카드 */}
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1.5">
                  {isEn ? 'Selected Object Image (Cropped)' : '선택된 오브젝트 이미지 (크롭)'}
                </label>
                <div className="relative rounded-xl bg-slate-950 border border-slate-800 p-2 flex items-center justify-center min-h-[90px] max-h-[140px] overflow-hidden group">
                  {selectedObject.base64_image || selectedObject.image_url ? (
                    <img
                      src={selectedObject.base64_image || resolveImageUrl(selectedObject.image_url)}
                      alt="Cropped Object"
                      className="max-h-[120px] max-w-full object-contain rounded border border-slate-700/50 shadow"
                    />
                  ) : (
                    <div className="text-[11px] text-slate-500">{isEn ? 'Loading image...' : '이미지 로드 중...'}</div>
                  )}
                  <div className="absolute bottom-1 right-2 text-[10px] text-slate-400 bg-slate-900/80 px-1.5 py-0.5 rounded font-mono">
                    {selectedObject.width} × {selectedObject.height} px
                  </div>
                </div>
              </div>

              {/* 오브젝트 이름 입력 */}
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  {isEn ? 'Object Name (Alias)' : '오브젝트 이름 (별칭)'}
                </label>
                <input
                  type="text"
                  value={objectName}
                  onChange={(e) => setObjectName(e.target.value)}
                  placeholder={isEn ? 'e.g. Login Button, OK Button' : '예: 로그인 버튼, 확인 버튼'}
                  className="w-full px-3 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* 좌표 및 크기 정보 */}
              <div className="grid grid-cols-2 gap-2 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800 text-[11px]">
                <div className="text-slate-400">
                  {isEn ? 'Coordinates: ' : '위치 좌표: '}<span className="text-slate-200 font-mono font-medium">({selectedObject.x}, {selectedObject.y})</span>
                </div>
                <div className="text-slate-400">
                  {isEn ? 'Dimensions: ' : '영역 크기: '}<span className="text-slate-200 font-mono font-medium">{selectedObject.width} × {selectedObject.height}</span>
                </div>
                {selectedObject.executable_path && (
                  <div className="pt-1 border-t border-slate-800 text-[10px]">
                    <span className="text-amber-400 font-medium">{isEn ? 'Executable: ' : '실행 파일: '}</span>
                    <span className="text-amber-200 font-mono break-all">{selectedObject.executable_path}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {isCropping && (
            <div className="py-4 flex items-center justify-center gap-2 text-slate-400 text-xs">
              <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              {isEn ? 'Generating cropped object image...' : '오브젝트 이미지 크롭 생성 중...'}
            </div>
          )}
        </div>

        {/* 하단 액션 버튼 바 */}
        <div className="p-3 bg-slate-800/80 border-t border-slate-700/60 flex items-center justify-between gap-2">
          {isLocked ? (
            <>
              <button
                onClick={handleReselect}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-700/80 text-slate-200 hover:bg-slate-700 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5 text-slate-300" />
                {isEn ? 'Reselect' : '다시 선택'}
              </button>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleCancel}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-700/60 transition-colors"
                >
                  {isEn ? 'Cancel' : '취소'}
                </button>
                <button
                  onClick={handleConfirm}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-md shadow-blue-500/20 transition-all"
                >
                  <Check className="w-3.5 h-3.5" />
                  {isEn ? 'Confirm' : '확인'}
                </button>
              </div>
            </>
          ) : (
            <div className="w-full flex justify-end">
              <button
                onClick={handleCancel}
                className="px-4 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:bg-slate-700/80 transition-colors"
              >
                {isEn ? 'Cancel Selection (ESC)' : '선택 취소 (ESC)'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
