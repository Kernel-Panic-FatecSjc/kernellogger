const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const BACKEND_URL = (process.env.BACKEND_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const publicDir = path.join(__dirname, 'public');

const send = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

const normalizeLeitura = (row) => ({
  ...row,
  criado_em: row.criado_em || (row.data_hora && `${row.data_hora.replace(' ', 'T')}-03:00`),
  fumaca: row.fumaca === true || row.fumaca === 1 || row.fumaca === 't'
});

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/health') {
    try {
      const response = await fetch(`${BACKEND_URL}/health`, { signal: AbortSignal.timeout(3000) });
      return send(res, response.ok ? 200 : 502, { ok: response.ok });
    } catch {
      return send(res, 502, { ok: false, erro: 'backend indisponível' });
    }
  }

  if (url.pathname === '/api/leituras' && req.method === 'GET') {
    try {
      const limite = Math.min(500, Math.max(1, Number(url.searchParams.get('limite')) || 100));
      const response = await fetch(`${BACKEND_URL}/leituras?limite=${limite}`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) return send(res, 502, { erro: 'falha ao consultar a API do monitor' });
      const rows = await response.json();
      return send(res, 200, rows.map(normalizeLeitura).reverse());
    } catch (error) {
      console.error('Falha ao consultar backend:', error.message);
      return send(res, 502, { erro: 'backend indisponível' });
    }
  }

  if (req.method === 'GET') {
    const requested = url.pathname === '/' ? 'index.html' : path.basename(url.pathname);
    const file = path.join(publicDir, requested);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      const contentType = file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8';
      res.writeHead(200, { 'Content-Type': contentType });
      return fs.createReadStream(file).pipe(res);
    }
  }

  send(res, 404, { erro: 'não encontrado' });
}).listen(PORT, '0.0.0.0', () => console.log(`Dashboard em http://localhost:${PORT}; API: ${BACKEND_URL}`));
