# 0007 — Fluxo de Git e proteção da `main`

- **Status:** Aceita
- **Data:** 2026-10-04

## Contexto

Exigência de que nada entre na `main` sem PR e testes aprovados. O projeto começa com um único mantenedor e entrega contínua.

O repositório permanece **privado até o lançamento**. No plano gratuito do GitHub, rulesets e proteção de branch **não são aplicados** em repositórios privados: podem ser criados, mas não bloqueiam nada.

## Decisão

- **GitHub Flow:** branches curtas a partir da `main`, com prefixos `feat/`, `fix/`, `chore/`, `docs/`, `refactor/`, `test/`.
- Mensagens no formato **Conventional Commits**.
- Merge por **squash**. Versões publicadas por tags `vX.Y.Z` (SemVer).

### Até o lançamento (repositório privado): proteção local

Um hook de **pre-push**, instalado automaticamente pelo `pnpm install` via `simple-git-hooks` (script em `scripts/pre-push.mjs`):

1. **Recusa push direto para a `main`.** Mudanças entram apenas por Pull Request.
2. **Roda `pnpm check`** antes de qualquer push. Código que falha em formatação, lint, tipos, arquitetura ou testes não chega ao GitHub.

O CI continua rodando em todo PR, mas não bloqueia o botão de merge. Não fazer merge com CI vermelho é responsabilidade de quem revisa.

### No lançamento (repositório público): proteção no servidor

Aplicar o ruleset versionado em `.github/rulesets/main.json`:

```bash
gh api repos/{owner}/{repo}/rulesets --method POST --input .github/rulesets/main.json
```

Ele exige PR, exige o check de qualidade do CI com a branch atualizada, bloqueia push direto, force-push e exclusão da `main`, e permite apenas squash. O hook local continua ativo como primeira barreira.

Aprovações obrigatórias: **0** enquanto houver um único mantenedor (o GitHub não permite aprovar o próprio PR). Subir para 1 quando houver colaboradores.

## Alternativas consideradas

- **Git Flow** (`develop`, `release/*`, `hotfix/*`): cerimônia sem benefício enquanto não houver múltiplas versões mantidas em paralelo.
- **Plano pago do GitHub para proteger o repositório privado:** viola a restrição de custo zero.
- **Tornar o repositório público desde já:** adiado por decisão do mantenedor até o lançamento.

## Consequências

- Antes do lançamento, a proteção é contra **acidentes**, não contra intenção: `git push --no-verify` pula o hook. Aceitável enquanto há um único mantenedor.
- Repositórios privados têm 2.000 minutos/mês de GitHub Actions grátis (minutos em Windows contam em dobro). Por isso o workflow de Rust só roda quando `apps/desktop/**` muda. No lançamento, o repositório público passa a ter minutos ilimitados.
- **Checklist de lançamento:** tornar o repositório público, aplicar o ruleset e solicitar a assinatura gratuita de executáveis à SignPath Foundation ([ADR 0005](0005-distribuicao.md)).
