const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const arg=name=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
const {chromium}=require(arg('playwright'));
const base=arg('url') || 'http://127.0.0.1:3414';
if(!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error('Qualification requires isolated localhost');
const output=path.resolve(arg('output') || 'audit/2026-10-06');
(async()=>{
  const browser=await chromium.launch({executablePath:arg('chrome'),headless:true});
  const evidence={recordedAt:new Date().toISOString(),browser:await browser.version(),base,externalServices:'blocked; local API is real',checks:[],errors:[]};
  try {
    for(const [name,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]) {
      const context=await browser.newContext({viewport});
      await context.route('**/*',route=>{
        const url=new URL(route.request().url());
        if(url.origin===base || ['data:','blob:'].includes(url.protocol)) return route.continue();
        return route.request().resourceType()==='image' ? route.fulfill({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJZ8AAAAASUVORK5CYII=','base64')}) : route.fulfill({status:200,body:'',contentType:'text/plain'});
      });
      const page=await context.newPage();page.on('pageerror',error=>evidence.errors.push({viewport:name,message:error.message}));
      await page.goto(base);await page.locator('.data-table tbody tr').first().waitFor();await page.locator('.leaflet-container').waitFor();
      assert.equal(await page.getByRole('button',{name:/Connect with an Agent/}).count(),0);
      assert.equal(await page.locator('input[type=email]').count(),0);
      const overflow=await page.evaluate(()=>({page:document.documentElement.scrollWidth,viewport:innerWidth}));assert.ok(overflow.page<=overflow.viewport+1,JSON.stringify(overflow));
      await page.screenshot({path:path.join(output,`phase4-${name}-sales.png`),fullPage:true});
      await page.getByRole('button',{name:/View amenity proximity details/}).first().focus();await page.keyboard.press('Enter');
      await page.getByRole('dialog',{name:'Amenity proximity details'}).waitFor();await page.keyboard.press('Escape');
      const search=page.getByRole('textbox',{name:'Search development, street, district or planning area'});
      await search.fill('reflections');await page.locator('#search-suggestions button').first().waitFor();await search.press('ArrowDown');
      assert.equal(await page.evaluate(()=>document.activeElement.closest('#search-suggestions')!==null),true);
      await page.keyboard.press('Enter');await page.getByText('REFLECTIONS AT KEPPEL BAY',{exact:true}).first().waitFor();
      await page.getByRole('button',{name:/Rental & Gross Yield/}).click();await page.getByRole('button',{name:'Yield Breakdown',exact:true}).first().waitFor();
      await page.locator('[role=status]').waitFor({state:'detached'});await page.getByRole('button',{name:'Yield Breakdown',exact:true}).first().focus();await page.keyboard.press('Enter');const dialog=page.getByRole('dialog',{name:'Rental yield details'});await dialog.waitFor({timeout:5000}).catch(async error=>{await page.screenshot({path:path.join(output,'phase4-dialog-failure.png'),fullPage:true});fs.writeFileSync(path.join(output,'phase4-dialog-failure.html'),await page.content());throw error;});
      assert.equal(await dialog.evaluate(element=>element.contains(document.activeElement)),true);
      await page.keyboard.press('Shift+Tab');assert.equal(await dialog.evaluate(element=>element.contains(document.activeElement)),true);
      await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
      await page.screenshot({path:path.join(output,`phase4-${name}-rental.png`),fullPage:true});
      await page.getByRole('link',{name:'About',exact:true}).click();await page.getByRole('dialog',{name:'About Singapore Home Intel'}).waitFor();await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(()=>document.activeElement.textContent.trim()),'About');
      const contained=await page.evaluate(async()=>{
        const codes=[];for(const route of ['/api/leads/submit','/api/admin/login']) codes.push((await fetch(route,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status);return codes;
      });assert.deepEqual(contained,[403,403]);
      evidence.checks.push({viewport:name,sales:true,rental:true,map:true,amenityDetailKeyboard:true,searchKeyboard:true,dialogFocusEscapeRestore:true,leadAdminContainment:true,overflow});
      await context.close();
    }
    const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
    await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.fulfill({status:200,body:''}));
    let release;const gate=new Promise(resolve=>release=resolve);
    await page.route('**/api/analytics/price-trends',async route=>{await gate;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Simulated unavailable analytics'})});});
    await page.goto(base);await page.getByRole('status').filter({hasText:/Loading market data/}).waitFor();release();await page.getByRole('alert').waitFor();
    await page.screenshot({path:path.join(output,'phase4-mobile-error.png'),fullPage:true});
    await page.unroute('**/api/analytics/price-trends');
    await page.route('**/api/analytics/price-trends',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({summary:{totalVolume:0},totalCount:0,timeSeries:[],scatterPoints:[],mapProjectCount:0})}));
    await page.route('**/api/analytics/map',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({responseVersion:'phase4-map-v1',columns:[],rows:[],totalProjects:0})}));
    await page.getByRole('button',{name:/Retry/}).click();await page.getByText(/No recorded transactions match/).waitFor();
    evidence.checks.push({loading:true,error:true,retry:true,empty:true,simulatedResponses:true});
    assert.deepEqual(evidence.errors,[]);
    await context.close();evidence.passed=true;
  } finally {await browser.close();fs.writeFileSync(path.join(output,'phase4-browser.json'),JSON.stringify(evidence,null,2));}
  console.log(JSON.stringify(evidence,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
