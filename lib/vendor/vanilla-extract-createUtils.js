// Wrapper to safely re-export CommonJS default as named export for ESM consumers
// Fixes: SyntaxError: Named export 'createMapValueFn' not found from '@vanilla-extract/sprinkles/createUtils'

import pkg from '@vanilla-extract/sprinkles/createUtils';

// Re-export default for compatibility
export default pkg;

// Re-export specific named helpers from the default export
export const createMapValueFn = pkg.createMapValueFn;
export const createNormalizeValueFn = pkg.createNormalizeValueFn;