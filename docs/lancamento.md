# Lançamento da v0.1

Roteiro dos passos fora do código. A ordem importa: o repositório da comunidade e a versão web precisam existir antes de anunciar.

## 1. Repositório da comunidade (`paulo-vc/tabula-templates`)

O nome está fixo no app (`apps/web/src/app/registry.ts`).

```bash
gh repo create paulo-vc/tabula-templates --public --description "Sistemas da comunidade para o Tabula RPG"
gh repo clone paulo-vc/tabula-templates ../tabula-templates
pnpm --filter @tabula/registry export ../tabula-templates
cd ../tabula-templates
node scripts/tabula-registry.mjs add ../tabula-rpg/packages/templates/community/dualidade.json paulo-vc
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
gh repo edit paulo-vc/tabula-rpg --visibility public --accept-visibility-change-consequences
gh api -X POST repos/paulo-vc/tabula-rpg/rulesets --input .github/rulesets/main.json
gh api -X POST repos/paulo-vc/tabula-rpg/pages -f build_type=workflow
gh workflow run pages.yml
```

Conferir: `https://paulo-vc.github.io/tabula-rpg/` abre o app, e um convite gerado ali começa com esse endereço.

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
