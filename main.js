/**
 * Live2D Desktop Widget
 * 主进程入口文件
 * 
 * 功能特性:
 * - 透明无边框窗口
 * - 全屏鼠标追踪（X11 / Wayland + GNOME / KDE / Hyprland）
 * - 顶层显示
 * - 仅模型区域可点击交互
 * - 支持多桌面环境和显示服务器缩放适配
 */

const { app, BrowserWindow, screen, Tray, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { DisplayManager, AnchorPoints, SizeMode } = require('./scripts/display-manager');
const { CursorTracker } = require('./scripts/cursor-tracker');

// 全局变量
let mainWindow = null;
let tray = null;
let isClickThrough = false;
let cursorTracker = null;
let settingsWindow = null;
let userConfig = null;
let displayManager = null;

function getDefaultConfig() {
    return {
        modelPath: '',
        modelScale: 1,
        // 性能/兼容性
        hardwareAcceleration: true,
        // 以下为遗留字段，用于兼容旧配置迁移
        windowWidth: 350,
        windowHeight: 600,
        windowX: null,
        windowY: null,
        // 新的显示档案系统
        displayProfiles: {},
        // 其他设置
        autoHideOnHover: false,
        hoverOpacity: 0.1,
        clickThrough: false  // 点击穿透状态
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

// 在应用就绪前尽早应用硬件加速设置
// 注意：需要在 app.whenReady() 之前调用 app.disableHardwareAcceleration()
try {
    const earlyConfig = (function () {
        const defaultConfig = getDefaultConfig();
        const configPath = getConfigPath();
        if (fs.existsSync(configPath)) {
            const data = fs.readFileSync(configPath, 'utf-8');
            return { ...defaultConfig, ...JSON.parse(data) };
        }
        return defaultConfig;
    })();
    if (earlyConfig && earlyConfig.hardwareAcceleration === false) {
        console.log('[App] Hardware acceleration disabled by config');
        app.disableHardwareAcceleration();
    }
} catch (e) {
    console.warn('[App] Early hardware acceleration config load failed:', e);
}

/**
 * 获取当前显示器的缩放因子
 * 注意：在 Wayland 下分数缩放（如 150%）时，Electron 可能报告整数值（如 2x），
 * 这是 Wayland 的缓冲区缩放机制导致的，不影响唄布逻辑分辨率的准确性。
 */
function getScaleFactor() {
    const primaryDisplay = screen.getPrimaryDisplay();
    const factor = primaryDisplay.scaleFactor || 1;
    const isWayland = process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY;
    console.log(`[Display] ${primaryDisplay.workAreaSize.width}x${primaryDisplay.workAreaSize.height} @ ${factor * 100}% | Session: ${isWayland ? 'Wayland' : 'X11'}`);
    if (isWayland && factor === Math.round(factor)) {
        console.log(`[Display] Note: Wayland buffer scale ${factor}x (actual fractional scale may differ)`);
    }
    return factor;
}

/**
 * 创建主窗口 - 显示 Live2D 模型
 */
function createMainWindow() {
    const scaleFactor = getScaleFactor();
    
    // 初始化 DisplayManager
    displayManager = new DisplayManager();
    displayManager.debugMode = true;  // 启用调试输出
    
    // 加载保存的显示档案
    if (userConfig && userConfig.displayProfiles) {
        displayManager.loadProfiles(userConfig.displayProfiles);
    }
    
    // 使用 DisplayManager 计算初始窗口位置
    const initialBounds = displayManager.getInitialWindowBounds(userConfig);
    
    console.log('[Window] Initial bounds:', initialBounds);
    
    // 如果进行了旧配置迁移，清除旧的 windowX/windowY
    if (displayManager.needsClearLegacyConfig()) {
        console.log('[Config] Clearing legacy windowX/windowY after migration');
        userConfig.windowX = null;
        userConfig.windowY = null;
        saveConfig(userConfig);
    }

    mainWindow = new BrowserWindow({
        width: initialBounds.width,
        height: initialBounds.height,
        x: initialBounds.x,
        y: initialBounds.y,
        
        // 桌面摆件核心配置
        transparent: true,          // 背景透明
        frame: false,               // 无边框
        alwaysOnTop: true,          // 置顶显示
        skipTaskbar: true,          // 不显示在任务栏
        resizable: false,           // 禁止调整大小
        hasShadow: false,           // 无阴影
        
        // Linux 桌面环境兼容性
        // 'dock' 类型帮助保持置顶，在 GNOME/KDE 的 X11 和 XWayland 下均有效
        type: 'dock',
        
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
            // 恢复点击穿透状态
            if (userConfig.clickThrough === true) {
                isClickThrough = true;
                mainWindow.setIgnoreMouseEvents(true);
                mainWindow.webContents.send('click-through-changed', true);
            }
        }
    });
    
    // 调试模式
    // mainWindow.webContents.openDevTools({ mode: 'detach' });
    
    // 窗口关闭时清理
    mainWindow.on('closed', () => {
        mainWindow = null;
        stopMouseTracking();
    });
    
    // 注意：已移除窗口拖动功能，位置通过设置界面配置
    // 窗口大小调整结束时（如果需要）
    let resizeTimeout = null;
    mainWindow.on('resize', () => {
        if (!userConfig || !displayManager) return;
        
        // 防抖
        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            const bounds = mainWindow.getBounds();
            console.log('[Window] Resize ended, new size:', bounds);
            
            const result = displayManager.handleWindowResizeEnd(bounds);
            
            userConfig.windowWidth = bounds.width;
            userConfig.windowHeight = bounds.height;
            userConfig.displayProfiles = displayManager.getProfilesToSave();
            saveConfig(userConfig);
            
            // 通知渲染进程重新调整 Canvas
            if (mainWindow && mainWindow.webContents) {
                mainWindow.webContents.send('window-bounds-changed', {
                    bounds,
                    displayInfo: result.displayInfo,
                    needsCanvasResize: true
                });
            }
        }, 200);
    });
}

/**
 * 启动全屏鼠标追踪
 * 
 * 根据运行环境自动选择最佳追踪方式：
 * - X11: 使用 Electron screen.getCursorScreenPoint() (~60 FPS)
 * - Wayland + GNOME: 通过 GJS/DBus 调用 GNOME Shell (~20 FPS)
 * - Wayland + KDE: 通过 KWin DBus 接口 (~12 FPS)
 * - Wayland + Hyprland: 通过 hyprctl (~20 FPS)
 * - 回退: Electron API（Wayland 上仅窗口内有效）
 */
function startMouseTracking() {
    if (cursorTracker) return;

    cursorTracker = new CursorTracker(screen);

    cursorTracker.onPositionUpdate((cursorPos) => {
        if (!mainWindow || !mainWindow.webContents) return;

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
            const opacity = isInWindow ? (userConfig.hoverOpacity || 0.1) : 1.0;
            mainWindow.webContents.send('set-model-opacity', opacity);
        }

        mainWindow.webContents.send('global-mouse-move', {
            screenX: cursorPos.x,
            screenY: cursorPos.y,
            relativeX: relativeX,
            relativeY: relativeY,
            isInWindow: isInWindow
        });
    });

    // X11 使用 60 FPS (16ms)，Wayland 使用 20 FPS (50ms) 以降低 DBus 调用开销
    const interval = cursorTracker.isWayland() ? 50 : 16;
    cursorTracker.start(interval);

    const envInfo = cursorTracker.getEnvironmentInfo();
    console.log(`[MouseTracking] Started | method: ${envInfo.trackingMethod} | session: ${envInfo.sessionType} | DE: ${envInfo.desktopEnv} | interval: ${interval}ms`);
}

/**
 * 停止鼠标追踪
 */
function stopMouseTracking() {
    if (cursorTracker) {
        cursorTracker.stop();
        cursorTracker = null;
    }
}

function applyWindowSettings(targetFingerprint = null) {
    if (!mainWindow || !userConfig) return;
    
    // 如果有 DisplayManager，使用其计算的位置
    if (displayManager) {
        let newBounds;
        
        if (targetFingerprint) {
            // 移动到指定显示器
            newBounds = displayManager.calculateBoundsForDisplay(targetFingerprint);
            if (!newBounds) {
                console.log('[Window] Target display not found, using current');
                newBounds = displayManager.recalculateWindowBounds(mainWindow.getBounds());
            }
        } else {
            // 使用当前显示器
            newBounds = displayManager.recalculateWindowBounds(mainWindow.getBounds());
        }
        
        console.log('[Window] Applying settings with DisplayManager:', newBounds);
        mainWindow.setBounds(newBounds);
        
        // 通知渲染进程
        if (mainWindow.webContents) {
            mainWindow.webContents.send('window-bounds-changed', {
                bounds: newBounds,
                needsCanvasResize: true
            });
        }
        return;
    }
    
    // 回退到旧逻辑
    const bounds = mainWindow.getBounds();
    const width = Math.max(200, Math.floor(userConfig.windowWidth || bounds.width));
    const height = Math.max(200, Math.floor(userConfig.windowHeight || bounds.height));
    const x = Number.isFinite(userConfig.windowX) ? Math.floor(userConfig.windowX) : bounds.x;
    const y = Number.isFinite(userConfig.windowY) ? Math.floor(userConfig.windowY) : bounds.y;
    console.log('[Window] Applying settings (legacy):', { x, y, width, height });
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
                // 保存点击穿透状态到配置
                if (userConfig) {
                    userConfig.clickThrough = isClickThrough;
                    saveConfig(userConfig);
                }
            }
        },
        { type: 'separator' },
        {
            label: '重新加载模型',
            click: () => {
                if (mainWindow) {
                    mainWindow.reload();
                }
            }
        },
        {
            label: '重新启动应用',
            click: () => {
                console.log('[App] Restart requested from tray menu');
                app.relaunch();
                app.exit(0);
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
 * 监听显示器变化
 * 使用 DisplayManager 进行智能响应，支持 GNOME/KDE 缩放适配
 */
function setupDisplayListeners() {
    // 使用 DisplayManager 的监听器
    if (displayManager) {
        displayManager.setupDisplayListeners();
        
        displayManager.addListener((event, data) => {
            if (event === 'display-metrics-changed') {
                const { display, changedMetrics, displayInfo } = data;
                
                console.log(`[Display] Metrics changed: ${changedMetrics.join(', ')}`);
                
                // 重新计算窗口位置
                if (mainWindow) {
                    const currentBounds = mainWindow.getBounds();
                    const newBounds = displayManager.recalculateWindowBounds(currentBounds);
                    
                    console.log(`[Display] Repositioning: (${currentBounds.x},${currentBounds.y}) => (${newBounds.x},${newBounds.y})`);
                    
                    mainWindow.setBounds(newBounds);
                    
                    // 通知渲染进程
                    if (mainWindow.webContents) {
                        mainWindow.webContents.send('display-changed', {
                            scaleFactor: display.scaleFactor,
                            workArea: display.workAreaSize,
                            displayInfo,
                            newBounds,
                            needsCanvasResize: true
                        });
                    }
                    
                    // 通知设置窗口刷新显示信息和列表
                    notifySettingsWindowDisplayChange();
                }
            } else if (event === 'display-added' || event === 'display-removed') {
                // 显示器增减时也通知设置窗口
                console.log(`[Display] ${event}`);
                notifySettingsWindowDisplayChange();
            }
        });
    }
}

/**
 * 通知设置窗口显示器信息变化
 */
function notifySettingsWindowDisplayChange() {
    if (settingsWindow && settingsWindow.webContents) {
        const displayInfo = displayManager?.getCurrentDisplayInfo(mainWindow?.getBounds());
        const allDisplays = displayManager?.getAllDisplays();
        
        settingsWindow.webContents.send('display-info-updated', {
            displayInfo,
            allDisplays
        });
    }
}

function openSettingsWindow() {
    if (settingsWindow) {
        settingsWindow.focus();
        return;
    }
    settingsWindow = new BrowserWindow({
        width: 500,
        height: 780,
        resizable: true,
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
    
    // 注意：已移除窗口拖拽功能，位置通过设置界面配置
    
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

    // 渲染进程请求重启应用（用于切换硬件加速等需要重启的设置）
    ipcMain.on('restart-app', () => {
        console.log('[App] Restart requested from renderer');
        app.relaunch();
        app.exit(0);
    });

    // 获取配置和显示器信息（用于设置界面）
    ipcMain.handle('get-config-with-display', () => {
        const config = userConfig || getDefaultConfig();
        let displayInfo = null;
        let allDisplays = null;
        let envInfo = null;
        
        if (displayManager) {
            // 使用主窗口的实际位置来确定当前显示器
            const windowBounds = mainWindow?.getBounds();
            displayInfo = displayManager.getCurrentDisplayInfo(windowBounds);
            allDisplays = displayManager.getAllDisplays();
            
            console.log(`[Settings] Window at (${windowBounds?.x}, ${windowBounds?.y}) => Display ${displayInfo.fingerprint}`);
        }
        
        // 获取光标追踪环境信息
        if (cursorTracker) {
            envInfo = cursorTracker.getEnvironmentInfo();
        }
        
        return { config, displayInfo, allDisplays, envInfo };
    });

    // 获取光标追踪环境诊断信息
    ipcMain.handle('get-cursor-tracker-status', () => {
        if (!cursorTracker) return null;
        return cursorTracker.getEnvironmentInfo();
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
            autoHideOnHover: typeof payload.autoHideOnHover === 'boolean' ? payload.autoHideOnHover : current.autoHideOnHover,
            hoverOpacity: Number.isFinite(Number(payload.hoverOpacity)) ? Math.max(0, Math.min(1, Number(payload.hoverOpacity))) : current.hoverOpacity,
            hardwareAcceleration: typeof payload.hardwareAcceleration === 'boolean' ? payload.hardwareAcceleration : current.hardwareAcceleration,
            clickThrough: typeof payload.clickThrough === 'boolean' ? payload.clickThrough : current.clickThrough,
            // 保留显示档案
            displayProfiles: current.displayProfiles || {}
        };
        
        // 处理显示设置（锚点和偏移）
        let targetFingerprint = null;
        
        if (displayManager && payload.displaySettings) {
            const { fingerprint, anchor, offsetX, offsetY } = payload.displaySettings;
            
            if (fingerprint) {
                console.log('[Config] Updating display profile:', fingerprint, { anchor, offsetX, offsetY });
                
                displayManager.updateDisplayProfile(fingerprint, {
                    anchor: anchor || 'bottom_right',
                    offsetX: Number.isFinite(offsetX) ? offsetX : -20,
                    offsetY: Number.isFinite(offsetY) ? offsetY : -50,
                    width: merged.windowWidth,
                    height: merged.windowHeight,
                    sizeMode: 'fixed'
                });
                
                merged.displayProfiles = displayManager.getProfilesToSave();
                
                // 检查是否切换到了不同的显示器
                const currentDisplayInfo = displayManager.getCurrentDisplayInfo(mainWindow?.getBounds());
                if (currentDisplayInfo.fingerprint !== fingerprint) {
                    console.log('[Config] Display changed:', currentDisplayInfo.fingerprint, '=>', fingerprint);
                    targetFingerprint = fingerprint;
                }
            }
        } else if (displayManager && (payload.windowWidth || payload.windowHeight)) {
            // 仅更新窗口大小（兼容旧逻辑）
            const displayInfo = displayManager.getCurrentDisplayInfo(mainWindow?.getBounds());
            
            displayManager.updateDisplayProfile(displayInfo.fingerprint, {
                width: merged.windowWidth,
                height: merged.windowHeight,
                sizeMode: 'fixed'
            });
            
            merged.displayProfiles = displayManager.getProfilesToSave();
        }
        
        console.log('[Config] Saved');
        userConfig = merged;
        saveConfig(userConfig);
        applyWindowSettings(targetFingerprint);
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
