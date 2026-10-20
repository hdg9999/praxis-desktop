import {
  MousePointer,
  Move,
  Hand,
  ArrowUpDown,
  Type,
  Command,
  Clock,
  Copy,
  ClipboardPaste,
  FileText,
  Save,
  MessageSquare,
  Sparkles,
  Keyboard,
  Sliders,
  AppWindow,
  Maximize2,
  Minimize2,
  Camera,
  Bot,
  Rocket,
  XCircle,
  Power,
  Ban,
  FolderKanban,
  Workflow,
  GitBranchPlus,
} from 'lucide-react';
import { NodeType } from '../../types';

export interface SkillCategory {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  badgeColor?: string;
  headerColor?: string;
}

export interface SkillItem {
  type: NodeType;
  categoryId: string;
  label: string;
  desc: string;
  icon: React.ReactNode;
  defaultConfig: Record<string, any>;
  tags?: string[];
  isAi?: boolean;
}

export const SKILL_CATEGORIES: SkillCategory[] = [
  {
    id: 'mouse',
    label: '마우스 제어',
    description: '좌표/오브젝트 클릭 및 커서 이동',
    icon: <MousePointer className="w-3.5 h-3.5 text-blue-400" />,
    badgeColor: 'bg-blue-900/40 text-blue-300 border-blue-700/50',
    headerColor: 'hover:text-blue-300',
  },
  {
    id: 'keyboard',
    label: '키보드 / 입력',
    description: '텍스트 타이핑 및 단축키 조합 실행',
    icon: <Keyboard className="w-3.5 h-3.5 text-emerald-400" />,
    badgeColor: 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50',
    headerColor: 'hover:text-emerald-300',
  },
  {
    id: 'window',
    label: '윈도우 / 창 제어',
    description: '창 활성화(맨 앞으로), 최대화, 최소화 제어',
    icon: <AppWindow className="w-3.5 h-3.5 text-sky-400" />,
    badgeColor: 'bg-sky-900/40 text-sky-300 border-sky-700/50',
    headerColor: 'hover:text-sky-300',
  },
  {
    id: 'system',
    label: '시스템 / 유틸리티',
    description: '대기(딜레이), 클립보드 및 스크린샷 제어',
    icon: <Sliders className="w-3.5 h-3.5 text-amber-400" />,
    badgeColor: 'bg-amber-900/40 text-amber-300 border-amber-700/50',
    headerColor: 'hover:text-amber-300',
  },
  {
    id: 'ai',
    label: 'AI 인공지능',
    description: '로컬 Ollama LLM 추론 및 스트리밍',
    icon: <Sparkles className="w-3.5 h-3.5 text-purple-400" />,
    badgeColor: 'bg-purple-900/40 text-purple-300 border-purple-700/50',
    headerColor: 'hover:text-purple-300',
  },
  {
    id: 'workflow',
    label: '워크플로우 구성 / 제어',
    description: '노드 시각적 그룹화 및 서브 워크플로우 모듈 호출',
    icon: <Workflow className="w-3.5 h-3.5 text-teal-400" />,
    badgeColor: 'bg-teal-900/40 text-teal-300 border-teal-700/50',
    headerColor: 'hover:text-teal-300',
  },
];

export const SKILL_ITEMS: SkillItem[] = [
  // 1. 마우스 제어
  {
    type: 'general_mouse_click',
    categoryId: 'mouse',
    label: '마우스 클릭',
    desc: '좌표 또는 UI 오브젝트/이미지 일치 클릭',
    icon: <MousePointer className="w-4 h-4 text-blue-400" />,
    defaultConfig: { x: null, y: null, button: 'left', clicks: 1, move_mode: 'instant', duration: 0.2, auto_focus_scroll: true },
    tags: ['클릭', '마우스', '좌표', '오브젝트', 'click', 'mouse', 'double click', '더블클릭', '우클릭', '단추'],
  },
  {
    type: 'general_mouse_move',
    categoryId: 'mouse',
    label: '마우스 이동',
    desc: '지정 좌표로 커서 부드럽게/즉시 이동',
    icon: <Move className="w-4 h-4 text-cyan-400" />,
    defaultConfig: { x: 500, y: 500, duration: 0.2 },
    tags: ['이동', '마우스', '커서', 'move', 'cursor', '좌표', '위치'],
  },
  {
    type: 'general_mouse_drag',
    categoryId: 'mouse',
    label: '마우스 드래그 앤 드롭',
    desc: '좌표/오브젝트 간 마우스 드래그 앤 드롭 (4가지 조합)',
    icon: <Hand className="w-4 h-4 text-indigo-400" />,
    defaultConfig: {
      start_mode: 'coordinate',
      start_x: 300,
      start_y: 300,
      start_object_data: null,
      start_search_mode: 'hybrid',
      start_confidence: 0.8,
      start_search_timeout: 3.0,
      start_fallback_to_coord: true,
      end_mode: 'coordinate',
      end_x: 600,
      end_y: 300,
      end_object_data: null,
      end_search_mode: 'hybrid',
      end_confidence: 0.8,
      end_search_timeout: 3.0,
      end_fallback_to_coord: true,
      button: 'left',
      move_mode: 'smooth',
      duration: 0.5,
    },
    tags: ['드래그', '드롭', '마우스', '끌기', '좌표', '오브젝트', 'drag', 'drop', 'mouse'],
  },
  {
    type: 'general_mouse_scroll',
    categoryId: 'mouse',
    label: '마우스 스크롤',
    desc: 'UI 오브젝트 또는 현재 창 상하/좌우 스크롤 제어',
    icon: <ArrowUpDown className="w-4 h-4 text-sky-400" />,
    defaultConfig: {
      target_mode: 'object',
      object_data: null,
      direction: 'vertical',
      distance_mode: 'ticks',
      ticks: 5,
      ticks_direction: 'backward',
    },
    tags: ['스크롤', '마우스', '휠', '페이지다운', '페이지업', '홈', '엔드', 'scroll', 'wheel', 'page down', 'page up', 'home', 'end'],
  },

  // 2. 키보드 / 입력
  {
    type: 'general_keyboard_type',
    categoryId: 'keyboard',
    label: '텍스트 입력',
    desc: '키보드 타이핑 및 한글 자모 순서 타이핑',
    icon: <Type className="w-4 h-4 text-emerald-400" />,
    defaultConfig: { text: '입력할 텍스트', type_mode: 'instant', interval: 0.05, decompose_korean: true },
    tags: ['텍스트', '키보드', '타이핑', '입력', '한글', 'type', 'text', 'keyboard', '문자', '글자'],
  },
  {
    type: 'general_keyboard_hotkey',
    categoryId: 'keyboard',
    label: '단축키 입력',
    desc: 'Ctrl+C, Enter, Alt+Tab 등 키 조합 실행',
    icon: <Command className="w-4 h-4 text-indigo-400" />,
    defaultConfig: { keys: 'ctrl+c' },
    tags: ['단축키', '핫키', '키조합', 'hotkey', 'shortcut', 'command', 'enter', 'ctrl', 'alt', 'shift'],
  },

  // 3. 윈도우 / 창 제어
  {
    type: 'general_window_activate',
    categoryId: 'window',
    label: '창 활성화',
    desc: '선택한 창 또는 오브젝트가 속한 창을 맨 앞으로 가져와 포커스',
    icon: <AppWindow className="w-4 h-4 text-sky-400" />,
    defaultConfig: { target_mode: 'object', window_title: '', match_type: 'contains', object_data: null },
    tags: ['활성화', '창', '윈도우', '포커스', '맨앞으로', 'activate', 'window', 'focus', 'front', 'bring to front', '창활성화'],
  },
  {
    type: 'general_window_maximize',
    categoryId: 'window',
    label: '창 최대화',
    desc: '선택한 창을 현재 모니터 화면 최대 크기로 확장',
    icon: <Maximize2 className="w-4 h-4 text-cyan-400" />,
    defaultConfig: { target_mode: 'object', window_title: '', match_type: 'contains', object_data: null },
    tags: ['최대화', '창', '윈도우', '화면확대', '전체화면', 'maximize', 'window', 'expand', '창최대화', '최대'],
  },
  {
    type: 'general_window_minimize',
    categoryId: 'window',
    label: '창 최소화',
    desc: '선택한 창을 작업표시줄로 내려서 숨김',
    icon: <Minimize2 className="w-4 h-4 text-slate-400" />,
    defaultConfig: { target_mode: 'object', window_title: '', match_type: 'contains', object_data: null },
    tags: ['최소화', '창', '윈도우', '작업표시줄', '숨김', 'minimize', 'window', 'hide', '창최소화', '최소'],
  },
  {
    type: 'general_window_close',
    categoryId: 'window',
    label: '창 닫기',
    desc: '활성 창 또는 선택한 창을 안전하게 닫기',
    icon: <XCircle className="w-4 h-4 text-rose-400" />,
    defaultConfig: { target_mode: 'object', window_title: '', match_type: 'contains', object_data: null },
    tags: ['창닫기', '닫기', '창', '윈도우', 'close', 'window', 'exit', '종료', '창종료'],
  },

  // 4. 시스템 / 유틸리티
  {
    type: 'general_delay',
    categoryId: 'system',
    label: '대기 (Delay)',
    desc: '수동 시간 대기 또는 UI 오브젝트/앱 로딩 감지 동적 대기',
    icon: <Clock className="w-4 h-4 text-amber-400" />,
    defaultConfig: {
      dynamic_wait: false,
      seconds: 1.0,
      wait_mode: 'element',
      object_data: null,
      fail_on_timeout: true,
      post_delay: 0,
      confidence: 0.8,
    },
    tags: ['대기', '지연', '일시정지', '동적대기', '로딩대기', 'delay', 'wait', 'sleep', '시간', '초', 'pause', 'timeout', '타임아웃', '오브젝트'],
  },
  {
    type: 'general_clipboard_copy',
    categoryId: 'system',
    label: '클립보드 복사',
    desc: '특정 텍스트를 클립보드에 복사',
    icon: <Copy className="w-4 h-4 text-purple-400" />,
    defaultConfig: { text: '복사할 텍스트' },
    tags: ['클립보드', '복사', 'clipboard', 'copy', '붙여넣기', '텍스트복사'],
  },
  {
    type: 'general_clipboard_read',
    categoryId: 'system',
    label: '클립보드 읽기',
    desc: '클립보드에 저장된 텍스트를 읽어 변수로 저장',
    icon: <ClipboardPaste className="w-4 h-4 text-violet-400" />,
    defaultConfig: { output_variable: 'clipboard_text' },
    tags: ['클립보드', '읽기', '붙여넣기', '변수', 'clipboard', 'read', 'paste'],
  },
  {
    type: 'general_file_read',
    categoryId: 'system',
    label: '텍스트 파일 읽기',
    desc: '로컬 파일의 텍스트 내용을 읽어 변수로 저장',
    icon: <FileText className="w-4 h-4 text-emerald-400" />,
    defaultConfig: {
      file_path: '',
      encoding: 'utf-8',
      output_variable: 'file_content',
    },
    tags: ['파일', '읽기', '텍스트', '불러오기', '변수', 'file', 'read', 'txt', 'csv', 'json'],
  },
  {
    type: 'general_file_write',
    categoryId: 'system',
    label: '파일 쓰기',
    desc: '텍스트 또는 변수 값을 로컬 파일로 저장 (덮어쓰기 옵션)',
    icon: <Save className="w-4 h-4 text-teal-400" />,
    defaultConfig: {
      file_path: 'C:\\Temp\\output.txt',
      content: '{{last_output}}',
      overwrite: false,
      encoding: 'utf-8',
    },
    tags: ['파일', '쓰기', '저장', '기록', '덮어쓰기', 'file', 'write', 'save', 'txt'],
  },
  {
    type: 'general_message_box',
    categoryId: 'system',
    label: '사용자 대화상자 출력',
    desc: '최상단 팝업 알림창 출력 및 사용자 응답 분기/중지',
    icon: <MessageSquare className="w-4 h-4 text-amber-400" />,
    defaultConfig: {
      title: '알림',
      message_type: 'info',
      message: '작업을 계속 진행하시겠습니까?',
      button_type: 'ok',
      output_variable: 'dialog_result',
    },
    tags: ['대화상자', '알림창', '메시지', '팝업', '확인', '예', '아니오', '계속', '중지', 'dialog', 'message', 'alert', 'popup'],
  },
  {
    type: 'general_screenshot',
    categoryId: 'system',
    label: '스크린샷 촬영',
    desc: '현재 PC 화면을 캡처하여 클립보드 복사 또는 파일로 저장',
    icon: <Camera className="w-4 h-4 text-teal-400" />,
    defaultConfig: {
      capture_target: 'primary',
      save_to_file: true,
      file_path: 'C:\\Screenshots\\screenshot_{{timestamp}}.png',
      copy_to_clipboard: false,
    },
    tags: ['스크린샷', '화면캡처', '캡처', '촬영', 'screenshot', 'capture', '모니터', '클립보드', '파일저장'],
  },
  {
    type: 'general_launch_program',
    categoryId: 'system',
    label: '프로그램 실행',
    desc: '지정한 실행 파일(.exe) 또는 프로그램을 백그라운드에서 실행',
    icon: <Rocket className="w-4 h-4 text-orange-400" />,
    defaultConfig: {
      program_path: '',
      arguments: '',
    },
    tags: ['프로그램', '실행', '앱', 'app', 'run', 'launch', 'execute', 'exe', 'bat', 'cmd', '프로그램실행', '소프트웨어'],
  },
  {
    type: 'general_close_program',
    categoryId: 'system',
    label: '프로그램 종료',
    desc: '지정한 프로세스에 종료 신호(WM_CLOSE)를 보내 정상 종료',
    icon: <Power className="w-4 h-4 text-amber-400" />,
    defaultConfig: {
      process_name: '',
      object_data: null,
    },
    tags: ['프로그램종료', '종료', '프로세스', '소프트종료', 'close', 'program', 'process', '정상종료', '앱종료'],
  },
  {
    type: 'general_kill_process',
    categoryId: 'system',
    label: '프로세스 강제 종료',
    desc: '지정한 프로세스를 OS 레벨에서 즉시 강제 종료 (Kill)',
    icon: <Ban className="w-4 h-4 text-rose-500" />,
    defaultConfig: {
      process_name: '',
      object_data: null,
    },
    tags: ['강제종료', '프로세스종료', '킬', 'kill', 'terminate', 'taskkill', '강제', 'killprocess'],
  },

  // 4. AI 인공지능
  {
    type: 'ai_ollama',
    categoryId: 'ai',
    label: '단순 AI 질의(Ollama)',
    desc: '로컬 LLM에 1회성 질문',
    icon: <Sparkles className="w-4 h-4 text-purple-400" />,
    defaultConfig: {
      model: 'llama3',
      prompt: '다음 내용을 요약해줘: {{last_output}}',
      system_prompt: '',
      temperature: 0.7,
      output_variable: 'ai_output',
    },
    tags: ['ai', 'ollama', 'llm', '인공지능', '프롬프트', 'prompt', '스트리밍', '요약', '모델', '생성', '단순', '질의', '질문'],
    isAi: true,
  },
  {
    type: 'agent_basic',
    categoryId: 'ai',
    label: '기본 에이전트',
    desc: '사용자 지시 프롬프트에 따라 적절한 스킬들을 자율 선택하여 작업 완수',
    icon: <Bot className="w-4 h-4 text-indigo-400" />,
    defaultConfig: {
      llm_backend: 'ollama',
      model: 'llama3.1',
      prompt: '브라우저를 열고 오늘 주요 뉴스를 확인해줘',
      system_prompt: '',
      include_screen_capture: false,
      skill_mode: 'preset',
      preset_name: 'basic_interaction',
      custom_skills: ['get_screen_elements', 'mouse_click', 'keyboard_type', 'window_activate', 'take_screenshot'],
      max_steps: 10,
      temperature: 0.3,
      output_variable: 'agent_result',
    },
    tags: ['ai', 'agent', '에이전트', '자율', '지능', '추론', '도구', '스킬', 'ollama', '기본에이전트'],
    isAi: true,
  },

  // 5. 워크플로우 구성 / 제어
  {
    type: 'flow_group',
    categoryId: 'workflow',
    label: '그룹 노드',
    desc: '연관된 노드들을 시각적으로 묶고 접었다 펼 수 있는 컨테이너 노드',
    icon: <FolderKanban className="w-4 h-4 text-teal-400" />,
    defaultConfig: {
      collapsed: false,
      width: 560,
      height: 260,
      color: 'indigo',
      description: '',
    },
    tags: ['그룹', '묶음', '폴더', '컨테이너', '접기', '펼치기', '정리', 'group', 'folder', 'container', 'collapse'],
  },
  {
    type: 'flow_call',
    categoryId: 'workflow',
    label: '다른 워크플로우 호출',
    desc: '기존에 저장된 서브 워크플로우를 호출하고 입출력 변수를 매핑하여 실행',
    icon: <GitBranchPlus className="w-4 h-4 text-cyan-400" />,
    defaultConfig: {
      target_flow_id: '',
      target_flow_name: '',
      variable_mappings: [],
    },
    tags: ['서브워크플로우', '호출', '다른워크플로우', '모듈', '재사용', '매핑', 'subflow', 'workflow', 'call', 'invoke'],
  },
];

export interface AgentAvailableSkill {
  id: string;
  name: string;
  category: string;
  desc: string;
}

export const AGENT_AVAILABLE_SKILLS: AgentAvailableSkill[] = [
  { id: 'get_screen_elements', name: '화면 UI 요소 스캔', category: 'AI 전용', desc: '활성 창의 버튼/입력창 및 좌표 스캔' },
  { id: 'mouse_click', name: '마우스 클릭', category: '마우스', desc: '지정 좌표 좌/우/더블 클릭' },
  { id: 'mouse_move', name: '마우스 이동', category: '마우스', desc: '지정 좌표로 커서 이동' },
  { id: 'mouse_drag', name: '마우스 드래그 앤 드롭', category: '마우스', desc: '지정 시작 좌표에서 끝 좌표로 드래그 앤 드롭' },
  { id: 'mouse_scroll', name: '마우스 스크롤', category: '마우스', desc: '현재 창 또는 지정 위치 상하/좌우 스크롤' },
  { id: 'keyboard_type', name: '텍스트 입력', category: '키보드', desc: '포커스 입력창에 텍스트 입력' },
  { id: 'keyboard_hotkey', name: '단축키 실행', category: '키보드', desc: '키보드 단축키 조합 실행' },
  { id: 'window_activate', name: '창 활성화', category: '윈도우', desc: '지정 창을 화면 맨 앞으로 가져오기' },
  { id: 'window_maximize', name: '창 최대화', category: '윈도우', desc: '지정 창 전체 화면 최대화' },
  { id: 'window_minimize', name: '창 최소화', category: '윈도우', desc: '지정 창 작업표시줄로 최소화' },
  { id: 'window_close', name: '창 닫기', category: '윈도우', desc: '지정 창 또는 현재 활성 창 닫기' },
  { id: 'take_screenshot', name: '스크린샷 촬영', category: '시스템', desc: '화면 캡처 및 저장/클립보드' },
  { id: 'delay', name: '대기 (Delay)', category: '시스템', desc: '지정 시간 동안 대기' },
  { id: 'clipboard_copy', name: '클립보드 복사', category: '시스템', desc: '텍스트를 클립보드에 복사' },
  { id: 'clipboard_read', name: '클립보드 읽기', category: '시스템', desc: '클립보드의 텍스트를 읽어 반환' },
  { id: 'file_read', name: '텍스트 파일 읽기', category: '시스템', desc: '로컬 텍스트 파일의 내용을 읽어 반환' },
  { id: 'file_write', name: '파일 쓰기', category: '시스템', desc: '텍스트를 로컬 파일로 저장 (덮어쓰기 옵션)' },
  { id: 'message_box', name: '사용자 대화상자 출력', category: '시스템', desc: '최상단 팝업 대화상자 출력 및 응답 수집' },
  { id: 'launch_program', name: '프로그램 실행', category: '시스템', desc: '지정 실행 파일(.exe) 또는 프로그램 실행' },
  { id: 'close_program', name: '프로그램 정상 종료', category: '시스템', desc: '지정 프로그램 정상 종료 (안전 가드레일 적용)' },
  { id: 'kill_process', name: '프로세스 강제 종료', category: '시스템', desc: '지정 프로세스 즉시 강제 종료 (안전 가드레일 적용)' },
];
