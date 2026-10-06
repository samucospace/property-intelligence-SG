"""Independent arithmetic from raw transaction values, without application helpers."""
import json, pathlib, sqlite3, statistics
folder=pathlib.Path(__file__).resolve().parent
db=sqlite3.connect((folder/'phase2-source-candidate-final-approved.sqlite').as_uri()+'?mode=ro',uri=True)
project=3515
sales=[r[0] for r in db.execute("SELECT psft_sgd FROM property_transactions WHERE project_id=? AND contract_date BETWEEN '2024-10-01' AND '2026-09-30' AND price_sgd>0 AND psft_sgd>0 AND (no_of_units=1 OR no_of_units IS NULL) AND area_sqm BETWEEN 0 AND ?",[project,100000/10.7639])]
rents=[r[0] for r in db.execute("SELECT rent_psft FROM rental_transactions WHERE project_id=? AND substr(lease_date,1,7) BETWEEN '2025-10' AND '2026-09' AND rent_psft>0",[project])]
total=db.execute("SELECT COUNT(*) FROM rental_transactions WHERE project_id=? AND substr(lease_date,1,7) BETWEEN '2025-10' AND '2026-09'",[project]).fetchone()[0]
assert len(sales)>=3 and len(rents)>=3
rent_median=round(statistics.median(rents),2)
result={'projectId':project,'filters':{'projects':[project],'propertyType':'all','dateFrom':'2025-10-01','dateTo':'2026-09-30'},'saleCount':len(sales),'rentalCount':len(rents),'totalLeases':total,'medianSalePsft':statistics.median(sales),'medianRentPsft':rent_median,'grossYield':round(rent_median*1200/statistics.median(sales),2),'method':'Python statistics.median over raw database values; no application metric helpers'}
(folder/'phase2-final-api-expected.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
db.close()
