/* ============================================================
   bulkinvoice.js — একসাথে অনেক ইনভয়েস, সময় উল্লেখ করে, ১টি PDF ফাইলে  ·  সংস্করণ ৫.১৫
   • বিক্রয় ইনভয়েস (অ্যাডমিন ও ম্যানেজার) • ক্রয় ইনভয়েস/ভাউচার (শুধু অ্যাডমিন — ক্রয়মূল্য থাকে)
   প্রতিটি ইনভয়েস আলাদা পাতায়; সবার আগে সময়কাল ও মোটসহ সারাংশ পাতা।
   অতিরিক্ত কোনো লাইব্রেরি লাগে না: ইনভয়েস ছবি করতে আগে থেকেই থাকা html2canvas, আর PDF জোড়া লাগানো এই ফাইলেই।
   app.js ও secure.js-এর পরে লোড হয়; সরিয়ে দিলে আগের অ্যাপ হুবহু আগের মতোই চলে।
   ============================================================ */
(function(){
'use strict';
const B = {type:'sales', from:'', to:'', status:'delivered', busy:false};
const E = id => document.getElementById(id);

function defaultRange(){
  const m = curMonth();
  B.from = monthStart(m); B.to = monthEnd(m);
  const t = todayStr(); if(t < B.to) B.to = t;           // চলমান মাসে আজ পর্যন্ত
  if(B.to < B.from) B.to = B.from;
}

/* ---------- নির্বাচিত ইনভয়েসের তালিকা ---------- */
function salesList(){
  return CACHE.orders
    .filter(o => o.date >= B.from && o.date <= B.to && (B.status==='delivered' ? o.status==='Delivered' : o.status!=='Cancelled'))
    .slice().sort((a,b) => a.date < b.date ? -1 : a.date > b.date ? 1 : (a.id < b.id ? -1 : 1));
}
function purchaseGroups(){
  const recs = CACHE.purchases.filter(p => p.date >= B.from && p.date <= B.to)
    .slice().sort((a,b) => a.date < b.date ? -1 : a.date > b.date ? 1 : (a.id < b.id ? -1 : 1));
  const map = new Map();
  recs.forEach(p => {                                      // একই ভাউচার নম্বর + সরবরাহকারী + তারিখ = একটি ইনভয়েস
    const k = p.voucherNo ? ['v', p.date, (p.supplier||'').trim(), p.voucherNo].join('|') : 'i|' + p.id;
    if(!map.has(k)) map.set(k, []);
    map.get(k).push(p);
  });
  return [...map.values()];
}
const grpTotal = g => r2(g.reduce((t,p) => t + Number(p.totalCost||0), 0));
function currentList(){ return B.type==='sales' ? salesList() : purchaseGroups(); }
function listTotal(list){ return B.type==='sales' ? r2(list.reduce((t,o) => t + Number(o.total||0), 0)) : r2(list.reduce((t,g) => t + grpTotal(g), 0)); }

/* ---------- ক্রয় ইনভয়েসের HTML (বিক্রয়ের মতো একই নকশা) ---------- */
function purchaseBoxHtml(g){
  const first = g[0], st = CACHE.settings || {};
  const total = grpTotal(g);
  const paid = r2(g.reduce((t,p) => t + (p.paidAmount!=null ? Number(p.paidAmount) : (p.paymentStatus==='Paid' ? Number(p.totalCost||0) : 0)), 0));
  const due = r2(Math.max(0, total - paid));
  const rows = g.map(p => {
    const pr = CACHE.products.find(x => x.id===p.productId), unit = (pr && pr.unit) || 'কেজি', q = Number(p.qty||0);
    const unitCost = q > 0 ? r2(Number(p.totalCost||0) / q) : 0;
    return `<tr><td>${esc(pr ? pr.name : (p.productName||'—'))}${pr && pr.brand ? ` <span style="font-size:11px;color:var(--text-muted);">· ${esc(pr.brand)}</span>` : ''}</td>
      <td class="cell-num">${r3(q)} ${esc(unit)}${Number(p.freeQty)>0 ? `<br><span style="font-size:11px;">(ফ্রি ${r3(p.freeQty)} সহ)</span>` : ''}</td>
      <td class="cell-num">${money(unitCost)}/${esc(unit)}</td><td class="cell-num">${money(p.totalCost)}</td></tr>`;
  }).join('');
  return `<div class="invoice-box">
    <div class="invoice-head"><img src="logo.jpg" alt="logo">
      <div class="inv-mid"><h3>Avera Mart</h3><p class="tagline">${esc(st.tagline||'')}</p>
        <p style="font-size:11px;color:var(--text-muted);margin:2px 0 0;">${esc(st.businessAddress||'')}${st.phone?' · '+esc(st.phone):''}</p></div></div>
    <div style="text-align:center;font-weight:700;font-size:15px;margin:6px 0;">ক্রয় ইনভয়েস / ভাউচার</div>
    <div class="invoice-meta">
      <div>${first.voucherNo ? 'ভাউচার নং: ' + esc(first.voucherNo) + '<br>' : ''}এন্ট্রি: ${g.map(p => esc(p.id)).join(', ')}<br>তারিখ: ${esc(first.date)}</div>
      <div style="text-align:left">সরবরাহকারী:<br><b>${esc(first.supplier||'—')}</b></div>
    </div>
    <table><thead><tr><th>পণ্য</th><th>পরিমাণ</th><th>একক মূল্য</th><th>মোট</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="invoice-total-row"><span>সর্বমোট ক্রয়</span><span>${money(total)}</span></div>
    <p style="font-size:11.5px;color:var(--text-muted);margin-top:10px;">পরিশোধিত ${money(paid)}${due>0 ? `, <b>বকেয়া ${money(due)}</b>` : ' — সম্পূর্ণ পরিশোধিত'}</p>
    <div class="invoice-sign"><div><span class="sign-line"></span>গ্রহীতার স্বাক্ষর</div><div><span class="sign-line"></span>সরবরাহকারীর স্বাক্ষর</div></div>
  </div>`;
}

/* ---------- সারাংশ পাতা (সময়কাল + তালিকা + মোট) ---------- */
function summaryPages(list){
  const sales = B.type==='sales';
  const title = sales ? 'বিক্রয় ইনভয়েস — সারাংশ' : 'ক্রয় ইনভয়েস — সারাংশ';
  const info = `সময়কাল: <b>${esc(B.from)}</b> থেকে <b>${esc(B.to)}</b>` + (sales ? ` · ${B.status==='delivered' ? 'শুধু ডেলিভারড অর্ডার' : 'বাতিল বাদে সব অর্ডার'}` : '');
  const per = 34, pages = [];
  const rowsOf = x => sales
    ? `<tr><td>${esc(x.id)}</td><td>${esc(x.date)}</td><td>${esc(x.customerName||'')}</td><td class="cell-num">${money(x.total)}</td></tr>`
    : `<tr><td>${esc(x[0].voucherNo||x[0].id)}</td><td>${esc(x[0].date)}</td><td>${esc(x[0].supplier||'')}</td><td class="cell-num">${money(grpTotal(x))}</td></tr>`;
  const head = sales ? '<th>ইনভয়েস</th><th>তারিখ</th><th>কাস্টমার</th><th>মোট</th>' : '<th>ভাউচার/এন্ট্রি</th><th>তারিখ</th><th>সরবরাহকারী</th><th>মোট</th>';
  const n = Math.max(1, Math.ceil(list.length / per));
  for(let i = 0; i < n; i++){
    const chunk = list.slice(i*per, (i+1)*per), last = i === n-1;
    pages.push(`<div class="invoice-box">
      <div class="invoice-head"><img src="logo.jpg" alt="logo"><div class="inv-mid"><h3>Avera Mart</h3><p class="tagline">${esc((CACHE.settings||{}).tagline||'')}</p></div></div>
      <div style="text-align:center;font-weight:700;font-size:16px;margin:8px 0 2px;">${title}${n>1 ? ` (${i+1}/${n})` : ''}</div>
      <p style="text-align:center;font-size:13px;margin:0 0 10px;">${info}</p>
      <table><thead><tr>${head}</tr></thead><tbody>${chunk.map(rowsOf).join('')}</tbody></table>
      ${last ? `<div class="invoice-total-row"><span>মোট ${list.length}টি ইনভয়েস</span><span>${money(listTotal(list))}</span></div>` : ''}
    </div>`);
  }
  return pages;
}

/* ---------- ছোট PDF লেখক: প্রতি পাতায় একটি JPEG ছবি (A4) ---------- */
function buildPdf(pages, title){
  const enc = new TextEncoder(), chunks = [], offs = [];
  let pos = 0;
  const add = x => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); pos += b.length; };
  const hexUtf16 = s => { let h = 'FEFF'; for(const ch of s){ const c = ch.codePointAt(0); if(c > 0xFFFF){ const v = c - 0x10000; h += (0xD800 + (v >> 10)).toString(16).padStart(4,'0') + (0xDC00 + (v & 0x3FF)).toString(16).padStart(4,'0'); } else h += c.toString(16).padStart(4,'0'); } return h.toUpperCase(); };
  const W = 595.28, H = 841.89, M = 28;
  const n = pages.length, info = 3 + n*3;
  add('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const obj = (num, fn) => { offs[num] = pos; add(num + ' 0 obj\n'); fn(); add('\nendobj\n'); };
  obj(1, () => add('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => add('<< /Type /Pages /Count ' + n + ' /Kids [' + pages.map((_, i) => (3 + i*3) + ' 0 R').join(' ') + '] >>'));
  pages.forEach((p, i) => {
    const pg = 3 + i*3, ct = pg + 1, im = pg + 2;
    let w = W - 2*M, h = w * p.h / p.w;
    if(h > H - 2*M){ h = H - 2*M; w = h * p.w / p.h; }
    const x = (W - w) / 2, y = H - M - h;
    obj(pg, () => add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /XObject << /Im0 ' + im + ' 0 R >> >> /Contents ' + ct + ' 0 R >>'));
    const content = 'q ' + w.toFixed(2) + ' 0 0 ' + h.toFixed(2) + ' ' + x.toFixed(2) + ' ' + y.toFixed(2) + ' cm /Im0 Do Q';
    obj(ct, () => add('<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream'));
    obj(im, () => { add('<< /Type /XObject /Subtype /Image /Width ' + p.w + ' /Height ' + p.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + p.data.length + ' >>\nstream\n'); add(p.data); add('\nendstream'); });
  });
  obj(info, () => add('<< /Title <' + hexUtf16(title) + '> /Producer (Avera Mart) >>'));
  const xref = pos;
  add('xref\n0 ' + (info + 1) + '\n0000000000 65535 f \n');
  for(let i = 1; i <= info; i++) add(String(offs[i]).padStart(10, '0') + ' 00000 n \n');
  add('trailer\n<< /Size ' + (info + 1) + ' /Root 1 0 R /Info ' + info + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF');
  return new Blob(chunks, {type:'application/pdf'});
}

/* ---------- HTML → JPEG ছবি ---------- */
async function snap(html, stage){
  stage.innerHTML = html;
  const imgs = [...stage.querySelectorAll('img')];
  await Promise.all(imgs.map(im => (im.complete && im.naturalWidth) ? 0 : new Promise(r => { im.onload = r; im.onerror = r; setTimeout(r, 4000); })));
  const canvas = await html2canvas(stage.firstElementChild, {scale:1.6, backgroundColor:'#ffffff', logging:false, useCORS:true});
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.86));
  if(!blob) throw new Error('ছবি তৈরি করা যায়নি');
  const out = {data:new Uint8Array(await blob.arrayBuffer()), w:canvas.width, h:canvas.height};
  canvas.width = canvas.height = 0;                       // মেমোরি ছাড়া
  return out;
}

function fileName(){ return `avera-mart-${B.type==='sales' ? 'bikroy' : 'kroy'}-invoice-${B.from}_to_${B.to}.pdf`; }
function setStatus(t, bad){ const el = E('bulkStatus'); if(el){ el.textContent = t; el.style.color = bad ? 'var(--red)' : 'var(--text-muted)'; } }

async function bulkDownload(){
  if(B.busy) return;
  if(typeof html2canvas === 'undefined'){ setStatus('ছবি তৈরির লাইব্রেরি লোড হয়নি — ইন্টারনেট দেখে পেইজ রিফ্রেশ করুন।', true); return; }
  if(B.from > B.to){ setStatus('শুরুর তারিখ শেষের তারিখের পরে হতে পারে না।', true); return; }
  const list = currentList();
  if(!list.length){ setStatus('এই সময়ে কোনো ইনভয়েস নেই।', true); return; }
  if(list.length > 400){ setStatus(`${list.length}টি ইনভয়েস — একবারে ৪০০-র বেশি হলে ফোনের মেমোরি ভরে যেতে পারে। সময় ভাগ করে নিন।`, true); return; }
  B.busy = true; const btn = E('bulkBtn'); if(btn) btn.disabled = true;
  const stage = document.createElement('div');
  stage.style.cssText = 'position:absolute;left:-12000px;top:0;width:760px;background:#fff;color:#111;padding:0;';
  document.body.appendChild(stage);
  try{
    if(document.fonts && document.fonts.ready) await document.fonts.ready;
    const sums = summaryPages(list), htmls = sums.concat(list.map(x => B.type==='sales' ? invoiceBoxHtml(x) : purchaseBoxHtml(x)));
    const pages = [];
    for(let i = 0; i < htmls.length; i++){
      setStatus(`পাতা ${i+1}/${htmls.length} তৈরি হচ্ছে... (ট্যাব বন্ধ করবেন না)`);
      pages.push(await snap(htmls[i], stage));
      await new Promise(r => setTimeout(r, 0));          // পর্দা সচল রাখা
    }
    setStatus('PDF জোড়া লাগানো হচ্ছে...');
    const blob = buildPdf(pages, `${B.type==='sales' ? 'বিক্রয়' : 'ক্রয়'} ইনভয়েস ${B.from} থেকে ${B.to}`);
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = fileName(); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    setStatus(`✅ ${list.length}টি ইনভয়েসের PDF (${sums.length}টি সারাংশ পাতাসহ মোট ${htmls.length} পাতা, ${(blob.size/1048576).toFixed(1)} MB) ডাউনলোড হয়েছে।`);
  }catch(e){ setStatus('PDF তৈরি হয়নি: ' + ((e && e.message) || e), true); }
  stage.remove(); B.busy = false; if(btn) btn.disabled = false;
}

/* ---------- ইনভয়েস পেইজে প্যানেল ---------- */
function previewHtml(){
  const list = currentList();
  return list.length ? `<b>${list.length}টি</b> ইনভয়েস · মোট <b>${money(listTotal(list))}</b>` : 'এই সময়ে কোনো ইনভয়েস নেই';
}
function panelHtml(){
  if(!B.from) defaultRange();
  const adm = isAdmin();
  if(B.type==='purchase' && !adm) B.type = 'sales';
  return `<div class="panel" id="bulkPanel">
    <h3>📄 একসাথে অনেক ইনভয়েস — ১টি PDF ফাইলে</h3>
    <div class="form-grid">
      <div class="form-field"><label>কোন ইনভয়েস</label>
        <select onchange="BULK.set('type',this.value)"><option value="sales" ${B.type==='sales'?'selected':''}>বিক্রয় ইনভয়েস</option>${adm ? `<option value="purchase" ${B.type==='purchase'?'selected':''}>ক্রয় ইনভয়েস / ভাউচার</option>` : ''}</select></div>
      <div class="form-field"><label>মাস বাছুন (তারিখ নিজে ঠিক হবে)</label>
        <select onchange="BULK.month(this.value)"><option value="">— অথবা নিচে তারিখ দিন —</option>${monthsList().slice().reverse().map(m => `<option value="${m}">${monthLabel(m)} (${monthRangeText(m)})</option>`).join('')}</select></div>
      <div class="form-field"><label>শুরুর তারিখ</label><input type="date" id="bulkFrom" value="${esc(B.from)}" onchange="BULK.set('from',this.value)"></div>
      <div class="form-field"><label>শেষের তারিখ</label><input type="date" id="bulkTo" value="${esc(B.to)}" onchange="BULK.set('to',this.value)"></div>
      ${B.type==='sales' ? `<div class="form-field"><label>কোন অর্ডার</label>
        <select onchange="BULK.set('status',this.value)"><option value="delivered" ${B.status==='delivered'?'selected':''}>শুধু ডেলিভারড</option><option value="all" ${B.status==='all'?'selected':''}>বাতিল বাদে সব (পেন্ডিং, প্রসেসিং, ডেলিভারড)</option></select></div>` : ''}
    </div>
    <p id="bulkPreview" style="margin:10px 0;">${previewHtml()}</p>
    <button class="btn btn-primary" id="bulkBtn" onclick="BULK.go()">⬇️ PDF ডাউনলোড</button>
    <p id="bulkStatus" class="muted-cell" style="margin-top:8px;"></p>
    <p class="muted-cell" style="margin:6px 0 0;font-size:12px;">প্রতিটি ইনভয়েস আলাদা পাতায়; সবার আগে সময়কাল ও মোটসহ সারাংশ পাতা থাকবে।${adm ? '' : ' (ক্রয় ইনভয়েস শুধু অ্যাডমিন দেখতে পারেন।)'}</p>
  </div>`;
}
window.BULK = {
  set(k, v){ B[k] = v; if(k==='type' || k==='status'){ renderBulkPanel(); } else { const p = E('bulkPreview'); if(p) p.innerHTML = previewHtml(); } },
  month(m){ if(!m) return; B.from = monthStart(m); B.to = monthEnd(m); renderBulkPanel(); },
  go: bulkDownload
};
function renderBulkPanel(){ const el = E('bulkPanel'); if(el) el.outerHTML = panelHtml(); }

const _renderInvoice = window.renderInvoice;
window.renderInvoice = function(){
  _renderInvoice.apply(this, arguments);
  const pc = E('pageContent'); if(pc) pc.insertAdjacentHTML('afterbegin', panelHtml());
};
window.__bulkTest = {buildPdf, purchaseBoxHtml, purchaseGroups, summaryPages, B};   // পরীক্ষার জন্য
})();
