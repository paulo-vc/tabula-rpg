# Tabula RPG

Gerenciador de fichas de RPG de mesa com **visualização em tempo real para o Mestre**: gratuito, local-first e sem servidor pago.

> 🚧 Em desenvolvimento — Fase 0 (fundação). Veja o [roadmap](docs/architecture.md#roadmap).

## Funcionalidades planejadas

- Fichas para sistemas populares (D&D 5e SRD) e **sistemas próprios** criados no app
- **Mesa online:** o Mestre acompanha HP, recursos e inventário dos jogadores em tempo real
- Templates da comunidade instaláveis dentro do app (no estilo dos plugins do Obsidian)
- App desktop (instalador ou executável único) e versão web, sem precisar instalar nada
- Seus dados ficam no seu dispositivo. Sem contas, sem custos.

## Desenvolvimento

Pré-requisitos: **Node.js 24+** e **pnpm** (via `corepack enable pnpm`). Para o app desktop, também **Rust** ([rustup](https://rustup.rs)) e os [pré-requisitos do Tauri](https://tauri.app/start/prerequisites/).

```bash
pnpm install
pnpm dev            # app web em http://localhost:5173
pnpm desktop:dev    # app desktop (requer Rust)
pnpm check          # tudo que o CI verifica
```

## Documentação

- [Arquitetura](docs/architecture.md)
- [Decisões de arquitetura (ADRs)](docs/adr/README.md)
- [Como contribuir](CONTRIBUTING.md)

## Licença

[MIT](LICENSE)
