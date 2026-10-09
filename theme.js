// Runs before the page is drawn, so the light theme never flashes dark first. It is a file
// of its own (not inline) so the Content-Security-Policy in index.html can forbid inline scripts.
try {
  if (localStorage.getItem('find-notes:theme') === 'light') document.documentElement.dataset.theme = 'light';
} catch { /* storage blocked: stay dark */ }
