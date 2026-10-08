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
  sync/        Motor da sessão: Yjs + protocolo Mestre/jogador sobre a porta SyncTransport.
apps/
  web/         Interface React. Também é o frontend do app desktop.
  desktop/     Shell Tauri que empacota o `web` como instalador/executável.
tools/
  conn-test/   Protótipo de teste de conexão P2P (Fase 3).
  registry/    Automação do repositório de sistemas da comunidade (CLI empacotada num
               único arquivo) e o esqueleto desse repositório (`repo/`).
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

### Motor da sessão (`packages/sync`)

- **Um documento Yjs por ficha**, sincronizado só entre o dono e o Mestre (`SessionClient` e `SessionHost`). Jogadores não recebem as fichas uns dos outros.
- **Protocolo binário** (lib0 + y-protocols): `HELLO` (papel, usuário, ficha), `SYNC` (por ficha) e `REJECT` (motivo). Tudo o que chega é validado; mensagens malformadas, grandes demais (> 512 KB) ou fora do schema são ignoradas sem quebrar a sessão.
- **O Mestre recusa** fichas de outro sistema, a tentativa de assumir a ficha de outro jogador e a entrada além do limite de jogadores.
- **Regra de correção:** a ficha local é a fonte da verdade do jogador, e o documento só recebe **a diferença**, **depois** de conhecer o estado mais recente (estado salvo ou a primeira troca com o Mestre). Escritas concorrentes no Yjs são desempatadas pelo ID aleatório do cliente; sem essa regra, um valor antigo venceria o novo em ~50% dos casos ao recarregar a página. Um teste de propriedade com sequências aleatórias de edições, quedas e reinícios garante a convergência.
- **Persistência entre sessões:** os dois lados exportam o estado do documento (`exportState`) para continuar de onde pararam.
- **O Mestre altera fichas (Fase 7):** o Mestre escreve no documento da ficha do jogador (`SessionHost.setValues`); o jogador aplica na ficha local o que chega, depois de validar contra o sistema (campos existentes, não calculados, não secretos, valor do tipo certo). Alterações feitas com o jogador offline ficam no documento do Mestre e chegam quando ele volta. Na primeira conexão sem estado salvo, a ficha local do jogador prevalece. Um teste de propriedade cobre sequências aleatórias de edições dos dois lados, quedas e recarregamentos: Mestre e jogador sempre terminam com a mesma ficha.
- **Campos secretos:** campos com `visibility: 'gm'` nunca entram no documento sincronizado. O jogador não os envia nem os vê na própria ficha; o Mestre guarda os valores só no aparelho dele (tabela `secretValues`, banco v5). Um campo visível não pode usar um secreto numa fórmula (`referencia-secreta`), senão o valor vazaria pelo cálculo.
- **Rolagens (Fase 7b):** notação de dados no domínio (`parseDice`/`rollDice`: `2d6+3`, `4d6kh3`, `2d20kl1`), com limites e sorteio injetado (criptográfico e sem viés no app). Quem rola sorteia; a rolagem vai ao Mestre (mensagem `LOG`), que a repassa à mesa e envia as recentes a quem entra no meio da sessão. Tudo o que chega é conferido (dados dentro das faces, somas certas, autor igual a quem enviou); rolagens secretas do Mestre não saem do aparelho dele. O registro fica no banco por campanha (tabela `rollLog`, banco v6, até 200 rolagens). O sistema define o dado dos testes (`checkDice`, padrão `1d20`): campos calculados com sinal ganham um botão que rola esse dado mais o valor.
- **Modelo de confiança (v0.1):** quem tem o convite entra na sala, porque o segredo cifra a troca de dados de conexão. O jogador só aceita como Mestre quem se apresenta com o `gmId` da campanha, mas essa identidade é declarada, não provada criptograficamente: alguém com o convite poderia se passar pelo Mestre. É aceitável entre amigos; uma assinatura do Mestre (chave pública no convite) fica para uma fase futura.

### Sessão ao vivo (`apps/web`)

- `LiveSessionManager` (camada de aplicação) liga o motor ao banco e ao transporte. Há **uma sessão por vez** por dispositivo, e ela continua ativa ao navegar entre telas, com um indicador no cabeçalho.
- **Mestre:** "Iniciar sessão" abre a sala. O painel mostra um card por jogador com os campos do `gmSummary` do template (PV com barra, CA, condições…), atualizado em tempo real, e indica quem está online.
- **Jogador:** "Entrar na sessão" usa a ficha vinculada. Qualquer alteração na ficha, em qualquer tela, segue para o Mestre (consulta reativa do Dexie → `SessionClient.update`).
- **Transporte real:** `@tabula/sync/webrtc` (Trystero + relays Nostr públicos). Sala = ID da campanha; senha = segredo da campanha.
- **Falha de conexão direta:** o app explica em linguagem clara (rede de empresa/escola, 4G dos dois lados) e sugere trocar de rede. Não há relay (ADR 0008).
- **Envio do sistema:** quem ainda não tem o sistema da campanha (e, por isso, ainda não tem ficha) clica em "Receber do Mestre". Um fluxo curto (`fetchTemplate`) entra na sala, pede o sistema (`TEMPLATE_REQUEST`) e o recebe (`TEMPLATE`), que passa pela mesma validação de um arquivo importado: schema, ciclos de fórmula, e não substituir nativo nem rebaixar versão (`FileService.installTemplate`). O Mestre responde no máximo uma vez por conexão a cada participante, e sistemas nativos não são enviados.
- **Continuidade:** o estado da sessão é salvo (com pausa de 2 s, ao encerrar e ao esconder a aba) e restaurado na próxima sessão. Recarregar a página **retoma a sessão** automaticamente (`sessionStorage`, só naquela aba).

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
- **Sistemas da comunidade:** o app lê o catálogo (`index.json`) e os arquivos pela CDN jsDelivr, com o GitHub direto como reserva. Cada arquivo é conferido pelo hash SHA-256 do catálogo e passa pela mesma validação de um arquivo importado (`parseTemplateFile`). As regras de publicação (`prepareSubmission`: licença, posse do `id`, versão maior) ficam no domínio e são as mesmas na automação do repositório. Ver [ADR 0006](adr/0006-repositorio-de-templates.md).
- **Criador de sistemas:** as operações de edição (`template/editing.ts`) são funções puras sobre o template; o rascunho fica no banco (tabela `drafts`, v4) a cada alteração, mesmo inválido, e só vira sistema instalado ao salvar, depois de `validateTemplate` (schema + regras). Renomear o apelido de um campo (ou de uma coluna de lista) reescreve as fórmulas que o usam; arrastar e soltar usa `moveNodeTo` e @dnd-kit (ponteiro, toque e teclado); salvar uma alteração sem mudar a versão aumenta a versão de correção, para que fichas e jogadores de campanhas recebam a atualização.
- **Layout da ficha:** o sistema decide a organização. Seções de primeiro nível podem ter uma `tab` (abas da ficha); `display` escolhe entre `padrao` (grade com rótulos), `compacto` (blocos de valor, como atributos) e `linhas` (cada grupo de `columns` campos numa linha, como perícias). Um campo pode ter um `secondary`, mostrado junto e pequeno (o valor do atributo sob o modificador). Os campos do card do Mestre (`gmSummary`) formam o painel fixo no topo, com dano e cura em um toque. Textos longos de itens de lista abrem por item, para a linha continuar curta.
- **Sistemas nativos e licenças:** só entram no app sistemas cuja licença permite uso em software e sem marcas de terceiros no nome: D&D 5e (SRD 5.1, CC-BY-4.0) e Lendas d20 (regras do Player Core sob a ORC License; "Pathfinder" é material reservado da Paizo e não aparece). Sistemas cuja licença não cobre claramente apps de ficha ficam em `packages/templates/community/`, prontos para o repositório da comunidade (ex.: Dualidade, compatível com o SRD do Daggerheart, sob a DPCGL). Os avisos exigidos pelas licenças ficam na descrição do sistema.
- **Domínio determinístico:** IDs e horários são injetados por quem chama; o domínio não usa `Date.now()`, aleatoriedade ou APIs do navegador/Node.

## Roadmap

| Fase  | Entrega                                                                                                                                                                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **0** | Fundação: monorepo, CI, regras de arquitetura, shell Tauri, pipeline de release, ADRs                                                                                                                                                      |
| **1** | Domínio: schemas Zod, avaliador de fórmulas, validação, testes                                                                                                                                                                             |
| **2** | Fichas locais: persistência, renderização a partir do template, D&D 5e (SRD), import/export                                                                                                                                                |
| **3** | **Mesa + sync em tempo real** (protótipo de teste de conexão primeiro). Primeira versão pública: **v0.1**                                                                                                                                  |
| **4** | Fórmulas avançadas: somas e contagens em listas, seleções com valor numérico, `is()`, efeitos temporários (D&D 5e 1.1.0)                                                                                                                   |
| **5** | Repositório de templates da comunidade: explorar, instalar e atualizar no app; publicar por formulário, sem Git                                                                                                                            |
| **6** | Criador visual de sistemas: campos, seções, fórmulas com validação ao digitar, prévia ao vivo, rascunhos e versões (6a); arrastar e soltar, duplicar, colunas de lista renomeáveis, desfazer agrupado e publicação a partir do editor (6b) |
| **7** | Mesa avançada: o Mestre edita fichas e campos secretos (7a); rolagens de dados e registro da sessão (7b)                                                                                                                                   |
