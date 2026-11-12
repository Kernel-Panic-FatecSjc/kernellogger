# KernelLogger — monitoramento ambiental

Este projeto foi feito para Raspberry Pi com Raspberry Pi OS. O monitor C acessa os sensores e GPIOs no Raspberry Pi, grava as leituras no PostgreSQL e expõe uma API na porta `8080`. O painel web roda em Docker na porta `3000` e consulta o PostgreSQL pela rede interna do Compose.

## Ligações dos sensores

Os números usados no código são BCM, pois ele chama `wiringPiSetupGpio()`:

| Sinal | GPIO BCM | Pino físico |
|---|---:|---:|
| DHT11 DATA | 4 | 7 |
| MQ-7 DO | 17 | 11 |
| LED vermelho | 27 | 13 |
| LED verde | 22 | 15 |
| LED azul | 23 | 16 |

No módulo DHT11 de 3 pinos, ligue VCC ao pino físico 1 (3,3 V), DATA ao pino físico 7 e GND a um pino GND, como o físico 6. Não conecte DATA diretamente à alimentação. O resistor de pull-up, se necessário, fica entre DATA e 3,3 V; muitos módulos já o incluem.

O código lê apenas a saída digital DO do módulo MQ-7. Isso informa o estado do comparador ajustado no módulo, não uma concentração calibrada de CO. Medição de CO exige circuito de aquecimento apropriado para MQ-7 e conversor analógico-digital; o Raspberry Pi não possui entrada analógica. Confira o esquema do módulo e garanta que DO nunca aplique mais de 3,3 V ao GPIO. Não use este projeto como alarme de segurança de vida.

## 1. Instalar dependências no Raspberry Pi

No terminal do Raspberry Pi, instale as ferramentas de compilação e bibliotecas do PostgreSQL e da API HTTP:

```bash
sudo apt update
sudo apt install -y build-essential git curl libpq-dev libmicrohttpd-dev docker.io docker-compose
sudo systemctl enable --now docker
```

O WiringPi precisa ser instalado à parte. Os comandos abaixo baixam o código-fonte oficial, criam o pacote Debian e instalam a biblioteca:

```bash
cd /tmp
git clone https://github.com/WiringPi/WiringPi.git
cd WiringPi
./build debian
sudo apt install -y ./debian-template/wiringpi-3.x.deb
sudo ldconfig
```

Se o pacote não aparecer no caminho informado, confira o nome gerado em `debian-template/` e use esse nome no comando `apt install`. O procedimento de compilação e instalação segue as instruções do [repositório oficial do WiringPi](https://github.com/WiringPi/WiringPi#installing).

## 2. Configurar e compilar o monitor C

Na raiz deste repositório, compile o programa:

```bash
cd ~/kernellogger/monitor-fumaca
make
```

Crie o arquivo local de configuração a partir do exemplo e defina uma senha própria:

```bash
cp -n .env.example .env
nano .env
```

Defina também um token longo e aleatório em `INGEST_TOKEN`; o endpoint de gravação recusa requisições sem esse token. Gere um valor com `openssl rand -hex 32` e coloque-o no `.env`.

O Compose carrega esse arquivo para configurar o PostgreSQL. O processo C não carrega `.env` automaticamente; exporte as mesmas variáveis antes de iniciá-lo:

```bash
export DB_HOST=127.0.0.1
export DB_PORT=5432
export DB_NAME=monitor
export DB_USER=monitor
export DB_PASSWORD='sua-senha-local'
```

## 3. Subir banco e painel com Docker

Na pasta `monitor-fumaca`, suba o PostgreSQL e o painel. O banco é criado e recebe as tabelas automaticamente a partir de `init.sql` na primeira inicialização:

```bash
cd ~/kernellogger/monitor-fumaca
sudo docker-compose up --build -d
```

Confira se os containers estão ativos:

```bash
sudo docker-compose ps
sudo docker-compose logs --tail=100 db dashboard
```

Abra o painel em `http://localhost:3000` (ou `http://IP_DO_RASPBERRY:3000` em outro dispositivo da rede).

## 4. Iniciar o monitor e a API

Com o banco ativo e os sensores conectados ao Raspberry Pi, inicie o monitor C:

```bash
cd ~/kernellogger/monitor-fumaca
sudo --preserve-env=DB_HOST,DB_PORT,DB_NAME,DB_USER,DB_PASSWORD ./monitor
```

A API do monitor C fica disponível na porta `8080`. O dashboard lê e grava as leituras diretamente no PostgreSQL; assim, não depende de o monitor C estar em execução para exibir dados já gravados ou recebidos via `POST`. O monitor aguarda três minutos na inicialização; isso não implementa o ciclo de aquecimento exigido para uma medição calibrada do MQ-7. Quando o DHT11 falha, o sistema mostra `sem_dados`, em vez de classificar o ambiente como normal.

## 5. Parar e iniciar novamente

Para parar os containers:

```bash
cd ~/kernellogger/monitor-fumaca
sudo docker-compose down
```

Para iniciar novamente sem reconstruir as imagens:

```bash
sudo docker-compose up -d
```

As leituras permanecem no volume Docker `monitor_pgdata` quando os containers são parados. Para apagar também o banco e todas as leituras, use `sudo docker-compose down -v`.

## Endereços e portas

- Painel: `http://localhost:3000`
- API do monitor C: `http://localhost:8080` (`/health`, `/status`, `/leituras` e `/eventos`)
- PostgreSQL: porta `5432`, disponível no próprio Raspberry Pi

O painel e o banco rodam em Docker. O processo C é iniciado no Raspberry Pi para que possa acessar diretamente os GPIOs. O dashboard oferece `GET /api/leituras`, `POST /api/leituras` e `GET /api/health`; o monitor C mantém `/health`, `/status`, `/leituras` e `/eventos` na porta `8080`.

O campo histórico `fumaca` no banco e na API é mantido por compatibilidade; quando a fonte é o MQ-7, ele representa apenas o estado digital DO. O endpoint `POST /api/leituras` do dashboard grava dados de teste enviados pelo simulador no PostgreSQL.

## Testar sem sensores

Com os containers ativos, execute o simulador em outra sessão SSH. Use o mesmo token configurado no `.env`:

```bash
cd ~/kernellogger
export INGEST_TOKEN='token-configurado-no-env'
node dashboard/simulador.js
```

O simulador e `dashboard/monitor_ambiental.c` são emissores alternativos de teste. Não os execute ao mesmo tempo que `monitor-fumaca/monitor`, pois ambos tentariam ler os mesmos GPIOs.
