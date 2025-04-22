document.addEventListener('DOMContentLoaded', () => {
  const loader = document.getElementById('loader');
  const message = document.getElementById('message');

  loader.style.display = 'block';
  message.textContent = 'Capturing page...';

  chrome.runtime.sendMessage(
    { action: 'startCapture' },
    (response) => {
      loader.style.display = 'none';
      
      if (!response) {
        message.textContent = 'Error: No response from extension';
        return;
      }

      if (response.success) {
        message.textContent = 'Page captured successfully!';
        setTimeout(() => window.close(), 1500);
      } else {
        message.textContent = `Error: ${response.error || 'Unknown error'}`;
      }
    }
  );
});