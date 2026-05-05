document.addEventListener('DOMContentLoaded', () => {
  const enabledToggle = document.getElementById('enabledToggle');
  const replacedCount = document.getElementById('replacedCount');
  const dimRadios = document.querySelectorAll('input[name="dimMode"]');

  // Load settings
  chrome.storage.local.get(['enabled', 'dimMode', 'replacedCount'], (data) => {
    enabledToggle.checked = data.enabled !== false;
    replacedCount.textContent = data.replacedCount || 0;

    const dimVal = data.dimMode || '';
    dimRadios.forEach((r) => {
      if (r.value === dimVal) r.checked = true;
    });
  });

  // Toggle enabled
  enabledToggle.addEventListener('change', () => {
    const enabled = enabledToggle.checked;
    chrome.storage.local.set({ enabled }, () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'SETTINGS_CHANGED',
            payload: { enabled },
          }).catch(() => {});
        }
      });
    });
  });

  // Dim mode radio
  dimRadios.forEach((r) => {
    r.addEventListener('change', () => {
      const dimMode = r.value || null;
      chrome.storage.local.set({ dimMode }, () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, {
              type: 'SETTINGS_CHANGED',
              payload: { dimMode },
            }).catch(() => {});
          }
        });
      });
    });
  });
});
