# Fórmulas

Campos calculados (`computed`) e o máximo de recursos (`resource.max`) usam uma linguagem de fórmulas simples. Ela é avaliada por um parser próprio: nenhum código arbitrário é executado, então templates baixados da comunidade são seguros.

## Exemplos

| Fórmula                                          | Uso                               |
| ------------------------------------------------ | --------------------------------- |
| `floor((@for - 10) / 2)`                         | Modificador de atributo (D&D 5e)  |
| `ceil(@nivel / 4) + 1`                           | Bônus de proficiência             |
| `@for_mod + if(@prof_atletismo, @bonus_prof, 0)` | Perícia com proficiência opcional |
| `10 + @des_mod`                                  | Classe de armadura                |
| `@nivel * (6 + @con_mod) + 4`                    | Pontos de vida máximos            |
| `round(@hp / @hp.max * 100)`                     | Porcentagem de vida               |
| `clamp(@pericia, 0, 99)`                         | Limitar um valor a um intervalo   |

## Referências

- `@apelido`: valor do campo com aquele apelido (`key`).
- Booleanos valem `1` (marcado) ou `0`.
- Recursos: `@hp` é o valor atual, `@hp.max` o máximo e `@hp.temp` os pontos temporários.
- Só campos numéricos podem ser referenciados: `number`, `boolean`, `resource` e `computed`.

## Operadores

| Operador                    | Significado                           |
| --------------------------- | ------------------------------------- |
| `+` `-` `*` `/` `%`         | Aritmética (`%` é o resto da divisão) |
| `<` `<=` `>` `>=` `==` `!=` | Comparação: resulta em `1` ou `0`     |
| `( )`                       | Agrupamento                           |

Precedência, da mais forte para a mais fraca: sinal (`-x`), depois `*` `/` `%`, depois `+` `-`, depois comparações.

## Funções

| Função               | Resultado                                   |
| -------------------- | ------------------------------------------- |
| `floor(x)`           | Arredonda para baixo                        |
| `ceil(x)`            | Arredonda para cima                         |
| `round(x)`           | Arredonda para o inteiro mais próximo       |
| `abs(x)`             | Valor absoluto                              |
| `min(a, b, …)`       | Menor valor                                 |
| `max(a, b, …)`       | Maior valor                                 |
| `clamp(x, mín, máx)` | `x` limitado ao intervalo                   |
| `if(cond, a, b)`     | `a` se `cond` for diferente de 0, senão `b` |

## Regras e limites

- Uma fórmula pode usar outros campos calculados, em qualquer ordem de declaração. O app calcula na ordem certa.
- **Dependências circulares são recusadas** ao salvar o template (ex.: `@a` usa `@b` e `@b` usa `@a`).
- Divisão por zero gera um erro só naquele campo (e nos que dependem dele); os demais continuam funcionando.
- Máximo de 500 caracteres e 32 níveis de parênteses por fórmula.
