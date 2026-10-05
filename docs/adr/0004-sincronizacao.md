# 0004 — Sincronização P2P com relay de último recurso

- **Status:** Aceita. O relay de último recurso foi **adiado** pela [ADR 0008](0008-lancar-sem-relay.md), com base no teste de conexão.
- **Data:** 2026-10-04

## Contexto

O Mestre precisa ver as fichas dos jogadores em tempo real durante sessões **online**. Restrições: custo zero para mantenedor e usuários, nenhum programa externo (Radmin, Hamachi), nenhuma configuração de roteador. CGNAT e NAT simétrico são comuns no Brasil (principalmente em 4G/5G), o que impede conexões diretas em parte dos casos.

## Decisão

- **CRDT Yjs** para o estado compartilhado da sessão. Mescla edições concorrentes (jogador e Mestre no mesmo HP) e edições offline.
- **Topologia em estrela:** jogadores conectam-se apenas ao Mestre (host da sessão).
- **Transporte em camadas**, atrás da porta `SyncTransport`, sem escolha do usuário:
  1. **WebRTC direto**, com sinalização para trocar os dados de conexão e STUN público para descobrir endereços. IPv6 é tentado automaticamente.
  2. **Relay de último recurso**, usado apenas pela conexão individual que falhou.
- **Criptografia de ponta a ponta:** a chave fica no fragmento (`#`) do link de convite, que nunca é enviado a servidores. Sinalização e relay só veem bytes cifrados.
- Sincronização **apenas durante a sessão**. Templates são enviados uma vez, na entrada (identificados por hash). Depois, só trafegam diferenças.
- O provedor de sinalização e relay é um adaptador trocável. Candidatos gratuitos: Cloudflare Workers + Durable Objects, Open Relay (TURN), Firebase (plano Spark), servidores públicos Nostr/MQTT via Trystero.

## Alternativas consideradas

- **Somente P2P, sem relay:** zero dependências além da sinalização, mas parte das mesas não conectaria (estimativas comuns ficam entre 10% e 20%). Rejeitada por violar a restrição de experiência intuitiva.
- **Supabase Realtime:** cota única compartilhada por todos os usuários e pausa do projeto após inatividade. Rejeitada.
- **Mestre como servidor (UPnP + porta aberta):** não funciona sob CGNAT nem para jogadores na versão web (bloqueio de mixed content). Adiada; reavaliar com dados do protótipo.
- **Túnel (Cloudflare Quick Tunnel):** destinado oficialmente a testes, e aumenta o app em ~30 MB. Rejeitada.
- **VPN de terceiros (Radmin/Hamachi):** exige programa externo. Rejeitada.

## Consequências

- A maioria das mesas usa conexão direta: custo zero e escalável, pois cada mesa usa a própria banda.
- O relay é o único recurso compartilhado. Ele deve ter limite por sala e degradar com uma mensagem clara (nunca gerar cobrança: usar apenas planos gratuitos sem cartão).
- Antes de implementar a Fase 3, um **protótipo de teste de conexão** mede, em redes reais (fibra, 4G, Wi-Fi corporativo), qual camada conecta cada participante.
