# Live2D Desktop Widget

Live2D 桌面摆件（Linux）

------

## 简介 / Introduction

**Live2D Desktop Widget** 是一个面向 **Linux 桌面环境** 的轻量级、可交互 Live2D 桌面摆件应用，支持 **Live2D Cubism 2.x（V2）** 本地模型渲染，适合长期常驻桌面显示。

本项目 **专注于 Live2D 本身**，不引入 AI 生成、自动行为或与模型无关的功能。
 所有设计均以 **不干扰用户日常使用** 为目标，例如通过点击穿透与半透明过渡，确保桌面操作的连续性与“纯粹”的使用体验。

**Live2D Desktop Widget** is a lightweight and interactive Live2D desktop widget designed for **Linux desktop environments**.
 It supports **local rendering of Live2D Cubism 2.x (V2) models** and is intended to run persistently on the desktop.

This project is **focused solely on Live2D itself**.
 It does **not introduce AI-based features, automatic behaviors, or unrelated functionality**.
 All design decisions aim to **preserve an unobtrusive and distraction-free desktop experience**, such as using click-through mode with smooth transparency transitions to avoid interfering with normal user interaction.

> 只是Live2D Just for Live2D.

------

## 功能特性 / Features

### 显示与交互 / Rendering & Interaction

- 支持本地 Live2D Cubism 2.x（V2）模型渲染
  Support local Live2D Cubism 2.x (V2) model rendering
- 全屏幕鼠标位置追踪（眼睛 / 头部跟随）
  Full-screen mouse tracking (eyes / head follow cursor)
- 模型显示区域点击交互
  Click interaction on model area
- 透明背景、无边框窗口
  Transparent background and frameless window
- 窗口置顶显示
  Always-on-top window support

------

### 桌面集成 / Desktop Integration

- 系统托盘集成
  System tray integration
- 点击穿透模式（不影响桌面操作）
  Click-through mode (mouse events pass through)
- 穿透模式下鼠标移入自动变透明
  Auto transparency when mouse enters in click-through mode

------

### 配置与体验 / Configuration & UX

- 可视化设置窗口
  Visual settings window
- 支持模型选择、缩放、窗口尺寸、透明度配置
  Model selection, scaling, window size and opacity control
- 配置持久化（重启后自动恢复）
  Persistent configuration across restarts
- 针对 Gnome 42 优化缩放适配
  Optimized scaling for Gnome 42

------

## 技术栈 / Tech Stack

- **Electron** — 跨平台桌面应用框架
  Cross-platform desktop application framework
- **Live2D Cubism SDK 2.x** — Live2D V2 模型渲染
  Live2D Cubism 2.x model rendering
- **WebGL** — 硬件加速渲染
  Hardware-accelerated rendering via WebGL

------

## 安装 / Installation

```bash
# 安装依赖 / Install dependencies
npm install

# 启动应用 / Start application
npm start
```

------

## 使用方法 / Usage

1. 启动应用后，屏幕右下角会显示一个透明窗口
   After launch, a transparent window appears at the bottom-right of the screen
2. 右键点击系统托盘图标，选择「设置」
   Right-click the system tray icon and select “Settings”
3. 在设置窗口中可进行以下配置：
   Available options in the settings window:
   - **模型选择**（`model.json`）
     Model selection (`model.json`)
   - **模型缩放**（0.5–2.0）
     Model scaling (0.5–2.0)
   - **窗口尺寸**
     Window width and height
   - **窗口位置**（留空自动定位）
     Window position (auto if empty)
   - **自动变透明**（点击穿透模式）
     Auto transparency in click-through mode
   - **透明度控制**（0–100%）
     Opacity control (0–100%)
4. 点击「保存」应用设置
   Click “Save” to apply settings
5. 模型加载完成后会自动追踪鼠标位置
   Model automatically tracks mouse movement
6. 点击模型可触发互动效果
   Click the model to trigger interaction effects

------

## 系统托盘菜单 / System Tray Menu

- **显示 / 隐藏** — 切换窗口显示状态
  Show / Hide window
- **点击穿透** — 启用或关闭鼠标穿透
  Toggle click-through mode
- **重新加载** — 重载渲染页面
  Reload rendering page
- **开发者工具** — 打开 DevTools
  Open developer tools
- **设置** — 打开设置窗口
  Open settings window
- **退出** — 关闭应用
  Exit application

------

## 模型格式要求 / Model Format

支持 **Live2D Cubism 2.x** 模型，目录结构示例：

Supports **Live2D Cubism 2.x** models with the following directory structure:

```
model/
├── model.json
├── model.moc
├── model.physics.json   # optional
└── textures/
    └── texture_00.png
```

------

## 项目结构 / Project Structure

```
live2d-desktop/
├── main.js                 # Electron main process
├── index.html              # Main window
├── settings.html           # Settings window
├── package.json
├── scripts/
│   ├── app.js              # Application logic
│   ├── live2d-renderer.js  # Live2D renderer
│   └── settings.js         # Settings logic
├── styles/
│   └── main.css
├── lib/
│   └── live2d.min.js       # Live2D SDK
└── assets/
    └── icon.png
```

------

## 配置文件 / Configuration

配置文件默认路径：
Configuration file location:

```
~/.config/live2d-desktop-gnome/config.json
```

------

## 适配说明 / Compatibility

- 测试环境：Ubuntu 22.04.5 LTS + Gnome 42.9
- Tested on Ubuntu 22.04.5 LTS with Gnome 42.9

------

## 开发与调试 / Development & Debugging

```bash
# 启动开发模式 / Start development mode
npm start

# 打包 Linux AppImage / Build Linux AppImage
npm run dist
```

> 主窗口控制台：系统托盘 → 开发者工具
> Main window console: System tray → Developer Tools

------

## 致谢与说明 / Acknowledgements & Notice

本项目基于以下开源项目进行实现与修改：

- **live2d-kanban-desktop**
  https://github.com/JimHans/live2d-kanban-desktop 

在原项目基础上，本项目针对 Linux 桌面环境与使用体验进行了调整与优化，
包括窗口交互行为、点击穿透与透明度过渡等设计。

部分代码修改与重构过程中使用了 AI 辅助工具。

This project is based on and derived from the following open-source project:

- **live2d-kanban-desktop** 
  https://github.com/JimHans/live2d-kanban-desktop

On top of the original implementation, this project introduces adjustments
and optimizations for Linux desktop environments, focusing on window behavior,
click-through interaction, and transparency transitions.

AI-assisted tools were used during parts of the refactoring and modification process.

---

## 许可证 / License

License: GNU General Public License v3.0

