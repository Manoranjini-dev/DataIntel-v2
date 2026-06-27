// Makes @testing-library/jest-dom matchers (toBeInTheDocument, etc.) visible to
// TypeScript across the project (the matchers are registered at runtime in
// jest.setup.js, which is plain JS and so doesn't carry types into .tsx files).
import '@testing-library/jest-dom';
