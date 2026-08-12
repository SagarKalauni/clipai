const localtunnel = require('localtunnel');
const fs = require('fs');

(async () => {
  try {
    const tunnel = await localtunnel({ port: 8000, subdomain: 'clipai-shorts-videso' });
    console.log('TUNNEL_URL:' + tunnel.url);
    fs.writeFileSync('live_url.txt', tunnel.url);
    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
