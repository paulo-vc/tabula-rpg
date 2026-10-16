# Novidades

As mudanças de cada versão, para quem usa o Tabularium RPG. Detalhes técnicos ficam nos PRs e em [`docs/`](docs/).

## v0.3.2

Imagens para a mesa: o retrato de cada personagem e a capa da campanha. Quem estiver numa versão anterior continua jogando normalmente, só não vê os retratos e a capa (o app desktop se atualiza sozinho).

- **Capa da campanha:** o Mestre escolhe uma imagem em "Adicionar capa", no topo da página da campanha. Ela aparece ali e na lista de campanhas, e chega aos jogadores quando eles entram na sessão (fica guardada no aparelho deles). Trocar ou remover com a sessão aberta chega à mesa na hora.
- **Retrato do personagem:** toque no círculo ao lado do nome da ficha para escolher uma imagem (PNG, JPEG ou WebP). Ela é reduzida no aparelho e fica guardada na própria ficha: aparece na lista de fichas, vai junto ao exportar e chega ao Mestre na sessão, no card do jogador e na ficha que ele abre. Pelo mesmo círculo dá para trocar ou remover.

## v0.3.1

- **Corrigido:** no app desktop (Windows e Linux), as imagens da cutscene não apareciam: a galeria do Mestre mostrava miniaturas quebradas e o jogador não via a imagem em tela cheia. Na versão web já funcionava.

## v0.3.0

A mesa ganha ferramentas de narração: chat, imagens em tela cheia e o diário da campanha. Para usar, todos da mesa precisam estar na v0.3.0: quem estiver numa versão anterior continua jogando (fichas, rolagens e combate), mas não vê o chat, as imagens nem o diário (o app desktop se atualiza sozinho).

- **Chat da sessão:** com a sessão aberta, o botão "Chat" no canto abre a conversa da mesa, em qualquer tela do app. Fale como você ou **como o seu personagem** (o Mestre, como qualquer NPC), descreva ações com `/me` e role dados no meio da conversa com `/r 1d20+3`. **Sussurros:** o Mestre sussurra a um jogador e o jogador ao Mestre; ninguém mais vê. A conversa fica guardada no aparelho, e quem entra no meio da sessão recebe as mensagens recentes.
- **Cutscene:** o Mestre guarda imagens na campanha (NPCs, criaturas, cenários) e as mostra em tela cheia para a mesa, com nome e legenda. Os jogadores veem a imagem em qualquer tela do app; cada um pode fechar a sua, e o Mestre fecha para todos. A imagem é reduzida no aparelho do Mestre e só vai a quem ainda não a tem: mostrar de novo não baixa outra vez.
- **Diário e notas da campanha:** o Mestre escreve entradas com título e texto. Cada uma é uma **nota** (só dele) ou fica **compartilhada com a mesa**, como o diário das sessões. As compartilhadas chegam aos jogadores quando a sessão está aberta e ficam guardadas no aparelho deles, para ler mesmo fora da sessão. Editar, deixar de compartilhar ou apagar também chega à mesa.

## v0.2.2

O app passa a se chamar **Tabularium RPG** na janela, no site e no app instalado pelo navegador. Nada muda no que você já tem: fichas, campanhas e instalação continuam as mesmas (no Windows, o atalho e a lista de aplicativos ainda mostram "Tabularium").

### Combate

- **Rolar a iniciativa pela ficha:** quando o Mestre inicia o combate, cada jogador vê o botão "Rolar iniciativa" (ex.: 1d20+2, já com o modificador da ficha), e o resultado entra direto na ordem de turno. O Mestre continua podendo corrigir. No D&D 5e usa a Iniciativa; no Lendas d20, a Percepção. No criador de sistemas, escolha o campo da iniciativa em Informações.
- **Criaturas rolam a iniciativa:** ao adicionar uma criatura ao combate, o Mestre pode digitar um número (`15`), um modificador (`+2`, que rola o dado do sistema com ele) ou uma rolagem (`2d6+1`). Com **Qtd.**, várias criaturas iguais entram de uma vez ("Goblin 1", "Goblin 2"…), cada uma com a sua rolagem. As rolagens ficam no registro só para o Mestre.

## v0.2.1

### Mesa ao vivo

- **Sair e entrar de novo na sessão é instantâneo.** Antes, voltar depois de sair podia levar uns 9 segundos; o mesmo vale para o Mestre encerrar e reabrir a sessão.
- **Progresso da conexão:** enquanto procura o Mestre, o jogador vê há quanto tempo; ao conectar, quanto levou e como ficou a conexão (direta ou via servidor, com o atraso). O Mestre vê a conexão de cada jogador no card. Se a entrada demorar, esses números ajudam a descobrir o porquê.
- **Convite menor:** o código do convite caiu de cerca de 460 para 190 caracteres. Convites antigos continuam valendo. Quem ainda estiver na v0.2.0 precisa atualizar para ler os convites novos (o app desktop se atualiza sozinho).

### Windows

- **Instalar remove o antigo "Tabula RPG"** (v0.1) que ficava instalado ao lado do Tabularium, sem tocar nas suas fichas.
- O executável passa a se chamar `tabularium.exe` (o que roda sem instalar, `tabularium_windows_x64.exe`; no Linux, `tabularium`). Os atalhos são atualizados sozinhos.

## v0.2.0

O Tabula RPG agora se chama **Tabularium**, com nome, ícone e visual novos. Fichas, campanhas e sistemas continuam onde estavam, e a mesa funciona com quem ainda está na v0.1.

### Ficha mais fácil de usar na mesa

- **Painel fixo no topo:** PV (com dano e cura em um toque), CA, iniciativa, condições e o que mais muda a cada turno ficam sempre à vista e são editados ali mesmo. Clicar no número do PV abre o ajuste de atual, máximo e temporários.
- **Abas** (Principal, Combate, Magias, Inventário, Personagem, Anotações): a ficha inteira sem rolar tanto.
- **Nada aparece duas vezes:** o que está no painel sai das abas.
- **Marcadores** (bolinhas clicáveis, como na ficha de papel) para testes contra a morte, exaustão, espaços de magia, Esperança, Estresse, Heroísmo e similares.
- Atributos em blocos, perícias em linhas e descrições longas que abrem por item.
- Condições: só as ativas ficam à vista; as outras, a um clique.

### Combate

- **Ordem de turno:** o Mestre monta o combate com os jogadores da sessão e as criaturas, define as iniciativas e passa a vez, com contador de rodadas.
- Criaturas podem ficar **ocultas** (só o Mestre vê); na vez delas, os jogadores veem "vez do Mestre".
- Os jogadores veem a ordem ao vivo e recebem o aviso **"É a sua vez!"**.

### Segurança da mesa

- **O Mestre prova quem é.** Antes, quem tivesse o convite podia se passar pelo Mestre e alterar fichas. Agora cada campanha tem uma chave, e o app do jogador só aceita como Mestre quem a possui.
- Campanhas da v0.1 ganham a chave na primeira sessão do Mestre.

### Outros

- **Desktop:** a partir desta versão, o app se atualiza sozinho (só aceita atualizações assinadas pelo projeto).
- **Versão web** em um endereço novo: [paulo-vc.github.io/tabularium](https://paulo-vc.github.io/tabularium/). O endereço antigo não abre mais.
- Criador de sistemas: abas e modos de exibição por seção, "mostrar junto" por campo e a opção de marcadores.
- Sistemas: D&D 5e 1.3.0 e Lendas d20 1.2.0 organizados na ficha nova.
- Corrigido: a mesa podia não se reconectar quando o Mestre recarregava a página.

### Para quem tem a v0.1 instalada

A v0.1 não tem a atualização automática: o app avisa que há versão nova e leva à página de download. Instale a v0.2.0: suas fichas e campanhas continuam lá. Daqui em diante, as atualizações chegam sozinhas.

**No Windows, o "Tabula RPG" (v0.1) continua instalado ao lado do Tabularium.** Os dois usam os mesmos dados: se for desinstalar o antigo, **não marque "Excluir dados do aplicativo"**, ou as fichas do Tabularium também serão apagadas. A próxima versão remove o app antigo sozinha, sem tocar nos dados.

## v0.1.0

Primeira versão pública: fichas de D&D 5e e Lendas d20, sessão ao vivo com o painel do Mestre, rolagens, campos secretos, criador de sistemas e sistemas da comunidade.
