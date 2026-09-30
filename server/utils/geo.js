/**
 * Centralised Geospatial Utilities: Haversine distance and SVY21 to WGS84 conversion.
 */

/**
 * Calculates Great-Circle distance between two coordinates in kilometers using Haversine formula.
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} Distance in kilometers
 */
export function haversineDistance(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return Infinity;
  const R = 6371; // Earth's mean radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function calcM(lat, a, e2, e4, e6) {
  return a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * lat -
              (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * lat) +
              (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * lat) -
              (35 * e6 / 3072) * Math.sin(6 * lat));
}

/**
 * Converts Singapore Transverse Mercator (SVY21) Northing and Easting to WGS84 coordinates.
 * @param {number|string} N Northing (y)
 * @param {number|string} E Easting (x)
 * @returns {{ latitude: number, longitude: number } | null}
 */
export function svy21ToWgs84(N, E) {
  const numN = parseFloat(N);
  const numE = parseFloat(E);
  if (isNaN(numN) || isNaN(numE) || numN === 0 || numE === 0) return null;

  const rad = Math.PI / 180;
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const oLat = 1.366666666666667 * rad;
  const oLon = 103.83333333333333 * rad;
  const oN = 38744.572;
  const oE = 28001.642;
  const k = 1.0;

  const b = a * (1 - f);
  const e2 = (a * a - b * b) / (a * a);
  const e4 = e2 * e2;
  const e6 = e4 * e2;

  const Mo = calcM(oLat, a, e2, e4, e6);
  const M = Mo + (numN - oN) / k;
  const mu = M / (a * (1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256));

  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 = mu + (3 * e1 / 2 - 27 * e1 * e1 * e1 / 32) * Math.sin(2 * mu) +
    (21 * e1 * e1 / 16 - 55 * e1 * e1 * e1 * e1 / 32) * Math.sin(4 * mu) +
    (151 * e1 * e1 * e1 / 96) * Math.sin(6 * mu);

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const tanPhi1 = Math.tan(phi1);

  const N1 = a / Math.sqrt(1 - e2 * sinPhi1 * sinPhi1);
  const T1 = tanPhi1 * tanPhi1;
  const C1 = (e2 / (1 - e2)) * cosPhi1 * cosPhi1;
  const R1 = a * (1 - e2) / Math.pow(1 - e2 * sinPhi1 * sinPhi1, 1.5);
  const D = (numE - oE) / (N1 * k);

  const lat = phi1 - (N1 * tanPhi1 / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * (e2 / (1 - e2))) * D * D * D * D / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * (e2 / (1 - e2)) - 3 * C1 * C1) * D * D * D * D * D * D / 720);
  const lon = oLon + (D - (1 + 2 * T1 + C1) * D * D * D / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * (e2 / (1 - e2)) + 24 * T1 * T1) * D * D * D * D * D / 120) / cosPhi1;

  return {
    latitude: parseFloat((lat / rad).toFixed(6)),
    longitude: parseFloat((lon / rad).toFixed(6))
  };
}

export const DISTRICT_CENTERS = {
  "01": { lat: 1.2801, lng: 103.8540 },
  "02": { lat: 1.2764, lng: 103.8447 },
  "03": { lat: 1.2880, lng: 103.8200 },
  "04": { lat: 1.2655, lng: 103.8118 },
  "05": { lat: 1.2980, lng: 103.7650 },
  "06": { lat: 1.2912, lng: 103.8436 },
  "07": { lat: 1.3000, lng: 103.8550 },
  "08": { lat: 1.3120, lng: 103.8530 },
  "09": { lat: 1.3030, lng: 103.8340 },
  "10": { lat: 1.3138, lng: 103.7824 },
  "11": { lat: 1.3180, lng: 103.8420 },
  "12": { lat: 1.3280, lng: 103.8520 },
  "13": { lat: 1.3350, lng: 103.8700 },
  "14": { lat: 1.3180, lng: 103.8920 },
  "15": { lat: 1.3050, lng: 103.9050 },
  "16": { lat: 1.3220, lng: 103.9350 },
  "17": { lat: 1.3650, lng: 103.9650 },
  "18": { lat: 1.3720, lng: 103.9450 },
  "19": { lat: 1.3650, lng: 103.8850 },
  "20": { lat: 1.3550, lng: 103.8450 },
  "21": { lat: 1.3380, lng: 103.7750 },
  "22": { lat: 1.3450, lng: 103.7150 },
  "23": { lat: 1.3800, lng: 103.7650 },
  "24": { lat: 1.4150, lng: 103.7050 },
  "25": { lat: 1.4350, lng: 103.7750 },
  "26": { lat: 1.3950, lng: 103.8250 },
  "27": { lat: 1.4350, lng: 103.8350 },
  "28": { lat: 1.3950, lng: 103.8750 }
};

export function getDistrictCenter(district) {
  if (!district) return null;
  const key = String(district).padStart(2, '0');
  return DISTRICT_CENTERS[key] || null;
}
