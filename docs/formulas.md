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
- Só campos numéricos podem ser referenciados: `number`, `boolean`, `resource`, `computed` e `select` (pelo número das opções). Texto não entra em contas.

## Operadores

| Operador                    | Significado                           |
| --------------------------- | ------------------------------------- |
| `+` `-` `*` `/` `%`         | Aritmética (`%` é o resto da divisão) |
| `<` `<=` `>` `>=` `==` `!=` | Comparação: resulta em `1` ou `0`     |
| `( )`                       | Agrupamento                           |

Precedência, da mais forte para a mais fraca: sinal (`-x`), depois `*` `/` `%`, depois `+` `-`, depois comparações.

## Funções

| Função                  | Resultado                                                  |
| ----------------------- | ---------------------------------------------------------- |
| `floor(x)`              | Arredonda para baixo                                       |
| `ceil(x)`               | Arredonda para cima                                        |
| `round(x)`              | Arredonda para o inteiro mais próximo                      |
| `abs(x)`                | Valor absoluto                                             |
| `min(a, b, …)`          | Menor valor                                                |
| `max(a, b, …)`          | Maior valor                                                |
| `clamp(x, mín, máx)`    | `x` limitado ao intervalo                                  |
| `if(cond, a, b)`        | `a` se `cond` for diferente de 0, senão `b`                |
| `sum(expr)`             | Soma `expr` para cada item de uma lista (ver abaixo)       |
| `count(expr)`           | Conta os itens de uma lista em que `expr` é diferente de 0 |
| `is(@seleção, "opção")` | `1` se a opção está marcada, senão `0`                     |

## Listas: `sum()` e `count()`

Campos de itens de lista são usados como `@lista.campo`, sempre dentro de `sum()` ou `count()`. A expressão é calculada **item a item**:

| Fórmula                                              | Resultado                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| `sum(@equipamento.peso * @equipamento.qtd)`          | Peso total carregado                                          |
| `sum(@equipamento.bonus_ca * @equipamento.equipado)` | Bônus de CA só dos itens **equipados** (booleano vale 1 ou 0) |
| `count(@equipamento)`                                | Quantidade de itens                                           |
| `count(@magias.preparada)`                           | Quantas magias estão preparadas                               |

Regras: uma agregação usa **uma** lista só (`sum(@itens.peso * @magias.nivel)` é recusado); não há `sum` dentro de `sum`; campos de item precisam ser número, booleano ou seleção. Lista vazia soma e conta 0. Itens sem valor usam o padrão do campo.

## Seleções: números e `is()`

- Cada opção pode ter um **número** (`{ "value": "grande", "label": "Grande", "number": -1 }`). A seleção vale o número da opção marcada; numa seleção múltipla, a soma das marcadas. Opções sem número valem 0.
- `is(@seleção, "opção")` testa uma opção específica. O app verifica, ao salvar o template, se a opção existe: um erro de digitação como `is(@condicoes, "envenenada")` é apontado com a lista das opções válidas.
- Exemplos: `is(@condicoes, "envenenado")`; `is(@atributo_conjuracao, "int") * @int_mod + is(@atributo_conjuracao, "sab") * @sab_mod`.

## Efeitos temporários

Não precisam de um mecanismo especial: são uma lista com _alvo_ (seleção), _valor_ e _ativo_, somada nas fórmulas dos campos afetados:

```
@ca + sum(@efeitos.valor * @efeitos.ativo * is(@efeitos.alvo, "ca"))
```

Desmarcar "ativo" (fim da Bênção, do Escudo da Fé…) remove o bônus na hora. O template de D&D 5e usa exatamente isso para CA, iniciativa, resistências e perícias.

## Regras e limites

- Uma fórmula pode usar outros campos calculados, em qualquer ordem de declaração. O app calcula na ordem certa.
- **Dependências circulares são recusadas** ao salvar o template (ex.: `@a` usa `@b` e `@b` usa `@a`).
- Divisão por zero gera um erro só naquele campo (e nos que dependem dele); os demais continuam funcionando.
- Máximo de 500 caracteres e 32 níveis de parênteses por fórmula.
