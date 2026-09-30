/**
 * Canonical Math Utilities for Property Intelligence SG
 */

/**
 * Calculates the exact median of an array of numbers.
 * Averages the two middle values for even lengths and returns null for empty or invalid input.
 * @param {Array<number>} numbers
 * @returns {number|null}
 */
export function calculateMedian(numbers) {
  if (!Array.isArray(numbers) || numbers.length === 0) {
    return null;
  }

  const validNumbers = numbers
    .map(n => (typeof n === 'number' ? n : parseFloat(n)))
    .filter(n => !isNaN(n) && isFinite(n))
    .sort((a, b) => a - b);

  const len = validNumbers.length;
  if (len === 0) return null;

  const mid = Math.floor(len / 2);
  if (len % 2 !== 0) {
    return validNumbers[mid];
  }

  return (validNumbers[mid - 1] + validNumbers[mid]) / 2;
}
