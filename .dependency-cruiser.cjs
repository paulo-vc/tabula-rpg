/**
 * Regras de arquitetura (Clean Architecture) verificadas no CI.
 * Ver docs/architecture.md, seção "Camadas".
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: 'domain-e-puro',
      comment:
        'O domínio não pode depender de nenhum outro pacote do monorepo, nem de React/IO. ' +
        'Apenas bibliotecas puras explicitamente permitidas (ex.: zod).',
      severity: 'error',
      // Testes podem usar ferramentas de teste (vitest, fast-check); o código de produção não.
      from: { path: '^packages/domain', pathNot: '\\.test\\.ts$' },
      to: {
        pathNot: ['^packages/domain', 'node_modules/(zod)/'],
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'pacotes-nao-dependem-de-apps',
      comment: 'Pacotes reutilizáveis nunca importam código de aplicações.',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'sem-ciclos',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(dist|coverage)/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    combinedDependencies: true,
  },
};
