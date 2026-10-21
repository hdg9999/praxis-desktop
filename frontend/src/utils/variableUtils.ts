import { Node } from '@xyflow/react';
import { VariableType, WorkflowVariable, FlowNodeData } from '../types';

export interface SystemVariableInfo {
  name: string;
  type: VariableType;
  description: string;
  descriptionKo: string;
  descriptionEn: string;
  readonly: boolean;
}

/**
 * 엔진에서 기본 제공하는 시스템 내장 변수 / 플레이스홀더 목록
 */
export const SYSTEM_VARIABLES: SystemVariableInfo[] = [
  {
    name: 'last_output',
    type: 'string',
    description: '직전 실행된 노드의 결과 출력값',
    descriptionKo: '직전 실행된 노드의 결과 출력값',
    descriptionEn: 'Output value of the immediately preceding node',
    readonly: true,
  },
  {
    name: 'timestamp',
    type: 'string',
    description: '실행 시점 일시 (YYYYMMDD_HHMMSS)',
    descriptionKo: '실행 시점 일시 (YYYYMMDD_HHMMSS)',
    descriptionEn: 'Execution timestamp (YYYYMMDD_HHMMSS)',
    readonly: true,
  },
  {
    name: 'date',
    type: 'string',
    description: '실행 시점 날짜 (YYYYMMDD)',
    descriptionKo: '실행 시점 날짜 (YYYYMMDD)',
    descriptionEn: 'Execution date (YYYYMMDD)',
    readonly: true,
  },
  {
    name: 'time',
    type: 'string',
    description: '실행 시점 시각 (HHMMSS)',
    descriptionKo: '실행 시점 시각 (HHMMSS)',
    descriptionEn: 'Execution time (HHMMSS)',
    readonly: true,
  },
  {
    name: 'scroll_at_start',
    type: 'boolean',
    description: '마우스 스크롤 맨 처음 도달 여부 (true/false)',
    descriptionKo: '마우스 스크롤 맨 처음 도달 여부 (true/false)',
    descriptionEn: 'Whether mouse scroll reached the very beginning',
    readonly: true,
  },
  {
    name: 'scroll_at_end',
    type: 'boolean',
    description: '마우스 스크롤 맨 끝 도달 여부 (true/false)',
    descriptionKo: '마우스 스크롤 맨 끝 도달 여부 (true/false)',
    descriptionEn: 'Whether mouse scroll reached the very end',
    readonly: true,
  },
];

export const SYSTEM_VARIABLE_NAMES = new Set(SYSTEM_VARIABLES.map((v) => v.name));

export function isSystemVariable(name: string): boolean {
  return SYSTEM_VARIABLE_NAMES.has((name || '').trim());
}

/**
 * 변수명 식별자 문법 검사 (영문, 숫자, 언더스코어, 한글 허용 / 숫자로 시작 불가 / 공백·특수문자 불가)
 */
export function validateVariableNameFormat(
  name: string,
  isEn = false
): { valid: boolean; reason?: string } {
  const trimmed = (name || '').trim();
  if (!trimmed) {
    return {
      valid: false,
      reason: isEn ? 'Variable name cannot be empty.' : '변수 이름을 입력해 주세요.',
    };
  }
  if (/^[0-9]/.test(trimmed)) {
    return {
      valid: false,
      reason: isEn
        ? 'Variable name cannot start with a number.'
        : '변수 이름은 숫자로 시작할 수 없습니다.',
    };
  }
  if (!/^[a-zA-Z0-9_\uAC00-\uD7A3]+$/.test(trimmed)) {
    return {
      valid: false,
      reason: isEn
        ? 'Only letters, numbers, Korean characters, and underscores (_) are allowed.'
        : '변수 이름에는 영문, 한글, 숫자, 언더스코어(_)만 사용할 수 있습니다. (공백/특수기호 불가)',
    };
  }
  if (SYSTEM_VARIABLE_NAMES.has(trimmed)) {
    return {
      valid: false,
      reason: isEn
        ? `'${trimmed}' is a reserved system variable name.`
        : `'${trimmed}'은(는) 시스템 예약 변수명이므로 사용할 수 없습니다.`,
    };
  }
  return { valid: true };
}

const VALID_VAR_TYPES = new Set<string>(['string', 'number', 'boolean', 'json']);

/**
 * 프론트엔드(TS) <-> 백엔드(Python) 간 이종 언어 전달 오류 방지를 위한
 * 변수 타입별 초기값 정규화 및 검증
 */
export function normalizeVariableValue(
  arg1: any,
  arg2: any
): { value: any; normalizedValue: any; isValid: boolean; valid: boolean; error?: string } {
  let type: VariableType = 'string';
  let rawValue: any;

  if (typeof arg1 === 'string' && VALID_VAR_TYPES.has(arg1) && !VALID_VAR_TYPES.has(String(arg2))) {
    type = arg1 as VariableType;
    rawValue = arg2;
  } else if (typeof arg2 === 'string' && VALID_VAR_TYPES.has(arg2)) {
    type = arg2 as VariableType;
    rawValue = arg1;
  } else {
    type = (arg1 as VariableType) || 'string';
    rawValue = arg2;
  }

  const wrap = (val: any, ok: boolean, err?: string) => ({
    value: val,
    normalizedValue: val,
    isValid: ok,
    valid: ok,
    error: err,
  });

  if (type === 'string') {
    if (rawValue === null || rawValue === undefined) {
      return wrap('', true);
    }
    if (typeof rawValue === 'object') {
      try {
        return wrap(JSON.stringify(rawValue), true);
      } catch {
        return wrap(String(rawValue), true);
      }
    }
    return wrap(String(rawValue), true);
  }

  if (type === 'number') {
    if (rawValue === '' || rawValue === null || rawValue === undefined) {
      return wrap(0, true);
    }
    if (typeof rawValue === 'boolean') {
      return wrap(rawValue ? 1 : 0, true);
    }
    const num = Number(rawValue);
    if (!Number.isFinite(num)) {
      return wrap(0, false, `숫자(Number) 형식이 올바르지 않습니다: "${rawValue}"`);
    }
    return wrap(num, true);
  }

  if (type === 'boolean') {
    if (typeof rawValue === 'boolean') {
      return wrap(rawValue, true);
    }
    if (rawValue === null || rawValue === undefined || rawValue === '') {
      return wrap(false, true);
    }
    const str = String(rawValue).trim().toLowerCase();
    if (str === 'true' || str === '1' || str === 'yes') {
      return wrap(true, true);
    }
    if (str === 'false' || str === '0' || str === 'no') {
      return wrap(false, true);
    }
    return wrap(false, false, `논리값(Boolean)은 true 또는 false여야 합니다: "${rawValue}"`);
  }

  if (type === 'json') {
    if (rawValue === null || rawValue === undefined || String(rawValue).trim() === '') {
      return wrap('{}', true);
    }
    if (typeof rawValue === 'object') {
      try {
        return wrap(JSON.stringify(rawValue), true);
      } catch (e: any) {
        return wrap('{}', false, e?.message || 'JSON 직렬화 실패');
      }
    }
    const str = String(rawValue).trim();
    try {
      const parsed = JSON.parse(str);
      return wrap(JSON.stringify(parsed), true);
    } catch {
      return wrap(
        str,
        false,
        '유효한 JSON 포맷이 아닙니다. (예: {"key": "value"} 또는 [1, 2, 3])'
      );
    }
  }

  return wrap(String(rawValue ?? ''), true);
}

/**
 * 변수의 기본 초기값 반환
 */
export function getDefaultValueForType(type: VariableType): any {
  switch (type) {
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'json':
      return '{}';
    case 'string':
    default:
      return '';
  }
}

/**
 * 출력 변수를 사용하는 노드의 기대 변수 타입 반환
 */
export function getNodeOutputVariableRequirement(
  nodeType: string,
  config: Record<string, any>
): { usesOutputVar: boolean; expectedTypes: VariableType[]; defaultVarName: string } {
  if (nodeType === 'ai_ollama') {
    return {
      usesOutputVar: true,
      expectedTypes: ['string', 'json'],
      defaultVarName: 'ai_output',
    };
  }
  if (nodeType === 'agent_basic') {
    return {
      usesOutputVar: true,
      expectedTypes: ['string', 'json'],
      defaultVarName: 'agent_result',
    };
  }
  if (nodeType === 'general_clipboard_read') {
    return {
      usesOutputVar: true,
      expectedTypes: ['string', 'json'],
      defaultVarName: 'clipboard_text',
    };
  }
  if (nodeType === 'general_file_read') {
    return {
      usesOutputVar: true,
      expectedTypes: ['string', 'json'],
      defaultVarName: 'file_content',
    };
  }
  if (nodeType === 'general_message_box' && config?.button_type === 'yes_no') {
    return {
      usesOutputVar: true,
      expectedTypes: ['boolean', 'string'],
      defaultVarName: 'dialog_result',
    };
  }
  if (nodeType === 'browser_extract') {
    return {
      usesOutputVar: true,
      expectedTypes: ['string', 'json'],
      defaultVarName: 'web_content',
    };
  }
  if (nodeType === 'browser_get_info') {
    return {
      usesOutputVar: true,
      expectedTypes: ['string', 'json'],
      defaultVarName: 'web_info',
    };
  }
  if (nodeType === 'browser_evaluate') {
    return {
      usesOutputVar: true,
      expectedTypes: ['string', 'number', 'boolean', 'json'],
      defaultVarName: 'js_result',
    };
  }
  if (nodeType === 'browser_action' && config?.action_type === 'wait_for_download') {
    return {
      usesOutputVar: true,
      expectedTypes: ['string', 'json'],
      defaultVarName: 'downloaded_file_path',
    };
  }
  return {
    usesOutputVar: false,
    expectedTypes: [],
    defaultVarName: '',
  };
}

/**
 * 문자열 내의 모든 {{변수명}} 참조 추출
 */
export function extractTemplateVariables(text: any): string[] {
  if (typeof text !== 'string' || !text.includes('{{')) return [];
  const matches: string[] = [];
  const regex = /\{\{([^}]+)\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const varName = match[1].trim();
    if (varName && !matches.includes(varName)) {
      matches.push(varName);
    }
  }
  return matches;
}

/**
 * 단일 노드의 config에서 참조하고 있는 모든 {{변수명}} 목록과 출력 변수명 추출
 */
export function analyzeNodeVariableUsage(node: Node): {
  outputVar: string | null;
  expectedOutputTypes: VariableType[];
  referencedVars: string[];
  numericFieldVars: { field: string; varName: string }[];
} {
  const data = (node.data as unknown as FlowNodeData) || { type: node.type as any, config: {} };
  const cfg = data.config || {};
  const nodeType = data.type || node.type || '';

  const outReq = getNodeOutputVariableRequirement(nodeType, cfg);
  let outputVar: string | null = null;
  if (outReq.usesOutputVar) {
    outputVar = typeof cfg.output_variable === 'string' ? cfg.output_variable.trim() : '';
  }

  // 텍스트 템플릿을 지원하는 필드들에서 {{변수명}} 추출
  const textFields = [
    'text',
    'prompt',
    'system_prompt',
    'window_title',
    'file_path',
    'program_path',
    'arguments',
    'process_name',
    'content',
    'title',
    'message',
    'url',
    'selector',
    'attribute_name',
    'target_value',
    'option_value',
    'script',
  ];

  const referencedSet = new Set<string>();
  for (const field of textFields) {
    const val = cfg[field];
    for (const v of extractTemplateVariables(val)) {
      referencedSet.add(v);
    }
  }

  // 숫자 좌표 등에 {{변수명}}이 들어간 경우
  const numericFields = ['x', 'y', 'start_x', 'start_y', 'end_x', 'end_y', 'seconds', 'duration', 'interval', 'ticks'];
  const numericFieldVars: { field: string; varName: string }[] = [];
  for (const nf of numericFields) {
    const val = cfg[nf];
    for (const v of extractTemplateVariables(val)) {
      referencedSet.add(v);
      numericFieldVars.push({ field: nf, varName: v });
    }
  }

  // 서브 워크플로우 호출(flow_call) 노드의 변수 매핑에서도 참조 변수 수집
  if (nodeType === 'flow_call' && Array.isArray(cfg.variable_mappings)) {
    for (const mp of cfg.variable_mappings) {
      const pVar = (mp?.parent_var || '').trim();
      if (pVar) {
        referencedSet.add(pVar);
      }
    }
  }

  return {
    outputVar,
    expectedOutputTypes: outReq.expectedTypes,
    referencedVars: Array.from(referencedSet),
    numericFieldVars,
  };
}

/**
 * 레거시 워크플로우(graph_data.variables가 아직 없는 기존 저장본) 로드 시
 * 노드들에 지정되어 있던 output_variable을 스캔하여 초기 변수 목록으로 자동 마이그레이션
 */
export function extractVariablesFromLegacyNodes(nodes: Node[]): WorkflowVariable[] {
  const map = new Map<string, WorkflowVariable>();

  for (const node of nodes) {
    const data = (node.data as unknown as FlowNodeData) || { type: node.type as any, config: {} };
    const cfg = data.config || {};
    const nodeType = data.type || node.type || '';
    const outReq = getNodeOutputVariableRequirement(nodeType, cfg);

    if (outReq.usesOutputVar) {
      const varName = (cfg.output_variable || outReq.defaultVarName || '').trim();
      if (varName && !SYSTEM_VARIABLE_NAMES.has(varName) && !map.has(varName)) {
        const primaryType: VariableType = outReq.expectedTypes[0] || 'string';
        map.set(varName, {
          name: varName,
          type: primaryType,
          defaultValue: getDefaultValueForType(primaryType),
          description: `${data.label || nodeType} 출력 변수`,
        });
      }
    }
  }

  return Array.from(map.values());
}
