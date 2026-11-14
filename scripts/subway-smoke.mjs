import fs from 'node:fs';
const PORT = 9333;
const r = await fetch(`http://127.0.0.1:${PORT}/json/new?` + encodeURIComponent('about:blank'), { method: 'PUT' });
const t = await r.json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (res.result?.exceptionDetails) return { error: JSON.stringify(res.result.exceptionDetails).slice(0, 240) };
  return res.result?.result?.value;
};
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: 'file:///D:/Dev/dsh-workspace/docs/subway/index.html' });
await wait(1500);
await ev(`localStorage.setItem('subway.tut','1');document.getElementById('tutorial').style.display='none';window.__subway.start();`);
await wait(900);

const results = {};
results.initialLives = await ev(`JSON.stringify({lives:window.__subway.lives,state:window.__subway.state})`);

// 1) 吃小吃
await ev(`(()=>{const s=window.__subway;const d=s.dist;
  s.world.items.push({id:900,kind:'food',type:'juan',w:d+5,lane:0,x:0,y:0.95,alive:true,spin:0});
  return 1})()`);
const before = await ev(`window.__subway.score`);
await wait(700);
const after = await ev(`window.__subway.score`);
results.foodGain = after - before;
results.shieldAfterFood = await ev(`window.__subway.power.shield`);

// 2) 撞路障掉血
await ev(`(()=>{const s=window.__subway;const d=s.dist;
  s.world.items.push({id:901,kind:'obstacle',type:'barrier',w:d+4.2,lane:0,x:0,h:0.62,dw:0.9,alive:true});
  return 1})()`);
await wait(600);
results.livesAfterHit = await ev(`window.__subway.lives`);

// 3) 连续撞到游戏结束
for (let i = 0; i < 8; i++) {
  await ev(`(()=>{const s=window.__subway;const d=s.dist;
    s.world.items.push({id:${910 + i},kind:'obstacle',type:'barrier',w:d+3.2,lane:${0},x:0,h:0.62,dw:0.9,alive:true});
    return 1})()`);
  await wait(1500);
}
results.livesSeq = await ev("window.__subway.lives");
results.final = await ev(`JSON.stringify({state:window.__subway.state,lives:window.__subway.lives})`);
results.overVisible = await ev(`!document.getElementById('over').classList.contains('hidden')`);
console.log(JSON.stringify(results, null, 1));
ws.close();
