const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  dialog,
  Tray,
  Menu,
  Notification,
  nativeImage,
} = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');

// Windows OS 토스트 알림(Notification) 호환성을 위한 AppUserModelId 설정
if (process.platform === 'win32') {
  app.setAppUserModelId(app.isPackaged ? 'com.praxis.desktop' : process.execPath);
}

let mainWindow = null;
let agentManagerWindow = null;
let runnerSettingsWindow = null;
let backendProcess = null;
let pickerPanelWindow = null;
let highlightOverlayWindow = null;
let tray = null;
let isQuitting = false;

// 아이콘 파일 유실 시에도 100% 동작을 보장하는 내장 32x32 PNG Data URL 폴백
const FALLBACK_ICON_DATA_URL =
  'data:image/png;base64,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';

function getAppIcon() {
  const icoPath = path.join(__dirname, 'icon.ico');
  const pngPath = path.join(__dirname, 'icon.png');
  try {
    if (process.platform === 'win32' && fs.existsSync(icoPath)) {
      const img = nativeImage.createFromPath(icoPath);
      if (!img.isEmpty()) return img;
    }
    if (fs.existsSync(pngPath)) {
      const img = nativeImage.createFromPath(pngPath);
      if (!img.isEmpty()) return img;
    }
  } catch {}
  return nativeImage.createFromDataURL(FALLBACK_ICON_DATA_URL);
}

function bringWindowToFront(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) {
    win.restore();
  }
  win.show();
  win.setAlwaysOnTop(true);
  win.focus();
  win.setAlwaysOnTop(false);
}

function loadAppUrl(windowInstance, queryParam = '') {
  const isViteUpPromise = checkUrl('http://localhost:5173');
  const distPath = path.join(__dirname, '../dist/index.html');

  isViteUpPromise.then((isViteUp) => {
    if (!windowInstance || windowInstance.isDestroyed()) return;
    if (isViteUp) {
      windowInstance.loadURL(`http://localhost:5173/${queryParam ? '?' + queryParam : ''}`);
    } else if (fs.existsSync(distPath)) {
      if (queryParam) {
        windowInstance.loadFile(distPath, { search: '?' + queryParam });
      } else {
        windowInstance.loadFile(distPath);
      }
    } else {
      windowInstance.loadURL(`http://localhost:5173/${queryParam ? '?' + queryParam : ''}`);
    }
  });
}

function callPickerApi(action) {
  try {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 8000,
      path: `/api/picker/${action}`,
      method: 'POST',
      timeout: 1000,
    });
    req.on('error', () => {});
    req.end();
  } catch {}
}

async function startPickerWindows() {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    mainWindow.minimize();
  }

  const displays = screen.getAllDisplays();
  let minX = 0;
  let minY = 0;
  let maxX = 1920;
  let maxY = 1080;

  if (displays && displays.length > 0) {
    minX = Math.min(...displays.map((d) => d.bounds.x));
    minY = Math.min(...displays.map((d) => d.bounds.y));
    maxX = Math.max(...displays.map((d) => d.bounds.x + d.bounds.width));
    maxY = Math.max(...displays.map((d) => d.bounds.y + d.bounds.height));
  }

  const totalWidth = maxX - minX;
  const totalHeight = maxY - minY;

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: workAreaWidth } = primaryDisplay.workAreaSize;
  const { x: primaryX, y: primaryY } = primaryDisplay.bounds;

  // 1. 전체 가상 화면 투명 하이라이트 오버레이 창 (독립 창, 마우스 100% 관통)
  highlightOverlayWindow = new BrowserWindow({
    x: minX,
    y: minY,
    width: totalWidth,
    height: totalHeight,
    transparent: true,
    frame: false,
    hasShadow: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    enableLargerThanScreen: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
  });
  highlightOverlayWindow.setIgnoreMouseEvents(true, { forward: true });
  highlightOverlayWindow.setAlwaysOnTop(true, 'screen-saver');
  loadAppUrl(highlightOverlayWindow, `mode=picker_overlay&offsetX=${minX}&offsetY=${minY}`);

  // 2. 소형 오브젝트 선택기 패널 창 (독립 창, 크기 조절 지원)
  pickerPanelWindow = new BrowserWindow({
    width: 400,
    height: 620,
    minWidth: 360,
    minHeight: 460,
    x: Math.max(20, primaryX + workAreaWidth - 430),
    y: Math.max(20, primaryY + 30),
    frame: false,
    resizable: true,
    maximizable: false,
    skipTaskbar: false,
    icon: getAppIcon(),
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
  });
  pickerPanelWindow.setAlwaysOnTop(true, 'screen-saver');
  loadAppUrl(pickerPanelWindow, 'mode=picker_panel');

  pickerPanelWindow.on('closed', () => {
    pickerPanelWindow = null;
    if (highlightOverlayWindow && !highlightOverlayWindow.isDestroyed()) {
      highlightOverlayWindow.close();
    }
    callPickerApi('stop-worker');
  });

  highlightOverlayWindow.on('closed', () => {
    highlightOverlayWindow = null;
    if (pickerPanelWindow && !pickerPanelWindow.isDestroyed()) {
      pickerPanelWindow.close();
    }
    callPickerApi('stop-worker');
  });

  // 백엔드 전역 UIA 마우스 피커 워커 시작
  callPickerApi('start-worker');
}

function closePickerWindows() {
  callPickerApi('stop-worker');

  if (pickerPanelWindow && !pickerPanelWindow.isDestroyed()) {
    pickerPanelWindow.close();
  }
  if (highlightOverlayWindow && !highlightOverlayWindow.isDestroyed()) {
    highlightOverlayWindow.close();
  }
  pickerPanelWindow = null;
  highlightOverlayWindow = null;

  if (mainWindow && !mainWindow.isDestroyed()) {
    bringWindowToFront(mainWindow);
  }
}

// ============================================================================
// 멀티 윈도우 관리: Flow Builder / Agent Manager / Runner 환경 설정
// ============================================================================

async function openFlowBuilderWindow(payload = null) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    await createWindow();
  }
  bringWindowToFront(mainWindow);
  if (payload && mainWindow && !mainWindow.isDestroyed()) {
    // 창이 로드 완료된 상태면 즉시 전송, 아니면 로드 완료 직후 전송
    if (mainWindow.webContents.isLoading()) {
      mainWindow.webContents.once('did-finish-load', () => {
        mainWindow.webContents.send('flow-builder:open-from-manager', payload);
      });
    } else {
      mainWindow.webContents.send('flow-builder:open-from-manager', payload);
    }
  }
  return true;
}

function ensureAgentManagerWindow(showImmediately = false) {
  if (agentManagerWindow && !agentManagerWindow.isDestroyed()) {
    if (showImmediately) {
      bringWindowToFront(agentManagerWindow);
    }
    return agentManagerWindow;
  }

  agentManagerWindow = new BrowserWindow({
    width: 560,
    height: 680,
    minWidth: 420,
    minHeight: 480,
    show: showImmediately,
    title: 'Praxis Desktop - Agent Manager',
    icon: getAppIcon(),
    backgroundColor: '#020617',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      backgroundThrottling: false, // 트레이에 최소화된 동안에도 WebSocket 및 완료 알림이 지연 없이 작동하도록 보장
    },
  });

  loadAppUrl(agentManagerWindow, 'mode=agent_manager');

  // 우상단 X 닫기 버튼 클릭 시 완전히 종료하지 않고 시스템 트레이에 상주
  agentManagerWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      agentManagerWindow.hide();
    }
  });

  agentManagerWindow.on('closed', () => {
    agentManagerWindow = null;
  });

  return agentManagerWindow;
}

async function openAgentManagerWindow(payload = null) {
  const win = ensureAgentManagerWindow(true);
  bringWindowToFront(win);
  if (win && !win.isDestroyed()) {
    if (win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', () => {
        win.webContents.send('agent-manager:shown', payload || {});
      });
    } else {
      win.webContents.send('agent-manager:shown', payload || {});
    }
  }
  return true;
}

async function openRunnerSettingsWindow() {
  if (runnerSettingsWindow && !runnerSettingsWindow.isDestroyed()) {
    bringWindowToFront(runnerSettingsWindow);
    return true;
  }

  runnerSettingsWindow = new BrowserWindow({
    width: 480,
    height: 360,
    minWidth: 420,
    minHeight: 300,
    resizable: false,
    maximizable: false,
    minimizable: false,
    title: 'Praxis Desktop - Runner 환경 설정',
    icon: getAppIcon(),
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
  });

  loadAppUrl(runnerSettingsWindow, 'mode=runner_settings');

  runnerSettingsWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      runnerSettingsWindow.hide();
    }
  });

  runnerSettingsWindow.on('closed', () => {
    runnerSettingsWindow = null;
  });

  bringWindowToFront(runnerSettingsWindow);
  return true;
}

function createSystemTray() {
  if (tray && !tray.isDestroyed()) return tray;

  const icon = getAppIcon();
  const trayIcon = process.platform === 'win32' ? icon.resize({ width: 16, height: 16 }) : icon;
  tray = new Tray(trayIcon);
  tray.setToolTip('Praxis Desktop - Agentic RPA Studio');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Flow Builder 열기',
      click: () => {
        openFlowBuilderWindow();
      },
    },
    {
      label: 'Agent Manager 열기',
      click: () => {
        openAgentManagerWindow();
      },
    },
    {
      label: 'Runner 환경 설정',
      click: () => {
        openRunnerSettingsWindow();
      },
    },
    { type: 'separator' },
    {
      label: '프로그램 종료',
      click: () => {
        isQuitting = true;
        killBackend();
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // 시스템 트레이 아이콘 더블클릭 시 Agent Manager 화면 출력
  tray.on('double-click', () => {
    openAgentManagerWindow();
  });

  return tray;
}

// ============================================================================
// IPC 핸들러 등록
// ============================================================================

ipcMain.handle('window:minimize', async () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize();
    return true;
  }
  return false;
});

ipcMain.handle('window:restore', async () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    bringWindowToFront(mainWindow);
    return true;
  }
  return false;
});

ipcMain.handle('window:open-flow-builder', async (_event, payload) => {
  return openFlowBuilderWindow(payload);
});

ipcMain.handle('window:open-agent-manager', async (_event, payload) => {
  return openAgentManagerWindow(payload);
});

ipcMain.handle('window:open-runner-settings', async () => {
  return openRunnerSettingsWindow();
});

ipcMain.handle('window:close-runner-settings', async () => {
  if (runnerSettingsWindow && !runnerSettingsWindow.isDestroyed()) {
    runnerSettingsWindow.hide();
    return true;
  }
  return false;
});

// Agent Manager에서 워크플로우 실행 시 시스템 트레이로 최소화(숨김)
ipcMain.handle('agent-manager:hide-to-tray', async () => {
  if (agentManagerWindow && !agentManagerWindow.isDestroyed()) {
    agentManagerWindow.hide();
    return true;
  }
  return false;
});

// Agent Manager에서 실행한 워크플로우 종료 시 OS Toast 알림 출력 (창 복구는 하지 않음)
ipcMain.handle('notify:workflow-result', async (_event, payload) => {
  try {
    const title = (payload && payload.title) || 'Praxis Desktop';
    const body = (payload && payload.body) || '';
    const status = (payload && payload.status) || 'SUCCESS';
    const icon = getAppIcon();

    if (process.platform === 'win32' && tray && !tray.isDestroyed()) {
      // Windows 10/11에서 트레이 아이콘 기반 네이티브 OS 토스트 배너를 100% 보장 출력
      const iconType =
        status === 'FAILED' ? 'error' : status === 'CANCELLED' ? 'warning' : 'info';
      tray.displayBalloon({
        icon,
        iconType,
        title,
        content: body,
      });
      return true;
    }

    if (Notification.isSupported()) {
      const notification = new Notification({
        title,
        body,
        icon,
      });
      notification.show();
      return true;
    }
  } catch (err) {
    console.warn('[Electron] 워크플로우 실행 결과 토스트 알림 표시 실패:', err);
  }
  return false;
});

// IPC 오브젝트 피커 듀얼 윈도우 제어 핸들러
ipcMain.handle('picker:start', async () => {
  await startPickerWindows();
  return true;
});

ipcMain.handle('picker:confirm', async (_event, objectData) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('picker:result', objectData);
  }
  closePickerWindows();
  return true;
});

ipcMain.handle('picker:cancel', async () => {
  closePickerWindows();
  return true;
});

ipcMain.handle('picker:reselect', async () => {
  callPickerApi('reselect-worker');
  if (highlightOverlayWindow && !highlightOverlayWindow.isDestroyed()) {
    highlightOverlayWindow.webContents.send('picker:reset-highlight');
  }
  return true;
});

ipcMain.handle('dialog:open-file', async (_event, options) => {
  const defaultOptions = {
    title: '실행할 프로그램 파일 선택',
    properties: ['openFile'],
    filters: [
      { name: '실행 가능 파일 (*.exe, *.bat, *.cmd, *.lnk)', extensions: ['exe', 'bat', 'cmd', 'lnk'] },
      { name: '모든 파일 (*.*)', extensions: ['*'] },
    ],
  };
  const targetWin = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  const result = await dialog.showOpenDialog(targetWin, { ...defaultOptions, ...(options || {}) });
  if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.on('picker:element-selected', (_event, data) => {
  if (pickerPanelWindow && !pickerPanelWindow.isDestroyed()) {
    pickerPanelWindow.webContents.send('picker:update-selection', data);
  }
});

function checkUrl(url, timeoutMs = 500) {
  return new Promise((resolve) => {
    try {
      const req = http.get(url, (res) => {
        resolve(res.statusCode >= 200 && res.statusCode < 500);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}

async function waitForBackend(maxWaitMs = 10000, intervalMs = 250) {
  const startTime = Date.now();
  console.log('[Electron] 백엔드 준비 완료 대기 중 (http://127.0.0.1:8000/health)...');
  while (Date.now() - startTime < maxWaitMs) {
    const isUp = await checkUrl('http://127.0.0.1:8000/health', 300);
    if (isUp) {
      console.log(`[Electron] 백엔드 준비 완료 확인 (${Date.now() - startTime}ms 소요)`);
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  console.warn(`[Electron] 백엔드 준비 대기 시간 초과(${maxWaitMs / 1000}초), 계속 진행합니다.`);
  return false;
}

async function startBackend() {
  const isRunning = await checkUrl('http://127.0.0.1:8000/health', 250);
  if (isRunning) {
    console.log('[Electron] 백엔드가 이미 정상 실행 중입니다.');
    return;
  }

  const backendDir = path.resolve(__dirname, '../../backend');
  const pythonCandidates = [
    path.join(backendDir, '.venv/Scripts/python.exe'),
    path.join(backendDir, 'venv/Scripts/python.exe'),
  ];
  const pythonExe = pythonCandidates.find((p) => fs.existsSync(p));

  if (pythonExe) {
    console.log('[Electron] 백엔드 프로세스를 직접 시작합니다:', pythonExe);
    backendProcess = spawn(pythonExe, ['run.py'], {
      cwd: backendDir,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
      stdio: 'ignore',
      detached: false,
      windowsHide: true,
    });
    await waitForBackend(10000, 250);
  } else {
    console.warn('[Electron] Python 가상환경을 찾을 수 없습니다 (.venv 또는 venv).');
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    title: 'Praxis Desktop - Agentic RPA Studio',
    icon: getAppIcon(),
    backgroundColor: '#020617',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // 로컬 파일 및 이미지 접근 허용
      backgroundThrottling: false,
    },
    autoHideMenuBar: true,
  });

  // 백엔드 백그라운드 시작 (창 렌더링과 병렬 진행)
  const backendPromise = startBackend();

  const isViteUp = await checkUrl('http://localhost:5173', 400);
  const distPath = path.join(__dirname, '../dist/index.html');

  if (isViteUp) {
    console.log('[Electron] Vite 개발 서버(http://localhost:5173)로 연결합니다.');
    await mainWindow.loadURL('http://localhost:5173');
  } else if (fs.existsSync(distPath)) {
    console.log('[Electron] 빌드된 dist 패키지로 실행합니다:', distPath);
    await mainWindow.loadFile(distPath);
  } else {
    console.warn('[Electron] dist 빌드 산출물 또는 Vite 개발 서버를 찾을 수 없습니다.');
    const errorHtml = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><title>Praxis Desktop - 초기화 필요</title></head>
      <body style="background:#020617;color:#f8fafc;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
        <div style="text-align:center;max-width:520px;padding:36px;background:#0f172a;border-radius:16px;border:1px solid #1e293b;box-shadow:0 10px 25px rgba(0,0,0,0.5);">
          <div style="font-size:36px;margin-bottom:12px;">⚙️</div>
          <h2 style="color:#60a5fa;margin:0 0 12px 0;">Praxis Desktop 초기화 필요</h2>
          <p style="color:#94a3b8;font-size:14px;line-height:1.6;margin:0 0 20px 0;">프론트엔드 빌드 파일(dist)이 감지되지 않았습니다.<br>루트 디렉터리의 <b>run_electron.bat</b>을 실행하시면 필요한 패키지 설치 및 빌드가 자동으로 완료됩니다.</p>
          <div style="background:#1e293b;padding:12px;border-radius:8px;color:#cbd5e1;font-family:monospace;font-size:12px;">cd frontend && npm install && npm run build</div>
        </div>
      </body>
      </html>
    `;
    await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml)}`);
  }

  await backendPromise;

  // Flow Builder 창 닫을 시(우상단 X 버튼) 프로그램 종료 대신 시스템 트레이로 숨김
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Agent Manager 창을 백그라운드에 사전 준비하여 트레이 더블클릭 시 즉시 팝업되도록 구성
  ensureAgentManagerWindow(false);
}

// 중복 실행 방지: 이미 실행 중일 경우 기존 Flow Builder 창을 전면으로 활성화
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    openFlowBuilderWindow();
  });

  app.whenReady().then(() => {
    createSystemTray();
    createWindow();

    app.on('activate', () => {
      openFlowBuilderWindow();
    });
  });
}

function killBackend() {
  if (backendProcess && backendProcess.pid) {
    try {
      if (process.platform === 'win32') {
        const { execSync } = require('child_process');
        execSync(`taskkill /pid ${backendProcess.pid} /T /F`, { stdio: 'ignore' });
      } else {
        backendProcess.kill('SIGTERM');
      }
    } catch {}
    backendProcess = null;
  }
}

app.on('before-quit', () => {
  isQuitting = true;
});

// 모든 창이 닫히거나 숨겨져도 시스템 트레이에서 상시 동작 유지 (프로그램 종료 메뉴 선택 시에만 종료)
app.on('window-all-closed', () => {
  if (isQuitting) {
    killBackend();
    if (process.platform !== 'darwin') {
      app.quit();
    }
  }
});

app.on('will-quit', () => {
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
    tray = null;
  }
  killBackend();
});
