const fs = require('fs'), path = require('path');
const url = process.argv[2] || 'http://localhost:3000/api/leituras';
let t = 27, u = 55;
console.log('SIMULADOR ativo -> ' + url + ' (dados falsos)');
setInterval(async () => {
  t += (Math.random() - 0.5) * 0.6; u += (Math.random() - 0.5) * 1.5;
  t = Math.min(Math.max(t, 22), 38); u = Math.min(Math.max(u, 30), 80);
  const mq7Alarme = fs.existsSync(path.join(__dirname, 'fumaca.txt'));
  try {
    const response = await fetch(url, { method: 'POST', headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.INGEST_TOKEN || ''}`
    },
      body: JSON.stringify({ temperatura: +t.toFixed(1), umidade: +u.toFixed(1), mq7_alarme: mq7Alarme }) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (e) { console.error('falha ao enviar:', e.message); }
}, 2000);
