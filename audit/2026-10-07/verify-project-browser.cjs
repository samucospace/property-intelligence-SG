const fs=require('node:fs');
const assert=require('node:assert/strict');
const {chromium}=require(process.argv[2]);
const password=fs.readFileSync(process.argv[3],'utf8').trim();
const output=process.argv[4];
const base='https://staging.homeintel.sg';
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const evidence={checkedAt:new Date().toISOString(),checks:[],errors:[]};
 try {
  for(const [name,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]) {
   const context=await browser.newContext({viewport,httpCredentials:{username:'sam',password}});
   await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.fulfill({status:200,body:''}));
   const page=await context.newPage();page.on('pageerror',error=>evidence.errors.push(error.message));
   await page.goto(base+'/?project=BINJAI%20CREST');
   await page.locator('.data-table tbody tr').first().waitFor();
   await page.locator('[role=status]').waitFor({state:'detached'});
   assert.equal(await page.getByLabel('Property Type',{exact:true}).inputValue(),'all');
   assert.ok(await page.locator('.data-table tbody tr').count()>1);
   await page.getByRole('button',{name:/Rental & Gross Yield/}).click();
   await page.getByRole('button',{name:'Yield Breakdown',exact:true}).first().waitFor();
   await page.locator('[role=status]').waitFor({state:'detached'});
   await page.getByLabel('Property Type',{exact:true}).selectOption('condo');
   await page.getByText('No tenancy agreements match these filters. Check Property Type, dates and other filters.').waitFor();
   await page.getByLabel('Property Type',{exact:true}).selectOption('landed');
   await page.getByRole('button',{name:'Yield Breakdown',exact:true}).first().waitFor();
   await page.locator('[role=status]').waitFor({state:'detached'});
   assert.equal(new URL(page.url()).searchParams.get('propertyType'),'landed');
   await page.reload();await page.getByRole('button',{name:'Yield Breakdown',exact:true}).first().waitFor();
   assert.equal(await page.getByLabel('Property Type',{exact:true}).inputValue(),'landed');
   const search=page.getByRole('textbox',{name:'Search development, street, district or planning area'});
   await search.fill('binjai crest');await page.locator('#search-suggestions button').first().waitFor();
   await page.locator('#search-suggestions button').filter({hasText:'BINJAI CREST'}).first().click();
   assert.equal(await page.getByLabel('Property Type',{exact:true}).inputValue(),'all');
   await page.getByRole('button',{name:'Yield Breakdown',exact:true}).first().waitFor();
   await page.locator('[role=status]').waitFor({state:'detached'});
   const overflow=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth}));
   assert.ok(overflow.width<=overflow.viewport+1);
   await page.screenshot({path:output+'/binjai-'+name+'.png',fullPage:true});
   evidence.checks.push({viewport:name,projectLinkSales:true,rentals:true,explicitRestriction:true,urlPersistence:true,searchSelection:true,overflow});
   await context.close();
  }
  assert.deepEqual(evidence.errors,[]);evidence.passed=true;
 } finally {await browser.close();fs.writeFileSync(output+'/project-browser-results.json',JSON.stringify(evidence,null,2));}
 console.log(JSON.stringify(evidence,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
