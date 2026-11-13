// Maquete 3D do circuito Kernel Panic: Raspberry Pi 4 + protoboard + DHT11 + MQ-2 + LED RGB.
// Unidade: 1 = 10 mm. Pinagem BCM igual a monitor-fumaca/monitor.c.
import * as THREE from './three.module.min.js';
import { OrbitControls } from './OrbitControls.js';
import { RoomEnvironment } from './RoomEnvironment.js';

const PASSO = 0.254;               // 2,54 mm entre furos
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

const BRANCO_LED = new THREE.Color('#e2e8f0');
const CORES_ESTADO = {
    aguardando: [0, 0, 0],
    aquecendo: [0, 0, 1],
    normal: [0, 1, 0],
    atencao: [1, 0.8, 0],
    perigo: [1, 0, 0],
};

export const PECAS = {
    pi:          { nome: 'Raspberry Pi 4', sub: 'Controlador', cor: '#22c55e', desc: 'Roda o monitor em C com wiringPi: três threads, banco PostgreSQL e API HTTP na porta 8080.' },
    header:      { nome: 'Header GPIO', sub: '40 pinos · BCM', cor: '#a3e635', desc: 'Pinos usados: 1 (3V3), 2 (5V), 6 e 9 (GND), 7 (GPIO4), 11 (GPIO17), 13 (GPIO27), 15 (GPIO22), 16 (GPIO23).' },
    dht11:       { nome: 'DHT11', sub: 'GPIO 4 · pino 7', cor: '#38bdf8', desc: 'Temperatura e umidade a cada 2 s. Pulso de 18 ms acorda o sensor, que responde com 40 bits + checksum. Pull-up de 10 kΩ no dado.' },
    mq2:         { nome: 'MQ-2', sub: 'GPIO 17 · pino 11', cor: '#f59e0b', desc: 'Detecta fumaça e gases pela saída digital DO (ativa em LOW). Aquece antes de medir; alimentado em 5 V.' },
    led:         { nome: 'LED RGB', sub: 'GPIO 27 · 22 · 23', cor: '#ef4444', desc: 'Cátodo comum. Verde = normal, amarelo = atenção, vermelho = perigo, azul piscando = aquecendo.' },
    resistores:  { nome: 'Resistores', sub: '3 × 220 Ω · 1 × 10 kΩ', cor: '#d6c7a1', desc: '220 Ω limitam a corrente de cada cor do LED; 10 kΩ é o pull-up da linha de dados do DHT11.' },
    protoboard:  { nome: 'Protoboard', sub: '400 furos', cor: '#e2e8f0', desc: 'Trilhos laterais distribuem 3V3 (+) e GND (−) vindos do Raspberry Pi.' },
};

// ---------------------------------------------------------------- texturas
function canvasTex(w, h, desenhar, opts = {}) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    desenhar(ctx, w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = opts.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    t.anisotropy = 8;
    if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...opts.repeat); }
    return t;
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function texturaMesa(W, D) {
    const px = 64;
    return canvasTex(W * px, D * px, (ctx, w, h) => {
        const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.6);
        g.addColorStop(0, '#152033'); g.addColorStop(1, '#0b111c');
        ctx.fillStyle = g;
        roundRect(ctx, 0, 0, w, h, 40); ctx.fill();
        for (let i = 0; i <= W; i++) {
            ctx.strokeStyle = i % 5 === 0 ? 'rgba(56,189,248,.16)' : 'rgba(56,189,248,.06)';
            ctx.lineWidth = i % 5 === 0 ? 2 : 1;
            ctx.beginPath(); ctx.moveTo(i * px, 0); ctx.lineTo(i * px, h); ctx.stroke();
        }
        for (let j = 0; j <= D; j++) {
            ctx.strokeStyle = j % 5 === 0 ? 'rgba(56,189,248,.16)' : 'rgba(56,189,248,.06)';
            ctx.lineWidth = j % 5 === 0 ? 2 : 1;
            ctx.beginPath(); ctx.moveTo(0, j * px); ctx.lineTo(w, j * px); ctx.stroke();
        }
        ctx.fillStyle = 'rgba(148,163,184,.35)';
        ctx.font = '600 22px "Space Grotesk", sans-serif';
        ctx.fillText('KERNEL PANIC · MONITOR AMBIENTAL', 40, h - 36);
        ctx.font = '18px "JetBrains Mono", monospace';
        ctx.fillStyle = 'rgba(148,163,184,.25)';
        ctx.textAlign = 'right';
        ctx.fillText('ESCALA 1:1 · GRADE 10 mm', w - 40, h - 36);
    });
}

function texturaPCBPi() {
    return canvasTex(1700, 1120, (ctx, w, h) => {
        ctx.fillStyle = '#1f7a45'; ctx.fillRect(0, 0, w, h);
        // trilhas
        ctx.strokeStyle = 'rgba(120, 220, 150, .18)'; ctx.lineWidth = 3;
        let seed = 7;
        const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        for (let i = 0; i < 70; i++) {
            let x = rnd() * w, y = rnd() * h;
            ctx.beginPath(); ctx.moveTo(x, y);
            for (let k = 0; k < 4; k++) {
                if (rnd() > 0.5) x += (rnd() - 0.5) * 380; else y += (rnd() - 0.5) * 300;
                ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
        // vias
        ctx.fillStyle = 'rgba(214, 190, 120, .5)';
        for (let i = 0; i < 160; i++) { ctx.beginPath(); ctx.arc(rnd() * w, rnd() * h, 4, 0, 7); ctx.fill(); }
        // furos de fixação (anel dourado)
        for (const [x, y] of [[70, 70], [1230, 70], [70, 1050], [1230, 1050]]) {
            ctx.fillStyle = '#d4b45c'; ctx.beginPath(); ctx.arc(x, y, 54, 0, 7); ctx.fill();
            ctx.fillStyle = '#0b111c'; ctx.beginPath(); ctx.arc(x, y, 30, 0, 7); ctx.fill();
        }
        // ilhas do header
        ctx.fillStyle = '#d4b45c';
        for (let i = 0; i < 20; i++) for (let r = 0; r < 2; r++) {
            ctx.beginPath(); ctx.arc(174 + i * 50.8, 46 + r * 50.8, 15, 0, 7); ctx.fill();
        }
        // serigrafia
        ctx.fillStyle = 'rgba(245, 248, 240, .92)';
        ctx.font = '700 62px "Space Grotesk", Arial, sans-serif';
        ctx.fillText('Raspberry Pi 4 Model B', 240, 300);
        ctx.font = '26px "JetBrains Mono", monospace';
        ctx.fillText('© Raspberry Pi 2019 · Kernel Panic', 242, 345);
        ctx.font = '22px "JetBrains Mono", monospace';
        ctx.fillText('GPIO', 160, 150);
        ctx.fillText('J8', 1210, 150);
        ctx.strokeStyle = 'rgba(245,248,240,.75)'; ctx.lineWidth = 3;
        ctx.strokeRect(150, 22, 1026, 100);
    });
}

function texturaProtoboard(W, D, colunas, xFuro, zFuro, zTrilhos) {
    const px = 140; // pixels por unidade
    return canvasTex(Math.round(W * px), Math.round(D * px), (ctx, w, h) => {
        ctx.fillStyle = '#f4f2ec'; ctx.fillRect(0, 0, w, h);
        const X = (x) => (x + W / 2) * px, Z = (z) => (z + D / 2) * px;
        // canaleta central
        ctx.fillStyle = '#ddd9cf'; ctx.fillRect(0, Z(-0.16), w, 0.32 * px);
        // linhas dos trilhos
        const linhas = [[zTrilhos.negLonge - 0.17, '#2563eb'], [zTrilhos.posLonge + 0.17, '#dc2626'], [zTrilhos.posPerto - 0.17, '#dc2626'], [zTrilhos.negPerto + 0.17, '#2563eb']];
        ctx.lineWidth = 3;
        for (const [z, cor] of linhas) { ctx.strokeStyle = cor; ctx.beginPath(); ctx.moveTo(X(-W / 2 + 0.3), Z(z)); ctx.lineTo(X(W / 2 - 0.3), Z(z)); ctx.stroke(); }
        ctx.font = '600 22px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#dc2626'; ctx.fillText('+', X(-W / 2 + 0.18), Z(zTrilhos.posLonge)); ctx.fillText('+', X(-W / 2 + 0.18), Z(zTrilhos.posPerto));
        ctx.fillStyle = '#2563eb'; ctx.fillText('−', X(-W / 2 + 0.18), Z(zTrilhos.negLonge)); ctx.fillText('−', X(-W / 2 + 0.18), Z(zTrilhos.negPerto));
        const furo = (x, z) => {
            const s = 0.105 * px;
            ctx.fillStyle = '#3a3a38'; ctx.fillRect(X(x) - s / 2, Z(z) - s / 2, s, s);
            ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(X(x) - s / 2 + 2, Z(z) - s / 2 + 2, s - 4, s - 4);
        };
        for (let c = 0; c < colunas; c++) {
            for (let r = 0; r < 10; r++) furo(xFuro(c), zFuro(r));
            if (c % 6 !== 5) for (const z of Object.values(zTrilhos)) furo(xFuro(c), z);
        }
        ctx.fillStyle = '#8b8a85'; ctx.font = '16px Arial';
        for (let c = 0; c < colunas; c += 5) { ctx.fillText(String(c + 1), X(xFuro(c)), Z(zFuro(0)) - 22); ctx.fillText(String(c + 1), X(xFuro(c)), Z(zFuro(9)) + 22); }
        'abcdefghij'.split('').forEach((l, r) => { ctx.fillText(l, X(xFuro(0)) - 22, Z(zFuro(r))); ctx.fillText(l, X(xFuro(colunas - 1)) + 22, Z(zFuro(r))); });
    });
}

function texturaGradeDHT() {
    return canvasTex(240, 310, (ctx, w, h) => {
        ctx.fillStyle = '#4a9fe0'; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#123a5e';
        for (let r = 0; r < 7; r++) for (let c = 0; c < 4; c++) {
            const x = 30 + c * 48, y = 26 + r * 36;
            roundRect(ctx, x + (r % 2 ? 12 : 0), y, 28, 20, 4); ctx.fill();
        }
        ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(0, 0, w, 10);
    });
}

function texturaMalha() {
    return canvasTex(256, 128, (ctx, w, h) => {
        ctx.fillStyle = '#c9ced6'; ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#5c636e'; ctx.lineWidth = 2;
        for (let i = 0; i < w; i += 6) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke(); }
        for (let j = 0; j < h; j += 6) { ctx.beginPath(); ctx.moveTo(0, j); ctx.lineTo(w, j); ctx.stroke(); }
    }, { repeat: [3, 1] });
}

function texturaBrilho() {
    return canvasTex(128, 128, (ctx, w) => {
        const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
        g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.2, 'rgba(255,255,255,.55)');
        g.addColorStop(0.5, 'rgba(255,255,255,.12)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
    });
}

function texturaFumaca() {
    return canvasTex(128, 128, (ctx, w) => {
        const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
        g.addColorStop(0, 'rgba(210,214,222,.55)'); g.addColorStop(0.6, 'rgba(180,186,196,.18)'); g.addColorStop(1, 'rgba(160,166,176,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
    });
}

// ---------------------------------------------------------------- materiais (um por peça, para destacar sem afetar as outras)
const M = {
    plastico: (cor, rough = 0.55) => new THREE.MeshStandardMaterial({ color: cor, roughness: rough, metalness: 0 }),
    metal: (cor = '#c0c6cf', rough = 0.3) => new THREE.MeshStandardMaterial({ color: cor, roughness: rough, metalness: 1 }),
    ouro: () => new THREE.MeshStandardMaterial({ color: '#e5c06a', roughness: 0.25, metalness: 1 }),
};

function caixa(w, h, d, mat, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    return m;
}

function cilindro(r, h, mat, x = 0, y = 0, z = 0, seg = 32) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    return m;
}

function tubo(pontos, raio, mat, tensao = 0.5, segs = 80) {
    const curva = new THREE.CatmullRomCurve3(pontos, false, 'centripetal', tensao);
    const m = new THREE.Mesh(new THREE.TubeGeometry(curva, segs, raio, 10, false), mat);
    m.castShadow = true;
    return { mesh: m, curva };
}

// ================================================================ cena
export function criarCircuito({ canvas, palco, camadaRotulos, tooltip, aoSelecionar }) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const cena = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    cena.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
    const POS_INICIAL = V3(9, 15.5, 21);
    const ALVO_INICIAL = V3(-0.6, 0.6, -1.2);
    camera.position.set(POS_INICIAL.x * 1.6, POS_INICIAL.y * 1.8, POS_INICIAL.z * 1.6);

    const controles = new OrbitControls(camera, canvas);
    controles.target.copy(ALVO_INICIAL);
    controles.enableDamping = true;
    controles.dampingFactor = 0.07;
    controles.minDistance = 5;
    controles.maxDistance = 45;
    controles.maxPolarAngle = Math.PI * 0.47;
    controles.autoRotate = true;
    controles.autoRotateSpeed = 0.55;
    controles.enablePan = true;
    controles.screenSpacePanning = true;

    // luzes
    cena.add(new THREE.HemisphereLight('#bcd4ff', '#0b111c', 0.55));
    const sol = new THREE.DirectionalLight('#ffffff', 2.1);
    sol.position.set(8, 18, 10);
    sol.castShadow = true;
    sol.shadow.mapSize.set(2048, 2048);
    sol.shadow.camera.left = -15; sol.shadow.camera.right = 15;
    sol.shadow.camera.top = 12; sol.shadow.camera.bottom = -12;
    sol.shadow.bias = -0.0004; sol.shadow.normalBias = 0.02;
    sol.shadow.radius = 4;
    cena.add(sol);
    const contra = new THREE.DirectionalLight('#7dd3fc', 0.6);
    contra.position.set(-12, 8, -14);
    cena.add(contra);

    const raiz = new THREE.Group();
    cena.add(raiz);

    const grupos = {};          // id -> Group
    const ancoras = {};         // id -> Vector3 para rótulos
    const fios = [];            // { curva, cor, tipo, canal }
    const novoGrupo = (id) => { const g = new THREE.Group(); g.userData.peca = id; raiz.add(g); grupos[id] = g; return g; };

    // ------------------------------------------------ mesa
    {
        const W = 26, D = 17, r = 1.1;
        const forma = new THREE.Shape();
        forma.moveTo(-W / 2 + r, -D / 2);
        forma.lineTo(W / 2 - r, -D / 2); forma.quadraticCurveTo(W / 2, -D / 2, W / 2, -D / 2 + r);
        forma.lineTo(W / 2, D / 2 - r); forma.quadraticCurveTo(W / 2, D / 2, W / 2 - r, D / 2);
        forma.lineTo(-W / 2 + r, D / 2); forma.quadraticCurveTo(-W / 2, D / 2, -W / 2, D / 2 - r);
        forma.lineTo(-W / 2, -D / 2 + r); forma.quadraticCurveTo(-W / 2, -D / 2, -W / 2 + r, -D / 2);
        const base = new THREE.Mesh(
            new THREE.ExtrudeGeometry(forma, { depth: 0.5, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelSegments: 4 }),
            new THREE.MeshStandardMaterial({ color: '#0e1624', roughness: 0.8, metalness: 0.1 })
        );
        base.rotation.x = Math.PI / 2;
        base.position.y = -0.12;
        base.receiveShadow = true;
        raiz.add(base);
        const topo = new THREE.Mesh(
            new THREE.PlaneGeometry(W, D),
            new THREE.MeshStandardMaterial({ map: texturaMesa(W, D), roughness: 0.92, metalness: 0, transparent: true, alphaTest: 0.5 })
        );
        topo.rotation.x = -Math.PI / 2;
        topo.position.y = 0.005;
        topo.receiveShadow = true;
        raiz.add(topo);
        // brilho de borda
        const borda = new THREE.Mesh(
            new THREE.ExtrudeGeometry(forma, { depth: 0.02, bevelEnabled: false }),
            new THREE.MeshBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0.12 })
        );
        borda.rotation.x = Math.PI / 2; borda.position.y = -0.62; borda.scale.set(1.004, 1.004, 1);
        raiz.add(borda);
    }

    // ------------------------------------------------ Raspberry Pi 4
    const PI = { x: -5.4, z: 0.4, w: 8.5, d: 5.6, y: 0.5, esp: 0.14 };
    const piEsq = PI.x - PI.w / 2, piTopo = PI.z - PI.d / 2;
    const yPCB = PI.y + PI.esp;
    {
        const g = novoGrupo('pi');
        const pcbMat = [M.plastico('#1a6a3c', 0.6), M.plastico('#1a6a3c', 0.6),
            new THREE.MeshStandardMaterial({ map: texturaPCBPi(), roughness: 0.55, metalness: 0.05 }),
            M.plastico('#14532d', 0.7), M.plastico('#1a6a3c', 0.6), M.plastico('#1a6a3c', 0.6)];
        const pcb = new THREE.Mesh(new THREE.BoxGeometry(PI.w, PI.esp, PI.d), pcbMat);
        pcb.position.set(PI.x, PI.y + PI.esp / 2, PI.z);
        pcb.castShadow = pcb.receiveShadow = true;
        g.add(pcb);
        // espaçadores
        for (const [dx, dz] of [[0.35, 0.35], [6.15, 0.35], [0.35, 5.25], [6.15, 5.25]]) {
            const s = cilindro(0.22, PI.y, M.metal('#c9a54a', 0.35), piEsq + dx, PI.y / 2, piTopo + dz, 6);
            g.add(s);
            g.add(cilindro(0.2, 0.12, M.metal('#d1d5db', 0.3), piEsq + dx, yPCB + 0.06, piTopo + dz, 16));
        }
        // SoC com dissipador
        const socX = piEsq + 2.95, socZ = PI.z + 0.15;
        g.add(caixa(1.5, 0.12, 1.5, M.plastico('#1f2937', 0.5), socX, yPCB + 0.06, socZ));
        g.add(caixa(1.4, 0.05, 1.4, M.metal('#cfd5dd', 0.22), socX, yPCB + 0.145, socZ));
        // RAM
        g.add(caixa(1.05, 0.12, 1.45, M.plastico('#111827', 0.45), piEsq + 4.6, yPCB + 0.06, PI.z + 0.15));
        // Wi-Fi blindado
        g.add(caixa(1.15, 0.14, 1.0, M.metal('#b8bec7', 0.28), piEsq + 1.05, yPCB + 0.07, PI.z + 0.05));
        // controlador USB e PMIC
        g.add(caixa(0.6, 0.08, 0.6, M.plastico('#111827', 0.45), piEsq + 6.3, yPCB + 0.04, PI.z + 0.6));
        g.add(caixa(0.45, 0.07, 0.45, M.plastico('#111827', 0.45), piEsq + 6.0, yPCB + 0.035, PI.z + 1.0));
        // conectores de câmera e display (brancos)
        g.add(caixa(0.4, 0.5, 2.2, M.plastico('#f1f0ea', 0.6), piEsq + 4.6, yPCB + 0.25, PI.z + 1.6).rotateY(Math.PI / 2));
        g.add(caixa(2.2, 0.5, 0.4, M.plastico('#f1f0ea', 0.6), piEsq + 0.6, yPCB + 0.25, PI.z - 0.4).rotateY(Math.PI / 2));
        // portas no lado direito: Ethernet, USB 3 (azul), USB 2
        const xPorta = piEsq + PI.w - 0.85 + 0.2;
        const eth = caixa(2.1, 1.35, 1.6, M.metal('#c7ccd3', 0.3), xPorta, yPCB + 0.675, piTopo + 1.05);
        g.add(eth);
        g.add(caixa(0.05, 0.9, 1.2, M.plastico('#0f172a', 0.8), xPorta + 1.06, yPCB + 0.6, piTopo + 1.05));
        g.add(caixa(0.05, 0.25, 0.3, M.plastico('#f59e0b', 0.4), xPorta + 1.065, yPCB + 1.15, piTopo + 0.5));
        g.add(caixa(0.05, 0.25, 0.3, M.plastico('#22c55e', 0.4), xPorta + 1.065, yPCB + 1.15, piTopo + 1.6));
        for (const [z, cor] of [[PI.z + 0.55, '#2563eb'], [PI.z + 2.3, '#111827']]) {
            g.add(caixa(1.75, 1.6, 1.35, M.metal('#c7ccd3', 0.28), xPorta, yPCB + 0.8, z));
            for (const dy of [0.42, 1.12]) {
                g.add(caixa(0.06, 0.48, 1.12, M.plastico('#0b0f17', 0.8), xPorta + 0.875, yPCB + dy, z));
                g.add(caixa(0.07, 0.15, 0.98, M.plastico(cor, 0.5), xPorta + 0.88, yPCB + dy + 0.08, z));
            }
        }
        // borda inferior: USB-C, 2× micro-HDMI, áudio
        const zBaixo = piTopo + PI.d - 0.3;
        g.add(caixa(0.9, 0.32, 0.75, M.metal('#c7ccd3', 0.3), piEsq + 1.1, yPCB + 0.16, zBaixo));
        g.add(caixa(0.7, 0.3, 0.75, M.metal('#c7ccd3', 0.3), piEsq + 2.6, yPCB + 0.15, zBaixo));
        g.add(caixa(0.7, 0.3, 0.75, M.metal('#c7ccd3', 0.3), piEsq + 3.95, yPCB + 0.15, zBaixo));
        g.add(caixa(0.7, 0.6, 1.2, M.plastico('#111827', 0.6), piEsq + 5.4, yPCB + 0.3, zBaixo - 0.2));
        g.add(cilindro(0.32, 0.25, M.plastico('#111827', 0.6), piEsq + 5.4, yPCB + 0.3, zBaixo + 0.45).rotateX(Math.PI / 2));
        // LEDs de status
        g.add(caixa(0.12, 0.06, 0.2, new THREE.MeshStandardMaterial({ color: '#ef4444', emissive: '#ef4444', emissiveIntensity: 1.5 }), piEsq + 0.3, yPCB + 0.03, PI.z + 1.2));
        const ledAtv = caixa(0.12, 0.06, 0.2, new THREE.MeshStandardMaterial({ color: '#22c55e', emissive: '#22c55e', emissiveIntensity: 1.5 }), piEsq + 0.3, yPCB + 0.03, PI.z + 1.45);
        g.add(ledAtv);
        g.userData.ledAtividade = ledAtv;
        ancoras.pi = V3(piEsq + 2.6, yPCB + 0.3, piTopo + PI.d - 1.2);
    }

    // ------------------------------------------------ header GPIO (40 pinos)
    const pinoPos = (n) => {               // pino físico 1..40
        const col = Math.floor((n - 1) / 2);
        const externo = n % 2 === 0;       // pares na borda da placa
        return V3(piEsq + 0.87 + col * PASSO, yPCB, piTopo + (externo ? 0.23 : 0.23 + PASSO));
    };
    const Y_PINO_TOPO = yPCB + 0.25 + 0.6;
    {
        const g = novoGrupo('header');
        const p1 = pinoPos(1), p40 = pinoPos(40);
        g.add(caixa(p40.x - p1.x + PASSO, 0.25, PASSO * 2, M.plastico('#0b0f17', 0.5), (p1.x + p40.x) / 2, yPCB + 0.125, piTopo + 0.23 + PASSO / 2));
        const geo = new THREE.BoxGeometry(0.064, 0.85, 0.064);
        const mat = M.ouro();
        const inst = new THREE.InstancedMesh(geo, mat, 40);
        const m4 = new THREE.Matrix4();
        for (let n = 1; n <= 40; n++) {
            const p = pinoPos(n);
            m4.makeTranslation(p.x, yPCB + 0.425, p.z);
            inst.setMatrixAt(n - 1, m4);
        }
        inst.castShadow = true;
        g.add(inst);
        ancoras.header = V3(p40.x - 0.4, Y_PINO_TOPO + 0.2, piTopo + 0.36);
    }

    // ------------------------------------------------ protoboard
    const PB = { x: 5.2, z: 0.0, w: 8.6, d: 5.7, h: 0.85 };
    const COLUNAS = 30;
    const xFuroLocal = (c) => -((COLUNAS - 1) * PASSO) / 2 + c * PASSO;
    const zFuroLocal = (r) => (r < 5 ? -(0.508 + (4 - r) * PASSO) : 0.508 + (r - 5) * PASSO);
    const TRILHOS = { negLonge: -2.42, posLonge: -2.168, posPerto: 2.168, negPerto: 2.42 };
    const furo = (c, linha) => {           // linha: 'a'..'j' ou chave de TRILHOS
        const z = typeof linha === 'string' && linha.length === 1 ? zFuroLocal('abcdefghij'.indexOf(linha)) : TRILHOS[linha];
        return V3(PB.x + xFuroLocal(c), PB.h, PB.z + z);
    };
    {
        const g = novoGrupo('protoboard');
        const branco = M.plastico('#ece9e1', 0.75);
        const topoMat = new THREE.MeshStandardMaterial({ map: texturaProtoboard(PB.w, PB.d, COLUNAS, xFuroLocal, zFuroLocal, TRILHOS), roughness: 0.7 });
        const corpo = new THREE.Mesh(new THREE.BoxGeometry(PB.w, PB.h, PB.d), [branco, branco, topoMat, branco, branco, branco]);
        corpo.position.set(PB.x, PB.h / 2, PB.z);
        corpo.castShadow = corpo.receiveShadow = true;
        g.add(corpo);
        ancoras.protoboard = V3(PB.x + 3.2, PB.h + 0.1, PB.z + 1.2);
    }

    // ------------------------------------------------ fios
    function conectorMacho(g, p, cor) {
        g.add(caixa(0.2, 0.55, 0.2, M.plastico('#111111', 0.5), p.x, p.y + 0.275, p.z));
        g.add(caixa(0.205, 0.08, 0.205, M.plastico(cor, 0.4), p.x, p.y + 0.5, p.z));
        return V3(p.x, p.y + 0.55, p.z);
    }
    function conectorFemeaPi(g, n, cor) {
        const p = pinoPos(n);
        g.add(caixa(0.23, 0.62, 0.23, M.plastico('#111111', 0.5), p.x, yPCB + 0.3 + 0.31 + 0.3, p.z));
        g.add(caixa(0.235, 0.08, 0.235, M.plastico(cor, 0.4), p.x, yPCB + 0.3 + 0.62 + 0.26, p.z));
        return V3(p.x, yPCB + 0.3 + 0.62 + 0.3, p.z);
    }
    const fioMat = (cor) => new THREE.MeshPhysicalMaterial({ color: cor, roughness: 0.35, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.3 });

    function fioPi(id, pinoPi, destino, cor, opts = {}) {
        const g = new THREE.Group();
        g.userData.peca = opts.peca || id;
        g.userData.info = opts.info;
        raiz.add(g);
        const a = conectorFemeaPi(g, pinoPi, cor);
        const b = opts.femeaHorizontal ? destino : conectorMacho(g, destino, cor);
        const altura = opts.altura ?? 2.4;
        const meio = a.clone().lerp(b, 0.5);
        meio.y = Math.max(a.y, b.y) + altura;
        meio.x += opts.desvioX || 0;
        meio.z += opts.desvioZ || 0;
        const pts = [a, V3(a.x, a.y + 0.6, a.z), V3(a.x + (meio.x - a.x) * 0.25, a.y + altura * 0.75, a.z + (meio.z - a.z) * 0.25 + (opts.curvaZ || 0)), meio];
        if (opts.femeaHorizontal) {
            pts.push(V3(b.x, b.y + altura * 0.4, b.z + 1.0), V3(b.x, b.y + 0.05, b.z + 0.65), V3(b.x, b.y, b.z + 0.25), b);
        } else {
            pts.push(V3(b.x + (meio.x - b.x) * 0.25, b.y + altura * 0.75, b.z + (meio.z - b.z) * 0.25 + (opts.curvaZ || 0)), V3(b.x, b.y + 0.6, b.z), b);
        }
        const { mesh, curva } = tubo(pts, 0.05, fioMat(cor), 0.5, 120);
        g.add(mesh);
        if (opts.sinal) fios.push({ curva, cor: new THREE.Color(cor), ...opts.sinal });
        return g;
    }

    function jumperCurto(peca, a, b, cor, altura = 0.18) {
        const g = grupos[peca];
        const pts = [V3(a.x, a.y - 0.05, a.z), V3(a.x, a.y + altura, a.z), V3(a.x + (b.x - a.x) * 0.15, a.y + altura + 0.04, a.z + (b.z - a.z) * 0.15),
            V3(b.x - (b.x - a.x) * 0.15, b.y + altura + 0.04, b.z - (b.z - a.z) * 0.15), V3(b.x, b.y + altura, b.z), V3(b.x, b.y - 0.05, b.z)];
        g.add(tubo(pts, 0.035, fioMat(cor), 0.2, 40).mesh);
    }

    function resistor(peca, a, b, bandas, altura = 0.32) {
        const g = grupos[peca];
        const perna = M.metal('#cbd5e1', 0.35);
        const dir = b.clone().sub(a); const vao = dir.length(); dir.normalize();
        const corpoLen = Math.min(0.5, vao * 0.72);
        const pts = [V3(a.x, a.y - 0.05, a.z), V3(a.x, a.y + altura, a.z), V3(b.x, b.y + altura, b.z), V3(b.x, b.y - 0.05, b.z)];
        g.add(tubo(pts, 0.014, perna, 0.05, 30).mesh);
        const corpo = new THREE.Group();
        const bege = M.plastico('#d9c79c', 0.5);
        const c = cilindro(0.085, corpoLen * 0.7, bege, 0, 0, 0, 20); corpo.add(c);
        for (const s of [-1, 1]) {
            const ponta = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 12), bege);
            ponta.scale.set(1, 0.9, 1); ponta.position.y = s * corpoLen * 0.36; ponta.castShadow = true; corpo.add(ponta);
        }
        bandas.forEach((cor, i) => {
            const pos = -corpoLen * 0.36 + (i + 0.5) * (corpoLen * 0.72 / bandas.length) * (i === bandas.length - 1 ? 1.15 : 0.85);
            corpo.add(cilindro(i === 0 ? 0.1 : 0.088, 0.035, M.plastico(cor, 0.4), 0, pos, 0, 20));
        });
        corpo.position.copy(a.clone().lerp(b, 0.5)).setY(a.y + altura);
        corpo.quaternion.setFromUnitVectors(V3(0, 1, 0), dir);
        g.add(corpo);
    }

    // ------------------------------------------------ DHT11 (colunas 5–8, linha d)
    const COL_DHT = 5;
    {
        const g = novoGrupo('dht11');
        const base = furo(COL_DHT + 1.5, 'd');
        const yCorpo = PB.h + 0.42;
        const azul = M.plastico('#4a9fe0', 0.5);
        const frente = new THREE.MeshStandardMaterial({ map: texturaGradeDHT(), roughness: 0.55 });
        const corpo = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.55, 0.55), [azul, azul, azul, azul, frente, azul]);
        corpo.position.set(base.x, yCorpo + 0.775, base.z);
        corpo.castShadow = corpo.receiveShadow = true;
        g.add(corpo);
        g.add(caixa(1.2, 0.18, 0.62, M.plastico('#3b8ccc', 0.5), base.x, yCorpo + 0.09, base.z));
        g.add(caixa(1.24, 0.06, 0.6, M.plastico('#5aa9ea', 0.45), base.x, yCorpo + 1.56, base.z));
        const perna = M.metal('#cbd5e1', 0.35);
        for (let i = 0; i < 4; i++) {
            const h = furo(COL_DHT + i, 'd');
            g.add(caixa(0.05, yCorpo - PB.h + 0.05, 0.03, perna, h.x, (yCorpo + PB.h) / 2, h.z));
        }
        ancoras.dht11 = V3(base.x, yCorpo + 1.75, base.z);
        // alimentação: VCC (col 5) -> + ; GND (col 8) -> −
        jumperCurto('dht11', furo(COL_DHT, 'a'), furo(COL_DHT, 'posLonge'), '#e11d48', 0.12);
        jumperCurto('dht11', furo(COL_DHT + 3, 'a'), furo(COL_DHT + 3, 'negLonge'), '#27272a', 0.22);
    }
    // pull-up 10 kΩ entre + e o dado (col 6)
    novoGrupo('resistores');
    resistor('resistores', furo(COL_DHT + 1, 'posLonge'), furo(COL_DHT + 1, 'b'), ['#7c4a1e', '#111111', '#f97316', '#d4af37'], 0.28);

    // ------------------------------------------------ LED RGB (colunas 20–23, linha b) + resistores 220 Ω
    const COL_LED = 20;
    let ledLuz, ledCupula, ledBrilho, ledHalo;
    {
        const g = novoGrupo('led');
        const ref = furo(COL_LED + 1.5, 'b');
        const yBase = PB.h + 0.75;
        ledCupula = new THREE.MeshPhysicalMaterial({
            color: '#f8fafc', roughness: 0.25, transmission: 0.0, transparent: true, opacity: 0.92,
            emissive: '#000000', emissiveIntensity: 1.3, clearcoat: 1,
        });
        const corpo = new THREE.Group();
        const cil = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.5, 40), ledCupula); cil.position.y = 0.25;
        const dom = new THREE.Mesh(new THREE.SphereGeometry(0.25, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), ledCupula); dom.position.y = 0.5;
        const aba = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.07, 40), ledCupula); aba.position.y = 0.035;
        for (const m of [cil, dom, aba]) { m.castShadow = true; corpo.add(m); }
        corpo.position.set(ref.x, yBase, ref.z);
        g.add(corpo);
        const perna = M.metal('#cbd5e1', 0.35);
        for (let i = 0; i < 4; i++) {
            const h = furo(COL_LED + i, 'b');
            const topo = V3(ref.x + (i - 1.5) * 0.06, yBase + 0.02, ref.z);
            const pts = [V3(h.x, h.y - 0.05, h.z), V3(h.x, h.y + 0.25, h.z), V3(topo.x, yBase - 0.25, topo.z), topo];
            g.add(tubo(pts, 0.016, perna, 0.3, 24).mesh);
        }
        ledLuz = new THREE.PointLight('#000000', 0, 9, 1.6);
        ledLuz.position.set(ref.x, yBase + 0.45, ref.z);
        g.add(ledLuz);
        const brilho = texturaBrilho();
        ledBrilho = new THREE.Sprite(new THREE.SpriteMaterial({ map: brilho, color: '#000000', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        ledBrilho.scale.set(3.2, 3.2, 1);
        ledBrilho.position.copy(ledLuz.position);
        g.add(ledBrilho);
        ledHalo = new THREE.Mesh(new THREE.CircleGeometry(1.8, 48), new THREE.MeshBasicMaterial({ map: brilho, color: '#000000', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        ledHalo.rotation.x = -Math.PI / 2; ledHalo.position.set(ref.x, PB.h + 0.01, ref.z);
        g.add(ledHalo);
        ancoras.led = V3(ref.x, yBase + 1.0, ref.z);
        // cátodo (col 21) -> −
        jumperCurto('led', furo(COL_LED + 1, 'a'), furo(COL_LED + 1, 'negLonge'), '#27272a', 0.2);
    }
    for (const c of [COL_LED, COL_LED + 2, COL_LED + 3]) {
        resistor('resistores', furo(c, 'e'), furo(c, 'f'), ['#dc2626', '#dc2626', '#7c4a1e', '#d4af37'], 0.3);
    }
    ancoras.resistores = furo(COL_LED + 2, 'e').clone().lerp(furo(COL_LED + 2, 'f'), 0.5).setY(PB.h + 0.55);

    // ------------------------------------------------ MQ-2 (atrás do Raspberry Pi)
    const MQ = { x: -6.3, z: -5.0, w: 3.2, d: 2.2, y: 0.35 };
    let mqLedDO, mqFumaca;
    const pinosMQ = [];
    {
        const g = novoGrupo('mq2');
        const yP = MQ.y + 0.12;
        g.add(caixa(MQ.w, 0.12, MQ.d, M.plastico('#1d4ed8', 0.5), MQ.x, MQ.y + 0.06, MQ.z));
        for (const [dx, dz] of [[-1.4, -0.9], [1.4, -0.9], [-1.4, 0.9], [1.4, 0.9]]) g.add(cilindro(0.12, MQ.y, M.metal('#c9a54a', 0.35), MQ.x + dx, MQ.y / 2, MQ.z + dz, 6));
        // sensor
        const sx = MQ.x - 0.55, sz = MQ.z - 0.1;
        g.add(cilindro(1.0, 0.35, M.plastico('#9a5b2b', 0.5), sx, yP + 0.175, sz, 48));
        const malha = new THREE.MeshStandardMaterial({ map: texturaMalha(), metalness: 0.85, roughness: 0.4 });
        g.add(cilindro(0.92, 1.0, malha, sx, yP + 0.35 + 0.5, sz, 48));
        g.add(cilindro(0.95, 0.06, M.metal('#d1d5db', 0.25), sx, yP + 0.35 + 1.0, sz, 48));
        const tampa = cilindro(0.85, 0.02, new THREE.MeshStandardMaterial({ map: texturaMalha(), metalness: 0.85, roughness: 0.4 }), sx, yP + 0.35 + 1.03, sz, 48);
        g.add(tampa);
        // potenciômetro
        g.add(caixa(0.6, 0.55, 0.6, M.plastico('#2563eb', 0.4), MQ.x + 1.0, yP + 0.275, MQ.z - 0.5));
        g.add(cilindro(0.18, 0.06, M.metal('#e5e7eb', 0.3), MQ.x + 1.0, yP + 0.58, MQ.z - 0.5, 20));
        g.add(caixa(0.26, 0.02, 0.05, M.plastico('#475569'), MQ.x + 1.0, yP + 0.62, MQ.z - 0.5));
        // LM393
        g.add(caixa(0.5, 0.15, 0.4, M.plastico('#111827', 0.45), MQ.x + 1.0, yP + 0.075, MQ.z + 0.25));
        // LEDs do módulo
        g.add(caixa(0.14, 0.07, 0.22, new THREE.MeshStandardMaterial({ color: '#ef4444', emissive: '#ef4444', emissiveIntensity: 1.6 }), MQ.x + 0.62, yP + 0.035, MQ.z + 0.7));
        mqLedDO = new THREE.MeshStandardMaterial({ color: '#14532d', emissive: '#22c55e', emissiveIntensity: 0 });
        g.add(caixa(0.14, 0.07, 0.22, mqLedDO, MQ.x + 1.38, yP + 0.035, MQ.z + 0.7));
        // header em ângulo reto voltado para o Pi: VCC, GND, DO, AO
        const baseHeader = MQ.x + 0.75;
        g.add(caixa(4 * PASSO, 0.25, 0.25, M.plastico('#0b0f17', 0.5), baseHeader, yP + 0.125, MQ.z + MQ.d / 2 - 0.15));
        for (let i = 0; i < 4; i++) {
            const x = baseHeader - 1.5 * PASSO + i * PASSO;
            g.add(caixa(0.064, 0.064, 0.7, M.ouro(), x, yP + 0.125, MQ.z + MQ.d / 2 + 0.15));
            if (i < 3) {
                g.add(caixa(0.23, 0.23, 0.62, M.plastico('#111111', 0.5), x, yP + 0.125, MQ.z + MQ.d / 2 + 0.55));
            }
            pinosMQ.push(V3(x, yP + 0.125, MQ.z + MQ.d / 2 + 0.86));
        }
        ancoras.mq2 = V3(sx - 0.4, yP + 1.6, sz - 0.6);
        // fumaça
        const n = 70;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
        mqFumaca = new THREE.Points(geo, new THREE.PointsMaterial({ map: texturaFumaca(), size: 1.4, transparent: true, depthWrite: false, opacity: 0, sizeAttenuation: true }));
        mqFumaca.userData = { origem: V3(sx, yP + 1.4, sz), vida: Array.from({ length: n }, (_, i) => i / n), sementes: Array.from({ length: n }, () => [Math.random() - 0.5, Math.random() - 0.5, Math.random()]) };
        mqFumaca.frustumCulled = false;
        cena.add(mqFumaca);
    }

    // ------------------------------------------------ fiação Pi -> periféricos
    const info = (titulo, sub, desc) => ({ titulo, sub, desc });
    fioPi('fio-3v3', 1, furo(1, 'posLonge'), '#f43f5e', { peca: 'protoboard', altura: 2.0, info: info('3V3 → trilho +', 'Pino físico 1', 'Alimenta o DHT11 e o pull-up pelo trilho positivo.') });
    fioPi('fio-gnd', 6, furo(2, 'negLonge'), '#27272a', { peca: 'protoboard', altura: 1.7, info: info('GND → trilho −', 'Pino físico 6', 'Terra comum para DHT11 e cátodo do LED.') });
    fioPi('fio-dht', 7, furo(COL_DHT + 1, 'c'), '#38bdf8', { peca: 'dht11', altura: 2.8, info: info('GPIO 4 ↔ DHT11', 'Pino físico 7 · dados', 'Linha bidirecional: o Pi envia o pulso de início e lê os 40 bits.'), sinal: { tipo: 'sensor', vel: 0.55 } });
    fioPi('fio-led-r', 13, furo(COL_LED, 'h'), '#ef4444', { peca: 'led', altura: 3.2, desvioZ: 1.0, info: info('GPIO 27 → LED R', 'Pino físico 13', 'Canal vermelho via resistor de 220 Ω.'), sinal: { tipo: 'saida', canal: 0, vel: 0.45 } });
    fioPi('fio-led-g', 15, furo(COL_LED + 2, 'h'), '#22c55e', { peca: 'led', altura: 3.5, desvioZ: 1.1, info: info('GPIO 22 → LED G', 'Pino físico 15', 'Canal verde via resistor de 220 Ω.'), sinal: { tipo: 'saida', canal: 1, vel: 0.45 } });
    fioPi('fio-led-b', 16, furo(COL_LED + 3, 'h'), '#3b82f6', { peca: 'led', altura: 3.8, desvioZ: 1.2, info: info('GPIO 23 → LED B', 'Pino físico 16', 'Canal azul via resistor de 220 Ω.'), sinal: { tipo: 'saida', canal: 2, vel: 0.45 } });
    fioPi('fio-mq-vcc', 2, pinosMQ[0], '#e11d48', { peca: 'mq2', altura: 1.3, femeaHorizontal: true, info: info('5V → MQ-2 VCC', 'Pino físico 2', 'O aquecedor do MQ-2 precisa de 5 V.') });
    fioPi('fio-mq-gnd', 9, pinosMQ[1], '#27272a', { peca: 'mq2', altura: 1.6, femeaHorizontal: true, info: info('GND → MQ-2 GND', 'Pino físico 9', 'Terra do módulo.') });
    fioPi('fio-mq-do', 11, pinosMQ[2], '#f59e0b', { peca: 'mq2', altura: 1.9, femeaHorizontal: true, info: info('MQ-2 DO → GPIO 17', 'Pino físico 11 · entrada', 'Nível LOW = fumaça detectada.'), sinal: { tipo: 'sensor', vel: 0.7 } });

    // ------------------------------------------------ pulsos de sinal
    const geoPulso = new THREE.SphereGeometry(0.085, 14, 10);
    const pulsos = fios.map((f) => {
        const lista = [0, 0.5].map((fase) => {
            const m = new THREE.Mesh(geoPulso, new THREE.MeshBasicMaterial({ color: f.cor.clone().multiplyScalar(2.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
            const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texturaBrilho(), color: f.cor, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
            s.scale.set(0.6, 0.6, 1);
            m.add(s);
            cena.add(m);
            return { m, fase };
        });
        return { ...f, lista };
    });
    let mostrarFluxo = true;

    // ------------------------------------------------ estado / LED
    let estado = 'aguardando';
    let fumaca = false;
    const corAlvo = new THREE.Color(0, 0, 0);
    const corAtual = new THREE.Color(0, 0, 0);
    let canais = [0, 0, 0];

    function definirEstado(e, comFumaca) {
        estado = CORES_ESTADO[e] ? e : 'aguardando';
        if (typeof comFumaca === 'boolean') fumaca = comFumaca;
        canais = CORES_ESTADO[estado].map((v) => (v > 0 ? 1 : 0));
        const [r, gg, b] = CORES_ESTADO[estado];
        corAlvo.setRGB(r, gg, b);
    }

    // ------------------------------------------------ rótulos HTML
    const ordem = ['pi', 'header', 'dht11', 'mq2', 'led', 'resistores', 'protoboard'];
    const rotulos = {};
    for (const id of ordem) {
        const el = document.createElement('div');
        el.className = 'rotulo3d';
        el.style.setProperty('--c', PECAS[id].cor);
        el.innerHTML = `<div class="caixa">${PECAS[id].nome}<small>${PECAS[id].sub}</small></div><div class="haste"></div>`;
        el.addEventListener('click', () => focar(id));
        el.addEventListener('mouseenter', () => destacar(id));
        el.addEventListener('mouseleave', () => destacar(null));
        camadaRotulos.appendChild(el);
        rotulos[id] = el;
    }

    // ------------------------------------------------ destaque e foco
    let destacado = null, selecionado = null;
    const corDestaque = new THREE.Color('#38bdf8');
    function aplicarDestaque(obj, ligar) {
        obj.traverse((m) => {
            if (!m.isMesh || !m.material || m === mqFumaca) return;
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            for (const mat of mats) {
                if (!('emissive' in mat) || mat === ledCupula || mat === mqLedDO) continue;
                if (ligar) {
                    if (!mat.userData.emOrig) mat.userData.emOrig = { c: mat.emissive.clone(), i: mat.emissiveIntensity };
                    mat.emissive.copy(corDestaque); mat.emissiveIntensity = 0.06;
                } else if (mat.userData.emOrig) {
                    mat.emissive.copy(mat.userData.emOrig.c); mat.emissiveIntensity = mat.userData.emOrig.i;
                }
            }
        });
    }
    function objetosDaPeca(id) {
        return raiz.children.filter((o) => o.userData.peca === id);
    }
    function destacar(id) {
        const alvo = id || selecionado;
        if (destacado === alvo) return;
        if (destacado) objetosDaPeca(destacado).forEach((o) => aplicarDestaque(o, false));
        destacado = alvo;
        if (destacado) objetosDaPeca(destacado).forEach((o) => aplicarDestaque(o, true));
        for (const [k, el] of Object.entries(rotulos)) el.classList.toggle('ativo', k === destacado);
    }

    let animCam = null;
    function focar(id) {
        selecionado = id;
        destacar(id);
        aoSelecionar?.(id);
        controles.autoRotate = false;
        aoMudarGiro?.(false);
        let alvo, dist;
        if (!id) {
            alvo = ALVO_INICIAL.clone(); dist = POS_INICIAL.distanceTo(ALVO_INICIAL);
        } else {
            const caixaB = new THREE.Box3();
            objetosDaPeca(id).forEach((o) => caixaB.expandByObject(o));
            if (id === 'led' || id === 'resistores' || id === 'dht11' || id === 'mq2') {
                caixaB.makeEmpty();
                objetosDaPeca(id).filter((o) => !o.userData.info).forEach((o) => caixaB.expandByObject(o));
            }
            alvo = caixaB.getCenter(new THREE.Vector3());
            const tam = caixaB.getSize(new THREE.Vector3()).length();
            dist = THREE.MathUtils.clamp(tam * 1.9, 5.5, 26);
        }
        const dir = camera.position.clone().sub(controles.target).normalize();
        if (dir.y < 0.45) { dir.y = 0.45; dir.normalize(); }
        animCam = { t: 0, de: { p: camera.position.clone(), a: controles.target.clone() }, para: { p: alvo.clone().addScaledVector(dir, dist), a: alvo } };
    }
    let aoMudarGiro = null;

    // ------------------------------------------------ raycast
    const ray = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let arrastou = false, inicio = null;
    function pecaSob(ev) {
        const r = canvas.getBoundingClientRect();
        mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(mouse, camera);
        const hits = ray.intersectObjects(raiz.children, true);
        for (const h of hits) {
            let o = h.object;
            while (o && o.parent !== raiz) o = o.parent;
            if (o && o.userData.peca) return o;
        }
        return null;
    }
    canvas.addEventListener('pointerdown', (ev) => { inicio = [ev.clientX, ev.clientY]; arrastou = false; });
    canvas.addEventListener('pointermove', (ev) => {
        if (inicio && Math.hypot(ev.clientX - inicio[0], ev.clientY - inicio[1]) > 4) arrastou = true;
        if (ev.buttons) { tooltip.hidden = true; return; }
        const o = pecaSob(ev);
        if (!o) { tooltip.hidden = true; destacar(null); canvas.style.cursor = ''; return; }
        canvas.style.cursor = 'pointer';
        destacar(o.userData.peca);
        const p = PECAS[o.userData.peca];
        const i = o.userData.info;
        tooltip.innerHTML = i ? `<strong>${i.titulo}</strong><span class="mono">${i.sub}</span>${i.desc}` : `<strong>${p.nome}</strong><span class="mono">${p.sub}</span>${p.desc}`;
        const r = palco.getBoundingClientRect();
        let x = ev.clientX - r.left + 16, y = ev.clientY - r.top + 16;
        tooltip.hidden = false;
        if (x + tooltip.offsetWidth > r.width - 8) x = ev.clientX - r.left - tooltip.offsetWidth - 16;
        if (y + tooltip.offsetHeight > r.height - 8) y = ev.clientY - r.top - tooltip.offsetHeight - 16;
        tooltip.style.left = x + 'px'; tooltip.style.top = y + 'px';
    });
    canvas.addEventListener('pointerleave', () => { tooltip.hidden = true; destacar(null); });
    canvas.addEventListener('pointerup', (ev) => {
        if (arrastou) { inicio = null; return; }
        inicio = null;
        const o = pecaSob(ev);
        focar(o ? o.userData.peca : null);
    });
    controles.addEventListener('start', () => { animCam = null; });

    // ------------------------------------------------ tamanho
    function redimensionar() {
        const w = palco.clientWidth, h = palco.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.fov = w / h < 1 ? 44 : 32;
        camera.updateProjectionMatrix();
    }
    new ResizeObserver(redimensionar).observe(palco);
    redimensionar();

    // ------------------------------------------------ loop
    const relogio = new THREE.Clock();
    const v = new THREE.Vector3();
    let intro = 0;
    const posIntroIni = camera.position.clone();
    let visivel = true;
    new IntersectionObserver(([e]) => { visivel = e.isIntersecting; }, { threshold: 0 }).observe(palco);

    function quadro() {
        requestAnimationFrame(quadro);
        if (!visivel) return;
        const dt = Math.min(relogio.getDelta(), 0.05);
        const t = relogio.elapsedTime;

        if (intro < 1) {
            intro = Math.min(1, intro + dt * 0.55);
            const k = 1 - Math.pow(1 - intro, 3);
            camera.position.lerpVectors(posIntroIni, POS_INICIAL, k);
        }
        if (animCam) {
            animCam.t = Math.min(1, animCam.t + dt * 1.6);
            const k = animCam.t < 0.5 ? 4 * animCam.t ** 3 : 1 - Math.pow(-2 * animCam.t + 2, 3) / 2;
            camera.position.lerpVectors(animCam.de.p, animCam.para.p, k);
            controles.target.lerpVectors(animCam.de.a, animCam.para.a, k);
            if (animCam.t >= 1) animCam = null;
        }
        controles.update();

        // LED
        let fator = 1;
        if (estado === 'aquecendo') fator = (t % 1) < 0.5 ? 1 : 0.04;
        else if (estado === 'perigo') fator = 0.75 + 0.25 * Math.sin(t * 10);
        corAtual.lerp(corAlvo, 0.12);
        const c = corAtual.clone().multiplyScalar(fator);
        ledCupula.emissive.copy(c);
        ledCupula.color.copy(BRANCO_LED).lerp(corAtual, 0.85);
        ledLuz.color.copy(corAtual);
        ledLuz.intensity = 22 * fator * (corAtual.r + corAtual.g + corAtual.b > 0.05 ? 1 : 0);
        ledBrilho.material.color.copy(c);
        ledHalo.material.color.copy(c).multiplyScalar(0.55);
        grupos.pi.userData.ledAtividade.material.emissiveIntensity = Math.random() > 0.85 ? 2.4 : 0.3;
        mqLedDO.emissiveIntensity = fumaca ? 2.2 : 0;
        mqLedDO.emissive.set(fumaca ? '#22c55e' : '#000000');

        // fumaça
        const fd = mqFumaca.userData;
        mqFumaca.material.opacity += ((fumaca ? 0.9 : 0) - mqFumaca.material.opacity) * 0.05;
        if (mqFumaca.material.opacity > 0.01) {
            const pos = mqFumaca.geometry.attributes.position;
            for (let i = 0; i < fd.vida.length; i++) {
                fd.vida[i] = (fd.vida[i] + dt * 0.22) % 1;
                const l = fd.vida[i], s = fd.sementes[i];
                pos.setXYZ(i, fd.origem.x + s[0] * 1.2 + Math.sin(t * 0.8 + s[2] * 6) * l * 0.8, fd.origem.y + l * 4.5, fd.origem.z + s[1] * 1.2 + Math.cos(t * 0.6 + s[2] * 6) * l * 0.6);
            }
            pos.needsUpdate = true;
        }

        // pulsos
        for (const p of pulsos) {
            let ativo = mostrarFluxo && estado !== 'aguardando';
            if (p.tipo === 'saida') ativo = ativo && canais[p.canal] && (estado !== 'aquecendo' || (t % 1) < 0.5);
            if (p.tipo === 'sensor' && estado === 'aquecendo') ativo = false;
            for (const q of p.lista) {
                q.m.visible = !!ativo;
                if (!ativo) continue;
                let u = (t * p.vel * 0.5 + q.fase) % 1;
                if (p.tipo === 'sensor') u = 1 - u;          // do sensor para o Pi
                p.curva.getPointAt(u, q.m.position);
                const a = Math.sin(u * Math.PI);
                q.m.material.opacity = a;
                q.m.children[0].material.opacity = a;
            }
        }

        // rótulos
        const w = palco.clientWidth, h = palco.clientHeight;
        for (const [id, el] of Object.entries(rotulos)) {
            v.copy(ancoras[id]).project(camera);
            const fora = v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1;
            el.style.display = fora ? 'none' : '';
            if (fora) continue;
            el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -100%)`;
            el.style.zIndex = String(Math.round((1 - v.z) * 10000));
        }

        renderer.render(cena, camera);
    }
    quadro();
    definirEstado('aguardando', false);

    return {
        definirEstado,
        focar,
        destacar,
        pecas: PECAS,
        set autoGiro(v) { controles.autoRotate = v; },
        get autoGiro() { return controles.autoRotate; },
        set fluxo(v) { mostrarFluxo = v; },
        set aoMudarGiro(fn) { aoMudarGiro = fn; },
        resetar() { selecionado = null; destacar(null); focar(null); selecionado = null; aoSelecionar?.(null); },
    };
}
