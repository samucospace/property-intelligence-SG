import {createConnection} from '../../db.js';
import {claimPendingEmails,processOutboxBatch} from '../../utils/emailQueue.js';
import fs from 'node:fs';
const db=createConnection(process.argv[2]);
if (process.argv[3]==='accepted-crash') {
  await processOutboxBatch({conn:db,sendEmailFn:async request=>{
    fs.writeFileSync(process.argv[4],JSON.stringify({key:request.idempotencyKey,id:'accepted-before-crash'}));
    process.exit(23);
  }});
}
const items=await claimPendingEmails({workerId:`pid-${process.pid}`,batchSize:1},db);
await db.close();
console.log(JSON.stringify(items.map(item=>item.id)));
if (process.argv[3]==='crash') process.exit(23);
