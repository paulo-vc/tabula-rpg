# Como contribuir

## Fluxo de trabalho

Usamos **GitHub Flow** ([ADR 0007](docs/adr/0007-fluxo-git.md)):

1. Crie uma branch a partir da `main` atualizada: `feat/…`, `fix/…`, `chore/…`, `docs/…`, `refactor/…` ou `test/…`.
2. Faça commits no formato [Conventional Commits](https://www.conventionalcommits.org/pt-br/):
   `feat(sync): adiciona fallback para relay`
3. Envie a branch. O hook de pre-push (instalado pelo `pnpm install`) recusa push direto para a `main` e roda `pnpm check` antes de cada push. Se o hook não estiver instalado, rode `pnpm run prepare`.
4. Abra um Pull Request. A `main` só recebe código via PR com o CI verde, e o merge é feito por squash.

## Arquitetura

Leia [`docs/architecture.md`](docs/architecture.md) antes de contribuir. Em resumo:

- `packages/domain` contém apenas regras de negócio puras. O CI falha se ele importar React, IO ou outros pacotes do monorepo.
- Infraestrutura (banco, rede) implementa interfaces. Não acople regras de negócio a bibliotecas.
- Decisões estruturais novas viram uma ADR em `docs/adr/`.

## Testes

- Toda regra de domínio nova vem com teste unitário.
- Bugs corrigidos vêm com um teste que falhava antes da correção.
- `pnpm test` roda todos os pacotes.
- `pnpm e2e` roda os testes de ponta a ponta (`apps/e2e`): o app de verdade, com Mestre e jogadores em navegadores separados. Na primeira vez, instale o navegador com `pnpm --filter @tabula/e2e exec playwright install chromium`. A rede dos testes é um relay local em vez de WebRTC + relays públicos (o app de teste é construído com `VITE_E2E_RELAY`; o build normal não inclui esse transporte). Fluxos novos da mesa ao vivo ganham um teste ali.
