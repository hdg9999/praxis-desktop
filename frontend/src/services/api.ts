import { Flow, ExecutionSession, ExecutionMessage, AppSettings, UIObjectData, WebElementData } from '../types';

const isFileProtocol = typeof window !== 'undefined' && window.location.protocol === 'file:';
export const BACKEND_URL = 'http://127.0.0.1:8000';
export const API_BASE = isFileProtocol ? `${BACKEND_URL}/api` : '/api';

export function resolveImageUrl(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (isFileProtocol) return `${BACKEND_URL}${url}`;
  return url;
}

export async function fetchFlows(): Promise<Flow[]> {
  const res = await fetch(`${API_BASE}/flows`);
  if (!res.ok) throw new Error('Flow 목록 조회 실패');
  return res.json();
}

export async function createFlow(name: string, graphData: any, description?: string): Promise<Flow> {
  const res = await fetch(`${API_BASE}/flows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, graph_data: graphData, description }),
  });
  if (!res.ok) throw new Error('Flow 생성 실패');
  return res.json();
}

export async function updateFlow(id: string, name: string, graphData: any, description?: string): Promise<Flow> {
  const res = await fetch(`${API_BASE}/flows/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, graph_data: graphData, description }),
  });
  if (!res.ok) throw new Error('Flow 저장 실패');
  return res.json();
}

export async function deleteFlow(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/flows/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Flow 삭제 실패');
}

export async function runFlow(id: string): Promise<{ session_id: string; flow_id: string; flow_name: string }> {
  const res = await fetch(`${API_BASE}/flows/${id}/run`, { method: 'POST' });
  if (!res.ok) throw new Error('Flow 실행 시작 실패');
  return res.json();
}

export async function stopSession(sessionId: string): Promise<void> {
  await fetch(`${API_BASE}/sessions/${sessionId}/stop`, { method: 'POST' });
}

export async function fetchSessions(): Promise<ExecutionSession[]> {
  const res = await fetch(`${API_BASE}/sessions`);
  if (!res.ok) throw new Error('세션 목록 조회 실패');
  return res.json();
}

export async function fetchSessionMessages(sessionId: string): Promise<ExecutionMessage[]> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/messages`);
  if (!res.ok) throw new Error('메시지 이력 조회 실패');
  return res.json();
}

export async function deleteSession(sessionId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('세션 삭제 실패');
}

export async function fetchSettings(): Promise<AppSettings> {
  const res = await fetch(`${API_BASE}/settings`);
  if (!res.ok) throw new Error('설정 조회 실패');
  return res.json();
}

export async function updateSettings(data: Partial<AppSettings>): Promise<AppSettings> {
  const res = await fetch(`${API_BASE}/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('설정 저장 실패');
  return res.json();
}

export async function fetchOllamaInfo(): Promise<{ connected: boolean; base_url: string; models: string[] }> {
  const res = await fetch(`${API_BASE}/settings/ollama/info`);
  if (!res.ok) return { connected: false, base_url: '', models: [] };
  return res.json();
}

export async function checkBackendHealth(timeoutMs = 1500): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${BACKEND_URL}/health`, { signal: controller.signal });
    clearTimeout(timeoutId);
    return res.ok;
  } catch {
    return false;
  }
}

export function connectWebSocket(
  onEvent: (event: any) => void,
  onConnectChange?: (connected: boolean) => void
): () => void {
  // 백엔드 WebSocket(포트 8000)으로 직접 안정 연결 및 끊김 시 자동 재연결
  const wsUrl = 'ws://127.0.0.1:8000/api/ws';
  let ws: WebSocket | null = null;
  let isClosedByUser = false;
  let reconnectTimer: any = null;

  function initSocket() {
    if (isClosedByUser) return;
    try {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('[WebSocket] 백엔드 실시간 소켓 연결 성공 (8000)');
        onConnectChange?.(true);
      };

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          onEvent(data);
        } catch (err) {
          console.error('WS Parse Error', err);
        }
      };

      ws.onerror = (err) => {
        console.warn('WebSocket connection error:', err);
      };

      ws.onclose = () => {
        onConnectChange?.(false);
        if (!isClosedByUser) {
          // 2초 후 자동 재연결 시도
          reconnectTimer = setTimeout(() => {
            initSocket();
          }, 2000);
        }
      };
    } catch {
      if (!isClosedByUser) {
        reconnectTimer = setTimeout(() => {
          initSocket();
        }, 2000);
      }
    }
  }

  initSocket();

  return () => {
    isClosedByUser = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      ws.close();
    }
  };
}

export async function captureForPicker(): Promise<{
  image_url: string;
  base64_image: string;
  width: number;
  height: number;
}> {
  const res = await fetch(`${API_BASE}/picker/capture`, { method: 'POST' });
  if (!res.ok) throw new Error('오브젝트 선택기 화면 캡처 실패');
  return res.json();
}

export async function detectElementAtPoint(x: number, y: number): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
}> {
  const res = await fetch(`${API_BASE}/picker/detect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x, y }),
  });
  if (!res.ok) throw new Error('UI 엘리먼트 감지 실패');
  return res.json();
}

export async function cropElement(data: {
  x: number;
  y: number;
  width: number;
  height: number;
  name?: string;
}): Promise<any> {
  const res = await fetch(`${API_BASE}/picker/crop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('오브젝트 크롭 실패');
  return res.json();
}

export async function detectUIAElement(x: number, y: number): Promise<{
  found: boolean;
  element?: {
    name: string;
    control_type: string;
    class_name: string;
    automation_id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    handle: number;
  };
}> {
  const res = await fetch(`${API_BASE}/picker/uia-detect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x, y }),
  });
  if (!res.ok) throw new Error('UIA 엘리먼트 감지 실패');
  return res.json();
}

export async function captureUIAElement(data: {
  x: number;
  y: number;
  width: number;
  height: number;
  name?: string;
}): Promise<UIObjectData> {
  const res = await fetch(`${API_BASE}/picker/uia-capture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('UIA 오브젝트 캡처 실패');
  return res.json();
}

export async function startWebPicker(params?: {
  url?: string;
  browser_channel?: string;
  use_persistent_profile?: boolean;
}): Promise<{
  active: boolean;
  status: 'picking' | 'picked' | 'cancelled' | 'idle' | 'error';
  url?: string;
  title?: string;
}> {
  const res = await fetch(`${API_BASE}/picker/web-start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params || {}),
  });
  if (!res.ok) {
    let errMsg = '웹 요소 선택기 시작 실패';
    try {
      const errBody = await res.json();
      if (errBody?.detail) errMsg = errBody.detail;
    } catch {
      // ignore
    }
    throw new Error(errMsg);
  }
  return res.json();
}

export async function getWebPickerStatus(): Promise<{
  active: boolean;
  status: 'picking' | 'picked' | 'cancelled' | 'idle' | 'error';
  element?: WebElementData | null;
  error?: string | null;
}> {
  const res = await fetch(`${API_BASE}/picker/web-status`);
  if (!res.ok) throw new Error('웹 요소 선택기 상태 조회 실패');
  return res.json();
}

export async function cancelWebPicker(): Promise<{
  active: boolean;
  status: string;
}> {
  const res = await fetch(`${API_BASE}/picker/web-cancel`, { method: 'POST' });
  if (!res.ok) throw new Error('웹 요소 선택기 취소 실패');
  return res.json();
}

