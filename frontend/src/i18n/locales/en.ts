import { TranslationType } from './ko';

export const en: TranslationType = {
  // 공통 (Common)
  common: {
    save: 'Save',
    saving: 'Saving...',
    cancel: 'Cancel',
    close: 'Close',
    confirm: 'Confirm',
    delete: 'Delete',
    run: 'Run',
    running: 'Running...',
    success: 'Success',
    failed: 'Failed',
    error: 'Error',
    warning: 'Warning',
    seconds: 'sec',
    pixels: 'px',
    count: 'times',
    none: 'None',
    ready: 'Ready',
    loading: 'Loading...',
    refresh: 'Refresh',
    reset: 'Reset',
    copy: 'Copy',
    copied: 'Copied',
    recommended: 'Recommended',
    status: 'Status',
    language: 'Language',
    korean: '한국어',
    english: 'English',
  },

  // 상단 네비게이션 (Navbar)
  nav: {
    appTitle: 'Praxis Desktop',
    appSubtitle: 'Agentic RPA Studio',
    flowBuilder: 'Flow Builder',
    agentRunner: 'Agent Runner',
    selectFlowPlaceholder: 'Select Saved Flow',
    loadingFlows: 'Loading flows...',
    noSavedFlows: 'No saved flows',
    flowNamePlaceholder: 'Enter workflow name',
    flowNameTooltip: 'Workflow name (Press Enter or click Save after modifying)',
    newFlowTooltip: 'Create New Flow',
    saveFlowTooltip: 'Save Workflow',
    runFlow: 'Run Flow',
    emergencyStop: 'Emergency Stop',
    settings: 'Settings',
    flowSettings: 'Workflow Settings',
    flowSettingsTooltip: 'Current Workflow Global Settings (Name, Description, Execution Speed, Default LLM)',
    cannotRunTooltip: 'Cannot run workflow:\n{errors}',
    runFlowTooltip: 'Run Workflow (Shortcut: F5)',
  },

  // 실시간 유효성 검사 (Validation)
  validation: {
    readyToRun: 'Ready to Run',
    readyTooltip: 'Workflow is valid and ready to execute.',
    orphanNodes: '{count} orphan node(s) (Excluded)',
    orphanTooltip: '[Warning] {warnings}',
    blocked: 'Cannot Run ({count} error(s))',
    blockedTooltip: '[Execution Blocked Errors]\n{errors}',
    noStartNode: "'Start' node does not exist.",
    multipleStartNodes: "There must be exactly one 'Start' node in the workflow.",
    noEndNode: "'End' node does not exist.",
    multipleEndNodes: "There must be exactly one 'End' node in the workflow.",
    cycleDetected: 'An infinite loop (cycle) was detected in the workflow.',
    disconnectedStartEnd: "'Start' and 'End' nodes must be connected continuously.",
    cannotCompleteNoEnd: "Cannot complete workflow because 'End' node is missing.",
    orphanWarning: 'There are {count} disconnected orphan nodes. (Ignored during execution)',
    noIntermediateNodes: 'There are no action skill nodes between Start and End.',
    runBlockedAlert: 'Cannot run workflow.\n\nDetected issues:\n{errors}',
  },

  // 하단 상태표시줄 (Status Bar)
  statusBar: {
    backendConnected: 'Backend Connected (8000)',
    backendDisconnected: 'Backend Disconnected (Retrying)',
    ollamaConnected: 'Ollama Connected',
    ollamaDisconnected: 'Ollama Not Detected',
    killSwitchReady: 'F12 Emergency Stop Monitored',
    flowValidation: 'Workflow Status',
    currentLanguage: 'Language: English',
  },

  // 스킬 카테고리 (Skill Categories)
  skillCategories: {
    mouse: {
      label: 'Mouse Control',
      description: 'Coordinate/object click and cursor movement',
    },
    keyboard: {
      label: 'Keyboard / Input',
      description: 'Text typing and hotkey combination execution',
    },
    window: {
      label: 'Window Control',
      description: 'Activate (front), maximize, minimize, close, and program control',
    },
    browser: {
      label: 'Web Browser (Playwright)',
      description: 'Legacy web (iframe)/SPA and cursor-free background web automation',
    },
    system: {
      label: 'System / Utility',
      description: 'Delay, clipboard, and screenshot control',
    },
    ai: {
      label: 'AI & Intelligence',
      description: 'Local Ollama LLM reasoning and ReAct autonomous agent',
    },
    workflow: {
      label: 'Workflow Structure / Control',
      description: 'Visual node grouping and sub-workflow module invocation',
    },
  },

  // 스킬 노드 아이템 (Skill Registry Items)
  skills: {
    title: 'Skill Nodes',
    collapseAll: 'Collapse All',
    expandAll: 'Expand All',
    searchPlaceholder: 'Search skills (e.g. click, keyboard, ollama)',
    searchResultsCount: '{count} search result(s)',
    noSearchResults: 'No matching skill nodes found.',
    clearSearch: 'Clear Search',
    dragOrDoubleClick: 'Drag & drop or double click to add',
    general_mouse_click: {
      label: 'Mouse Click',
      desc: 'Click by coordinate or UI object/image matching',
    },
    general_mouse_move: {
      label: 'Mouse Move',
      desc: 'Move cursor smoothly or instantly to coordinate',
    },
    general_mouse_drag: {
      label: 'Mouse Drag & Drop',
      desc: 'Drag and drop between coordinates and UI objects (4 combinations)',
    },
    general_mouse_scroll: {
      label: 'Mouse Scroll',
      desc: 'Vertical/horizontal scroll on UI object or current active window',
    },
    general_keyboard_type: {
      label: 'Text Type',
      desc: 'Keyboard typing and sequential character input',
    },
    general_keyboard_hotkey: {
      label: 'Hotkey Press',
      desc: 'Execute key combos such as Ctrl+C, Enter, Alt+Tab',
    },
    general_window_activate: {
      label: 'Activate Window',
      desc: 'Bring target window or element parent window to front',
    },
    general_window_maximize: {
      label: 'Maximize Window',
      desc: 'Expand window to fit current monitor display',
    },
    general_window_minimize: {
      label: 'Minimize Window',
      desc: 'Minimize window down to taskbar',
    },
    general_window_close: {
      label: 'Close Window',
      desc: 'Close window via close button or Alt+F4',
    },
    general_close_program: {
      label: 'Close Program',
      desc: 'Send graceful termination signal (WM_CLOSE/SIGINT)',
    },
    general_kill_process: {
      label: 'Kill Process',
      desc: 'Force terminate unresponsive process (SIGKILL/taskkill)',
    },
    general_launch_program: {
      label: 'Launch Program',
      desc: 'Start program by executable path or command',
    },
    general_delay: {
      label: 'Delay (Wait)',
      desc: 'Fixed pause or dynamic wait until UI element appears',
    },
    general_clipboard_copy: {
      label: 'Clipboard Copy',
      desc: 'Copy static text or previous output variable to clipboard',
    },
    general_clipboard_read: {
      label: 'Clipboard Read',
      desc: 'Read text from clipboard and store into a variable',
    },
    general_file_read: {
      label: 'Read Text File',
      desc: 'Read text content from a local file into a variable',
    },
    general_file_write: {
      label: 'Write File',
      desc: 'Save text or variable value to a local file (with overwrite option)',
    },
    general_message_box: {
      label: 'User Message Box',
      desc: 'Show topmost popup dialog and capture user choice or stop workflow',
    },
    general_screenshot: {
      label: 'Take Screenshot',
      desc: 'Capture primary monitor or full virtual screen to file/clipboard',
    },
    ai_ollama: {
      label: 'AI Query (Ollama)',
      desc: 'Send single prompt to local LLM and save response into variable',
    },
    agent_basic: {
      label: 'Basic Agent',
      desc: 'Autonomous ReAct agent deciding mouse/keyboard actions to achieve goal',
    },
    flow_group: {
      label: 'Group Node',
      desc: 'Visual container to group related nodes and collapse/expand them',
    },
    flow_call: {
      label: 'Call Sub-Workflow',
      desc: 'Invoke another saved workflow with isolated In/Out variable mappings',
    },
    browser_navigate: {
      label: 'Open Web / Navigate URL',
      desc: 'Navigate to URL via Playwright (Normal/Minimized/Headless) with persistent login',
    },
    browser_click: {
      label: 'Web Element Click (Background)',
      desc: 'Click web button/link/iframe element directly via DOM without moving mouse cursor',
    },
    browser_fill: {
      label: 'Web Text Fill (Background)',
      desc: 'Fill text into web input field without stealing focus or clipboard + optional Enter',
    },
    browser_extract: {
      label: 'Extract Web Content / Table',
      desc: 'Extract full page markdown, table, or element text/attribute into a variable',
    },
    browser_action: {
      label: 'Web Tab / Dropdown / Download',
      desc: 'Switch tabs, go back/reload, select dropdown (<select>), or wait for file download',
    },
    browser_get_info: {
      label: 'Get Current Web Info',
      desc: 'Read current tab URL, page Title, or open tabs list into a variable',
    },
    browser_evaluate: {
      label: 'Execute Web JavaScript (JS)',
      desc: 'Run custom JS code inside the page for legacy web/custom UI and store return value',
    },
  },

  // 캔버스 노드 (Canvas Nodes)
  nodes: {
    start: 'Start',
    end: 'End',
    deleteNode: 'Delete node',
    deleteEdge: 'Delete edge',
    smoothMove: 'Smooth',
    instantMove: 'Instant',
    smoothType: 'Smooth',
    instantType: 'Instant',
    windowTarget: 'Target',
    currentWindow: 'Current Active Window',
    hybridMode: 'Hybrid',
    uiaOnlyMode: 'UIA Object',
    imageOnlyMode: 'Image Match',
    dynamicWaitElement: 'Partial Loading',
    dynamicWaitWindow: 'Full Loading',
    timeoutSec: 'Max {sec}s',
    fixedDelay: '{sec}s delay',
    screenshotMain: 'Primary Monitor',
    screenshotAll: 'All Monitors',
    saveFile: 'Save File',
    copyClipboard: 'Copy to Clipboard',
    expandNote: 'Expand note',
    collapseNote: 'Collapse note',
  },

  // 속성 편집창 (Property Inspector)
  inspector: {
    title: 'Node Properties',
    nodeNameLabel: 'Node Name',
    nodeNoteLabel: 'Node Note (Description)',
    nodeNotePlaceholder: 'Enter supplementary notes or comments for this node (multi-line supported, shown under node title)',
    nodeNoteClear: 'Clear',
    nodeTypeLabel: 'Node Type',
    deleteNodeButton: 'Delete Node',
    closeButton: 'Close',
    
    // 마우스 클릭 노드
    mouseClick: {
      targetModeLabel: 'Click Target Mode',
      modeCoord: 'Coordinate Click',
      modeObject: 'Object Click',
      coordX: 'X Coordinate (px)',
      coordY: 'Y Coordinate (px)',
      currentCursorCoord: 'Leave blank to click current cursor position at runtime',
      buttonType: 'Mouse Button',
      buttonLeft: 'Left Click',
      buttonRight: 'Right Click',
      buttonMiddle: 'Middle Click',
      clicks: 'Click Count',
      clicksSingle: 'Single Click (1)',
      clicksDouble: 'Double Click (2)',
      clicksTriple: 'Triple Click (3)',
      moveModeLabel: 'Movement Style',
      moveInstant: 'Instant (Jump)',
      moveSmooth: 'Smooth Move (Glide)',
      moveDuration: 'Move Duration (sec)',
      moveDurationHelp: 'Specifies the time to glide naturally to the target position.',
      selectObjectBtn: 'Pick Object from Screen',
      reselectObjectBtn: 'Reselect',
      removeObjectBtn: 'Remove',
      recognitionModeLabel: 'Object Recognition Mode',
      modeHybrid: 'Hybrid (Recommended)',
      modeUia: 'UIA Object Match',
      modeImage: 'Image Template Match',
      autoFocusScrollLabel: 'Auto-activate & focus/scroll when off-screen',
      confidenceLabel: 'Image Matching Confidence Threshold',
      timeoutLabel: 'Max Search Timeout (sec)',
      fallbackLabel: 'Fallback to original coordinates if object not detected',
    },

    // 마우스 이동 노드
    mouseMove: {
      coordX: 'Target X Coordinate (px)',
      coordY: 'Target Y Coordinate (px)',
      duration: 'Movement Duration (sec)',
      durationHelp: '0 sec for instant move, 0.2 sec or more recommended',
    },

    // 텍스트 입력 노드
    keyboardType: {
      textLabel: 'Text to Type',
      textPlaceholder: 'Enter text to type. {{variable}} replacement supported',
      typeModeLabel: 'Typing Style',
      typeInstant: 'Instant (Paste)',
      typeSmooth: 'Smooth Type (Simulated)',
      intervalLabel: 'Key Press Interval (sec)',
      intervalHelp: 'Introduces a realistic delay between keystrokes.',
      decomposeKorean: 'Type characters sequentially',
      decomposeKoreanNote: '※ Note: Sequential typing operates properly when the target window IME is configured correctly.',
    },

    // 단축키 노드
    keyboardHotkey: {
      keysLabel: 'Hotkey Combination (Lowercase)',
      keysPlaceholder: 'e.g. ctrl+c, ctrl+shift+esc, enter, alt+tab',
      keysHelp: 'Combine keys with plus(+) sign. e.g. ctrl+v, alt+f4, f5',
    },

    // 윈도우 창 제어 노드
    window: {
      targetModeLabel: 'Target Window Identification',
      modeObject: 'By Object (Recommended)',
      modeTitle: 'By Window Title',
      modeCurrent: 'Current Active Window',
      selectObjectHelp: 'Picking an object precisely finds the window that owns the element.',
      windowTitleLabel: 'Target Window Title',
      windowTitlePlaceholder: 'e.g. Notepad, Chrome, Calculator',
      matchTypeLabel: 'Title Matching Rule',
      matchContains: 'Contains (Recommended)',
      matchExact: 'Exact Match',
      matchStartswith: 'Starts With',
      browserTip: '💡 Tip: When multiple browser windows are open, [By Object] identifies the exact intended window with 100% precision.',
    },

    // 프로그램 실행 노드
    launchProgram: {
      pathLabel: 'Executable Path / Program File',
      pathPlaceholder: 'e.g. notepad.exe, chrome.exe, C:\\App\\run.exe',
      argsLabel: 'Arguments',
      argsPlaceholder: 'Optional. e.g. https://google.com, file.txt',
      workDirLabel: 'Working Directory',
      workDirPlaceholder: 'Leave empty to use executable parent folder',
      waitLaunchLabel: 'Stabilization Wait after Launch (sec)',
    },

    // 프로그램 종료 / 강제종료 노드
    closeProgram: {
      processLabel: 'Process Name or Application Title',
      processPlaceholder: 'e.g. notepad.exe, chrome.exe, Calc.exe',
      timeoutLabel: 'Close Wait Timeout (sec)',
      forceKillNote: '※ Force kill (taskkill /F) may result in unsaved data loss.',
    },

    // 대기 노드
    delay: {
      modeLabel: 'Wait Mode Setting',
      modeManual: 'Fixed Manual Delay',
      modeDynamic: 'Dynamic Wait (Detect Loading)',
      secondsLabel: 'Wait Time (sec)',
      timeoutLabel: 'Max Wait Timeout (sec)',
      waitTypeLabel: 'Dynamic Wait Condition',
      typeElement: 'Partial Loading (Render Specific UI Element)',
      typeWindow: 'Full Loading (Window Ready for Interaction)',
      failOnTimeoutLabel: 'Action on Timeout',
      failOnTimeoutYes: 'Abort with Error (Fail)',
      failOnTimeoutNo: 'Continue to Next Node',
      postDelayLabel: 'Extra Stabilization Delay after Detection (sec)',
    },

    // 클립보드 복사 노드
    clipboard: {
      textLabel: 'Text to Copy to Clipboard',
      textPlaceholder: 'Enter text or use {{variable}} replacement',
    },

    // 스크린샷 노드
    screenshot: {
      targetLabel: 'Target Screen',
      targetMain: 'Primary Monitor',
      targetAll: 'All Monitors (Virtual Screen)',
      saveOptionLabel: 'Save Option (Multiple selectable)',
      saveFile: 'Save as Image File (PNG)',
      saveClipboard: 'Copy to Clipboard',
      filePathLabel: 'File Path to Save',
      filePathPlaceholder: 'Leave blank to auto-save in default screenshots folder',
    },

    // Ollama AI 노드
    aiOllama: {
      modelLabel: 'Select Ollama Model',
      noModelDetected: 'No models detected',
      uninstalledWarning: '⚠️ {model} (Uninstalled / Not detected)',
      quickFixModel: '[Switch to {model}]',
      promptLabel: 'Prompt Template',
      promptPlaceholder: 'Enter instructions for AI. {{variable}} replacement supported',
      tempLabel: 'Creativity (Temperature)',
      outputVarLabel: 'Output Variable Name',
      outputVarPlaceholder: 'e.g. ai_result, summary',
      previewPrompt: 'Variable Preview:',
    },

    // 기본 에이전트 노드
    agentBasic: {
      modelLabel: 'Select Ollama Model',
      goalLabel: 'Goal / User Prompt',
      goalPlaceholder: 'Specify the objective for the agent. e.g. "Open Notepad and type a greetings message"',
      includeScreenLabel: 'Include PC screen screenshot at runtime (Recommended for Vision models)',
      systemPromptLabel: 'System Prompt (Optional)',
      systemPromptPlaceholder:
        'You are an expert desktop automation AI agent. Use the provided tools to fulfill the user\'s goal.',
      systemPromptHelp: 'When left blank, the above default system instructions are automatically applied.',
      skillModeLabel: 'Available Skills',
      skillPresetAll: 'All Standard RPA Skills',
      skillPresetCustom: 'Custom Skill Selection',
      maxStepsLabel: 'Max Autonomous Steps',
      maxStepsHelp: 'Maximum tool calls to prevent infinite loops (1~30 steps)',
      numCtxLabel: 'Context Window Size',
      numCtxHelp: 'Maximum context size in tokens for this agent (Default: 8192). Recommend 16k~32k+ for long automation tasks.',
    },
  },

  // Agent Runner 실행 타임라인 & 사이드바
  runner: {
    sidebarTitle: 'Execution Sessions',
    noSessions: 'No execution sessions recorded.',
    deleteSessionTooltip: 'Delete Session',
    duration: 'Duration',
    totalNodes: '{count} node(s) executed',
    statusRunning: 'Running',
    statusSuccess: 'Completed',
    statusFailed: 'Failed',
    statusCancelled: 'Cancelled',
    stopSessionButton: 'Stop Execution (Emergency)',
    emptyTimelineTitle: 'No Execution Session Selected',
    emptyTimelineDesc: 'Select a session from the list on the left or click [Run Flow] above to execute a workflow.',
    stepStart: 'Node Execution Started',
    stepSuccess: 'Node Execution Succeeded',
    stepError: 'Node Execution Error',
    agentThinking: '💡 Thinking & Planning',
    agentToolCall: '🛠️ Tool Call',
    agentToolResult: '📋 Tool Result',
    viewFullScreenshot: 'View Full Screenshot',
    streamingText: 'Generating response...',
  },

  // 환경설정 모달 (Settings Modal)
  settings: {
    title: 'Settings',
    storageSection: 'Storage & Session Retention',
    autoCleanLabel: 'Auto-Clean Session History (Delete Old Sessions)',
    autoCleanDesc: 'Automatically cleans up old sessions and screenshots exceeding max history limit.',
    maxHistoryLabel: 'Recent Sessions to Keep (N)',
    captureScreenLabel: 'Capture PC Screen after Execution (All Monitors)',
    captureScreenDesc: 'Captures full screen upon node completion and logs it into Agent Runner. Disabling this speeds up execution and saves disk space.',
    webpFormatLabel: 'Default Screenshot Compression Format',
    webpFormatDesc: 'Default format applied for disk space optimization',
    ollamaSection: 'Local Ollama LLM Connection',
    ollamaHostLabel: 'Ollama Host Address',
    ollamaStatusLabel: 'Connection Status',
    ollamaConnected: 'Connected (Ollama running)',
    ollamaDisconnected: 'Disconnected (Check Ollama)',
    detectedModelsLabel: 'Detected Installed Models:',
    safetySection: 'Safety Controls (Kill Switch)',
    killSwitchLabel: 'Emergency Global Hotkey',
    languageSection: 'Language Settings',
    languageDesc: 'Choose the display language for Praxis Desktop UI.',
    savedSuccess: 'Settings saved successfully.',
    saveSettings: 'Save Settings',
  },

  // 오브젝트 선택기 (Object Picker)
  picker: {
    panelTitle: 'Object Picker',
    waitingSelection: 'Click any UI element on screen',
    selectedBadge: 'Object Selected',
    cropPreviewTitle: '1:1 Cropped Template',
    elementNameLabel: 'Element Name',
    targetWindowLabel: 'Parent Window Title',
    controlTypeLabel: 'UIA Control Type',
    automationIdLabel: 'AutomationId',
    coordsLabel: 'Coordinates & Bounds',
    reselect: 'Reselect',
    confirm: 'Confirm (Apply)',
    cancel: 'Cancel',
    webOverlayNotice: 'Web Browser Mode: Click any element on screen.',
  },

  // 스크린샷 모달 (Screenshot Modal)
  modal: {
    screenshotViewer: 'Screenshot Lightbox Viewer',
    close: 'Close (ESC)',
  },

  // 좌측 패널 탭 (스킬 / 워크플로우)
  workflowTab: {
    tabSkills: 'Skills',
    tabWorkflows: 'Workflows',
    title: 'Saved Workflows',
    subtitle: 'Click to load into main canvas',
    searchPlaceholder: 'Search saved workflows...',
    newWorkflowBtn: 'New Workflow',
    newBtn: 'New',
    noDescription: 'No description provided for this workflow.',
    unsavedBadge: 'Unsaved',
    activeBadge: 'Editing',
    nodeCount: '{count} nodes',
    varCount: '{count} vars',
    emptyList: 'No saved workflows found.',
    deleteConfirm: "Are you sure you want to delete '{name}'?",
    openSettingsTooltip: 'Open Workflow Global Settings',
    deleteTooltip: 'Delete Workflow',
  },

  // 워크플로우 전역 설정 (Flow Global Settings)
  flowSettings: {
    title: 'Workflow Global Settings',
    subtitle: 'Configure the workflow name, description, execution delay, and default AI model.',
    nameLabel: 'Workflow Name',
    namePlaceholder: 'Enter workflow name',
    descLabel: 'Workflow Description',
    descPlaceholder: 'Enter a brief description of what this workflow does (shown in the Workflows tab)',
    delayLabel: 'Execution Speed (Fixed Pre-Node Delay)',
    delayHelp: 'Fixed delay in seconds executed right before each skill node runs. (Default: 0.3s)',
    defaultModelLabel: 'Default LLM Model (Ollama)',
    defaultModelPlaceholder: 'e.g. llama3, qwen2.5:7b (Uses first installed model if empty)',
    defaultModelHelp: 'Default model name automatically applied to newly added AI Query (Ollama) and Basic Agent nodes.',
    defaultNumCtxLabel: 'Default LLM Context Size',
    defaultNumCtxHelp: 'Default context window size (tokens) applied to agent nodes. (Default: 8192, 8k~64k recommended)',
    applyModelToExistingBtn: 'Apply to All AI Nodes in Current Workflow',
    appliedCountMsg: 'Applied default model to {count} AI/Agent node(s).',
    saveBtn: 'Apply Global Settings',
  },

  // 워크플로우 변수 관리 패널 (Variable Manager Panel)
  variables: {
    panelTitle: 'Workflow Variable Manager',
    declaredCount: '{count} Declared',
    systemCount: '{count} System',
    addVariableBtn: 'Add Variable',
    varNamePlaceholder: 'Variable name (alphanumeric/_)',
    varTypeString: 'String',
    varTypeNumber: 'Number',
    varTypeBoolean: 'Boolean',
    varTypeJson: 'JSON (Object/Array)',
    varDefaultPlaceholder: 'Default value',
    varDescPlaceholder: 'Description (optional)',
    noDeclaredVars: 'No workflow variables declared. Click [+ Add Variable] to declare variables.',
    systemVarsTitle: 'Built-in System Variables (Read-only)',
    insertHint: 'Click to insert into focused input · Drag & drop into text fields',
    undeclaredWarning: 'Undeclared variable. Please declare the variable first.',
    declareNowBtn: "Declare '{name}' Now ({type})",
    selectOutputVarPlaceholder: '-- Select Declared Output Variable --',
    outputVarHelp: 'Only variables declared in the Workflow Variable Manager can be assigned as output variables.',
    quickInsertLabel: 'Quick Insert Variable (Click or Drag):',
  },

  // Agent Manager UI
  agentManager: {
    title: 'Agent Manager',
    subtitle: 'Execute Saved Workflows & Manage History',
    tabWorkflows: 'Saved Workflows',
    tabHistory: 'Execution History',
    searchPlaceholder: 'Search saved workflows by name or description...',
    runWorkflowBtn: 'Run',
    runningBtn: 'Running...',
    noSavedWorkflows: 'No saved workflows found. Please create and save a workflow in Flow Builder first.',
    openInFlowBuilder: 'View in Flow Builder',
    openInFlowBuilderTooltip: 'Open Flow Builder window and inspect the current workflow and execution history.',
    runnerSettingsBtn: 'Runner Settings',
    nodeCount: '{count} nodes',
    varCount: '{count} vars',
    delayBadge: 'Delay {sec}s',
    updatedAt: 'Updated: {date}',
    toastSuccessTitle: 'Workflow Completed',
    toastSuccessBody: "Workflow '{name}' completed successfully.",
    toastFailedTitle: 'Workflow Failed / Error',
    toastFailedBody: "Error while running '{name}': {error}",
    toastFailedDefault: 'An error occurred during execution. Check the Execution History tab for details.',
    toastCancelledTitle: 'Workflow Cancelled',
    toastCancelledBody: "Workflow '{name}' was stopped (cancelled).",
  },

  // Runner Settings (Template Window)
  runnerSettings: {
    title: 'Runner Settings',
    subtitle: 'Agent Runner & Manager Configuration',
    templateNoticeTitle: 'Runner Settings Template',
    templateNoticeDesc: 'Detailed specifications for Runner Settings are being finalized. Options for notifications, hotkeys, and background execution will be added here.',
    saveBtn: 'Save',
    savedFeedback: 'Settings saved.',
  },
};


