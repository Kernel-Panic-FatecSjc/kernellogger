#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <stdbool.h>
#include <stdarg.h>
#include <string.h>
#include <signal.h>
#include <pthread.h>
#include <semaphore.h>
#include <wiringPi.h>
#include <libpq-fe.h>
#include <microhttpd.h>

#define PINO_DHT    4
#define PINO_MQ2    17
#define PINO_LED_R  27
#define PINO_LED_G  22
#define PINO_LED_B  23

#define LED_ANODO_COMUM 0
#define NIVEL_DETECTADO LOW

#define TEMPO_AQUECIMENTO_MS 180000UL
#define INTERVALO_DHT_MS     2000UL
#define INTERVALO_LOOP_MS    200UL
#define TENTATIVAS_DHT       5

#define TEMP_MAXIMA  35.0f
#define UMID_MINIMA  20.0f
#define UMID_MAXIMA  85.0f

#define MAX_TIMINGS 85

#define TENTATIVA_BANCO_MS  5000UL   
#define INTERVALO_BANCO_MS  10000UL  
#define PORTA_API           8080
#define LIMITE_PADRAO       50
#define LIMITE_MAXIMO       500

#if MHD_VERSION >= 0x00097002
#define MHD_RESULT enum MHD_Result
#else
#define MHD_RESULT int
#endif

static volatile sig_atomic_t executando = 1;
static volatile sig_atomic_t aquecendo = 1;

static sem_t semDados;

typedef struct {
    float temperatura;
    float umidade;
    bool leituraValida;
    bool fumaca;
} DadosSensores;

static DadosSensores dados = {
    -1000.0f,
    -1000.0f,
    false,
    false
};

typedef enum {
    ESTADO_NORMAL,
    ESTADO_ATENCAO,
    ESTADO_PERIGO
} EstadoSistema;

static EstadoSistema estadoAtual = ESTADO_NORMAL;

static PGconn *banco = NULL;
static unsigned long ultimaTentativaBanco = 0;
static bool jaTentouBanco = false;
static pthread_mutex_t mutexBanco = PTHREAD_MUTEX_INITIALIZER;

static struct MHD_Daemon *servidorHttp = NULL;

static const char *nomeEstado(EstadoSistema e)
{
    switch (e) {
        case ESTADO_NORMAL:  return "normal";
        case ESTADO_ATENCAO: return "atencao";
        case ESTADO_PERIGO:  return "perigo";
    }
    return "desconhecido";
}

static DadosSensores obterDados(void)
{
    DadosSensores copia;

    sem_wait(&semDados);
    copia = dados;
    sem_post(&semDados);

    return copia;
}

static void atualizarDados(float temp, float umid,
                           bool valida, bool fumaca)
{
    sem_wait(&semDados);

    dados.temperatura = temp;
    dados.umidade = umid;
    dados.leituraValida = valida;
    dados.fumaca = fumaca;

    sem_post(&semDados);
}

static EstadoSistema obterEstado(void)
{
    EstadoSistema e;

    sem_wait(&semDados);
    e = estadoAtual;
    sem_post(&semDados);

    return e;
}

static void definirEstado(EstadoSistema e)
{
    sem_wait(&semDados);
    estadoAtual = e;
    sem_post(&semDados);
}

static const char *envOu(const char *nome, const char *padrao)
{
    const char *v = getenv(nome);

    return (v && *v) ? v : padrao;
}

static bool bancoConectar(void)
{
    if (banco && PQstatus(banco) == CONNECTION_OK) {
        return true;
    }

    if (banco) {
        PQfinish(banco);
        banco = NULL;
    }

    unsigned long agora = millis();

    if (jaTentouBanco && (agora - ultimaTentativaBanco) < TENTATIVA_BANCO_MS) {
        return false;
    }

    jaTentouBanco = true;
    ultimaTentativaBanco = agora;

    const char *chaves[] = {
        "host", "port", "dbname", "user", "password",
        "connect_timeout", NULL
    };

    const char *valores[] = {
        envOu("DB_HOST", "127.0.0.1"),
        envOu("DB_PORT", "5432"),
        envOu("DB_NAME", "monitor"),
        envOu("DB_USER", "monitor"),
        envOu("DB_PASSWORD", "monitor_pass"),
        "3",
        NULL
    };

    banco = PQconnectdbParams(chaves, valores, 0);

    if (PQstatus(banco) != CONNECTION_OK) {
        fprintf(stderr, "Erro ao conectar no banco: %s",
                PQerrorMessage(banco));
        PQfinish(banco);
        banco = NULL;
        return false;
    }

    printf("Conectado ao banco PostgreSQL.\n");

    return true;
}

static bool bancoAbrir(void)
{
    bool ok;

    pthread_mutex_lock(&mutexBanco);
    ok = bancoConectar();
    pthread_mutex_unlock(&mutexBanco);

    return ok;
}

static void bancoFechar(void)
{
    pthread_mutex_lock(&mutexBanco);

    if (banco) {
        PQfinish(banco);
        banco = NULL;
    }

    pthread_mutex_unlock(&mutexBanco);
}

static void bancoSalvarLeitura(DadosSensores d, EstadoSistema estado)
{
    char temp[16];
    char umid[16];
    const char *params[4];
    PGresult *res;

    pthread_mutex_lock(&mutexBanco);

    if (!bancoConectar()) {
        pthread_mutex_unlock(&mutexBanco);
        return;
    }

    if (d.leituraValida) {
        snprintf(temp, sizeof(temp), "%.1f", d.temperatura);
        snprintf(umid, sizeof(umid), "%.1f", d.umidade);
        params[0] = temp;
        params[1] = umid;
    } else {
        params[0] = NULL;
        params[1] = NULL;
    }

    params[2] = d.fumaca ? "true" : "false";
    params[3] = nomeEstado(estado);

    res = PQexecParams(
        banco,
        "INSERT INTO leituras (temperatura, umidade, fumaca, estado) "
        "VALUES ($1, $2, $3, $4)",
        4, NULL, params, NULL, NULL, 0);

    if (PQresultStatus(res) != PGRES_COMMAND_OK) {
        fprintf(stderr, "Erro ao gravar leitura: %s",
                PQerrorMessage(banco));
    }

    PQclear(res);

    pthread_mutex_unlock(&mutexBanco);
}

static void bancoSalvarEvento(EstadoSistema estado, const char *mensagem)
{
    const char *params[2];
    PGresult *res;

    pthread_mutex_lock(&mutexBanco);

    if (!bancoConectar()) {
        pthread_mutex_unlock(&mutexBanco);
        return;
    }

    params[0] = nomeEstado(estado);
    params[1] = mensagem;

    res = PQexecParams(
        banco,
        "INSERT INTO eventos (estado, mensagem) VALUES ($1, $2)",
        2, NULL, params, NULL, NULL, 0);

    if (PQresultStatus(res) != PGRES_COMMAND_OK) {
        fprintf(stderr, "Erro ao gravar evento: %s",
                PQerrorMessage(banco));
    }

    PQclear(res);

    pthread_mutex_unlock(&mutexBanco);
}


typedef struct {
    char  *buf;
    size_t len;
    size_t cap;
} Buffer;

static void bufferPrintf(Buffer *b, const char *fmt, ...)
{
    va_list ap, ap2;
    int n;

    va_start(ap, fmt);
    va_copy(ap2, ap);
    n = vsnprintf(NULL, 0, fmt, ap);
    va_end(ap);

    if (n < 0) {
        va_end(ap2);
        return;
    }

    if (b->len + (size_t)n + 1 > b->cap) {
        size_t novaCap = b->cap ? b->cap : 256;

        while (novaCap < b->len + (size_t)n + 1) {
            novaCap *= 2;
        }

        char *tmp = realloc(b->buf, novaCap);

        if (!tmp) {
            va_end(ap2);
            return;
        }

        b->buf = tmp;
        b->cap = novaCap;
    }

    vsnprintf(b->buf + b->len, (size_t)n + 1, fmt, ap2);
    va_end(ap2);

    b->len += (size_t)n;
}

static void bufferJsonNumero(Buffer *b, PGresult *res, int linha, int col)
{
    if (PQgetisnull(res, linha, col)) {
        bufferPrintf(b, "null");
    } else {
        bufferPrintf(b, "%s", PQgetvalue(res, linha, col));
    }
}

static char *bancoListarLeituras(int limite)
{
    Buffer b = {NULL, 0, 0};
    char lim[16];
    const char *params[1];
    PGresult *res;

    bufferPrintf(&b, "[");

    snprintf(lim, sizeof(lim), "%d", limite);
    params[0] = lim;

    pthread_mutex_lock(&mutexBanco);

    if (bancoConectar()) {

        res = PQexecParams(
            banco,
            "SELECT id, "
            "to_char(data_hora AT TIME ZONE 'America/Sao_Paulo', "
            "'YYYY-MM-DD HH24:MI:SS'), "
            "temperatura, umidade, fumaca, estado "
            "FROM leituras ORDER BY id DESC LIMIT $1",
            1, NULL, params, NULL, NULL, 0);

        if (PQresultStatus(res) == PGRES_TUPLES_OK) {

            int n = PQntuples(res);

            for (int i = 0; i < n; i++) {

                if (i > 0) {
                    bufferPrintf(&b, ",");
                }

                bufferPrintf(&b, "{\"id\":%s,\"data_hora\":\"%s\","
                                 "\"temperatura\":",
                             PQgetvalue(res, i, 0),
                             PQgetvalue(res, i, 1));
                bufferJsonNumero(&b, res, i, 2);
                bufferPrintf(&b, ",\"umidade\":");
                bufferJsonNumero(&b, res, i, 3);
                bufferPrintf(&b, ",\"fumaca\":%s,\"estado\":\"%s\"}",
                             PQgetvalue(res, i, 4)[0] == 't'
                                 ? "true" : "false",
                             PQgetvalue(res, i, 5));
            }
        } else {
            fprintf(stderr, "Erro ao consultar leituras: %s",
                    PQerrorMessage(banco));
        }

        PQclear(res);
    }

    pthread_mutex_unlock(&mutexBanco);

    bufferPrintf(&b, "]");

    return b.buf;
}

static char *bancoListarEventos(int limite)
{
    Buffer b = {NULL, 0, 0};
    char lim[16];
    const char *params[1];
    PGresult *res;

    bufferPrintf(&b, "[");

    snprintf(lim, sizeof(lim), "%d", limite);
    params[0] = lim;

    pthread_mutex_lock(&mutexBanco);

    if (bancoConectar()) {

        res = PQexecParams(
            banco,
            "SELECT id, "
            "to_char(data_hora AT TIME ZONE 'America/Sao_Paulo', "
            "'YYYY-MM-DD HH24:MI:SS'), "
            "estado, mensagem "
            "FROM eventos ORDER BY id DESC LIMIT $1",
            1, NULL, params, NULL, NULL, 0);

        if (PQresultStatus(res) == PGRES_TUPLES_OK) {

            int n = PQntuples(res);

            for (int i = 0; i < n; i++) {

                if (i > 0) {
                    bufferPrintf(&b, ",");
                }

                bufferPrintf(&b, "{\"id\":%s,\"data_hora\":\"%s\","
                                 "\"estado\":\"%s\",\"mensagem\":\"%s\"}",
                             PQgetvalue(res, i, 0),
                             PQgetvalue(res, i, 1),
                             PQgetvalue(res, i, 2),
                             PQgetvalue(res, i, 3));
            }
        } else {
            fprintf(stderr, "Erro ao consultar eventos: %s",
                    PQerrorMessage(banco));
        }

        PQclear(res);
    }

    pthread_mutex_unlock(&mutexBanco);

    bufferPrintf(&b, "]");

    return b.buf;
}


static MHD_RESULT enviarJson(struct MHD_Connection *conexao,
                             unsigned int codigo, char *corpo)
{
    struct MHD_Response *resposta;
    MHD_RESULT ret;

    if (!corpo) {
        corpo = strdup("{\"erro\":\"sem memoria\"}");
        codigo = MHD_HTTP_INTERNAL_SERVER_ERROR;

        if (!corpo) {
            return MHD_NO;
        }
    }

    resposta = MHD_create_response_from_buffer(
        strlen(corpo), corpo, MHD_RESPMEM_MUST_FREE);

    if (!resposta) {
        free(corpo);
        return MHD_NO;
    }

    MHD_add_response_header(resposta, "Content-Type",
                            "application/json; charset=utf-8");
    MHD_add_response_header(resposta, "Access-Control-Allow-Origin", "*");

    ret = MHD_queue_response(conexao, codigo, resposta);
    MHD_destroy_response(resposta);

    return ret;
}

static char *jsonStatus(void)
{
    Buffer b = {NULL, 0, 0};
    DadosSensores d = obterDados();
    EstadoSistema e = obterEstado();

    bufferPrintf(&b, "{\"aquecendo\":%s,\"estado\":\"%s\","
                     "\"fumaca\":%s,\"leitura_valida\":%s,",
                 aquecendo ? "true" : "false",
                 nomeEstado(e),
                 d.fumaca ? "true" : "false",
                 d.leituraValida ? "true" : "false");

    if (d.leituraValida) {
        bufferPrintf(&b, "\"temperatura\":%.1f,\"umidade\":%.1f}",
                     d.temperatura, d.umidade);
    } else {
        bufferPrintf(&b, "\"temperatura\":null,\"umidade\":null}");
    }

    return b.buf;
}

static int lerLimite(struct MHD_Connection *conexao)
{
    const char *txt = MHD_lookup_connection_value(
        conexao, MHD_GET_ARGUMENT_KIND, "limite");

    if (!txt) {
        return LIMITE_PADRAO;
    }

    int v = atoi(txt);

    if (v < 1) {
        return LIMITE_PADRAO;
    }

    if (v > LIMITE_MAXIMO) {
        return LIMITE_MAXIMO;
    }

    return v;
}

static MHD_RESULT tratarRequisicao(void *cls,
                                   struct MHD_Connection *conexao,
                                   const char *url,
                                   const char *metodo,
                                   const char *versao,
                                   const char *upload,
                                   size_t *upload_tam,
                                   void **con_cls)
{
    (void)cls;
    (void)versao;
    (void)upload;
    (void)upload_tam;
    (void)con_cls;

    if (strcmp(metodo, "GET") != 0) {
        return enviarJson(conexao, MHD_HTTP_METHOD_NOT_ALLOWED,
                          strdup("{\"erro\":\"metodo nao permitido\"}"));
    }

    if (strcmp(url, "/health") == 0) {
        return enviarJson(conexao, MHD_HTTP_OK,
                          strdup("{\"ok\":true}"));
    }

    if (strcmp(url, "/status") == 0) {
        return enviarJson(conexao, MHD_HTTP_OK, jsonStatus());
    }

    if (strcmp(url, "/leituras") == 0) {
        return enviarJson(conexao, MHD_HTTP_OK,
                          bancoListarLeituras(lerLimite(conexao)));
    }

    if (strcmp(url, "/eventos") == 0) {
        return enviarJson(conexao, MHD_HTTP_OK,
                          bancoListarEventos(lerLimite(conexao)));
    }

    return enviarJson(conexao, MHD_HTTP_NOT_FOUND,
                      strdup("{\"erro\":\"rota nao encontrada\"}"));
}

static void escreverLed(bool r, bool g, bool b)
{
#if LED_ANODO_COMUM
#endif

    digitalWrite(PINO_LED_R, r ? HIGH : LOW);
    digitalWrite(PINO_LED_G, g ? HIGH : LOW);
    digitalWrite(PINO_LED_B, b ? HIGH : LOW);
}

static void ledAzul(void)
{
    escreverLed(false, false, true);
}

static void ledVerde(void)
{
    escreverLed(false, true, false);
}

static void ledAmarelo(void)
{
    escreverLed(true, true, false);
}

static void ledVermelho(void)
{
    escreverLed(true, false, false);
}

static void ledApagado(void)
{
    escreverLed(false, false, false);
}


static int lerDHT11Uma(float *umid, float *temp)
{
    uint8_t dadosDHT[5] = {0, 0, 0, 0, 0};
    uint8_t ultimoEstado = HIGH;
    uint8_t contador;
    uint8_t j = 0;
    int i;

    pinMode(PINO_DHT, OUTPUT);
    digitalWrite(PINO_DHT, LOW);
    delay(18);
    digitalWrite(PINO_DHT, HIGH);
    delayMicroseconds(40);
    pinMode(PINO_DHT, INPUT);

    for (i = 0; i < MAX_TIMINGS; i++) {
        contador = 0;

        while (digitalRead(PINO_DHT) == ultimoEstado) {
            contador++;
            delayMicroseconds(1);

            if (contador == 255) {
                break;
            }
        }

        ultimoEstado = digitalRead(PINO_DHT);

        if (contador == 255) {
            break;
        }

        if ((i >= 4) && (i % 2 == 0)) {
            dadosDHT[j / 8] <<= 1;

            if (contador > 16) {
                dadosDHT[j / 8] |= 1;
            }

            j++;
        }
    }

    if (j >= 40 &&
        dadosDHT[4] ==
        ((dadosDHT[0] + dadosDHT[1] +
          dadosDHT[2] + dadosDHT[3]) & 0xFF)) {

        *umid = (float)dadosDHT[0] + dadosDHT[1] / 10.0f;
        *temp = (float)dadosDHT[2] + dadosDHT[3] / 10.0f;

        return 0;
    }

    return -1;
}

static bool lerDHT11(float *umid, float *temp)
{
    int tentativa;

    for (tentativa = 0;
         tentativa < TENTATIVAS_DHT && executando;
         tentativa++) {

        if (lerDHT11Uma(umid, temp) == 0) {
            return true;
        }

        delay(100);
    }

    return false;
}

static bool condicaoDeAlerta(DadosSensores d)
{
    if (!d.leituraValida) {
        return false;
    }

    return (
        d.temperatura >= TEMP_MAXIMA ||
        d.umidade < UMID_MINIMA ||
        d.umidade > UMID_MAXIMA
    );
}


static void *threadSensores(void *arg)
{
    (void)arg;

    unsigned long ultimaLeituraDHT = millis();

    float temp = -1000.0f;
    float umid = -1000.0f;

    bool leituraValida = false;

    while (executando) {

        unsigned long agora = millis();

        if (agora - ultimaLeituraDHT >= INTERVALO_DHT_MS) {

            ultimaLeituraDHT = agora;

            if (lerDHT11(&umid, &temp)) {
                leituraValida = true;
            } else {
                fprintf(stderr,
                    "Falha ao ler o DHT11. Verifique a ligacao.\n");
            }
        }

        bool fumaca = digitalRead(PINO_MQ2) == NIVEL_DETECTADO;

        atualizarDados(temp, umid, leituraValida, fumaca);

        delay(INTERVALO_LOOP_MS);
    }

    return NULL;
}

static void *threadMonitoramento(void *arg)
{
    (void)arg;

    EstadoSistema estadoAnterior = -1;

    while (executando) {

        DadosSensores d = obterDados();

        EstadoSistema estado;

        if (d.fumaca) {
            estado = ESTADO_PERIGO;
        }
        else if (condicaoDeAlerta(d)) {
            estado = ESTADO_ATENCAO;
        }
        else {
            estado = ESTADO_NORMAL;
        }

        if (estado != estadoAnterior) {

            estadoAnterior = estado;

            definirEstado(estado);

            switch (estado) {

                case ESTADO_NORMAL:
                    ledVerde();
                    printf("[VERDE] Ambiente normal.\n");
                    bancoSalvarEvento(estado, "Ambiente normal.");
                    break;

                case ESTADO_ATENCAO:
                    ledAmarelo();
                    printf("[AMARELO] Atencao! Verifique o ambiente.\n");
                    bancoSalvarEvento(estado,
                        "Atencao! Verifique o ambiente.");
                    break;

                case ESTADO_PERIGO:
                    ledVermelho();
                    printf("[VERMELHO] PERIGO! Monoxido de carbono (CO) detectado.\n");
                    bancoSalvarEvento(estado,
                        "PERIGO! Monoxido de carbono (CO) detectado.");
                    break;
            }
        }

        delay(INTERVALO_LOOP_MS);
    }

    return NULL;
}

static void *threadRelatorio(void *arg)
{
    (void)arg;

    unsigned long ultimoSalvamento = millis();

    while (executando) {

        DadosSensores d = obterDados();

        if (d.leituraValida) {

            printf(
                "Temperatura: %.1f C | Umidade: %.1f %% | CO: %s\n",
                d.temperatura,
                d.umidade,
                d.fumaca ? "DETECTADO" : "normal"
            );

        } else {

            printf(
                "Temperatura: -- | Umidade: -- | CO: %s\n",
                d.fumaca ? "DETECTADO" : "normal"
            );
        }

        unsigned long agora = millis();

        if (agora - ultimoSalvamento >= INTERVALO_BANCO_MS) {
            ultimoSalvamento = agora;
            bancoSalvarLeitura(d, obterEstado());
        }

        delay(2000);
    }

    return NULL;
}


static void tratarSinal(int sinal)
{
    (void)sinal;
    executando = 0;
}


int main(void)
{
    pthread_t threadSensor;
    pthread_t threadMonitor;
    pthread_t threadLog;

    bool sensorCriado = false;
    bool monitorCriado = false;
    bool logCriado = false;

    signal(SIGINT, tratarSinal);
    signal(SIGTERM, tratarSinal);

    if (wiringPiSetupGpio() == -1) {
        fprintf(stderr, "Falha ao iniciar o wiringPi.\n");
        return 1;
    }

    if (sem_init(&semDados, 0, 1) != 0) {
        perror("Erro ao inicializar semaforo");
        return 1;
    }

    if (!bancoAbrir()) {
        fprintf(stderr,
            "Banco indisponivel. Seguindo e tentando reconectar depois.\n");
    }

    servidorHttp = MHD_start_daemon(
        MHD_USE_INTERNAL_POLLING_THREAD,
        PORTA_API,
        NULL, NULL,
        &tratarRequisicao, NULL,
        MHD_OPTION_END);

    if (!servidorHttp) {
        fprintf(stderr, "Falha ao iniciar a API na porta %d.\n",
                PORTA_API);
    } else {
        printf("API disponivel em http://0.0.0.0:%d\n", PORTA_API);
    }

    pinMode(PINO_MQ2, INPUT);

    pinMode(PINO_LED_R, OUTPUT);
    pinMode(PINO_LED_G, OUTPUT);
    pinMode(PINO_LED_B, OUTPUT);

    ledApagado();

    printf("Aquecendo o MQ-7 (aguarde alguns minutos)...\n");

    unsigned long inicio = millis();

    while (executando &&
           (millis() - inicio) < TEMPO_AQUECIMENTO_MS) {

        ledAzul();
        delay(500);

        ledApagado();
        delay(500);
    }

    aquecendo = 0;

    if (!executando) {
        goto encerramento;
    }


    if (pthread_create(&threadSensor, NULL,
                       threadSensores, NULL) != 0) {
        perror("Erro ao criar thread de sensores");
        goto encerramento;
    }

    sensorCriado = true;

    if (pthread_create(&threadMonitor, NULL,
                       threadMonitoramento, NULL) != 0) {
        perror("Erro ao criar thread de monitoramento");
        goto encerramento;
    }

    monitorCriado = true;

    if (pthread_create(&threadLog, NULL,
                       threadRelatorio, NULL) != 0) {
        perror("Erro ao criar thread de relatorio");
        goto encerramento;
    }

    logCriado = true;

    pthread_join(threadSensor, NULL);
    sensorCriado = false;

    pthread_join(threadMonitor, NULL);
    monitorCriado = false;

    pthread_join(threadLog, NULL);
    logCriado = false;

encerramento:

    executando = 0;

    if (sensorCriado) {
        pthread_join(threadSensor, NULL);
    }

    if (monitorCriado) {
        pthread_join(threadMonitor, NULL);
    }

    if (logCriado) {
        pthread_join(threadLog, NULL);
    }

    if (servidorHttp) {
        MHD_stop_daemon(servidorHttp);
    }

    ledApagado();

    bancoFechar();

    sem_destroy(&semDados);

    return 0;
}
