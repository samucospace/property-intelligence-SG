"""Bind final local evidence, including metadata-only map status update."""
import hashlib,json,pathlib,sqlite3,datetime,re
root=pathlib.Path(__file__).resolve().parents[2]
folder=pathlib.Path(__file__).resolve().parent
load=lambda file:json.loads(file.read_text(encoding='utf-8'))
digest=lambda file:hashlib.sha256(file.read_bytes()).hexdigest()
promotion=load(folder/'phase2-final-promotion.json')
preparation=load(folder/'phase2-final-candidate.json')
target=root/'server/property.db'
assert digest(target)==promotion['sha256']==preparation['candidateSha256']
assert digest(pathlib.Path(promotion['rollbackBackupPath']))==preparation['originalSha256']
assert not target.with_name(target.name+'.maintenance').exists()
assert not target.with_name(target.name+'.swap.json').exists()
with sqlite3.connect(target.as_uri()+'?mode=ro&immutable=1',uri=True) as db:
    assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    assert not list(db.execute('PRAGMA foreign_key_check'))
    counts={table:db.execute('SELECT COUNT(*) FROM '+table).fetchone()[0] for table in ['projects','property_transactions','rental_transactions','schema_migrations']}
    assert counts=={'projects':5905,'property_transactions':132305,'rental_transactions':451165,'schema_migrations':14}
    assert db.execute("SELECT COUNT(*) FROM project_identity_review WHERE status='approved' AND reviewed_by='Sam Fraser'").fetchone()[0]==35
    assert db.execute("SELECT COUNT(*) FROM project_identity_review WHERE status='pending'").fetchone()[0]==0
def last_json(name):
    return json.loads(next(line for line in reversed((folder/name).read_text(encoding='utf-8').splitlines()) if line.startswith('{')))
startup=json.loads((folder/'docker-phase2-final-startup.log').read_text(encoding='utf-8'))
assert startup['passed'] and all(r['passed'] for kind in ['fresh','existing','concurrent'] for r in startup[kind])
production=last_json('docker-phase2-final-production.log');data_api=last_json('docker-phase2-final-data.log')
assert production['passed'] and data_api['passed']
local_api=load(folder/'phase2-final-local-api.json');assert local_api['passed']
for name in ['phase2-final-tests.log','docker-phase2-final-tests.log']:
    log=re.sub(r'\x1b\[[0-9;]*m','',(folder/name).read_text(encoding='utf-8'));assert '189 passed (189)' in log and '15 passed (15)' in log
assert 'built in' in (folder/'phase2-final-client-build.log').read_text(encoding='utf-8')
mapping=root/'server/migrations/data/project_adjudication_map.json'
assert len(load(mapping)['entries'])==35 and all(e['status']=='approved' for e in load(mapping)['entries'])
baseline_mapping=pathlib.Path(preparation['backup']['encryptedBackup']).parent/'working-tree/server/migrations/data/project_adjudication_map.json'
assert digest(baseline_mapping)==preparation['approvalSha256']
assert load(baseline_mapping)['entries']==load(mapping)['entries']
report={'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'phase2LocalComplete':True,'publicRelease':'NO-GO','counts':counts,'approvedReviews':35,'pendingReviews':0,'databaseSha256':digest(target),'originalRollbackSha256':digest(pathlib.Path(promotion['rollbackBackupPath'])),'preparationApprovalMapSha256':preparation['approvalSha256'],'finalApprovalMapSha256':digest(mapping),'approvalMapChangeAfterPromotion':'Root status text only; reviewer decisions and evidence unchanged. Final image rebuilt and requalified.','releaseImage':load(folder/'phase2-final-image-identities.json')['releaseImage'],'testImage':load(folder/'phase2-final-image-identities.json')['testImage'],'windowsTests':189,'linuxTests':189,'testFiles':15,'startup':startup,'productionSmoke':production,'linuxRealDataApi':data_api,'localPromotedDataApi':local_api,'build':'passed with existing frontend bundle warning','preservation':preparation['preservation'],'freshProcessEncryptedRestore':True,'scheduledImportsMailCleanupEnabled':False,'deployment':'not performed','commitPush':'not performed','logs':{name:digest(folder/name) for name in ['phase2-final-tests.log','docker-phase2-final-tests.log','docker-phase2-final-startup.log','docker-phase2-final-production.log','docker-phase2-final-data.log','phase2-final-client-build.log']}}
(folder/'phase2-final-qualification.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
(root/'DOCKER_QUALIFICATION_REPORT_2026-10-05.md').write_text(f'''# Docker release-image qualification — 5 October 2026

**Passed locally on Docker Desktop, Linux/amd64, Node 22.23.3.** Final qualification includes the completed identity map and corrected backup-path reporting. This is working-tree evidence; no published commit, CI run, deployment or public launch is claimed.

Release image: `{report['releaseImage']['tag']}`, ID `{report['releaseImage']['id']}`. Disposable test derivative: `{report['testImage']['tag']}`, ID `{report['testImage']['id']}`. [Final machine-readable evidence](audit/2026-10-05/phase2-final-qualification.json) binds image identities, logs, database hashes and results. Earlier [qualification evidence](audit/2026-10-05/docker-qualification.json) is historical.

| Check | Result |
|---|---|
| Release build and frontend compilation | Passed with pinned runtime and locked dependencies; existing bundle-size warning remains. |
| Repeated startup in the exact final release image | 20 fresh, five existing and five concurrent starts passed. |
| Production smoke and packaging | Passed as non-root node (UID 1000), read-only root, disposable database, generated temporary secrets, networking disabled. Health and compiled frontend return HTTP 200. Local environment/database absent; required fixture/map present. |
| Final Linux suite | 189/189 tests in 15 files passed in the disposable derivative. Recovery, interrupted/concurrent migrations, scheduling, operational preservation and nine reviewed-promotion tests pass. |
| Windows suite | 189/189 tests in 15 files passed on Node 22.23.3. |
| Promoted real-data HTTP check | Read-only database mount, disposable copy in tmpfs, no external network. All 35 approvals visible. Independent Python median arithmetic matches API: ST MICHAEL REGENCY, four matched sales/four usable rents, 3.02% median project gross yield. |
| Local promoted database | Hash verified against final candidate, integrity OK, no foreign-key violations; original rollback hash and fresh-process encrypted restore verified. |

Production/startup/data checks use read-only container roots. The test derivative has writable isolated caches and Git/development dependencies; these are absent from the release image. Its initial read-only-cache failure was corrected before the successful suite. All containers use `--rm`; no image was pushed and no services remain running from these checks.

The earlier packaging failure found that nested local environment files were not excluded. Docker ignore rules were corrected and final absence checks pass. The failed image was not published. No real credentials were mounted, no external provider calls/email were enabled, and the market file was mounted read-only solely to create a disposable validation copy.

The reviewed snapshot is now promoted **locally**, with all identity approvals applied. General rebuild and scheduled sync remain quarantined. Proxy/TLS, persistent-volume ownership/storage, service separation, scheduled timing, encrypted/off-host backup configuration and actual-host recovery remain private-deployment checks. Public launch remains NO-GO pending later phases; Phase 3 retains email, consent, access and recovery.
''',encoding='utf-8')
print(json.dumps({'phase2LocalComplete':True,'counts':counts,'approved':35,'pending':0,'integrity':'ok','databaseHashVerified':True,'rollbackHashVerified':True,'windowsTests':189,'linuxTests':189}))
