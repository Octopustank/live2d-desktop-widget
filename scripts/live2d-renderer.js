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
        
        // 验证文件名
        if (!modelPath.endsWith('model.json')) {
            console.error('[Live2D] Invalid model file, must be model.json:', modelPath);
            return;
        }
        
        this.modelPath = modelPath;
        
        console.log('[Live2D] Loading model:', modelPath);
        
        // 使用 live2d.js 内置的 loadlive2d 函数
        // 参数: canvasId, modelPath, callback
        if (typeof loadlive2d === 'function') {
            try {
                loadlive2d(this.canvasId, modelPath, () => {
                    console.log('[Live2D] Model loaded successfully');
                    this.isLoaded = true;
                });
            } catch (e) {
                console.error('[Live2D] Error loading model:', e);
                this.isLoaded = false;
            }
        } else {
            console.error('[Live2D] loadlive2d function not found!');
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
