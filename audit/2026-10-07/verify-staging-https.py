"""Verify the protected staging boundary without printing credentials."""
import base64
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

origin = 'https://staging.homeintel.sg'
password = Path(sys.argv[1]).read_text(encoding='utf-8-sig').strip()
auth = 'Basic ' + base64.b64encode(('sam:' + password).encode()).decode()
results = []

def check(name, path, expected, authenticated=False, method='GET', headers=None):
    request_headers = dict(headers or {})
    if authenticated:
        request_headers['Authorization'] = auth
    req = urllib.request.Request(origin + path, headers=request_headers, method=method,
                                 data=b'{}' if method == 'POST' else None)
    try:
        response = urllib.request.urlopen(req, timeout=30)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        body = response.read()
        status = response.status
        results.append({'check': name, 'status': status, 'passed': status == expected})
        if status != expected:
            raise RuntimeError('Unexpected response for ' + name + ': ' + str(status))
        return body, response.headers

for path in ['/', '/api/features', '/api/health/ready', '/api/admin/login']:
    check('anonymous ' + path, path, 401)
check('wrong password', '/', 401, headers={'Authorization': 'Basic c2FtOmluY29ycmVjdA=='})
html, headers = check('authenticated homepage', '/', 200, True)
assert 'noindex' in headers.get('X-Robots-Tag', '')
assert 'Content-Security-Policy' in headers
assets = re.findall(r'(?:src|href)="(/assets/[^"<>]+)"', html.decode())
assert assets, 'Built frontend assets missing'
for asset in assets:
    check('frontend asset', asset, 200, True)
body, headers = check('readiness over verified TLS', '/api/health/ready', 200, True)
assert json.loads(body)['ready'] is True
body, headers = check('read-only features and allowed origin', '/api/features', 200, True,
                      headers={'Origin': origin})
features = json.loads(body)
assert features['leadCapture'] is False and features['outboundEmail'] is False
assert headers.get('Access-Control-Allow-Origin') == origin
_, headers = check('foreign origin excluded', '/api/features', 200, True,
                   headers={'Origin': 'https://untrusted.example'})
assert headers.get('Access-Control-Allow-Origin') is None
check('lead submission disabled', '/api/leads/submit', 403, True, 'POST',
      {'Content-Type': 'application/json'})
check('admin gateway forgery contained', '/api/admin/login', 403, True, 'POST',
      {'Content-Type': 'application/json', 'X-Admin-Gateway': 'forged'})
check('ingestion disabled', '/api/ingest/import-data', 403, True, 'POST',
      {'Content-Type': 'application/json'})
print(json.dumps({'checkedAtUTC': datetime.now(timezone.utc).isoformat(),
                  'origin': origin, 'certificateVerification': True,
                  'checks': results, 'passed': True}, indent=2))
