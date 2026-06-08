// serve.js
// Tiny local static file server — just for previewing the dashboard webpage
// on your own computer. Free hosting (GitHub Pages/Netlify) will serve the
// same files for everyone else once we publish.
//
// Usage: node serve.js [port]

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2]) || 8080;
const ROOT = __dirname;

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
};

http.createServer((req, res) => {
  const reqPath = decodeURIComponent(req.url.split('?')[0]);
  const filePath = path.join(ROOT, reqPath === '/' ? 'index.html' : reqPath);

  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Serving ${ROOT} at http://localhost:${PORT}`));
