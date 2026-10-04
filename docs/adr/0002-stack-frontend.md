# 0002 — Stack de frontend, validação e testes

- **Status:** Aceita
- **Data:** 2026-10-04

## Contexto

Aplicação de complexidade média-leve, com editor visual de layouts (drag-and-drop) previsto, que precisa rodar no navegador e empacotada como desktop.

## Decisão

| Área         | Escolha                                                                                            | Motivo                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Linguagem    | TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)                       | Os tipos do domínio são o contrato central do app.                         |
| UI           | React 19 + Vite                                                                                    | Maior ecossistema (dnd-kit, Radix), build rápido.                          |
| Estilo       | Tailwind v4 + shadcn/ui                                                                            | Componentes acessíveis copiados para o projeto, sem lib pesada em runtime. |
| Estado de UI | Zustand                                                                                            | Mínimo. Só estado efêmero; dados persistidos vêm do banco local.           |
| Validação    | Zod                                                                                                | Fonte única para tipos, validação de import e JSON Schema público.         |
| Monorepo     | pnpm workspaces                                                                                    | Camadas como pacotes, com fronteiras verificáveis.                         |
| Testes       | Vitest + Testing Library; Playwright (E2E com dois contextos para sync); fast-check (propriedades) | Unidade, integração e convergência de CRDT.                                |
| Qualidade    | ESLint (typescript-eslint strict), Prettier, dependency-cruiser                                    | Regras de arquitetura falham o CI.                                         |

**TypeScript fixado em 6.0.x**: o TypeScript 7 (compilador nativo) ainda não é suportado pelo typescript-eslint. Reavaliar quando houver suporte.

## Alternativas consideradas

- **Svelte / Solid:** bundles menores, mas ecossistema menor para drag-and-drop e componentes acessíveis.
- **Redux:** cerimônia desnecessária para estado de UI efêmero.

## Consequências

- Bundle inicial maior que com Svelte (~70 kB gzip só com React). Aceitável para um app instalável e offline.
