import {describe,it,expect} from 'vitest';
import {defaultFilters,readSearchFilters,writeSearchFilters,selectLocation,updateSearchFilters} from '../../client/src/utils/searchState.js';

describe('Shareable search state and location replacement',()=>{
 it('round-trips all active filter settings including pages and radius coordinates',()=>{
  const filters={...defaultFilters(),projects:['A','B'],propertyType:'all',street:'TEST ROAD',district:21,planningArea:'BUKIT TIMAH',
   dateFrom:'2022-01-01',dateTo:'2026-10-07',tenure:'leasehold',bedroomCount:'3-Bedder',unitSizeMin:500,unitSizeMax:3000,
   priceMin:4000,priceMax:10000,radiusKm:1.5,centerCoords:{lat:1.3,lng:103.8},page:3,limit:100};
  const search=writeSearchFilters(filters,'rental','?q=old&enquire=1');
  expect(readSearchFilters(search)).toEqual(filters);expect(new URLSearchParams(search).get('mode')).toBe('rental');
  expect(new URLSearchParams(search).has('q')).toBe(false);
 });
 it('accepts legacy project links without inventing a floor-area limit',()=>{
  const filters=readSearchFilters('?project=BINJAI%20CREST');
  expect(filters.projects).toEqual(['BINJAI CREST']);expect(filters.propertyType).toBe('all');expect(filters.unitSizeMax).toBeNull();
  expect(readSearchFilters('')).toEqual(defaultFilters());
 });
 it('preserves zero bounds and ignores malformed or unsupported URL settings',()=>{
  expect(readSearchFilters('?unitSizeMax=0&priceMin=0').unitSizeMax).toBe(0);
  const f=readSearchFilters('?page=-1&limit=500&dateFrom=2026-02-31&propertyType=bad&radiusKm=9&centerCoords=bad');
  expect(f.page).toBe(1);expect(f.limit).toBe(100);expect(f.propertyType).toBe('condo');expect(f.radiusKm).toBeNull();expect(f.dateFrom).toBe(defaultFilters().dateFrom);
 });
 it('replaces incompatible locations and radius while keeping non-location criteria',()=>{
  const prev={...defaultFilters(),projects:['A'],street:'OLD',district:1,planningArea:'OLD AREA',radiusKm:1,centerCoords:{lat:1,lng:2},page:3,tenure:'leasehold'};
  for(const selection of [{street:'NEW'},{district:21},{planningArea:'NEW AREA'},{projects:['B']}]) {
   const f=selectLocation(prev,selection);
   expect(f).toMatchObject({projects:[],street:null,district:null,planningArea:null,radiusKm:null,centerCoords:null,page:1,tenure:'leasehold',...selection});
  }
 });
 it('resets the page when criteria change but allows deliberate next-page navigation',()=>{
  const f={...defaultFilters(),page:3};
  expect(updateSearchFilters(f,p=>({...p,tenure:'leasehold'})).page).toBe(1);
  expect(updateSearchFilters(f,p=>({...p,page:4})).page).toBe(4);
 });
});
