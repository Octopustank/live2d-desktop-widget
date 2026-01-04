/**
 * Live2D Desktop Widget for Gnome 42
 * 主进程入口文件
 * 
 * 功能特性:
 * - 透明无边框窗口
 * - 全屏鼠标追踪（通过 screen.getCursorScreenPoint 实现）
 * - 顶层显示
 * - 仅模型区域可点击交互
 * - 支持 Gnome 42 缩放适配
 */

const { app, BrowserWindow, screen, Tray, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// 全局变量
let mainWindow = null;
let tray = null;
let isClickThrough = false;
let mouseTrackingInterval = null;
let settingsWindow = null;
let userConfig = null;

function getDefaultConfig() {
    return {
        modelPath: '',
        modelScale: 1,
        windowWidth: 350,
        windowHeight: 600,
        windowX: null,
        windowY: null,
        autoHideOnHover: false,
        hoverOpacity: 0.1
    };
}

function getConfigPath() {
    return path.join(app.getPath('userData'), 'config.json');
}

function loadConfig() {
    const defaultConfig = getDefaultConfig();
    try {
        const configPath = getConfigPath();
        if (fs.existsSync(configPath)) {
            const data = fs.readFileSync(configPath, 'utf-8');
            return { ...defaultConfig, ...JSON.parse(data) };
        }
    } catch (e) {
        console.error('[Config] Failed to load config:', e);
    }
    return defaultConfig;
}

function saveConfig(config) {
    try {
        const configPath = getConfigPath();
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (e) {
        console.error('[Config] Failed to save config:', e);
    }
}

/**
 * 获取当前显示器的缩放因子
 */
function getScaleFactor() {
    const primaryDisplay = screen.getPrimaryDisplay();
    return primaryDisplay.scaleFactor || 1;
}

/**
 * 创建主窗口 - 显示 Live2D 模型
 */
function createMainWindow() {
    const scaleFactor = getScaleFactor();
    const primaryDisplay = screen.getPrimaryDisplay();
    const workArea = primaryDisplay.workAreaSize;
    
    const width = Math.max(200, userConfig?.windowWidth || 350);
    const height = Math.max(200, userConfig?.windowHeight || 600);
    const defaultX = workArea.width - width - 20;
    const defaultY = workArea.height - height - 20;
    const x = Number.isFinite(userConfig?.windowX) ? userConfig.windowX : defaultX;
    const y = Number.isFinite(userConfig?.windowY) ? userConfig.windowY : defaultY;

    mainWindow = new BrowserWindow({
        width,
        height,
        x,
        y,
        
        // 桌面摆件核心配置
        transparent: true,          // 背景透明
        frame: false,               // 无边框
        alwaysOnTop: true,          // 置顶显示
        skipTaskbar: true,          // 不显示在任务栏
        resizable: false,           // 禁止调整大小
        hasShadow: false,           // 无阴影（Gnome兼容）
        
        // Gnome/Wayland 兼容性
        type: 'dock',               // 在某些环境下可帮助保持置顶
        
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            zoomFactor: 1.0,        // 由渲染层处理 DPI
        }
    });
    
    mainWindow.loadFile('index.html');
    mainWindow.webContents.on('did-finish-load', () => {
        if (userConfig) {
            mainWindow.webContents.send('config-updated', userConfig);
        }
    });
    
    // 调试模式
    // mainWindow.webContents.openDevTools({ mode: 'detach' });
    
    // 窗口关闭时清理
    mainWindow.on('closed', () => {
        mainWindow = null;
        stopMouseTracking();
    });
    
    mainWindow.on('move', () => {
        if (!userConfig) return;
        const bounds = mainWindow.getBounds();
        userConfig.windowX = bounds.x;
        userConfig.windowY = bounds.y;
        saveConfig(userConfig);
    });
    
    mainWindow.on('resize', () => {
        if (!userConfig) return;
        const bounds = mainWindow.getBounds();
        userConfig.windowWidth = bounds.width;
        userConfig.windowHeight = bounds.height;
        saveConfig(userConfig);
    });
    
    // 监听渲染进程的拖拽请求
    mainWindow.on('will-move', () => {
        // 拖拽时可以正常移动
    });
}

/**
 * 启动全屏鼠标追踪
 * 使用 screen.getCursorScreenPoint() 获取鼠标位置
 * 这种方式无需额外窗口，可以追踪整个屏幕
 */
function startMouseTracking() {
    if (mouseTrackingInterval) return;
    
    mouseTrackingInterval = setInterval(() => {
        if (mainWindow && mainWindow.webContents) {
            const cursorPos = screen.getCursorScreenPoint();
            const windowBounds = mainWindow.getBounds();
            
            // 计算相对于窗口中心的位置
            const centerX = windowBounds.x + windowBounds.width / 2;
            const centerY = windowBounds.y + windowBounds.height / 2;
            
            const relativeX = cursorPos.x - centerX;
            const relativeY = cursorPos.y - centerY;
            
            // 检查鼠标是否在窗口区域内
            const isInWindow = cursorPos.x >= windowBounds.x && 
                             cursorPos.x <= windowBounds.x + windowBounds.width &&
                             cursorPos.y >= windowBounds.y && 
                             cursorPos.y <= windowBounds.y + windowBounds.height;
            
            // 自动透明逻辑：穿透模式 + 启用自动隐藏 + 鼠标在窗口内
            if (userConfig && userConfig.autoHideOnHover && isClickThrough) {
                if (isInWindow) {
                    // 鼠标在窗口内，通知渲染进程降低透明度
                    const opacity = userConfig.hoverOpacity || 0.1;
                    mainWindow.webContents.send('set-model-opacity', opacity);
                } else {
                    // 鼠标不在窗口内，恢复正常透明度
                    mainWindow.webContents.send('set-model-opacity', 1.0);
                }
            }
            
            mainWindow.webContents.send('global-mouse-move', {
                screenX: cursorPos.x,
                screenY: cursorPos.y,
                relativeX: relativeX,
                relativeY: relativeY
            });
        }
    }, 16); // 约 60 FPS
}

/**
 * 停止鼠标追踪
 */
function stopMouseTracking() {
    if (mouseTrackingInterval) {
        clearInterval(mouseTrackingInterval);
        mouseTrackingInterval = null;
    }
}

function applyWindowSettings() {
    if (!mainWindow || !userConfig) return;
    const bounds = mainWindow.getBounds();
    const width = Math.max(200, Math.floor(userConfig.windowWidth || bounds.width));
    const height = Math.max(200, Math.floor(userConfig.windowHeight || bounds.height));
    const x = Number.isFinite(userConfig.windowX) ? Math.floor(userConfig.windowX) : bounds.x;
    const y = Number.isFinite(userConfig.windowY) ? Math.floor(userConfig.windowY) : bounds.y;
    mainWindow.setBounds({ width, height, x, y });
}

/**
 * 创建系统托盘
 */
function createTray() {
    // 使用简单的图标路径，如果没有则使用默认
    const iconPath = path.join(__dirname, 'assets', 'icon.png');
    
    try {
        tray = new Tray(iconPath);
    } catch (e) {
        // 如果图标不存在，创建一个临时的
        console.log('托盘图标未找到，使用默认');
        return;
    }
    
    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Live2D Desktop',
            enabled: false
        },
        { type: 'separator' },
        {
            label: '显示/隐藏',
            click: () => {
                if (mainWindow) {
                    if (mainWindow.isVisible()) {
                        mainWindow.hide();
                    } else {
                        mainWindow.show();
                    }
                }
            }
        },
        {
            label: '点击穿透',
            type: 'checkbox',
            checked: isClickThrough,
            click: (menuItem) => {
                isClickThrough = menuItem.checked;
                if (mainWindow) {
                    mainWindow.setIgnoreMouseEvents(isClickThrough);
                    mainWindow.webContents.send('click-through-changed', isClickThrough);
                }
            }
        },
        { type: 'separator' },
        {
            label: '重新加载',
            click: () => {
                if (mainWindow) {
                    mainWindow.reload();
                }
            }
        },
        {
            label: '开发者工具',
            click: () => {
                if (mainWindow) {
                    mainWindow.webContents.openDevTools({ mode: 'detach' });
                }
            }
        },
        {
            label: '设置',
            click: () => {
                openSettingsWindow();
            }
        },
        { type: 'separator' },
        {
            label: '退出',
            click: () => {
                app.quit();
            }
        }
    ]);
    
    tray.setToolTip('Live2D Desktop');
    tray.setContextMenu(contextMenu);
    
    // 点击托盘图标显示/隐藏窗口
    tray.on('click', () => {
        if (mainWindow) {
            mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
        }
    });
}

/**
 * 监听显示器变化（Gnome 缩放适配）
 */
function setupDisplayListeners() {
    screen.on('display-metrics-changed', (event, display, changedMetrics) => {
        console.log('[Display] Metrics changed:', changedMetrics);
        
        if (changedMetrics.includes('scaleFactor') || changedMetrics.includes('workArea')) {
            // 通知渲染进程更新
            if (mainWindow && mainWindow.webContents) {
                mainWindow.webContents.send('display-changed', {
                    scaleFactor: display.scaleFactor,
                    workArea: display.workAreaSize
                });
            }
            
        }
    });
}

function openSettingsWindow() {
    if (settingsWindow) {
        settingsWindow.focus();
        return;
    }
    settingsWindow = new BrowserWindow({
        width: 440,
        height: 520,
        resizable: false,
        minimizable: false,
        maximizable: false,
        title: '设置',
        parent: mainWindow || undefined,
        modal: false,
        show: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    settingsWindow.loadFile('settings.html');
    settingsWindow.once('ready-to-show', () => settingsWindow && settingsWindow.show());
    settingsWindow.on('closed', () => {
        settingsWindow = null;
    });
}

/**
 * IPC 通信处理
 */
function setupIPC() {
    // 接收鼠标位置更新（来自鼠标追踪窗口）
    ipcMain.on('mouse-move', (event, position) => {
        if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('global-mouse-move', position);
        }
    });
    
    // 窗口拖拽
    ipcMain.on('window-drag', (event, { deltaX, deltaY }) => {
        if (mainWindow) {
            const [x, y] = mainWindow.getPosition();
            mainWindow.setPosition(x + deltaX, y + deltaY);
        }
    });
    
    // 设置点击穿透
    ipcMain.on('set-ignore-mouse', (event, ignore) => {
        if (mainWindow) {
            if (ignore) {
                // 点击穿透但保留前进鼠标事件用于特定区域
                mainWindow.setIgnoreMouseEvents(true, { forward: true });
            } else {
                mainWindow.setIgnoreMouseEvents(false);
            }
        }
    });

    ipcMain.handle('get-config', () => {
        return userConfig || getDefaultConfig();
    });

    ipcMain.handle('select-model', async () => {
        const result = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: [{ name: 'Live2D model', extensions: ['json'] }]
        });
        if (result.canceled || !result.filePaths.length) return null;
        return result.filePaths[0];
    });

    ipcMain.on('open-settings', () => {
        openSettingsWindow();
    });

    ipcMain.on('update-config', (event, payload) => {
        if (!payload) return;
        const current = userConfig || getDefaultConfig();
        const merged = {
            ...current,
            modelPath: typeof payload.modelPath === 'string' ? payload.modelPath : current.modelPath,
            modelScale: Number.isFinite(Number(payload.modelScale)) ? Number(payload.modelScale) : current.modelScale,
            windowWidth: Number.isFinite(Number(payload.windowWidth)) ? Number(payload.windowWidth) : current.windowWidth,
            windowHeight: Number.isFinite(Number(payload.windowHeight)) ? Number(payload.windowHeight) : current.windowHeight,
            windowX: Number.isFinite(Number(payload.windowX)) ? Number(payload.windowX) : current.windowX,
            windowY: Number.isFinite(Number(payload.windowY)) ? Number(payload.windowY) : current.windowY,
            autoHideOnHover: typeof payload.autoHideOnHover === 'boolean' ? payload.autoHideOnHover : current.autoHideOnHover,
            hoverOpacity: Number.isFinite(Number(payload.hoverOpacity)) ? Math.max(0, Math.min(1, Number(payload.hoverOpacity))) : current.hoverOpacity
        };
        console.log('[Config] Updated:', merged);
        userConfig = merged;
        saveConfig(userConfig);
        applyWindowSettings();
        if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('config-updated', userConfig);
        }
        if (settingsWindow && settingsWindow.webContents) {
            settingsWindow.webContents.send('config-saved');
        }
    });
}

// 应用就绪
app.whenReady().then(() => {
    userConfig = loadConfig();
    createMainWindow();
    startMouseTracking();  // 启动全屏鼠标追踪
    createTray();
    setupDisplayListeners();
    setupIPC();
    
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
            startMouseTracking();
        }
    });
});

// 所有窗口关闭时退出
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// 退出前清理
app.on('before-quit', () => {
    stopMouseTracking();
    if (tray) {
        tray.destroy();
    }
});
