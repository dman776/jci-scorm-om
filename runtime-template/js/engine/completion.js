// @ts-check
/**
 * Node-resolution shim so runtime-template modules can be imported directly by
 * the test runner. The export/preview ASSEMBLER replaces this file with the
 * real, dependency-free content copied from packages/workbook-engine, so the
 * browser never sees this shim.
 */
export * from '@sowb/workbook-engine/completion.js';
