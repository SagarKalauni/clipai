const https = require('https');
const http = require('http');

// Test YouTube oembed
https.get('https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ&format=json', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('oEmbed response:', data.slice(0, 100)));
});
