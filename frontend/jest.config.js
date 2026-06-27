// Jest config for the Next.js frontend (App Router).
const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
const customJestConfig = {
  testEnvironment: 'jest-environment-jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    // lucide-react is ESM-only and Next rewrites its imports to deep ESM paths
    // (optimizePackageImports). Stub both the bare and deep specifiers.
    '^lucide-react(/.*)?$': '<rootDir>/src/test/lucide-mock.js',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: ['**/__tests__/**/*.test.tsx', '**/?(*.)+(test).tsx'],
  collectCoverageFrom: [
    'src/app/admin/**/*.tsx',
    'src/app/activate/**/*.tsx',
    'src/app/forgot-password/**/*.tsx',
    'src/app/reset-password/**/*.tsx',
    'src/components/admin/**/*.tsx',
  ],
};

module.exports = createJestConfig(customJestConfig);
