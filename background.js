chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    enabled: true,
    dimMode: null,        // null | 'blur' | 'grey'
    replacedCount: 0,
  });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'GET_SETTINGS') {
    chrome.storage.local.get(['enabled', 'dimMode'], sendResponse);
    return true;
  }
  if (msg.type === 'SET_SETTINGS') {
    chrome.storage.local.set(msg.payload, () => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'INCREMENT_COUNT') {
    chrome.storage.local.get(['replacedCount'], (data) => {
      chrome.storage.local.set({ replacedCount: (data.replacedCount || 0) + msg.count });
      sendResponse({ ok: true });
    });
    return true;
  }
});
