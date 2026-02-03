/**
 * Live2D V2 模型渲染器
 * 使用 live2d.js 内置的 loadlive2d() 函数
 * 针对 Gnome 42 缩放优化
 */

class Live2DRenderer {
    constructor(canvasId) {
        this.canvasId = canvasId;
        this.canvas = document.getElementById(canvasId);
        this.modelPath = '';
        this.isLoaded = false;
        this.contextLost = false;
        this.webglErrorCount = 0; // 追踪 WebGL 错误数量
        this.lastErrorCheckTime = 0;
        
        // 渲染参数
        this.dpr = window.devicePixelRatio || 1;
        this.lastDisplayWidth = 0;
        this.lastDisplayHeight = 0;
        
        // 鼠标追踪
        this.mouseX = 0;
        this.mouseY = 0;
        
        // 调试模式
        this.debugMode = true;
        
        // 初始化 Canvas 尺寸
        this.resize();
        
        // 监听 DPI 变化
        this.setupDPRListener();

        // 监听 WebGL 上下文丢失/恢复
        this.setupContextLostListener();

        // 监听控制台错误以检测 WebGL 状态异常
        this.setupWebGLErrorDetection();
    }
    
    /**
     * 调试日志输出
     */
    log(...args) {
        if (this.debugMode) {
            console.log('[Live2D Renderer]', ...args);
        }
    }
    
    /**
     * 设置 DPI 变化监听
     */
    setupDPRListener() {
        // 使用 matchMedia 监听 DPI 变化
        const updateDPR = () => {
            const newDpr = window.devicePixelRatio || 1;
            if (newDpr !== this.dpr) {
                this.log('=== DPI Changed ===');
                this.log('  Old DPR:', this.dpr);
                this.log('  New DPR:', newDpr);
                this.log('===================');
                
                this.dpr = newDpr;
                this.resize();
            }
        };
        
        // 使用 matchMedia 进行精确监听
        const mediaQuery = window.matchMedia(`(resolution: ${this.dpr}dppx)`);
        mediaQuery.addEventListener('change', updateDPR);
    }

    /**
     * 检测 WebGL 错误（通过拦截控制台警告）
     * 用于捕获 context restored 后 live2d.js 内部状态失效的情况
     */
    setupWebGLErrorDetection() {
        const self = this;
        const originalWarn = console.warn;
        const originalError = console.error;
        
        // 检测 WebGL 相关错误模式
        const webglErrorPatterns = [
            'INVALID_OPERATION',
            'object does not belong to this context',
            'no buffer',
            'no texture bound',
            'no valid shader program',
            'location not for current program',
            'location is not from current program'
        ];
        
        const checkForWebGLError = (args) => {
            const message = args.map(a => String(a)).join(' ');
            const isWebGLError = webglErrorPatterns.some(pattern => message.includes(pattern));
            
            if (isWebGLError && !self.contextLost) {
                const now = Date.now();
                // 每秒最多检查一次，避免频繁触发
                if (now - self.lastErrorCheckTime > 1000) {
                    self.lastErrorCheckTime = now;
                    self.webglErrorCount++;
                    
                    // 短时间内累积多个错误，说明状态已损坏
                    if (self.webglErrorCount >= 3) {
                        console.log('[Live2D] Detected corrupted WebGL state, triggering reload...');
                        self.contextLost = true;
                        window.live2dContextLost = true;
                        
                        if (typeof window.showMessage === 'function') {
                            window.showMessage('检测到图形状态异常，正在重新初始化...', 2000);
                        }
                        
                        // 延迟后自动重载页面
                        setTimeout(() => {
                            window.location.reload();
                        }, 1500);
                    }
                }
            }
        };
        
        console.warn = function(...args) {
            checkForWebGLError(args);
            originalWarn.apply(console, args);
        };
        
        console.error = function(...args) {
            checkForWebGLError(args);
            originalError.apply(console, args);
        };
    }

    /**
     * 监听 WebGL 上下文丢失与恢复
     * 典型场景：锁屏/休眠后恢复、切换用户、GPU 驱动重置
     */
    setupContextLostListener() {
        if (!this.canvas) return;

        this.canvas.addEventListener('webglcontextlost', (event) => {
            event.preventDefault(); // 允许后续 restore
            this.contextLost = true;
            this.isLoaded = false;
            window.live2dContextLost = true; // 全局标志
            console.error('[Live2D] WebGL context lost (CONTEXT_LOST_WEBGL). Rendering suspended.');
            // 显示持久化错误遮罩
            if (typeof window.showErrorOverlay === 'function') {
                window.showErrorOverlay();
            }
        }, false);

        this.canvas.addEventListener('webglcontextrestored', () => {
            console.log('[Live2D] WebGL context restored. Full reload required to reset internal state.');
            this.contextLost = false;
            window.live2dContextLost = false;
            // live2d.js 内部缓存的 shader/buffer/texture 已失效
            // 必须完全重载页面来重置所有状态
            if (typeof window.showMessage === 'function') {
                window.showMessage('图形环境已恢复，正在重新初始化...', 2000);
            }
            // 隐藏错误遮罩
            if (typeof window.hideErrorOverlay === 'function') {
                window.hideErrorOverlay();
            }
            // 延迟后重载页面，确保消息显示
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        }, false);
    }

    /**
     * 尝试从 live2d.js 获取实际的 WebGL 上下文并添加监听
     * 因为 live2d.js 内部会创建自己的上下文
     */
    attachContextListenerToLive2D() {
        if (!this.canvas) return;
        
        // 尝试获取 live2d.js 创建的 WebGL 上下文
        const gl = this.canvas.getContext('webgl') || 
                   this.canvas.getContext('experimental-webgl') ||
                   this.canvas.getContext('webgl2');
        
        if (gl && gl.canvas && !gl.canvas._live2dListenerAttached) {
            gl.canvas._live2dListenerAttached = true;
            console.log('[Live2D] Attaching context listeners to actual WebGL context');
            
            gl.canvas.addEventListener('webglcontextlost', (event) => {
                event.preventDefault();
                this.contextLost = true;
                this.isLoaded = false;
                window.live2dContextLost = true;
                console.error('[Live2D] WebGL context lost (detected from live2d.js context).');
                // 显示持久化错误遮罩
                if (typeof window.showErrorOverlay === 'function') {
                    window.showErrorOverlay();
                }
            }, false);

            gl.canvas.addEventListener('webglcontextrestored', () => {
                console.log('[Live2D] WebGL context restored (from live2d.js). Full reload required.');
                this.contextLost = false;
                window.live2dContextLost = false;
                // live2d.js 内部缓存的 shader/buffer/texture 已失效
                // 必须完全重载页面来重置所有状态
                if (typeof window.hideErrorOverlay === 'function') {
                    window.hideErrorOverlay();
                }
                if (typeof window.showMessage === 'function') {
                    window.showMessage('图形环境已恢复，正在重新初始化...', 2000);
                }
                // 延迟后重载页面
                setTimeout(() => {
                    window.location.reload();
                }, 1000);
            }, false);
        }
    }
    
    /**
     * 调整渲染尺寸（DPI 适配）
     * live2d.js 内部会根据 canvas 的 width/height 属性进行渲染
     */
    resize() {
        this.dpr = window.devicePixelRatio || 1;
        
        const displayWidth = this.canvas.clientWidth;
        const displayHeight = this.canvas.clientHeight;
        
        // 检测尺寸是否真正变化
        const sizeChanged = displayWidth !== this.lastDisplayWidth || 
                           displayHeight !== this.lastDisplayHeight;
        
        this.log('=== Canvas Resize ===');
        this.log('  Display Size:', `${displayWidth}x${displayHeight}`);
        this.log('  Device Pixel Ratio:', this.dpr);
        this.log('  Size Changed:', sizeChanged);
        
        // Canvas 内部分辨率 = 显示尺寸 × DPR
        // 但 live2d.js 对高 DPI 的处理方式是在内部乘以 Quality 系数
        // 为了兼容，我们这里设置为 2x（与参考项目的 Quality=2 一致）
        const quality = 2;
        const newWidth = displayWidth * quality;
        const newHeight = displayHeight * quality;
        
        this.log('  Quality Factor:', quality);
        this.log('  Canvas Internal Size:', `${newWidth}x${newHeight}`);
        
        // 只有在尺寸真正变化时才更新 Canvas
        if (this.canvas.width !== newWidth || this.canvas.height !== newHeight) {
            this.canvas.width = newWidth;
            this.canvas.height = newHeight;
            this.log('  Canvas Updated: YES');
        } else {
            this.log('  Canvas Updated: NO (size unchanged)');
        }
        
        this.lastDisplayWidth = displayWidth;
        this.lastDisplayHeight = displayHeight;
        
        this.log('=====================');
    }
    
    /**
     * 强制重新加载模型（用于尺寸变化后刷新）
     */
    reloadModel() {
        if (this.modelPath && this.isLoaded) {
            this.log('Reloading model due to size change...');
            this.loadModel(this.modelPath);
        }
    }
    
    /**
     * 加载 Live2D 模型
     * 使用 live2d.js 内置的 loadlive2d() 函数
     * @param {string} modelPath - model.json 文件路径
     */
    loadModel(modelPath) {
        if (!modelPath) {
            console.warn('[Live2D] No model path provided');
            return;
        }

        // 若上下文已丢失，直接拒绝加载并提示
        if (this.contextLost) {
            console.warn('[Live2D] Cannot load model: WebGL context is lost.');
            if (typeof window.showMessage === 'function') {
                window.showMessage('图形环境仍不可用，请重启程序后重试。', 6000);
            }
            return;
        }
        
        // 验证文件名
        if (!modelPath.endsWith('model.json')) {
            console.error('[Live2D] Invalid model file, must be model.json:', modelPath);
            return;
        }
        
        this.modelPath = modelPath;
        
        console.log('[Live2D] Loading model:', modelPath);

        // 在调用底层库前预检 WebGL 可用性，避免误导性错误
        const canvas = this.canvas || document.getElementById(this.canvasId);
        let gl = null;
        try {
            if (canvas && canvas.getContext) {
                gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            }
        } catch (e) {
            gl = null;
        }
        if (!gl) {
            console.error('[Live2D] WebGL context unavailable. Likely due to GPU/session change.');
            this.isLoaded = false;
            if (typeof window.showMessage === 'function') {
                window.showMessage('图形环境异常：WebGL 不可用。请重启程序后重试。', 8000);
            }
            return;
        }
        
        // 使用 live2d.js 内置的 loadlive2d 函数
        // 参数: canvasId, modelPath, callback
        if (typeof loadlive2d === 'function') {
            try {
                loadlive2d(this.canvasId, modelPath, () => {
                    console.log('[Live2D] Model loaded successfully');
                    this.isLoaded = true;
                    // 加载成功后，尝试从 live2d.js 获取实际的 WebGL 上下文并监听
                    setTimeout(() => {
                        this.attachContextListenerToLive2D();
                    }, 100);
                });
            } catch (e) {
                console.error('[Live2D] Error loading model:', e);
                this.isLoaded = false;
                if (typeof window.showMessage === 'function') {
                    window.showMessage('模型加载失败（WebGL/驱动可能异常）。请重启程序后重试。', 8000);
                }
            }
        } else {
            console.error('[Live2D] loadlive2d function not found!');
            if (typeof window.showMessage === 'function') {
                window.showMessage('加载器缺失：请重新启动程序。', 6000);
            }
        }
    }
    
    /**
     * 设置鼠标位置（用于视线追踪）
     * live2d.js 内部已经处理了鼠标追踪，这里作为备用接口
     * @param {number} x - 相对于模型中心的 X 偏移
     * @param {number} y - 相对于模型中心的 Y 偏移
     */
    setMousePosition(x, y) {
        this.mouseX = x;
        this.mouseY = y;
        // live2d.js 内部通过监听 window 的 mousemove 事件自动处理
        // 如果需要手动设置，可以通过模拟鼠标事件实现
    }
    
    /**
     * 播放动作
     */
    playMotion(motionType) {
        console.log('[Live2D] Play motion:', motionType);
        // live2d.js 内部通过点击事件触发动作
    }
    
    /**
     * 截图
     */
    screenshot() {
        if (typeof window.Live2D !== 'undefined') {
            window.Live2D.captureFrame = true;
            window.Live2D.captureName = 'live2d-screenshot.png';
            console.log('[Live2D] Screenshot triggered');
        } else {
            // 备用方案：直接从 canvas 获取
            const dataUrl = this.canvas.toDataURL('image/png');
            const link = document.createElement('a');
            link.download = 'live2d-screenshot.png';
            link.href = dataUrl;
            link.click();
            console.log('[Live2D] Screenshot saved');
        }
    }
    
    /**
     * 销毁
     */
    destroy() {
        this.isLoaded = false;
    }
}

// 导出到全局
window.Live2DRenderer = Live2DRenderer;

// 自动初始化
document.addEventListener('DOMContentLoaded', () => {
    window.live2dRenderer = new Live2DRenderer('live2d-canvas');
});
