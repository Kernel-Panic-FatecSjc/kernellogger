/*
 * gpio_simulado.h — substitui o wiringPi quando o monitor é compilado com
 * -DSIMULACAO (make simulacao). Permite rodar o programa inteiro (threads,
 * banco, API) em qualquer Linux, sem Raspberry Pi e sem sensores.
 *
 * Os pinos de entrada ficam em HIGH (MQ-2 sem fumaça) até a rota /simular
 * mudar o valor. Os pinos de saída (LED) só guardam o último nível escrito.
 */
#ifndef GPIO_SIMULADO_H
#define GPIO_SIMULADO_H

#include <stdio.h>
#include <time.h>
#include <errno.h>

#define LOW    0
#define HIGH   1
#define INPUT  0
#define OUTPUT 1

#define SIM_PINOS 64

static volatile int simEntradas[SIM_PINOS];
static volatile int simSaidas[SIM_PINOS];
static struct timespec simInicio;

static inline int wiringPiSetupGpio(void)
{
    clock_gettime(CLOCK_MONOTONIC, &simInicio);
    for (int i = 0; i < SIM_PINOS; i++) {
        simEntradas[i] = HIGH;
        simSaidas[i] = LOW;
    }
    printf("[SIMULACAO] GPIO simulado: nenhum pino real sera acessado.\n");
    return 0;
}

static inline void pinMode(int pino, int modo)
{
    (void)pino;
    (void)modo;
}

static inline void digitalWrite(int pino, int valor)
{
    if (pino >= 0 && pino < SIM_PINOS) {
        simSaidas[pino] = valor ? HIGH : LOW;
    }
}

static inline int digitalRead(int pino)
{
    if (pino >= 0 && pino < SIM_PINOS) {
        return simEntradas[pino];
    }
    return LOW;
}

static inline void simDormir(unsigned long micros)
{
    struct timespec t = { (time_t)(micros / 1000000UL), (long)(micros % 1000000UL) * 1000L };
    while (nanosleep(&t, &t) == -1 && errno == EINTR) {
    }
}

static inline void delay(unsigned int ms)
{
    simDormir((unsigned long)ms * 1000UL);
}

static inline void delayMicroseconds(unsigned int us)
{
    simDormir(us);
}

static inline unsigned int millis(void)
{
    struct timespec agora;
    clock_gettime(CLOCK_MONOTONIC, &agora);
    return (unsigned int)((agora.tv_sec - simInicio.tv_sec) * 1000L +
                          (agora.tv_nsec - simInicio.tv_nsec) / 1000000L);
}

#endif
