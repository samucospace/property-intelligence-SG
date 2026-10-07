import {describe,it,expect} from 'vitest';
import {propertyPresentation,mapSearchKey,regionLegend,yieldLegend} from '../../client/src/utils/mapPresentation.js';

describe('Map labels and stable location focus',()=>{
 it('uses the displayed region legend for each sale pin',()=>{
  for(const [index,segment] of ['CCR','RCR','OCR'].entries()) expect(propertyPresentation({segment},'sale')).toMatchObject(regionLegend[index]);
  expect(propertyPresentation({},'sale').label).toBe('Region unavailable');
 });
 it('uses the displayed yield bounds, including missing and zero yields',()=>{
  for(const [value,index] of [[null,3],[undefined,3],[0,2],[3.24,2],[3.25,1],[4.24,1],[4.25,0]]) expect(propertyPresentation({grossYield:value},'rental')).toMatchObject(yieldLegend[index]);
 });
 it('identifies approximate locations so precise distance rings can be withheld',()=>{
  expect(propertyPresentation({locationQuality:'district_centre'},'sale').approximate).toBe(true);
  expect(propertyPresentation({isApproximate:true},'sale').approximate).toBe(true);
  expect(propertyPresentation({locationQuality:'svy21'},'sale').approximate).toBe(false);
 });
 it('keeps map focus stable across non-location changes but detects a new location search',()=>{
  const filters={projects:['BINJAI CREST'],dateFrom:'2022-01-01',page:1};
  expect(mapSearchKey({...filters,page:2,dateFrom:'2023-01-01',priceMin:2000000})).toBe(mapSearchKey(filters));
  expect(mapSearchKey({...filters,projects:['OTHER']})).not.toBe(mapSearchKey(filters));
  expect(mapSearchKey({...filters,radiusKm:1.5,centerCoords:{lat:1.3,lng:103.8}})).not.toBe(mapSearchKey(filters));
 });
});
