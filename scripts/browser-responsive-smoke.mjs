import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { browserLayoutHarness } from './browser-layout-harness.mjs';

const browser = await browserLayoutHarness();
const { cdp, evaluate, wait, navigate, viewport, settle } = browser;
const stamp = new Date().toISOString(), today = stamp.slice(0,10), long = 'W'.repeat(140);
const nutrients = { caloriesPer100g: 180, fatPer100g: 3, carbsPer100g: 20, sugarPer100g: 2, fiberPer100g: 4, proteinPer100g: 8, saltPer100g: 0.5 };
const fixture = { format: 'munchling-backup', version: 1, schemaVersion: 1, exportedAt: stamp, data: {
  profiles: Array.from({ length: 4 },(_,i) => ({ id: i+1, name: i ? `Profile ${i+1}` : 'Profile '+long, dailyCaloriesTarget: 2000, dailyProteinTarget: 80, dailyCarbsTarget: null, dailyFatTarget: null, dailySugarTarget: null, dailyFiberTarget: null, dailySaltTarget: null, createdAt: stamp, updatedAt: null })),
  foods: Array.from({ length: 5 },(_,i) => ({ id: i+1, nameDe: i ? `Food ${i+1}` : 'Food '+long, nameEn: i ? `Food ${i+1}` : 'Food '+long, brand: long, ean: String(i+1).repeat(60), isCustom: true, portionSizeGrams: 100, ...nutrients, createdAt: stamp, updatedAt: null })),
  recipes: Array.from({ length: 4 },(_,i) => ({ id: i+1, nameDe: i ? `Recipe ${i+1}` : 'Recipe '+long, nameEn: i ? `Recipe ${i+1}` : 'Recipe '+long, description: long, isSubRecipe: false, portionSizeGrams: 200, createdAt: stamp, updatedAt: null })),
  recipeIngredients: Array.from({ length: 4 },(_,i) => ({ id: i+1,recipeId: i+1,foodId: 1,subRecipeId: null,amountGrams: 100,createdAt: stamp })),
  mealLogs: [{ id: 1,foodId: null,recipeId: 1,totalWeightGrams: 100,loggedAt: stamp,createdAt: stamp,updatedAt: null }],
  mealLogProfiles: [{ id: 1,mealLogId: 1,profileId: 1,portionFactor: 0.5,createdAt: stamp },{ id: 2,mealLogId: 1,profileId: 2,portionFactor: 0.5,createdAt: stamp }],
  activities: Array.from({ length: 4 },(_,i) => ({ id: i+1,name: i ? `Activity ${i+1}` : 'Activity '+long,durationMinutes: 30,calories: 200,createdAt: stamp,updatedAt: null })),
  activityLogs: [{ id: 1,profileId: 1,date: today,name: 'Activity '+long,durationMinutes: 30,calories: 200,units: 1.5,createdAt: stamp,updatedAt: null }],
} };
const click = text => evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!b || b.disabled) throw new Error('Button missing: '+${JSON.stringify(text)}); b.click(); })()`);
const routes = ['/', '/dashboard/1', '/foods', '/recipes', '/log', '/activity-log', '/activity-log?profile=1', '/activities', '/profiles', '/settings'];
const widths = [320,390,767,768,1023,1024,1440,1920];
let cases = 0;
try {
  await viewport(390); await navigate('/settings');
  await wait(() => evaluate('Boolean(document.querySelector("#backup-file"))'),'local database ready');
  const fixtureFile = path.join(browser.temporary,'fixture.json'); fs.writeFileSync(fixtureFile,JSON.stringify(fixture));
  const doc = await cdp('DOM.getDocument'), node = await cdp('DOM.querySelector',{ nodeId: doc.root.nodeId,selector: '#backup-file' });
  await cdp('DOM.setFileInputFiles',{ nodeId: node.nodeId,files: [fixtureFile] });
  await wait(() => evaluate('Boolean(document.querySelector("input[type=checkbox]"))'),'fixture confirmation');
  await evaluate('document.querySelector("input[type=checkbox]").click()'); await click('Restore');
  await wait(() => evaluate('document.body.textContent.includes("The backup was restored.")'),'isolated fixture imported');

  const measure = () => evaluate(`(() => {
    const nav = document.querySelector('.app-navigation'), main = document.querySelector('main'), width = innerWidth;
    const n = nav.getBoundingClientRect(), m = main.getBoundingClientRect();
    const overflow = [...main.querySelectorAll('*')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > width+1 || r.left < -1); }).slice(0,5).map(e => e.tagName+'.'+String(e.className).slice(0,100));
    return { width,available: document.documentElement.clientWidth,height: innerHeight,scrollWidth: document.documentElement.scrollWidth,overflow,mainCount: document.querySelectorAll('main').length,navCount: document.querySelectorAll('nav').length,activeCount: nav.querySelectorAll('[aria-current=page]').length,
      mainWidth: m.width, mainLeft: m.left,navWidth: n.width,navTop: n.top,navBottom: n.bottom,navHeight: n.height,
      logosNarrow: [...main.querySelectorAll('img[src="/munchling_768.png"]')].filter(e => e.getBoundingClientRect().width<56).length,
      badgesWrapped: [...main.querySelectorAll('.nutrition-badge p:first-child')].filter(e => e.getBoundingClientRect().height>28).length,
      inputsSmall: [...main.querySelectorAll('input,select,textarea')].filter(e => e.type !== 'file' && parseFloat(getComputedStyle(e).fontSize)<16).length,
      buttonsSmall: [...main.querySelectorAll('button')].filter(e => e.getBoundingClientRect().height>0 && e.getBoundingClientRect().height<44).length };
  })()`);
  const check = async label => {
    const m = await measure();
    if (m.scrollWidth > m.width+1 || m.overflow.length || m.mainCount !== 1 || m.navCount !== 1 || m.activeCount !== 1 || m.inputsSmall || m.buttonsSmall || m.logosNarrow || m.badgesWrapped) throw new Error(label+': '+JSON.stringify(m));
    if (m.width<768 && (Math.abs(m.navBottom-m.height)>1 || Math.abs(m.navWidth-m.available)>1)) throw new Error(label+': mobile navigation position '+JSON.stringify(m));
    if (m.width>=768 && m.width<1024 && (Math.abs(m.navTop)>1 || Math.abs(m.navWidth-m.available)>1)) throw new Error(label+': tablet navigation position '+JSON.stringify(m));
    if (m.width>=1024 && (Math.abs(m.navWidth-208)>1 || m.mainLeft<208 || m.mainWidth<m.width-300)) throw new Error(label+': desktop does not use available width '+JSON.stringify(m));
    cases++;
  };
  for (const route of routes) {
    await navigate(route);
    if (route !== '/settings') await wait(() => evaluate('document.body.textContent.includes("'+(route==='/activities'?'Activity':route==='/foods'?'Food':route==='/recipes'||route==='/log'?'Recipe':'Profile')+' ")'),'fixture visible '+route);
    if (route==='/foods' || route==='/recipes') await evaluate('document.querySelector(".card-grid article button").click()');
    for (const width of widths) { await viewport(width); await check(route+' @ '+width); if (route==='/foods' && width===1440) await browser.screenshot('desktop-foods'); }
    console.log('PASS: '+route+' at '+widths.length+' widths with long populated data');
  }

  for (const [route,href,count] of [['/','/activity-log',4],['/dashboard/1','/activity-log?profile=1',1]]) {
    await navigate(route);
    await wait(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(`main a[href="${href}"]`)}))`),'activity button '+route);
    await wait(() => evaluate('document.querySelector("main").textContent.match(/2300\\s*kcal/) !== null'),'cold dashboard activity bonus '+route);
    if (await evaluate('Boolean(document.querySelector("main form"))')) throw new Error('Dashboard still mounts an entry form');
    await evaluate(`document.querySelector(${JSON.stringify(`main a[href="${href}"]`)}).click()`);
    await wait(() => evaluate('location.pathname === "/activity-log" && document.querySelectorAll("main input[type=number]").length === '+count),'activity route profile scope '+route);
    if (await evaluate('document.querySelector("main header a").getAttribute("href")') !== route) throw new Error('Activity back link loses dashboard context');
  }
  await navigate('/activity-log?profile=999'); await wait(() => evaluate('Boolean(document.querySelector("main [role=alert]"))'),'missing selected profile');
  if (await evaluate('Boolean(document.querySelector("main form"))')) throw new Error('Missing profile fell back to household entry');
  console.log('PASS: dashboard buttons navigate with correct profile scope, back link and preserved cold-start activity bonus');

  // CSS changes must not remount or write forms. Keep actual DOM identities.
  for (const route of ['/profiles','/foods','/recipes','/activities','/log?food=1','/activity-log','/activity-log?profile=1']) {
    await navigate(route); await wait(() => evaluate('Boolean(document.querySelector("form input"))'),'draft '+route);
    if (route.startsWith('/log')) {
      await wait(() => evaluate('document.querySelector("form select")?.options[1]?.disabled === false'),'source portion size');
      await evaluate(`(() => { const s=document.querySelector('form select'); s.value='portions'; s.dispatchEvent(new Event('change',{bubbles:true})); const n=document.querySelector('form input[type=number]'); n.value='1.5'; n.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    } else if (route.startsWith('/activity-log')) {
      await evaluate(`(() => { const s=document.querySelector('form select'); s.value=s.options[1].value; s.dispatchEvent(new Event('change',{bubbles:true})); const n=document.querySelector('form input[type=number]'); n.value='1.5'; n.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    } else await evaluate(`(() => { const e=document.querySelector('form input'); e.value='Unsaved draft '+${JSON.stringify(route)}; e.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await settle();
    await evaluate('window.__draft = [...document.querySelectorAll("form input,form select,form textarea")].map(node => ({node,value:node.value}))');
    for (const width of [390,768,1024,1440,320,1920]) { await viewport(width); const stable=await evaluate('window.__draft.every(({node,value}) => node.isConnected && node.value===value)'); if (!stable) throw new Error('Draft lost on resize: '+route+' @ '+width); }
    console.log('PASS: same form nodes and unsaved values survive breakpoint changes '+route);
  }
  // Reduced height models the usable viewport with a screen keyboard.
  await navigate('/profiles'); await viewport(390,320);
  await evaluate('(() => { const inputs=[...document.querySelectorAll("form input")]; const last=inputs.at(-1); last.focus(); last.scrollIntoView({block:"center"}); })()'); await settle();
  if (!await evaluate('document.activeElement.getBoundingClientRect().bottom <= document.querySelector("nav").getBoundingClientRect().top')) throw new Error('Keyboard-sized viewport hides focused input');
  console.log('PASS: focused input remains above mobile navigation at reduced viewport height');

  // Effective 200% zoom widths for tablet/desktop reflow, not a cosmetic transform.
  for (const width of [512,720,960]) { await viewport(width); await check('200% effective viewport '+width); }
  console.log('PASS: zoom-sized reflow');
  await viewport(900,390); await check('landscape tablet-sized viewport');
  console.log('PASS: landscape-sized reflow');
  await viewport(390); await cdp('Emulation.setEmulatedMedia',{ features: [{ name: 'prefers-color-scheme',value: 'dark' }] });
  await navigate('/dashboard/1'); await wait(() => evaluate('document.body.textContent.includes("Profile ")'),'dark profile'); await check('dark mode');
  if (await evaluate('getComputedStyle(document.body).backgroundColor') !== 'rgb(2, 6, 23)') throw new Error('Dark theme was not applied');
  console.log('PASS: dark mode');

  // Same alert placement used by the online write fence; no production writes.
  await evaluate(`(() => { const a=document.createElement('aside'); a.className='app-alert rounded-xl bg-amber-50 p-4'; a.role='alert'; a.textContent='Unconfirmed write: '+ 'W'.repeat(300); document.querySelector('.app-workspace').prepend(a); })()`);
  await viewport(1440); await evaluate('window.scrollTo(0,500)'); await settle();
  if (!await evaluate('document.querySelector(".app-alert").getBoundingClientRect().top >= 0 && document.querySelector(".app-alert").getBoundingClientRect().right <= innerWidth')) throw new Error('Write fence hidden or overflowing');
  console.log('PASS: write-fence layout remains visible without horizontal overflow');
  await evaluate('document.querySelector(".app-alert").remove(); window.scrollTo(0,0)');
  await cdp('Emulation.setEmulatedMedia',{ features: [{ name: 'prefers-color-scheme',value: 'light' }] });
  await new Promise(resolve => setTimeout(resolve,200));
  const desktop = await browser.screenshot('desktop-dashboard');
  await viewport(390); const mobile = await browser.screenshot('mobile-dashboard');
  console.log('Screenshots: '+desktop+' | '+mobile);
  await navigate('/settings');
  const downloads = path.join(browser.temporary,'downloads'); fs.mkdirSync(downloads);
  await cdp('Browser.setDownloadBehavior',{ behavior: 'allow',downloadPath: downloads });
  await click('Export backup'); await wait(async () => fs.readdirSync(downloads).some(n => n.endsWith('.json')),'final backup export');
  const saved = JSON.parse(fs.readFileSync(path.join(downloads,fs.readdirSync(downloads).find(n => n.endsWith('.json'))),'utf8'));
  assert.deepEqual(saved.data,fixture.data);
  console.log('PASS: resizing, source preselection and unsaved drafts did not change persisted business data');
  await evaluate('document.activeElement.blur()');
  for (const type of ['keyDown','keyUp']) await cdp('Input.dispatchKeyEvent',{ type,key: 'Tab',code: 'Tab',windowsVirtualKeyCode: 9 });
  await wait(() => evaluate('document.activeElement.classList.contains("skip-link") && document.activeElement.getBoundingClientRect().top >= 0'),'visible keyboard skip link');
  for (const type of ['keyDown','keyUp']) await cdp('Input.dispatchKeyEvent',{ type,key: 'Enter',code: 'Enter',windowsVirtualKeyCode: 13 });
  await wait(() => evaluate('document.activeElement.id === "main-content"'),'keyboard skip focuses main');
  console.log('PASS: keyboard skip link is visible and focuses the unique main content');
  if (browser.exceptions.length) throw new Error('Browser exceptions: '+browser.exceptions.slice(0,3).join('; '));
  const missing = browser.missing.filter(u => !u.includes('favicon'));
  if (missing.length) throw new Error('Missing assets: '+missing.slice(0,5).join(', '));
  console.log('PASS: '+cases+' responsive layout cases, no uncaught exceptions or missing assets');
} finally { await browser.close(); }
