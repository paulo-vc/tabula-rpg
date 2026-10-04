import type { FormulaNode, FormulaRef } from './ast';

/** Lista todas as referências (`@key`, `@key.prop`) de uma fórmula, na ordem em que aparecem. */
export function collectRefs(node: FormulaNode, into: FormulaRef[] = []): FormulaRef[] {
  switch (node.type) {
    case 'number':
      break;
    case 'ref':
      into.push(node);
      break;
    case 'unary':
      collectRefs(node.operand, into);
      break;
    case 'binary':
      collectRefs(node.left, into);
      collectRefs(node.right, into);
      break;
    case 'call':
      for (const arg of node.args) collectRefs(arg, into);
      break;
  }
  return into;
}
