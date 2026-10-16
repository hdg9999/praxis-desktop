export const ko = {
  // 공통 (Common)
  common: {
    save: '저장',
    saving: '저장 중...',
    cancel: '취소',
    close: '닫기',
    confirm: '확인',
    delete: '삭제',
    run: '실행',
    running: '실행 중...',
    success: '성공',
    failed: '실패',
    error: '오류',
    warning: '주의',
    seconds: '초',
    pixels: 'px',
    count: '회',
    none: '없음',
    ready: '준비 완료',
    loading: '불러오는 중...',
    refresh: '새로고침',
    reset: '초기화',
    copy: '복사',
    copied: '복사됨',
    recommended: '권장',
    status: '상태',
    language: '언어',
    korean: '한국어',
    english: 'English',
  },

  // 상단 네비게이션 (Navbar)
  nav: {
    appTitle: 'Praxis Desktop',
    appSubtitle: 'Agentic RPA Studio',
    flowBuilder: 'Flow Builder',
    agentRunner: 'Agent Runner',
    selectFlowPlaceholder: '저장된 워크플로우 선택',
    loadingFlows: '워크플로우 불러오는 중...',
    noSavedFlows: '저장된 Flow 없음',
    flowNamePlaceholder: '워크플로우 이름 입력',
    flowNameTooltip: '워크플로우 이름 (수정 후 Enter 또는 저장 버튼을 누르세요)',
    newFlowTooltip: '새 Flow 생성',
    saveFlowTooltip: '워크플로우 저장',
    runFlow: 'Flow 실행',
    emergencyStop: '비상 정지',
    settings: '환경설정',
    cannotRunTooltip: '실행 불가 사유:\n{errors}',
    runFlowTooltip: '워크플로우 실행',
  },

  // 실시간 유효성 검사 (Validation)
  validation: {
    readyToRun: '실행 준비 완료',
    readyTooltip: '워크플로우가 유효하며 정상 실행 가능합니다.',
    orphanNodes: '고립 노드 {count}개 (실행 제외)',
    orphanTooltip: '[주의] {warnings}',
    blocked: '실행 불가 ({count}개 오류)',
    blockedTooltip: '[실행 차단 오류]\n{errors}',
    noStartNode: "'시작' 노드가 존재하지 않습니다.",
    multipleStartNodes: "'시작' 노드는 워크플로우에 오직 1개만 존재해야 합니다.",
    noEndNode: "'끝' 노드가 존재하지 않습니다.",
    multipleEndNodes: "'끝' 노드는 워크플로우에 오직 1개만 존재해야 합니다.",
    cycleDetected: '워크플로우에 무한루프(순환 참조)가 감지되었습니다.',
    disconnectedStartEnd: "'시작' 노드와 '끝' 노드가 끊김 없이 연결되어 있어야 합니다.",
    cannotCompleteNoEnd: "'끝' 노드가 없어 워크플로우를 완료할 수 없습니다.",
    orphanWarning: '연결되지 않은 고립 노드가 {count}개 있습니다. (실행 시 무시됨)',
    noIntermediateNodes: '시작과 끝 노드 사이에 실행할 동작(스킬 노드)이 없습니다.',
    runBlockedAlert: '워크플로우를 실행할 수 없습니다.\n\n확인된 문제점:\n{errors}',
  },

  // 하단 상태표시줄 (Status Bar)
  statusBar: {
    backendConnected: '백엔드 정상 연결 (8000)',
    backendDisconnected: '백엔드 연결 끊김 (재시도 중)',
    ollamaConnected: 'Ollama 연결됨',
    ollamaDisconnected: 'Ollama 미감지',
    killSwitchReady: 'F12 비상 탈출 상시 감시 중',
    flowValidation: '워크플로우 상태',
    currentLanguage: '언어: 한국어',
  },

  // 스킬 카테고리 (Skill Categories)
  skillCategories: {
    mouse: {
      label: '마우스 제어',
      description: '좌표/오브젝트 클릭 및 커서 이동',
    },
    keyboard: {
      label: '키보드 / 입력',
      description: '텍스트 타이핑 및 단축키 조합 실행',
    },
    window: {
      label: '윈도우 / 창 제어',
      description: '창 활성화(맨 앞으로), 최대화, 최소화, 닫기, 프로그램 제어',
    },
    system: {
      label: '시스템 / 유틸리티',
      description: '대기(딜레이), 클립보드 및 스크린샷 제어',
    },
    ai: {
      label: 'AI 인공지능',
      description: '로컬 Ollama LLM 추론 및 ReAct 자율 에이전트',
    },
  },

  // 스킬 노드 아이템 (Skill Registry Items)
  skills: {
    collapseAll: '모두 접기',
    expandAll: '모두 펼치기',
    searchPlaceholder: '스킬 검색 (예: 클릭, 키보드, ollama)',
    searchResultsCount: '검색 결과 {count}개',
    noSearchResults: '검색된 스킬 노드가 없습니다.',
    clearSearch: '검색 초기화',
    dragOrDoubleClick: '드래그 앤 드롭 또는 더블클릭하여 추가',
    general_mouse_click: {
      label: '마우스 클릭',
      desc: '좌표 또는 UI 오브젝트/이미지 일치 클릭',
    },
    general_mouse_move: {
      label: '마우스 이동',
      desc: '지정 좌표로 커서 부드럽게/즉시 이동',
    },
    general_mouse_drag: {
      label: '마우스 드래그 앤 드롭',
      desc: '좌표/오브젝트 간 마우스 드래그 앤 드롭 (4가지 조합)',
    },
    general_mouse_scroll: {
      label: '마우스 스크롤',
      desc: 'UI 오브젝트 또는 현재 창 상하/좌우 스크롤 제어',
    },
    general_keyboard_type: {
      label: '텍스트 입력',
      desc: '키보드 타이핑 및 한글 자모 순서 타이핑',
    },
    general_keyboard_hotkey: {
      label: '단축키 입력',
      desc: 'Ctrl+C, Enter, Alt+Tab 등 키 조합 실행',
    },
    general_window_activate: {
      label: '창 활성화',
      desc: '선택한 창 또는 오브젝트가 속한 창을 맨 앞으로 가져와 포커스',
    },
    general_window_maximize: {
      label: '창 최대화',
      desc: '선택한 창을 현재 모니터 화면 최대 크기로 확장',
    },
    general_window_minimize: {
      label: '창 최소화',
      desc: '선택한 창을 작업표시줄로 내려서 숨김',
    },
    general_window_close: {
      label: '창 닫기',
      desc: '선택한 창의 X 닫기 버튼 또는 Alt+F4로 창 닫기',
    },
    general_close_program: {
      label: '프로그램 종료',
      desc: '실행 중인 프로세스에 정상 종료 신호(WM_CLOSE/SIGINT) 전송',
    },
    general_kill_process: {
      label: '프로세스 강제종료',
      desc: '응답 없는 프로세스를 즉시 강제 종료(SIGKILL/taskkill)',
    },
    general_launch_program: {
      label: '프로그램 실행',
      desc: '실행 파일 경로 또는 명령어로 프로그램 실행',
    },
    general_delay: {
      label: '대기 (Delay)',
      desc: '지정 시간 일시 정지 또는 특정 UI 요소 감지까지 동적 대기',
    },
    general_clipboard_copy: {
      label: '클립보드 복사',
      desc: '고정 텍스트 또는 이전 노드 출력값을 클립보드에 복사',
    },
    general_clipboard_read: {
      label: '클립보드 읽기',
      desc: '클립보드에 저장된 텍스트를 읽어 변수로 저장',
    },
    general_file_read: {
      label: '텍스트 파일 읽기',
      desc: '로컬 파일의 텍스트 내용을 읽어 변수로 저장',
    },
    general_file_write: {
      label: '파일 쓰기',
      desc: '텍스트 또는 변수 값을 로컬 파일로 저장 (덮어쓰기 옵션)',
    },
    general_message_box: {
      label: '사용자 대화상자 출력',
      desc: '최상단 팝업 알림창 출력 및 사용자 응답 분기/중지',
    },
    general_screenshot: {
      label: '화면 스크린샷',
      desc: '주 모니터 또는 전체 화면을 캡처하여 파일/클립보드에 저장',
    },
    ai_ollama: {
      label: '단순 AI 질의 (Ollama)',
      desc: '로컬 LLM에게 1회성 질문을 전달하고 답변을 변수로 저장',
    },
    agent_basic: {
      label: '기본 에이전트',
      desc: '사용자 지시 목표 달성을 위해 마우스/키보드 스킬을 자율 판단 실행',
    },
  },

  // 캔버스 노드 (Canvas Nodes)
  nodes: {
    start: '시작',
    end: '끝',
    deleteNode: '노드 삭제',
    deleteEdge: '간선 삭제',
    smoothMove: '천천히',
    instantMove: '즉시',
    smoothType: '천천히',
    instantType: '즉시',
    windowTarget: '대상',
    currentWindow: '현재 활성 창',
    hybridMode: '하이브리드',
    uiaOnlyMode: 'UIA 객체',
    imageOnlyMode: '이미지 일치',
    dynamicWaitElement: '부분로딩',
    dynamicWaitWindow: '완전로딩',
    timeoutSec: '최대 {sec}s',
    fixedDelay: '{sec}초 대기',
    screenshotMain: '주 모니터',
    screenshotAll: '전체 화면',
    saveFile: '파일 저장',
    copyClipboard: '클립보드 복사',
  },

  // 속성 편집창 (Property Inspector)
  inspector: {
    title: '노드 속성 설정',
    nodeNameLabel: '노드 이름',
    nodeTypeLabel: '노드 유형',
    deleteNodeButton: '노드 삭제',
    closeButton: '닫기',
    
    // 마우스 클릭 노드
    mouseClick: {
      targetModeLabel: '클릭 대상 설정',
      modeCoord: '좌표 클릭',
      modeObject: '오브젝트 클릭',
      coordX: 'X 좌표 (픽셀)',
      coordY: 'Y 좌표 (픽셀)',
      currentCursorCoord: '공란 시 실행 시점의 마우스 현재 위치 클릭',
      buttonType: '마우스 버튼',
      buttonLeft: '왼쪽 (Left)',
      buttonRight: '오른쪽 (Right)',
      buttonMiddle: '가운데 (Middle)',
      clicks: '클릭 횟수',
      clicksSingle: '1회 (일반 클릭)',
      clicksDouble: '2회 (더블 클릭)',
      clicksTriple: '3회 (트리플 클릭)',
      moveModeLabel: '마우스 이동 방식',
      moveInstant: '즉시 (순간이동)',
      moveSmooth: '천천히 이동 (부드러운 이동)',
      moveDuration: '마우스 이동 소요 시간 (초)',
      moveDurationHelp: '목표 지점까지 자연스럽게 이동할 시간을 지정합니다.',
      selectObjectBtn: '화면에서 오브젝트 선택',
      reselectObjectBtn: '다시 선택',
      removeObjectBtn: '제거',
      recognitionModeLabel: '오브젝트 인식 방식',
      modeHybrid: '하이브리드 (권장)',
      modeUia: 'UIA 객체 일치',
      modeImage: '이미지 일치',
      autoFocusScrollLabel: '화면에 보이지 않을 때 자동 활성화 및 포커스/스크롤',
      confidenceLabel: '이미지 매칭 유사도 임계값',
      timeoutLabel: '오브젝트 탐색 최대 대기 시간 (초)',
      fallbackLabel: '오브젝트 미검출 시 원래 좌표로 클릭 시도 (폴백)',
    },

    // 마우스 이동 노드
    mouseMove: {
      coordX: '목표 X 좌표 (픽셀)',
      coordY: '목표 Y 좌표 (픽셀)',
      duration: '이동 소요 시간 (초)',
      durationHelp: '0초 입력 시 즉시 이동, 0.2초 이상 권장',
    },

    // 텍스트 입력 노드
    keyboardType: {
      textLabel: '입력할 텍스트',
      textPlaceholder: '타이핑할 텍스트를 입력하세요. {{변수}} 치환 가능',
      typeModeLabel: '텍스트 입력 방식',
      typeInstant: '즉시 (붙여넣기)',
      typeSmooth: '천천히 입력 (타이핑 시뮬레이션)',
      intervalLabel: '글자 간 입력 간격 (초)',
      intervalHelp: '실제 키보드를 두드리듯 글자 사이에 지연을 줍니다.',
      decomposeKorean: '한글 자모 순서로 타이핑 (예: ㄱ->ㅏ->ㅁ->ㅅ->ㅏ)',
      decomposeKoreanNote: '※ 한글 자모 타이핑은 대상 창의 입력기가 [한글] 상태일 때 정상 작동합니다.',
    },

    // 단축키 노드
    keyboardHotkey: {
      keysLabel: '단축키 조합 (소문자 권장)',
      keysPlaceholder: '예: ctrl+c, ctrl+shift+esc, enter, alt+tab',
      keysHelp: '더하기(+) 기호로 키를 조합합니다. 예: ctrl+v, alt+f4, f5',
    },

    // 윈도우 창 제어 노드
    window: {
      targetModeLabel: '대상 창 식별 방식',
      modeObject: '오브젝트 기준 (권장)',
      modeTitle: '창 제목 직접 입력',
      modeCurrent: '현재 활성 창',
      selectObjectHelp: '오브젝트를 선택하면 해당 요소가 포함된 창을 정확히 찾아냅니다.',
      windowTitleLabel: '대상 창 제목 (Window Title)',
      windowTitlePlaceholder: '예: 메모장, Chrome, 계산기',
      matchTypeLabel: '제목 매칭 방식',
      matchContains: '포함 일치 (권장)',
      matchExact: '완전 일치',
      matchStartswith: '시작 일치',
      browserTip: '💡 팁: 브라우저 창이 여러 개 떠 있을 때 [오브젝트 기준]을 선택하면 원하는 창을 100% 정밀하게 식별할 수 있습니다.',
    },

    // 프로그램 실행 노드
    launchProgram: {
      pathLabel: '실행 프로그램 경로 / 파일',
      pathPlaceholder: '예: notepad.exe, chrome.exe, C:\\App\\run.exe',
      argsLabel: '실행 인자 (Arguments)',
      argsPlaceholder: '선택 사항. 예: https://naver.com, file.txt',
      workDirLabel: '작업 디렉터리 (Working Directory)',
      workDirPlaceholder: '공란 시 실행 파일의 상위 폴더 사용',
      waitLaunchLabel: '실행 완료 후 안정 대기 (초)',
    },

    // 프로그램 종료 / 강제종료 노드
    closeProgram: {
      processLabel: '종료할 프로세스 또는 프로그램명',
      processPlaceholder: '예: notepad.exe, chrome.exe, Calc.exe',
      timeoutLabel: '종료 대기 타임아웃 (초)',
      forceKillNote: '※ 프로세스 강제종료(taskkill /F)는 저장되지 않은 작업 내용을 유실할 수 있습니다.',
    },

    // 대기 노드
    delay: {
      modeLabel: '대기 방식 설정',
      modeManual: '수동 고정 대기',
      modeDynamic: '동적 대기 (로딩 감지)',
      secondsLabel: '대기 시간 (초)',
      timeoutLabel: '최대 대기 시간 (타임아웃, 초)',
      waitTypeLabel: '동적 대기 유형',
      typeElement: '부분로딩 대기 (특정 UI 요소 렌더링)',
      typeWindow: '완전로딩 대기 (창 전체 응답 준비 완료)',
      failOnTimeoutLabel: '타임아웃 초과 시 동작',
      failOnTimeoutYes: '오류로 중단 (실패)',
      failOnTimeoutNo: '다음 노드로 계속 진행',
      postDelayLabel: '감지 완료 후 추가 안정 지연 (초)',
    },

    // 클립보드 복사 노드
    clipboard: {
      textLabel: '클립보드에 복사할 텍스트',
      textPlaceholder: '텍스트를 입력하거나 {{변수}} 치환 지원',
    },

    // 스크린샷 노드
    screenshot: {
      targetLabel: '촬영 대상 화면',
      targetMain: '주 모니터 (Primary Monitor)',
      targetAll: '전체 화면 (모든 모니터 포함)',
      saveOptionLabel: '저장 방식 (복수 선택 가능)',
      saveFile: '이미지 파일로 저장 (PNG)',
      saveClipboard: '클립보드에 복사',
      filePathLabel: '저장할 파일 경로',
      filePathPlaceholder: '공란 시 시스템 기본 캡처 폴더에 자동 저장',
    },

    // Ollama AI 노드
    aiOllama: {
      modelLabel: 'Ollama 모델 선택',
      noModelDetected: '감지된 모델 없음',
      uninstalledWarning: '⚠️ {model} (미설치 / 감지 안됨)',
      quickFixModel: '[{model}로 즉시 변경]',
      promptLabel: '프롬프트 템플릿',
      promptPlaceholder: 'AI에게 요청할 지시사항을 입력하세요. {{변수}} 치환 가능',
      tempLabel: '창의성 (Temperature)',
      outputVarLabel: '결과 저장 변수명',
      outputVarPlaceholder: '예: ai_result, summary',
      previewPrompt: '치환 미리보기:',
    },

    // 기본 에이전트 노드
    agentBasic: {
      modelLabel: 'Ollama 모델 선택',
      goalLabel: '사용자 지시 목표 (Goal / User Prompt)',
      goalPlaceholder: '에이전트가 완수할 구체적인 작업 목표를 지시하세요. 예: "메모장을 켜고 인사말을 입력해줘"',
      includeScreenLabel: '실행 시점 PC 화면 스크린샷 포함 (Vision/멀티모달 모델 권장)',
      systemPromptLabel: '추가 시스템 지침 (System Instructions)',
      systemPromptPlaceholder: '에이전트의 역할이나 특별한 행동 규칙을 추가합니다.',
      skillModeLabel: '에이전트 사용 가능 스킬셋',
      skillPresetAll: '기본 RPA 스킬 전체',
      skillPresetCustom: '스킬셋 직접 선택 (커스텀)',
      maxStepsLabel: '최대 자율 실행 단계 (Max Steps)',
      maxStepsHelp: '무한 루프 방지를 위한 최대 도구 호출 횟수 (1~30단계)',
    },
  },

  // Agent Runner 실행 타임라인 & 사이드바
  runner: {
    sidebarTitle: '실행 세션 이력',
    noSessions: '기록된 실행 세션이 없습니다.',
    deleteSessionTooltip: '세션 삭제',
    duration: '소요 시간',
    totalNodes: '총 {count}개 노드 실행',
    statusRunning: '실행 중',
    statusSuccess: '완료됨',
    statusFailed: '실패함',
    statusCancelled: '중단됨',
    stopSessionButton: '실행 중단 (비상 정지)',
    emptyTimelineTitle: '선택된 실행 세션이 없습니다',
    emptyTimelineDesc: '좌측 세션 목록에서 이력을 선택하거나 상단의 [Flow 실행] 버튼을 눌러 워크플로우를 실행하세요.',
    stepStart: '노드 실행 시작',
    stepSuccess: '노드 실행 성공',
    stepError: '노드 실행 오류',
    agentThinking: '💡 생각 및 계획 (Thinking)',
    agentToolCall: '🛠️ 도구 호출 (Tool Call)',
    agentToolResult: '📋 도구 실행 결과 (Tool Result)',
    viewFullScreenshot: '원본 스크린샷 보기',
    streamingText: '응답 생성 중...',
  },

  // 환경설정 모달 (Settings Modal)
  settings: {
    title: '환경설정 (Settings)',
    storageSection: '저장 용량 및 실행 이력 관리',
    autoCleanLabel: '실행 이력 자동 정리 (오래된 세션 자동 삭제)',
    autoCleanDesc: '최대 보관 개수를 초과한 오래된 세션과 스크린샷을 자동으로 정리합니다.',
    maxHistoryLabel: '최근 유지할 세션 개수 (N개)',
    captureScreenLabel: '실행 후 PC 화면 촬영 (전체 모니터)',
    captureScreenDesc: '노드 실행 완료 시 전체 모니터 화면을 캡처하여 Agent Runner에 기록합니다. 비활성화 시 화면 촬영을 건너뛰어 실행 속도가 향상되고 용량을 절약합니다.',
    webpFormatLabel: '스크린샷 기본 압축 포맷',
    webpFormatDesc: '디스크 절약을 위해 기본 적용됨',
    ollamaSection: '로컬 Ollama LLM 연결',
    ollamaHostLabel: 'Ollama 호스트 주소',
    ollamaStatusLabel: '연결 상태',
    ollamaConnected: '정상 연결됨 (Ollama 구동중)',
    ollamaDisconnected: '연결 안됨 (Ollama 확인 필요)',
    detectedModelsLabel: '감지된 설치 모델:',
    safetySection: '안전 장치 (Kill Switch)',
    killSwitchLabel: '비상 탈출 전역 핫키',
    languageSection: '언어 설정 (Language Settings)',
    languageDesc: 'Praxis Desktop UI에 표시되는 언어를 선택합니다.',
    savedSuccess: '설정이 저장되었습니다.',
    saveSettings: '설정 저장',
  },

  // 오브젝트 선택기 (Object Picker)
  picker: {
    panelTitle: '오브젝트 선택기',
    waitingSelection: '화면에서 UI 요소를 클릭하세요',
    selectedBadge: '오브젝트 선택됨',
    cropPreviewTitle: '1:1 크롭 템플릿',
    elementNameLabel: '오브젝트 명칭',
    targetWindowLabel: '상위 창 제목',
    controlTypeLabel: 'UIA 컨트롤 타입',
    automationIdLabel: 'AutomationId',
    coordsLabel: '좌표 및 크기',
    reselect: '다시 선택',
    confirm: '확인 (적용)',
    cancel: '취소',
    webOverlayNotice: '웹 브라우저 모드: 화면의 UI 요소를 클릭하세요.',
  },

  // 스크린샷 모달 (Screenshot Modal)
  modal: {
    screenshotViewer: '스크린샷 원본 뷰어',
    close: '닫기 (ESC)',
  },
};

export type TranslationType = typeof ko;
