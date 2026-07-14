'use strict';

function parsePackResult(output, expectedName) {
  const value = JSON.parse(output);
  const results = Array.isArray(value) ? value : Object.values(value || {});
  const result = expectedName ? results.find(entry => entry && entry.name === expectedName) : results[0];
  if (!result || !Array.isArray(result.files)) {
    throw new Error(`npm pack did not return metadata for ${expectedName || 'the package'}.`);
  }
  return result;
}

module.exports = { parsePackResult };
