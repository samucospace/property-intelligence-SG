const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.argv[2]);
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try {
  const context=await browser.newContext({httpCredentials:{username:'sam',password:fs.readFileSync(process.argv[3],'utf8').trim()}});
  const page=await context.newPage();
  await page.goto('https://staging.homeintel.sg');
  assert.equal(await page.title(),'Singapore Home Intel');
  const icon=await page.locator('link[rel=icon]').getAttribute('href');assert.equal(icon,'/favicon.svg?v=20261007');
  const response=await context.request.get('https://staging.homeintel.sg'+icon);assert.equal(response.status(),200);
  assert.ok(response.headers()['content-type'].includes('image/svg+xml'));
  const svg=await response.text();assert.ok(svg.includes('#4F7942')&&svg.includes('M6 22V4'));
  const rendered=await page.evaluate(async path=>{const image=new Image();image.src=path;await image.decode();return {width:image.naturalWidth,height:image.naturalHeight};},icon);
  assert.ok(rendered.width>0&&rendered.height>0);
  const result={checkedAt:new Date().toISOString(),title:await page.title(),icon,status:response.status(),rendered,passed:true};
  fs.writeFileSync(process.argv[4],JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
