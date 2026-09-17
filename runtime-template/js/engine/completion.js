// @ts-check
// Node-resolution shim so runtime-template/js/session.js and player.js can be
// imported directly by the test runner. The export/preview ASSEMBLER replaces
// this file with the real, dependency-free content copied from
// packages/workbook-engine/completion.js, so the browser never sees this shim.
export * from '@sowb/workbook-engine/completion.js';
