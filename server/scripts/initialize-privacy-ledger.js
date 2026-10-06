import '../config.js';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createConnection} from '../db.js';
import {ledgerPath,readPrivacyLedger,appendPrivacyEvent} from '../utils/privacyLedger.js';

// Explicit maintenance operation: bootstrap from the current suppression table,
// never truncate an existing ledger or silently replace a lost replica.
export async function initializePrivacyLedger() {
  const file=ledgerPath(), replica=process.env.PRIVACY_LEDGER_REPLICA_PATH;
  if (process.env.NODE_ENV==='production' && !replica) throw new Error('Independent ledger replica required');
  for (const target of [file,replica].filter(Boolean)) {
    if (!fs.existsSync(target)) {
      if (target===replica && fs.existsSync(file) && fs.statSync(file).size>0) throw new Error('Recover the existing ledger replica before initialization');
      fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.writeFileSync(target,'',{flag:'wx',mode:0o600});
    }
  }
  const known=new Set(readPrivacyLedger(file).map(entry=>entry.email_hash));
  if (replica) {
    const replicaEvents=new Set(readPrivacyLedger(replica).map(entry=>entry.event_id));
    if (readPrivacyLedger(file).some(entry=>!replicaEvents.has(entry.event_id))) throw new Error('Existing replica requires explicit privacy reconciliation');
  }
  const db=createConnection();
  try {
    const rows=await db.all('SELECT * FROM email_suppression');
    let added=0;
    for (const row of rows) if (!known.has(row.email_hash)) {
      appendPrivacyEvent({...row,source_version:'reviewed-ledger-bootstrap'});added++;
    }
    return {added};
  } finally {await db.close();}
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) initializePrivacyLedger()
  .then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
