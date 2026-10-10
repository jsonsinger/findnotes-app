// FindNotes runs only as the installed app: notes live on the device, and a browser tab keeps
// its own separate storage. A browser tab is sent to the install page; the app is sent back.
// Loaded first on both index.html and welcome.html, so the two pages share one check and can't loop.
try {
  const installed = ['standalone', 'fullscreen', 'minimal-ui'].some((m) => matchMedia(`(display-mode: ${m})`).matches)
    || navigator.standalone === true;
  const onWelcome = location.pathname.endsWith('/welcome.html');
  const host = location.hostname;
  const local = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')
    || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  // On your own computer the app opens in the browser so you can work on it;
  // open /welcome.html directly to see the install page.
  if (installed && onWelcome) location.replace('./');
  else if (!installed && !onWelcome && !local) location.replace('welcome.html');
} catch { /* matchMedia missing: leave the page alone */ }
