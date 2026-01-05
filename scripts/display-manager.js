/**
 * 显示器管理模块 (Display Manager)
 * 
 * 实现完整的屏幕适配规则：
 * - 显示器指纹识别与配置存档
 * - 锚点定位系统
 * - DPI 缩放适配
 * - 热插拔响应
 */

const { screen } = require('electron');
const crypto = require('crypto');

// ==================== 常量定义 ====================

const AnchorPoints = {
    TOP_LEFT: 'top_left',
    TOP_RIGHT: 'top_right',
    BOTTOM_LEFT: 'bottom_left',
    BOTTOM_RIGHT: 'bottom_right',
    CENTER: 'center'
};

const SizeMode = {
    FIXED: 'fixed',              // 固定像素大小
    SCREEN_RELATIVE: 'screen_relative'  // 相对屏幕比例
};

// 默认配置
const DEFAULT_DISPLAY_CONFIG = {
    anchor: AnchorPoints.BOTTOM_RIGHT,
    offsetX: -20,   // 相对锚点的 X 偏移（负值表示向内）
    offsetY: -50,   // 相对锚点的 Y 偏移（负值表示向上，避开任务栏）
    sizeMode: SizeMode.FIXED,
    width: 350,
    height: 600,
    widthRatio: 0.15,    // 屏幕宽度比例 (screen_relative 模式)
    heightRatio: 0.35,   // 屏幕高度比例 (screen_relative 模式)
    minWidth: 200,
    maxWidth: 600,
    minHeight: 300,
    maxHeight: 900
};

class DisplayManager {
    constructor() {
        this.displayProfiles = {};  // 显示器配置档案
        this.currentDisplayId = null;
        this.listeners = [];
        this.debugMode = true;      // 基本调试模式
        this.verboseMode = false;   // 详细日志模式
        this._needsClearLegacyConfig = false;
    }

    /**
     * 基本日志输出
     */
    log(...args) {
        if (this.debugMode) {
            console.log('[DisplayManager]', ...args);
        }
    }
    
    /**
     * 详细日志输出（仅 verboseMode 时输出）
     */
    verbose(...args) {
        if (this.debugMode && this.verboseMode) {
            console.log('[DisplayManager]', ...args);
        }
    }

    /**
     * 生成显示器指纹
     * 使用显示器的 ID、分辨率、缩放因子等信息生成唯一标识
     */
    generateDisplayFingerprint(display) {
        const info = {
            id: display.id,
            width: display.bounds.width,
            height: display.bounds.height,
            scaleFactor: display.scaleFactor
        };
        const str = JSON.stringify(info);
        const hash = crypto.createHash('md5').update(str).digest('hex').substring(0, 12);
        
        this.verbose('Fingerprint generated:', hash, 'for display', display.id);
        
        return hash;
    }

    /**
     * 获取当前显示器信息（带调试输出）
     */
    getCurrentDisplayInfo(windowBounds = null) {
        let display;
        
        if (windowBounds) {
            // 根据窗口位置获取对应显示器
            display = screen.getDisplayNearestPoint({
                x: windowBounds.x + windowBounds.width / 2,
                y: windowBounds.y + windowBounds.height / 2
            });
        } else {
            display = screen.getPrimaryDisplay();
        }

        const info = {
            id: display.id,
            fingerprint: this.generateDisplayFingerprint(display),
            // 逻辑分辨率（操作系统报告的，已考虑缩放）
            logicalWidth: display.workAreaSize.width,
            logicalHeight: display.workAreaSize.height,
            // 物理分辨率
            physicalWidth: display.bounds.width * display.scaleFactor,
            physicalHeight: display.bounds.height * display.scaleFactor,
            // 缩放因子
            scaleFactor: display.scaleFactor,
            // 工作区域（排除任务栏等）
            workArea: display.workArea,
            // 边界
            bounds: display.bounds
        };

        this.log(`Display: ${info.fingerprint} | ${info.logicalWidth}x${info.logicalHeight} @ ${info.scaleFactor * 100}%`);
        
        this.verbose('  Physical:', `${info.physicalWidth}x${info.physicalHeight}`);
        this.verbose('  Work Area:', info.workArea);

        return info;
    }

    /**
     * 从保存的配置加载显示档案
     */
    loadProfiles(savedProfiles) {
        if (savedProfiles && typeof savedProfiles === 'object') {
            this.displayProfiles = savedProfiles;
            this.log('Loaded display profiles:', Object.keys(savedProfiles).length, 'profiles');
        }
    }
    
    /**
     * 获取所有显示器信息
     */
    getAllDisplays() {
        const displays = screen.getAllDisplays();
        return displays.map(display => ({
            id: display.id,
            fingerprint: this.generateDisplayFingerprint(display),
            logicalWidth: display.workAreaSize.width,
            logicalHeight: display.workAreaSize.height,
            scaleFactor: display.scaleFactor,
            bounds: display.bounds,
            workArea: display.workArea,
            isPrimary: display.id === screen.getPrimaryDisplay().id
        }));
    }
    
    /**
     * 根据位置获取显示器
     */
    getDisplayAtPosition(x, y) {
        const display = screen.getDisplayNearestPoint({ x, y });
        return this.getCurrentDisplayInfo({ x, y, width: 1, height: 1 });
    }

    /**
     * 获取可保存的档案数据
     */
    getProfilesToSave() {
        return this.displayProfiles;
    }

    /**
     * 获取或创建显示器配置档案
     */
    getDisplayProfile(fingerprint) {
        if (this.displayProfiles[fingerprint]) {
            this.verbose('Found profile:', fingerprint);
            return this.displayProfiles[fingerprint];
        }

        // 尝试从主显示器继承配置
        const primaryProfile = this.getPrimaryDisplayProfile();
        if (primaryProfile) {
            this.verbose('Inheriting from primary display');
            const inherited = { ...primaryProfile };
            this.displayProfiles[fingerprint] = inherited;
            return inherited;
        }

        // 使用默认配置
        this.log('New profile created:', fingerprint);
        const newProfile = { ...DEFAULT_DISPLAY_CONFIG };
        this.displayProfiles[fingerprint] = newProfile;
        return newProfile;
    }

    /**
     * 获取主显示器的配置档案
     */
    getPrimaryDisplayProfile() {
        const primary = screen.getPrimaryDisplay();
        const fingerprint = this.generateDisplayFingerprint(primary);
        return this.displayProfiles[fingerprint] || null;
    }

    /**
     * 更新显示器配置档案
     */
    updateDisplayProfile(fingerprint, updates) {
        const profile = this.getDisplayProfile(fingerprint);
        Object.assign(profile, updates);
        this.displayProfiles[fingerprint] = profile;
        
        this.verbose('Updated profile:', fingerprint, updates);
        return profile;
    }

    /**
     * 根据锚点计算窗口位置
     * 核心算法实现
     */
    calculateWindowBounds(displayInfo, profile) {
        const { logicalWidth: screenW, logicalHeight: screenH, workArea } = displayInfo;
        
        this.verbose('Calculating bounds for screen:', `${screenW}x${screenH}`);

        // Step 1: 计算窗口大小
        let width, height;
        
        if (profile.sizeMode === SizeMode.SCREEN_RELATIVE) {
            // 相对屏幕比例模式
            width = screenW * (profile.widthRatio || 0.15);
            height = screenH * (profile.heightRatio || 0.35);
            
            // 应用 min/max 限制
            width = Math.max(profile.minWidth || 200, Math.min(profile.maxWidth || 600, width));
            height = Math.max(profile.minHeight || 300, Math.min(profile.maxHeight || 900, height));
        } else {
            // 固定像素模式
            width = profile.width || DEFAULT_DISPLAY_CONFIG.width;
            height = profile.height || DEFAULT_DISPLAY_CONFIG.height;
        }
        
        width = Math.round(width);
        height = Math.round(height);

        // Step 2: 基于锚点计算基准位置
        let baseX, baseY;
        const anchor = profile.anchor || AnchorPoints.BOTTOM_RIGHT;
        
        switch (anchor) {
            case AnchorPoints.TOP_LEFT:
                baseX = workArea.x;
                baseY = workArea.y;
                break;
            case AnchorPoints.TOP_RIGHT:
                baseX = workArea.x + workArea.width;
                baseY = workArea.y;
                break;
            case AnchorPoints.BOTTOM_LEFT:
                baseX = workArea.x;
                baseY = workArea.y + workArea.height;
                break;
            case AnchorPoints.BOTTOM_RIGHT:
                baseX = workArea.x + workArea.width;
                baseY = workArea.y + workArea.height;
                break;
            case AnchorPoints.CENTER:
                baseX = workArea.x + workArea.width / 2;
                baseY = workArea.y + workArea.height / 2;
                break;
            default:
                baseX = workArea.x + workArea.width;
                baseY = workArea.y + workArea.height;
        }

        // Step 3: 应用偏移
        const offsetX = profile.offsetX || 0;
        const offsetY = profile.offsetY || 0;
        
        let finalX, finalY;
        
        // 根据锚点位置调整计算方式
        switch (anchor) {
            case AnchorPoints.TOP_LEFT:
                finalX = baseX + offsetX;
                finalY = baseY + offsetY;
                break;
            case AnchorPoints.TOP_RIGHT:
                finalX = baseX + offsetX - width;
                finalY = baseY + offsetY;
                break;
            case AnchorPoints.BOTTOM_LEFT:
                finalX = baseX + offsetX;
                finalY = baseY + offsetY - height;
                break;
            case AnchorPoints.BOTTOM_RIGHT:
                finalX = baseX + offsetX - width;
                finalY = baseY + offsetY - height;
                break;
            case AnchorPoints.CENTER:
                finalX = baseX + offsetX - width / 2;
                finalY = baseY + offsetY - height / 2;
                break;
            default:
                finalX = baseX + offsetX - width;
                finalY = baseY + offsetY - height;
        }

        // Step 4: 边界检查（确保窗口在屏幕内）
        finalX = Math.max(workArea.x, Math.min(workArea.x + workArea.width - width, finalX));
        finalY = Math.max(workArea.y, Math.min(workArea.y + workArea.height - height, finalY));
        
        finalX = Math.round(finalX);
        finalY = Math.round(finalY);
        
        this.log(`Bounds: ${anchor} + (${offsetX},${offsetY}) => (${finalX},${finalY}) ${width}x${height}`);

        return {
            x: finalX,
            y: finalY,
            width: width,
            height: height
        };
    }

    /**
     * 从当前窗口位置反算偏移量
     * 用于保存用户手动调整后的位置
     */
    calculateOffsetFromPosition(displayInfo, windowBounds, profile) {
        const { workArea } = displayInfo;
        const { x, y, width, height } = windowBounds;
        const anchor = profile.anchor || AnchorPoints.BOTTOM_RIGHT;
        
        let baseX, baseY;
        
        switch (anchor) {
            case AnchorPoints.TOP_LEFT:
                baseX = workArea.x;
                baseY = workArea.y;
                break;
            case AnchorPoints.TOP_RIGHT:
                baseX = workArea.x + workArea.width;
                baseY = workArea.y;
                break;
            case AnchorPoints.BOTTOM_LEFT:
                baseX = workArea.x;
                baseY = workArea.y + workArea.height;
                break;
            case AnchorPoints.BOTTOM_RIGHT:
                baseX = workArea.x + workArea.width;
                baseY = workArea.y + workArea.height;
                break;
            case AnchorPoints.CENTER:
                baseX = workArea.x + workArea.width / 2;
                baseY = workArea.y + workArea.height / 2;
                break;
            default:
                baseX = workArea.x + workArea.width;
                baseY = workArea.y + workArea.height;
        }

        let offsetX, offsetY;
        
        switch (anchor) {
            case AnchorPoints.TOP_LEFT:
                offsetX = x - baseX;
                offsetY = y - baseY;
                break;
            case AnchorPoints.TOP_RIGHT:
                offsetX = x + width - baseX;
                offsetY = y - baseY;
                break;
            case AnchorPoints.BOTTOM_LEFT:
                offsetX = x - baseX;
                offsetY = y + height - baseY;
                break;
            case AnchorPoints.BOTTOM_RIGHT:
                offsetX = x + width - baseX;
                offsetY = y + height - baseY;
                break;
            case AnchorPoints.CENTER:
                offsetX = x + width / 2 - baseX;
                offsetY = y + height / 2 - baseY;
                break;
            default:
                offsetX = x + width - baseX;
                offsetY = y + height - baseY;
        }

        this.verbose('Offset from position:', { offsetX, offsetY, anchor });
        
        return { offsetX: Math.round(offsetX), offsetY: Math.round(offsetY) };
    }

    /**
     * 计算屏幕相对尺寸比例
     */
    calculateSizeRatio(displayInfo, windowBounds) {
        const widthRatio = windowBounds.width / displayInfo.logicalWidth;
        const heightRatio = windowBounds.height / displayInfo.logicalHeight;
        
        this.verbose('Size ratio:', { widthRatio, heightRatio });
        
        return { widthRatio, heightRatio };
    }

    /**
     * 添加显示器变化监听器
     */
    addListener(callback) {
        this.listeners.push(callback);
    }

    /**
     * 移除监听器
     */
    removeListener(callback) {
        const index = this.listeners.indexOf(callback);
        if (index > -1) {
            this.listeners.splice(index, 1);
        }
    }

    /**
     * 通知所有监听器
     */
    notifyListeners(event, data) {
        this.listeners.forEach(callback => {
            try {
                callback(event, data);
            } catch (e) {
                console.error('[DisplayManager] Listener error:', e);
            }
        });
    }

    /**
     * 设置显示器变化监听
     */
    setupDisplayListeners() {
        // 显示器指标变化（分辨率、缩放等）
        screen.on('display-metrics-changed', (event, display, changedMetrics) => {
            this.log(`Display changed: ${changedMetrics.join(', ')} | Scale: ${display.scaleFactor * 100}%`);
            this.verbose('Bounds:', display.bounds, 'Work Area:', display.workAreaSize);

            const displayInfo = this.getCurrentDisplayInfo();
            this.notifyListeners('display-metrics-changed', {
                display,
                changedMetrics,
                displayInfo
            });
        });

        // 显示器添加
        screen.on('display-added', (event, display) => {
            this.log(`Display added: ID ${display.id} | ${display.bounds.width}x${display.bounds.height}`);

            this.notifyListeners('display-added', { display });
        });

        // 显示器移除
        screen.on('display-removed', (event, display) => {
            this.log(`Display removed: ID ${display.id}`);

            this.notifyListeners('display-removed', { display });
        });

        this.log('Display listeners ready');
    }

    /**
     * 处理窗口移动结束事件
     * 更新配置档案
     */
    handleWindowMoveEnd(windowBounds) {
        const displayInfo = this.getCurrentDisplayInfo(windowBounds);
        const profile = this.getDisplayProfile(displayInfo.fingerprint);
        
        // 反算偏移量
        const { offsetX, offsetY } = this.calculateOffsetFromPosition(displayInfo, windowBounds, profile);
        
        // 更新档案
        this.updateDisplayProfile(displayInfo.fingerprint, {
            offsetX,
            offsetY,
            width: windowBounds.width,
            height: windowBounds.height
        });

        return {
            displayInfo,
            profile: this.displayProfiles[displayInfo.fingerprint]
        };
    }

    /**
     * 处理窗口大小调整结束事件
     */
    handleWindowResizeEnd(windowBounds) {
        const displayInfo = this.getCurrentDisplayInfo(windowBounds);
        const profile = this.getDisplayProfile(displayInfo.fingerprint);
        
        // 计算新的尺寸比例
        const { widthRatio, heightRatio } = this.calculateSizeRatio(displayInfo, windowBounds);
        
        // 反算偏移量
        const { offsetX, offsetY } = this.calculateOffsetFromPosition(displayInfo, windowBounds, profile);
        
        // 更新档案
        this.updateDisplayProfile(displayInfo.fingerprint, {
            offsetX,
            offsetY,
            width: windowBounds.width,
            height: windowBounds.height,
            widthRatio,
            heightRatio
        });

        return {
            displayInfo,
            profile: this.displayProfiles[displayInfo.fingerprint]
        };
    }

    /**
     * 获取初始窗口位置（程序启动时）
     */
    getInitialWindowBounds(savedConfig = null) {
        // 如果有保存的窗口位置，使用它来确定对应的显示器
        let displayInfo;
        if (savedConfig && Number.isFinite(savedConfig.windowX) && Number.isFinite(savedConfig.windowY)) {
            const savedBounds = {
                x: savedConfig.windowX,
                y: savedConfig.windowY,
                width: savedConfig.windowWidth || 350,
                height: savedConfig.windowHeight || 600
            };
            displayInfo = this.getCurrentDisplayInfo(savedBounds);
            this.log('Detected display from saved position:', displayInfo.fingerprint);
        } else {
            displayInfo = this.getCurrentDisplayInfo();
        }
        
        const fingerprint = displayInfo.fingerprint;
        
        // 检查是否已有该显示器的档案（且包含有效的偏移量设置）
        const existingProfile = this.displayProfiles[fingerprint];
        const hasValidProfile = existingProfile && 
            Number.isFinite(existingProfile.offsetX) && 
            Number.isFinite(existingProfile.offsetY);
        
        let profile;
        
        if (hasValidProfile) {
            // 使用已保存的档案，不进行迁移
            this.log('Using existing profile for fingerprint:', fingerprint);
            profile = existingProfile;
        } else if (savedConfig && (Number.isFinite(savedConfig.windowX) || Number.isFinite(savedConfig.windowY))) {
            // 仅当没有有效档案时，才从旧配置迁移
            this.log('Migrating from legacy config (no existing profile)...');
            
            const legacyBounds = {
                x: savedConfig.windowX || 0,
                y: savedConfig.windowY || 0,
                width: savedConfig.windowWidth || DEFAULT_DISPLAY_CONFIG.width,
                height: savedConfig.windowHeight || DEFAULT_DISPLAY_CONFIG.height
            };
            
            // 先获取或创建默认 profile
            profile = this.getDisplayProfile(fingerprint);
            const { offsetX, offsetY } = this.calculateOffsetFromPosition(displayInfo, legacyBounds, profile);
            
            profile = this.updateDisplayProfile(fingerprint, {
                offsetX,
                offsetY,
                width: legacyBounds.width,
                height: legacyBounds.height
            });
            
            // 返回迁移标记
            this._needsClearLegacyConfig = true;
        } else {
            // 使用默认配置创建新档案
            this.log('Creating new profile with defaults');
            profile = this.getDisplayProfile(fingerprint);
        }

        return this.calculateWindowBounds(displayInfo, profile);
    }
    
    /**
     * 检查是否需要清除旧配置
     */
    needsClearLegacyConfig() {
        return this._needsClearLegacyConfig === true;
    }

    /**
     * 处理显示器变化，重新计算窗口位置
     */
    recalculateWindowBounds(currentBounds = null) {
        const displayInfo = this.getCurrentDisplayInfo(currentBounds);
        const profile = this.getDisplayProfile(displayInfo.fingerprint);
        
        return this.calculateWindowBounds(displayInfo, profile);
    }
    
    /**
     * 根据指定的显示器 fingerprint 计算窗口位置
     * 用于将窗口移动到其他显示器
     */
    calculateBoundsForDisplay(targetFingerprint) {
        // 找到目标显示器
        const displays = screen.getAllDisplays();
        let targetDisplay = null;
        
        for (const display of displays) {
            const fp = this.generateDisplayFingerprint(display);
            if (fp === targetFingerprint) {
                targetDisplay = display;
                break;
            }
        }
        
        if (!targetDisplay) {
            this.log('Target display not found:', targetFingerprint);
            return null;
        }
        
        // 构建显示器信息
        const displayInfo = {
            id: targetDisplay.id,
            fingerprint: targetFingerprint,
            logicalWidth: targetDisplay.workAreaSize.width,
            logicalHeight: targetDisplay.workAreaSize.height,
            physicalWidth: targetDisplay.bounds.width * targetDisplay.scaleFactor,
            physicalHeight: targetDisplay.bounds.height * targetDisplay.scaleFactor,
            scaleFactor: targetDisplay.scaleFactor,
            workArea: targetDisplay.workArea,
            bounds: targetDisplay.bounds
        };
        
        const profile = this.getDisplayProfile(targetFingerprint);
        this.log(`Moving to display: ${targetFingerprint} (${displayInfo.logicalWidth}x${displayInfo.logicalHeight})`);
        
        return this.calculateWindowBounds(displayInfo, profile);
    }
}

// 导出
module.exports = {
    DisplayManager,
    AnchorPoints,
    SizeMode,
    DEFAULT_DISPLAY_CONFIG
};
