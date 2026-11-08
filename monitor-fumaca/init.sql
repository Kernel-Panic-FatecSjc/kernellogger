CREATE TABLE IF NOT EXISTS leituras (
    id          BIGSERIAL PRIMARY KEY,
    data_hora   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    temperatura NUMERIC(5,1),
    umidade     NUMERIC(5,1),
    fumaca      BOOLEAN      NOT NULL,
    estado      VARCHAR(10)  NOT NULL
);

CREATE TABLE IF NOT EXISTS eventos (
    id          BIGSERIAL PRIMARY KEY,
    data_hora   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    estado      VARCHAR(10)  NOT NULL,
    mensagem    TEXT         NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_leituras_data ON leituras (data_hora DESC);
CREATE INDEX IF NOT EXISTS idx_eventos_data  ON eventos  (data_hora DESC);
