import {createConnection} from './server/db.js';
const db=createConnection();
try {
  const jobs=await db.all('SELECT job_name,status,started_at,finished_at FROM job_history ORDER BY started_at');
  const counts=await db.get('SELECT (SELECT count(*) FROM projects) AS projects,(SELECT count(*) FROM property_transactions) AS sales,(SELECT count(*) FROM rental_transactions) AS rentals,(SELECT count(*) FROM leads) AS leads');
  console.log(JSON.stringify({jobs,counts}));
} finally {await db.close();}
