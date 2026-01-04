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
    scaleFactor: window.devicePixelRatio || 1
};

let isClickThrough = false;

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
function updateCanvasSize() {
    // live2d.js 使用 Quality=2 的方式处理 DPI
    // 我们在 live2d-renderer.js 中已经设置了 canvas 尺寸
    // 这里不再重复设置，避免冲突
    
    console.log(`[Canvas] Size: ${elements.canvas.width}x${elements.canvas.height}`);
}

function applyConfig(newConfig = {}) {
    const incomingPath = typeof newConfig.modelPath === 'string' ? newConfig.modelPath : config.modelPath;
    const incomingScale = Number.isFinite(Number(newConfig.modelScale)) ? Number(newConfig.modelScale) : config.modelScale;
    const incomingWidth = Number.isFinite(Number(newConfig.windowWidth)) ? Number(newConfig.windowWidth) : config.windowWidth;
    const incomingHeight = Number.isFinite(Number(newConfig.windowHeight)) ? Number(newConfig.windowHeight) : config.windowHeight;
    const incomingAutoHide = typeof newConfig.autoHideOnHover === 'boolean' ? newConfig.autoHideOnHover : config.autoHideOnHover;
    
    console.log('[App] Applying config:', {
        modelPath: incomingPath,
        modelScale: incomingScale,
        windowSize: `${incomingWidth}x${incomingHeight}`,
        autoHideOnHover: incomingAutoHide
    });
    
    const shouldReloadModel = incomingPath && incomingPath !== config.modelPath;
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
    // 监听显示器变化
    ipcRenderer.on('display-changed', (event, data) => {
        console.log('[Display] Changed:', data);
        state.scaleFactor = data.scaleFactor;
        updateCanvasSize();
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
    console.log('[App] Initializing...');
    
    // 更新 Canvas 尺寸
    updateCanvasSize();
    
    // 初始化各模块
    initMouseTracking();
    initClickInteraction();
    initToolbar();
    initIPC();
    
    // 监听窗口大小变化
    window.addEventListener('resize', () => {
        updateCanvasSize();
    });
    
    // 监听 DPI 变化
    window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener('change', () => {
        console.log('[DPI] Changed to:', window.devicePixelRatio);
        state.scaleFactor = window.devicePixelRatio;
        updateCanvasSize();
    });
    
    // 显示欢迎消息
    setTimeout(() => {
        showMessage(getRandomMessage(config.messages.welcome));
    }, 1000);
    
    console.log('[App] Initialized');
}

// 等待 DOM 加载完成
document.addEventListener('DOMContentLoaded', init);
