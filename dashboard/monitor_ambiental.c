#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <stdbool.h>
#include <signal.h>
#include <pthread.h>
#include <semaphore.h>
#include <wiringPi.h>

#define PINO_DHT    4
#define PINO_MQ2    17
#define PINO_LED_R  27
#define PINO_LED_G  22
#define PINO_LED_B  23

#define LED_ANODO_COMUM 0
#define NIVEL_DETECTADO LOW

#define TEMPO_AQUECIMENTO_MS 20000UL
#define INTERVALO_DHT_MS     2000UL
#define INTERVALO_LOOP_MS    200UL
#define TENTATIVAS_DHT       5

#define TEMP_MAXIMA  35.0f
#define UMID_MINIMA  20.0f
#define UMID_MAXIMA  85.0f

#define MAX_TIMINGS 85

/* Endereco do dashboard (PC). Ajuste se o IP do PC mudar. */
#ifndef URL_SERVIDOR
#define URL_SERVIDOR "http://192.168.137.1:3000/api/leituras"
#endif
#define INTERVALO_ENVIO_MS 2000UL

static volatile sig_atomic_t executando = 1;

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

static DadosSensores obterDados(void)
{
    DadosSensores copia;

    sem_wait(&semDados);
    copia = dados;
    sem_post(&semDados);

    return copia;
}

static void atualizarDados(float temp, float umid,bool valida, bool fumaca)
{
    sem_wait(&semDados);

    dados.temperatura = temp;
    dados.umidade = umid;
    dados.leituraValida = valida;
    dados.fumaca = fumaca;

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
                    printf("[VERMELHO] PERIGO! Fumaca detectada.\n");
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
                "Temperatura: %.1f C | Umidade: %.1f %% | Fumaca: %s\n",
                d.temperatura,
                d.umidade,
                d.fumaca ? "DETECTADA" : "normal"
            );

        } else {

            printf(
                "Temperatura: -- | Umidade: -- | Fumaca: %s\n",
                d.fumaca ? "DETECTADA" : "normal"
            );
        }

        delay(2000);
    }

    return NULL;
}

/* Envia as leituras ao dashboard via curl (sem dependencias extras).
 * shortcut: popen+curl a cada envio, bom para 1 leitura/2s; usar libcurl se precisar de mais. */
static void *threadEnvio(void *arg)
{
    (void)arg;

    while (executando) {

        DadosSensores d = obterDados();
        char cmd[512];

        if (d.leituraValida) {
            snprintf(cmd, sizeof cmd,
                "curl -s -m 2 -o /dev/null -X POST -H 'Content-Type: application/json' "
                "-d '{\"temperatura\":%.1f,\"umidade\":%.1f,\"fumaca\":%s}' '%s'",
                d.temperatura, d.umidade,
                d.fumaca ? "true" : "false", URL_SERVIDOR);
        } else {
            snprintf(cmd, sizeof cmd,
                "curl -s -m 2 -o /dev/null -X POST -H 'Content-Type: application/json' "
                "-d '{\"temperatura\":null,\"umidade\":null,\"fumaca\":%s}' '%s'",
                d.fumaca ? "true" : "false", URL_SERVIDOR);
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

    pinMode(PINO_MQ2, INPUT);

    pinMode(PINO_LED_R, OUTPUT);
    pinMode(PINO_LED_G, OUTPUT);
    pinMode(PINO_LED_B, OUTPUT);

    ledApagado();

    printf("Aquecendo o MQ-2...\n");

    unsigned long inicio = millis();

    while (executando &&
           (millis() - inicio) < TEMPO_AQUECIMENTO_MS) {

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
