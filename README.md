# Praxis Desktop (프락시스 데스크톱)

> **Praxis : Agentic Desktop Studio**  
> 사용자의 의도와 워크플로우를 실천(Praxis)으로 구현하는 하이브리드 로컬 에이전틱 자동화 스튜디오  
> 클래식 PC 제어(마우스/키보드/Windows UIA)와 로컬 LLM(Ollama ReAct) 지능의 유기적 결합

---

## 🏛️ 브랜드 철학 (Philosophy)

**Praxis(프락시스)**는 고대 그리스 철학에서 단순한 이론적 사유(Theoria)나 도구 제작(Poiesis)을 넘어선 **'자유롭고 지적인 존재가 목적을 가지고 행하는 능동적 실천(Action/Practice)'**을 의미합니다.

Praxis Desktop은 모든 것을 블랙박스 AI에 전적으로 위임하는 것이 아니라, **사용자가 설계한 의도와 작업 흐름(DAG Flow)을 바탕으로, 로컬 AI 에이전트(Ollama)와 OS 수준의 정밀 제어 엔진이 협력하여 데스크톱 환경에서 완벽한 실천을 달성**하도록 돕습니다.

---

## 🌟 주요 기능 (Key Features)

1. **Flow Builder (Left-to-Right 시각적 워크플로우 디자이너)**
   - `@xyflow/react` 기반의 직관적인 좌 $\to$ 우 DAG 노드 그래프 에디터
   - 좌측 스킬 패널: **클래식 RPA 노드**, **AI 노드(Ollama LLM)**, **ReAct 기본 에이전트 노드**
   - 우측 속성 설정(Inspector): 정밀 좌표, 텍스트 타이핑(한글 자모 분해 타이핑 지원), 스무스 마우스 이동, 윈도우/프로세스 제어, 프롬프트 템플릿 등 직관적 편집
   - `{{last_output}}` 및 변수 바인딩 시스템 지원

2. **정밀 인지 & 오브젝트 선택기 (Object Picker)**
   - Windows UI Automation (UIA) 및 Win32 심층 컨트롤 감지
   - 마우스 관통 투명 하이라이트 오버레이 & 1:1 크롭 템플릿 매칭 하이브리드 타겟팅
   - 독립 듀얼 윈도우 구조를 통한 안전한 화면 캡처 및 좌표 추출

3. **Agent Runner (채팅형 실행 타임라인 & 모니터링)**
   - Flow 실행 시마다 독립된 **채팅방 세션**이 자동 생성되어 노드 실행 흐름을 실시간 타임라인으로 기록
   - AI 토큰 실시간 WebSocket 스트리밍 및 ReAct 다단계(멀티턴) 추론/도구 호출 이력 시각화
   - 초고속 `mss` 기반 WebP 80% 압축 스크린샷 썸네일 & 원본 모달 뷰어(라이트박스)

4. **철저한 안전 장치 (Safety Guardrails)**
   - **4중 프로세스 안전 가드레일**: OS 핵심 시스템 및 Praxis Desktop 런타임 종료 원천 차단
   - **에이전트 노드 3중 검증 가드레일 (Circuit Breaker)**: 최대 루프(`max_steps`) 초과 시 엄격한 실패(`ERROR`) 처리, 도구 호출 누락 감지 및 자가 교정, 시스템 프롬프트 비의존 Ollama API `format`(JSON Schema) 기반 작업 완료/성공 구조화 검증으로 후속 노드 오작동 원천 차단
   - **비상 탈출 킬 스위치 (Kill-Switch)**: 전역 핫키 **`F12`** 감지 시 즉시 모든 백그라운드 스레드 및 제어 강제 중단
   - **로컬 퍼스트(Local-first) 아키텍처**: 외부 클라우드 통신 없는 100% 로컬 데이터 주권(SQLite + 로컬 Ollama)

---

## 🚀 빠른 시작 (Quick Start)

### 1. 데스크톱 앱 원클릭 실행 (권장)
프로젝트 루트에서 `run_electron.bat`을 실행합니다:
```bash
.\run_electron.bat
```
* 불필요한 콘솔 창 없이 **Praxis Desktop 메인 윈도우**만 단독 실행됩니다.
* 백엔드(Python FastAPI)는 백그라운드에서 자동 관리되며, 메인 창을 닫으면 백엔드까지 함께 안전하게 자동 종료됩니다.

> [!NOTE] **최초 실행 시 안내 (Initial Setup)**
> * 신규 다운로드 환경에서 처음 실행할 때 필요한 Python 가상환경(`.venv`), 백엔드/프론트엔드 의존성 패키지, Electron 실행 바이너리 및 빌드 번들이 **자동으로 다운로드 및 초기 구성**됩니다 (PC 및 네트워크 환경에 따라 약 1~2분의 준비 시간이 소요될 수 있습니다).
> * 패키지 설치 완료 직후 간혹 첫 번째 실행에서 메인 윈도우 창이 바로 뜨지 않는 경우가 있을 수 있습니다. 모든 필수 환경이 디스크에 이미 준비 완료된 상태이므로, **`run_electron.bat`을 한 번 더 실행**해 주시면 0.3초 만에 메인 윈도우가 즉시 정상 구동됩니다.

### 2. 웹 브라우저 대시보드 모드 실행
브라우저(`localhost:5173`) 환경에서 이용하고자 할 경우 `run_app.bat`을 실행합니다:
```bash
.\run_app.bat
```
* 웹 대시보드: `http://localhost:5173`
* 백엔드 API 문서: `http://localhost:8000/docs`

### 3. 개별 서비스 수동 실행

#### (1) 백엔드 실행
```bash
cd backend
.\.venv\Scripts\activate
python run.py
```

#### (2) 프론트엔드 실행
```bash
cd frontend
npm run dev
# 또는 데스크톱 Electron 앱으로 실행:
npm run electron:dev
```

---

## 🧪 테스트 실행
백엔드 단위 및 통합 테스트 (Pytest):
```bash
cd backend
.\.venv\Scripts\python -m pytest -v tests
```
