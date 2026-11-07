const http = require('http'), fs = require('fs'), path = require('path');
const { DatabaseSync } = require('node:sqlite'); // embutido no Node 22.13+
const db = new DatabaseSync(path.join(__dirname, 'sensores.db'));
db.exec(`CREATE TABLE IF NOT EXISTS leituras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  criado_em TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  temperatura REAL, umidade REAL, fumaca INTEGER NOT NULL DEFAULT 0)`);
const ins = db.prepare('INSERT INTO leituras (temperatura, umidade, fumaca) VALUES (?,?,?)');
const sel = db.prepare('SELECT criado_em, temperatura, umidade, fumaca FROM leituras ORDER BY id DESC LIMIT 100');
const PORT = process.env.PORT || 3000;

const send = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = req => new Promise((ok, no) => { let b = ''; req.on('data', c => { b += c; if (b.length > 1e4) req.destroy(); }); req.on('end', () => ok(b)); req.on('error', no); });

http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/leituras') {
      const { temperatura, umidade, fumaca } = JSON.parse(await readBody(req));
      const t = temperatura == null ? null : Number(temperatura), u = umidade == null ? null : Number(umidade);
      if ((t !== null && !isFinite(t)) || (u !== null && !isFinite(u))) return send(res, 400, { erro: 'valores invalidos' });
      ins.run(t, u, fumaca ? 1 : 0);
      return send(res, 201, { ok: true });
    }
    if (req.method === 'GET' && req.url.startsWith('/api/leituras')) {
      return send(res, 200, sel.all().reverse().map(r => ({ ...r, fumaca: !!r.fumaca })));
    }
    if (req.method === 'GET') {
      const f = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : path.basename(req.url));
      if (fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); return fs.createReadStream(f).pipe(res); }
    }
    send(res, 404, { erro: 'nao encontrado' });
  } catch (e) { console.error(e); send(res, 500, { erro: 'erro interno' }); }
}).listen(PORT, '0.0.0.0', () => console.log('Dashboard em http://localhost:' + PORT));
