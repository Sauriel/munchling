import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Isolated, generated-SPA browser checks. Never uses a real household database.
export async function browserLayoutHarness() {
  const root = fileURLToPath(new URL('../.output/public', import.meta.url));
  if (!fs.existsSync(path.join(root,'index.html'))) throw new Error('Run pnpm generate first.');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(),'munchling-responsive-'));
  const artifacts = process.env.MUNCHLING_RESPONSIVE_ARTIFACT_DIR ?? temporary;
  fs.mkdirSync(artifacts,{ recursive: true });
  const mime = { '.js': 'application/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.html': 'text/html' };
  const exceptions = [], missing = [], jobs = new Map(); let browser, socket, sequence = 0;
  const server = http.createServer((request,response) => {
    try {
      let file = path.resolve(root,'.'+decodeURIComponent(new URL(request.url,'http://local').pathname));
      if (!file.startsWith(root+path.sep) && file !== root) { response.writeHead(403).end(); return; }
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file,'index.html');
      if (!fs.existsSync(file)) { if (path.extname(file)) { missing.push(request.url); response.writeHead(404).end(); return; } file = path.join(root,'index.html'); }
      response.setHeader('Content-Type',mime[path.extname(file)] ?? 'application/octet-stream');
      fs.createReadStream(file).on('error',() => response.destroy()).pipe(response);
    } catch { response.writeHead(400).end(); }
  });
  const close = async () => {
    socket?.close(); for (const job of jobs.values()) { clearTimeout(job.timer); job.reject(new Error('Browser closed')); } jobs.clear();
    if (browser && browser.exitCode === null) { const exited = new Promise(resolve => browser.once('exit',resolve)); browser.kill('SIGTERM'); await exited; }
    await new Promise(resolve => server.close(resolve));
  };
  try {
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    const base = 'http://127.0.0.1:'+server.address().port;
    browser = spawn(process.env.CHROMIUM_BIN ?? '/usr/bin/chromium',['--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--lang=en-US','--remote-debugging-port=0','--user-data-dir='+path.join(temporary,'profile'),'about:blank'],{ stdio: ['ignore','ignore','pipe'] });
    const endpoint = await new Promise((resolve,reject) => {
      let text = ''; const timer = setTimeout(() => reject(new Error('Chromium startup timeout')),15000);
      const failed = e => { clearTimeout(timer); reject(e); }; browser.once('error',failed); browser.once('exit',code => failed(new Error('Chromium exit '+code)));
      browser.stderr.on('data',chunk => { text += chunk; const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    });
    const targets = await (await fetch('http://'+new URL(endpoint).host+'/json')).json();
    socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve,reject) => { socket.addEventListener('open',resolve,{ once: true }); socket.addEventListener('error',reject,{ once: true }); });
    socket.addEventListener('message',event => {
      const m = JSON.parse(event.data);
      if (m.id) { const job = jobs.get(m.id); if (!job) return; jobs.delete(m.id); clearTimeout(job.timer); if (m.error) job.reject(new Error(JSON.stringify(m.error))); else job.resolve(m.result); }
      else if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    });
    const cdp = (method,params = {}) => new Promise((resolve,reject) => { const id = ++sequence, timer = setTimeout(() => { jobs.delete(id); reject(new Error('CDP timeout: '+method)); },15000); jobs.set(id,{ resolve,reject,timer }); socket.send(JSON.stringify({ id,method,params })); });
    const evaluate = async expression => { const r = await cdp('Runtime.evaluate',{ expression,returnByValue: true,awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
    const wait = async (check,label) => { for (let i=0;i<150;i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve,100)); } throw new Error('Timeout: '+label); };
    await cdp('Runtime.enable'); await cdp('Page.enable'); await cdp('DOM.enable');
    const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const navigate = async route => { await cdp('Page.navigate',{ url: base+route }); await wait(() => evaluate('Boolean(document.querySelector("#main-content"))'),'mounted '+route); await settle(); };
    const viewport = async (width,height=900) => { await cdp('Emulation.setDeviceMetricsOverride',{ width,height,deviceScaleFactor: 1,mobile: false }); await settle(); };
    const screenshot = async name => { const r = await cdp('Page.captureScreenshot',{ format: 'png',captureBeyondViewport: false }); const file = path.join(artifacts,name+'.png'); fs.writeFileSync(file,Buffer.from(r.data,'base64')); return file; };
    return { cdp,evaluate,wait,navigate,viewport,settle,screenshot,close,temporary,exceptions,missing };
  } catch (error) { await close(); throw error; }
}
