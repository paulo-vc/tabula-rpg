# 0007 — Fluxo de Git e proteção da `main`

- **Status:** Aceita
- **Data:** 2026-10-04

## Contexto

Exigência de que nada entre na `main` sem PR e testes aprovados. O projeto começa com um único mantenedor e entrega contínua.

## Decisão

- **GitHub Flow:** branches curtas a partir da `main`, com prefixos `feat/`, `fix/`, `chore/`, `docs/`, `refactor/`, `test/`.
- Mensagens no formato **Conventional Commits**.
- **`main` protegida por ruleset:** PR obrigatório, check de qualidade do CI obrigatório, branch atualizada antes do merge, sem push direto, sem force-push e sem exclusão. Merge por **squash**.
- Aprovações obrigatórias: **0** enquanto houver um único mantenedor (o GitHub não permite aprovar o próprio PR). Subir para 1 quando houver colaboradores.
- Versões publicadas por tags `vX.Y.Z` (SemVer).

## Alternativas consideradas

- **Git Flow** (`develop`, `release/*`, `hotfix/*`): cerimônia sem benefício enquanto não houver múltiplas versões mantidas em paralelo.

## Consequências

- Rulesets só são aplicados em repositórios privados com plano pago. **O repositório precisa ser público** para a proteção valer no plano gratuito (o que também é necessário para Actions sem limite de minutos e para a assinatura via SignPath).
