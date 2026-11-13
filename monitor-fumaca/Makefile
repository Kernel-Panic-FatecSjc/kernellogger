CC      = gcc
CFLAGS  = -Wall -Wextra -O2 -I$(shell pg_config --includedir 2>/dev/null || echo /usr/include/postgresql)
LIBS    = -lwiringPi -lpq -lmicrohttpd -lpthread
LIBS_SIM = -lpq -lmicrohttpd -lpthread

# Aquecimento do MQ-2 no modo simulado (ms)
AQUECIMENTO_SIM ?= 15000

monitor: monitor.c
	$(CC) $(CFLAGS) -o monitor monitor.c $(LIBS)

# Roda sem Raspberry Pi: GPIO e sensores simulados, banco e API reais.
simulacao: monitor-sim

monitor-sim: monitor.c gpio_simulado.h
	$(CC) $(CFLAGS) -DSIMULACAO -DTEMPO_AQUECIMENTO_MS=$(AQUECIMENTO_SIM)UL -o monitor-sim monitor.c $(LIBS_SIM)

clean:
	rm -f monitor monitor-sim

.PHONY: simulacao clean
