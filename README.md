# KernelLogger — monitoramento ambiental

Este projeto foi feito para Raspberry Pi com Raspberry Pi OS. O monitor C acessa os sensores e GPIOs no Raspberry Pi, grava as leituras no PostgreSQL e expõe a API na porta `8080`. O painel web roda em Docker na porta `3000` e consulta essa API.

## 1. Instalar dependências no Raspberry Pi

No terminal do Raspberry Pi, instale as ferramentas de compilação e bibliotecas do PostgreSQL e da API HTTP:

```bash
sudo apt update
sudo apt install -y build-essential git libpq-dev libmicrohttpd-dev docker.io docker-compose
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

O arquivo `monitor-fumaca/.env` já define as credenciais padrão do banco. O programa C usa esses mesmos valores por padrão. Se você alterar `.env`, exporte os valores correspondentes antes de iniciar o monitor. Exemplo com os valores padrão:

```bash
export DB_HOST=127.0.0.1
export DB_PORT=5432
export DB_NAME=monitor
export DB_USER=monitor
export DB_PASSWORD=monitor_pass
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
sudo docker-compose logs -f db dashboard
```

Abra o painel em `http://localhost:3000` (ou `http://IP_DO_RASPBERRY:3000` em outro dispositivo da rede).

## 4. Iniciar o monitor e a API

Com o banco ativo e os sensores conectados ao Raspberry Pi, inicie o monitor C:

```bash
cd ~/kernellogger/monitor-fumaca
sudo ./monitor
```

A API fica disponível na porta `8080`. O painel encaminha `/api/leituras` para essa API e adapta o campo `data_hora` retornado pelo banco para `criado_em`, usado nos gráficos e horários da interface. O monitor aquece o sensor por três minutos antes de iniciar as leituras.

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

## Testar o alarme

Como o botão "testar" de um detector de fumaça, a rota `/teste` força o estado de **perigo** por 10 segundos, inclusive com o sensor real conectado. O LED fica vermelho, o painel mostra "Teste do alarme" e apita, e o evento é gravado no banco como `TESTE do alarme acionado pela API.`. Depois de 10 s o monitor volta a usar só os sensores.

```bash
curl "http://IP_DO_RASPBERRY:8080/teste"           # aciona por 10 s
curl "http://IP_DO_RASPBERRY:8080/teste?parar=1"   # encerra antes
```

O painel também tem o botão **Testar alarme**. Durante o aquecimento do MQ-2 a rota responde `409`. Fumaça real tem prioridade sobre o teste.

## Rodar sem o Raspberry Pi (modo simulação)

O monitor pode ser compilado com GPIO e sensores simulados. O resto do programa é o mesmo que roda no Pi: as três threads, a gravação no PostgreSQL e a API na porta `8080`. Assim dá para testar o sistema inteiro (monitor → banco → painel) em qualquer Linux ou WSL, sem placa e sem wiringPi.

Instale só as bibliotecas do banco e da API:

```bash
sudo apt install -y build-essential libpq-dev libmicrohttpd-dev
```

Compile e rode:

```bash
cd ~/kernellogger/monitor-fumaca
make simulacao
./monitor-sim
```

O banco precisa estar ativo (seção 3). No modo simulação o aquecimento do MQ-2 dura 15 segundos em vez de 3 minutos; para mudar, use `make simulacao AQUECIMENTO_SIM=5000` (em milissegundos).

A temperatura e a umidade variam sozinhas dentro da faixa normal. Para provocar cada situação, use a rota `/simular`, disponível só nesse modo:

```bash
curl "localhost:8080/simular?fumaca=1"     # MQ-2 detecta fumaça → perigo (LED vermelho)
curl "localhost:8080/simular?fumaca=0"
curl "localhost:8080/simular?calor=1"      # temperatura sobe acima de 35 °C → atenção
curl "localhost:8080/simular?umidade=seca" # abaixo de 20 % → atenção (também: umida, normal)
curl "localhost:8080/simular"              # mostra o estado da simulação e do LED
```

Os valores simulados passam pelo mesmo caminho dos reais: viram estado, evento e leitura no banco, e aparecem no painel. A compilação normal (`make`) não muda.

## Endereços e portas

- Painel: `http://localhost:3000`
- API do monitor C: `http://localhost:8080` (`/health`, `/status`, `/leituras`, `/eventos` e `/teste`)
- PostgreSQL: porta `5432`, disponível no próprio Raspberry Pi

O painel e o banco rodam em Docker. O processo C é iniciado no Raspberry Pi para que possa acessar diretamente os GPIOs. Para usar uma API em outro endereço, defina `BACKEND_URL` no ambiente do serviço `dashboard` em `docker-compose.yml`.
