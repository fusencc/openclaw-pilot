(function () {
  const tokenInput = document.getElementById('token');
  const portInput = document.getElementById('port');
  const saveBtn = document.getElementById('save');
  const statusEl = document.getElementById('status');

  function loadSettings() {
    chrome.storage.local.get(['gatewayToken', 'relayPort'], (data) => {
      if (data.gatewayToken) tokenInput.value = data.gatewayToken;
      if (data.relayPort) portInput.value = data.relayPort;
    });
  }

  function showStatus(text, color) {
    statusEl.textContent = text;
    statusEl.style.color = color || '#10b981';
    statusEl.classList.add('show');
    setTimeout(() => statusEl.classList.remove('show'), 2000);
  }

  function saveSettings() {
    const token = tokenInput.value.trim();
    const portRaw = portInput.value.trim();
    const port = portRaw ? parseInt(portRaw, 10) : 18792;

    if (!token) {
      showStatus('请输入 Token', '#ef4444');
      tokenInput.focus();
      return;
    }

    if (port < 1 || port > 65535 || !Number.isFinite(port)) {
      showStatus('端口范围 1-65535', '#ef4444');
      portInput.focus();
      return;
    }

    chrome.storage.local.set({ gatewayToken: token, relayPort: port }, () => {
      if (chrome.runtime.lastError) {
        showStatus('保存失败: ' + chrome.runtime.lastError.message, '#ef4444');
      } else {
        showStatus('已保存 ✓', '#10b981');
      }
    });
  }

  saveBtn.addEventListener('click', saveSettings);

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      saveSettings();
    }
  });

  loadSettings();
})();
