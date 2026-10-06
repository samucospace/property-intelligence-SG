import { it,expect,beforeEach,afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createConnection,closeDb } from '../db.js';
import { fileHash,databaseMetrics } from '../utils/databaseArtifacts.js';
import { promoteReviewedCandidate,recoverReviewedPromotion } from '../utils/reviewedPromotion.js';
let folder,target,candidate,options;
beforeEach(async()=>{
 folder=fs.mkdtempSync(path.join(os.tmpdir(),'reviewed-promotion-'));
 target=path.join(folder,'original.db');candidate=path.join(folder,'candidate.db');
 const c=createConnection(target);
 await c.run('CREATE TABLE projects(project_id INTEGER PRIMARY KEY)');
 await c.run('INSERT INTO projects VALUES(1),(2)');
 await c.run('CREATE TABLE future_suppressions(address TEXT PRIMARY KEY, reason TEXT)');
 await c.run("INSERT INTO future_suppressions VALUES('fixture@example.test','unsubscribe')");
 await c.close();fs.copyFileSync(target,candidate);
 const d=createConnection(candidate);await d.run('DELETE FROM projects WHERE project_id=2');await d.close();
 options={targetPath:target,candidatePath:candidate,expectedTargetHash:fileHash(target),expectedCandidateHash:fileHash(candidate),
 validateCandidate:async file=>({match:(await databaseMetrics(file)).counts.projects===1})};
});
afterEach(async()=>{await closeDb();fs.rmSync(folder,{recursive:true,force:true});});
it('promotes a reviewed correction while retaining exact operational rows and rollback backup',async()=>{
 const result=await promoteReviewedCandidate(options);
 expect(result.operationalStatePreserved).toBe(true);expect(fileHash(result.backup)).toBe(options.expectedTargetHash);
 expect(fileHash(target)).toBe(options.expectedCandidateHash);expect((await databaseMetrics(target)).counts.future_suppressions).toBe(1);
 expect(fs.existsSync(target+'.maintenance')).toBe(false);
});
it.each(['prepared','source-moved','installed'])('rolls back failure at %s',async stage=>{
 await expect(promoteReviewedCandidate({...options,onSwapStage:point=>{if(point===stage)throw Error('injected failure');}})).rejects.toThrow('injected failure');
 expect(fileHash(target)).toBe(options.expectedTargetHash);expect(fs.existsSync(target+'.swap.json')).toBe(false);
});
it.each(['prepared','source-moved','installed'])('recovers a terminated process at %s',async stage=>{
 const child=spawnSync(process.execPath,['tests/fixtures/promote-worker.js',target,candidate,options.expectedTargetHash,options.expectedCandidateHash,stage],{encoding:'utf8',env:{...process.env,NODE_ENV:'test'}});
 expect(child.status,child.stderr).toBe(86);
 expect((await recoverReviewedPromotion(target)).recovered).toBe(true);expect(fileHash(target)).toBe(options.expectedTargetHash);
 expect(fs.existsSync(target+'.maintenance')).toBe(false);
});
it('refuses stale hashes, live database handles and altered operational state',async()=>{
 await expect(promoteReviewedCandidate({...options,expectedTargetHash:'0'.repeat(64)})).rejects.toThrow('hash mismatch');
 const c=createConnection(target);await expect(promoteReviewedCandidate(options)).rejects.toThrow('Stop all');await c.close();
 const d=createConnection(candidate);await d.run('DELETE FROM future_suppressions');await d.close();
 await expect(promoteReviewedCandidate({...options,expectedCandidateHash:fileHash(candidate)})).rejects.toThrow('operational records differ');
 expect(fileHash(target)).toBe(options.expectedTargetHash);
});
it('requires explicit permission for a new empty operational table and refuses populated additions',async()=>{
 const c=createConnection(candidate);await c.run('CREATE TABLE job_slots(slot TEXT)');await c.close();
 options.expectedCandidateHash=fileHash(candidate);
 await expect(promoteReviewedCandidate(options)).rejects.toThrow('operational records differ');
 const d=createConnection(candidate);await d.run("INSERT INTO job_slots VALUES('existing claim')");await d.close();
 await expect(promoteReviewedCandidate({...options,expectedCandidateHash:fileHash(candidate),allowEmptyAddedTables:['job_slots']})).rejects.toThrow('operational records differ');
 const e=createConnection(candidate);await e.run('DELETE FROM job_slots');await e.close();
 expect((await promoteReviewedCandidate({...options,expectedCandidateHash:fileHash(candidate),allowEmptyAddedTables:['job_slots']})).promoted).toBe(true);
});
