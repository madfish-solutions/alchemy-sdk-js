module.exports = {
  plugins: ['import', 'unused-imports', '@typescript-eslint'],
  parser: '@typescript-eslint/parser',
  overrides: [
    {
      files: ['*.ts']
    }
  ],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: './tsconfig.eslint.json'
  },
  ignorePatterns: [
    '.eslintrc.cjs',
    'inject-version.cjs',
    'vitest.config.ts',
    'vitest.integration.config.ts',
    'dist'
  ],
  rules: {
    curly: ['error', 'all'],
    'no-extra-label': 'error',
    'no-unused-labels': 'error',
    'new-parens': 'error',
    'no-new-wrappers': 'error',
    'no-debugger': 'error',
    'no-duplicate-case': 'error',
    'no-throw-literal': 'error',
    'no-return-await': 'error',
    'no-unsafe-finally': 'error',
    'no-unused-expressions': [
      'error',
      {
        allowShortCircuit: true
      }
    ],
    'no-var': 'error',
    'object-shorthand': 'error',
    'prefer-arrow-callback': [
      'error',
      {
        allowNamedFunctions: true
      }
    ],
    'prefer-const': [
      'error',
      {
        destructuring: 'all'
      }
    ],
    'no-array-constructor': 'error',
    'import/no-default-export': 'error',
    'import/no-duplicates': 'error',
    'unused-imports/no-unused-imports-ts': 'error',
    'default-case': 'error',
    '@typescript-eslint/member-ordering': 'error',
    '@typescript-eslint/no-floating-promises': 'error'
  }
};
