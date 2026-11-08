CC      = gcc
CFLAGS  = -Wall -Wextra -O2 -I$(shell pg_config --includedir 2>/dev/null || echo /usr/include/postgresql)
LIBS    = -lwiringPi -lpq -lmicrohttpd -lpthread

monitor: monitor.c
	$(CC) $(CFLAGS) -o monitor monitor.c $(LIBS)

clean:
	rm -f monitor
