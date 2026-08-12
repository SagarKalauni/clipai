const localtunnel = require('localtunnel');
const fs = require('fs');
const path = require('path');

(async () => {
  try {
    const tunnel = await localtunnel({ port: 8000, subdomain: 'clipai-shorts-videso' });

    console.log('\n==========================================================');
    console.log('  ClipAI Live Website (Localtunnel Active)');
    console.log('==========================================================\n');
    console.log('LIVE URL: ' + tunnel.url);
    console.log('\nDesktop Shortcut updated!');
    console.log('Keep this window open while using your live website.\n');

    fs.writeFileSync(path.join(__dirname, 'live_url.txt'), tunnel.url);

    const desktopPath = path.join(process.env.USERPROFILE, 'Desktop', 'ClipAI Live Website.url');
    const shortcutContent = `[InternetShortcut]\r\nURL=${tunnel.url}\r\n`;
    fs.writeFileSync(desktopPath, shortcutContent);

    tunnel.on('close', () => {
      console.log('Tunnel closed');
    });
  } catch (err) {
    console.error('Localtunnel Error:', err.message);
  }
})();
