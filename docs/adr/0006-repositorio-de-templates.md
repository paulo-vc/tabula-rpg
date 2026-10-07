# 0006 — Repositório de templates estilo plugins do Obsidian

- **Status:** Aceita, implementada na Fase 5 (as fórmulas avançadas vieram antes, para estabilizar a linguagem)
- **Data:** 2026-10-04

## Contexto

Usuários devem poder navegar, instalar e publicar sistemas de RPG (templates) dentro do app, sem servidor pago e sem exigir conhecimento técnico.

## Decisão

- Um repositório público `tabula-templates` no GitHub contém os arquivos `templates/<id>/<versão>.json` (imutáveis), um `templates/<id>/registro.json` por sistema (conta dona e data de cada versão) e o `index.json` (catálogo).
- O `index.json` é **gerado** a partir dos arquivos quando algo entra na `main`, nunca editado à mão nem incluído nos pedidos de inclusão: assim, pedidos simultâneos não entram em conflito. O catálogo traz o hash SHA-256 e o tamanho de cada versão.
- O app lê o catálogo e baixa os templates via **CDN jsDelivr** (espelho gratuito do GitHub com cache global; o workflow limpa o cache do catálogo a cada publicação), com o GitHub direto como reserva. O arquivo só é instalado se o hash conferir. Templates instalados ficam no banco local e funcionam offline.
- **Publicação sem Git:** o botão "Publicar" baixa o arquivo do sistema e abre o formulário de Issue já preenchido; o usuário arrasta o arquivo e escolhe a licença. Um GitHub Action valida o template (schema, fórmulas, tamanho, licença obrigatória, posse do `id`, versão maior que a publicada) com as mesmas regras do app, responde na issue e abre o PR automaticamente. A moderação é a revisão do PR.
- **Posse do `id`:** a conta do GitHub que publica a primeira versão é a dona do sistema; só ela publica as seguintes.
- A automação é uma CLI do monorepo (`tools/registry`), empacotada num único `.mjs` sem dependências e copiada para o repositório da comunidade (`pnpm --filter @tabula/registry export <pasta>`).
- Templates podem exigir uma versão mínima do app (`minAppVersion`); o app recusa instalar se for mais antigo.
- Ao entrar numa mesa, o jogador recebe o template do Mestre pela própria conexão. Não precisa baixá-lo do repositório.

## Consequências

- Templates são **dados, não código**. Não há o risco de segurança de plugins executáveis.
- Publicar exige uma conta (gratuita) no GitHub.
- Templates de sistemas proprietários dependem da licença do sistema. O campo `license` é obrigatório, e conteúdo protegido (ex.: textos de livros) é recusado na revisão.
