import base64
import io
import time
import uuid
from typing import Optional, Dict, Any
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from PIL import Image
import cv2
import numpy as np

from app.core.config import settings
from app.services.screen_capture import screen_capture_service
from app.services.uia_service import uia_service

router = APIRouter(prefix="/picker", tags=["Object Picker"])

class DetectElementRequest(BaseModel):
    x: int
    y: int

class CropElementRequest(BaseModel):
    x: int
    y: int
    width: int
    height: int
    name: Optional[str] = None

class ObjectPickerCaptureResponse(BaseModel):
    image_url: str
    base64_image: str
    width: int
    height: int

class ObjectDetectionResponse(BaseModel):
    x: int
    y: int
    width: int
    height: int

class ObjectCropResponse(BaseModel):
    object_id: str
    name: str
    x: int
    y: int
    width: int
    height: int
    image_url: str
    base64_image: str
    executable_path: Optional[str] = ""

@router.post("/capture", response_model=ObjectPickerCaptureResponse)
def capture_for_picker():
    """
    오브젝트 선택기를 위한 전체 화면 캡처.
    최신 화면 이미지를 storage/objects/latest_screen.webp에 저장하고 Base64로도 반환.
    """
    img, width, height = screen_capture_service.capture_image()
    
    # storage/objects/latest_screen.webp로 저장
    save_path = settings.OBJECTS_DIR / "latest_screen.webp"
    img.save(save_path, format="WEBP", quality=90)
    
    # Base64 인코딩
    buffer = io.BytesIO()
    img.save(buffer, format="WEBP", quality=90)
    b64_str = base64.b64encode(buffer.getvalue()).decode("utf-8")
    
    return ObjectPickerCaptureResponse(
        image_url="/api/static/objects/latest_screen.webp",
        base64_image=f"data:image/webp;base64,{b64_str}",
        width=width,
        height=height
    )

@router.post("/detect", response_model=ObjectDetectionResponse)
def detect_element_at_point(req: DetectElementRequest):
    """
    마우스 커서 좌표 (x, y) 아래에 있는 시각적 UI 컴포넌트 경계(Bounding Box)를 검출.
    OpenCV 컨투어 및 엣지 분석을 통해 클릭하기 적합한 버튼/입력창/카드 영역을 계산.
    """
    screen_path = settings.OBJECTS_DIR / "latest_screen.webp"
    if not screen_path.exists():
        # 화면 파일이 없으면 기본 박스 반환
        return ObjectDetectionResponse(
            x=max(0, req.x - 50),
            y=max(0, req.y - 20),
            width=100,
            height=40
        )

    try:
        # OpenCV 이미지 로드
        cv_img = cv2.imread(str(screen_path))
        if cv_img is None:
            raise ValueError("이미지 로드 실패")
            
        h, w = cv_img.shape[:2]
        gray = cv2.cvtColor(cv_img, cv2.COLOR_BGR2GRAY)
        
        # 가우시안 블러 및 Canny 엣지 검출
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        edges = cv2.Canny(blurred, 30, 120)
        
        # 팽창 연산으로 연결된 컴포넌트 선명화
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        dilated = cv2.dilate(edges, kernel, iterations=1)
        
        contours, _ = cv2.findContours(dilated, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
        
        target_x, target_y = req.x, req.y
        matched_boxes = []
        screen_area = w * h

        for cnt in contours:
            bx, by, bw, bh = cv2.boundingRect(cnt)
            area = bw * bh
            
            # 너무 작거나(노이즈) 화면 전체에 가까운 영역 제외
            if area < 200 or area > screen_area * 0.7:
                continue
            # 비율이 지나치게 기형적인(두께 1px 선 등) 제외
            if bw < 12 or bh < 12:
                continue
                
            # 마우스 커서가 바운딩 박스 내부 또는 근접 영역에 있는지 확인
            if bx <= target_x <= bx + bw and by <= target_y <= by + bh:
                matched_boxes.append((area, bx, by, bw, bh))

        if matched_boxes:
            # 마우스 커서를 포함하는 사각형 중 가장 면적이 작은(가장 구체적인 UI 엘리먼트) 선택
            matched_boxes.sort(key=lambda item: item[0])
            _, best_x, best_y, best_w, best_h = matched_boxes[0]
            
            # 약간의 패딩(2px) 추가
            pad = 2
            final_x = max(0, best_x - pad)
            final_y = max(0, best_y - pad)
            final_w = min(w - final_x, best_w + pad * 2)
            final_h = min(h - final_y, best_h + pad * 2)
            
            return ObjectDetectionResponse(
                x=final_x,
                y=final_y,
                width=final_w,
                height=final_h
            )
    except Exception as e:
        print(f"[Detect Element] 오류 발생, 기본 박스 대체: {e}")

    # 검출되지 않은 경우 마우스 커서 중심의 표준 버튼 크기 사각형 반환
    default_w = 90
    default_h = 36
    return ObjectDetectionResponse(
        x=max(0, req.x - default_w // 2),
        y=max(0, req.y - default_h // 2),
        width=default_w,
        height=default_h
    )

@router.post("/crop", response_model=ObjectCropResponse)
def crop_element(req: CropElementRequest):
    """
    선택된 영역의 이미지를 정밀 크롭하여 PNG 파일로 영구 저장하고 Base64로 반환.
    """
    screen_path = settings.OBJECTS_DIR / "latest_screen.webp"
    if not screen_path.exists():
        raise HTTPException(status_code=400, detail="캡처된 화면이 없습니다. 먼저 화면을 캡처하세요.")

    try:
        pil_img = Image.open(screen_path)
        img_w, img_h = pil_img.size

        # 좌표 클램핑
        x1 = max(0, min(req.x, img_w - 1))
        y1 = max(0, min(req.y, img_h - 1))
        x2 = max(x1 + 8, min(req.x + req.width, img_w))
        y2 = max(y1 + 8, min(req.y + req.height, img_h))

        cropped = pil_img.crop((x1, y1, x2, y2))
        crop_w = x2 - x1
        crop_h = y2 - y1

        # 고유 오브젝트 ID 및 파일명 생성
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        rand_id = uuid.uuid4().hex[:6]
        obj_id = f"obj_{timestamp}_{rand_id}"
        filename = f"{obj_id}.png"
        file_path = settings.OBJECTS_DIR / filename

        # PNG 무손실 저장
        cropped.save(file_path, format="PNG")

        # Base64 인코딩
        buffer = io.BytesIO()
        cropped.save(buffer, format="PNG")
        b64_str = base64.b64encode(buffer.getvalue()).decode("utf-8")

        obj_name = req.name.strip() if req.name and req.name.strip() else f"오브젝트_{x1}_{y1}"

        executable_path = ""
        try:
            center_x = x1 + crop_w // 2
            center_y = y1 + crop_h // 2
            elem_info = uia_service.get_element_at_point(center_x, center_y)
            if elem_info:
                executable_path = elem_info.get("executable_path", "")
        except Exception:
            pass

        return ObjectCropResponse(
            object_id=obj_id,
            name=obj_name,
            x=x1,
            y=y1,
            width=crop_w,
            height=crop_h,
            image_url=f"/api/static/objects/{filename}",
            base64_image=f"data:image/png;base64,{b64_str}",
            executable_path=executable_path
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"이미지 크롭 중 오류 발생: {str(e)}")

# ==================== Windows UIA (UI Automation) 실시간 엔드포인트 ====================

class UIADetectRequest(BaseModel):
    x: int
    y: int

class UIADetectResponse(BaseModel):
    found: bool
    element: Optional[Dict[str, Any]] = None

class UIACaptureRequest(BaseModel):
    x: int
    y: int
    width: int
    height: int
    name: Optional[str] = None
    executable_path: Optional[str] = None

@router.post("/uia-detect", response_model=UIADetectResponse)
def detect_uia_element(req: UIADetectRequest):
    """
    현재 마우스 절대 좌표 (x, y) 아래의 실제 Visible Windows UIA 컨트롤 감지.
    허공이나 오프스크린 컨트롤인 경우 found=False 반환.
    """
    print(f"[UIA-API] /uia-detect requested: x={req.x}, y={req.y}")
    elem_info = uia_service.get_element_at_point(req.x, req.y)
    print(f"[UIA-API] -> result: {elem_info}")
    if elem_info:
        return UIADetectResponse(found=True, element=elem_info)
    return UIADetectResponse(found=False, element=None)

@router.post("/uia-capture", response_model=ObjectCropResponse)
def capture_uia_element(req: UIACaptureRequest):
    """
    Windows UIA 물리 좌표 (x, y, w, h)를 1:1 무손실 크롭 캡처하여 저장 및 반환.
    """
    res = uia_service.capture_rect(req.x, req.y, req.width, req.height, req.name, req.executable_path)
    if not res:
        raise HTTPException(status_code=500, detail="UIA 오브젝트 크롭 캡처 실패")
    return ObjectCropResponse(**res)

# ==================== 전역 UIA 마우스 피커 워커 제어 API ====================

from app.services.uia_picker_worker import uia_picker_worker

@router.post("/start-worker")
def start_picker_worker():
    """전역 마우스 피커 워커 시작"""
    uia_picker_worker.start()
    return {"status": "started"}

@router.post("/stop-worker")
def stop_picker_worker():
    """전역 마우스 피커 워커 정지"""
    uia_picker_worker.stop()
    return {"status": "stopped"}

@router.post("/reselect-worker")
def reselect_picker_worker():
    """피커 워커 다시 선택 모드로 전환"""
    uia_picker_worker.reselect()
    return {"status": "reselected"}


# ==================== Playwright 비주얼 웹 요소 선택기 (Web Picker) API ====================

from app.services.playwright_service import playwright_service

class WebPickerStartRequest(BaseModel):
    url: Optional[str] = None
    browser_channel: Optional[str] = "chrome"
    use_persistent_profile: bool = True

@router.post("/web-start")
async def start_web_element_picker(req: WebPickerStartRequest):
    """
    Playwright 브라우저에서 시각적 웹 요소 선택기(Web Picker)를 시작합니다.
    열려 있는 브라우저가 없거나 빈 탭인 경우 전달된 URL로 자동 이동한 뒤 선택 오버레이를 주입합니다.
    """
    try:
        res = await playwright_service.start_web_picker(
            url=req.url,
            browser_channel=req.browser_channel or "chrome",
            use_persistent_profile=req.use_persistent_profile,
        )
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"웹 요소 선택기 시작 실패: {str(e)}")

@router.get("/web-status")
async def get_web_element_picker_status():
    """현재 진행 중인 웹 요소 선택기의 상태('picking' | 'picked' | 'cancelled' | 'idle')와 선택 결과를 조회합니다."""
    return playwright_service.get_web_picker_status()

@router.post("/web-cancel")
async def cancel_web_element_picker():
    """진행 중인 웹 요소 선택기를 취소하고 브라우저 내 오버레이를 제거합니다."""
    return await playwright_service.cancel_web_picker()

