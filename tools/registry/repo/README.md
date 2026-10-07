# Sistemas da comunidade — Tabula RPG

Catálogo de sistemas de RPG (templates de ficha) feitos por jogadores para o
[Tabula RPG](https://github.com/paulo-vc/tabula-rpg). Os sistemas aparecem dentro do app,
em **Sistemas → Explorar comunidade**, e são instalados com um clique.

Sistemas são **dados, não código**: um arquivo JSON com campos, fórmulas e layout. Instalar
um sistema não executa nada no seu computador.

## Publicar um sistema

1. No app, abra **Sistemas** e clique em **Publicar** no sistema que você criou.
2. O app baixa o arquivo e abre o formulário de publicação. Arraste o arquivo para o campo
   **Arquivo do sistema**, escolha a licença e envie. É preciso uma conta gratuita no GitHub.
3. Uma verificação automática responde na issue em poucos minutos. Se houver problemas, a
   resposta explica cada um; corrija e edite a issue para verificar de novo.
4. Se estiver tudo certo, um pedido de inclusão é aberto automaticamente. Depois da revisão
   da moderação, o sistema aparece no app.

Para publicar uma **nova versão**, aumente a versão do sistema (ex.: de `1.0.0` para `1.1.0`)
e publique de novo. Só a conta que publicou a primeira versão pode publicar as seguintes.

## Regras

- **Licença obrigatória.** Ela diz como outras pessoas podem usar o seu sistema.
- **Sem conteúdo protegido.** Mecânicas podem ser descritas; textos copiados de livros
  (descrições de magias, monstros, regras) são recusados, salvo sob licença aberta como a
  OGL ou a CC-BY do SRD.
- **Versões publicadas não mudam.** Correções viram uma versão nova; quem já instalou é
  avisado da atualização dentro do app.
- O identificador (`id`) do sistema é único e pertence a quem o publicou primeiro.

## Estrutura

```
templates/<id>/<versão>.json   arquivo publicado (imutável)
templates/<id>/registro.json   dona do sistema e data de cada versão
index.json                     catálogo lido pelo app (gerado automaticamente)
scripts/tabula-registry.mjs    verificação, gerada a partir do repositório do app
```

O app baixa o catálogo e os arquivos pela CDN gratuita jsDelivr e confere o hash SHA-256
de cada arquivo antes de instalar.

## Moderação

Pedidos de inclusão são revisados à mão. A verificação automática já garante o formato, as
fórmulas, a licença, a posse do `id` e a versão; a revisão olha o conteúdo (licença
plausível, nada ofensivo, nada copiado). Pedidos feitos à mão (sem o formulário) passam
pelas mesmas verificações.

## Configuração do repositório (moderação)

- Criar a etiqueta `publicar`.
- Em **Settings → Actions → General**: _Workflow permissions_ = **Read and write** e marcar
  **Allow GitHub Actions to create and approve pull requests**.
- Se a `main` for protegida, permitir que o GitHub Actions grave nela (o workflow
  "Atualizar catálogo" grava o `index.json`).
