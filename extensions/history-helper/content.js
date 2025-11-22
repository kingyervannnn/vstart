// Content script injected into the startpage. Bridges extension history to the page.

function classifyWorkspace(url) {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./,'')
    const rules = {
      dev: ['github.com','gitlab.com','npmjs.com','stackOverflow.com','stackoverflow.com','codeberg.org'],
      research: ['wikipedia.org','arxiv.org','openalex.org','scholar.google.com'],
      media: ['youtube.com','youtu.be','vimeo.com','soundcloud.com'],
      social: ['twitter.com','x.com','reddit.com'],
      shopping: ['amazon.com','ebay.com'],
      mail: ['gmail.com','proton.me','outlook.com']
    }
    for (const [slug, hosts] of Object.entries(rules)) {
      if (hosts.some(d => h === d || h.endsWith(`.${d}`))) return slug
    }
  } catch {}
  return null
}

function requestHistory(query) {
  try {
    chrome.runtime.sendMessage({ type: 'GET_HISTORY', query: String(query || ''), max: 120 }, (resp) => {
      const raw = (resp && resp.items) ? resp.items : [];
      const items = raw.map(it => ({
        title: it.title || it.url,
        url: it.url,
        lastVisitTime: it.lastVisitTime || 0,
        visitCount: it.visitCount || 0,
        workspace: classifyWorkspace(it.url)
      }))
      // Dispatch to page for the UI to consume
      window.dispatchEvent(new CustomEvent('ext-history-suggestions', { detail: { items } }));
    });
  } catch (e) {
    // ignore
  }
}

// Listen for page requests
window.addEventListener('request-history-suggestions', (e) => {
  const q = (e && e.detail && e.detail.query) ? e.detail.query : '';
  requestHistory(q);
});

// Signal presence
try { window.dispatchEvent(new CustomEvent('ext-history-ready')); } catch {}
