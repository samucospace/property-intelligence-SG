const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.argv[2]);
const base=process.argv[3],output=process.argv[4];
const passwordPath=process.argv[5];
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const evidence={checkedAt:new Date().toISOString(),base,checks:[],errors:[],externalTiles:'replaced with blank test tiles; real Leaflet events/analytics'};
 try {
  for(const [name,viewport] of [['desktop',{width:1440,height:1100}],['mobile',{width:390,height:844}]]) {
   const context=await browser.newContext({viewport,...(passwordPath?{httpCredentials:{username:'sam',password:fs.readFileSync(passwordPath,'utf8').trim()}}:{})});
   await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin===base||['data:','blob:'].includes(url.protocol))return route.continue();
    if(route.request().resourceType()==='image')return route.fulfill({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJZ8AAAAASUVORK5CYII=','base64')});
    return route.fulfill({status:200,body:'',contentType:'text/plain'});
   });
   const page=await context.newPage();page.setDefaultTimeout(60000);page.on('pageerror',error=>evidence.errors.push(error.message));
   let requests=0;page.on('request',request=>{if(request.url().includes('/api/analytics/'))requests++;});
   const settled=()=>page.waitForFunction(()=>![...document.querySelectorAll('[role=status]')].some(node=>node.textContent.startsWith('Loading')));
   const project=passwordPath?'BINJAI CREST':'MAP QA 1';
   await page.goto(base+'/?project='+encodeURIComponent(project));await page.locator('.leaflet-container').waitFor();await settled();
   const marker=page.locator(`.leaflet-marker-icon[alt="${project} property details"]`);await marker.waitFor();
   for(const label of ['MRTs','Schools','Hawkers','Supermarkets','Parks']) assert.equal(await page.getByRole('button',{name:label,exact:true}).getAttribute('aria-pressed'),'false');
   assert.equal(await page.locator('.leaflet-marker-icon[alt$="amenity details"]').count(),0);
   await page.getByRole('button',{name:'MRTs',exact:true}).click();
   assert.equal(await page.getByRole('button',{name:'MRTs',exact:true}).getAttribute('aria-pressed'),'true');
   assert.ok(await page.locator('.leaflet-marker-icon[alt$="amenity details"]').count()>0);
   await page.getByRole('button',{name:'MRTs',exact:true}).click();
   await page.locator('.leaflet-container').scrollIntoViewIfNeeded();
   await page.waitForTimeout(1400); // Let the deliberate initial location animation finish.
   if(name==='desktop') {await marker.hover();await page.locator('.leaflet-tooltip').filter({hasText:project}).waitFor();}
   const originalUrl=page.url(),beforeRequests=requests;
   const tileTransform=()=>page.locator('.leaflet-tile-container').first().getAttribute('style');
   const transform=await tileTransform();
   await marker.click();await page.getByRole('region',{name:'Property details',exact:true}).waitFor();
   assert.equal(page.url(),originalUrl);assert.equal(requests,beforeRequests);assert.equal(await page.locator('.map-distance-ring').count(),0);
   assert.equal(await tileTransform(),transform);
   await page.getByRole('button',{name:'Show distance rings',exact:true}).click();await page.locator('.map-distance-ring').first().waitFor();
   assert.equal(await page.locator('.map-distance-ring').count(),2);
   await page.getByRole('button',{name:'Close property details',exact:true}).click();await page.locator('.map-distance-ring').first().waitFor({state:'detached'});
   assert.equal(page.url(),originalUrl);assert.equal(await tileTransform(),transform);
   await marker.click();await page.getByRole('button',{name:'Show distance rings',exact:true}).click();
   await page.getByRole('button',{name:'Close property details',exact:true}).click();assert.equal(await page.locator('.map-distance-ring').count(),0);
   const map=page.locator('.leaflet-container');
   await map.click({position:{x:30,y:280}});await settled();
   await page.locator('.map-search-ring').waitFor();assert.ok(new URL(page.url()).searchParams.has('radiusKm'));
   assert.equal(await tileTransform(),transform);
   await page.getByRole('button',{name:'Clear map search',exact:true}).click();await settled();await page.locator('.map-search-ring').waitFor({state:'detached'});
   // Cluster navigation and marker inspection must never create a new radius search.
   if(!passwordPath) {
    await page.goto(base);await settled();const cluster=page.locator('.property-cluster').first();await cluster.waitFor();
    if(name==='desktop'){await cluster.hover();await page.locator('.leaflet-tooltip').filter({hasText:'developments grouped here'}).waitFor();}
    const clusterUrl=page.url(),clusterRequests=requests;await cluster.click();
    await page.waitForTimeout(1200);assert.equal(page.url(),clusterUrl);assert.equal(requests,clusterRequests);assert.equal(await page.locator('.map-search-ring').count(),0);
    await page.goto(base+'/?project=MAP%20QA%2015');await settled();
    const approx=page.locator('.leaflet-marker-icon[alt="MAP QA 15 property details"]');await approx.waitFor();await approx.click();
    await page.getByText('Distance rings are unavailable for approximate locations.').waitFor();assert.equal(await page.getByRole('button',{name:'Show distance rings',exact:true}).count(),0);
   }
   await page.goto(base+'/?project='+encodeURIComponent(project));await settled();await page.locator(`.leaflet-marker-icon[alt="${project} property details"]`).waitFor();
   await page.locator(`.leaflet-marker-icon[alt="${project} property details"]`).click();
   const filterResponse=page.waitForResponse(response=>response.url().endsWith('/api/analytics/map')&&response.status()===200);
   await page.getByRole('button',{name:'Show only this development',exact:true}).click();await filterResponse;await settled();
   assert.equal(new URL(page.url()).searchParams.get('project'),project);assert.equal(await page.getByRole('region',{name:'Property details',exact:true}).count(),0);
   const overflow=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth}));assert.ok(overflow.width<=overflow.viewport+1);
   await page.locator('.card').filter({has:page.getByText('Property map',{exact:true})}).screenshot({path:output+'/map-ux-'+name+(passwordPath?'-staging':'-local')+'.png'});
   evidence.checks.push({viewport:name,amenitiesHiddenByDefault:true,amenityToggle:true,propertyHover:name==='desktop',inspectionNoSearch:true,inspectionNoViewportReset:true,ringsOptInAndClose:true,clearInspection:true,radiusInPlaceAndClear:true,clusters:!passwordPath,approximateRingsWithheld:!passwordPath,explicitFilter:true,overflow});
   await context.close();
  }
  assert.deepEqual(evidence.errors,[]);evidence.passed=true;
 } finally {await browser.close();fs.writeFileSync(output+'/map-ux-'+(passwordPath?'staging':'local')+'-results.json',JSON.stringify(evidence,null,2));}
 console.log(JSON.stringify(evidence,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
