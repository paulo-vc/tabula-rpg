# Arquitetura do Tabula RPG

> Documento vivo. Decisões individuais e seus motivos ficam em [`docs/adr/`](adr/). Este arquivo é a visão geral.

## Visão do produto

Aplicação para criar e gerenciar fichas de RPG de mesa, com foco na **mesa online**: o Mestre acompanha em tempo real as fichas dos jogadores (HP, recursos, inventário, condições).

**Restrições inegociáveis**

1. **Custo zero para todos**: nem o mantenedor nem os usuários pagam por infraestrutura, e nenhum usuário precisa configurar roteador ou instalar programas externos.
2. **Um único programa**: instalador ou executável portátil. A mesma aplicação também roda no navegador, para quem não quer instalar nada.
3. **Intuitivo para o usuário comum**: conexão, sincronização e formatos de arquivo são detalhes invisíveis.
4. **Local-first**: os dados vivem no dispositivo do usuário. A rede serve apenas para sincronizar durante a sessão.

## Camadas

```
packages/
  domain/      Regras de negócio puras (template, ficha, campanha, fórmulas) e portas
               de repositório. TS + Zod. Sem IO.
  storage/     Repositórios em IndexedDB (Dexie) que implementam as portas do domínio.
  templates/   Templates nativos em JSON (D&D 5e SRD), validados ao carregar.
  sync/        (Fase 3) Yjs + transportes (WebRTC P2P, relay de último recurso).
apps/
  web/         Interface React. Também é o frontend do app desktop.
  desktop/     Shell Tauri que empacota o `web` como instalador/executável.
```

Regras de dependência, verificadas no CI por `dependency-cruiser` (`pnpm depcheck`):

- `domain` não depende de nenhum outro pacote do monorepo, nem de React ou IO.
- Pacotes em `packages/` nunca importam de `apps/`.
- Ciclos de importação são proibidos.
- Páginas e componentes do `web` acessam dados só pelos serviços (`apps/web/src/app`), nunca pelo banco diretamente.

### Dentro do `apps/web`

```
src/
  app/          Camada de aplicação (casos de uso), sem React:
                TemplateCatalog (nativos + instalados), SheetService (criar, abrir/migrar,
                editar, duplicar, excluir), FileService (importar/exportar) e a raiz de
                composição `createServices`, que liga as portas às implementações.
  pages/        Telas: lista de fichas, ficha, sistemas.
  components/   Componentes; `sheet/` renderiza qualquer template a partir do layout.
  components/ui Componentes base do shadcn/ui.
```

- **Edição otimista:** o valor e os campos calculados mudam na hora. A gravação no banco espera uma pausa curta, por campo, e é feita também ao sair da página ou esconder a aba. Cliques rápidos (ex.: "+" no HP) nunca se perdem.
- **Gravação atômica por campo** (`SheetRepository.update`): editar um campo não sobrescreve outro alterado ao mesmo tempo, o que prepara a sincronização da Fase 3.
- **Rotas com hash** (`#/fichas/…`): funcionam sem configuração de servidor no GitHub Pages e no app desktop. O build usa caminhos relativos e é um PWA instalável e offline (desativado dentro do Tauri).

Infraestrutura (persistência, rede) implementa **portas** (interfaces) definidas no domínio (`TemplateRepository`, `SheetRepository`). Os repositórios validam os dados de novo antes de gravar, como defesa em profundidade. Templates nativos não são gravados no banco: vêm do próprio app, e o banco guarda apenas templates da comunidade e locais (um por `id`, na versão mais recente). Isso permite trocar Dexie, o transporte de sync ou o provedor de relay sem tocar nas regras de negócio.

## Stack

| Camada                  | Escolha                                                        | ADR                                          |
| ----------------------- | -------------------------------------------------------------- | -------------------------------------------- |
| Linguagem               | TypeScript strict                                              | [0002](adr/0002-stack-frontend.md)           |
| UI                      | React 19 + Vite + Tailwind v4 (+ shadcn/ui a partir da Fase 2) | [0002](adr/0002-stack-frontend.md)           |
| Validação / schemas     | Zod                                                            | [0002](adr/0002-stack-frontend.md)           |
| Persistência            | Dexie.js (IndexedDB)                                           | [0003](adr/0003-local-first.md)              |
| Sync                    | Yjs + WebRTC P2P + relay de último recurso                     | [0004](adr/0004-sincronizacao.md)            |
| Desktop                 | Tauri 2                                                        | [0005](adr/0005-distribuicao.md)             |
| Templates da comunidade | Repositório GitHub + índice JSON + CDN jsDelivr                | [0006](adr/0006-repositorio-de-templates.md) |
| Testes                  | Vitest, Testing Library, Playwright, fast-check                | [0002](adr/0002-stack-frontend.md)           |

## Sincronização (resumo)

Topologia em estrela: jogadores conectam-se **somente ao Mestre**, que atua como host da sessão. A conexão é **WebRTC direto** (inclui IPv6 e hole punching via STUN público), com sinalização por relays Nostr públicos. Não há relay na v0.1 ([ADR 0008](adr/0008-lancar-sem-relay.md)): o teste em redes reais não teve nenhuma falha. O transporte fica atrás da porta `SyncTransport`, e um relay pode ser acrescentado depois sem mudar o resto do app.

A sincronização existe apenas enquanto a sessão está aberta. Edições offline são mescladas na reconexão (CRDT). Detalhes e alternativas descartadas estão na [ADR 0004](adr/0004-sincronizacao.md).

### Campanhas e convites

- Cada dispositivo guarda **a sua cópia** da campanha. O Mestre a cria; o jogador a recebe pelo convite. O papel é derivado de `gmId` comparado ao ID do dispositivo.
- A campanha tem um **segredo de 128 bits** que cifrará a sessão. O convite (id, nome, Mestre, sistema e segredo) vai codificado em base64url **depois do `#`** do link, a parte que os navegadores nunca enviam a servidores.
- O link usa o endereço público do app (`VITE_PUBLIC_URL` no build, ou o endereço atual quando é um site). No app desktop não há endereço público, e o convite é compartilhado como **código** para colar em "Entrar com convite".
- O jogador vincula uma ficha do **sistema da campanha** (existente ou nova). Versões diferentes do mesmo sistema são aceitas, porque a migração resolve ao abrir a ficha.

## Modelo de dados (resumo)

Implementado em `packages/domain`:

- **Não há diferença estrutural entre template nativo e customizado.** Ambos são `SystemTemplate`, distinguidos por `source` (`builtin`, `community`, `local`).
- **Estrutura ≠ apresentação:** `fields` define o que existe; `layouts` define onde aparece (`full`, `compact` e `gmSummary`, o card do painel do Mestre).
- **Definição ≠ valor:** fichas guardam apenas `values`, indexados por **ID estável de campo** (nunca pelo rótulo).
- **Tipos de campo:** `number`, `text`, `longtext`, `boolean`, `select` (simples ou múltiplo), `dice`, `resource` (atual/máximo/temporário, ex.: HP), `computed` e `list` (itens com campos próprios, ex.: inventário).
- **Campos calculados não são persistidos.** São derivados de [fórmulas](formulas.md) avaliadas por um parser próprio (sem `eval`), em ordem topológica. Ciclos são detectados ao compilar o template.
- **Compilar uma vez, avaliar muitas:** `compileTemplate` valida as regras semânticas (unicidade, referências, ciclos, layout) e pré-processa as fórmulas. `computeDerived` recalcula a ficha a cada alteração.
- **Migração sem perda:** ao atualizar o template, `migrateSheet` preserva valores compatíveis, preenche campos novos e guarda os removidos em `orphaned`, restaurando-os se o campo voltar.
- **Fronteira de confiança:** todo arquivo externo entra por `parseExport`, que verifica tamanho (2 MB), JSON, versão do formato, schema Zod, limites de tamanho, IDs reservados (contra poluição de protótipo) e regras semânticas do template.
- **Domínio determinístico:** IDs e horários são injetados por quem chama; o domínio não usa `Date.now()`, aleatoriedade ou APIs do navegador/Node.

## Roadmap

| Fase  | Entrega                                                                                                   |
| ----- | --------------------------------------------------------------------------------------------------------- |
| **0** | Fundação: monorepo, CI, regras de arquitetura, shell Tauri, pipeline de release, ADRs                     |
| **1** | Domínio: schemas Zod, avaliador de fórmulas, validação, testes                                            |
| **2** | Fichas locais: persistência, renderização a partir do template, D&D 5e (SRD), import/export               |
| **3** | **Mesa + sync em tempo real** (protótipo de teste de conexão primeiro). Primeira versão pública: **v0.1** |
| **4** | Repositório de templates da comunidade, com instalação dentro do app                                      |
| **5** | Criador visual de sistemas, com "Publicar na comunidade"                                                  |
| **6** | Mesa avançada: Mestre edita fichas, campos secretos, rolagens, log da sessão                              |
