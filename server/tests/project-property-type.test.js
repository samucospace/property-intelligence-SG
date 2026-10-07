import {describe,it,expect,beforeEach,afterEach} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {getPrimaryConnection,closeDb} from '../db.js';
import {runMigrations} from '../migrations/index.js';
import {getPriceAnalytics,getRentalYieldAnalytics} from '../queryEngine.js';

describe('Named project coverage across property types',()=>{
 let folder,previous,db;
 beforeEach(async()=>{
  await closeDb();previous=process.env.DB_PATH;
  folder=fs.mkdtempSync(path.join(os.tmpdir(),'project-type-'));
  process.env.DB_PATH=path.join(folder,'fixture.sqlite');db=getPrimaryConnection();await runMigrations(db);
  for(const [id,name,type,rentalType] of [[1,'STRATA FIXTURE','Strata Terrace','Terrace House'],[2,'CONDO FIXTURE','Apartment','Non-landed Properties'],[3,'EC FIXTURE','Executive Condominium','Executive Condominium']]) {
   await db.run("INSERT INTO projects(project_id,project_name,street_name,postal_district,market_segment,is_landed_aggregate) VALUES(?,?,'FIXTURE ROAD','21','RCR',0)",[id,name]);
   for(let n=0;n<3;n++) {
    await db.run("INSERT INTO property_transactions(project_id,contract_date,price_sgd,area_sqft,area_sqm,psft_sgd,psqm_sgd,no_of_units,property_type) VALUES(?,'2026-06-01',2000000,2000,185.806,1000,10763.9,1,?)",[id,type]);
    await db.run("INSERT INTO rental_transactions(project_id,lease_date,rent_sgd,area_sqft,area_sqm,rent_psft,rent_psqm,property_type) VALUES(?,'2026-06',8000,2000,185.806,4,43.0556,?)",[id,rentalType]);
   }
  }
 });
 afterEach(async()=>{await closeDb();process.env.DB_PATH=previous;fs.rmSync(folder,{recursive:true,force:true});});
 const dates={dateFrom:'2026-01-01',dateTo:'2026-10-07'};
 it('returns strata landed sales, rentals and map points for a selected project without a hidden condo restriction',async()=>{
  const filters={...dates,projects:['STRATA FIXTURE']};
  const sales=await getPriceAnalytics(filters),rentals=await getRentalYieldAnalytics(filters);
  expect(sales.totalCount).toBe(3);expect(sales.mapProjects.map(p=>p.id)).toEqual([1]);
  expect(rentals.totalCount).toBe(3);expect(rentals.mapProjects.map(p=>p.id)).toEqual([1]);
  expect(rentals.summary.grossYieldPct).toBe(4.8);
 });
 it('includes executive condominiums in project selection',async()=>{
  expect((await getPriceAnalytics({...dates,projects:['EC FIXTURE']})).totalCount).toBe(3);
  expect((await getRentalYieldAnalytics({...dates,projects:['EC FIXTURE']})).totalCount).toBe(3);
 });
 it('honours an explicit property restriction even for a selected landed project',async()=>{
  for(const query of [getPriceAnalytics,getRentalYieldAnalytics]) {
   expect((await query({...dates,projects:['STRATA FIXTURE'],propertyType:'condo'})).totalCount).toBe(0);
   expect((await query({...dates,projects:['STRATA FIXTURE'],propertyType:'landed'})).totalCount).toBe(3);
  }
 });
 it('preserves the nationwide condo default and allows an explicit all-types overview',async()=>{
  for(const query of [getPriceAnalytics,getRentalYieldAnalytics]) {
   expect((await query(dates)).mapProjects.map(p=>p.id)).toEqual([2]);
   expect((await query({...dates,propertyType:'all'})).totalCount).toBe(9);
  }
 });
 it('includes unknown-area leases in rent counts and medians but withholds their rates and yield',async()=>{
  await db.run("INSERT INTO rental_transactions(project_id,lease_date,rent_sgd,property_type) VALUES(1,'2026-06',10000,'Terrace House')");
  const filters={...dates,projects:['STRATA FIXTURE'],unitSizeMax:null};
  const data=await getRentalYieldAnalytics(filters);
  expect(data.totalCount).toBe(4);expect(data.summary.unknownAreaLeases).toBe(1);expect(data.summary.medianRent).toBe(8000);
  const unknown=data.rentalCaveats.find(r=>r.areaSqft==null);expect(unknown.rentPsft).toBeNull();expect(unknown.grossYield).toBeNull();
  expect(data.mapProjects[0].usableRentalCount).toBe(3);expect(data.summary.grossYieldPct).toBe(4.8);
  expect((await getRentalYieldAnalytics({...filters,unitSizeMax:10000})).totalCount).toBe(3);
  expect((await getRentalYieldAnalytics({...filters,unitSizeMin:100})).totalCount).toBe(3);
 });
 it('respects a zero size cap instead of converting it to a hidden default',async()=>{
  expect((await getRentalYieldAnalytics({...dates,unitSizeMax:0})).totalCount).toBe(0);
  expect((await getPriceAnalytics({...dates,unitSizeMax:0})).totalCount).toBe(0);
  expect((await getPriceAnalytics({...dates,projects:['STRATA FIXTURE'],unitSizeMax:null})).totalCount).toBe(3);
 });
 it('returns disjoint pages with complete summaries and maps for sales and rentals',async()=>{
  for(const [query,rows,id] of [[getPriceAnalytics,'scatterPoints','id'],[getRentalYieldAnalytics,'rentalCaveats','rentalId']]) {
   const first=await query({...dates,projects:['STRATA FIXTURE'],limit:2,page:1});
   const second=await query({...dates,projects:['STRATA FIXTURE'],limit:2,page:2});
   expect(first.totalCount).toBe(3);expect(second.totalPages).toBe(2);expect(first[rows]).toHaveLength(2);expect(second[rows]).toHaveLength(1);
   expect(new Set([...first[rows],...second[rows]].map(r=>r[id])).size).toBe(3);
   expect(first.summary).toEqual(second.summary);expect(first.mapProjects).toEqual(second.mapProjects);
  }
 });
});
