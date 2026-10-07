const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.argv[2]);
const password=fs.readFileSync(process.argv[3],'utf8').trim(),output=process.argv[4];
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const evidence={checkedAt:new Date().toISOString(),checks:[],errors:[],externalAssets:'blocked'};
 const base='https://staging.homeintel.sg';
 try {
  for(const [name,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]) {
   const context=await browser.newContext({viewport,httpCredentials:{username:'sam',password}});
   await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.fulfill({status:200,body:''}));
   const page=await context.newPage();page.setDefaultTimeout(60000);page.on('pageerror',error=>evidence.errors.push(error.message));
   const settled=()=>page.waitForFunction(()=>![...document.querySelectorAll('[role=status]')].some(node=>node.textContent.startsWith('Loading')),null,{timeout:60000});
   const change=async(locator,value)=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/analytics/rental-yields')&&r.status()===200);await locator.fill(value);const data=await (await response).json();await settled();return data;};
   await page.goto(base+'/?project=REGENCY%20PARK&mode=rental&dateFrom=2021-10-07&dateTo=2026-10-07');
   await page.getByText('Selected period (430 lease agreements)',{exact:true}).waitFor();await settled();
   assert.equal(await page.getByRole('spinbutton',{name:'Floor Area Max (Sqft)',exact:true}).inputValue(),'');
   await page.getByText(/Includes 235 leases with unknown floor area/).waitFor();
   assert.equal(await page.locator('.data-table tbody tr').count(),100);
   const first=await page.evaluate(async()=>{const r=await fetch('/api/analytics/rental-yields',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filters:{projects:['REGENCY PARK'],propertyType:'all',unitSizeMax:null,dateFrom:'2021-10-07',dateTo:'2026-10-07',page:1,limit:100}})});return (await r.json()).rentalCaveats.map(v=>v.rentalId);});
   const nextResponse=page.waitForResponse(r=>r.url().endsWith('/api/analytics/rental-yields')&&r.status()===200);
   await page.getByRole('button',{name:'Next page',exact:true}).click();const second=await (await nextResponse).json();await settled();
   assert.equal(second.page,2);assert.equal(second.totalCount,430);assert.ok(second.rentalCaveats.every(r=>!first.includes(r.rentalId)));
   assert.equal(new URL(page.url()).searchParams.get('page'),'2');
   await page.reload();await page.getByText('Page 2 of 5',{exact:true}).waitFor();await settled();assert.equal(await page.locator('.data-table tbody tr').count(),100);
   const limited=await change(page.getByRole('spinbutton',{name:'Floor Area Max (Sqft)',exact:true}),'10000');
   assert.equal(limited.totalCount,195);assert.equal(limited.page,1);
   const full=await change(page.getByRole('spinbutton',{name:'Floor Area Max (Sqft)',exact:true}),'');assert.equal(full.totalCount,430);
   await page.getByRole('combobox',{name:'Tenure',exact:true}).selectOption('freehold');await settled();
   await change(page.getByRole('spinbutton',{name:'Min Rent ($/mo)',exact:true}),'4000');
   await change(page.getByRole('spinbutton',{name:'Max Rent ($/mo)',exact:true}),'10000');
   await change(page.getByLabel('Transaction Date From',{exact:true}),'2022-01-01');
   await page.reload();await page.getByRole('combobox',{name:'Tenure',exact:true}).waitFor();await settled();
   assert.equal(await page.getByRole('combobox',{name:'Tenure',exact:true}).inputValue(),'freehold');
   assert.equal(await page.getByRole('spinbutton',{name:'Min Rent ($/mo)',exact:true}).inputValue(),'4000');
   assert.equal(await page.getByRole('spinbutton',{name:'Max Rent ($/mo)',exact:true}).inputValue(),'10000');
   assert.equal(await page.getByLabel('Transaction Date From',{exact:true}).inputValue(),'2022-01-01');
   await page.getByRole('button',{name:/Sale Transaction Prices/}).click();await settled();
   assert.equal(await page.getByRole('spinbutton',{name:'Min Price ($ SGD)',exact:true}).inputValue(),'');
   await page.getByRole('spinbutton',{name:'Min Price ($ SGD)',exact:true}).fill('1000000');await settled();
   await page.getByRole('button',{name:/Rental & Gross Yield/}).click();await settled();
   assert.equal(await page.getByRole('spinbutton',{name:'Min Rent ($/mo)',exact:true}).inputValue(),'');
   const search=page.getByRole('textbox',{name:'Search development, street, district or planning area'});
   await search.fill('keppel bay view');const street=page.locator('#search-suggestions button').filter({hasText:'Street'}).filter({hasText:'KEPPEL BAY VIEW'}).first();await street.waitFor();await street.click();await settled();
   assert.equal(new URL(page.url()).searchParams.has('project'),false);assert.equal(new URL(page.url()).searchParams.get('street'),'KEPPEL BAY VIEW');
   await page.getByRole('button',{name:'Clear Filters',exact:true}).click();await settled();
   assert.equal(await page.getByLabel('Property Type',{exact:true}).inputValue(),'condo');assert.equal(await page.getByRole('combobox',{name:'Tenure',exact:true}).inputValue(),'all');
   assert.equal(await page.getByRole('spinbutton',{name:'Floor Area Max (Sqft)',exact:true}).inputValue(),'');
   await page.goto(base+'/?project=REGENCY%20PARK&mode=rental');await page.getByText('Selected period (430 lease agreements)',{exact:true}).waitFor();await settled();
   const overflow=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth}));assert.ok(overflow.width<=overflow.viewport+1);
   await page.screenshot({path:output+'/filter-fixes-'+name+'.png',fullPage:true});
   evidence.checks.push({viewport:name,unknownAreaIncluded:430,explicitAreaLimit:195,disjointPages:true,pageReload:true,criteriaResetPage:true,fullFilterReload:true,modePriceResetBothDirections:true,locationReplacement:true,clearFilters:true,overflow});
   await context.close();
  }
  assert.deepEqual(evidence.errors,[]);evidence.passed=true;
 } finally {await browser.close();fs.writeFileSync(output+'/filter-fix-browser-results.json',JSON.stringify(evidence,null,2));}
 console.log(JSON.stringify(evidence,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
