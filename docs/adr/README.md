# Registros de Decisão de Arquitetura (ADRs)

Cada decisão estrutural do projeto é registrada aqui, com contexto, alternativas e consequências.

| #                                        | Decisão                                             | Status                          |
| ---------------------------------------- | --------------------------------------------------- | ------------------------------- |
| [0001](0001-registrar-decisoes.md)       | Registrar decisões de arquitetura                   | Aceita                          |
| [0002](0002-stack-frontend.md)           | Stack de frontend, validação e testes               | Aceita                          |
| [0003](0003-local-first.md)              | Local-first com IndexedDB                           | Aceita                          |
| [0004](0004-sincronizacao.md)            | Sincronização P2P com relay de último recurso       | Aceita (relay adiado pela 0008) |
| [0005](0005-distribuicao.md)             | Distribuição: app desktop Tauri + versão web        | Aceita                          |
| [0006](0006-repositorio-de-templates.md) | Repositório de templates estilo plugins do Obsidian | Aceita                          |
| [0007](0007-fluxo-git.md)                | Fluxo de Git e proteção da `main`                   | Aceita                          |
| [0008](0008-lancar-sem-relay.md)         | Lançar a v0.1 sem relay (apenas P2P)                | Aceita                          |

## Como criar uma ADR

1. Copie o formato de uma ADR existente com o próximo número.
2. Abra um PR. A discussão acontece no PR.
3. ADRs aceitas não são editadas. Se a decisão mudar, crie uma nova ADR que **substitui** a anterior e atualize o status da antiga.
