const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  minimizeMainWindow: () => ipcRenderer.invoke('window:minimize'),
  restoreMainWindow: () => ipcRenderer.invoke('window:restore'),
  openFileDialog: (options) => ipcRenderer.invoke('dialog:open-file', options),

  // 독립 듀얼 윈도우 오브젝트 피커 제어
  startObjectPicker: (nodeId) => ipcRenderer.invoke('picker:start', nodeId),
  confirmObjectPicker: (objectData) => ipcRenderer.invoke('picker:confirm', objectData),
  cancelObjectPicker: () => ipcRenderer.invoke('picker:cancel'),
  reselectObjectPicker: () => ipcRenderer.invoke('picker:reselect'),

  // 창 간 상태 동기화 리스너
  onPickerResult: (callback) => {
    ipcRenderer.removeAllListeners('picker:result');
    ipcRenderer.on('picker:result', (_event, data) => callback(data));
  },
  onPickerUpdateSelection: (callback) => {
    ipcRenderer.removeAllListeners('picker:update-selection');
    ipcRenderer.on('picker:update-selection', (_event, data) => callback(data));
  },
  onPickerShowHighlight: (callback) => {
    ipcRenderer.removeAllListeners('picker:show-highlight');
    ipcRenderer.on('picker:show-highlight', (_event, data) => callback(data));
  },
  onPickerResetHighlight: (callback) => {
    ipcRenderer.removeAllListeners('picker:reset-highlight');
    ipcRenderer.on('picker:reset-highlight', (_event, data) => callback(data));
  },

  // 이벤트 발행
  sendSelectedElement: (data) => ipcRenderer.send('picker:element-selected', data),
  sendHoverElement: (data) => ipcRenderer.send('picker:element-hover', data),

  // Agent Manager & 시스템 트레이 관련 IPC
  openFlowBuilderWindow: (payload) => ipcRenderer.invoke('window:open-flow-builder', payload),
  openAgentManagerWindow: (payload) => ipcRenderer.invoke('window:open-agent-manager', payload),
  openRunnerSettingsWindow: () => ipcRenderer.invoke('window:open-runner-settings'),
  closeRunnerSettingsWindow: () => ipcRenderer.invoke('window:close-runner-settings'),
  hideAgentManagerToTray: () => ipcRenderer.invoke('agent-manager:hide-to-tray'),
  showWorkflowNotification: (payload) => ipcRenderer.invoke('notify:workflow-result', payload),

  onOpenFromManager: (callback) => {
    ipcRenderer.removeAllListeners('flow-builder:open-from-manager');
    ipcRenderer.on('flow-builder:open-from-manager', (_event, payload) => callback(payload));
  },
  onAgentManagerShown: (callback) => {
    ipcRenderer.removeAllListeners('agent-manager:shown');
    ipcRenderer.on('agent-manager:shown', (_event, payload) => callback(payload));
  },
});
