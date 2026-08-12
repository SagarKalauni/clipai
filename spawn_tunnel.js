const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const ngrokPath = path.join(dir, 'ngrok.exe');

// Kill old instances cleanly
try {
  require('child_process').execSync('taskkill /F /IM ngrok.exe', { stdio: 'ignore' });
  require('child_process').execSync('taskkill /F /IM cloudflared.exe', { stdio: 'ignore' });
} catch (e) {}

// Spawn ngrok.exe as true detached Windows background process
const ng = spawn(ngrokPath, [
  'http',
  '8000',
  '--host-header=rewrite',
  '--authtoken', '3HmpwzWH23Hy3PpK9Q0Tg9VrQfr_hXTXCjdqo3ki3gJHwis2'
], {
  cwd: dir,
  detached: true,
  stdio: 'ignore',
  windowsHide: true
});

ng.unref();
console.log('Ngrok 24/7 Tunnel spawned successfully with PID:', ng.pid);
