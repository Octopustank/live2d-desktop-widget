const { ipcRenderer } = require('electron');

const form = document.getElementById('settings-form');
const modelPathInput = document.getElementById('model-path');
const modelScaleInput = document.getElementById('model-scale');
const windowWidthInput = document.getElementById('window-width');
const windowHeightInput = document.getElementById('window-height');
const windowXInput = document.getElementById('window-x');
const windowYInput = document.getElementById('window-y');
const autoHideCheckbox = document.getElementById('auto-hide');
const hoverOpacityInput = document.getElementById('hover-opacity');
const opacityValueSpan = document.getElementById('opacity-value');
const browseButton = document.getElementById('btn-browse');
const cancelButton = document.getElementById('btn-cancel');

function populate(config) {
    if (!config) return;
    if (config.modelPath) modelPathInput.value = config.modelPath;
    if (config.modelScale) modelScaleInput.value = config.modelScale;
    if (config.windowWidth) windowWidthInput.value = config.windowWidth;
    if (config.windowHeight) windowHeightInput.value = config.windowHeight;
    if (Number.isFinite(config.windowX)) windowXInput.value = config.windowX;
    if (Number.isFinite(config.windowY)) windowYInput.value = config.windowY;
    autoHideCheckbox.checked = config.autoHideOnHover === true;
    if (Number.isFinite(config.hoverOpacity)) {
        const percentage = Math.round(config.hoverOpacity * 100);
        hoverOpacityInput.value = percentage;
        opacityValueSpan.textContent = percentage;
    }
}

function toNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

async function init() {
    const cfg = await ipcRenderer.invoke('get-config');
    populate(cfg);
}

hoverOpacityInput.addEventListener('input', (e) => {
    opacityValueSpan.textContent = e.target.value;
});

browseButton.addEventListener('click', async () => {
    const result = await ipcRenderer.invoke('select-model');
    if (result) {
        modelPathInput.value = result;
    }
});

form.addEventListener('submit', (event) => {
    event.preventDefault();
    const payload = {
        modelPath: modelPathInput.value.trim(),
        modelScale: toNumber(modelScaleInput.value),
        windowWidth: toNumber(windowWidthInput.value),
        windowHeight: toNumber(windowHeightInput.value),
        windowX: toNumber(windowXInput.value),
        windowY: toNumber(windowYInput.value),
        autoHideOnHover: autoHideCheckbox.checked,
        hoverOpacity: toNumber(hoverOpacityInput.value) / 100
    };
    console.log('[Settings] Saving config:', payload);
    ipcRenderer.send('update-config', payload);
});

ipcRenderer.on('config-saved', () => {
    const saveBtn = document.getElementById('btn-save');
    const originalText = saveBtn.textContent;
    saveBtn.textContent = '已保存 ✓';
    saveBtn.style.background = '#2d5016';
    setTimeout(() => {
        saveBtn.textContent = originalText;
        saveBtn.style.background = '';
    }, 1500);
});

cancelButton.addEventListener('click', () => {
    window.close();
});

document.addEventListener('DOMContentLoaded', init);
