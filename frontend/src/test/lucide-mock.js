/* eslint-disable @typescript-eslint/no-require-imports */
// Test stub for lucide-react (ESM-only). Returns a no-op component for any
// icon name accessed, so components that import { Foo } from 'lucide-react'
// render without needing the real ESM package transformed.
const React = require('react');
const Icon = () => React.createElement('svg');
module.exports = new Proxy(
  { __esModule: true, default: Icon },
  { get: (target, prop) => (prop in target ? target[prop] : Icon) },
);
