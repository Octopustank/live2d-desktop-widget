/**
 * Live2D Cursor Tracker - GNOME Shell Extension
 * 
 * 在 GNOME Wayland 环境下，应用无法直接获取全局光标位置（Wayland 安全模型限制）。
 * 此扩展在 GNOME Shell 进程内注册一个 DBus 接口，暴露 global.get_pointer() 的结果，
 * 使外部应用可以通过 DBus 调用获取全局光标坐标。
 * 
 * DBus 接口：
 *   目标: org.gnome.Shell
 *   路径: /com/live2d/CursorTracker
 *   接口: com.live2d.CursorTracker
 *   方法: GetCursorPosition() → (x: int32, y: int32)
 * 
 * 兼容: GNOME Shell 45 - 49+ (ESM 格式)
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const DBUS_INTERFACE_XML = `<node>
  <interface name="com.live2d.CursorTracker">
    <method name="GetCursorPosition">
      <arg type="i" direction="out" name="x"/>
      <arg type="i" direction="out" name="y"/>
    </method>
    <method name="GetVersion">
      <arg type="i" direction="out" name="version"/>
    </method>
  </interface>
</node>`;

export default class CursorTrackerExtension {
    enable() {
        try {
            const nodeInfo = Gio.DBusNodeInfo.new_for_xml(DBUS_INTERFACE_XML);
            this._dbusId = Gio.DBus.session.register_object(
                '/com/live2d/CursorTracker',
                nodeInfo.interfaces[0],
                this._onMethodCall.bind(this),
                null,
                null
            );
            console.log('[Live2D CursorTracker] Extension enabled, DBus interface registered');
        } catch (e) {
            console.error('[Live2D CursorTracker] Failed to register DBus interface:', e.message);
        }
    }

    _onMethodCall(connection, sender, objectPath, interfaceName, methodName, parameters, invocation) {
        try {
            if (methodName === 'GetCursorPosition') {
                const [x, y] = global.get_pointer();
                invocation.return_value(new GLib.Variant('(ii)', [x, y]));
            } else if (methodName === 'GetVersion') {
                invocation.return_value(new GLib.Variant('(i)', [1]));
            }
        } catch (e) {
            invocation.return_error_literal(
                Gio.DBusError,
                Gio.DBusError.FAILED,
                e.message
            );
        }
    }

    disable() {
        if (this._dbusId) {
            try {
                Gio.DBus.session.unregister_object(this._dbusId);
            } catch (e) {
                // ignore
            }
            this._dbusId = null;
            console.log('[Live2D CursorTracker] Extension disabled, DBus interface unregistered');
        }
    }
}
