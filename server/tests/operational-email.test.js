import {describe,it,expect,afterEach,vi} from 'vitest';
import {sendOperationalAlert} from '../utils/operationalAlerts.js';
import {releaseFeatures} from '../utils/releasePolicy.js';
const issue={key:'backup-stale',event:'raised',summary:'No successful encrypted offsite backup within 26 hours',severity:'critical'};
function configure() {
  for(const [name,value] of Object.entries({NODE_ENV:'production',RELEASE_SCOPE:'analytics-readonly',ENABLE_OUTBOUND_EMAIL:'false',ENABLE_OPERATIONS_MONITORING:'true',OPERATIONS_ALERT_TRANSPORT:'email',
    OPERATIONS_RESEND_API_KEY:'re_fixture_operator_alert',OPERATIONS_ALERT_EMAIL_FROM:'ops@example.invalid',OPERATIONS_ALERT_EMAIL_TO:'operator@example.invalid',MOCK_OPERATIONS_ALERTS:'false'})) vi.stubEnv(name,value);
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
describe('Operator email alerts independently contained from customer email',()=>{
  it('sends only to the configured operator with a stable idempotency key while lead capture/sending remain disabled',async()=>{
    configure();const network=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({id:'provider-fixture-id'}),{status:200}));
    expect(await sendOperationalAlert(issue,{idempotencyKey:'stable-fixture-key'})).toEqual({accepted:true,providerMessageId:'provider-fixture-id'});
    expect(releaseFeatures()).toMatchObject({leadCapture:false,outboundEmail:false});
    const [url,options]=network.mock.calls[0];expect(url).toBe('https://api.resend.com/emails');
    expect(JSON.parse(options.body)).toMatchObject({to:['operator@example.invalid'],from:'ops@example.invalid'});
    expect(options.headers['Idempotency-Key']).toBe('stable-fixture-key');expect(options.signal).toBeInstanceOf(AbortSignal);
  });
  it('never calls a real service in staging, test or explicitly mocked operations',async()=>{
    configure();const network=vi.spyOn(globalThis,'fetch');
    for(const environment of ['test','staging']) {vi.stubEnv('NODE_ENV',environment);expect(await sendOperationalAlert(issue)).toEqual({mocked:true,accepted:false});}
    vi.stubEnv('NODE_ENV','production');vi.stubEnv('MOCK_OPERATIONS_ALERTS','true');
    expect(await sendOperationalAlert(issue)).toEqual({mocked:true,accepted:false});expect(network).not.toHaveBeenCalled();
  });
  it('rejects incomplete or misspelled configuration before sending',async()=>{
    configure();const network=vi.spyOn(globalThis,'fetch');vi.stubEnv('OPERATIONS_ALERT_EMAIL_TO','');
    await expect(sendOperationalAlert(issue)).rejects.toThrow(/not configured/);
    vi.stubEnv('OPERATIONS_ALERT_EMAIL_TO','operator@example.invalid');vi.stubEnv('OPERATIONS_RESEND_API_KEY','');
    await expect(sendOperationalAlert(issue)).rejects.toThrow(/not configured/);
    vi.stubEnv('OPERATIONS_ALERT_TRANSPORT','emial');await expect(sendOperationalAlert(issue)).rejects.toThrow(/Unknown/);
    expect(network).not.toHaveBeenCalled();
  });
  it('rejects disabled monitoring before sending',async()=>{
    configure();vi.stubEnv('ENABLE_OPERATIONS_MONITORING','false');const network=vi.spyOn(globalThis,'fetch');
    await expect(sendOperationalAlert(issue)).rejects.toThrow(/disabled/);expect(network).not.toHaveBeenCalled();
  });
  it('leaves provider failure or missing receipt retryable rather than inventing acceptance',async()=>{
    configure();const network=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('{}',{status:503}));
    await expect(sendOperationalAlert(issue)).rejects.toThrow(/503/);
    network.mockResolvedValue(new Response('{}',{status:200}));await expect(sendOperationalAlert(issue)).rejects.toThrow(/message ID/);
  });
  it('preserves HTTPS webhook support for an independently selected transport',async()=>{
    configure();vi.stubEnv('OPERATIONS_ALERT_TRANSPORT','webhook');vi.stubEnv('OPERATIONS_ALERT_WEBHOOK_URL','https://alerts.example.invalid/hook');
    const network=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('',{status:200}));
    expect(await sendOperationalAlert(issue)).toEqual({accepted:true});expect(network.mock.calls[0][0]).toBe('https://alerts.example.invalid/hook');
    expect(network.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });
});
