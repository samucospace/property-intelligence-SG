import axios from 'axios';
import { dbRun, dbAll, dbGet } from '../db.js';

export async function fetchFullSingaporeAmenities() {
  console.log('Fetching comprehensive Singapore Parks & Greenery from Overpass API mirror...');

  try {
    const q = `[out:json][timeout:30];node["leisure"="park"](1.20,103.60,1.48,104.05);out;`;

    const response = await axios.get(`https://overpass.kumi.systems/api/interpreter?data=${encodeURIComponent(q)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0'
      },
      timeout: 30000
    });

    const elements = response.data?.elements || [];
    console.log(`Retrieved ${elements.length} green spaces & parks from OpenStreetMap!`);

    let count = 0;
    for (const el of elements) {
      const lat = el.lat;
      const lng = el.lon;
      const name = el.tags?.name || el.tags?.['name:en'] || 'Neighborhood Greenery';

      if (lat && lng && name) {
        const existing = await dbGet(`SELECT amenity_id FROM amenities WHERE category = 'park' AND (UPPER(name) = UPPER(?) OR (ABS(latitude - ?) < 0.001 AND ABS(longitude - ?) < 0.001))`, [name, lat, lng]);
        if (!existing) {
          await dbRun(
            `INSERT INTO amenities (category, name, latitude, longitude, details) VALUES (?, ?, ?, ?, ?)`,
            ['park', name, lat, lng, JSON.stringify({ source: 'OpenStreetMap', type: el.tags?.leisure || 'park' })]
          );
          count++;
        }
      }
    }

    console.log(`Successfully added ${count} new parks to database!`);
    return count;
  } catch (err) {
    console.error('Error fetching full amenity dataset:', err.message);
    throw err;
  }
}
