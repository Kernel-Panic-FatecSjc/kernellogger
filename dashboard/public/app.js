// Painel Kernel Panic — dados da API do monitor (ou simulação quando ela não responde).
const LIMITE_TEMPERATURA = 35;
const UMID_MIN = 20;
const UMID_MAX = 85;
const ARCO = 235.62;           // 270° de um círculo r=50
const CIRC = 314.16;

const $ = (id) => document.getElementById(id);
const fmt = (v, casas = 1) => (v == null || Number.isNaN(Number(v)) ? '--' : Number(v).toFixed(casas));
const hora = (d) => new Date(d).toLocaleTimeString('pt-BR');

const TEXTOS = {
    aguardando: ['Aguardando leituras', 'Conectando ao Raspberry Pi e ao banco de leituras…'],
    aquecendo: ['Aquecendo o sensor', 'O MQ-2 está aquecendo antes de começar a medir. O LED pisca em azul.'],
    normal: ['Ambiente normal', 'Sem fumaça e com temperatura e umidade dentro dos limites. LED verde.'],
    atencao: ['Atenção', 'Temperatura ou umidade fora dos limites definidos. LED amarelo.'],
    perigo: ['Perigo — fumaça detectada', 'O MQ-2 detectou fumaça ou gás. Esta condição tem prioridade sobre as demais. LED vermelho.'],
};
const NOMES_ESTADO = { normal: 'Normal', atencao: 'Atenção', perigo: 'Perigo', aquecendo: 'Aquecendo' };

const st = {
    modo: 'conectando',        // 'real' | 'demo'
    leituras: [],
    eventos: [],
    estado: 'aguardando',
    aquecendo: false,
    janela: 120,
    preview: 'ao-vivo',
    ultimoId: null,
};

function calcularEstado(l) {
    if (!l) return 'aguardando';
    if (l.fumaca) return 'perigo';
    if (l.temperatura != null && l.temperatura >= LIMITE_TEMPERATURA) return 'atencao';
    if (l.umidade != null && (l.umidade < UMID_MIN || l.umidade > UMID_MAX)) return 'atencao';
    return 'normal';
}

// ============================================================ simulação
const demo = {
    t: 26.4, u: 54, fumacaManual: false, inicio: Date.now(), seq: 0,
    proxima(quando, i, total) {
        this.t += (Math.random() - 0.5) * 0.35 + (26.8 - this.t) * 0.04;
        this.u += (Math.random() - 0.5) * 1.1 + (55 - this.u) * 0.04;
        let t = this.t, u = this.u, fumaca = this.fumacaManual;
        if (total) {                       // histórico com alguns episódios
            const f = i / total;
            if (f > 0.42 && f < 0.52) t += 9.5 * Math.sin(((f - 0.42) / 0.1) * Math.PI);
            if (f > 0.72 && f < 0.77) fumaca = true;
            if (f > 0.15 && f < 0.22) u += 30 * Math.sin(((f - 0.15) / 0.07) * Math.PI);
        }
        const l = { id: ++this.seq, criado_em: new Date(quando).toISOString(), temperatura: +t.toFixed(1), umidade: +Math.min(99, Math.max(5, u)).toFixed(1), fumaca };
        l.estado = calcularEstado(l);
        return l;
    },
    historico(n) {
        const agora = Date.now();
        return Array.from({ length: n }, (_, i) => this.proxima(agora - (n - i) * 2000, i, n));
    },
};

function eventosDeTransicoes(leituras) {
    const ev = [];
    let ant = null;
    for (const l of leituras) {
        const e = l.estado || calcularEstado(l);
        if (e !== ant) {
            ev.push({ estado: e, criado_em: l.criado_em, mensagem: { normal: 'Ambiente normal.', atencao: 'Atenção! Verifique o ambiente.', perigo: 'PERIGO! Fumaça detectada.' }[e] });
            ant = e;
        }
    }
    return ev.reverse();
}

// ============================================================ busca
async function getJSON(url, ms = 4000) {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms), cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    return r.json();
}

let ocupado = false;
async function ciclo() {
    if (ocupado) return;
    ocupado = true;
    try { await cicloInterno(); } finally { ocupado = false; }
}

async function cicloInterno() {
    const forcarDemo = new URLSearchParams(location.search).has('demo');
    if (!forcarDemo) {
        try {
            const [leituras, status] = await Promise.all([
                getJSON('/api/leituras?limite=120'),
                getJSON('/api/status').catch(() => null),
            ]);
            if (st.modo !== 'real') { st.modo = 'real'; st.ultimoId = null; }
            st.leituras = leituras.map((l) => ({ ...l, temperatura: l.temperatura == null ? null : Number(l.temperatura), umidade: l.umidade == null ? null : Number(l.umidade) }));
            st.aquecendo = !!status?.aquecendo;
            const ultima = st.leituras.at(-1);
            st.estado = st.aquecendo ? 'aquecendo' : (status?.estado && status.estado !== 'desconhecido' ? status.estado : (ultima?.estado || calcularEstado(ultima)));
            if (!st.eventosEm || Date.now() - st.eventosEm > 6000) {
                st.eventosEm = Date.now();
                getJSON('/api/eventos?limite=30').then((e) => { st.eventos = e; renderTimeline(); }).catch(() => { st.eventos = eventosDeTransicoes(st.leituras); renderTimeline(); });
            }
            render();
            return;
        } catch { /* cai para a simulação */ }
    }
    if (st.modo !== 'demo') {
        st.modo = 'demo';
        st.leituras = demo.historico(120);
        demo.inicio = Date.now();
        st.ultimoId = null;
    } else {
        st.leituras.push(demo.proxima(Date.now()));
        st.leituras = st.leituras.slice(-120);
    }
    st.aquecendo = Date.now() - demo.inicio < 5000;
    const ultima = st.leituras.at(-1);
    st.estado = st.aquecendo ? 'aquecendo' : calcularEstado(ultima);
    st.eventos = eventosDeTransicoes(st.leituras);
    if (st.aquecendo) st.eventos.unshift({ estado: 'aquecendo', criado_em: new Date(demo.inicio).toISOString(), mensagem: 'Aquecendo o MQ-2…' });
    render();
    renderTimeline();
}

// ============================================================ render
let circuito = null;

function render() {
    const ultima = st.leituras.at(-1);
    const estado = st.estado;
    document.body.dataset.estado = estado;

    // conexão
    const pil = $('conexao');
    pil.className = 'pilula ' + (st.modo === 'real' ? 'on' : st.modo === 'demo' ? 'demo' : 'off');
    pil.querySelector('b').textContent = st.modo === 'real' ? 'Conectado ao Pi' : st.modo === 'demo' ? 'Modo demonstração' : 'Sem conexão';
    $('faixaDemo').hidden = st.modo !== 'demo';

    // estado
    const [titulo, desc] = TEXTOS[estado] || TEXTOS.aguardando;
    $('estadoTitulo').textContent = titulo;
    $('estadoDescricao').textContent = desc;
    $('chipAtualizado').querySelector('b').textContent = ultima ? hora(ultima.criado_em) : '—';

    // métricas
    const temp = ultima?.temperatura, umid = ultima?.umidade;
    animarNumero($('temperatura'), temp);
    animarNumero($('umidade'), umid);
    gauge($('gaugeTemp'), temp, 0, 50);
    gauge($('gaugeUmid'), umid, 0, 100);
    sparkline($('sparkTemp'), st.leituras.slice(-40).map((l) => l.temperatura));
    sparkline($('sparkUmid'), st.leituras.slice(-40).map((l) => l.umidade));
    delta($('tempDelta'), st.leituras, 'temperatura', '°C');
    delta($('umidDelta'), st.leituras, 'umidade', '%');

    const fum = !!ultima?.fumaca;
    $('cardFumaca').classList.toggle('detectado', fum);
    $('fumaca').textContent = ultima ? (fum ? 'Detectada' : 'Ar limpo') : '--';
    $('mensagemFumaca').textContent = ultima ? (fum ? 'Gás ou fumaça no ambiente' : 'Nenhuma fumaça detectada') : 'Aguardando leitura';
    const ult = st.leituras.slice(-36);
    $('barrasFumaca').innerHTML = ult.map((l) => `<i class="${l.fumaca ? 'on' : ''}"></i>`).join('');
    const det = st.leituras.filter((l) => l.fumaca).length;
    $('fumacaContagem').textContent = `${det} de ${st.leituras.length} com fumaça`;

    // 3D
    if (circuito && st.preview === 'ao-vivo') circuito.definirEstado(estado, fum);

    desenharGraficos();
    renderTabela();
}

const numerosAtuais = new WeakMap();
function animarNumero(el, alvo) {
    if (alvo == null) { el.textContent = '--'; numerosAtuais.delete(el); return; }
    const de = numerosAtuais.get(el) ?? alvo;
    numerosAtuais.set(el, alvo);
    const t0 = performance.now();
    const passo = (agora) => {
        const k = Math.min(1, (agora - t0) / 600);
        el.textContent = fmt(de + (alvo - de) * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
}

function gauge(el, v, min, max) {
    const f = v == null ? 0 : Math.max(0, Math.min(1, (v - min) / (max - min)));
    el.style.strokeDasharray = `${(f * ARCO).toFixed(2)} ${CIRC}`;
}

function iniciarGauges() {
    $('gaugeTemp').style.strokeDasharray = `0 ${CIRC}`;
    $('gaugeUmid').style.strokeDasharray = `0 ${CIRC}`;
    for (const id of ['limTemp', 'limUmid']) $(id).parentNode.querySelector('.gauge-trilho').style.strokeDasharray = `${ARCO} ${CIRC}`;
    const a = (LIMITE_TEMPERATURA / 50) * ARCO;
    $('limTemp').style.strokeDasharray = `0 ${a} ${ARCO - a} ${CIRC}`;
    const b1 = (UMID_MIN / 100) * ARCO, b2 = (UMID_MAX / 100) * ARCO;
    $('limUmid').style.strokeDasharray = `${b1} ${b2 - b1} ${ARCO - b2} ${CIRC}`;
    for (const id of ['limTemp', 'limUmid']) $(id).style.strokeWidth = 3;
}

function sparkline(svg, vals) {
    const v = vals.filter((x) => x != null);
    if (v.length < 2) { svg.innerHTML = ''; return; }
    const min = Math.min(...v), max = Math.max(...v), amp = max - min || 1;
    const pts = v.map((x, i) => [(i / (v.length - 1)) * 100, 26 - ((x - min) / amp) * 22]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' ');
    svg.innerHTML = `<path class="area" d="${d} L100 28 L0 28 Z"/><path class="linha" d="${d}"/>`;
}

function delta(el, leituras, campo, un) {
    const v = leituras.slice(-16).map((l) => l[campo]).filter((x) => x != null);
    if (v.length < 2) { el.textContent = '—'; el.className = 'delta mono'; return; }
    const d = v.at(-1) - v[0];
    el.textContent = `${d >= 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1)} ${un} · 30 s`;
    el.className = 'delta mono ' + (Math.abs(d) < 0.05 ? '' : d > 0 ? 'sobe' : 'desce');
}

// ============================================================ gráficos
const graficos = [
    { id: 'graficoTemperatura', campo: 'temperatura', cor: '#fb923c', un: '°C', limites: [{ v: LIMITE_TEMPERATURA, txt: 'máx 35 °C' }], resumo: 'resumoTemp' },
    { id: 'graficoUmidade', campo: 'umidade', cor: '#38bdf8', un: '%', limites: [{ v: UMID_MAX, txt: '85 %' }, { v: UMID_MIN, txt: '20 %' }], resumo: 'resumoUmid' },
];

function desenharGraficos() {
    const dados = st.leituras.slice(-st.janela);
    for (const g of graficos) desenharGrafico(g, dados);
}

function desenharGrafico(g, dados) {
    const canvas = $(g.id);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W) return;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const pad = { l: 36, r: 12, t: 12, b: 24 };
    const vals = dados.map((d) => d[g.campo]).filter((v) => v != null);
    if (vals.length < 2) {
        ctx.fillStyle = '#64748b'; ctx.font = '12px Inter, sans-serif'; ctx.fillText('Aguardando dados…', pad.l, H / 2);
        g.geo = null;
        return;
    }
    let min = Math.min(...vals), max = Math.max(...vals);
    for (const l of g.limites) { if (Math.abs(l.v - min) < 12 || Math.abs(l.v - max) < 12) { min = Math.min(min, l.v); max = Math.max(max, l.v); } }
    const folga = (max - min) * 0.15 || 2;
    min = Math.floor(min - folga); max = Math.ceil(max + folga);
    const X = (i) => pad.l + (i / (dados.length - 1)) * (W - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);
    g.geo = { X, Y, dados, pad, W, H };

    // faixas com fumaça
    ctx.fillStyle = 'rgba(239,68,68,.10)';
    dados.forEach((d, i) => { if (d.fumaca) { const w = (W - pad.l - pad.r) / (dados.length - 1); ctx.fillRect(X(i) - w / 2, pad.t, w + 0.5, H - pad.t - pad.b); } });

    // grade
    ctx.font = '10.5px "JetBrains Mono", monospace';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    const passos = 4;
    for (let i = 0; i <= passos; i++) {
        const v = min + ((max - min) * i) / passos;
        const y = Y(v);
        ctx.strokeStyle = 'rgba(148,163,184,.08)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
        ctx.fillStyle = '#64748b'; ctx.fillText(v.toFixed(0), pad.l - 8, y);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let i = 0; i < 4; i++) {
        const idx = Math.round((i / 3) * (dados.length - 1));
        ctx.fillStyle = '#64748b';
        ctx.fillText(new Date(dados[idx].criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), Math.min(W - pad.r - 30, Math.max(pad.l + 30, X(idx))), H - pad.b + 8);
    }

    // limites
    for (const l of g.limites) {
        if (l.v < min || l.v > max) continue;
        const y = Y(l.v);
        ctx.setLineDash([4, 5]); ctx.strokeStyle = 'rgba(239,68,68,.55)';
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(248,113,113,.85)'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
        ctx.fillText(l.txt, W - pad.r - 2, y - 3);
    }

    // curva suave
    const pts = dados.map((d, i) => (d[g.campo] == null ? null : [X(i), Y(d[g.campo])])).filter(Boolean);
    const caminho = () => {
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) {
            const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
            const mx = (x0 + x1) / 2;
            ctx.bezierCurveTo(mx, y0, mx, y1, x1, y1);
        }
    };
    const grad = ctx.createLinearGradient(0, pad.t, 0, H - pad.b);
    grad.addColorStop(0, g.cor + '55'); grad.addColorStop(1, g.cor + '00');
    ctx.beginPath(); caminho(); ctx.lineTo(pts.at(-1)[0], H - pad.b); ctx.lineTo(pts[0][0], H - pad.b); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    ctx.beginPath(); caminho();
    ctx.strokeStyle = g.cor; ctx.lineWidth = 2; ctx.shadowColor = g.cor; ctx.shadowBlur = 10; ctx.stroke(); ctx.shadowBlur = 0;

    const [ux, uy] = pts.at(-1);
    ctx.fillStyle = g.cor; ctx.beginPath(); ctx.arc(ux, uy, 4, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 1.5; ctx.stroke();

    if (g.hover != null && g.hover < dados.length) {
        const d = dados[g.hover];
        if (d[g.campo] != null) {
            const x = X(g.hover), y = Y(d[g.campo]);
            ctx.strokeStyle = 'rgba(226,232,240,.35)'; ctx.setLineDash([3, 3]);
            ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, H - pad.b); ctx.stroke(); ctx.setLineDash([]);
            ctx.fillStyle = '#05080f'; ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill();
            ctx.strokeStyle = g.cor; ctx.lineWidth = 2; ctx.stroke();
        }
    }

    const media = vals.reduce((a, b) => a + b, 0) / vals.length;
    $(g.resumo).textContent = `mín ${Math.min(...vals).toFixed(1)} · méd ${media.toFixed(1)} · máx ${Math.max(...vals).toFixed(1)} ${g.un}`;
}

function iniciarHoverGraficos() {
    for (const g of graficos) {
        const canvas = $(g.id), cursor = canvas.parentNode.querySelector('.cursor');
        canvas.addEventListener('pointermove', (ev) => {
            if (!g.geo) return;
            const r = canvas.getBoundingClientRect();
            const { pad, W, dados, X } = g.geo;
            const f = (ev.clientX - r.left - pad.l) / (W - pad.l - pad.r);
            const i = Math.max(0, Math.min(dados.length - 1, Math.round(f * (dados.length - 1))));
            g.hover = i;
            desenharGrafico(g, dados);
            const d = dados[i];
            cursor.hidden = false;
            cursor.innerHTML = `${hora(d.criado_em)} · <b>${fmt(d[g.campo])} ${g.un}</b>${d.fumaca ? ' · <span class="fumaca-sim">fumaça</span>' : ''}`;
            cursor.style.left = Math.min(W - cursor.offsetWidth / 2, Math.max(cursor.offsetWidth / 2, X(i))) + 'px';
        });
        canvas.addEventListener('pointerleave', () => { g.hover = null; cursor.hidden = true; if (g.geo) desenharGrafico(g, g.geo.dados); });
    }
}

// ============================================================ tabela e timeline
function renderTabela() {
    const linhas = st.leituras.slice(-30).reverse();
    $('totalLeituras').textContent = `${st.leituras.length} leituras carregadas`;
    if (!linhas.length) { $('tabela').innerHTML = '<tr><td colspan="5" class="vazio">Nenhuma leitura recebida</td></tr>'; return; }
    const topo = linhas[0].id ?? linhas[0].criado_em;
    const nova = st.ultimoId != null && st.ultimoId !== topo;
    st.ultimoId = topo;
    $('tabela').innerHTML = linhas.map((l, i) => {
        const e = l.estado || calcularEstado(l);
        return `<tr class="${nova && i === 0 ? 'nova' : ''}">
            <td class="mono">${hora(l.criado_em)}</td>
            <td class="mono">${fmt(l.temperatura)} °C</td>
            <td class="mono">${fmt(l.umidade)} %</td>
            <td>${l.fumaca ? '<span class="fumaca-sim">Detectada</span>' : 'Não'}</td>
            <td><span class="badge ${e}">${NOMES_ESTADO[e] || e}</span></td>
        </tr>`;
    }).join('');
}

function renderTimeline() {
    const ev = st.eventos.slice(0, 20);
    if (!ev.length) { $('timeline').innerHTML = '<li class="vazio">Nenhum evento ainda.</li>'; return; }
    $('timeline').innerHTML = ev.map((e) => {
        const quando = e.criado_em || e.data_hora;
        return `<li data-e="${e.estado}"><span class="t-msg">${e.mensagem || NOMES_ESTADO[e.estado]}</span><span class="t-hora mono">${quando ? new Date(quando).toLocaleString('pt-BR') : ''}</span></li>`;
    }).join('');
}

// ============================================================ 3D
async function iniciar3D() {
    const lista = $('listaComponentes');
    try {
        const { criarCircuito, PECAS } = await import('./circuito3d.js');
        circuito = criarCircuito({
            canvas: $('canvas3d'),
            palco: $('palco'),
            camadaRotulos: $('rotulos3d'),
            tooltip: $('tooltip3d'),
            aoSelecionar: (id) => {
                lista.querySelectorAll('.componente').forEach((b) => b.classList.toggle('ativo', b.dataset.peca === id));
                document.querySelectorAll('.pinos tr[data-peca]').forEach((tr) => tr.classList.toggle('ativo', tr.dataset.peca === id));
            },
        });
        circuito.aoMudarGiro = (v) => $('btnGirar').setAttribute('aria-pressed', String(v));
        lista.innerHTML = Object.entries(PECAS).map(([id, p]) => `<button type="button" class="componente" data-peca="${id}" style="--c:${p.cor}"><i></i><span><b>${p.nome}</b><small>${p.sub}</small></span></button>`).join('');
        lista.addEventListener('click', (ev) => { const b = ev.target.closest('.componente'); if (b) circuito.focar(b.dataset.peca); });
        lista.addEventListener('mouseover', (ev) => { const b = ev.target.closest('.componente'); if (b) circuito.destacar(b.dataset.peca); });
        lista.addEventListener('mouseleave', () => circuito.destacar(null));
        document.querySelectorAll('.pinos tr[data-peca]').forEach((tr) => {
            const id = tr.dataset.peca === 'alimentacao' ? 'protoboard' : tr.dataset.peca;
            tr.addEventListener('mouseenter', () => circuito.destacar(id));
            tr.addEventListener('mouseleave', () => circuito.destacar(null));
            tr.addEventListener('click', () => { $('circuito').scrollIntoView({ behavior: 'smooth', block: 'center' }); circuito.focar(id); });
        });
        $('btnGirar').addEventListener('click', (e) => { circuito.autoGiro = !circuito.autoGiro; e.currentTarget.setAttribute('aria-pressed', String(circuito.autoGiro)); });
        $('btnRotulos').addEventListener('click', (e) => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', String(on)); $('rotulos3d').classList.toggle('oculto', !on); });
        $('btnFluxo').addEventListener('click', (e) => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', String(on)); circuito.fluxo = on; });
        $('btnResetar').addEventListener('click', () => circuito.resetar());
        circuito.definirEstado(st.estado, !!st.leituras.at(-1)?.fumaca);
        setTimeout(() => $('carregando3d').classList.add('feito'), 200);
    } catch (erro) {
        console.error(erro);
        $('carregando3d').innerHTML = 'Não foi possível iniciar o WebGL neste navegador.';
    }
}

// ============================================================ controles
function iniciarControles() {
    $('previewEstado').addEventListener('click', (ev) => {
        const b = ev.target.closest('button'); if (!b) return;
        st.preview = b.dataset.estado;
        $('previewEstado').querySelectorAll('button').forEach((x) => x.classList.toggle('ativo', x === b));
        if (!circuito) return;
        if (st.preview === 'ao-vivo') circuito.definirEstado(st.estado, !!st.leituras.at(-1)?.fumaca);
        else circuito.definirEstado(st.preview, st.preview === 'perigo');
    });
    $('janela').addEventListener('click', (ev) => {
        const b = ev.target.closest('button'); if (!b) return;
        st.janela = Number(b.dataset.n);
        $('janela').querySelectorAll('button').forEach((x) => x.classList.toggle('ativo', x === b));
        desenharGraficos();
    });
    $('btnFumacaDemo').addEventListener('click', (e) => {
        demo.fumacaManual = !demo.fumacaManual;
        e.currentTarget.classList.toggle('ativo', demo.fumacaManual);
        e.currentTarget.textContent = demo.fumacaManual ? 'Parar fumaça' : 'Simular fumaça';
        if (st.modo === 'demo') ciclo();
    });
    let rz;
    window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(desenharGraficos, 80); });
    const tick = () => { $('relogio').textContent = new Date().toLocaleTimeString('pt-BR'); };
    tick(); setInterval(tick, 1000);
}

iniciarGauges();
iniciarControles();
iniciarHoverGraficos();
iniciar3D();
ciclo();
setInterval(ciclo, 2000);
