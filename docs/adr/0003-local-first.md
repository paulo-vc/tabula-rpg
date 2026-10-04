# 0003 — Local-first com IndexedDB

- **Status:** Aceita
- **Data:** 2026-10-04

## Contexto

Não haverá servidor de banco de dados (restrição de custo zero). Os usuários precisam acessar suas fichas offline.

## Decisão

- O banco local (IndexedDB via **Dexie.js**) é a **fonte da verdade**. A UI reage a ele com `liveQuery`.
- A rede apenas sincroniza durante uma sessão de mesa (ver [0004](0004-sincronizacao.md)).
- Backup e portabilidade por **exportação JSON** com envelope versionado. Backup em nuvem do próprio usuário (Drive/Gist) é opcional e futuro.
- Todo dado importado passa por validação Zod antes de ser gravado.

## Consequências

- Dados do usuário nunca passam por servidores do projeto. Não há o que vazar nem o que pagar.
- Se o usuário limpar os dados do navegador ou trocar de máquina sem exportar, perde as fichas. O app deve incentivar a exportação ou backup (Fase 2).
- Na versão web, os dados ficam por origem (domínio). Ao migrar entre web e desktop, o caminho é exportar e importar.
