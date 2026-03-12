// Service worker: relay URL changes + proxy API calls (content scripts can't bypass CORS)

var API_URL = 'https://doineedavisa-api-production.up.railway.app/doineedavisa?stream=true';

// Relay URL changes to content script for SPA navigation
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  if (changeInfo.url && changeInfo.url.includes('google.com/travel/flights')) {
    chrome.tabs.sendMessage(tabId, { type: 'URL_CHANGED', url: changeInfo.url }).catch(function () {});
  }
});

// Long-lived port for SSE streaming from content script
chrome.runtime.onConnect.addListener(function (port) {
  if (port.name !== 'dinav-stream') return;

  var abortController = null;

  port.onMessage.addListener(function (msg) {
    if (msg.type === 'START_STREAM') {
      abortController = new AbortController();
      doStream(msg.payload, abortController.signal, port);
    }
    if (msg.type === 'ABORT') {
      if (abortController) abortController.abort();
    }
  });

  port.onDisconnect.addListener(function () {
    if (abortController) abortController.abort();
  });
});

async function doStream(payload, signal, port) {
  try {
    var response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: signal
    });

    if (!response.ok) {
      port.postMessage({ type: 'SSE_ERROR', data: 'API error: ' + response.status });
      return;
    }

    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';

    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r/g, '');

      var idx = buffer.indexOf('\n\n');
      while (idx !== -1) {
        var block = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 2);

        var eventName = 'message';
        var dataParts = [];
        var lines = block.split('\n');
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (line.indexOf('event:') === 0) {
            eventName = line.slice(6).trim();
          } else if (line.indexOf('data:') === 0) {
            dataParts.push(line.slice(5).trimStart());
          }
        }

        var dataStr = dataParts.join('\n').trim();
        if (dataStr) {
          try {
            port.postMessage({ type: 'SSE_EVENT', event: eventName, data: dataStr });
          } catch (e) {
            // Port disconnected
            return;
          }
        }

        idx = buffer.indexOf('\n\n');
      }
    }

    try {
      port.postMessage({ type: 'SSE_DONE' });
    } catch (e) {}
  } catch (err) {
    if (err.name !== 'AbortError') {
      try {
        port.postMessage({ type: 'SSE_ERROR', data: err.message || 'Connection failed' });
      } catch (e) {}
    }
  }
}
