const { ipcRenderer } = require('electron');

// DOM 元素
const form = document.getElementById('settings-form');
const modelPathInput = document.getElementById('model-path');
const modelScaleInput = document.getElementById('model-scale');
const windowWidthInput = document.getElementById('window-width');
const windowHeightInput = document.getElementById('window-height');
const offsetXInput = document.getElementById('offset-x');
const offsetYInput = document.getElementById('offset-y');
const autoHideCheckbox = document.getElementById('auto-hide');
const hoverOpacityInput = document.getElementById('hover-opacity');
const opacityValueSpan = document.getElementById('opacity-value');
const browseButton = document.getElementById('btn-browse');
const cancelButton = document.getElementById('btn-cancel');
const resetButton = document.getElementById('btn-reset');
const previewWidget = document.getElementById('preview-widget');
const previewBox = document.getElementById('preview-box');
const displaySelect = document.getElementById('display-select');
const hardwareAccelCheckbox = document.getElementById('hardware-accel');

// 显示器信息元素
const infoResolution = document.getElementById('info-resolution');
const infoScale = document.getElementById('info-scale');
const infoFingerprint = document.getElementById('info-fingerprint');

// 锚点按钮
const anchorButtons = document.querySelectorAll('.anchor-btn[data-anchor]');

// 当前状态
let currentAnchor = 'bottom_right';
let currentDisplayInfo = null;
let currentFingerprint = null;
let allDisplays = [];
let currentConfig = null;
let initialHardwareAcceleration = true;

// 锚点名称映射
const anchorNames = {
    'top_left': '左上角',
    'top_right': '右上角',
    'bottom_left': '左下角',
    'bottom_right': '右下角',
    'center': '居中'
};

function populate(config, displayInfo, displays) {
    console.log('[Settings] Populating with config:', config);
    console.log('[Settings] Current display:', displayInfo);
    console.log('[Settings] All displays:', displays);
    
    if (!config) return;
    
    currentConfig = config;
    allDisplays = displays || [];
    
    // 基本设置
    if (config.modelPath) modelPathInput.value = config.modelPath;
    if (config.modelScale) modelScaleInput.value = config.modelScale;
    if (config.windowWidth) windowWidthInput.value = config.windowWidth;
    if (config.windowHeight) windowHeightInput.value = config.windowHeight;
    
    autoHideCheckbox.checked = config.autoHideOnHover === true;
    if (Number.isFinite(config.hoverOpacity)) {
        const percentage = Math.round(config.hoverOpacity * 100);
        hoverOpacityInput.value = percentage;
        opacityValueSpan.textContent = percentage;
    }
    // 硬件加速（默认开启）
    const enabled = config.hardwareAcceleration !== false;
    hardwareAccelCheckbox.checked = enabled;
    initialHardwareAcceleration = enabled;
    
    // 填充显示器选择器
    populateDisplaySelector(displayInfo);
    
    // 显示器信息
    updateDisplayInfo(displayInfo);
    
    // 位置设置（从显示档案获取）
    loadProfileForDisplay(displayInfo?.fingerprint);
    
    // 更新锚点按钮状态
    updateAnchorButtons();
    updatePreview();
}

function populateDisplaySelector(currentDisplay) {
    displaySelect.innerHTML = '';
    
    if (allDisplays.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '无法获取显示器列表';
        displaySelect.appendChild(opt);
        return;
    }
    
    allDisplays.forEach((display, index) => {
        const opt = document.createElement('option');
        opt.value = display.fingerprint;
        const primary = display.isPrimary ? ' (主)' : '';
        // 显示缩放后的有效尺寸（Chromium 限制无法获取真实物理分辨率）
        opt.textContent = `显示器 ${index + 1}${primary}: ${display.logicalWidth}×${display.logicalHeight} (有效)`;
        
        if (currentDisplay && display.fingerprint === currentDisplay.fingerprint) {
            opt.selected = true;
        }
        
        displaySelect.appendChild(opt);
    });
}

function updateDisplayInfo(displayInfo) {
    if (!displayInfo) return;
    
    currentDisplayInfo = displayInfo;
    currentFingerprint = displayInfo.fingerprint;
    
    infoResolution.textContent = `${displayInfo.logicalWidth} × ${displayInfo.logicalHeight}`;
    infoScale.textContent = `${Math.round(displayInfo.scaleFactor * 100)}%`;
    infoFingerprint.textContent = displayInfo.fingerprint;
}

function loadProfileForDisplay(fingerprint) {
    if (!fingerprint || !currentConfig) return;
    
    currentFingerprint = fingerprint;
    
    // 从配置中加载该显示器的位置设置
    if (currentConfig.displayProfiles && currentConfig.displayProfiles[fingerprint]) {
        const profile = currentConfig.displayProfiles[fingerprint];
        currentAnchor = profile.anchor || 'bottom_right';
        offsetXInput.value = Number.isFinite(profile.offsetX) ? profile.offsetX : -20;
        offsetYInput.value = Number.isFinite(profile.offsetY) ? profile.offsetY : -50;
    } else {
        // 使用默认值
        currentAnchor = 'bottom_right';
        offsetXInput.value = -20;
        offsetYInput.value = -50;
    }
    
    updateAnchorButtons();
    updatePreview();
}

function updateAnchorButtons() {
    anchorButtons.forEach(btn => {
        const anchor = btn.dataset.anchor;
        if (anchor === currentAnchor) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

function updatePreview() {
    // 计算预览位置
    const boxRect = previewBox.getBoundingClientRect();
    const widgetWidth = 20;
    const widgetHeight = 30;
    const padding = 5;
    
    // 根据偏移量调整（简化显示）
    const offsetX = Math.min(Math.max(toNumber(offsetXInput.value) || 0, -50), 50);
    const offsetY = Math.min(Math.max(toNumber(offsetYInput.value) || 0, -50), 50);
    const offsetScale = 0.3; // 偏移量的缩放系数
    
    let left, top;
    
    switch (currentAnchor) {
        case 'top_left':
            left = padding - offsetX * offsetScale;
            top = padding - offsetY * offsetScale;
            break;
        case 'top_right':
            left = boxRect.width - widgetWidth - padding + offsetX * offsetScale;
            top = padding - offsetY * offsetScale;
            break;
        case 'bottom_left':
            left = padding - offsetX * offsetScale;
            top = boxRect.height - widgetHeight - padding + offsetY * offsetScale;
            break;
        case 'bottom_right':
            left = boxRect.width - widgetWidth - padding + offsetX * offsetScale;
            top = boxRect.height - widgetHeight - padding + offsetY * offsetScale;
            break;
        case 'center':
            left = (boxRect.width - widgetWidth) / 2 + offsetX * offsetScale;
            top = (boxRect.height - widgetHeight) / 2 + offsetY * offsetScale;
            break;
        default:
            left = boxRect.width - widgetWidth - padding;
            top = boxRect.height - widgetHeight - padding;
    }
    
    // 限制在预览框内
    left = Math.max(0, Math.min(boxRect.width - widgetWidth, left));
    top = Math.max(0, Math.min(boxRect.height - widgetHeight, top));
    
    previewWidget.style.left = left + 'px';
    previewWidget.style.top = top + 'px';
}

function toNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

async function init() {
    const result = await ipcRenderer.invoke('get-config-with-display');
    populate(result.config, result.displayInfo, result.allDisplays);
}

// 显示器选择器变化
displaySelect.addEventListener('change', () => {
    const selectedFingerprint = displaySelect.value;
    const selectedDisplay = allDisplays.find(d => d.fingerprint === selectedFingerprint);
    
    if (selectedDisplay) {
        // 先保存当前显示器的设置到 currentConfig（避免切换时丢失）
        if (currentFingerprint && currentConfig) {
            if (!currentConfig.displayProfiles) {
                currentConfig.displayProfiles = {};
            }
            if (!currentConfig.displayProfiles[currentFingerprint]) {
                currentConfig.displayProfiles[currentFingerprint] = {};
            }
            // 保存当前编辑的设置
            currentConfig.displayProfiles[currentFingerprint].anchor = currentAnchor;
            currentConfig.displayProfiles[currentFingerprint].offsetX = toNumber(offsetXInput.value) || 0;
            currentConfig.displayProfiles[currentFingerprint].offsetY = toNumber(offsetYInput.value) || 0;
            console.log('[Settings] Saved current profile before switch:', currentFingerprint, currentConfig.displayProfiles[currentFingerprint]);
        }
        
        console.log('[Settings] Switched to display:', selectedFingerprint);
        updateDisplayInfo(selectedDisplay);
        loadProfileForDisplay(selectedFingerprint);
    }
});

// 锚点按钮点击
anchorButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const anchor = btn.dataset.anchor;
        if (anchor) {
            currentAnchor = anchor;
            updateAnchorButtons();
            updatePreview();
        }
    });
});

// 偏移量输入变化
offsetXInput.addEventListener('input', updatePreview);
offsetYInput.addEventListener('input', updatePreview);

// 透明度滑块
hoverOpacityInput.addEventListener('input', (e) => {
    opacityValueSpan.textContent = e.target.value;
});

// 选择模型
browseButton.addEventListener('click', async () => {
    const result = await ipcRenderer.invoke('select-model');
    if (result) {
        modelPathInput.value = result;
    }
});

// 重置位置
resetButton.addEventListener('click', () => {
    currentAnchor = 'bottom_right';
    offsetXInput.value = -20;
    offsetYInput.value = -50;
    updateAnchorButtons();
    updatePreview();
});

// 提交表单
form.addEventListener('submit', (event) => {
    event.preventDefault();
    
    const payload = {
        modelPath: modelPathInput.value.trim(),
        modelScale: toNumber(modelScaleInput.value),
        windowWidth: toNumber(windowWidthInput.value),
        windowHeight: toNumber(windowHeightInput.value),
        autoHideOnHover: autoHideCheckbox.checked,
        hoverOpacity: toNumber(hoverOpacityInput.value) / 100,
        hardwareAcceleration: hardwareAccelCheckbox.checked,
        // 位置设置
        displaySettings: {
            fingerprint: currentFingerprint,
            anchor: currentAnchor,
            offsetX: toNumber(offsetXInput.value),
            offsetY: toNumber(offsetYInput.value)
        }
    };
    
    console.log('[Settings] Saving config:', payload);
    ipcRenderer.send('update-config', payload);
});

// 保存成功反馈
ipcRenderer.on('config-saved', () => {
    const saveBtn = document.getElementById('btn-save');
    const originalText = saveBtn.textContent;
    saveBtn.textContent = '已保存 ✓';
    saveBtn.style.background = '#2d5016';
    setTimeout(() => {
        saveBtn.textContent = originalText;
        saveBtn.style.background = '';
    }, 1500);

    // 若硬件加速设置发生变化，提示并提供立即重启
    const currentEnabled = hardwareAccelCheckbox.checked;
    if (currentEnabled !== initialHardwareAcceleration) {
        const shouldRestart = confirm('硬件加速设置已更改，需要重启应用才会生效。是否现在重启？');
        if (shouldRestart) {
            ipcRenderer.send('restart-app');
        } else {
            alert('请稍后手动重启应用以应用新设置。');
        }
        // 更新基准值，避免重复提示
        initialHardwareAcceleration = currentEnabled;
    }
});

// 显示器信息更新（当显示器配置变化时自动刷新）
ipcRenderer.on('display-info-updated', (event, data) => {
    console.log('[Settings] Display info updated:', data);
    
    const { displayInfo, allDisplays: newDisplays } = data;
    
    // 更新显示器列表
    if (newDisplays) {
        allDisplays = newDisplays;
        populateDisplaySelector(displayInfo);
    }
    
    if (displayInfo) {
        currentDisplayInfo = displayInfo;
        currentFingerprint = displayInfo.fingerprint;
        
        // 更新显示器信息面板
        infoResolution.textContent = `${displayInfo.logicalWidth} × ${displayInfo.logicalHeight}`;
        infoScale.textContent = `${Math.round(displayInfo.scaleFactor * 100)}%`;
        infoFingerprint.textContent = displayInfo.fingerprint;
        
        // 刷新预览
        updatePreview();
        
        // 显示提示（高亮显示器选择区域）
        const section = displaySelect.closest('.section');
        if (section) {
            section.style.borderColor = '#4a9eff';
            section.style.borderWidth = '1px';
            section.style.borderStyle = 'solid';
            setTimeout(() => {
                section.style.borderColor = '';
                section.style.borderWidth = '';
                section.style.borderStyle = '';
            }, 2000);
        }
    }
});

// 取消按钮
cancelButton.addEventListener('click', () => {
    window.close();
});

// 初始化
document.addEventListener('DOMContentLoaded', init);
