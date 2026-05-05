document.addEventListener('DOMContentLoaded', () => {
  const enabledToggle   = document.getElementById('enabledToggle');
  const hiddenCountEl   = document.getElementById('hiddenCount');
  const scanNowBtn      = document.getElementById('scanNow');
  const pickerBtn       = document.getElementById('pickerBtn');
  const customRulesRow  = document.getElementById('customRulesRow');
  const customRulesLabel= document.getElementById('customRulesLabel');
  const clearRulesBtn   = document.getElementById('clearRules');

  let pickerPending = false;

  // ── Load state ────────────────────────────────────────────────────────────────
  chrome.storage.local.get(['enabled', 'hiddenCount', 'customRules'], (data) => {
    enabledToggle.checked = data.enabled !== false;
    hiddenCountEl.textContent = data.hiddenCount || 0;
    refreshCustomRulesRow(data.customRules || []);
  });

  // ── Enable toggle ─────────────────────────────────────────────────────────────
  enabledToggle.addEventListener('change', () => {
    const enabled = enabledToggle.checked;
    chrome.storage.local.set({ enabled });
    sendToTab({ type: 'SETTINGS_CHANGED', payload: { enabled } });
  });

  // ── Scan now ──────────────────────────────────────────────────────────────────
  scanNowBtn.addEventListener('click', () => {
    scanNowBtn.textContent = 'Scanning…';
    scanNowBtn.disabled = true;
    sendToTab({ type: 'SCAN_NOW' });
    setTimeout(() => {
      chrome.storage.local.get(['hiddenCount'], (d) => {
        hiddenCountEl.textContent = d.hiddenCount || 0;
        scanNowBtn.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.95"/></svg> Scan page now`;
        scanNowBtn.disabled = false;
      });
    }, 900);
  });

  // ── Element picker ────────────────────────────────────────────────────────────
  pickerBtn.addEventListener('click', () => {
    if (pickerPending) {
      pickerPending = false;
      pickerBtn.classList.remove('active');
      pickerBtn.innerHTML = pickerBtnHTML();
      sendToTab({ type: 'PICKER_CANCEL' });
      return;
    }
    pickerPending = true;
    pickerBtn.classList.add('active');
    pickerBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
      Click an element… (Esc to cancel)`;
    sendToTab({ type: 'PICKER_START' });
    // Close popup so user can interact with the page
    window.close();
  });

  // ── Clear custom rules ────────────────────────────────────────────────────────
  clearRulesBtn.addEventListener('click', () => {
    chrome.storage.local.set({ customRules: [] });
    sendToTab({ type: 'CLEAR_CUSTOM_RULES' });
    refreshCustomRulesRow([]);
  });

  // ── Listen for picker completion ──────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'PICKER_DONE') {
      pickerPending = false;
      chrome.storage.local.get(['customRules'], (d) => {
        refreshCustomRulesRow(d.customRules || []);
      });
    }
  });

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function sendToTab(msg) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, msg).catch(() => {});
    });
  }

  function refreshCustomRulesRow(rules) {
    if (rules.length === 0) {
      customRulesRow.style.display = 'none';
    } else {
      customRulesRow.style.display = 'flex';
      customRulesLabel.textContent =
        `${rules.length} custom rule${rules.length === 1 ? '' : 's'}`;
    }
  }

  function pickerBtnHTML() {
    return `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/></svg> Pick element to hide`;
  }
});
