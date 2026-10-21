export type NodeType = 
  | 'flow_start'
  | 'flow_end'
  | 'flow_group'
  | 'flow_call'
  | 'general_mouse_click'
  | 'general_mouse_move'
  | 'general_mouse_drag'
  | 'general_mouse_scroll'
  | 'general_keyboard_type'
  | 'general_keyboard_hotkey'
  | 'general_delay'
  | 'general_clipboard_copy'
  | 'general_clipboard_read'
  | 'general_file_read'
  | 'general_file_write'
  | 'general_message_box'
  | 'general_window_activate'
  | 'general_window_maximize'
  | 'general_window_minimize'
  | 'general_window_close'
  | 'general_screenshot'
  | 'general_launch_program'
  | 'general_close_program'
  | 'general_kill_process'
  | 'browser_navigate'
  | 'browser_click'
  | 'browser_fill'
  | 'browser_extract'
  | 'browser_action'
  | 'browser_get_info'
  | 'browser_evaluate'
  | 'ai_ollama'
  | 'agent_basic';

export type SubflowMappingDirection = 'in' | 'out' | 'inout';

export interface SubflowVariableMapping {
  id?: string;
  direction: SubflowMappingDirection;
  parent_var: string;
  sub_var: string;
}

export interface GroupNodeConfig {
  collapsed?: boolean;
  width?: number;
  height?: number;
  color?: 'indigo' | 'emerald' | 'amber' | 'sky' | 'purple' | 'rose' | 'slate';
  description?: string;
}

export interface SubflowNodeConfig {
  target_flow_id?: string;
  target_flow_name?: string;
  variable_mappings?: SubflowVariableMapping[];
}

export interface AgentNodeConfig {
  llm_backend?: string;
  model?: string;
  prompt?: string;
  system_prompt?: string;
  include_screen_capture?: boolean;
  skill_mode?: 'preset' | 'custom';
  preset_name?: 'basic_interaction' | 'web_playwright' | 'all';
  custom_skills?: string[];
  max_steps?: number;
  temperature?: number;
  num_ctx?: number;
  output_variable?: string;
}

export interface NodeConfig {
  [key: string]: any;
}

export interface FlowNodeData {
  label: string;
  type: NodeType;
  config: NodeConfig;
  status?: 'idle' | 'running' | 'success' | 'error';
}

export type VariableType = 'string' | 'number' | 'boolean' | 'json';

export interface WorkflowVariable {
  name: string;
  type: VariableType;
  defaultValue: any;
  description?: string;
}

export interface WorkflowSettings {
  execution_delay: number;
  default_llm_model: string;
  default_num_ctx?: number;
}

export interface Flow {
  id: string;
  name: string;
  description?: string;
  graph_data: {
    nodes: any[];
    edges: any[];
    settings?: WorkflowSettings;
    variables?: WorkflowVariable[];
  };
  created_at: string;
  updated_at: string;
}

export interface ExecutionSession {
  id: string;
  flow_id: string;
  flow_name: string;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
  started_at: string;
  ended_at?: string;
}

export interface ExecutionMessage {
  id: string;
  session_id: string;
  node_id: string;
  node_name: string;
  node_type: 'GENERAL' | 'AI' | 'AGENT';
  event_type: 'START' | 'SUCCESS' | 'ERROR' | 'STREAM_CHUNK' | 'AGENT_THINKING' | 'AGENT_TOOL_CALL' | 'AGENT_TOOL_RESULT' | 'AGENT_STEP_START' | string;
  content: string;
  image_path?: string;
  created_at: string;
}

export interface AppSettings {
  auto_clean_sessions: boolean;
  max_session_history: number;
  ollama_base_url: string;
  kill_switch_hotkey: string;
  screenshot_format: string;
  screenshot_quality: number;
  capture_screen_after_execution: boolean;
}

export interface UIObjectData {
  id?: string;
  object_id?: string;
  name: string;
  orig_name?: string;
  control_type?: string;
  class_name?: string;
  automation_id?: string;
  window_title?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  image_url: string;
  base64_image?: string;
  confidence?: number;
  auto_focus_scroll?: boolean;
  process_id?: number;
  executable_path?: string;
}

export interface WebElementData {
  tag: string;
  input_type?: string;
  role?: string;
  id?: string;
  name?: string;
  text?: string;
  placeholder?: string;
  aria_label?: string;
  display_name: string;
  css_selector: string;
  xpath: string;
  recommended_type: 'css' | 'xpath' | 'text' | 'placeholder' | 'auto';
  recommended_selector: string;
  in_iframe?: boolean;
  frame_url?: string;
  page_url?: string;
  page_title?: string;
}

declare global {
  interface Window {
    electronAPI?: {
      isElectron: boolean;
      minimizeMainWindow: () => Promise<boolean>;
      restoreMainWindow: () => Promise<boolean>;
      openFileDialog?: (options?: any) => Promise<string | null>;
      startObjectPicker: (nodeId?: string) => Promise<boolean>;
      confirmObjectPicker: (objectData: UIObjectData) => Promise<boolean>;
      cancelObjectPicker: () => Promise<boolean>;
      reselectObjectPicker: () => Promise<boolean>;
      onPickerResult: (callback: (data: UIObjectData) => void) => void;
      onPickerUpdateSelection: (callback: (data: any) => void) => void;
      onPickerShowHighlight: (callback: (data: any) => void) => void;
      onPickerResetHighlight: (callback: () => void) => void;
      sendSelectedElement: (data: any) => void;
      sendHoverElement: (data: any) => void;

      // Agent Manager & System Tray IPC
      openFlowBuilderWindow?: (payload?: { flowId?: string; sessionId?: string; tab?: 'builder' | 'runner' }) => Promise<boolean>;
      openAgentManagerWindow?: (payload?: { tab?: 'workflows' | 'history'; sessionId?: string }) => Promise<boolean>;
      openRunnerSettingsWindow?: () => Promise<boolean>;
      closeRunnerSettingsWindow?: () => Promise<boolean>;
      hideAgentManagerToTray?: () => Promise<boolean>;
      showWorkflowNotification?: (payload: {
        title: string;
        body: string;
        status: 'SUCCESS' | 'FAILED' | 'CANCELLED' | string;
        flowId?: string;
        flowName?: string;
        sessionId?: string;
      }) => Promise<boolean>;
      onOpenFromManager?: (callback: (payload: { flowId?: string; sessionId?: string; tab?: 'builder' | 'runner' }) => void) => void;
      onAgentManagerShown?: (callback: (payload?: { tab?: 'workflows' | 'history'; sessionId?: string }) => void) => void;
    };
  }
}

