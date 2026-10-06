/**
 * Singapore Home Intel - Frontend Date Utilities
 * Generates rolling date ranges to avoid hardcoded year cutoffs.
 */

export function getDefaultDateRange(yearsBack = 5) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const year=Number(parts.find(part=>part.type==='year').value);
  const month=parts.find(part=>part.type==='month').value;
  const day=parts.find(part=>part.type==='day').value;
  const dateTo = `${year}-${month}-${day}`;
  const dateFrom = `${year - yearsBack}-${month}-${String(Math.min(Number(day), new Date(Date.UTC(year - yearsBack, Number(month), 0)).getUTCDate())).padStart(2, '0')}`;
  return { dateFrom, dateTo };
}
