#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <stdbool.h>
#include <ctype.h>
#include <string.h>
#include <signal.h>
#include <pthread.h>
#include <semaphore.h>
#include <wiringPi.h>

#define PINO_DHT    24
#define PINO_MQ7    17
#define PINO_LED_R  27
#define PINO_LED_G  22
#define PINO_LED_B  23

#define LED_ANODO_COMUM 0
#define NIVEL_MQ7_ATIVO LOW

#define TEMPO_ESTABILIZACAO_MS 180000UL
#define INTERVALO_DHT_MS     2000UL
#define INTERVALO_LOOP_MS    200UL
#define TENTATIVAS_DHT       5

#define TEMP_MAXIMA  35.0f
#define UMID_MINIMA  20.0f
#define UMID_MAXIMA  85.0f

/* Endereco do dashboard no mesmo Raspberry Pi. */
#ifndef URL_SERVIDOR
#define URL_SERVIDOR "http://127.0.0.1:3000/api/leituras"
#endif
#define INTERVALO_ENVIO_MS 2000UL

static volatile sig_atomic_t executando = 1;

static sem_t semDados;

typedef struct {
    float temperatura;
    float umidade;
    bool leituraValida;
    bool mq7Ativo;
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
    ESTADO_PERIGO,
    ESTADO_SEM_DADOS
} EstadoSistema;

static DadosSensores obterDados(void)
{
    DadosSensores copia;

    sem_wait(&semDados);
    copia = dados;
    sem_post(&semDados);

    return copia;
}

static void atualizarDados(float temp, float umid,
                           bool valida, bool mq7Ativo)
{
    sem_wait(&semDados);

    dados.temperatura = temp;
    dados.umidade = umid;
    dados.leituraValida = valida;
    dados.mq7Ativo = mq7Ativo;

    sem_post(&semDados);
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

static bool aguardarNivelDHT(int nivel, unsigned int timeoutUs)
{
    unsigned int inicio = micros();

    while (digitalRead(PINO_DHT) != nivel) {
        if ((unsigned int)(micros() - inicio) >= timeoutUs) {
            return false;
        }
    }

    return true;
}

static int lerDHT11Uma(float *umid, float *temp)
{
    uint8_t dadosDHT[5] = {0, 0, 0, 0, 0};
    unsigned int inicioPulso;
    unsigned int duracaoPulso;
    int bit;

    pinMode(PINO_DHT, OUTPUT);
    digitalWrite(PINO_DHT, LOW);
    delay(18);
    digitalWrite(PINO_DHT, HIGH);
    delayMicroseconds(30);
    pinMode(PINO_DHT, INPUT);

    if (!aguardarNivelDHT(LOW, 250) ||
        !aguardarNivelDHT(HIGH, 250) ||
        !aguardarNivelDHT(LOW, 250)) {
        return -1;
    }

    for (bit = 0; bit < 40; bit++) {
        if (!aguardarNivelDHT(HIGH, 150)) {
            return -1;
        }

        inicioPulso = micros();
        if (!aguardarNivelDHT(LOW, 150)) {
            return -1;
        }

        duracaoPulso = (unsigned int)(micros() - inicioPulso);
        dadosDHT[bit / 8] <<= 1;
        if (duracaoPulso > 40) {
            dadosDHT[bit / 8] |= 1;
        }
    }

    if (dadosDHT[4] ==
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
                leituraValida = false;
                fprintf(stderr,
                    "Falha ao ler o DHT11. Verifique a ligacao.\n");
            }
        }

        bool mq7Ativo = digitalRead(PINO_MQ7) == NIVEL_MQ7_ATIVO;

        atualizarDados(temp, umid, leituraValida, mq7Ativo);

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

        if (d.mq7Ativo) {
            estado = ESTADO_PERIGO;
        }
        else if (!d.leituraValida) {
            estado = ESTADO_SEM_DADOS;
        }
        else if (condicaoDeAlerta(d)) {
            estado = ESTADO_ATENCAO;
        }
        else {
            estado = ESTADO_NORMAL;
        }

        if (estado != estadoAnterior) {

            estadoAnterior = estado;

            switch (estado) {

                case ESTADO_NORMAL:
                    ledVerde();
                    printf("[VERDE] Ambiente normal.\n");
                    break;

                case ESTADO_ATENCAO:
                    ledAmarelo();
                    printf("[AMARELO] Atencao! Verifique o ambiente.\n");
                    break;

                case ESTADO_PERIGO:
                    ledVermelho();
                    printf("[VERMELHO] Saida digital do MQ-7 ativada.\n");
                    break;

                case ESTADO_SEM_DADOS:
                    ledAmarelo();
                    printf("[AMARELO] Sem leitura valida do DHT11.\n");
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

    while (executando) {

        DadosSensores d = obterDados();

        if (d.leituraValida) {

            printf(
                "Temperatura: %.1f C | Umidade: %.1f %% | MQ-7 digital: %s\n",
                d.temperatura,
                d.umidade,
                d.mq7Ativo ? "ATIVO" : "inativo"
            );

        } else {

            printf(
                "Temperatura: -- | Umidade: -- | MQ-7 digital: %s\n",
                d.mq7Ativo ? "ATIVO" : "inativo"
            );
        }

        delay(2000);
    }

    return NULL;
}

static bool tokenSeguro(const char *token)
{
    size_t i;

    if (!token || !*token || strlen(token) > 128) {
        return false;
    }

    for (i = 0; token[i]; i++) {
        unsigned char caractere = (unsigned char)token[i];

        if (!isalnum(caractere) && caractere != '-' && caractere != '_' &&
            caractere != '.') {
            return false;
        }
    }

    return true;
}

/* Envia as leituras ao dashboard via curl (sem dependencias extras).
 * shortcut: popen+curl a cada envio, bom para 1 leitura/2s; usar libcurl se precisar de mais. */
static void *threadEnvio(void *arg)
{
    (void)arg;

    while (executando) {

        DadosSensores d = obterDados();
        const char *token = getenv("INGEST_TOKEN");
        char cmd[512];

        if (!tokenSeguro(token)) {
            fprintf(stderr, "INGEST_TOKEN ausente ou invalido.\n");
            delay(INTERVALO_ENVIO_MS);
            continue;
        }

        if (d.leituraValida) {
            snprintf(cmd, sizeof cmd,
                "curl -fsS -m 2 -o /dev/null -X POST -H 'Content-Type: application/json' "
                "-H 'Authorization: Bearer %s' "
                "-d '{\"temperatura\":%.1f,\"umidade\":%.1f,\"mq7_alarme\":%s}' '%s'",
                token,
                d.temperatura, d.umidade,
                d.mq7Ativo ? "true" : "false", URL_SERVIDOR);
        } else {
            snprintf(cmd, sizeof cmd,
                "curl -fsS -m 2 -o /dev/null -X POST -H 'Content-Type: application/json' "
                "-H 'Authorization: Bearer %s' "
                "-d '{\"temperatura\":null,\"umidade\":null,\"mq7_alarme\":%s}' '%s'",
                token, d.mq7Ativo ? "true" : "false", URL_SERVIDOR);
        }

        if (system(cmd) != 0) {
            fprintf(stderr, "Falha ao enviar ao servidor (%s).\n", URL_SERVIDOR);
        }

        delay(INTERVALO_ENVIO_MS);
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
    pthread_t threadNet;

    bool sensorCriado = false;
    bool monitorCriado = false;
    bool logCriado = false;
    bool netCriado = false;

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

    pinMode(PINO_MQ7, INPUT);

    pinMode(PINO_LED_R, OUTPUT);
    pinMode(PINO_LED_G, OUTPUT);
    pinMode(PINO_LED_B, OUTPUT);

    ledApagado();

    printf("Aguardando estabilizacao inicial do MQ-7...\n");

    unsigned long inicio = millis();

    while (executando &&
           (millis() - inicio) < TEMPO_ESTABILIZACAO_MS) {

        ledAzul();
        delay(500);

        ledApagado();
        delay(500);
    }

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

    if (pthread_create(&threadNet, NULL,
                       threadEnvio, NULL) != 0) {
        perror("Erro ao criar thread de envio");
        goto encerramento;
    }

    netCriado = true;

    if (sensorCriado) {
        pthread_join(threadSensor, NULL);
    }

    if (monitorCriado) {
        pthread_join(threadMonitor, NULL);
    }

    if (logCriado) {
        pthread_join(threadLog, NULL);
    }

    if (netCriado) {
        pthread_join(threadNet, NULL);
    }

encerramento:

    executando = 0;

    ledApagado();

    sem_destroy(&semDados);

    return 0;
}
