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
    ipcRenderer.on('picker:result', (_event, data) => callback(data));
  },
  onPickerUpdateSelection: (callback) => {
    ipcRenderer.on('picker:update-selection', (_event, data) => callback(data));
  },
  onPickerShowHighlight: (callback) => {
    ipcRenderer.on('picker:show-highlight', (_event, data) => callback(data));
  },
  onPickerResetHighlight: (callback) => {
    ipcRenderer.on('picker:reset-highlight', (_event, data) => callback(data));
  },

  // 이벤트 발행
  sendSelectedElement: (data) => ipcRenderer.send('picker:element-selected', data),
  sendHoverElement: (data) => ipcRenderer.send('picker:element-hover', data),
});
