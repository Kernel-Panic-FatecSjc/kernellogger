const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const PORT = Number(process.env.PORT || 3000);
const INGEST_TOKEN = process.env.INGEST_TOKEN || '';
const publicDir = path.join(__dirname, 'public');
const pool = new Pool({
  host: process.env.DB_HOST || 'db',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'monitor',
  user: process.env.DB_USER || 'monitor',
  password: process.env.DB_PASSWORD || 'monitor_pass'
});

pool.on('error', error => {
  console.error('Erro inesperado no pool PostgreSQL:', error.message);
});

const send = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

const normalizeLeitura = (row) => {
  const mq7Alarme = row.mq7_alarme ?? row.fumaca;
  const ativo = mq7Alarme === true || mq7Alarme === 1 || mq7Alarme === 't';

  return {
    ...row,
    criado_em: row.criado_em || (row.data_hora && `${row.data_hora.replace(' ', 'T')}-03:00`),
    mq7_alarme: ativo,
    fumaca: ativo
  };
};

async function lerCorpoJson(req) {
  const partes = [];
  let tamanho = 0;

  for await (const parte of req) {
    tamanho += parte.length;
    if (tamanho > 8192) {
      throw new Error('corpo muito grande');
    }
    partes.push(parte);
  }

  return JSON.parse(Buffer.concat(partes).toString('utf8'));
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/health') {
    try {
      await pool.query('SELECT 1');
      return send(res, 200, { ok: true });
    } catch {
      return send(res, 503, { ok: false, erro: 'banco indisponível' });
    }
  }

  if (url.pathname === '/api/leituras' && req.method === 'POST') {
    if (!INGEST_TOKEN) {
      return send(res, 503, { erro: 'ingestão desativada; configure INGEST_TOKEN' });
    }

    if (req.headers.authorization !== `Bearer ${INGEST_TOKEN}`) {
      return send(res, 401, { erro: 'não autorizado' });
    }

    let leitura;

    try {
      leitura = await lerCorpoJson(req);
    } catch {
      return send(res, 400, { erro: 'JSON inválido ou corpo muito grande' });
    }

    const temperatura = leitura.temperatura == null
      ? null : Number(leitura.temperatura);
    const umidade = leitura.umidade == null
      ? null : Number(leitura.umidade);
    const mq7Alarme = leitura.mq7_alarme ?? leitura.fumaca;

    if (
      (temperatura !== null && (!Number.isFinite(temperatura) || temperatura < 0 || temperatura > 50)) ||
      (umidade !== null && (!Number.isFinite(umidade) || umidade < 0 || umidade > 100)) ||
      ((temperatura === null) !== (umidade === null)) ||
      typeof mq7Alarme !== 'boolean'
    ) {
      return send(res, 400, { erro: 'campos de leitura inválidos' });
    }

    const estado = mq7Alarme
      ? 'perigo'
      : (temperatura === null
        ? 'sem_dados'
        : (temperatura >= 35 || umidade < 20 || umidade > 85
          ? 'atencao' : 'normal'));

    try {
      await pool.query(
        'INSERT INTO leituras (temperatura, umidade, fumaca, estado) VALUES ($1, $2, $3, $4)',
        [temperatura, umidade, mq7Alarme, estado]
      );
      return send(res, 201, { ok: true });
    } catch (error) {
      console.error('Falha ao salvar leitura:', error.message);
      return send(res, 503, { erro: 'banco indisponível' });
    }
  }

  if (url.pathname === '/api/leituras' && req.method === 'GET') {
    try {
      const limite = Math.min(500, Math.max(1, Number(url.searchParams.get('limite')) || 100));
      const { rows } = await pool.query(
        "SELECT id, to_char(data_hora AT TIME ZONE 'America/Sao_Paulo', " +
          "'YYYY-MM-DD HH24:MI:SS') AS data_hora, temperatura, umidade, " +
          'fumaca, estado FROM leituras ORDER BY id DESC LIMIT $1',
        [limite]
      );
      return send(res, 200, rows.map(normalizeLeitura).reverse());
    } catch (error) {
      console.error('Falha ao consultar leituras:', error.message);
      return send(res, 503, { erro: 'banco indisponível' });
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
}).listen(PORT, '0.0.0.0', () => console.log(`Dashboard em http://localhost:${PORT}; banco PostgreSQL: ${process.env.DB_HOST || 'db'}`));
