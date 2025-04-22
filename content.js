chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'PAGE_CAPTURE_DATA') {
    window.postMessage({
      type: 'PAGE_CAPTURE_DATA',
      data: request.data
    }, '*');
    sendResponse({ success: true });
    return true;
  }
  return false;
});

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  
  if (event.data.type === 'REQUEST_CAPTURES') {
    chrome.runtime.sendMessage(
      { type: 'REQUEST_CAPTURES' },
      (response) => {
        if (response) {
          window.postMessage(response, '*');
        }
      }
    );
  }

  if (event.data.action === 'startCaptureFromWebsite') {
    chrome.runtime.sendMessage(
      { action: 'startCaptureFromWebsite', url: event.data.url },
      (response) => {
        if (!response) {
          console.error('No response from background script');
          window.postMessage(
            { type: 'CAPTURE_ERROR', error: 'No response from extension' },
            '*'
          );
          return;
        }
        
        if (response.success) {
          window.postMessage(response, '*');
        } else {
          console.error('Capture failed:', response.error);
          window.postMessage(
            { type: 'CAPTURE_ERROR', error: response.error },
            '*'
          );
        }
      }
    );
  }
});