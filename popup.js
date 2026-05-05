document.addEventListener('DOMContentLoaded', () => {
  const enabledToggle = document.getElementById('enabledToggle');
  const replacedCount = document.getElementById('replacedCount');
  const dimRadios = document.querySelectorAll('input[name="dimMode"]');
  const replaceAllBtn = document.getElementById('replaceAllBtn');

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

  // Replace all ads on the current page
  replaceAllBtn.addEventListener('click', () => {
    replaceAllBtn.textContent = 'Scanning…';
    replaceAllBtn.disabled = true;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'REPLACE_ALL' })
          .catch(() => {})
          .finally(() => {
            replaceAllBtn.textContent = 'Done ✓';
            setTimeout(() => {
              replaceAllBtn.disabled = false;
              replaceAllBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.95"/></svg> Replace all ads on this page`;
            }, 1500);
          });
      }
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
