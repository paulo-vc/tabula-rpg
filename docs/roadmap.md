# Roteiro

O que está em andamento e as ideias para depois. As fases já entregues ficam em [`architecture.md`](architecture.md#roadmap); as mudanças de cada versão, no [CHANGELOG](../CHANGELOG.md).

## Depois (sem data)

Ideias levantadas em 2026-10, ainda sem desenho. A ordem não é de prioridade.

### Criador de sistemas mais fácil

O criador está completo, mas ainda é difícil para quem não está acostumado com campos, fórmulas e seções. Caminhos possíveis: começar de um modelo pronto (atributos, perícias, recursos), assistentes por etapa e exemplos ao lado das fórmulas.

### Dados 3D e torre de dados

- Rolador de dados 3D, com dados personalizáveis: faces conforme o sistema (ex.: dados de dualidade), cor e textura.
- Uma "torre de dados" na sessão: uma caixa em que toda a mesa vê a rolagem acontecer.
- Hoje a rolagem já é sorteada por quem rola e conferida por todos (`docs/architecture.md`, "Rolagens"). A animação 3D seria só a apresentação desse resultado, para ninguém ver um resultado diferente do registrado.

### Sussurro entre jogadores

O chat da sessão já tem sussurros entre o Mestre e um jogador. Entre dois jogadores, a mensagem passaria pelo aparelho do Mestre (a topologia é em estrela); precisaria ser cifrada de ponta a ponta entre os dois para o Mestre não ler.

### Ícone do sistema

O retrato do personagem e a capa da campanha já existem (v0.3.2). Falta o ícone do sistema, que iria junto do arquivo do sistema (e do catálogo da comunidade).

### Convite mais curto

O convite já caiu de ~460 para ~190 caracteres (v0.2.1). Um código curto e padronizado (ex.: `K7QX-9MPA`) exigiria que o Mestre estivesse online para trocá-lo pelo convite completo, e quem visse o código poderia responder antes do Mestre e se passar por ele. Precisa de um desenho que mantenha a verificação do Mestre.

### Ferramentas do Mestre

- **Música na sessão:** arquivo MP3 ou link do YouTube/Spotify. Arquivos precisariam ir aos jogadores em partes (ou cada um tocar a própria cópia); links dependem dos termos e dos players oficiais de cada serviço, e o Spotify exige conta.
- **Soundboard:** efeitos curtos disparados pelo Mestre, no mesmo esquema da música.

### Imprimir a ficha

Imprimir ou gerar PDF da ficha.

## Já existe

- **Notas e diário da campanha** (v0.3.0): notas só do Mestre e entradas compartilhadas com a mesa.
- **Cutscene** (v0.3.0): imagens do Mestre em tela cheia para a mesa.
- **Retrato do personagem** (v0.3.2): imagem na ficha, que vai junto ao Mestre e na exportação.
- **Sons** (v0.3.3): sua vez, rolagens, mensagens e sussurros, com volume e opção de desligar.
- **Capa da campanha** (v0.3.2): escolhida pelo Mestre, chega aos jogadores na sessão.
- **Chat da sessão** (v0.3.0): falar como o personagem, ações com `/me`, rolagens com `/r` e sussurros entre o Mestre e um jogador.

- **Alterar a ficha com a sessão fechada:** a ficha é local-first. O jogador edita fora da sessão e, ao entrar de novo, só as diferenças vão ao Mestre; alterações dos dois lados se combinam (CRDT), sem perder nenhuma.
