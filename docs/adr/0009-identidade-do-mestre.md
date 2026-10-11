# 0009 — Identidade do Mestre provada por assinatura

- **Status:** Aceita. Complementa a [ADR 0004](0004-sincronizacao.md) (modelo de confiança da sessão).
- **Data:** 2026-10-10

## Contexto

Na v0.1, o jogador aceitava como Mestre qualquer participante que se apresentasse com o `gmId` da campanha. Esse ID é público para quem tem o convite, e o convite circula por mensagem, então um participante com o link podia se passar pelo Mestre. As consequências iam de recusar jogadores (`REJECT`) a alterar fichas e rolagens da mesa (a ficha do jogador aceita as alterações que chegam do "Mestre").

## Decisão

- Cada campanha tem um par de chaves **Ed25519**, gerado no aparelho do Mestre. A **pública** vai no convite (`gmKey`) e na cópia da campanha de cada jogador. A **privada** fica só no aparelho do Mestre (tabela `gmKeys`, banco v7) e nunca vai ao convite, ao documento sincronizado ou a exportações.
- **Desafio-resposta.** Na entrada, o jogador envia um `challenge` aleatório (128 bits) no HELLO. O Mestre responde com `gmKey` e `proof`, a assinatura de `campanha + desafio + gmId`. O jogador só aceita o Mestre cuja chave bate com a do convite e cuja prova confere para o desafio **daquela conexão**. Provas gravadas não servem em outra conexão (replay).
- **Recusas também são autenticadas.** O Mestre envia o HELLO assinado antes de qualquer `REJECT`; o jogador ignora recusas de quem não provou ser o Mestre (senão qualquer um expulsaria jogadores).
- **Compatibilidade, sem mudar `PROTOCOL_VERSION`.** Os campos novos são opcionais no HELLO. Versões antigas os ignoram e continuam funcionando entre si.
  - Campanha da v0.1 (sem chave): o Mestre gera a chave na primeira sessão; o jogador fixa a primeira chave provada (_trust on first use_) e a grava. A partir daí, vale como se estivesse no convite.
  - Mestre da v0.1 (não assina): só é aceito por jogadores cuja campanha **não** tem chave, como identidade `declarada`. A interface avisa o jogador. Quem tem chave no convite recusa um Mestre que não assina (sem rebaixamento).
- Criptografia: `@noble/curves` (auditado, síncrono, sem dependência de WebCrypto/Ed25519 do navegador, que não é universal em WebViews de Linux).
- Se a chave privada se perder com a campanha ainda existindo, o Mestre **não consegue iniciar a sessão** (mensagem clara). Gerar outra chave faria todos os jogadores que já fixaram a antiga recusarem o Mestre.

## Consequências

- Quem só tem o convite não se passa mais pelo Mestre, não expulsa jogadores nem injeta alterações.
- Perder os dados locais do Mestre significa perder a identidade da campanha: é preciso criar outra e convidar de novo. Backup/exportação da chave fica para uma versão futura.
- **Não coberto (limitações conhecidas):**
  - _Retransmissão ativa_: um participante com o convite que fique entre o jogador e o Mestre, repassando o desafio e a prova, ainda pode intermediar a sessão enquanto estiver online. Fechar isso exige amarrar a prova ao canal (fingerprint DTLS) ou autenticar cada mensagem. A configuração do Trystero hoje não expõe isso.
  - _Jogadores_ continuam declarando o próprio `userId`. Um participante com o convite pode tentar assumir a ficha de outro jogador. Assinatura por jogador é o passo natural seguinte.
  - _TOFU_ em campanhas legadas: a primeira chave provada é a que vale. Um impostor que chegue antes do Mestre real a uma campanha sem chave poderia ser fixado. Some assim que o Mestre atualiza e reenvia o convite.
