// Runs before the page is drawn, so the light theme never flashes dark first. It is a file
// of its own (not inline) so the Content-Security-Policy in index.html can forbid inline scripts.
// Light, Dark, or Auto (nothing saved): follow the phone. The Sketch style is always light.
// Show icons off adds .no-icons.
try {
  const t = localStorage.getItem('find-notes:theme');
  const sketch = localStorage.getItem('find-notes:style') === 'sketch';
  const light = sketch || t === 'light' || (t !== 'dark' && window.matchMedia('(prefers-color-scheme: light)').matches);
  if (light) document.documentElement.dataset.theme = 'light';
  if (sketch) document.documentElement.dataset.style = 'sketch';
  if (localStorage.getItem('find-notes:icons') === 'off') document.documentElement.classList.add('no-icons');
} catch { /* storage blocked: stay dark, icons on */ }
