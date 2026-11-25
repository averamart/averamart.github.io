/* ============================================================
   plrange.js — সময়ভিত্তিক লাভ-ক্ষতি (যেকোনো তারিখ থেকে তারিখ, একসাথে)  ·  সংস্করণ ৫.১৮
   শুধু অ্যাডমিন। কিছু সংরক্ষণ বা পরিবর্তন করে না — কেবল পড়ে হিসাব দেখায়।
   • "অ্যাপের হিসাব": মাসিক লাভ-ক্ষতির হুবহু একই নিয়ম (ডেলিভারড বিক্রয় − বিক্রিত পণ্যের ক্রয়মূল্য ...)
   • "স্টক-ভিত্তিক হিসাব": শুরুর স্টক + ক্রয় − শেষ স্টক = ব্যবহৃত মাল। ঘাটতি/বাড়তি এতে নিজে থেকেই ধরা পড়ে।
   app.js ও secure.js-এর পরে লোড হয়; সরিয়ে দিলে আগের অ্যাপ হুবহু আগের মতোই চলে।
   ============================================================ */
(function(){
'use strict';
const S = {from:'', to:''};
const E = id => document.getElementById(id);
const sum = (arr, f) => arr.reduce((t, x) => t + (Number(f(x)) || 0), 0);
const d10 = d => String(d || '').slice(0, 10);
const isoOk = d => /^\d{4}-\d{2}-\d{2}$/.test(d);

(function addNav(){
  const i = NAV_ITEMS.findIndex(x => x.key === 'profitloss');
  NAV_ITEMS.splice(i < 0 ? NAV_ITEMS.length : i + 1, 0, {key:'plrange', label:'সময়ভিত্তিক লাভ-ক্ষতি', icon:'📅', roles:['admin']});
})();

/* মাসের হিসাবের moveIndex()-এর হুবহু নিয়ম, শুধু মাসের বদলে তারিখ ধরে */
function moveByDate(){
  const idx = {}, ordMap = {}, retMap = {};
  CACHE.orders.forEach(o => { ordMap[o.id] = o; });
  const slot = (pid, d) => { const a = idx[pid] || (idx[pid] = {}); return a[d] || (a[d] = {P:0, S:0, R:0, A:0, I:0}); };
  CACHE.purchases.forEach(pu => { const d = d10(pu.date); if(isoOk(d) && pu.productId) slot(pu.productId, d).P += Number(pu.qty || 0); });
  CACHE.returns.forEach(r => {
    const o = ordMap[r.orderId];
    const restocked = (r.restocked !== undefined) ? !!r.restocked : !!(o && o.status === 'Delivered');
    if(!restocked) return;
    const d = d10(r.date); if(isoOk(d)) slot(r.productId, d).R += Number(r.qty || 0);
    const rm = retMap[r.orderId] || (retMap[r.orderId] = {});
    rm[r.productId] = (rm[r.productId] || 0) + Number(r.qty || 0);
  });
  CACHE.orders.forEach(o => {
    if(o.status !== 'Delivered') return;
    const d = d10(o.date); if(!isoOk(d)) return;
    const rm = Object.assign({}, retMap[o.id] || {});
    orderItems(o).forEach(it => { const extra = rm[it.productId] || 0; delete rm[it.productId]; slot(it.productId, d).S += Number(it.qty || 0) + extra; });
    Object.keys(rm).forEach(pid => { slot(pid, d).S += rm[pid]; });
  });
  CACHE.products.forEach(p => (p.adj || []).forEach(a => {
    const d = d10(a.d); if(!isoOk(d)) return;
    const s = slot(p.id, d); s.A += Number(a.q || 0);
    if(a.n === 'প্রারম্ভিক স্টক') s.I += Number(a.q || 0);          // নতুন পণ্যে শুরুতে ঢোকানো স্টক — ঘাটতি/বাড়তি নয়
  }));
  return idx;
}

function figures(from, to){
  const idx = moveByDate(), prods = CACHE.products;
  const inR = d => { d = d10(d); return d >= from && d <= to; };
  const ords = CACHE.orders.filter(o => o.status === 'Delivered' && inR(o.date));
  const revenue = sum(ords, o => o.total);
  const cogsApp = sum(ords, o => sum(orderItems(o), it => { const p = prods.find(x => x.id === it.productId); return (p ? Number(p.cost || 0) : 0) * Number(it.qty || 0); }));
  const expenses = sum(CACHE.expenses.filter(e => e.kind !== 'income' && inR(e.date)), e => e.amount);
  const otherIncome = sum(CACHE.expenses.filter(e => e.kind === 'income' && inR(e.date)), e => e.amount);
  const purchases = sum(CACHE.purchases.filter(pu => inR(pu.date)), pu => pu.totalCost);
  let openVal = 0, closeVal = 0, initVal = 0, adjVal = 0, n = 0;
  const adjRows = [];
  prods.forEach(p => {
    const mv = idx[p.id] || {}, cost = Number(p.cost || 0), stock = Number(p.stock || 0);
    let after = 0, fromOn = 0, A = 0, I = 0;
    Object.keys(mv).forEach(d => {
      const v = mv[d], net = v.P - v.S + v.R + v.A;
      if(d > to) after += net;
      if(d >= from) fromOn += net;
      if(d >= from && d <= to){ A += v.A; I += v.I; }
    });
    openVal += (stock - fromOn) * cost; closeVal += (stock - after) * cost;
    initVal += I * cost;
    const man = r3(A - I); adjVal += man * cost;
    const entries = (p.adj || []).filter(a => a.n !== 'প্রারম্ভিক স্টক' && inR(a.d) && Number(a.q)).map(a => ({d:d10(a.d), q:r3(a.q), n:String(a.n || '')}));
    if(man){ n++; adjRows.push({id:p.id, name:p.name, brand:p.brand || '', unit:p.unit || 'কেজি', q:man, cost, value:r2(man * cost), entries}); }
  });
  const periodicCogs = openVal + purchases + initVal - closeVal;
  const custDueNew = sum(CACHE.orders.filter(o => o.status !== 'Cancelled' && inR(o.date)), o => orderDue(o));
  const supDueNew = sum(CACHE.purchases.filter(pu => inR(pu.date)), pu => purchaseDue(pu));
  adjRows.sort((a, b) => a.value - b.value);
  const netApp = r2(revenue - cogsApp + otherIncome - expenses);
  const netStock = r2(revenue - periodicCogs + otherIncome - expenses);
  return {from, to, revenue:r2(revenue), cogsApp:r2(cogsApp), grossApp:r2(revenue - cogsApp), expenses:r2(expenses), otherIncome:r2(otherIncome), netApp,
    purchases:r2(purchases), openVal:r2(openVal), closeVal:r2(closeVal), initVal:r2(initVal), periodicCogs:r2(periodicCogs), grossStock:r2(revenue - periodicCogs),
    netStock, adjVal:r2(adjVal), adjRows, adjCount:n, custDueNew:r2(custDueNew), supDueNew:r2(supDueNew), orders:ords.length};
}

function srcOf(a){      // অ্যাপে শুধু "স্টক যাচাই → মেলান" বাটন কারণ/নোট জমা রাখে; পণ্য সম্পাদনা ও এক্সেল আপলোডে নোট থাকে না
  if(a.n) return a.n === 'সমন্বয় (পার্থক্য মেলানো)' ? '"স্টক মূল্য যাচাই" পেইজের "মেলান" বাটন (কারণ লেখা হয়নি)' : '"স্টক মূল্য যাচাই" পেইজের "মেলান" বাটন — কারণ: ' + a.n;
  return 'পণ্য সম্পাদনায় স্টক ঘরের সংখ্যা বদল, অথবা এক্সেল আপলোডে স্টক আপডেট';
}
function dateBn(d){ const p = String(d).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : d; }
const row = (label, val, opts = {}) => `<tr${opts.b ? ' style="font-weight:700;"' : ''}><td>${label}</td><td class="cell-num">${opts.raw ? val : money(val)}</td></tr>`;

function statementHtml(f){
  const diff = r2(f.netApp - f.netStock);
  const A = `<table>
    ${row('মোট বিক্রয় (ডেলিভারড অর্ডার, ' + f.orders + 'টি)', f.revenue)}
    ${row('বিক্রিত পণ্যের ক্রয়মূল্য (COGS)', f.cogsApp)}
    ${row('গ্রস প্রফিট', f.grossApp, {b:1})}
    ${row('+ কমিশন / অন্যান্য আয়', f.otherIncome)}
    ${row('− মোট পরিচালন খরচ', f.expenses)}
    ${row('নিট প্রফিট (অ্যাপের হিসাব)', f.netApp, {b:1})}
  </table>`;
  const B = `<table>
    ${row('মোট বিক্রয় (ডেলিভারড অর্ডার)', f.revenue)}
    ${row('শুরুর স্টকের মূল্য (' + dateBn(f.from) + '-এর আগের জের)', f.openVal)}
    ${row('+ এই সময়ের মোট ক্রয়', f.purchases)}
    ${f.initVal ? row('+ প্রারম্ভিক স্টক হিসেবে ঢোকানো মাল', f.initVal) : ''}
    ${row('− শেষ স্টকের মূল্য (' + dateBn(f.to) + ' শেষে)', f.closeVal)}
    ${row('= ব্যবহৃত মালের মূল্য', f.periodicCogs, {b:1})}
    ${row('গ্রস প্রফিট', f.grossStock, {b:1})}
    ${row('+ কমিশন / অন্যান্য আয়', f.otherIncome)}
    ${row('− মোট পরিচালন খরচ', f.expenses)}
    ${row('নিট প্রফিট (স্টক-ভিত্তিক, ঘাটতিসহ)', f.netStock, {b:1})}
  </table>`;
  const adj = f.adjRows.length ? `<table><thead><tr><th>পণ্য</th><th>ব্র্যান্ড</th><th>সমন্বয় (ঘাটতি −, বাড়তি +)</th><th>কবে ও কীভাবে হয়েছে</th><th>ক্রয়মূল্য/একক</th><th>মূল্য</th></tr></thead><tbody>${
      f.adjRows.map(r => `<tr><td>${esc(r.name)}<br><span class="muted-cell" style="font-size:11px;">${esc(r.id)}</span></td><td>${esc(r.brand)}</td><td class="cell-num">${r.q} ${esc(r.unit)}</td><td style="font-size:12px;">${r.entries.map(a => `<b>${dateBn(a.d)}</b>: ${a.q > 0 ? '+' : ''}${a.q} ${esc(r.unit)}<br>${esc(srcOf(a))}`).join('<hr style="margin:4px 0;border:0;border-top:1px solid #ddd;">')}</td><td class="cell-num">${money(r.cost)}</td><td class="cell-num" style="color:${r.value < 0 ? '#C0392B' : '#1E9E6C'};font-weight:700;">${money(r.value)}</td></tr>`).join('')
    }<tr style="font-weight:700;"><td colspan="5" style="text-align:right;">মোট সমন্বয়ের মূল্য</td><td class="cell-num">${money(f.adjVal)}</td></tr></tbody></table>`
    : '<p class="muted-cell">এই সময়ে হাতে করা কোনো স্টক সমন্বয় নেই।</p>';
  return {A, B, adj, diff};
}

function renderPlRange(){
  if(!isAdmin()){ E('pageContent').innerHTML = '<div class="panel"><div class="empty-state">এই পেইজ শুধু অ্যাডমিনের জন্য</div></div>'; return; }
  if(!S.from){ const ms = monthsList(); S.from = monthStart(ms[0]); S.to = todayStr(); }
  E('pageContent').innerHTML = `
    <div class="panel">
      <h3>📅 সময়ভিত্তিক লাভ-ক্ষতি</h3>
      <p class="muted-cell" style="margin:0 0 10px;">যেকোনো শুরুর তারিখ থেকে শেষের তারিখ পর্যন্ত একসাথে লাভ-ক্ষতি। এটা শুধু হিসাব দেখায়, কিছু বদলায় না।</p>
      <div class="form-grid">
        <div class="form-field"><label>শুরুর তারিখ</label><input type="date" id="plrFrom" value="${esc(S.from)}" onchange="PLR.set('from',this.value)"></div>
        <div class="form-field"><label>শেষের তারিখ (এই তারিখসহ)</label><input type="date" id="plrTo" value="${esc(S.to)}" onchange="PLR.set('to',this.value)"></div>
        <div class="form-field"><label>অথবা মাস বাছুন</label><select onchange="PLR.month(this.value)"><option value="">— মাস বাছুন —</option>${monthsList().slice().reverse().map(m => `<option value="${m}">${monthLabel(m)} (${monthRangeText(m)})</option>`).join('')}</select></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
        <button class="btn btn-outline btn-sm" onclick="PLR.preset('all')">শুরু থেকে আজ পর্যন্ত</button>
        <button class="btn btn-outline btn-sm" onclick="PLR.preset('cur')">চলমান মাস</button>
        <button class="btn btn-accent btn-sm" onclick="PLR.print()">🖨️ প্রিন্ট / PDF</button>
      </div>
    </div>
    <div id="plrOut"></div>`;
  paint();
}

function paint(){
  const out = E('plrOut'); if(!out) return;
  if(!isoOk(S.from) || !isoOk(S.to)){ out.innerHTML = '<div class="panel"><div class="empty-state">দুটি তারিখই দিন</div></div>'; return; }
  if(S.from > S.to){ out.innerHTML = '<div class="panel"><div class="flash warn">শুরুর তারিখ শেষের তারিখের পরে হতে পারে না।</div></div>'; return; }
  const f = figures(S.from, S.to), h = statementHtml(f);
  const sign = f.netStock >= 0 ? 'লাভ' : 'ক্ষতি';
  out.innerHTML = `
    <div class="panel">
      <h3>${dateBn(f.from)} থেকে ${dateBn(f.to)} — সারাংশ</h3>
      <div class="invoice-total-row"><span>নিট ${sign} (স্টক-ভিত্তিক, ঘাটতিসহ)</span><span>${money(f.netStock)}</span></div>
      <p class="muted-cell" style="margin:8px 0 0;">চূড়ান্ত ক্লোজিংয়ের জন্য এই হিসাবটি দেখুন। নিচে অ্যাপের মাসিক নিয়মের হিসাবও আছে, তুলনার জন্য।</p>
    </div>
    <div class="panel"><h3>ক) স্টক-ভিত্তিক হিসাব (ঘাটতি/বাড়তিসহ)</h3>${h.B}
      <p class="muted-cell" style="font-size:12px;margin-top:8px;">স্টকের মূল্য পণ্যের এখনকার ক্রয়মূল্য ধরে। ক্রয় = এই সময়ে ক্রয় খাতায় লেখা মোট টাকা।</p></div>
    <div class="panel"><h3>খ) অ্যাপের হিসাব (মাসিক লাভ-ক্ষতির নিয়মে)</h3>${h.A}
      <div class="invoice-total-row" style="margin-top:10px;"><span>(খ) − (ক) পার্থক্য</span><span>${money(h.diff)}</span></div>
      <p class="muted-cell" style="font-size:12px;margin-top:8px;">পার্থক্যের কারণ: হাতে করা স্টক সমন্বয় (ঘাটতি/বাড়তি) আর ক্রয়মূল্য বদলের প্রভাব। অ্যাপের হিসাবে ঘাটতির ক্ষতি ধরা হয় না, তাই ঘাটতি থাকলে (খ) বেশি আসে।</p></div>
    <div class="panel"><h3>গ) হাতে করা স্টক সমন্বয় (${f.adjCount}টি পণ্য)</h3><div class="table-wrap">${h.adj}</div>
      <p class="muted-cell" style="font-size:12px;margin-top:8px;">নতুন পণ্যের "প্রারম্ভিক স্টক" এখানে ধরা হয়নি।</p></div>
    <div class="panel"><h3>ঘ) এই সময়ে নতুন বাকি</h3><table>
      ${row('কাস্টমারের কাছে নতুন বাকি', f.custDueNew)}${row('সরবরাহকারীর কাছে নতুন বাকি', f.supDueNew)}</table></div>`;
}

function printStatement(){
  if(!isoOk(S.from) || !isoOk(S.to) || S.from > S.to){ alert('আগে সঠিক দুটি তারিখ দিন।'); return; }
  const f = figures(S.from, S.to), h = statementHtml(f), st = CACHE.settings || {};
  E('printArea').innerHTML = `<div class="stock-print">
    <div class="sp-head"><img src="logo.jpg" alt=""><div><h3>Avera Mart — লাভ-ক্ষতির হিসাব</h3>
      <div>${esc(st.businessAddress || '')}</div>
      <div>সময়: <b>${dateBn(f.from)}</b> থেকে <b>${dateBn(f.to)}</b> পর্যন্ত · প্রিন্ট: ${dateBn(todayStr())}</div></div></div>
    <h4 style="margin:10px 0 4px;">ক) স্টক-ভিত্তিক হিসাব (ঘাটতি/বাড়তিসহ)</h4>${h.B}
    <h4 style="margin:12px 0 4px;">খ) অ্যাপের হিসাব (মাসিক নিয়মে)</h4>${h.A}
    <p style="margin:6px 0;">(খ) − (ক) পার্থক্য: <b>${money(h.diff)}</b></p>
    <h4 style="margin:12px 0 4px;">গ) হাতে করা স্টক সমন্বয় (ঘাটতি −, বাড়তি +)</h4>${h.adj}
    <h4 style="margin:12px 0 4px;">ঘ) এই সময়ে নতুন বাকি</h4><table>${row('কাস্টমারের কাছে নতুন বাকি', f.custDueNew)}${row('সরবরাহকারীর কাছে নতুন বাকি', f.supDueNew)}</table>
    <p style="font-size:11px;margin-top:8px;">স্টকের মূল্য পণ্যের এখনকার ক্রয়মূল্য ধরে হিসাব করা।</p>
    <div class="sp-sign"><span>প্রস্তুতকারী: ____________</span><span>যাচাইকারী: ____________</span><span>অনুমোদন: ____________</span></div></div>`;
  document.body.classList.remove('thermal');
  if(typeof setPrintLandscape === 'function') setPrintLandscape(false);
  printWhenReady();
}

window.PLR = {
  set(k, v){ S[k] = v; paint(); },
  month(m){ if(!m) return; S.from = monthStart(m); S.to = monthEnd(m); renderPlRange(); },
  preset(w){
    if(w === 'all'){ S.from = monthStart(monthsList()[0]); S.to = todayStr(); }
    else { const m = curMonth(); S.from = monthStart(m); S.to = monthEnd(m); }
    renderPlRange();
  },
  print: printStatement
};
window.renderPlRange = renderPlRange;
window.__plrTest = {figures, moveByDate, S};      // পরীক্ষার জন্য
})();
