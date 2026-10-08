# 0005 — Distribuição: app desktop Tauri + versão web

- **Status:** Aceita
- **Data:** 2026-10-04

## Contexto

O usuário deve executar **um único programa** (instalador ou executável), sem dependências externas. Jogadores convidados para uma mesa não deveriam ser obrigados a instalar nada.

## Decisão

- **Tauri 2** empacota o `apps/web` como app desktop (~10 MB, contra 100 MB+ do Electron).
- Releases no **GitHub Releases**, geradas pelo workflow `release.yml` ao publicar uma tag `v*`: instalador NSIS/MSI, executável portátil e pacotes Linux. Primeiro como rascunho, revisado antes de publicar.
- A **mesma build web** é publicada como site estático gratuito (GitHub Pages ou Cloudflare Pages) para quem prefere não instalar, e para macOS e celular.
- Atualização automática via updater do Tauri: o app baixa, confere a assinatura (chave pública na configuração; a privada só nos segredos do repositório) e instala. A v0.1.0 ainda não tinha o atualizador: quem a usa recebe o aviso de versão nova e instala a seguinte manualmente uma vez.

## Consequências e pendências

- **SmartScreen:** executáveis não assinados exibem "O Windows protegeu seu computador". Plano: solicitar assinatura gratuita à **SignPath Foundation** (exige repositório público e open source).
- **macOS:** notarização exige conta Apple paga (US$ 99/ano). Usuários de Mac usam a versão web até haver alternativa.
- O CI compila o Rust apenas quando `apps/desktop/**` muda, para economizar minutos de Actions.
