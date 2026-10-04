# Como contribuir

## Fluxo de trabalho

Usamos **GitHub Flow** ([ADR 0007](docs/adr/0007-fluxo-git.md)):

1. Crie uma branch a partir da `main` atualizada: `feat/…`, `fix/…`, `chore/…`, `docs/…`, `refactor/…` ou `test/…`.
2. Faça commits no formato [Conventional Commits](https://www.conventionalcommits.org/pt-br/):
   `feat(sync): adiciona fallback para relay`
3. Rode `pnpm check` localmente.
4. Abra um Pull Request. A `main` é protegida: só recebe código via PR com o CI verde, e o merge é feito por squash.

## Arquitetura

Leia [`docs/architecture.md`](docs/architecture.md) antes de contribuir. Em resumo:

- `packages/domain` contém apenas regras de negócio puras. O CI falha se ele importar React, IO ou outros pacotes do monorepo.
- Infraestrutura (banco, rede) implementa interfaces. Não acople regras de negócio a bibliotecas.
- Decisões estruturais novas viram uma ADR em `docs/adr/`.

## Testes

- Toda regra de domínio nova vem com teste unitário.
- Bugs corrigidos vêm com um teste que falhava antes da correção.
- `pnpm test` roda todos os pacotes.
