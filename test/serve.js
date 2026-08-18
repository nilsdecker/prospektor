// A static server over _site, so the drive tests the built output rather than
// the templates. Chromium in CI/sandbox has no egress, so the drive stubs the
// two Netlify functions at the route layer instead of running netlify dev.
const http = require('http'), fs = require('fs'), path = require('path');
const TYPES = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript',
  '.woff2':'font/woff2', '.svg':'image/svg+xml', '.png':'image/png',
  '.xml':'application/xml', '.txt':'text/plain' };

function serve(root, port) {
  const server = http.createServer((req, res) => {
    let p = req.url.split('?')[0];
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(root, p);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      const nf = path.join(root, '404.html');
      if (fs.existsSync(nf)) { res.writeHead(404, {'content-type':'text/html'}); return res.end(fs.readFileSync(nf)); }
      res.writeHead(404); return res.end();
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  });
  return new Promise(r => server.listen(port, () => r(server)));
}
module.exports = { serve };
