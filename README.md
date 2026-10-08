# Tabula RPG

Fichas de RPG de mesa com **sessão ao vivo**: o Mestre acompanha a ficha de cada jogador em tempo real. Gratuito, sem contas e sem servidor: os dados ficam no seu aparelho e a mesa conversa direto entre os participantes.

> **v0.1:** primeira versão pública. Funciona, mas é cedo: [conte o que deu errado](https://github.com/paulo-vc/tabula-rpg/issues/new/choose).

## Usar

- **Windows ou Linux:** baixe o instalador (ou o executável que roda sem instalar) em [Releases](https://github.com/paulo-vc/tabula-rpg/releases).
- **Navegador (qualquer sistema, inclusive celular e Mac):** [paulo-vc.github.io/tabula-rpg](https://paulo-vc.github.io/tabula-rpg/). Dá para instalar como app pelo navegador.

O app desktop e a versão web são o mesmo app; jogadores podem usar um e o Mestre o outro.

> No Windows, o aviso "O Windows protegeu seu computador" aparece porque o executável ainda não tem assinatura digital. Clique em **Mais informações → Executar assim mesmo**.

## O que ele faz

- **Fichas** de D&D 5ª Edição (SRD 5.1) e **Lendas d20** (regras ORC), com cálculos automáticos: modificadores, CA, PV, perícias, carga, efeitos temporários.
- **Sessão ao vivo:** o Mestre cria a campanha e envia um convite. Cada jogador entra com a própria ficha, e o Mestre vê tudo mudar na hora. O Mestre também pode alterar as fichas e guardar campos secretos que só ele vê.
- **Rolagens:** botão de dados em perícias, ataques e testes; as rolagens aparecem para toda a mesa. O Mestre pode rolar em segredo.
- **Criador de sistemas:** monte o seu sistema (campos, seções, fórmulas) com prévia ao vivo, sem programar.
- **Sistemas da comunidade:** instale sistemas feitos por outros jogadores e publique os seus, direto pelo app.
- Funciona offline; exporte fichas e sistemas em arquivo.

## Como a mesa se conecta

Os participantes se conectam **diretamente** (WebRTC), sem servidor do Tabula no meio: por isso é gratuito para todos. Um servidor público só ajuda os aparelhos a se encontrarem.

A conexão direta funciona na grande maioria das redes domésticas e no 4G. Em algumas redes de empresa, escola ou faculdade ela é bloqueada; nesses casos, troque de rede (por exemplo, para o Wi-Fi de casa ou o 4G).

## Privacidade

- Sem contas, sem anúncios, sem coleta de dados.
- Fichas, campanhas e sistemas ficam no armazenamento do seu aparelho. Durante a sessão, a ficha vai só para o Mestre da campanha, criptografada.
- O app consulta o GitHub para listar os sistemas da comunidade e, no desktop, para avisar de versões novas.

## Sistemas incluídos e licenças

- **D&D 5ª Edição (SRD 5.1):** inclui material do System Reference Document 5.1 da Wizards of the Coast LLC, sob a [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/legalcode).
- **Lendas d20 (ORC):** baseado no Player Core © 2023 Paizo Inc., sob a [ORC License](https://www.azoralaw.com/orclicense). Nomes, cenário e marcas da Paizo não são usados.

O Tabula RPG não é afiliado, patrocinado nem endossado por nenhuma dessas empresas.

## Desenvolvimento

Pré-requisitos: **Node.js 24+** e **pnpm** (via `corepack enable pnpm`). Para o app desktop, também **Rust** ([rustup](https://rustup.rs)) e os [pré-requisitos do Tauri](https://tauri.app/start/prerequisites/).

```bash
pnpm install
pnpm dev            # app web em http://localhost:5173
pnpm desktop:dev    # app desktop (requer Rust)
pnpm check          # tudo que o CI verifica
```

- [Arquitetura](docs/architecture.md) · [Decisões (ADRs)](docs/adr/README.md) · [Fórmulas](docs/formulas.md) · [Como contribuir](CONTRIBUTING.md)

## Licença

Código sob [MIT](LICENSE). Os sistemas incluídos seguem as licenças indicadas acima.
