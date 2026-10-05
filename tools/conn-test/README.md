# Teste de conexão (Fase 3)

Protótipo que mede, em redes reais, se Mestre e jogadores conseguem se conectar **diretamente** por WebRTC, sem servidor. O resultado decide se o app precisa de um relay de último recurso ([ADR 0004](../../docs/adr/0004-sincronizacao.md)).

## Gerar o arquivo

```bash
pnpm --filter @tabula/conn-test build
```

O resultado é **um único arquivo**, `tools/conn-test/dist/index.html`, com tudo embutido. Envie-o aos testadores (Discord, WhatsApp, e-mail). Eles o abrem num navegador de computador ou de celular, e não há nada para instalar.

## Roteiro do teste

1. Todos abrem o arquivo, preenchem o nome e o tipo de internet.
2. A seção **Diagnóstico** analisa a rede de cada um sozinha (leva alguns segundos).
3. Uma pessoa clica em **Criar sala** e passa o código no chat. As outras digitam o código e clicam em **Entrar**.
4. Esperem cerca de 30 segundos. Cada pessoa vê com quem conectou e como.
5. Cada um clica em **Copiar resultado** e cola no chat.

Para medir o pior caso, repita com alguém **no 4G/5G** (Wi-Fi do celular desligado), de preferência dos dois lados.

## Como ler o resultado

| Diagnóstico de NAT | Significado                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `aberto` ou `cone` | Conexões diretas costumam funcionar.                                                                             |
| `simetrico`        | Conexão direta só funciona se o outro lado não for restritivo. Dois `simetrico` provavelmente precisam de relay. |
| `udp-bloqueado`    | Só um relay funcionaria (rede corporativa ou escolar).                                                           |

| Conexão                                | Significado                                                                               |
| -------------------------------------- | ----------------------------------------------------------------------------------------- |
| `Direta (mesma rede)`                  | Mesma rede local.                                                                         |
| `Direta pela internet`                 | Funcionou sem servidor, que é o caso ideal.                                               |
| `FALHOU` / "conexões diretas falharam" | Os dois se encontraram, mas a conexão direta não abriu: **este par precisaria de relay**. |

A métrica que importa é: **das tentativas entre pessoas em redes diferentes, quantas falharam?**

## Privacidade

- O resultado **não contém endereços IP**: só o tipo de NAT, o tipo de conexão, o navegador e a latência.
- Para se encontrarem, os navegadores trocam dados de conexão por relays Nostr públicos. Esses dados são **cifrados** com o código da sala.
- Os testes usam servidores STUN públicos do Google e da Cloudflare, que apenas informam o endereço público de quem pergunta.

## Limitações conhecidas

- Validado no Chrome, servido por HTTP. Abrir o arquivo direto do disco (`file://`) deve funcionar no Chrome e no Edge, mas **ainda não foi verificado**. Se a página não analisar a rede ou não conectar, sirva a pasta com `pnpm --filter @tabula/conn-test exec vite preview` e acesse pelo navegador.
- O diagnóstico de NAT é uma heurística. Uma VPN ou várias placas de rede ativas podem confundir o resultado.
