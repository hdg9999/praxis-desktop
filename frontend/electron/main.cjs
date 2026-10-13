const { app, BrowserWindow, ipcMain, screen, dialog } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow = null;
let backendProcess = null;
let pickerPanelWindow = null;
let highlightOverlayWindow = null;

function loadAppUrl(windowInstance, queryParam = '') {
  const isViteUpPromise = checkUrl('http://localhost:5173');
  const distPath = path.join(__dirname, '../dist/index.html');

  isViteUpPromise.then((isViteUp) => {
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
  if (mainWindow && !mainWindow.isDestroyed()) {
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
  // 마우스 입력을 완전히 관통시켜 사용자의 데스크톱 조작을 일체 방해하지 않음
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
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  }
}

// IPC 윈도우 최소화 및 원상복구 핸들러
ipcMain.handle('window:minimize', async () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize();
    return true;
  }
  return false;
});

ipcMain.handle('window:restore', async () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
    return true;
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
      { name: '모든 파일 (*.*)', extensions: ['*'] }
    ]
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
    backgroundColor: '#020617',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // 로컬 파일 및 이미지 접근 허용
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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

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

app.on('window-all-closed', () => {
  killBackend();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  killBackend();
});
