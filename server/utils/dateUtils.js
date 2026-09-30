/**
 * Singapore Home Intel - Date Utility Helpers
 * All operations respect the Asia/Singapore timezone (UTC+8).
 */

/**
 * Returns today's date formatted as YYYY-MM-DD in Asia/Singapore timezone.
 * @param {Date} [date=new Date()]
 * @returns {string} YYYY-MM-DD
 */
export function getTodaySingaporeString(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(date);
}

/**
 * Returns a rolling date range { dateFrom, dateTo } in Asia/Singapore timezone.
 * dateTo defaults to today, dateFrom defaults to N years prior.
 * @param {number} [yearsBack=5]
 * @param {Date} [now=new Date()]
 * @returns {{ dateFrom: string, dateTo: string }}
 */
export function getDefaultDateRange(yearsBack = 5, now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(now);
  const year = parseInt(parts.find(p => p.type === 'year').value, 10);
  const month = parts.find(p => p.type === 'month').value;
  const day = parts.find(p => p.type === 'day').value;

  const dateTo = `${year}-${month}-${day}`;
  const dateFrom = `${year - yearsBack}-${month}-${day}`;
  return { dateFrom, dateTo };
}

/**
 * Generates an array of URA reference quarter strings (e.g. ['21q1', '21q2', ...])
 * starting from startPeriod (default: process.env.URA_RENTAL_START or '21q1')
 * up to the current quarter in Singapore timezone.
 * @param {string} [startPeriod]
 * @param {Date} [now=new Date()]
 * @returns {string[]}
 */
export function generateRentalQuarters(startPeriod = process.env.URA_RENTAL_START || '21q1', now = new Date()) {
  const match = /^(\d{2})q([1-4])$/i.exec(String(startPeriod).trim());
  const startYear = match ? parseInt(match[1], 10) : 21;
  const startQuarter = match ? parseInt(match[2], 10) : 1;

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: 'numeric'
  });
  const parts = formatter.formatToParts(now);
  const fullYear = parseInt(parts.find(p => p.type === 'year').value, 10);
  const endYear = fullYear % 100;
  const month = parseInt(parts.find(p => p.type === 'month').value, 10);
  const endQuarter = Math.ceil(month / 3);

  const quarters = [];
  for (let y = startYear; y <= endYear; y++) {
    const qStart = (y === startYear) ? startQuarter : 1;
    const qEnd = (y === endYear) ? endQuarter : 4;
    for (let q = qStart; q <= qEnd; q++) {
      quarters.push(`${String(y).padStart(2, '0')}q${q}`);
    }
  }
  return quarters;
}
