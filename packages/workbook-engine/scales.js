// @ts-check
/**
 * Node-resolution shim so completion.js can `import ... from './scales.js'`.
 *
 * completion.js is copied VERBATIM into the exported package, where its sibling
 * js/engine/scales.js is the real dependency-free module from packages/shared.
 * This file exists only so the same import resolves under Node during tests and
 * in the authoring app. The assembler never copies this file.
 */
export * from '@sowb/shared/scales.js';
