# Lançamento da v0.1

Roteiro dos passos fora do código. A ordem importa: o repositório da comunidade e a versão web precisam existir antes de anunciar.

## 1. Repositório da comunidade (`paulo-vc/tabula-templates`)

O nome está fixo no app (`apps/web/src/app/registry.ts`).

```bash
gh repo create paulo-vc/tabula-templates --public --description "Sistemas da comunidade para o Tabula RPG"
gh repo clone paulo-vc/tabula-templates ../tabula-templates
pnpm --filter @tabula/registry export ../tabula-templates
cd ../tabula-templates
node scripts/tabula-registry.mjs add ../tabularium/packages/templates/community/dualidade.json paulo-vc
node scripts/tabula-registry.mjs index
git add -A && git commit -m "Esqueleto do repositório e Dualidade" && git push
gh label create publicar --color 5319e7 --description "Pedido de publicação de sistema"
gh api -X PUT repos/paulo-vc/tabula-templates/actions/permissions/workflow \
  -f default_workflow_permissions=write -F can_approve_pull_request_reviews=true
```

Conferir: `https://cdn.jsdelivr.net/gh/paulo-vc/tabula-templates@main/index.json` mostra a Dualidade, e "Explorar comunidade" no app a lista.

## 2. Tornar o repositório do app público

- O histórico foi verificado: sem tokens, chaves ou arquivos de ambiente. Os e-mails dos autores dos commits ficam visíveis.
- Depois de público, aplicar a proteção da `main` e ligar o GitHub Pages (por Actions):

```bash
gh repo edit paulo-vc/tabularium --visibility public --accept-visibility-change-consequences
gh api -X POST repos/paulo-vc/tabularium/rulesets --input .github/rulesets/main.json
gh api -X POST repos/paulo-vc/tabularium/pages -f build_type=workflow
gh workflow run pages.yml
```

Conferir: `https://paulo-vc.github.io/tabularium/` abre o app, e um convite gerado ali começa com esse endereço.

## 3. Release

```bash
git tag v0.1.0 && git push origin v0.1.0
```

O workflow `release.yml` gera um **rascunho** com o instalador do Windows (NSIS/MSI), o executável solto e os pacotes Linux. Antes de publicar o rascunho:

- [ ] Instalar no Windows e abrir (aceitar o aviso do SmartScreen).
- [ ] Sessão ao vivo **no app instalado**: Mestre no desktop, jogador na versão web, em redes diferentes. Inclui: o Mestre alterar a ficha, um campo secreto e uma rolagem.
- [ ] Instalar um sistema da comunidade no app instalado.
- [ ] Escrever as notas da versão (o que tem, limitações: sem relay; macOS só pela web).

Publicado o rascunho, o app desktop das próximas versões avisa sozinho quando houver atualização (consulta as releases do GitHub).

## 4. Depois do lançamento

- **Assinatura do Windows:** pedir à [SignPath Foundation](https://signpath.org/apply) (gratuito para projetos open source, exige o repositório público). Remove o aviso do SmartScreen.
- **Atualização automática:** feita (plugin updater do Tauri). A chave privada de assinatura fica nos segredos `TAURI_SIGNING_PRIVATE_KEY` e `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, com backup fora do computador: perdê-la impede atualizar quem já instalou. Releases deixam de ser pré-lançamento, porque o app procura a atualização em `releases/latest`.
- **Ordem Paranormal:** só com autorização da Jambô, ou como ficha "inspirada", com outro nome e sem textos dos livros.
- **Nome do repositório:** `tabula-rpg` passou a `tabularium` (2026-10-10). O GitHub redireciona o `git`, as páginas e os downloads das releases, então o desktop instalado continua achando as atualizações. O endereço da versão web mudou para `paulo-vc.github.io/tabularium` e o antigo **não** redireciona: convites gerados antes da mudança e apps web instalados pelo endereço antigo deixam de abrir. Nunca criar um repositório novo chamado `tabula-rpg`: isso desliga o redirecionamento do GitHub e quebra a atualização do desktop.

## Identificadores do app desktop

Mudar estes nomes tem efeito em quem já instalou:

- `identifier` (`tauri.conf.json`): define a pasta de dados (fichas, campanhas). **Nunca mudar.**
- `productName`: no Windows, define a pasta de instalação e a entrada em "Aplicativos instalados". Ao mudar de "Tabula RPG" para "Tabularium", a versão nova passou a se instalar **ao lado** da antiga, com os mesmos dados; o gancho `src-tauri/windows/hooks.nsh` remove a instalação antiga.
- Nome do pacote Rust (`Cargo.toml`): é o nome do executável. O instalador do Windows troca o executável e os atalhos sozinho; no Linux, o pacote `.deb`/`.rpm` (chamado `tabularium`) remove o arquivo antigo.

## v0.2.0

1. Mesclar o PR da versão (números de versão em `apps/web/package.json`, `tauri.conf.json` e `Cargo.toml`, e o [CHANGELOG](../CHANGELOG.md)).
2. Criar e enviar a tag:

```bash
git tag v0.2.0 && git push origin v0.2.0
```

3. O `release.yml` gera um **rascunho** com os instaladores assinados e o `latest.json`. Antes de publicar:
   - [ ] Instalar no Windows **por cima da v0.1.0** e conferir que fichas e campanhas continuam lá.
   - [ ] Na v0.1.0 instalada, conferir que o aviso de versão nova aparece e leva à página da release (a v0.1 não tem a atualização automática).
   - [ ] Sessão ao vivo no app instalado com um jogador na versão web (`paulo-vc.github.io/tabularium`): ficha, ordem de turno, rolagem.
   - [ ] Colar o trecho da v0.2.0 do CHANGELOG como notas da release.
4. Publicar o rascunho como versão normal (não pré-lançamento), para o `releases/latest` passar a apontar para ela.
5. Depois de publicada:
   - Mesclar o PR do `tabula-templates` com o nome novo e a verificação do formato novo.
   - Publicar a Dualidade 1.2.0 no `tabula-templates` (ela pede o app 0.2.0; quem está na v0.1 vê "requer app novo").
   - Na v0.3, conferir a primeira **atualização automática** de verdade (da v0.2.0 instalada para a seguinte).

## v0.2.1

Mesmo roteiro da v0.2.0 (tag `v0.2.1`, conferir o rascunho, publicar como versão normal), com duas conferências a mais:

- [ ] **Primeira atualização automática:** na v0.2.0 instalada, o app deve oferecer a v0.2.1 e se atualizar sozinho.
- [ ] **Windows com a v0.1 ainda instalada ao lado:** depois de instalar a v0.2.1, só o Tabularium aparece em "Aplicativos instalados", os atalhos "Tabula RPG" somem e as fichas continuam lá.

## v0.2.2

Mesmo roteiro (tag `v0.2.2`, conferir o rascunho, publicar como versão normal). O nome visível passa a "Tabularium RPG"; o `productName` continua "Tabularium" de propósito (ver "Identificadores do app desktop"), então a instalação não muda.

- [ ] Na v0.2.1 instalada, a atualização automática chega e o título da janela passa a "Tabularium RPG".

## v0.3.0

Mesmo roteiro (tag `v0.3.0`, conferir o rascunho, publicar como versão normal). O banco local passa para a v10 (tabelas novas do diário, das imagens e do chat; os dados existentes não mudam).

- [ ] Na v0.2.2 instalada, a atualização automática chega e as fichas e campanhas continuam lá.
- [ ] Sessão com o Mestre no app instalado e um jogador na versão web: diário compartilhado, cutscene (a imagem chega e abre em tela cheia) e chat (fala de personagem, `/me`, `/r` e um sussurro).

## v0.3.1

Correção da CSP do app desktop: `img-src` passa a aceitar `blob:`, que a galeria, a prévia e a cutscene usam para mostrar as imagens guardadas no aparelho. O teste `apps/web/src/lib/desktop-csp.test.ts` confere a CSP, porque o navegador e os testes não a aplicam.

- [ ] Na v0.3.0 instalada, a atualização chega, e as miniaturas da galeria e a cutscene do jogador aparecem.

## v0.3.2

Mesmo roteiro (tag `v0.3.2`, conferir o rascunho, publicar como versão normal). Sem mudança no banco local: o retrato fica na ficha e a capa na campanha.

- [ ] Na v0.3.1 instalada, a atualização chega, e as fichas e campanhas continuam lá.
- [ ] No app instalado, escolher um retrato e uma capa (a CSP do desktop precisa aceitar as imagens `data:`).
- [ ] Sessão entre o app instalado e a versão web: o Mestre vê o retrato da jogadora no card, e a jogadora recebe a capa.

## v0.3.3

Mesmo roteiro (tag `v0.3.3`, conferir o rascunho, publicar como versão normal). Sem mudança no banco local: as preferências de som ficam na tabela `settings`.

- [ ] Na v0.3.2 instalada, a atualização chega.
- [ ] No app instalado, o ícone de som do cabeçalho toca o "Testar" (o WebView do desktop precisa liberar o áudio depois do clique).
- [ ] Sessão com a ficha aberta: a vez no combate mostra "É a sua vez!" e toca; mensagens, sussurros e rolagens da mesa também tocam.

## v0.3.4

Mesmo roteiro (tag `v0.3.4`, conferir o rascunho, publicar como versão normal). Sem mudança no banco local. Permissão nova no desktop: `core:window:allow-request-user-attention` (piscar o ícone na barra de tarefas).

- [ ] Na v0.3.3 instalada, a atualização chega.
- [ ] Painel do Mestre: abas à esquerda, combate e rolagens à direita, e o convite se recolhendo quando um jogador entra.
- [ ] Com o app do jogador em outra janela, na vez dele: o título pisca e, no desktop, o ícone pisca na barra de tarefas.
- [ ] Um jogador que entra com o combate em andamento aparece em "Fora do combate" e entra na ordem.

## v0.3.5

Mesmo roteiro (tag `v0.3.5`, conferir o rascunho, publicar como versão normal). Sem mudança no banco local. D&D 5e vai para 1.5.0 e Lendas d20 para 1.4.0 (só o número do meio: as fichas se atualizam sozinhas).

- [ ] Na v0.3.4 instalada, a atualização chega, e as fichas abrem no sistema novo sem perder nada.
- [ ] Ficha de D&D: "Ataque" e "Ataque + dano" na aba Combate, com o som dos dados.
- [ ] Bônus: +2 de Força muda o modificador e as perícias; na sessão, o Mestre aplica uma maldição pela ficha do jogador e ela chega na hora.
