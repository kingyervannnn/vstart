// Service worker: responds to history queries from the content script

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'GET_HISTORY') {
    const q = String(msg.query || '').slice(0, 256);
    const max = Math.min(parseInt(msg.max, 10) || 100, 300);
    try {
      chrome.history.search({ text: q, maxResults: max, startTime: 0 }, (items) => {
        sendResponse({ ok: true, items: Array.isArray(items) ? items : [] });
      });
      return true; // keep the message channel open
    } catch (e) {
      sendResponse({ ok: false, error: String(e || 'error') });
    }
  }
});

