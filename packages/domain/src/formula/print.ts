import type { FormulaNode } from './ast';

/**
 * Converte a árvore de volta em texto. Parenteses explícitos em toda operação, para que
 * `parseFormula(printFormula(ast))` reproduza exatamente a mesma árvore.
 */
export function printFormula(node: FormulaNode): string {
  switch (node.type) {
    case 'number':
      return String(node.value);
    case 'string':
      return `"${node.value.replace(/["\\]/g, '\\$&')}"`;
    case 'ref':
      return node.prop ? `@${node.key}.${node.prop}` : `@${node.key}`;
    case 'unary':
      return `(-${printFormula(node.operand)})`;
    case 'binary':
      return `(${printFormula(node.left)} ${node.op} ${printFormula(node.right)})`;
    case 'call':
      return `${node.fn}(${node.args.map(printFormula).join(', ')})`;
  }
}
