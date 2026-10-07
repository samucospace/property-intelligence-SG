const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.argv[2]);
const password=fs.readFileSync(process.argv[3],'utf8').trim();
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const context=await browser.newContext({httpCredentials:{username:'sam',password}});
 const page=await context.newPage(),base='https://staging.homeintel.sg';
 await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.fulfill({status:200,body:''}));
 const settled=()=>page.waitForFunction(()=>![...document.querySelectorAll('[role=status]')].some(node=>node.textContent.startsWith('Loading')));
 const findings=[];
 try {
  await page.goto(base+'/?project=BINJAI%20CREST');await settled();
  await page.getByRole('spinbutton',{name:'Min Price ($ SGD)',exact:true}).fill('1000000');await settled();
  await page.getByRole('button',{name:/Rental & Gross Yield/}).click();await settled();
  assert.equal(await page.getByRole('spinbutton',{name:'Min Rent ($/mo)',exact:true}).inputValue(),'1000000');
  await page.getByText('No tenancy agreements match these filters. Check Property Type, dates and other filters.').waitFor();
  findings.push({issue:'Sale price becomes rental minimum',retainedMinimum:1000000,emptyResults:true});
  await page.getByRole('spinbutton',{name:'Min Rent ($/mo)',exact:true}).fill('');await settled();
  await page.getByRole('combobox',{name:'Tenure',exact:true}).selectOption('leasehold');await settled();
  await page.reload();await settled();assert.equal(await page.getByRole('combobox',{name:'Tenure',exact:true}).inputValue(),'all');
  findings.push({issue:'Reload resets tenure',before:'leasehold',after:'all'});
  const search=page.getByRole('textbox',{name:'Search development, street, district or planning area'});
  await search.fill('keppel bay view');
  const street=page.locator('#search-suggestions button').filter({hasText:'Street'}).filter({hasText:'KEPPEL BAY VIEW'}).first();await street.waitFor();await street.click();await settled();
  assert.equal(new URL(page.url()).searchParams.get('project'),'BINJAI CREST');
  await page.getByText('No tenancy agreements match these filters. Check Property Type, dates and other filters.').waitFor();
  findings.push({issue:'New street retains incompatible old project',project:'BINJAI CREST',street:'KEPPEL BAY VIEW',emptyResults:true});
  console.log(JSON.stringify({checkedAt:new Date().toISOString(),findings},null,2));
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
