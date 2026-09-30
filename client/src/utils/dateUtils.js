/**
 * Singapore Home Intel - Frontend Date Utilities
 * Generates rolling date ranges to avoid hardcoded year cutoffs.
 */

export function getDefaultDateRange(yearsBack = 5) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  const dateTo = `${year}-${month}-${day}`;
  const dateFrom = `${year - yearsBack}-${month}-${day}`;
  return { dateFrom, dateTo };
}
