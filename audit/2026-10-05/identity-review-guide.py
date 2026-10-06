"""Create a readable decision guide; never record approvals or mutate databases."""
import json
import math
from pathlib import Path

root = Path(__file__).resolve().parents[2]
mapping = json.loads((root / 'server/migrations/data/project_adjudication_map.json').read_text())
recorded_approvals = sum(e['status'] == 'approved' for e in mapping['entries'])

def distance(a, b):
    if any(p.get(k) is None for p in (a, b) for k in ('latitude', 'longitude')):
        return None
    lat1, lat2 = map(math.radians, (a['latitude'], b['latitude']))
    dlat = lat2 - lat1
    dlng = math.radians(b['longitude'] - a['longitude'])
    h = math.sin(dlat / 2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(dlng / 2)**2
    return 6371000 * 2 * math.atan2(math.sqrt(h), math.sqrt(1-h))

lines = [
    '# Phase 2 project identity decision guide',
    '',
    f'Updated 5 October 2026 for Sam Fraser. **Recorded approvals: {recorded_approvals} of {len(mapping["entries"])}. Recommendations are separate from recorded decisions. All 35 decisions are applied locally; see the final Phase 2 completion report and promotion evidence.**',
    '',
    '## What you are deciding',
    '',
    'The earlier implementation already combined each pair of catalog records. You are deciding whether the evidence is sufficient to accept that combined record as one URA-reported project/estate for calculations. You are not certifying individual unit valuations or authorizing a deployment.',
    '',
    '- **Approve:** accept that these two records describe the same reported project. Their combined transactions may be used once the reviewed decision is safely applied and normal sample/location rules pass.',
    '- **Keep excluded:** leave the combined project out of public analytics while more evidence is obtained. This preserves records; it does not undo the earlier merge or delete transactions.',
    '- **Known conflict:** if you know they represent different projects, record that fact and investigate restoration of ownership from the saved baseline. Do not automatically split the records without checking the individual transactions.',
    '',
    'All 35 pairs have the same project name, equivalent street spelling after the Saint/Street correction, and a retained known district compatible with the captured URA data. One original district is unknown in every pair; that unknown value is not a second independent confirmation.',
    '',
    'The street spelling difference is `ST.` versus the erroneous expansion `STREET.`. For these names the corrected spelling is `SAINT` (for example, Saint Michael\'s Road). Different project names on the same street are never being combined with one another.',
    '',
    'Matching original coordinates plus matching URA name/street evidence provide the strongest support here. A distance below 100m was only a screening flag. It is not a property boundary and does not by itself justify approval. This guide therefore recommends holding three pairs with materially different original positions as well as the six missing-position pairs.',
    '',
    '## Each decision',
    '',
    '“Moved” counts are transactions transferred from the removed original record during the earlier merge, not all transactions held by the surviving project. Zero means a duplicate catalog row was removed without moving transactions.',
    '',
    '| # | Project | Corrected street; URA district | Evidence and remaining doubt | Original records moved | Recommendation | Recorded decision |',
    '|---|---|---|---|---|---|---|',
]
approve = hold = 0
for number, entry in enumerate(mapping['entries'], 1):
    a, b, evidence = entry['baselineSource'], entry['baselineTarget'], entry['currentSourceEvidence']
    metres = distance(a, b)
    street = a['street_name'].replace('STREET.', 'SAINT').replace('ST.', 'SAINT')
    district = ', '.join(evidence['districts'])
    moved = f"{entry['baselineSalesMoved']} sales; {entry['baselineRentalsMoved']} rentals"
    if metres is None:
        reason = 'Name/street support; surviving location matches URA. Removed record has no saved location, so its location cannot be independently compared.'
        recommendation = 'Keep excluded'
        hold += 1
    elif metres >= 1:
        reason = f'Original positions differ by {metres:.1f}m. Name/street support is present, but project boundary/block or estate evidence should explain this difference before approval.'
        if entry['projectName'] == "ST ANNE'S WOOD":
            reason += ' Removed position is also about 10m from its nearest current URA position; this may be an estate-level reporting location.'
        if entry['projectName'] == 'ST THOMAS VILLE':
            reason += ' Both positions occur in the provider evidence; clarify whether they represent blocks of the same project.'
        recommendation = 'Keep excluded'
        hold += 1
    else:
        reason = 'Original positions are identical and match a retained URA position; name/street also agree.' if metres == 0 else f'Original positions differ by only {metres:.2f}m (rounding scale); name/street and URA location support agree.'
        recommendation = 'Approve'
        approve += 1
    decision = f"Approved by {entry['approvedBy']} on {entry['approvedAt']}" if entry['status'] == 'approved' else 'Pending'
    lines.append(f"| {number} | {entry['projectName']} | {street}; D{district} | {reason} | {moved} | {recommendation} | {decision} |")
lines += [
    '',
    f'**Original recommendation totals: {approve} approvals; {hold} continued exclusions. Recorded approvals: {recorded_approvals}; all 35 are applied locally.**',
    '',
    '## Worked example: decision 1',
    '',
    'ST MICHAEL REGENCY had one record under `ST. MICHAEL\'S ROAD` and another under `STREET. MICHAEL\'S ROAD`. Both use the same project name. Their saved positions differ by about 6cm, consistent with rounding. The current URA response supports that name/street and the retained district 12. The earlier merge moved 12 sales and no rentals.',
    '',
    '**My recommendation: approve treating the two records as the same project.** The decision accepts the identity match, not the value or yield of the project. Keeping it excluded is also permitted if Sam prefers more evidence.',
    '',
    '## Evidence limitations retained with the decisions',
    '',
    'AIRSTREAM, ST MICHAEL\'S CONDOMINIUM, ONE ST MICHAEL\'S, GRANGE HEIGHTS, ST THOMAS SUITES and SKYLINE 360 @ SAINT THOMAS WALK lack an original location on the removed record. That is missing evidence, not proof of a wrong merge. Sam explicitly accepted each of these merges after the limitation was disclosed; the missing evidence remains recorded.',
    '',
    'ESPADA, ST ANNE\'S WOOD and ST THOMAS VILLE have different original positions. A revised reporting point, multiple blocks or an estate could explain them, but this guide does not assert that explanation as established fact. Sam explicitly accepted all three merges after the differences were disclosed. Recorded decisions supersede the earlier recommendations; the decisions are applied locally with these limitations retained.',
    '',
    '## Evidence and recording decisions',
    '',
    'The [adjudication map](server/migrations/data/project_adjudication_map.json) contains original IDs, original coordinates, individual response filenames, provider coordinates and review fields. The [Phase 2 report](PHASE_2_COMPLETION_REPORT_2026-10-05.md) describes the source comparison and preservation checks.',
    '',
    'Sam can approve by decision number/project name, or approve a named group after reviewing this guide. Only an explicit answer will be recorded as approval, with reviewer, date and evidence. A recommendation in this guide is not an approval. Database changes and promotion are separate steps.',
]
(root / 'PHASE_2_IDENTITY_REVIEW_GUIDE.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
print(json.dumps({'recommendApprove': approve, 'recommendKeepExcluded': hold, 'recordedApprovals': recorded_approvals}))
