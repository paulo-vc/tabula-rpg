# 0008 — Lançar a v0.1 sem relay (apenas P2P)

- **Status:** Aceita. Altera a [ADR 0004](0004-sincronizacao.md) no ponto do relay de último recurso.
- **Data:** 2026-10-05

## Contexto

A ADR 0004 previa um relay de último recurso para as conexões em que o WebRTC direto falhasse, condicionado a um teste em redes reais. O protótipo [`tools/conn-test`](../../tools/conn-test/README.md) foi usado com:

- rede cabeada, Wi-Fi e **4G**;
- um participante **em outro estado**.

**Resultado:** todas as conexões diretas abriram e se mantiveram estáveis. Não houve nenhuma falha.

**Não testado:** os dois lados no 4G ao mesmo tempo (NAT restritivo dos dois lados) e redes corporativas ou escolares.

## Decisão

- A v0.1 sincroniza **apenas por P2P** (WebRTC com sinalização por relays Nostr públicos), **sem relay**.
- O transporte continua atrás da porta `SyncTransport`. Um relay pode ser adicionado depois como mais um adaptador, sem mudar o resto do app.
- Quando a conexão direta falhar, o app mostra uma **mensagem clara** (ex.: "não foi possível conectar; tente outra rede") em vez de ficar indefinidamente em "Conectando…".

## Consequências

- Custo zero e **nenhuma conta em serviço de terceiros**, para o mantenedor e para os usuários.
- Uma parte dos usuários, provavelmente pequena, não conseguirá conectar em redes muito restritivas. Se relatos reais mostrarem que o problema é relevante, reavaliamos o relay com os candidatos já levantados na ADR 0004.
- O teste de conexão fica no repositório como ferramenta de diagnóstico para esses casos.
