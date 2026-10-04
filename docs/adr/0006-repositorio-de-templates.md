# 0006 — Repositório de templates estilo plugins do Obsidian

- **Status:** Aceita (implementação na Fase 4)
- **Data:** 2026-10-04

## Contexto

Usuários devem poder navegar, instalar e publicar sistemas de RPG (templates) dentro do app, sem servidor pago e sem exigir conhecimento técnico.

## Decisão

- Um repositório público `community-templates` no GitHub contém um `index.json` (catálogo) e os arquivos `templates/<id>/<versão>.json`.
- O app lê o índice e baixa os templates via **CDN jsDelivr** (espelho gratuito do GitHub com cache global). Templates instalados ficam no banco local e funcionam offline.
- **Publicação sem Git:** o botão "Publicar na comunidade" abre um formulário de Issue já preenchido. Um GitHub Action valida o template (schema, ciclos de fórmula, tamanho, licença obrigatória) e abre o PR automaticamente. A moderação é a revisão do PR.
- Ao entrar numa mesa, o jogador recebe o template do Mestre pela própria conexão. Não precisa baixá-lo do repositório.

## Consequências

- Templates são **dados, não código**. Não há o risco de segurança de plugins executáveis.
- Publicar exige uma conta (gratuita) no GitHub.
- Templates de sistemas proprietários dependem da licença do sistema. O campo `license` é obrigatório, e conteúdo protegido (ex.: textos de livros) é recusado na revisão.
