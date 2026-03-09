/**
 * 跨平台光标位置追踪模块 (Cursor Tracker)
 * 
 * 处理不同 Linux 显示服务器下的全局光标位置获取：
 * - X11: 使用 Electron 的 screen.getCursorScreenPoint()（直接可用）
 * - Wayland + GNOME: 通过自定义 GNOME Shell 扩展的 DBus 接口（推荐）
 *                    或通过 Shell.Eval（需要 unsafe mode，旧 GNOME 版本）
 * - Wayland + KDE: 通过 KWin DBus 接口获取光标位置
 * - Wayland + Hyprland: 通过 hyprctl 命令
 * - Wayland + 其他: 尝试 ydotool，最后回退到 Electron API（仅窗口内有效）
 * 
 * GNOME Wayland 方案说明：
 * GNOME Shell 45+ 默认禁用了 Shell.Eval DBus 方法（安全限制）。
 * 因此需要一个轻量级 GNOME Shell 扩展 (cursor-tracker@live2d-desktop) 
 * 来在 Shell 进程内注册自定义 DBus 接口暴露光标位置。
 * 用户需手动安装该扩展（参见 README）。
 */

const { spawn, execSync } = require('child_process');

// GNOME Shell 扩展相关常量
const EXTENSION_UUID = 'cursor-tracker@live2d-desktop';
const EXTENSION_DBUS_DEST = 'org.gnome.Shell';
const EXTENSION_DBUS_PATH = '/com/live2d/CursorTracker';
const EXTENSION_DBUS_IFACE = 'com.live2d.CursorTracker';

class CursorTracker {
    /**
     * @param {Electron.Screen} electronScreen - Electron 的 screen 模块实例
     */
    constructor(electronScreen) {
        this._screen = electronScreen;
        this.sessionType = this._detectSessionType();
        this.desktopEnv = this._detectDesktopEnvironment();
        this.lastPosition = { x: 0, y: 0 };
        this._helperProcess = null;
        this._interval = null;
        this._listeners = [];
        this._started = false;
        this._method = 'unknown';
        this._retryTimer = null;
        this._startInterval = 50;
        this._requestedMode = 'auto';
        this._lastError = null;

        console.log(`[CursorTracker] Session: ${this.sessionType}, DE: ${this.desktopEnv}`);

        // 确保进程退出时清理子进程
        process.on('exit', () => this._killHelper());
    }

    // ==================== 环境检测 ====================

    _detectSessionType() {
        if (process.env.XDG_SESSION_TYPE === 'wayland') return 'wayland';
        if (process.env.XDG_SESSION_TYPE === 'x11') return 'x11';
        if (process.env.WAYLAND_DISPLAY) return 'wayland';
        if (process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return 'x11';
        return 'x11'; // 默认回退
    }

    _detectDesktopEnvironment() {
        const desktop = (process.env.XDG_CURRENT_DESKTOP || '').toLowerCase();
        if (desktop.includes('gnome') || desktop.includes('unity') || desktop.includes('pop') || desktop.includes('budgie')) return 'gnome';
        if (desktop.includes('kde') || desktop.includes('plasma')) return 'kde';
        if (desktop.includes('hyprland')) return 'hyprland';
        if (desktop.includes('sway')) return 'sway';
        return 'unknown';
    }

    // ==================== 公共接口 ====================

    isWayland() {
        return this.sessionType === 'wayland';
    }

    getMethod() {
        return this._method;
    }

    /**
     * 获取环境诊断信息（用于调试和设置界面显示）
     */
    getEnvironmentInfo() {
        return {
            sessionType: this.sessionType,
            desktopEnv: this.desktopEnv,
            trackingMethod: this._method,
            isWayland: this.isWayland(),
            requestedMode: this._requestedMode,
            lastError: this._lastError
        };
    }

    /**
     * 探测当前系统可用的追踪模式
     * 注意：此方法执行同步系统调用进行探测，可能需要数秒，仅在设置页面调用
     */
    getAvailableModes() {
        const hasGjs = this._commandExists('gjs');
        const hasGdbus = this._commandExists('gdbus');

        return [
            {
                id: 'auto',
                name: '自动检测',
                available: true,
                description: '根据系统环境自动选择最佳追踪方式'
            },
            {
                id: 'electron',
                name: 'Electron API',
                available: true,
                description: this.isWayland()
                    ? '内置 API（Wayland 下仅窗口内有效）'
                    : '内置 API（全屏追踪）'
            },
            {
                id: 'gnome-extension',
                name: 'GNOME Shell 扩展',
                available: hasGjs && hasGdbus && this._isGnomeExtensionAvailable(),
                description: '通过自定义 Shell 扩展获取光标（推荐）',
                unavailableReason: !hasGjs ? 'gjs 未安装'
                    : !hasGdbus ? 'gdbus 未安装'
                    : '扩展未安装或未启用'
            },
            {
                id: 'gnome-eval',
                name: 'GNOME Shell.Eval',
                available: hasGdbus && this._isShellEvalAvailable(),
                description: '通过 Shell.Eval DBus（需旧版 GNOME 或开发者模式）',
                unavailableReason: !hasGdbus ? 'gdbus 未安装' : 'Shell.Eval 被禁用'
            },
            {
                id: 'kde-dbus',
                name: 'KDE KWin DBus',
                available: hasGdbus && this._isKdeAvailable(),
                description: '通过 KWin DBus 接口获取光标',
                unavailableReason: !hasGdbus ? 'gdbus 未安装' : 'KWin 服务不可用'
            },
            {
                id: 'hyprland',
                name: 'Hyprland (hyprctl)',
                available: this._commandExists('hyprctl'),
                description: '通过 hyprctl 命令获取光标',
                unavailableReason: 'hyprctl 未找到'
            },
            {
                id: 'ydotool',
                name: 'ydotool',
                available: this._commandExists('ydotool'),
                description: '通用方案（需要 ydotoold 守护进程）',
                unavailableReason: 'ydotool 未安装'
            }
        ];
    }

    /**
     * 启动光标追踪
     * @param {number} interval - 轮询间隔（毫秒），X11 建议 16ms (60FPS)，Wayland 建议 50ms (20FPS)
     */
    start(interval = 50, mode = 'auto') {
        if (this._started) return;
        this._started = true;
        this._startInterval = interval;
        this._requestedMode = mode;
        this._lastError = null;

        if (mode !== 'auto') {
            this._startSpecificMode(interval, mode);
            return;
        }

        if (this.sessionType !== 'wayland') {
            this._startElectronTracking(interval);
            return;
        }

        // Wayland - 根据桌面环境选择追踪方式
        let success = false;
        switch (this.desktopEnv) {
            case 'gnome':
                success = this._startGnomeTracking(interval);
                break;
            case 'kde':
                success = this._startKdeTracking(interval);
                break;
            case 'hyprland':
                success = this._startHyprlandTracking(interval);
                break;
            default:
                success = false;
                break;
        }

        if (!success) {
            this._startGenericWaylandFallback(interval);
        }
    }

    stop() {
        this._started = false;
        if (this._interval) {
            clearInterval(this._interval);
            this._interval = null;
        }
        if (this._retryTimer) {
            clearInterval(this._retryTimer);
            this._retryTimer = null;
        }
        this._killHelper();
    }

    /**
     * 重启光标追踪（用于切换追踪方式或扩展延迟加载后重连）
     * @param {number} [interval] - 可选的新轮询间隔
     */
    restart(interval, mode) {
        const useInterval = interval || this._startInterval || 50;
        const useMode = mode !== undefined ? mode : this._requestedMode || 'auto';
        console.log(`[CursorTracker] Restarting (interval: ${useInterval}ms, mode: ${useMode})...`);
        this.stop();
        this.start(useInterval, useMode);
    }

    /**
     * 注册光标位置更新回调
     * @param {function({x: number, y: number}): void} callback
     */
    onPositionUpdate(callback) {
        this._listeners.push(callback);
    }

    removeListener(callback) {
        const idx = this._listeners.indexOf(callback);
        if (idx > -1) this._listeners.splice(idx, 1);
    }

    // ==================== 内部方法 ====================

    _notify(x, y) {
        const pos = { x, y };
        this.lastPosition = pos;
        for (const cb of this._listeners) {
            try { cb(pos); } catch (e) {
                console.error('[CursorTracker] Listener error:', e);
            }
        }
    }

    _killHelper() {
        if (this._helperProcess) {
            try { this._helperProcess.kill('SIGTERM'); } catch (e) { /* ignore */ }
            this._helperProcess = null;
        }
    }

    _commandExists(cmd) {
        try {
            execSync(`which ${cmd}`, { timeout: 2000, stdio: 'ignore' });
            return true;
        } catch (e) {
            return false;
        }
    }

    // ==================== 指定模式启动 ====================

    /**
     * 以指定模式启动追踪
     * 如果指定模式失败，回退到 Electron API 并记录错误
     */
    _startSpecificMode(interval, mode) {
        console.log(`[CursorTracker] Starting with specific mode: ${mode}`);

        switch (mode) {
            case 'electron':
                this._startElectronTracking(interval);
                // 用户明确选择，不标记为 fallback
                this._method = 'electron';
                return;

            case 'gnome-extension':
                if (!this._commandExists('gjs')) {
                    this._lastError = 'gjs 未安装，请安装 gjs 包';
                    break;
                }
                if (!this._isGnomeExtensionAvailable()) {
                    this._lastError = 'GNOME Shell 扩展未安装或未启用。请按 README 说明安装 cursor-tracker@live2d-desktop 扩展';
                    break;
                }
                if (this._startGjsHelper(interval, 'extension')) return;
                this._lastError = 'GJS 辅助进程启动失败';
                break;

            case 'gnome-eval':
                if (!this._commandExists('gjs')) {
                    this._lastError = 'gjs 未安装';
                    break;
                }
                if (!this._isShellEvalAvailable()) {
                    this._lastError = 'GNOME Shell.Eval 不可用（GNOME 45+ 默认禁用此方法）';
                    break;
                }
                if (this._startGjsHelper(interval, 'eval')) return;
                this._lastError = 'GJS 辅助进程启动失败';
                break;

            case 'kde-dbus':
                if (!this._commandExists('gdbus')) {
                    this._lastError = 'gdbus 未安装';
                    break;
                }
                if (!this._isKdeAvailable()) {
                    this._lastError = 'KDE KWin DBus 服务不可用。确认正在使用 KDE Plasma 桌面';
                    break;
                }
                if (this._startKdeTracking(interval)) return;
                this._lastError = 'KDE DBus 追踪启动失败';
                break;

            case 'hyprland':
                if (!this._commandExists('hyprctl')) {
                    this._lastError = 'hyprctl 未找到。确认正在使用 Hyprland';
                    break;
                }
                if (this._startHyprlandTracking(interval)) return;
                this._lastError = 'hyprctl 追踪启动失败';
                break;

            case 'ydotool':
                if (!this._commandExists('ydotool')) {
                    this._lastError = 'ydotool 未安装';
                    break;
                }
                if (this._startYdotoolTracking(interval)) return;
                this._lastError = 'ydotool 追踪启动失败';
                break;

            default:
                this._lastError = `未知的追踪模式: ${mode}`;
                break;
        }

        // 指定模式失败，回退到 Electron API
        console.warn(`[CursorTracker] Mode '${mode}' failed: ${this._lastError}`);
        console.warn('[CursorTracker] Falling back to Electron API');
        this._startElectronTracking(interval);
    }

    // ==================== X11 / Electron 回退 ====================

    _startElectronTracking(interval) {
        this._method = this.sessionType === 'wayland' ? 'electron-fallback' : 'electron';
        console.log(`[CursorTracker] Using Electron API (${this._method})`);
        if (this._method === 'electron-fallback') {
            console.warn('[CursorTracker] WARNING: Electron fallback on Wayland - cursor tracking limited to app window area');
        }

        this._interval = setInterval(() => {
            try {
                const pos = this._screen.getCursorScreenPoint();
                this._notify(pos.x, pos.y);
            } catch (e) { /* ignore */ }
        }, interval);
    }

    // ==================== GNOME Wayland ====================

    /**
     * GNOME Wayland 光标追踪的优先级链：
     * 1. 自定义 GNOME Shell 扩展的 DBus 接口（推荐，适用于 GNOME 45+）
     * 2. Shell.Eval DBus 方法（旧版 GNOME 或启用了 unsafe mode）
     * 3. Electron API 回退（仅窗口内有效）
     */
    _startGnomeTracking(interval) {
        if (!this._commandExists('gjs')) {
            console.log('[CursorTracker] gjs not found, cannot use GNOME tracking');
            return false;
        }

        // 尝试 1: 自定义扩展 DBus 接口
        if (this._isGnomeExtensionAvailable()) {
            console.log('[CursorTracker] GNOME Shell extension DBus interface is available');
            return this._startGjsHelper(interval, 'extension');
        }

        // 扩展未安装/未启用
        console.warn('[CursorTracker] GNOME Shell extension not available');
        console.warn('[CursorTracker] Full-screen tracking requires the cursor-tracker@live2d-desktop extension');
        console.warn('[CursorTracker] See README for installation instructions');

        // 尝试 2: Shell.Eval（旧版 GNOME 或已启用 unsafe mode）
        if (this._isShellEvalAvailable()) {
            console.log('[CursorTracker] Shell.Eval is available (unsafe mode enabled)');
            return this._startGjsHelper(interval, 'eval');
        }

        // 都不可用 - 先启动 Electron 回退（限窗口内），同时在后台定期重试
        console.warn('[CursorTracker] Neither extension nor Shell.Eval available, using fallback + deferred retry');
        this._startElectronTracking(interval);
        this._scheduleDeferredGnomeRetry(interval);
        return true; // 已在追踪（回退模式），不走通用 fallback
    }

    /**
     * 延迟重试：后台定期检查扩展是否变为可用
     * 用于处理开机自启时扩展尚未加载的情况
     */
    _scheduleDeferredGnomeRetry(interval) {
        const MAX_RETRIES = 10;
        const RETRY_INTERVAL = 3000; // 每 3 秒检查一次
        let retryCount = 0;

        console.log(`[CursorTracker] Scheduling deferred retry (max ${MAX_RETRIES} attempts, every ${RETRY_INTERVAL / 1000}s)`);

        this._retryTimer = setInterval(() => {
            retryCount++;

            if (!this._started) {
                clearInterval(this._retryTimer);
                this._retryTimer = null;
                return;
            }

            if (retryCount > MAX_RETRIES) {
                clearInterval(this._retryTimer);
                this._retryTimer = null;
                console.warn(`[CursorTracker] Extension retry limit reached (${MAX_RETRIES} attempts). ` +
                    'Full-screen tracking unavailable. Please check extension installation and restart the app.');
                return;
            }

            console.log(`[CursorTracker] Deferred retry ${retryCount}/${MAX_RETRIES}: checking extension...`);

            if (this._isGnomeExtensionAvailable()) {
                clearInterval(this._retryTimer);
                this._retryTimer = null;
                console.log('[CursorTracker] Extension now available! Upgrading from fallback...');
                this._upgradeTracking(interval, 'extension');
            } else if (this._isShellEvalAvailable()) {
                clearInterval(this._retryTimer);
                this._retryTimer = null;
                console.log('[CursorTracker] Shell.Eval now available! Upgrading from fallback...');
                this._upgradeTracking(interval, 'eval');
            }
        }, RETRY_INTERVAL);
    }

    /**
     * 从回退模式升级到更好的追踪方式（不改变 _started 状态）
     */
    _upgradeTracking(interval, mode) {
        // 停止当前的回退追踪
        if (this._interval) {
            clearInterval(this._interval);
            this._interval = null;
        }
        this._killHelper();

        // 启动新的追踪方式
        const started = this._startGjsHelper(interval, mode);
        if (!started) {
            console.warn('[CursorTracker] Upgrade failed, reverting to Electron fallback');
            this._startElectronTracking(interval);
        }
    }

    /**
     * 检查自定义 GNOME Shell 扩展的 DBus 接口是否可用
     */
    _isGnomeExtensionAvailable() {
        try {
            const result = execSync(
                `gdbus call --session --dest ${EXTENSION_DBUS_DEST} ` +
                `--object-path ${EXTENSION_DBUS_PATH} ` +
                `--method ${EXTENSION_DBUS_IFACE}.GetVersion`,
                { timeout: 2000, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
            );
            return result.includes('1');
        } catch (e) {
            return false;
        }
    }

    /**
     * 检查 Shell.Eval 是否可用
     */
    _isShellEvalAvailable() {
        try {
            const result = execSync(
                'gdbus call --session --dest org.gnome.Shell ' +
                '--object-path /org/gnome/Shell ' +
                '--method org.gnome.Shell.Eval "1+1"',
                { timeout: 2000, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
            );
            return result.includes('true');
        } catch (e) {
            return false;
        }
    }

    /**
     * 检查 KDE KWin DBus 是否可用
     */
    _isKdeAvailable() {
        try {
            const result = execSync(
                'gdbus call --session --dest org.kde.KWin ' +
                '--object-path /KWin --method org.kde.KWin.cursorPos',
                { timeout: 2000, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
            );
            return /\d+/.test(result);
        } catch (e) {
            return false;
        }
    }

    /**
     * 使用 GJS 辅助进程进行光标追踪
     * @param {number} interval - 轮询间隔
     * @param {'extension'|'eval'} mode - 使用扩展 DBus 接口还是 Shell.Eval
     */
    _startGjsHelper(interval, mode) {
        const pollInterval = Math.max(interval, 30);

        let gjsScript;
        if (mode === 'extension') {
            // 通过自定义扩展 DBus 接口获取光标位置
            gjsScript = `
const { Gio, GLib } = imports.gi;
const bus = Gio.bus_get_sync(Gio.BusType.SESSION, null);
const INTERVAL = ${pollInterval};
let errors = 0;

function poll() {
    try {
        const r = bus.call_sync(
            '${EXTENSION_DBUS_DEST}',
            '${EXTENSION_DBUS_PATH}',
            '${EXTENSION_DBUS_IFACE}',
            'GetCursorPosition',
            null,
            GLib.VariantType.new('(ii)'),
            Gio.DBusCallFlags.NONE, 200, null
        );
        const x = r.get_child_value(0).get_int32();
        const y = r.get_child_value(1).get_int32();
        print(x + ',' + y);
        errors = 0;
    } catch(e) {
        errors++;
        if (errors > 20) {
            printerr('Too many errors, exiting: ' + e.message);
            imports.system.exit(1);
        }
    }
    return GLib.SOURCE_CONTINUE;
}

poll();
GLib.timeout_add(GLib.PRIORITY_DEFAULT, INTERVAL, poll);
new GLib.MainLoop(null, false).run();
`;
        } else {
            // 通过 Shell.Eval 获取光标位置（旧版 GNOME / unsafe mode）
            gjsScript = `
const { Gio, GLib } = imports.gi;
const bus = Gio.bus_get_sync(Gio.BusType.SESSION, null);
const INTERVAL = ${pollInterval};
let errors = 0;

const EVAL_EXPRS = [
    'const p=global.get_pointer();p[0]+","+p[1]',
    'const t=Meta.CursorTracker.get_for_display(global.display);const[pt]=t.get_pointer();Math.round(pt.x)+","+Math.round(pt.y)'
];
let exprIdx = 0;

function poll() {
    try {
        const r = bus.call_sync(
            'org.gnome.Shell', '/org/gnome/Shell',
            'org.gnome.Shell', 'Eval',
            GLib.Variant.new('(s)', [EVAL_EXPRS[exprIdx]]),
            GLib.VariantType.new('(bs)'),
            Gio.DBusCallFlags.NONE, 200, null
        );
        const success = r.get_child_value(0).get_boolean();
        const value = r.get_child_value(1).get_string()[0];
        if (success && value && value !== 'undefined') {
            print(value);
            errors = 0;
        } else {
            errors++;
            if (errors > 3 && exprIdx < EVAL_EXPRS.length - 1) {
                printerr('Switching to fallback eval expression');
                exprIdx++;
                errors = 0;
            }
        }
    } catch(e) {
        errors++;
        if (errors > 20) {
            printerr('Too many errors, exiting: ' + e.message);
            imports.system.exit(1);
        }
    }
    return GLib.SOURCE_CONTINUE;
}

poll();
GLib.timeout_add(GLib.PRIORITY_DEFAULT, INTERVAL, poll);
new GLib.MainLoop(null, false).run();
`;
        }

        try {
            const proc = spawn('gjs', ['-c', gjsScript], {
                stdio: ['ignore', 'pipe', 'pipe']
            });
            this._helperProcess = proc;

            this._method = `gnome-${mode}`;
            console.log(`[CursorTracker] GJS helper started (mode: ${mode}, PID: ${proc.pid}, interval: ${pollInterval}ms)`);

            let buffer = '';
            proc.stdout.on('data', (data) => {
                buffer += data.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop(); // 保留不完整的行

                for (const line of lines) {
                    const parts = line.trim().split(',');
                    if (parts.length === 2) {
                        const x = parseInt(parts[0], 10);
                        const y = parseInt(parts[1], 10);
                        if (!isNaN(x) && !isNaN(y)) {
                            this._notify(x, y);
                        }
                    }
                }
            });

            proc.stderr.on('data', (d) => {
                const msg = d.toString().trim();
                if (msg) console.warn('[CursorTracker:gjs]', msg);
            });

            proc.on('exit', (code) => {
                console.log(`[CursorTracker] GJS helper exited (code: ${code})`);

                // 如果已经被 restart/stop 替换为新的进程，忽略旧进程的退出
                if (this._helperProcess !== proc) {
                    console.log('[CursorTracker] Ignoring exit from replaced helper process');
                    return;
                }
                this._helperProcess = null;

                // 如果仍然应该运行，尝试降级
                if (this._started) {
                    console.log('[CursorTracker] GJS failed, attempting fallback...');
                    if (mode === 'extension') {
                        // 扩展模式失败，尝试 Eval 模式
                        if (this._isShellEvalAvailable()) {
                            this._startGjsHelper(interval, 'eval');
                        } else if (!this._startGdbusGnomePolling(interval)) {
                            this._startElectronTracking(interval);
                        }
                    } else {
                        // Eval 模式失败，尝试 gdbus 轮询
                        if (!this._startGdbusGnomePolling(interval)) {
                            this._startElectronTracking(interval);
                        }
                    }
                }
            });

            proc.on('error', (err) => {
                console.error('[CursorTracker] GJS spawn error:', err.message);
                if (this._helperProcess === proc) {
                    this._helperProcess = null;
                }
            });

            return true;
        } catch (e) {
            console.error('[CursorTracker] Failed to start GJS helper:', e.message);
            return false;
        }
    }

    /**
     * 使用 gdbus 轮询获取光标位置（备用方案）
     * 每次调用都创建新的 DBus 连接，性能较差但不依赖 gjs
     */
    _startGdbusGnomePolling(interval) {
        if (!this._commandExists('gdbus')) return false;

        // 检测用扩展接口还是 Shell.Eval
        const useExtension = this._isGnomeExtensionAvailable();
        const useEval = !useExtension && this._isShellEvalAvailable();
        if (!useExtension && !useEval) return false;

        this._method = useExtension ? 'gnome-gdbus-ext' : 'gnome-gdbus-eval';
        const pollInterval = Math.max(interval, 80);
        console.log(`[CursorTracker] Using gdbus polling (${this._method}, ${pollInterval}ms)`);

        let pending = false;
        this._interval = setInterval(() => {
            if (pending) return;
            pending = true;

            const args = useExtension
                ? ['call', '--session',
                   '--dest', EXTENSION_DBUS_DEST,
                   '--object-path', EXTENSION_DBUS_PATH,
                   '--method', `${EXTENSION_DBUS_IFACE}.GetCursorPosition`]
                : ['call', '--session',
                   '--dest', 'org.gnome.Shell',
                   '--object-path', '/org/gnome/Shell',
                   '--method', 'org.gnome.Shell.Eval',
                   'const p=global.get_pointer();p[0]+","+p[1]'];

            try {
                const proc = spawn('gdbus', args, { stdio: ['ignore', 'pipe', 'ignore'] });
                let out = '';
                proc.stdout.on('data', (d) => out += d.toString());
                proc.on('close', () => {
                    pending = false;
                    if (useExtension) {
                        // 格式: (960, 540)
                        const m = out.match(/(-?\d+),\s*(-?\d+)/);
                        if (m) this._notify(parseInt(m[1], 10), parseInt(m[2], 10));
                    } else {
                        // 格式: (true, '960,540')
                        const m = out.match(/true,\s*'(-?\d+),(-?\d+)'/);
                        if (m) this._notify(parseInt(m[1], 10), parseInt(m[2], 10));
                    }
                });
                proc.on('error', () => { pending = false; });
            } catch (e) {
                pending = false;
            }
        }, pollInterval);

        return true;
    }

    // ==================== KDE Wayland ====================

    /**
     * 使用 KWin DBus 接口获取光标位置
     * KDE Plasma 通过 org.kde.KWin 暴露 cursorPos 方法
     */
    _startKdeTracking(interval) {
        if (!this._commandExists('gdbus')) return false;

        this._method = 'kde-dbus';
        const pollInterval = Math.max(interval, 80);
        console.log(`[CursorTracker] Using KDE DBus polling (${pollInterval}ms)`);

        let pending = false;
        this._interval = setInterval(() => {
            if (pending) return;
            pending = true;

            try {
                const proc = spawn('gdbus', [
                    'call', '--session',
                    '--dest', 'org.kde.KWin',
                    '--object-path', '/KWin',
                    '--method', 'org.kde.KWin.cursorPos'
                ], { stdio: ['ignore', 'pipe', 'ignore'] });

                let out = '';
                proc.stdout.on('data', (d) => out += d.toString());
                proc.on('close', () => {
                    pending = false;
                    // 解析各种可能的格式: (960, 540), ((960, 540),) 等
                    const m = out.match(/(-?\d+)[,\s]+(-?\d+)/);
                    if (m) this._notify(parseInt(m[1], 10), parseInt(m[2], 10));
                });
                proc.on('error', () => { pending = false; });
            } catch (e) {
                pending = false;
            }
        }, pollInterval);

        return true;
    }

    // ==================== Hyprland ====================

    _startHyprlandTracking(interval) {
        if (!this._commandExists('hyprctl')) return false;

        this._method = 'hyprland';
        const pollInterval = Math.max(interval, 50);
        console.log(`[CursorTracker] Using hyprctl polling (${pollInterval}ms)`);

        let pending = false;
        this._interval = setInterval(() => {
            if (pending) return;
            pending = true;

            try {
                const proc = spawn('hyprctl', ['cursorpos'], {
                    stdio: ['ignore', 'pipe', 'ignore']
                });

                let out = '';
                proc.stdout.on('data', (d) => out += d.toString());
                proc.on('close', () => {
                    pending = false;
                    // 格式: "960, 540"
                    const m = out.trim().match(/(-?\d+),\s*(-?\d+)/);
                    if (m) this._notify(parseInt(m[1], 10), parseInt(m[2], 10));
                });
                proc.on('error', () => { pending = false; });
            } catch (e) {
                pending = false;
            }
        }, pollInterval);

        return true;
    }

    // ==================== 通用 Wayland 回退 ====================

    _startYdotoolTracking(interval) {
        this._method = 'ydotool';
        const pollInterval = Math.max(interval, 80);
        console.log(`[CursorTracker] Using ydotool (${pollInterval}ms)`);

        let pending = false;
        this._interval = setInterval(() => {
            if (pending) return;
            pending = true;

            try {
                const proc = spawn('ydotool', ['getmouselocation'], {
                    stdio: ['ignore', 'pipe', 'ignore']
                });

                let out = '';
                proc.stdout.on('data', (d) => out += d.toString());
                proc.on('close', () => {
                    pending = false;
                    const m = out.match(/x:(-?\d+)\s+y:(-?\d+)/);
                    if (m) this._notify(parseInt(m[1], 10), parseInt(m[2], 10));
                });
                proc.on('error', () => { pending = false; });
            } catch (e) {
                pending = false;
            }
        }, pollInterval);

        return true;
    }

    _startGenericWaylandFallback(interval) {
        if (this._commandExists('ydotool')) {
            this._startYdotoolTracking(interval);
            return;
        }

        console.warn('[CursorTracker] No Wayland cursor method found, falling back to Electron API');
        this._startElectronTracking(interval);
    }
}

module.exports = { CursorTracker };
