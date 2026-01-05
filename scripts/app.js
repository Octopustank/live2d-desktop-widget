/**
 * Live2D Desktop - 主应用脚本
 * 处理应用逻辑、交互和 IPC 通信
 */

const { ipcRenderer } = require('electron');

// ==================== 配置 ====================
const config = {
    // 模型路径（本地模型）
    modelPath: '',
    modelScale: 1,
    windowWidth: 350,
    windowHeight: 600,
    autoHideOnHover: false,
    
    // 消息显示时间（毫秒）
    messageTimeout: 5000,
    
    // 交互消息
    messages: {
        welcome: ['你好呀~', '今天也要加油哦！', '有什么需要帮忙的吗？'],
        click: ['哇，不要点我啦~', '好痒~', '嘻嘻~'],
        idle: ['无聊了吗？', '要不要聊聊天？', '...zzZ']
    }
};

// ==================== 状态 ====================
let state = {
    mouseX: 0,
    mouseY: 0,
    scaleFactor: window.devicePixelRatio || 1,
    lastDisplayInfo: null  // 上次显示器信息（用于对比）
};

let isClickThrough = false;
let resizeDebounceTimer = null;  // 用于防抖的定时器

// ==================== DOM 元素 ====================
const elements = {
    container: document.getElementById('live2d-container'),
    canvas: document.getElementById('live2d-canvas'),
    messageBox: document.getElementById('message-box'),
    messageText: document.getElementById('message-text'),
    toolbar: document.getElementById('toolbar'),
    btnSwitchModel: document.getElementById('btn-switch-model'),
    btnScreenshot: document.getElementById('btn-screenshot'),
    btnSettings: document.getElementById('btn-settings')
};

// ==================== 工具函数 ====================

/**
 * 获取随机消息
 */
function getRandomMessage(messages) {
    if (Array.isArray(messages)) {
        return messages[Math.floor(Math.random() * messages.length)];
    }
    return messages;
}

/**
 * 显示消息
 */
let messageTimer = null;
function showMessage(text, timeout = config.messageTimeout) {
    if (messageTimer) {
        clearTimeout(messageTimer);
    }
    
    elements.messageText.textContent = text;
    elements.messageBox.classList.add('visible');
    
    messageTimer = setTimeout(() => {
        elements.messageBox.classList.remove('visible');
    }, timeout);
}

/**
 * 更新 Canvas 尺寸以适配 DPI
 * 注意：live2d.js 内部会管理渲染，这里只做初始设置
 */
function updateCanvasSize(forceReload = false) {
    console.log('[Canvas] === Updating Canvas Size ===');
    console.log('[Canvas]   Window innerSize:', window.innerWidth, 'x', window.innerHeight);
    console.log('[Canvas]   DevicePixelRatio:', window.devicePixelRatio);
    console.log('[Canvas]   ForceReload:', forceReload);
    
    // 通知 Live2D 渲染器调整尺寸
    if (window.live2dRenderer) {
        window.live2dRenderer.resize();
        
        // 如果需要强制重载（尺寸变化后）
        if (forceReload) {
            console.log('[Canvas]   Triggering model reload...');
            // 延迟重载，确保 Canvas 尺寸已应用
            setTimeout(() => {
                window.live2dRenderer.reloadModel();
            }, 100);
        }
    }
    
    console.log('[Canvas]   Current Canvas Size:', elements.canvas.width, 'x', elements.canvas.height);
    console.log('[Canvas] ================================');
}

function applyConfig(newConfig = {}) {
    const incomingPath = typeof newConfig.modelPath === 'string' ? newConfig.modelPath : config.modelPath;
    const incomingScale = Number.isFinite(Number(newConfig.modelScale)) ? Number(newConfig.modelScale) : config.modelScale;
    const incomingWidth = Number.isFinite(Number(newConfig.windowWidth)) ? Number(newConfig.windowWidth) : config.windowWidth;
    const incomingHeight = Number.isFinite(Number(newConfig.windowHeight)) ? Number(newConfig.windowHeight) : config.windowHeight;
    const incomingAutoHide = typeof newConfig.autoHideOnHover === 'boolean' ? newConfig.autoHideOnHover : config.autoHideOnHover;
    
    // 检测尺寸是否变化
    const sizeChanged = incomingWidth !== config.windowWidth || incomingHeight !== config.windowHeight;
    
    console.log('[App] === Applying Config ===');
    console.log('[App]   modelPath:', incomingPath);
    console.log('[App]   modelScale:', incomingScale);
    console.log('[App]   windowSize:', `${incomingWidth}x${incomingHeight}`);
    console.log('[App]   sizeChanged:', sizeChanged);
    console.log('[App]   autoHideOnHover:', incomingAutoHide);
    console.log('[App] ========================');
    
    const shouldReloadModel = incomingPath && incomingPath !== config.modelPath;
    const previousWidth = config.windowWidth;
    const previousHeight = config.windowHeight;
    
    config.modelPath = incomingPath;
    config.modelScale = incomingScale;
    config.windowWidth = incomingWidth;
    config.windowHeight = incomingHeight;
    config.autoHideOnHover = incomingAutoHide;
    
    // 应用模型缩放
    elements.container.style.transform = `scale(${config.modelScale})`;
    elements.container.style.transformOrigin = 'bottom center';
    
    if (shouldReloadModel) {
        loadModel(config.modelPath);
    } else if (sizeChanged) {
        // 尺寸变化但模型路径不变，需要更新 Canvas 并重载模型
        console.log('[App] Window size changed, updating canvas and reloading model...');
        updateCanvasSize(true);  // 强制重载
    }
}

// ==================== 鼠标追踪 ====================

// 记录上次鼠标位置和无移动计时器
let lastMouseX = 0;
let lastMouseY = 0;
let idleTimer = null;
const IDLE_TIMEOUT = 3000; // 3秒无移动进入空闲状态

function initMouseTracking() {
    // 监听全局鼠标移动（来自主进程的 screen.getCursorScreenPoint）
    ipcRenderer.on('global-mouse-move', (event, position) => {
        state.mouseX = position.screenX;
        state.mouseY = position.screenY;
        
        // 检查是否有移动
        const hasMoved = Math.abs(position.screenX - lastMouseX) > 2 || 
                         Math.abs(position.screenY - lastMouseY) > 2;
        
        if (hasMoved) {
            lastMouseX = position.screenX;
            lastMouseY = position.screenY;
            
            // 重置空闲计时器
            if (idleTimer) {
                clearTimeout(idleTimer);
            }
            idleTimer = setTimeout(() => {
                // 进入空闲状态，重置追踪点
                if (typeof window.live2dResetPoint === 'function') {
                    window.live2dResetPoint();
                }
            }, IDLE_TIMEOUT);
            
            // 更新 Live2D 模型视线
            // 将相对坐标转换为 live2d 期望的 -1 到 1 范围
            const maxRange = 500; // 屏幕上的最大追踪距离（像素）
            const normalizedX = Math.max(-1, Math.min(1, position.relativeX / maxRange));
            const normalizedY = Math.max(-1, Math.min(1, -position.relativeY / maxRange)); // Y 轴翻转
            
            if (typeof window.live2dSetPoint === 'function') {
                window.live2dSetPoint(normalizedX, normalizedY);
            }
        }
    });
    
    // 本地鼠标移动（窗口内）- 作为备用和更精确的追踪
    document.addEventListener('mousemove', (e) => {
        // 获取窗口在屏幕上的位置
        state.mouseX = e.screenX;
        state.mouseY = e.screenY;
        
        // 重置空闲计时器
        if (idleTimer) {
            clearTimeout(idleTimer);
        }
        idleTimer = setTimeout(() => {
            if (typeof window.live2dResetPoint === 'function') {
                window.live2dResetPoint();
            }
        }, IDLE_TIMEOUT);
        
        // 计算相对于 Canvas 中心的偏移
        const rect = elements.canvas.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        const relativeX = e.clientX - centerX;
        const relativeY = e.clientY - centerY;
        
        // 转换为 -1 到 1 范围
        const maxRange = 200;
        const normalizedX = Math.max(-1, Math.min(1, relativeX / maxRange));
        const normalizedY = Math.max(-1, Math.min(1, -relativeY / maxRange));
        
        if (typeof window.live2dSetPoint === 'function') {
            window.live2dSetPoint(normalizedX, normalizedY);
        }
    });
}

// ==================== 点击交互 ====================

function initClickInteraction() {
    elements.canvas.addEventListener('click', (e) => {
        // 只有在模型完全加载后才允许交互
        if (!window.live2dRenderer || !window.live2dRenderer.isLoaded) {
            console.warn('[App] Model not loaded yet');
            return;
        }
        
        showMessage(getRandomMessage(config.messages.click));
        
        // 触发模型动作
        if (window.live2dRenderer) {
            window.live2dRenderer.playMotion('tap');
        }
    });
}

// ==================== 工具栏功能 ====================

function initToolbar() {
    // 切换模型
    elements.btnSwitchModel.addEventListener('click', () => {
        // 打开文件选择器
        const input = document.createElement('input');
        input.type = 'file';
        // 只接受 model.json 结尾的文件
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                // 检查文件名是否以 model.json 结尾
                if (!file.name.endsWith('model.json')) {
                    showMessage('请选择 model.json 文件！');
                    console.warn('[App] Selected file is not a model.json:', file.name);
                    return;
                }
                const modelPath = file.path;
                loadModel(modelPath);
            }
        };
        input.click();
    });
    
    // 截图
    elements.btnScreenshot.addEventListener('click', () => {
        if (window.live2dRenderer) {
            window.live2dRenderer.screenshot();
        }
    });
    
    // 设置
    elements.btnSettings.addEventListener('click', () => {
        ipcRenderer.send('open-settings');
    });
}

// ==================== 模型加载 ====================

function loadModel(modelPath) {
    if (!modelPath) return;
    
    // 验证路径
    if (!modelPath.endsWith('model.json')) {
        showMessage('无效的模型文件路径');
        console.error('[App] Invalid model path:', modelPath);
        return;
    }
    
    config.modelPath = modelPath;
    localStorage.setItem('modelPath', modelPath);
    ipcRenderer.send('update-config', { modelPath });
    
    if (window.live2dRenderer) {
        // 重置加载状态
        window.live2dRenderer.isLoaded = false;
        window.live2dRenderer.loadModel(modelPath);
        showMessage('模型加载中...');
    }
}

// ==================== IPC 通信 ====================

function initIPC() {
    // 监听显示器变化（来自 DisplayManager）
    ipcRenderer.on('display-changed', (event, data) => {
        console.log('[Display] === Display Changed Event ===');
        console.log('[Display]   Scale Factor:', data.scaleFactor);
        console.log('[Display]   Work Area:', data.workArea);
        console.log('[Display]   Needs Canvas Resize:', data.needsCanvasResize);
        
        if (data.displayInfo) {
            console.log('[Display]   Logical Size:', data.displayInfo.logicalWidth, 'x', data.displayInfo.logicalHeight);
            console.log('[Display]   Physical Size:', data.displayInfo.physicalWidth, 'x', data.displayInfo.physicalHeight);
        }
        
        if (data.newBounds) {
            console.log('[Display]   New Window Bounds:', data.newBounds);
        }
        
        console.log('[Display] ================================');
        
        state.scaleFactor = data.scaleFactor;
        state.lastDisplayInfo = data.displayInfo;
        
        // 如果需要更新 Canvas
        if (data.needsCanvasResize) {
            updateCanvasSize(true);  // 强制重载模型
        } else {
            updateCanvasSize(false);
        }
    });

    // 监听窗口边界变化
    ipcRenderer.on('window-bounds-changed', (event, data) => {
        console.log('[Window] === Bounds Changed Event ===');
        console.log('[Window]   Bounds:', data.bounds);
        console.log('[Window]   Needs Canvas Resize:', data.needsCanvasResize);
        console.log('[Window] =================================');
        
        if (data.needsCanvasResize) {
            // 使用防抖避免频繁更新
            if (resizeDebounceTimer) {
                clearTimeout(resizeDebounceTimer);
            }
            resizeDebounceTimer = setTimeout(() => {
                updateCanvasSize(true);
            }, 150);
        }
    });

    ipcRenderer.on('config-updated', (event, cfg) => {
        applyConfig(cfg);
    });

    ipcRenderer.on('click-through-changed', (event, enabled) => {
        isClickThrough = enabled;
        console.log('[App] Click-through mode:', enabled);
        // 切换穿透模式时，如果关闭则恢复透明度
        if (!enabled) {
            elements.container.style.opacity = '1';
        }
    });

    ipcRenderer.on('set-model-opacity', (event, opacity) => {
        elements.container.style.opacity = String(opacity);
        console.log('[App] Model opacity set to:', opacity);
    });

    ipcRenderer.invoke('get-config').then((cfg) => {
        applyConfig(cfg);
    });
}

// ==================== 初始化 ====================

function init() {
    console.log('[App] === Initializing ===');
    console.log('[App]   Window Size:', window.innerWidth, 'x', window.innerHeight);
    console.log('[App]   Device Pixel Ratio:', window.devicePixelRatio);
    console.log('[App] ======================');
    
    // 更新 Canvas 尺寸
    updateCanvasSize();
    
    // 初始化各模块
    initMouseTracking();
    initClickInteraction();
    initToolbar();
    initIPC();
    
    // 监听窗口大小变化
    window.addEventListener('resize', () => {
        console.log('[Window] Resize event triggered');
        console.log('[Window]   New Size:', window.innerWidth, 'x', window.innerHeight);
        
        // 使用防抖避免频繁调用
        if (resizeDebounceTimer) {
            clearTimeout(resizeDebounceTimer);
        }
        resizeDebounceTimer = setTimeout(() => {
            updateCanvasSize(false);  // 窗口大小变化时通常不需要重载模型
        }, 100);
    });
    
    // 监听 DPI 变化
    const currentDPR = window.devicePixelRatio;
    window.matchMedia(`(resolution: ${currentDPR}dppx)`).addEventListener('change', () => {
        const newDPR = window.devicePixelRatio;
        console.log('[DPI] === Changed ===');
        console.log('[DPI]   Old:', currentDPR);
        console.log('[DPI]   New:', newDPR);
        console.log('[DPI] ================');
        
        state.scaleFactor = newDPR;
        updateCanvasSize(true);  // DPI 变化需要重载模型
    });
    
    // 显示欢迎消息
    setTimeout(() => {
        showMessage(getRandomMessage(config.messages.welcome));
    }, 1000);
    
    console.log('[App] Initialized');
}

// 等待 DOM 加载完成
document.addEventListener('DOMContentLoaded', init);
