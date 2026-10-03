/* ============================================================
   Avera Mart — Business Manager (Firebase Firestore backend)
   All devices share one cloud database via Firestore + Anonymous Auth.
   ============================================================ */

const COLLECTION = 'averamart';
let db = null;

/* In-memory cache — kept live in sync with Firestore via onSnapshot */
const CACHE = {
  products: [],
  orders: [],
  purchases: [],
  expenses: [],
  returns: [],
  shareholders: [],
  contributions: [],
  closings: [],
  settings: {
    dividendPercent: 50,
    productCategories: ['খাদ্যশস্য','ডাল','তেল','মসলা','অর্গানিক আইটেম','অন্যান্য'],
    expenseCategories: ['দোকান ভাড়া','পরিবহন ও কুরিয়ার','প্যাকেজিং','বেতন','বিদ্যুৎ বিল','অন্যান্য'],
    businessAddress: 'রাজশাহী, বাংলাদেশ'
  },
  users: { admin:{pin:'1234'}, manager:{pin:'2222'}, delivery:{pin:'3333'} }
};
const LOADED = { products:false, orders:false, purchases:false, expenses:false, returns:false, shareholders:false, contributions:false, closings:false, settings:false, users:false };

const DEFAULT_PRODUCTS = [
  {id:'P001', name:'প্রিমিয়াম মিনিকেট চাল (৫ কেজি)', category:'খাদ্যশস্য', cost:340, retail:390, shareholder:365, stock:40, minStock:10},
  {id:'P002', name:'সয়াবিন তেল (৫ লিটার)', category:'তেল', cost:780, retail:850, shareholder:815, stock:15, minStock:8},
  {id:'P003', name:'মসুর ডাল (১ কেজি)', category:'ডাল', cost:110, retail:130, shareholder:120, stock:5, minStock:10}
];

/* ---------------- Firebase bootstrap ---------------- */
function initFirebase(){
  try{
    firebase.initializeApp(firebaseConfig);
  }catch(e){ /* already initialized */ }
  db = firebase.firestore();
  const auth = firebase.auth();

  auth.onAuthStateChanged(user => {
    if(user){
      attachListeners();
    } else {
      auth.signInAnonymously().catch(err => {
        document.getElementById('loginStatus').textContent =
          '⚠️ ক্লাউড সংযোগে সমস্যা হয়েছে। firebase-config.js ফাইলে সঠিক কনফিগারেশন বসানো আছে কিনা যাচাই করুন। (' + err.message + ')';
      });
    }
  });
}

function docRef(name){ return db.collection(COLLECTION).doc(name); }

/* ---- ডেটা সুরক্ষা ----
   ১) ক্যাশ (অফলাইন/ধীর নেট) থেকে "ডকুমেন্ট নেই" এলে আর ডেমো/খালি ডেটা লেখা হয় না — শুধু সার্ভার নিশ্চিত করলে তবেই নতুন ডেটা তৈরি হয়।
   ২) প্রতিবার সার্ভার থেকে ডেটা এলে এই ডিভাইসে একটা "নিরাপদ কপি" থাকে; ডেটা হঠাৎ অস্বাভাবিক কমে গেলে সতর্কতা ও ফেরত আনার বাটন আসে। */
const SAFE_COLS = ['products','orders','purchases','expenses','returns','shareholders','contributions','closings'];
const SAFE_ALERT = {};
function safeCopyUpdate(name, items){
  try{
    const raw = localStorage.getItem('AM_safe_'+name);
    const prev = raw ? JSON.parse(raw) : null;
    if(prev && prev.n >= 10 && items.length < prev.n*0.5){ SAFE_ALERT[name] = {prevN:prev.n, nowN:items.length, ts:prev.ts}; return; }
    delete SAFE_ALERT[name];
    localStorage.setItem('AM_safe_'+name, JSON.stringify({ts:Date.now(), n:items.length, items}));
  }catch(e){}
}
function renderDataLossBar(){
  let bar = document.getElementById('dataLossBar');
  const names = Object.keys(SAFE_ALERT);
  if(!names.length){ if(bar) bar.remove(); return; }
  if(!bar){ bar = document.createElement('div'); bar.id = 'dataLossBar'; bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#B3261E;color:#fff;padding:12px 14px;font-size:13.5px;line-height:1.6;box-shadow:0 -2px 10px rgba(0,0,0,.3);'; document.body.appendChild(bar); }
  const lbl = {products:'পণ্য',orders:'অর্ডার',purchases:'ক্রয়',expenses:'খরচ/আয়',returns:'রিটার্ন',shareholders:'শেয়ারহোল্ডার',contributions:'জমা',closings:'মাস ক্লোজিং'};
  const detail = names.map(n => `${lbl[n]||n}: ${SAFE_ALERT[n].prevN}টি → ${SAFE_ALERT[n].nowN}টি`).join(' · ');
  const when = fmtDT(new Date(SAFE_ALERT[names[0]].ts).toISOString());
  bar.innerHTML = `⚠️ <b>ডেটা হঠাৎ অনেক কমে গেছে!</b> (${detail})<br>এই ডিভাইসে ${when}-এর নিরাপদ কপি আছে। ${isAdmin()?`<button onclick="restoreSafeCopy()" style="margin-top:6px;background:#fff;color:#B3261E;border:0;border-radius:6px;padding:7px 12px;font-weight:700;">⏪ নিরাপদ কপি থেকে ফেরত আনুন</button> <button onclick="dismissSafeAlert()" style="margin-top:6px;background:transparent;color:#fff;border:1px solid #fff;border-radius:6px;padding:7px 12px;">না, এটাই ঠিক</button>`:'অ্যাডমিনকে এখনই জানান।'}`;
}
function restoreSafeCopy(){
  if(!isAdmin()) return;
  const names = Object.keys(SAFE_ALERT);
  if(!names.length || !confirm('এই ডিভাইসের নিরাপদ কপি থেকে কমে যাওয়া ডেটা ফেরত আনবেন?\n\n(এখনকার ডেটার একটা ব্যাকআপ আগে নিজে থেকেই ডাউনলোড হবে)')) return;
  try{ downloadBackup(); }catch(e){}
  FORCE_SAVE = true; setTimeout(()=>{ FORCE_SAVE = false; }, 30000);
  names.forEach(n => { try{ const c = JSON.parse(localStorage.getItem('AM_safe_'+n)); if(c && Array.isArray(c.items)){ saveCollection(n, c.items); delete SAFE_ALERT[n]; } }catch(e){} });
  renderDataLossBar(); onCloudUpdate();
  alert('✅ ফেরত আনা হয়েছে। সংখ্যাগুলো একবার মিলিয়ে দেখুন।');
}
function dismissSafeAlert(){
  if(!confirm('ডেটা ইচ্ছা করেই কমানো হয়ে থাকলে এগিয়ে যান — পুরোনো নিরাপদ কপি মুছে নতুন কপি রাখা হবে।')) return;
  Object.keys(SAFE_ALERT).forEach(n => { try{ localStorage.removeItem('AM_safe_'+n); }catch(e){} delete SAFE_ALERT[n]; safeCopyUpdate(n, CACHE[n]||[]); });
  renderDataLossBar();
}
function listenDoc(name, apply, seed, items){
  let last = null;
  docRef(name).onSnapshot({includeMetadataChanges:true}, snap => {
    if(snap.exists){
      const data = snap.data(), js = JSON.stringify(data);
      if(js === last && LOADED[name]) return;      // শুধু মেটাডেটা বদলালে আবার রেন্ডার নয়
      last = js;
      apply(data);
      if(!snap.metadata.fromCache && items) safeCopyUpdate(name, items(data));
    } else {
      if(snap.metadata.fromCache) return;           // ক্যাশের "নেই" বিশ্বাস করা যাবে না — সার্ভারের উত্তরের অপেক্ষা
      seed();
    }
    LOADED[name] = true; onCloudUpdate(); renderDataLossBar();
    if(allLoaded() && !BK_TRIED){ BK_TRIED = true; setTimeout(() => runServerBackup(false), 8000); }
  }, err => {
    const el = document.getElementById('loginStatus');
    if(el) el.textContent = '⚠️ ডেটা লোড করা যায়নি (' + err.message + ')';
  });
}
function attachListeners(){
  const arr = (name, seedItems) => listenDoc(name,
    d => { CACHE[name] = d.items || []; },
    () => { docRef(name).set({items: seedItems}); CACHE[name] = seedItems; },
    d => d.items || []);
  arr('products', DEFAULT_PRODUCTS);
  ['orders','purchases','expenses','returns','shareholders','contributions','closings'].forEach(n => arr(n, []));
  listenDoc('settings', data => {
    // older deployments may not have the category lists yet — merge in the defaults once
    const merged = {
      dividendPercent: data.dividendPercent ?? CACHE.settings.dividendPercent,
      productCategories: data.productCategories && data.productCategories.length ? data.productCategories : CACHE.settings.productCategories,
      expenseCategories: data.expenseCategories && data.expenseCategories.length ? data.expenseCategories : CACHE.settings.expenseCategories,
      businessAddress: data.businessAddress || CACHE.settings.businessAddress
    };
    CACHE.settings = merged;
    if(!data.productCategories || !data.expenseCategories || !data.businessAddress) docRef('settings').set(merged);
  }, () => { docRef('settings').set(CACHE.settings); });
  listenDoc('users', data => { CACHE.users = data; }, () => { docRef('users').set(CACHE.users); });
  // ১৫ সেকেন্ডেও সার্ভার থেকে সাড়া না এলে ব্যবহারকারীকে জানানো (ডেটা তৈরি/মোছা বন্ধ থাকে)
  setTimeout(() => {
    if(!allLoaded()){
      const el = document.getElementById('loginStatus');
      if(el) el.textContent = '⚠️ ইন্টারনেট সংযোগ দুর্বল — সার্ভার থেকে ডেটা আসেনি। নেট ঠিক হলে পেইজ রিফ্রেশ করুন। (নিরাপত্তার জন্য কোনো ডেটা তৈরি বা পরিবর্তন করা হচ্ছে না)';
    }
  }, 15000);
}

function allLoaded(){ return Object.values(LOADED).every(Boolean); }

function onCloudUpdate(){
  if(!allLoaded()) return;
  const loginScreenVisible = !document.getElementById('loginScreen').classList.contains('hidden');
  if(loginScreenVisible){
    document.getElementById('loginStatus').textContent = '';
    document.getElementById('loginFormWrap').classList.remove('hidden');
  } else {
    // একটা ফর্ম খোলা থাকলে (কেউ টাইপ করছে) পেইজ রিফ্রেশ করে সেটা মুছে ফেলা হবে না
    const mh = document.getElementById('modalHolder');
    if(mh && mh.innerHTML.trim()) return;
    if(currentPage==='returns' && (document.getElementById('ret_order')||{}).value) return;
    if(currentPage==='invoice'){ renderInvoice((document.getElementById('inv_order')||{}).value || ''); return; }
    // live re-render current page so every device sees updates instantly
    const renderers = {
      dashboard: renderDashboard, products: renderProducts, orders: renderOrders,
      purchases: renderPurchases, expenses: renderExpenses, dues: renderDues, returns: renderReturns, discounts: renderDiscounts, inventory: renderInventory, shareholders: renderShareholders, profitloss: renderProfitLoss, closing: renderClosing, stockcheck: renderStockCheck,
      invoice: renderInvoice, settings: renderSettings
    };
    (renderers[currentPage] || renderDashboard)();
  }
}

/* ---------------- Firestore write helpers ---------------- */
let FORCE_SAVE = false;
function saveFailed(name, err){ alert('⚠️ সার্ভারে সংরক্ষণ হয়নি (' + name + '): ' + (err && err.message || err) + '\n\nপেইজ রিফ্রেশ করবেন না। ইন্টারনেট ও Firebase নিয়ম (rules) দেখুন, তারপর আবার চেষ্টা করুন।'); }
function saveCollection(name, arr){
  const prev = CACHE[name] || [];
  if(!FORCE_SAVE && prev.length >= 10 && arr.length < prev.length*0.5){
    alert('🛑 নিরাপত্তা: একসাথে অর্ধেকের বেশি এন্ট্রি মুছে ফেলা হচ্ছিল (' + name + ': ' + prev.length + ' → ' + arr.length + '), তাই সংরক্ষণ আটকে দেওয়া হয়েছে। অল্প অল্প করে মুছুন।');
    return false;
  }
  let size = 0; try{ size = JSON.stringify(arr).length; }catch(e){}
  if(size > 980000){ alert('🛑 ' + name + '-এর ডেটা Firebase-এর ১ MB সীমায় পৌঁছে গেছে — সংরক্ষণ করা যাচ্ছে না। ডেভেলপারকে জানান (সেটিংস → ডেটা ব্যবহার দেখুন)।'); return false; }
  CACHE[name] = arr;
  docRef(name).set({items: arr}).catch(e => saveFailed(name, e));
  return true;
}
function saveSettings(obj){ CACHE.settings = obj; docRef('settings').set(obj).catch(e => saveFailed('settings', e)); }
function saveUsers(obj){ CACHE.users = obj; docRef('users').set(obj).catch(e => saveFailed('users', e)); }

/* ---------------- Helpers ---------------- */
function fmtBasis(p){ const n = Number(p&&p.priceBasis)||1; return n===1 ? '' : `${r3(n)} ${(p&&p.unit)||'কেজি'}`; }
function packPrice(p, field){ const n = Number(p&&p.priceBasis)||1; return Math.round(Number(p&&p[field]||0)*n*100)/100; }
function money(n){ return '৳' + Number(n||0).toLocaleString('en-BD', {maximumFractionDigits:2}); }
function todayStr(){ return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
function pickedDate(id){ const v = (document.getElementById(id)||{}).value; return /^\d{4}-\d{2}-\d{2}$/.test(v||'') ? v : todayStr(); }
function dateField(id, value){ return `<div class="form-field"><label>তারিখ (না বদলালে আজকের তারিখ)</label><input id="${id}" type="date" value="${value||todayStr()}"></div>`; }
function genId(prefix, list){
  const nums = list.map(x => parseInt((x.id||'').replace(/\D/g,'')) || 0);
  const next = (nums.length? Math.max(...nums) : 0) + 1;
  return prefix + String(next).padStart(3,'0');
}
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ---------------- v2.2 helpers ---------------- */
const UNIT_OPTIONS = ['কেজি','গ্রাম','লিটার','মিলিলিটার','পিস','ডজন','হালি','প্যাকেট','বস্তা'];
function isAdmin(){ const s = getSession(); return !!s && s.role==='admin'; }
function toTop(){ window.scrollTo({top:0, behavior:'smooth'}); }
function closeForm(fn){ fn(); toTop(); }
// ফর্ম খুলে অটোমেটিক সেখানে স্ক্রল করে নিয়ে যায় (নিচে নেমে খুঁজতে হয় না)
function openForm(html){
  const h = document.getElementById('modalHolder'); if(!h) return;
  h.innerHTML = html;
  requestAnimationFrame(()=>{
    const panel = h.firstElementChild || h;
    panel.scrollIntoView({behavior:'smooth', block:'start'});
    if(window.matchMedia && matchMedia('(pointer:fine)').matches){
      const f = h.querySelector('input:not([type=date]):not([type=checkbox]):not([type=file]):not([type=hidden]), textarea');
      if(f) f.focus({preventScroll:true});
    }
  });
}
// সংরক্ষণের পর সবুজ নোটিশ + নতুন/পরিবর্তিত সারিতে হলুদ দাগ
let FLASH = null;   // {page, html, warn, hl:[ids], scrolled}
function setFlash(page, html, hl, warn){ FLASH = {page, html, warn:!!warn, hl: [].concat(hl||[]), scrolled:false}; }
function clearFlash(){ FLASH = null; const el = document.getElementById('flashBox'); if(el) el.remove(); document.querySelectorAll('.row-hl').forEach(r=>r.classList.remove('row-hl')); }
function flashHtml(page){
  return (FLASH && FLASH.page===page) ? `<div class="flash ${FLASH.warn?'warn':''}" id="flashBox"><button class="flash-close" onclick="clearFlash()">✕</button>${FLASH.html}</div>` : '';
}
function hlClass(page, id){ return (FLASH && FLASH.page===page && FLASH.hl.includes(id)) ? 'row-hl' : ''; }
function scrollToHl(){
  if(!FLASH || FLASH.scrolled) return;
  const el = document.querySelector('tr.row-hl');
  FLASH.scrolled = true;
  if(el) setTimeout(()=>el.scrollIntoView({behavior:'smooth', block:'center'}), 60);
}
function stampEdit(obj){ obj.editedAt = new Date().toISOString(); obj.editedBy = (getSession()||{}).role || ''; return obj; }
function editedBadge(x){
  if(!x || !x.editedAt) return '';
  let when = ''; try{ when = new Date(x.editedAt).toLocaleString('bn-BD',{timeZone:'Asia/Dhaka'}); }catch(e){}
  return `<span class="badge badge-edited" title="${esc('সংশোধন: '+when)}">সংশোধিত</span>`;
}
function stockTotals(){
  let cost = 0, retail = 0, count = 0;
  CACHE.products.forEach(p=>{
    const st = Math.max(0, Number(p.stock)||0);
    if(st>0){ count++; cost += st*Number(p.cost||0); retail += st*Number(p.retail||0); }
  });
  return {cost: Math.round(cost*100)/100, retail: Math.round(retail*100)/100, count};
}
function adjustStock(products, items, sign){
  items.forEach(it=>{
    const i = products.findIndex(p=>p.id===it.productId);
    if(i>-1) products[i] = {...products[i], stock: r3(Number(products[i].stock) + sign*Number(it.qty||0))};
  });
}

/* An order can hold multiple product line items. Older orders saved before this
   feature only had a single productId/qty/unitPrice — this normalizes both shapes. */
function r3(n){ return Math.round(Number(n||0)*1000)/1000; }
const UNIT_FAMILY = {
  'কেজি': {label:'গ্রাম', factor:1000},
  'লিটার': {label:'মি.লি.', factor:1000},
  'ডজন': {label:'পিস', factor:12},
  'হালি': {label:'পিস', factor:4},
  'গ্রাম': {label:'কেজি', factor:0.001},
  'মিলিলিটার': {label:'লিটার', factor:0.001}
};
function subInfo(p){
  if(!p) return null;
  const fromText = parsePackUnit(p.unit);          // "৫০০ গ্রাম", "১ কেজি" ইত্যাদি লেখা থেকেই হিসাব — এটাই সঠিক
  if(fromText) return fromText;
  if(Number(p.packSize)>0) return {label: p.packLabel || 'গ্রাম', factor: Number(p.packSize), pack:true};
  const f = UNIT_FAMILY[p.unit];
  if(f) return {...f};
  return null;
}
// Understands units typed as text such as "৫০০ গ্রাম", "500g", "১ কেজি", "২৫০ মি.লি.", "১ লিটার", "১২ পিস"
function parsePackUnit(unit){
  const bn = '০১২৩৪৫৬৭৮৯';
  const t = String(unit||'').trim().replace(/[০-৯]/g, d => bn.indexOf(d)).replace(/\s+/g,' ');
  const m = t.match(/^(\d+(?:\.\d+)?)\s*(গ্রাম|গ্রা\.?|gm|g|কেজি|কেজি\.?|kg|লিটার|ltr|l|মিলিলিটার|মি\.?লি\.?|ml|পিস|pcs)$/i);
  if(!m) return null;
  const n = Number(m[1]); if(!(n>0)) return null;
  const u = m[2].toLowerCase();
  if(['গ্রাম','গ্রা','গ্রা.','gm','g'].includes(u)) return {label:'গ্রাম', factor:n, pack:true};
  if(['কেজি','কেজি.','kg'].includes(u))           return {label:'গ্রাম', factor:n*1000, pack:true};
  if(['লিটার','ltr','l'].includes(u))              return {label:'মি.লি.', factor:n*1000, pack:true};
  if(u==='পিস' || u==='pcs')                       return {label:'পিস', factor:n, pack:true};
  return {label:'মি.লি.', factor:n, pack:true};
}
// every unit the seller may pick for a product; factor = how many of that unit make ONE base unit
function unitOptions(p){
  const base = {key:'base', label:(p&&p.unit)||'কেজি', factor:1};
  const info = subInfo(p);
  if(!info) return [base];
  const opts = [base, {key:'sub', label:info.label, factor:info.factor}];
  if(info.pack){
    if(info.label==='গ্রাম') opts.push({key:'big', label:'কেজি', factor:info.factor/1000});
    else if(info.label==='মি.লি.') opts.push({key:'big', label:'লিটার', factor:info.factor/1000});
  }
  return opts;
}
function optByKey(p,key){ const o = unitOptions(p); return o.find(x=>x.key===key) || o[0]; }
function unitSelectHtml(p, selectedKey, attrs){
  const o = unitOptions(p);
  if(o.length<2) return `<span class="muted-cell">${esc(o[0].label)}</span>`;
  return `<select ${attrs} style="padding:4px;border:1px solid var(--border);border-radius:6px;">${o.map(x=>`<option value="${x.key}" ${x.key===selectedKey?'selected':''}>${esc(x.label)}</option>`).join('')}</select>`;
}
function fmtQty(qty, p){
  const unit = (p && p.unit) || 'কেজি';
  const info = subInfo(p || {unit});
  const q = Number(qty);
  if(info && info.factor > 1 && q > 0 && q < 1) return `${r3(q*info.factor)} ${info.label}`;
  if(info && info.pack && q > 1 && Math.abs(q - Math.round(q)) > 0.0001) return `${r3(q)} ${unit} (${r3(q*info.factor)} ${info.label})`;
  return `${r3(q)} ${unit}`;
}
function lineAmt(it){ return Math.round(Number(it.qty)*Number(it.unitPrice)*100)/100; }
// what the customer sees: exactly the unit the seller picked (e.g. "10 গ্রাম", "2 কেজি")
function fmtItem(it, p){ return (it.dq!=null && it.du) ? `${it.dq} ${it.du}` : fmtQty(it.qty, p); }
function syncDisp(it, p){
  if(it.du==null) return;
  const o = unitOptions(p).find(x=>x.label===it.du);
  it.dq = r3(it.qty*(o?o.factor:1));
}
// stock shown like "২ কেজি ৩৫০ গ্রাম" instead of a decimal
function fmtStock(stock, p){
  const unit = (p && p.unit) || 'কেজি';
  const info = subInfo(p);
  const st = Number(stock||0);
  if(st < 0) return '-' + fmtStock(-st, p);
  if(!info || info.pack || info.factor <= 1) return `${r3(st)} ${unit}`;
  const whole = Math.floor(st + 1e-9);
  const rem = Math.round((st - whole) * info.factor);
  if(whole===0 && rem===0) return `0 ${unit}`;
  if(whole===0) return `${rem} ${info.label}`;
  return rem ? `${whole} ${unit} ${rem} ${info.label}` : `${whole} ${unit}`;
}
function orderItems(o){
  if(o.items && o.items.length) return o.items;
  if(o.productId) return [{productId:o.productId, qty:o.qty, unitPrice:o.unitPrice}];
  return [];
}
function orderDue(o){
  const total = Number(o.total||0);
  const paid = (o.paidAmount!=null) ? Number(o.paidAmount) : (o.paymentStatus==='Paid' ? total : 0);
  return Math.max(0, total - paid);
}
function purchaseDue(pu){
  const total = Number(pu.totalCost||0);
  const paid = (pu.paidAmount!=null) ? Number(pu.paidAmount) : (pu.paymentStatus==='Paid' ? total : 0);
  return Math.max(0, total - paid);
}

const STATUS_BADGE = { 'Pending':'badge-pending','Processing':'badge-processing','Delivered':'badge-delivered','Cancelled':'badge-cancelled' };
const STATUS_BN = { 'Pending':'পেন্ডিং','Processing':'প্রসেসিং','Delivered':'ডেলিভারড','Cancelled':'বাতিল' };
const PAY_BADGE = { 'Paid':'badge-paid','Due':'badge-due','Partial':'badge-partial' };
const PAY_BN = { 'Paid':'পরিশোধিত','Due':'বাকি','Partial':'আংশিক' };
const PAY_METHODS = [
  {value:'Cash', label:'ক্যাশ'},
  {value:'Nagad', label:'নগদ'},
  {value:'bKash', label:'বিকাশ'},
  {value:'Rocket', label:'রকেট'},
  {value:'Bank', label:'ব্যাংক'}
];

/* ---------------- Session (who's logged in on THIS device) ---------------- */
function getSession(){
  const raw = localStorage.getItem('AM_session');
  return raw ? JSON.parse(raw) : null;
}
function handleLogin(){
  const role = document.getElementById('loginRole').value;
  const pin = document.getElementById('loginPin').value.trim();
  const errEl = document.getElementById('loginError');
  if(!allLoaded()){ errEl.textContent = 'ক্লাউড ডেটা লোড হচ্ছে, একটু অপেক্ষা করুন।'; return; }
  if(!pin){ errEl.textContent = 'পিন লিখুন।'; return; }
  if(CACHE.users[role] && CACHE.users[role].pin === pin){
    localStorage.setItem('AM_session', JSON.stringify({role}));
    errEl.textContent = '';
    boot();
  } else {
    errEl.textContent = 'ভুল পিন। আবার চেষ্টা করুন।';
  }
}
function handleLogout(){
  localStorage.removeItem('AM_session');
  boot();
}

/* ---------------- Nav config ---------------- */
const NAV_ITEMS = [
  {key:'dashboard', label:'ড্যাশবোর্ড', icon:'🏠', roles:['admin','manager']},
  {key:'products', label:'পণ্য তালিকা', icon:'📦', roles:['admin','manager']},
  {key:'orders', label:'অর্ডার ও সেলস', icon:'🛍️', roles:['admin','manager','delivery']},
  {key:'purchases', label:'ক্রয় খাতা', icon:'🛒', roles:['admin','manager']},
  {key:'expenses', label:'খরচ খাতা', icon:'💸', roles:['admin','manager']},
  {key:'dues', label:'বকেয়া হিসাব', icon:'📒', roles:['admin','manager']},
  {key:'returns', label:'রিটার্ন ও সমন্বয়', icon:'🔄', roles:['admin','manager']},
  {key:'discounts', label:'ডিসকাউন্ট রেজিস্টার', icon:'🏷️', roles:['admin','manager']},
  {key:'inventory', label:'ইনভেন্টরি রিপোর্ট', icon:'📋', roles:['admin','manager']},
  {key:'profitloss', label:'লাভ-ক্ষতি', icon:'📊', roles:['admin']},
  {key:'closing', label:'মাস ক্লোজিং ও লক', icon:'🔒', roles:['admin']},
  {key:'stockcheck', label:'স্টক মূল্য যাচাই', icon:'🧮', roles:['admin']},
  {key:'invoice', label:'ইনভয়েস', icon:'🧾', roles:['admin','manager','delivery']},
  {key:'settings', label:'সেটিংস', icon:'⚙️', roles:['admin']}
];

let currentPage = 'dashboard';

function toggleSidebar(){
  const open = document.querySelector('.sidebar').classList.toggle('open');
  document.getElementById('sidebarBackdrop').classList.toggle('show', open);
}

function renderNav(){
  const session = getSession();
  const nav = document.getElementById('sideNav');
  const items = NAV_ITEMS.filter(i => i.roles.includes(session.role));
  nav.innerHTML = items.map(i => `
    <button class="nav-item ${currentPage===i.key?'active':''}" onclick="go('${i.key}')">
      <span>${i.label}</span><span>${i.icon}</span>
    </button>`).join('');

  const roleLabelMap = {admin:'অ্যাডমিন', manager:'ম্যানেজার', delivery:'ডেলিভারি ম্যান'};
  document.getElementById('sessionInfo').textContent = 'লগইন: ' + roleLabelMap[session.role] + ' · ☁️ লাইভ';
}

function go(page){
  const session = getSession();
  const allowed = NAV_ITEMS.find(i=>i.key===page);
  if(allowed && !allowed.roles.includes(session.role)) page = NAV_ITEMS.find(i=>i.roles.includes(session.role)).key;
  currentPage = page;
  FLASH = null;
  window.scrollTo(0,0);
  renderNav();
  document.querySelector('.sidebar').classList.remove('open');
  document.getElementById('sidebarBackdrop').classList.remove('show');
  const titles = Object.fromEntries(NAV_ITEMS.map(i=>[i.key,i.label]));
  document.getElementById('pageTitle').textContent = titles[page] || '';
  const renderers = {
    dashboard: renderDashboard, products: renderProducts, orders: renderOrders,
    purchases: renderPurchases, expenses: renderExpenses, dues: renderDues, returns: renderReturns, discounts: renderDiscounts, inventory: renderInventory, shareholders: renderShareholders, profitloss: renderProfitLoss, closing: renderClosing, stockcheck: renderStockCheck,
    invoice: renderInvoice, settings: renderSettings
  };
  (renderers[page] || renderDashboard)();
}

/* ---------------- Boot ---------------- */
function boot(){
  const session = getSession();
  if(session){
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('appShell').classList.remove('hidden');
    go(NAV_ITEMS.find(i=>i.roles.includes(session.role)).key);
  } else {
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('appShell').classList.add('hidden');
    if(!allLoaded()){
      document.getElementById('loginFormWrap').classList.add('hidden');
      document.getElementById('loginStatus').textContent = '☁️ ক্লাউড ডেটাবেজের সাথে সংযোগ করা হচ্ছে...';
    } else {
      document.getElementById('loginStatus').textContent = '';
    }
  }
}
document.addEventListener('DOMContentLoaded', () => { initFirebase(); boot(); });

if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* installability is a bonus, never block the app on it */ });
  });
}

/* ============================================================
   MONTHLY ACCOUNTS — মাসভিত্তিক হিসাব, জের (carry-forward) ও লক
   সব হিসাব তারিখযুক্ত এন্ট্রি থেকে বের হয়, তাই আগের মাসে কিছু যোগ/সংশোধন করলে
   পরের মাসগুলোর শুরুর জের নিজে থেকেই ঠিক হয়ে যায়। লক করা মাসের হিসাব "স্ন্যাপশট" হিসেবে স্থির থাকে।
   ============================================================ */
const BN_MONTHS = ['জানুয়ারি','ফেব্রুয়ারি','মার্চ','এপ্রিল','মে','জুন','জুলাই','আগস্ট','সেপ্টেম্বর','অক্টোবর','নভেম্বর','ডিসেম্বর'];
function monthLabel(m){ const p = String(m).split('-'); return (BN_MONTHS[Number(p[1])-1] || p[1]) + ' ' + p[0]; }
function curMonth(){ return todayStr().slice(0,7); }
function mOf(d){ return (typeof d==='string' && /^\d{4}-\d{2}/.test(d)) ? d.slice(0,7) : ''; }
function addMonths(m, n){
  const p = m.split('-'); const d = new Date(Date.UTC(Number(p[0]), Number(p[1])-1+n, 1));
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth()+1).padStart(2,'0');
}
function fmtDT(iso){ try{ return new Date(iso).toLocaleString('en-GB',{timeZone:'Asia/Dhaka', day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'}); }catch(e){ return ''; } }
const r2 = n => Math.round(Number(n||0)*100)/100;
function closingRec(m){ return (CACHE.closings||[]).find(c=>c.month===m); }
function isMonthLocked(m){ const c = closingRec(m); return !!(c && c.locked); }
function isDateLocked(d){ const m = mOf(d); return !!m && isMonthLocked(m); }
function guardDates(dates, what){
  for(const d of dates){
    if(d && isDateLocked(d)){
      alert(`🔒 ${monthLabel(mOf(d))} মাসের হিসাব লক করা আছে — ${what} করা যাবে না।\n\nবিশেষ প্রয়োজনে অ্যাডমিন "মাস ক্লোজিং ও লক" পেইজ থেকে লক খুলে কাজ করে আবার লক করতে পারবেন।`);
      return false;
    }
  }
  return true;
}
function guardDate(d, what){ return guardDates([d], what); }
// যে মাসগুলোতে কোনো এন্ট্রি আছে (+ চলমান মাস + লক করা মাস), পুরোনো থেকে নতুন
function monthsList(){
  const set = new Set([curMonth()]);
  [CACHE.orders, CACHE.purchases, CACHE.expenses, CACHE.returns, CACHE.contributions].forEach(a => (a||[]).forEach(x => { const m = mOf(x.date); if(m) set.add(m); }));
  (CACHE.closings||[]).forEach(c => set.add(c.month));
  return Array.from(set).sort();
}
function moveIndex(){
  const idx = {}, ordMap = {}, retMap = {};
  CACHE.orders.forEach(o => ordMap[o.id] = o);
  const slot = (pid, m) => { const a = idx[pid] || (idx[pid] = {}); return a[m] || (a[m] = {P:0,S:0,R:0,A:0}); };
  CACHE.purchases.forEach(pu => { const m = mOf(pu.date); if(m && pu.productId) slot(pu.productId, m).P += Number(pu.qty||0); });
  CACHE.returns.forEach(r => {
    const o = ordMap[r.orderId];
    const restocked = (r.restocked!==undefined) ? !!r.restocked : !!(o && o.status==='Delivered');
    if(!restocked) return;
    const m = mOf(r.date); if(m) slot(r.productId, m).R += Number(r.qty||0);
    const rm = retMap[r.orderId] || (retMap[r.orderId] = {});
    rm[r.productId] = (rm[r.productId]||0) + Number(r.qty||0);
  });
  CACHE.orders.forEach(o => {
    if(o.status!=='Delivered') return;
    const m = mOf(o.date); if(!m) return;
    const rm = Object.assign({}, retMap[o.id] || {});
    orderItems(o).forEach(it => { const extra = rm[it.productId] || 0; delete rm[it.productId]; slot(it.productId, m).S += Number(it.qty||0) + extra; });
    Object.keys(rm).forEach(pid => { slot(pid, m).S += rm[pid]; });
  });
  CACHE.products.forEach(p => (p.adj||[]).forEach(a => { const m = mOf(a.d); if(m) slot(p.id, m).A += Number(a.q||0); }));
  return idx;
}
function stockRowFor(p, m, idx){
  const mv = idx[p.id] || {};
  const after = {P:0,S:0,R:0,A:0};
  Object.keys(mv).forEach(k => { if(k > m){ after.P+=mv[k].P; after.S+=mv[k].S; after.R+=mv[k].R; after.A+=mv[k].A; } });
  const cur = mv[m] || {P:0,S:0,R:0,A:0};
  const close = r3(Number(p.stock||0) - (after.P - after.S + after.R + after.A));
  const open = r3(close - (cur.P - cur.S + cur.R + cur.A));
  return {open, P:r3(cur.P), S:r3(cur.S), R:r3(cur.R), A:r3(cur.A), close, cost:Number(p.cost||0)};
}
// row = [id, name, unit, open, purchased, sold, returned, adjust, close, cost, hidden]
function liveFigures(m, idx){
  idx = idx || moveIndex();
  const products = CACHE.products;
  const ords = CACHE.orders.filter(o => o.status==='Delivered' && mOf(o.date)===m);
  const revenue = ords.reduce((t,o) => t + Number(o.total||0), 0);
  const cogs = ords.reduce((t,o) => t + orderItems(o).reduce((t2,it) => { const p = products.find(x=>x.id===it.productId); return t2 + (p ? Number(p.cost||0) : 0) * Number(it.qty||0); }, 0), 0);
  const expenses = CACHE.expenses.filter(e => e.kind!=='income' && mOf(e.date)===m).reduce((t,e) => t + Number(e.amount||0), 0);
  const otherIncome = CACHE.expenses.filter(e => e.kind==='income' && mOf(e.date)===m).reduce((t,e) => t + Number(e.amount||0), 0);
  const rows = []; let openVal = 0, closeVal = 0;
  products.forEach(p => {
    const r = stockRowFor(p, m, idx);
    openVal += r.open * r.cost; closeVal += r.close * r.cost;
    if(r.open || r.P || r.S || r.R || r.A || r.close || !p.hidden) rows.push([p.id, p.name, p.unit||'কেজি', r.open, r.P, r.S, r.R, r.A, r.close, r.cost, p.hidden?1:0]);
  });
  const custDueNew = CACHE.orders.filter(o => o.status!=='Cancelled' && mOf(o.date)===m).reduce((t,o) => t + orderDue(o), 0);
  const supDueNew = CACHE.purchases.filter(pu => mOf(pu.date)===m).reduce((t,pu) => t + purchaseDue(pu), 0);
  const cap = CACHE.shareholders.map(sh => {
    const after = CACHE.contributions.filter(c => c.shareholderId===sh.id && mOf(c.date) > m).reduce((t,c) => t + Number(c.amount||0), 0);
    return [sh.id, sh.name, Math.max(0, r2(Number(sh.totalInvested||0) - after))];
  });
  return {revenue:r2(revenue), cogs:r2(cogs), expenses:r2(expenses), otherIncome:r2(otherIncome), rows, openVal:r2(openVal), closeVal:r2(closeVal),
          custDueNew:r2(custDueNew), supDueNew:r2(supDueNew), cap, pct:CACHE.settings.dividendPercent};
}
function monthData(m, idx){
  const c = closingRec(m);
  let d;
  if(c && c.locked && c.snap){ d = {...c.snap, locked:true, lockedAt:c.lockedAt}; }
  else { d = liveFigures(m, idx); d.locked = false; }
  d.month = m;
  d.gross = r2(d.revenue - d.cogs);
  d.net = r2(d.gross + d.otherIncome - d.expenses);
  d.pool = 0;
  d.retained = d.net;   // শেয়ারহোল্ডার বণ্টন নেই — পুরো নিট লাভই জের হিসেবে যায়
  return d;
}
function carryForward(m, idx){
  let t = 0;
  monthsList().filter(x => x < m).forEach(x => { t += monthData(x, idx).retained; });
  return r2(t);
}
function monthOptionsHtml(selected, includeAll){
  const cur = curMonth();
  return (includeAll ? `<option value="all" ${selected==='all'?'selected':''}>সব মাস</option>` : '') +
    monthsList().slice().reverse().map(m => `<option value="${m}" ${m===selected?'selected':''}>${monthLabel(m)}${isMonthLocked(m)?' 🔒':''}${m===cur?' (চলমান)':''}</option>`).join('');
}
function monthStatusHtml(m){
  const cur = curMonth();
  if(isMonthLocked(m)){ const c = closingRec(m); return `<div class="flash warn" style="margin-bottom:14px;">🔒 <b>${monthLabel(m)}</b> মাসের হিসাব লক করা আছে (${fmtDT(c.lockedAt)}) — এই পেইজের সংখ্যাগুলো স্থির, কোনো পরিবর্তন হবে না।</div>`; }
  if(m === cur) return `<div class="flash" style="margin-bottom:14px;">📅 <b>${monthLabel(m)}</b> — চলমান মাস। হিসাব প্রতিদিনের এন্ট্রি অনুযায়ী বদলাচ্ছে। আগের মাসের জের নিজে থেকেই যোগ হয়েছে।</div>`;
  if(m < cur) return `<div class="flash" style="margin-bottom:14px;">🔓 <b>${monthLabel(m)}</b> — এই মাস এখনো লক হয়নি। হিসাব মিলিয়ে দেখে ${isAdmin()?'"মাস ক্লোজিং ও লক" পেইজ থেকে':'অ্যাডমিনকে বলে'} লক করুন।</div>`;
  return '';
}
let VIEW_MONTH = curMonth();
function onViewMonth(sel){ VIEW_MONTH = sel.value; (currentPage==='profitloss' ? renderProfitLoss : renderInventory)(); }
function viewMonthReport(m, page){ VIEW_MONTH = m; go(page); }

function snapshotOf(m){ const f = liveFigures(m); return f; }
function lockMonth(m){
  if(!isAdmin()){ alert('মাস লক করা শুধু অ্যাডমিন করতে পারবেন।'); return; }
  if(m >= curMonth()){ alert('চলমান মাস শেষ হওয়ার পরই সেই মাস লক করা যাবে।'); return; }
  const earlier = monthsList().filter(x => x < m && !isMonthLocked(x));
  if(earlier.length){ alert(`আগে ${monthLabel(earlier[0])} মাস লক করুন — মাস লক করতে হয় ক্রমানুসারে (পুরোনো থেকে নতুন)।`); return; }
  const f = monthData(m);
  if(!confirm(`${monthLabel(m)} মাসের হিসাব ক্লোজ ও লক করবেন?\n\nবিক্রয়: ${money(f.revenue)}\nনিট লাভ: ${money(f.net)}\nমাস শেষের স্টকের মূল্য: ${money(f.closeVal)}\n\nলক করলে এই মাসের তারিখে কোনো অর্ডার/ক্রয়/খরচ/আয় যোগ, সংশোধন বা মোছা যাবে না। মাস শেষের স্টক ও নিট প্রফিট পরের মাসে জের হিসেবে যোগ হবে।`)) return;
  const now = new Date().toISOString();
  const old = closingRec(m) || {};
  const list = (CACHE.closings||[]).filter(c => c.month !== m);
  list.push({month:m, locked:true, lockedAt:now, lockedBy:'admin', snap:snapshotOf(m), log:(old.log||[]).concat([{t:now, a:'lock'}])});
  saveCollection('closings', list);
  setFlash('closing', `✅ ${monthLabel(m)} মাসের হিসাব ক্লোজ ও লক হয়েছে। মাস শেষের স্টক ও জমা পরের মাসে জের হিসেবে যোগ হয়ে গেছে।`, []);
  renderClosing(); toTop();
}
function unlockMonth(m){
  if(!isAdmin()){ alert('লক খোলা শুধু অ্যাডমিন করতে পারবেন।'); return; }
  const later = (CACHE.closings||[]).filter(c => c.locked && c.month > m).map(c => c.month).sort();
  let msg = `🔓 ${monthLabel(m)} মাসের লক খুলবেন?\n\nলক খুলে যা যোগ/সংশোধন করার করুন, তারপর অবশ্যই আবার লক করবেন।`;
  if(later.length) msg += `\n\n⚠️ এই মাসের পরিবর্তন পরের মাসগুলোর শুরুর জের বদলে দেয়, তাই এর পরের লক করা মাসগুলোও (${later.map(monthLabel).join(', ')}) খুলে যাবে। কাজ শেষে পুরোনো থেকে নতুন ক্রমে আবার লক করতে হবে।`;
  if(!confirm(msg)) return;
  const pin = prompt('নিশ্চিত করতে অ্যাডমিন পিন দিন:');
  if(pin===null) return;
  if(String(pin).trim() !== String((CACHE.users.admin||{}).pin)){ alert('ভুল পিন — লক খোলা হয়নি।'); return; }
  const why = prompt('লক খোলার কারণ লিখুন (ঐচ্ছিক):') || '';
  const now = new Date().toISOString(), tgt = [m].concat(later);
  const list = (CACHE.closings||[]).map(c => tgt.includes(c.month)
    ? {month:c.month, locked:false, lockedAt:c.lockedAt, lockedBy:c.lockedBy, unlockedAt:now, log:(c.log||[]).concat([{t:now, a:'unlock', why: c.month===m ? why : 'আগের মাস খোলার কারণে'}])}
    : c);
  saveCollection('closings', list);
  setFlash('closing', `🔓 ${tgt.map(monthLabel).join(', ')} খোলা হয়েছে। প্রয়োজনীয় কাজ শেষে আবার লক করুন।`, [], true);
  renderClosing(); toTop();
}
function closingBanner(){
  if(!isAdmin()) return '';
  const open = monthsList().filter(m => m < curMonth() && !isMonthLocked(m));
  if(!open.length) return '';
  return `<div class="alert-strip" style="background:#FCEBD5;border-color:#F0D3A0;color:#8A5A16;">🔒 <b>${monthLabel(open[0])}</b>${open.length>1?` সহ ${open.length}টি আগের মাস`:' মাস'} এখনো ক্লোজ ও লক করা হয়নি। <a href="#" onclick="go('closing');return false;" style="color:inherit;font-weight:700;">মাস ক্লোজিং ও লক পেইজে যান</a></div>`;
}
function renderClosing(){
  const cur = curMonth(), ml = monthsList(), idx = moveIndex();
  const cd = monthData(cur, idx);
  const oldCust = CACHE.orders.filter(o => o.status!=='Cancelled' && mOf(o.date) < cur).reduce((t,o) => t + orderDue(o), 0);
  const oldSup = CACHE.purchases.filter(pu => mOf(pu.date) < cur).reduce((t,pu) => t + purchaseDue(pu), 0);
  const rows = ml.slice().reverse().map(m => {
    const d = monthData(m, idx);
    const earlier = ml.filter(x => x < m && !isMonthLocked(x));
    let action;
    if(d.locked) action = `<button class="btn btn-outline btn-sm" onclick="unlockMonth('${m}')">🔓 লক খুলুন</button>`;
    else if(m >= cur) action = `<span class="muted-cell">${m===cur?'চলমান মাস':'ভবিষ্যতের মাস'}</span>`;
    else if(earlier.length) action = `<span class="muted-cell">আগে ${monthLabel(earlier[0])} লক করুন</span>`;
    else action = `<button class="btn btn-primary btn-sm" onclick="lockMonth('${m}')">🔒 ক্লোজ ও লক করুন</button>`;
    return `<tr>
      <td><b>${monthLabel(m)}</b></td>
      <td class="cell-center">${d.locked ? '<span class="badge badge-locked">🔒 লক</span>' : '<span class="badge badge-open">খোলা</span>'}</td>
      <td class="cell-num">${money(d.revenue)}</td>
      <td class="cell-num">${money(d.net)}</td>
      <td class="cell-num">${money(d.closeVal)}</td>
      <td class="cell-center">${action}</td>
      <td class="cell-center"><button class="icon-btn" title="ইনভেন্টরি রিপোর্ট" onclick="viewMonthReport('${m}','inventory')">📋</button><button class="icon-btn" title="লাভ-ক্ষতি" onclick="viewMonthReport('${m}','profitloss')">📊</button></td>
    </tr>`;
  }).join('');
  const logs = [];
  (CACHE.closings||[]).forEach(c => (c.log||[]).forEach(l => logs.push({...l, month:c.month})));
  logs.sort((a,b) => a.t < b.t ? 1 : -1);
  document.getElementById('pageContent').innerHTML = `
    ${flashHtml('closing')}
    <div class="panel">
      <h3>চলমান মাস (${monthLabel(cur)}) — আগের মাস থেকে যা জের হিসেবে এসেছে</h3>
      <table>
        <tr><td>মাসের শুরুর স্টকের মূল্য (ক্রয়মূল্যে)</td><td class="cell-num">${money(cd.openVal)}</td></tr>
        <tr><td>আগের মাসগুলোর জমা নিট লাভ (জের)</td><td class="cell-num">${money(carryForward(cur, idx))}</td></tr>
        <tr><td>আগের মাসগুলোর কাস্টমার বকেয়া (এখনো বাকি)</td><td class="cell-num">${money(oldCust)}</td></tr>
        <tr><td>আগের মাসগুলোর সরবরাহকারী বকেয়া (এখনো বাকি)</td><td class="cell-num">${money(oldSup)}</td></tr>
      </table>
      <p style="font-size:12px;color:var(--text-muted);margin-top:8px;">এগুলো নিজে থেকেই নতুন মাসে যোগ হয়। আগের মাসে পরে কোনো ক্রয়/খরচ/অর্ডার (পুরোনো তারিখে) যোগ করলে এই জের নিজে থেকেই ঠিক হয়ে যাবে।</p>
    </div>
    <div class="panel">
      <h3>মাসভিত্তিক ক্লোজিং</h3>
      <p style="font-size:12.5px;color:var(--text-muted);">মাস শেষ হলে হিসাব মিলিয়ে "ক্লোজ ও লক করুন" চাপুন। লক করা মাসের তারিখে কোনো অর্ডার, ক্রয়, খরচ/আয় যোগ, সংশোধন বা মোছা যায় না। লক ক্রমানুসারে (পুরোনো থেকে নতুন) করতে হয়।</p>
      <div class="table-wrap"><table><thead><tr>
        <th>মাস</th><th>অবস্থা</th><th>বিক্রয়</th><th>নিট লাভ</th><th>মাস শেষের স্টক মূল্য</th><th>একশন</th><th>রিপোর্ট</th>
      </tr></thead><tbody>${rows}</tbody></table></div>
    </div>
    <div class="panel">
      <h3>লক/আনলক ইতিহাস</h3>
      <div class="table-wrap"><table><thead><tr><th>সময়</th><th>মাস</th><th>কাজ</th><th>কারণ</th></tr></thead><tbody>
        ${logs.slice(0,20).map(l => `<tr><td>${fmtDT(l.t)}</td><td>${monthLabel(l.month)}</td><td>${l.a==='lock'?'🔒 লক':'🔓 আনলক'}</td><td>${esc(l.why||'')}</td></tr>`).join('') || '<tr><td colspan="4" class="empty-state">এখনো কোনো মাস লক করা হয়নি</td></tr>'}
      </tbody></table></div>
    </div>`;
}

/* ============================================================
   AVERAGE COST — পণ্যের ক্রয়মূল্য = সেই পণ্যের সব ক্রয় ভাউচারের (মোট খরচ ÷ মোট পরিমাণ)
   প্রতিটি ক্রয় এন্ট্রি/সংশোধন/মোছা/এক্সেল আপলোডে নিজে থেকে হিসাব হয়, তাই ভাউচারের সাথে সফটওয়্যারের দাম মিলে যায়।
   ============================================================ */
function avgCostOf(purchases, pid){
  let q = 0, c = 0;
  purchases.forEach(pu => { if(pu.productId===pid && Number(pu.qty)>0){ q += Number(pu.qty); c += Number(pu.totalCost||0); } });
  return (q>0 && c>0) ? Math.round(c/q*10000)/10000 : null;
}
function applyAvgCosts(products, purchases, ids){
  (ids||[]).forEach(pid => {
    if(!pid) return;
    const i = products.findIndex(p => p.id===pid); if(i<0) return;
    const a = avgCostOf(purchases, pid);
    if(a!==null) products[i] = {...products[i], cost: a};
  });
}
function avgCostPlan(){
  const list = [];
  CACHE.products.forEach(p => {
    const a = avgCostOf(CACHE.purchases, p.id);
    if(a!==null && Math.abs(a - Number(p.cost||0)) > 0.0005) list.push({p, oldCost:Number(p.cost||0), newCost:a});
  });
  const valBefore = CACHE.products.reduce((t,p) => t + Math.max(0,Number(p.stock||0))*Number(p.cost||0), 0);
  const map = {}; list.forEach(x => { map[x.p.id] = x.newCost; });
  const valAfter = CACHE.products.reduce((t,p) => t + Math.max(0,Number(p.stock||0))*(map[p.id]!==undefined ? map[p.id] : Number(p.cost||0)), 0);
  return {list, valBefore:r2(valBefore), valAfter:r2(valAfter)};
}
function applyAvgCostsAll(){
  if(!isAdmin()){ alert('শুধু অ্যাডমিন করতে পারবেন'); return; }
  const plan = avgCostPlan();
  if(!plan.list.length){ alert('সব পণ্যের ক্রয়মূল্য আগেই ভাউচার গড়ের সাথে মিলে আছে।'); return; }
  if(!confirm(`${plan.list.length}টি পণ্যের ক্রয়মূল্য ক্রয় খাতার ভাউচার গড় অনুযায়ী বদলাবে।\\n\\nমোট স্টক মূল্য: ${money(plan.valBefore)} → ${money(plan.valAfter)}\\n\\nনোট: যেসব পণ্যের ক্রয় এন্ট্রি নেই সেগুলো অপরিবর্তিত থাকবে। লক করা মাসের হিসাব বদলাবে না; লক না করা মাসের লাভ নতুন ক্রয়মূল্যে আবার হিসাব হবে। এগিয়ে যাবেন?`)) return;
  const products = CACHE.products.map(p => ({...p}));
  applyAvgCosts(products, CACHE.purchases, plan.list.map(x => x.p.id));
  if(saveCollection('products', products)){ alert(`✅ ${plan.list.length}টি পণ্যের ক্রয়মূল্য ঠিক হয়েছে।`); renderStockCheck(); }
}

/* ============================================================
   STOCK VALUE CHECK — স্টক মূল্য যাচাই (ভাউচার/ক্রয় খাতার সাথে মিলিয়ে দেখার জন্য)
   ============================================================ */
let SC_Q = '', SC_VOUCHER = '';
function stockCheckData(){
  const lastBuy = {};
  CACHE.purchases.slice().sort((a,b)=> String(a.date).localeCompare(String(b.date))).forEach(pu => { if(pu.productId && Number(pu.qty)>0) lastBuy[pu.productId] = Number(pu.totalCost||0)/Number(pu.qty); });
  const rows = CACHE.products.map(p => {
    const st = Number(p.stock||0), cost = Number(p.cost||0), retail = Number(p.retail||0);
    return {p, st, cost, retail, vCost: st>0 ? st*cost : 0, vRetail: st>0 ? st*retail : 0, last: lastBuy[p.id]};
  });
  const A = {
    zeroCost: rows.filter(r => r.st>0 && !(r.cost>0)),
    zeroRetail: rows.filter(r => r.st>0 && !(r.retail>0)),
    negative: rows.filter(r => r.st<0),
    belowCost: rows.filter(r => r.st>0 && r.retail>0 && r.cost>0 && r.retail<r.cost),
    hiddenStock: rows.filter(r => r.st>0 && r.p.hidden),
    drift: rows.filter(r => r.st>0 && r.last>0 && r.cost>0 && Math.abs(r.last-r.cost)/r.cost > 0.05)
  };
  // ---- ক্রয় খাতা থেকে স্টক মূল্যে পৌঁছানোর ধাপ (bridge) ----
  const idx = moveIndex();
  const buyAgg = {};
  CACHE.purchases.forEach(pu => { if(!pu.productId) return; const a = buyAgg[pu.productId] || (buyAgg[pu.productId] = {q:0,c:0}); a.q += Number(pu.qty||0); a.c += Number(pu.totalCost||0); });
  const B = {A:0, sold:0, diff:0, logged:0, untracked:0, neg:0};
  const mism = [];
  rows.forEach(r => {
    const mv = idx[r.p.id] || {}; const T = {P:0,S:0,R:0,A:0};
    Object.keys(mv).forEach(m => { T.P+=mv[m].P; T.S+=mv[m].S; T.R+=mv[m].R; T.A+=mv[m].A; });
    const ba = buyAgg[r.p.id]; const avg = (ba && ba.q>0) ? ba.c/ba.q : r.cost;
    const tracked = T.P - T.S + T.R;
    const U = r.st - (tracked + T.A);
    B.A += ba ? ba.c : 0;
    B.sold += (T.S - T.R) * avg;
    B.diff += tracked * (r.cost - avg);
    B.logged += T.A * r.cost;
    B.untracked += U * r.cost;
    if(r.st < 0) B.neg += -r.st * r.cost;     // মাইনাস স্টক মোটে ধরা হয় না
    r.U = U; r.expected = r3(tracked + T.A); r.T = T;
    if(Math.abs(U) > 0.0005) mism.push(r);
  });
  Object.keys(B).forEach(k => B[k] = r2(B[k]));
  return {rows, A, B, mism, totCost: r2(rows.reduce((t,r)=>t+r.vCost,0)), totRetail: r2(rows.reduce((t,r)=>t+r.vRetail,0)), count: rows.filter(r=>r.st>0).length,
          buyTotal: r2(CACHE.purchases.reduce((t,pu)=>t+Number(pu.totalCost||0),0))};
}
function scRowsHtml(d){
  const q = SC_Q.trim().toLowerCase();
  const list = d.rows.filter(r => r.st!==0 && (!q || String(r.p.name).toLowerCase().includes(q) || String(r.p.id).toLowerCase().includes(q))).sort((a,b)=>b.vCost-a.vCost);
  return list.map(r => `<tr style="${r.p.hidden?'opacity:.7;':''}">
    <td>${esc(r.p.name)}${r.p.hidden?' <span class="badge badge-hidden">লুকানো</span>':''}</td>
    <td class="cell-num">${fmtStock(r.st, r.p)}</td>
    <td class="cell-num">${money(r.cost)}</td>
    <td class="cell-num">${money(r2(r.vCost))}</td>
    <td class="cell-num">${money(r.retail)}</td>
    <td class="cell-num">${money(r2(r.vRetail))}</td>
  </tr>`).join('') || '<tr><td colspan="6" class="empty-state">কোনো পণ্য নেই</td></tr>';
}
function onScSearch(){ SC_Q = document.getElementById('scSearch').value; document.getElementById('scBody').innerHTML = scRowsHtml(stockCheckData()); }
function onScVoucher(){
  SC_VOUCHER = document.getElementById('scVoucher').value;
  const d = stockCheckData(), v = Number(SC_VOUCHER||0);
  document.getElementById('scDiff').innerHTML = v>0 ? (Math.abs(d.buyTotal - v) < 1
    ? `<span style="color:#167A54;">✅ ক্রয় খাতার মোট ${money(d.buyTotal)} — ভাউচারের সাথে মিলে গেছে।</span>`
    : `<span style="color:#B3261E;">⚠️ ক্রয় খাতার মোট ${money(d.buyTotal)}, ভাউচারের মোট ${money(v)} — পার্থক্য <b>${money(r2(Math.abs(d.buyTotal - v)))}</b> (${d.buyTotal>v?'ক্রয় খাতায় বেশি':'ক্রয় খাতায় কম'})। ক্রয় খাতার এন্ট্রিগুলো ভাউচারের সাথে একটা একটা মিলিয়ে দেখুন।</span>`) : '';
}
function anomalyBlock(title, list, hint){
  if(!list.length) return '';
  return `<div class="flash warn" style="margin-bottom:10px;"><b>${title} (${list.length}টি)</b><br>${list.slice(0,12).map(r=>esc(r.p.name)).join('، ')}${list.length>12?' ...':''}<br><span style="font-size:12px;">${hint}</span></div>`;
}
function renderStockCheck(){
  if(!isAdmin()){ go('dashboard'); return; }
  const d = stockCheckData(), A = d.A;
  const anomalies =
    anomalyBlock('ক্রয়মূল্য ০ বা ফাঁকা, কিন্তু স্টক আছে', A.zeroCost, 'এই পণ্যগুলোর স্টকের মূল্য ০ ধরা হচ্ছে — মোট ক্রয়মূল্যের হিসাব কম আসবে। পণ্য তালিকা থেকে ক্রয়মূল্য বসান।') +
    anomalyBlock('বিক্রয়মূল্য ০, কিন্তু স্টক আছে', A.zeroRetail, 'বিক্রয়মূল্যের হিসাব কম আসবে।') +
    anomalyBlock('ঋণাত্মক (মাইনাস) স্টক', A.negative, 'বিক্রি হয়েছে কিন্তু ক্রয় এন্ট্রি দেওয়া হয়নি — ক্রয় খাতায় এন্ট্রি দিন।') +
    anomalyBlock('বিক্রয়মূল্য ক্রয়মূল্যের চেয়ে কম', A.belowCost, 'দাম উল্টো বসে গেছে কিনা দেখুন।') +
    anomalyBlock('লুকানো অবস্থায় স্টক আছে', A.hiddenStock, 'এগুলোর মূল্য মোটের মধ্যে ধরা আছে, কিন্তু ইনভেন্টরি রিপোর্টের তালিকায় দেখা যায় না।') +
    anomalyBlock('পণ্যের ক্রয়মূল্য আর সর্বশেষ ক্রয়ের গড় খরচ মিলছে না (৫%-এর বেশি পার্থক্য)', A.drift, 'ভাউচারে দাম বদলেছে কিন্তু পণ্য তালিকায় ক্রয়মূল্য পুরোনো রয়ে গেছে — এতে স্টকের মূল্য ভাউচারের সাথে মিলবে না। পণ্য তালিকায় ক্রয়মূল্য আপডেট করুন।');
  document.getElementById('pageContent').innerHTML = `
    <div class="grid grid-2" style="margin-bottom:16px;">
      <div class="stat-card"><div class="label">মোট মজুত মালের মূল্য — ক্রয়মূল্যে</div><div class="value">${money(d.totCost)}</div><div class="sub">স্টকে আছে ${d.count}টি পণ্য</div></div>
      <div class="stat-card"><div class="label">মোট মজুত মালের মূল্য — বিক্রয়মূল্যে</div><div class="value">${money(d.totRetail)}</div><div class="sub">সম্ভাব্য লাভ: ${money(r2(d.totRetail - d.totCost))}</div></div>
    </div>
    <div class="panel">
      <h3>ভাউচারের সাথে মেলান</h3>
      <p style="font-size:12.5px;color:var(--text-muted);">ড্যাশবোর্ডের স্টক মূল্য = প্রতিটা পণ্যের <b>বর্তমান স্টক × দাম</b>। ভাউচারের টাকা হলো <b>কেনার সময়ের মোট খরচ</b> — এর মধ্যে যা বিক্রি হয়ে গেছে তা ধরা নেই, তাই দুটো হুবহু এক হওয়ার কথা না। মেলাতে হলে: (১) ক্রয় খাতার মোট খরচ ভাউচারের মোটের সমান কিনা দেখুন, (২) নিচের তালিকায় ক্রয়মূল্যে স্টক মূল্য দেখুন (ক্রয়মূল্যের হিসাবই ভাউচারের সাথে তুলনীয়, বিক্রয়মূল্যের নয়)।</p>
      <div class="form-grid">
        <div class="form-field"><label>ভাউচারগুলোর মোট যোগফল (৳)</label><input id="scVoucher" type="number" placeholder="যেমন 203103" value="${esc(SC_VOUCHER)}" oninput="onScVoucher()"></div>
        <div class="form-field"><label>ক্রয় খাতার মোট খরচ (সব এন্ট্রি)</label><div class="stat-card" style="padding:10px 14px;"><div class="value" style="font-size:20px;">${money(d.buyTotal)}</div><div class="sub">${CACHE.purchases.length}টি এন্ট্রি</div></div></div>
      </div>
      <p id="scDiff" style="font-size:13.5px;margin-top:10px;"></p>
    </div>
    <div class="panel">
      <h3>ক্রয় খাতা থেকে স্টক মূল্য — ধাপে ধাপে হিসাব</h3>
      <p style="font-size:12.5px;color:var(--text-muted);">ক্রয় খাতার মোট খরচ থেকে শুরু করে কোন কারণে কত টাকা বাড়ছে/কমছে, নিচে দেখুন। শেষ সংখ্যা ড্যাশবোর্ডের স্টক মূল্যের সমান।</p>
      <table>
        <tr><td>ক্রয় খাতার মোট খরচ (ভাউচারের টাকা)</td><td class="cell-num">${money(d.B.A)}</td></tr>
        <tr><td>− যা বিক্রি হয়ে গেছে (ক্রয়দামে, রিটার্ন বাদে)</td><td class="cell-num">− ${money(d.B.sold)}</td></tr>
        <tr><td>± পণ্য তালিকার ক্রয়মূল্য আর ভাউচারের দামের পার্থক্য</td><td class="cell-num">${d.B.diff>=0?'+ ':'− '}${money(Math.abs(d.B.diff))}</td></tr>
        <tr><td>+ পণ্য তালিকা/এক্সেল থেকে হাতে বসানো স্টক (সমন্বয়, প্রারম্ভিক স্টক)</td><td class="cell-num">${d.B.logged>=0?'+ ':'− '}${money(Math.abs(d.B.logged))}</td></tr>
        <tr><td>+ <b>ক্রয় খাতায় এন্ট্রি ছাড়াই যে স্টক আছে</b> (আগে হাতে বসানো, রেকর্ড নেই)</td><td class="cell-num">${d.B.untracked>=0?'+ ':'− '}${money(Math.abs(d.B.untracked))}</td></tr>
        ${d.B.neg ? `<tr><td>+ মাইনাস স্টকের পণ্য মোটে ধরা হয় না</td><td class="cell-num">${money(d.B.neg)}</td></tr>` : ''}
      </table>
      <div class="invoice-total-row"><span>= মোট স্টক মূল্য (ক্রয়মূল্যে)</span><span>${money(d.totCost)}</span></div>
      <p style="font-size:12px;color:var(--text-muted);margin-top:8px;">যে লাইনে সবচেয়ে বড় সংখ্যা সেটাই পার্থক্যের মূল কারণ।</p>
    </div>
    ${(() => { const pl = avgCostPlan(); return pl.list.length ? `<div class="panel"><h3>ক্রয়মূল্য ভাউচারের সাথে মেলান</h3>
      <p style="font-size:12.5px;color:var(--text-muted);">${pl.list.length}টি পণ্যের ক্রয়মূল্য ক্রয় খাতার ভাউচার গড়ের (মোট খরচ ÷ মোট পরিমাণ) সাথে মিলছে না। ঠিক করলে স্টক মূল্য <b>${money(pl.valBefore)}</b> থেকে <b>${money(pl.valAfter)}</b> হবে। এরপর থেকে প্রতিটি ক্রয় এন্ট্রিতে এই দাম নিজে থেকেই ঠিক হবে।</p>
      <div class="table-wrap"><table><thead><tr><th>পণ্য</th><th>এখনকার ক্রয়মূল্য</th><th>ভাউচার গড়</th></tr></thead><tbody>${pl.list.slice(0,25).map(x=>`<tr><td>${esc(x.p.name)}</td><td class="cell-num">${money(x.oldCost)}</td><td class="cell-num"><b>${money(x.newCost)}</b></td></tr>`).join('')}</tbody></table></div>
      ${pl.list.length>25?`<p class="muted-cell">আরও ${pl.list.length-25}টি আছে</p>`:''}
      <button class="btn btn-primary" style="margin-top:10px;" onclick="applyAvgCostsAll()">🔄 সব পণ্যের ক্রয়মূল্য ভাউচার গড় অনুযায়ী ঠিক করুন</button></div>` : ''; })()}
    ${d.mism.length ? `<div class="panel"><h3>যেসব পণ্যের স্টক ক্রয়-বিক্রয়ের রেকর্ডের সাথে মিলছে না</h3>
      <p style="font-size:12.5px;color:var(--text-muted);">"রেকর্ড অনুযায়ী" = ক্রয় − বিক্রয় + রিটার্ন + লগ করা সমন্বয়। "পার্থক্য" মানে এই পরিমাণ স্টক রেকর্ড ছাড়া আছে (পণ্য খোলার সময় বা এক্সেল/পণ্য তালিকা থেকে বসানো)। যদি ভাউচারে এই মাল কেনা হয়ে থাকে, তাহলে ক্রয় খাতায় এন্ট্রি দিন — অথবা স্টক ভুল থাকলে পণ্য তালিকায় সঠিক করুন।</p>
      <div class="table-wrap"><table><thead><tr><th>পণ্য</th><th>বর্তমান স্টক</th><th>রেকর্ড অনুযায়ী</th><th>পার্থক্য</th><th>মূল্য (ক্রয়)</th></tr></thead><tbody>
      ${d.mism.slice().sort((a,b)=>Math.abs(b.U*b.cost)-Math.abs(a.U*a.cost)).slice(0,40).map(r=>`<tr><td>${esc(r.p.name)}</td><td class="cell-num">${fmtStock(r.st,r.p)}</td><td class="cell-num">${r.expected} ${esc(r.p.unit||'কেজি')}</td><td class="cell-num"><b>${r3(r.U)}</b></td><td class="cell-num">${money(r2(r.U*r.cost))}</td></tr>`).join('')}
      </tbody></table></div>
      ${d.mism.length>40 ? `<p class="muted-cell">আরও ${d.mism.length-40}টি আছে (বড় পার্থক্যগুলো আগে দেখানো হয়েছে)।</p>` : ''}</div>` : ''}
    ${anomalies ? `<div class="panel"><h3>সম্ভাব্য সমস্যা</h3>${anomalies}</div>` : `<div class="flash">✅ স্টক বা দামের ডেটায় কোনো স্পষ্ট অসঙ্গতি পাওয়া যায়নি।</div>`}
    <div class="panel">
      <h3>পণ্যভিত্তিক স্টক মূল্য</h3>
      <div class="toolbar"><input type="search" id="scSearch" placeholder="🔍 পণ্যের নাম / আইডি" value="${esc(SC_Q)}" oninput="onScSearch()"></div>
      <div class="table-wrap"><table><thead><tr><th>পণ্য</th><th>স্টক</th><th>ক্রয়মূল্য/একক</th><th>স্টক মূল্য (ক্রয়)</th><th>বিক্রয়মূল্য/একক</th><th>স্টক মূল্য (বিক্রয়)</th></tr></thead>
      <tbody id="scBody">${scRowsHtml(d)}</tbody></table></div>
    </div>`;
  onScVoucher();
}

/* ============================================================
   SERVER BACKUP — সার্ভারে আলাদা কপি (averamart_backups), ডেটা ব্যবহার, সাপ্তাহিক রিমাইন্ডার
   ============================================================ */
const BK = 'averamart_backups';
const BK_NAMES = ['products','orders','purchases','expenses','returns','shareholders','contributions','closings','settings','users'];
let BK_TRIED = false, BK_STATE = {ok:null, tag:'', err:''};
function bkStatusText(){
  if(BK_STATE.ok===true) return `✅ সর্বশেষ সার্ভার ব্যাকআপ: <b>${esc(BK_STATE.tag)}</b>`;
  if(BK_STATE.ok===false) return `⚠️ ব্যাকআপ লেখা যায়নি: ${esc(BK_STATE.err)} — Firebase rules আপডেট করুন (FIREBASE-RULES.txt দেখুন)।`;
  return 'আজকের ব্যাকআপ যাচাই হচ্ছে...';
}
function bkUpdateStatus(){ const el = document.getElementById('bkStatus'); if(el) el.innerHTML = bkStatusText(); }
async function runServerBackup(force){
  try{
    if(!db) return;
    if(!allLoaded()){ if(force) alert('ডেটা এখনো লোড হয়নি'); return; }
    if(Object.keys(SAFE_ALERT).length){ if(force) alert('ডেটা সন্দেহজনকভাবে কমে আছে — এই অবস্থায় ব্যাকআপ নেওয়া হচ্ছে না।'); return; }
    const day = todayStr(), col = db.collection(BK);
    const hhmm = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Dhaka',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date()).replace(':','');
    const tag = force ? `${day}T${hhmm}` : day;
    if(!force){
      const meta = await col.doc(tag+'__meta').get();
      if(meta.exists){ BK_STATE = {ok:true, tag, err:''}; bkUpdateStatus(); return; }
    }
    const month = day.slice(0,7);
    const had = await col.where('kind','==','meta').where('month','==',month).limit(1).get();
    const keep = had.empty;
    const counts = {};
    for(const name of BK_NAMES){
      const payload = (name==='settings'||name==='users') ? CACHE[name] : {items: CACHE[name]||[]};
      counts[name] = (name==='settings'||name==='users') ? 1 : (CACHE[name]||[]).length;
      await col.doc(`${tag}__${name}`).set({kind:'data', tag, day, src:name, json:JSON.stringify(payload), n:counts[name], keep, ts:firebase.firestore.FieldValue.serverTimestamp()});
    }
    await col.doc(tag+'__meta').set({kind:'meta', tag, day, month, counts, keep, ts:firebase.firestore.FieldValue.serverTimestamp()});
    BK_STATE = {ok:true, tag, err:''}; bkUpdateStatus();
    if(force) alert('✅ সার্ভার ব্যাকআপ নেওয়া হয়েছে: ' + tag);
    // ৬০ দিনের পুরোনো দৈনিক কপি মুছে ফেলা (মাসিক কপি থাকে)
    try{
      const old = await col.where('ts','<', new Date(Date.now()-60*864e5)).limit(300).get();
      old.forEach(d => { const x = d.data(); if(!x.keep) d.ref.delete().catch(()=>{}); });
    }catch(e){}
  }catch(e){
    BK_STATE = {ok:false, tag:'', err:(e && e.message) || String(e)}; bkUpdateStatus();
    if(force) alert('⚠️ ব্যাকআপ নেওয়া যায়নি: ' + BK_STATE.err);
  }
}
async function loadServerBackups(){
  const box = document.getElementById('bkList'); if(!box) return;
  box.innerHTML = 'লোড হচ্ছে...';
  try{
    const snap = await db.collection(BK).where('kind','==','meta').get();
    const list = []; snap.forEach(d => list.push(d.data()));
    list.sort((a,b) => String(b.tag).localeCompare(String(a.tag)));
    if(!list.length){ box.innerHTML = '<span class="muted-cell">এখনো কোনো সার্ভার ব্যাকআপ নেই</span>'; return; }
    box.innerHTML = `<div class="table-wrap"><table><thead><tr><th>তারিখ</th><th>পণ্য</th><th>অর্ডার</th><th>ক্রয়</th><th>খরচ</th><th></th></tr></thead><tbody>${
      list.slice(0,60).map(m => `<tr><td>${esc(m.tag)}${m.keep?' 📌':''}</td><td class="cell-num">${(m.counts||{}).products||0}</td><td class="cell-num">${(m.counts||{}).orders||0}</td><td class="cell-num">${(m.counts||{}).purchases||0}</td><td class="cell-num">${(m.counts||{}).expenses||0}</td><td><button class="btn btn-outline btn-sm" onclick="restoreServerBackup('${esc(m.tag)}')">⏪ ফেরত আনুন</button></td></tr>`).join('')
    }</tbody></table></div><p class="muted-cell" style="font-size:12px;">📌 = মাসিক কপি (চিরকাল থাকে)</p>`;
  }catch(e){ box.innerHTML = '<span style="color:#B3261E;">তালিকা আনা যায়নি: ' + esc(e.message||e) + '</span>'; }
}
async function restoreServerBackup(tag){
  if(!isAdmin()){ alert('শুধু অ্যাডমিন ফেরত আনতে পারবেন'); return; }
  try{
    const snap = await db.collection(BK).where('tag','==',tag).get();
    const data = {}; snap.forEach(d => { const x = d.data(); if(x.kind==='data') { try{ data[x.src] = JSON.parse(x.json); }catch(e){} } });
    const names = ['products','orders','purchases','expenses','returns','shareholders','contributions','closings'].filter(n => data[n] && Array.isArray(data[n].items));
    if(!names.length){ alert('এই ব্যাকআপে ডেটা পাওয়া যায়নি'); return; }
    const sum = names.map(n => `${n}: ${data[n].items.length}টি`).join('\n');
    if(!confirm(`${tag}-এর ব্যাকআপ থেকে ফেরত আনবেন?\n\n${sum}\n\nবর্তমান ডেটা এই ডেটা দিয়ে প্রতিস্থাপিত হবে (পিন অপরিবর্তিত থাকবে)। আগে বর্তমান ডেটার একটা ফাইল ব্যাকআপ নিজে থেকে নামবে।`)) return;
    try{ downloadBackup(); }catch(e){}
    FORCE_SAVE = true;
    names.forEach(n => saveCollection(n, data[n].items));
    if(data.settings) saveSettings({...CACHE.settings, ...data.settings});
    setTimeout(() => { FORCE_SAVE = false; }, 30000);
    alert('✅ ফেরত আনা হয়েছে। সংখ্যাগুলো মিলিয়ে দেখুন।'); go('dashboard');
  }catch(e){ alert('ফেরত আনা যায়নি: ' + (e.message||e)); }
}
const USAGE_NAMES = {products:'পণ্য', orders:'অর্ডার', purchases:'ক্রয়', expenses:'খরচ/আয়', returns:'রিটার্ন', closings:'মাস ক্লোজিং'};
function usageRows(){
  return Object.keys(USAGE_NAMES).map(n => { let b = 0; try{ b = new Blob([JSON.stringify(CACHE[n]||[])]).size; }catch(e){} return {n, label:USAGE_NAMES[n], kb: Math.round(b/1024), pct: Math.round(b/1048576*100), cnt:(CACHE[n]||[]).length}; });
}
function dataUsageHtml(){
  return `<div class="table-wrap"><table><thead><tr><th>তথ্য</th><th>সংখ্যা</th><th>আকার</th><th>সীমার %</th></tr></thead><tbody>${
    usageRows().map(r => `<tr><td>${r.label}</td><td class="cell-num">${r.cnt}</td><td class="cell-num">${r.kb} KB</td><td class="cell-num" style="${r.pct>=70?'color:#B3261E;font-weight:700;':''}">${r.pct}%</td></tr>`).join('')
  }</tbody></table></div>`;
}
function safetyBanners(){
  if(!isAdmin()) return '';
  let h = '';
  const last = Number(localStorage.getItem('AM_lastDownload')||0);
  const days = last ? Math.floor((Date.now()-last)/864e5) : 999;
  if(days >= 7) h += `<div class="alert-strip" style="background:#EEF1F6;border-color:#D5DCE8;color:var(--navy);">💾 ${last?days+' দিন':'অনেক দিন'} ধরে ব্যাকআপ ফাইল ডাউনলোড করা হয়নি। <a href="#" onclick="downloadBackup();go('dashboard');return false;" style="color:var(--navy);font-weight:700;">এখনই ডাউনলোড করুন</a></div>`;
  if(BK_STATE.ok===false) h += `<div class="alert-strip" style="background:#FDE8E8;border-color:#F4B8B4;color:#B3261E;">☁️ সার্ভার ব্যাকআপ চলছে না (${esc(BK_STATE.err)}) — FIREBASE-RULES.txt অনুযায়ী Firebase rules আপডেট করুন।</div>`;
  const big = usageRows().filter(r => r.pct >= 70);
  if(big.length) h += `<div class="alert-strip" style="background:#FDE8E8;border-color:#F4B8B4;color:#B3261E;">📦 ডেটা সীমার কাছাকাছি: ${big.map(r=>r.label+' '+r.pct+'%').join(', ')} — সেটিংস → ডেটা ব্যবহার দেখুন, ডেভেলপারকে জানান।</div>`;
  return h;
}

/* ============================================================
   DASHBOARD
   ============================================================ */
function renderDashboard(){
  const session = getSession();
  const products = CACHE.products;
  const orders = CACHE.orders;
  const expenses = CACHE.expenses;
  const month = todayStr().slice(0,7);
  const monthOrders = orders.filter(o => o.date && o.date.slice(0,7)===month && o.status==='Delivered');
  const totalSalesMonth = monthOrders.reduce((s,o)=>s+Number(o.total||0),0);
  const monthExpenses = expenses.filter(e=>e.kind!=='income' && e.date && e.date.slice(0,7)===month).reduce((s,e)=>s+Number(e.amount||0),0);
  const monthIncome = expenses.filter(e=>e.kind==='income' && e.date && e.date.slice(0,7)===month).reduce((s,e)=>s+Number(e.amount||0),0);
  const cogs = monthOrders.reduce((s,o)=> s + orderItems(o).reduce((s2,it)=>{ const p=products.find(p=>p.id===it.productId); return s2 + (p?p.cost:0)*Number(it.qty||0); },0), 0);
  const netProfit = totalSalesMonth - cogs - monthExpenses + monthIncome;
  const lowStock = products.filter(p=>!p.hidden && Number(p.stock) <= Number(p.minStock));
  const pending = orders.filter(o=>o.status==='Pending' || o.status==='Processing');
  const st = stockTotals();
  const stockCard = session.role==='admin'
    ? `<div class="stat-card clickable" onclick="go('stockcheck')"><div class="label">মোট মজুত মালের মূল্য (ক্রয়মূল্যে)</div><div class="value">${money(st.cost)}</div><div class="sub">বিক্রয়মূল্যে: ${money(st.retail)} · স্টকে আছে ${st.count}টি পণ্য</div></div>`
    : `<div class="stat-card clickable" onclick="go('inventory')"><div class="label">মোট মজুত মালের মূল্য (বিক্রয়মূল্যে)</div><div class="value">${money(st.retail)}</div><div class="sub">স্টকে আছে ${st.count}টি পণ্য · এটি বিক্রয়মূল্যের হিসাব, ক্রয়ের ভাউচারের (ক্রয়মূল্য) সাথে মিলবে না</div></div>`;
  const hiddenCount = products.filter(p=>p.hidden).length;

  let cards = `
    <div class="stat-card accent"><div class="label">এই মাসের বিক্রয় (ডেলিভারড)</div><div class="value">${money(totalSalesMonth)}</div></div>
    <div class="stat-card warn"><div class="label">এই মাসের খরচ</div><div class="value">${money(monthExpenses)}</div></div>
    <div class="stat-card ${lowStock.length?'danger':''}"><div class="label">কম স্টকের পণ্য</div><div class="value">${lowStock.length} টি</div></div>
    <div class="stat-card"><div class="label">পেন্ডিং/প্রসেসিং অর্ডার</div><div class="value">${pending.length} টি</div></div>
  `;
  cards = stockCard + cards;
  if(session.role==='admin'){
    cards = `<div class="stat-card"><div class="label">এই মাসের নিট লাভ</div><div class="value">${money(netProfit)}</div></div>` + cards;
  }

  let html = closingBanner() + safetyBanners() + `<div class="grid grid-4">${cards}</div>`;

  if(lowStock.length){
    html += `<div class="alert-strip">⚠️ কম স্টকে থাকা পণ্য: ${lowStock.map(p=>esc(p.name)).join('، ')}</div>`;
  }

  if(hiddenCount){
    html += `<div class="alert-strip" style="background:#EEF1F6;border-color:#D5DCE8;color:var(--navy);">ℹ️ ${hiddenCount}টি পণ্য "লুকানো" অবস্থায় আছে — এগুলো অর্ডার সার্চ ও ইনভেন্টরি রিপোর্টে দেখা যায় না। <a href="#" onclick="showHiddenProducts();return false;" style="color:var(--navy);font-weight:700;">লুকানো পণ্যগুলো দেখুন</a></div>`;
  }

  html += `<div class="panel">
    <div class="panel-head"><h3>সাম্প্রতিক অর্ডার</h3></div>
    <div class="table-wrap"><table><thead><tr>
      <th>অর্ডার আইডি</th><th>তারিখ</th><th>কাস্টমার</th><th>মোট মূল্য</th><th>স্ট্যাটাস</th>
    </tr></thead><tbody>
    ${orders.slice(-6).reverse().map(o=>`
      <tr><td>${o.id}</td><td>${o.date}</td><td>${esc(o.customerName)}</td><td class="cell-num">${money(o.total)}</td>
      <td class="cell-center"><span class="badge ${STATUS_BADGE[o.status]}">${STATUS_BN[o.status]}</span></td></tr>
    `).join('') || `<tr><td colspan="5" class="empty-state">কোনো অর্ডার নেই</td></tr>`}
    </tbody></table></div>
  </div>`;

  document.getElementById('pageContent').innerHTML = html;
}

/* ============================================================
   PRODUCTS
   ============================================================ */
let PROD_Q = '', PROD_FILTER = 'all', PROD_COUNT = 0;
function showHiddenProducts(){ PROD_Q=''; PROD_FILTER='hidden'; go('products'); }
function productRowsHtml(){
  const admin = isAdmin();
  const q = PROD_Q.trim().toLowerCase();
  const list = CACHE.products.filter(p=>{
    if(q && !(String(p.name).toLowerCase().includes(q) || String(p.id).toLowerCase().includes(q) || String(p.category||'').toLowerCase().includes(q))) return false;
    if(PROD_FILTER==='active') return !p.hidden;
    if(PROD_FILTER==='hidden') return !!p.hidden;
    if(PROD_FILTER==='low') return !p.hidden && Number(p.stock)<=Number(p.minStock);
    if(PROD_FILTER==='zero') return Number(p.stock)<=0;
    return true;
  });
  PROD_COUNT = list.length;
  return list.map(p => `
    <tr class="${hlClass('products',p.id)}" style="${p.hidden?'opacity:.7;':''}">
      <td>${p.id}</td>
      <td>${esc(p.name)}${p.hidden ? ' <span class="badge badge-hidden">লুকানো</span><br><span class="muted-cell" style="font-size:11.5px;">অর্ডার সার্চ/ইনভেন্টরিতে আসবে না — ক্রয় এন্ট্রি দিলে চালু হবে</span>' : ''}${p.priceTiers ? `<br><span class="muted-cell">${esc(p.priceTiers)}</span>` : ''}</td>
      <td>${esc(p.category)}</td>
      <td>${esc(p.unit||'কেজি')}</td>
      ${admin ? `<td class="cell-num">${money(packPrice(p,'cost'))}${fmtBasis(p)?`<br><span class="muted-cell" style="font-size:11.5px;">/ ${fmtBasis(p)}</span>`:''}</td>` : ''}
      <td class="cell-num">${money(packPrice(p,'retail'))}${fmtBasis(p)?`<br><span class="muted-cell" style="font-size:11.5px;">/ ${fmtBasis(p)}</span>`:`<br><span class="muted-cell" style="font-size:11.5px;">/ ১ ${esc(p.unit||'কেজি')}</span>`}</td>
      <td>${fmtStock(p.stock, p)} ${Number(p.stock)<=Number(p.minStock) && !p.hidden ? '<span class="badge badge-low">লো স্টক</span>' : ''}</td>
      <td class="cell-center">
        <button class="icon-btn" title="${p.hidden?'আবার চালু করুন':'লুকিয়ে রাখুন'}" onclick="toggleProductHidden('${p.id}')">${p.hidden?'🙈':'👁️'}</button>
        <button class="icon-btn" onclick="openProductForm('${p.id}')">✏️</button>
        ${admin ? `<button class="icon-btn danger" onclick="deleteProduct('${p.id}')">🗑️</button>` : ''}
      </td>
    </tr>`).join('') || `<tr><td colspan="${admin?8:7}" class="empty-state">${CACHE.products.length ? 'এই ফিল্টারে কোনো পণ্য নেই' : 'কোনো পণ্য যোগ করা হয়নি'}</td></tr>`;
}
function onProductFilter(){
  PROD_Q = document.getElementById('prodSearch').value;
  PROD_FILTER = document.getElementById('prodFilter').value;
  document.getElementById('prodBody').innerHTML = productRowsHtml();
  document.getElementById('prodCount').textContent = `দেখাচ্ছে ${PROD_COUNT}টি / মোট ${CACHE.products.length}টি পণ্য`;
}
function renderProducts(){
  const isAdmin = getSession().role==='admin';
  const rowsHtml = productRowsHtml();
  const f = (v,l)=>`<option value="${v}" ${PROD_FILTER===v?'selected':''}>${l}</option>`;
  document.getElementById('pageContent').innerHTML = `
    ${flashHtml('products')}
    <div class="panel">
      <div class="panel-head">
        <h3>পণ্য তালিকা</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${isAdmin ? `
            <button class="btn btn-outline btn-sm" onclick="exportProductsExcel()">⬇️ বর্তমান পণ্য এক্সেলে নামান</button>
            <button class="btn btn-outline btn-sm" onclick="downloadProductDemoExcel()">📥 ডেমো এক্সেল ফাইল</button>
            <button class="btn btn-outline btn-sm" onclick="document.getElementById('excelFileInput').click()">📤 এক্সেল থেকে আপলোড</button>
            <input type="file" id="excelFileInput" accept=".xlsx,.xls" class="hidden" onchange="handleExcelUpload(event)">
          ` : ''}
          <button class="btn btn-accent btn-sm" onclick="openProductForm()">+ নতুন পণ্য</button>
        </div>
      </div>
      ${isAdmin ? `<p style="font-size:12px;color:var(--text-muted);margin:-4px 0 14px;">"বর্তমান পণ্য এক্সেলে নামান" দিয়ে ফাইল নামিয়ে দাম/স্টক ইত্যাদি বদলান, তারপর "এক্সেল থেকে আপলোড" দিন — আইডি (না থাকলে নাম) মিললে পুরোনো পণ্য আপডেট হবে, না মিললে নতুন পণ্য যোগ হবে। কোনো ঘর ফাঁকা থাকলে সেই তথ্য অপরিবর্তিত থাকবে।</p>` : ''}
      <div class="toolbar">
        <input type="search" id="prodSearch" placeholder="🔍 পণ্যের নাম / আইডি / ক্যাটাগরি দিয়ে খুঁজুন" value="${esc(PROD_Q)}" oninput="onProductFilter()">
        <select id="prodFilter" onchange="onProductFilter()">
          ${f('all','সব পণ্য')}${f('active','শুধু চালু')}${f('hidden','শুধু লুকানো')}${f('low','কম স্টক')}${f('zero','স্টক শূন্য/নেই')}
        </select>
        <span class="muted-cell" id="prodCount">দেখাচ্ছে ${PROD_COUNT}টি / মোট ${CACHE.products.length}টি পণ্য</span>
      </div>
      <div class="table-wrap"><table><thead><tr>
        <th>আইডি</th><th>পণ্যের নাম</th><th>ক্যাটাগরি</th><th>একক</th>
        ${isAdmin?'<th>ক্রয়মূল্য (কত পরিমাণে)</th>':''}
        <th>বিক্রয়মূল্য (কত পরিমাণে)</th><th>স্টক</th><th>একশন</th>
      </tr></thead><tbody id="prodBody">${rowsHtml}</tbody></table></div>
    </div>
    <div id="modalHolder"></div>
  `;
  scrollToHl();
}

const XL = {id:'আইডি', name:'পণ্যের নাম', cat:'ক্যাটাগরি', unit:'একক (কেজি/গ্রাম/লিটার/পিস)', cost:'ক্রয়মূল্য', retail:'বিক্রয়মূল্য', stock:'স্টক', min:'ন্যূনতম স্টক সতর্কতা', active:'সক্রিয় (হ্যাঁ/না)'};
const XL_COLS = [XL.id, XL.name, XL.cat, XL.unit, XL.cost, XL.retail, XL.stock, XL.min, XL.active];
function writeProductSheet(rows, filename){
  const ws = XLSX.utils.aoa_to_sheet([XL_COLS, ...rows]);
  ws['!cols'] = [{wch:8},{wch:28},{wch:16},{wch:22},{wch:12},{wch:12},{wch:10},{wch:16},{wch:16}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'পণ্য তালিকা');
  XLSX.writeFile(wb, filename);
}
function downloadProductDemoExcel(){
  writeProductSheet([['','মিনিকেট চাল','খাদ্যশস্য','কেজি',68,78,200,20,'হ্যাঁ']], 'avera-mart-product-demo.xlsx');
}
function exportProductsExcel(){
  const rows = CACHE.products.map(p => [p.id, p.name, p.category, p.unit||'কেজি', p.cost, p.retail, p.stock, p.minStock, p.hidden?'না':'হ্যাঁ']);
  writeProductSheet(rows, `avera-mart-products-${todayStr()}.xlsx`);
}
function cellVal(row, key){ const v = row[key]; return (v===undefined || v===null || String(v).trim()==='') ? null : v; }
function handleExcelUpload(event){
  const file = event.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try{
      const wb = XLSX.read(new Uint8Array(e.target.result), {type:'array'});
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval:''});
      const products = CACHE.products.slice();
      const settings = {...CACHE.settings};
      const newCategories = [];
      const findExisting = (id, name) => {
        if(id){ const i = products.findIndex(p=>p.id===id); if(i>-1) return i; }
        if(name){ return products.findIndex(p=>p.name.trim().toLowerCase()===name.toLowerCase()); }
        return -1;
      };
      const planned = rows.map(row => {
        const id = String(cellVal(row, XL.id) ?? '').trim();
        const name = String(cellVal(row, XL.name) ?? '').trim();
        return {row, id, name, idx: findExisting(id, name)};
      });
      const stockInUpdates = planned.some(x => x.idx>-1 && cellVal(x.row, XL.stock)!==null);
      const updateStock = stockInUpdates ? confirm('ফাইলে থাকা পণ্যগুলোর স্টকের সংখ্যাও কি আপডেট করতে চান?\n\nOK = স্টকসহ সব আপডেট\nCancel = শুধু দাম/নাম/ক্যাটাগরি ইত্যাদি আপডেট, স্টক অপরিবর্তিত\n\n(সতর্কতা: ফাইল ডাউনলোডের পর নতুন বিক্রি/ক্রয় হয়ে থাকলে স্টক পুরোনো হয়ে যেতে পারে)') : false;
      let added = 0, updated = 0, skipped = 0;
      const addedIds = [], addedNames = [];
      const isNo = v => ['না','no','n','0','false','hidden'].includes(String(v).trim().toLowerCase());

      planned.forEach(({row, id, name, idx}) => {
        const cat = cellVal(row, XL.cat);
        if(cat && !settings.productCategories.includes(String(cat).trim()) && !newCategories.includes(String(cat).trim())) newCategories.push(String(cat).trim());
        const unit = cellVal(row, XL.unit) ?? cellVal(row, 'একক');
        const cost = cellVal(row, XL.cost), retail = cellVal(row, XL.retail) ?? cellVal(row, 'খুচরা মূল্য');
        const stock = cellVal(row, XL.stock), min = cellVal(row, XL.min), active = cellVal(row, XL.active);
        if(idx>-1){
          const old = products[idx], ch = {};
          if(name) ch.name = name;
          if(cat) ch.category = String(cat).trim();
          if(unit) ch.unit = String(unit).trim();
          if(cost!==null) ch.cost = Number(cost);
          if(retail!==null) ch.retail = Number(retail);
          if(min!==null) ch.minStock = Number(min);
          if(updateStock && stock!==null){ ch.stock = Number(stock); if(r3(ch.stock)!==r3(old.stock)) ch.adj = (old.adj||[]).concat([{d: todayStr(), q: r3(ch.stock - Number(old.stock||0))}]); }
          if(active!==null) ch.hidden = isNo(active);
          products[idx] = {...old, ...ch};
          updated++;
        } else if(name){
          const newId = genId('P', products);
          addedIds.push(newId); addedNames.push(name);
          products.push({
            id: newId, name,
            category: cat ? String(cat).trim() : 'অন্যান্য',
            unit: unit ? String(unit).trim() : 'কেজি',
            cost: Number(cost||0), retail: Number(retail||0),
            stock: Number(stock||0), minStock: Number(min ?? 5),
            hidden: active!==null ? isNo(active) : false,
            createdAt: todayStr(),
            adj: Number(stock||0)>0 ? [{d: todayStr(), q: r3(Number(stock)), n:'প্রারম্ভিক স্টক'}] : []
          });
          added++;
        } else { skipped++; }
      });

      if(added===0 && updated===0){ alert('ফাইলে কোনো বৈধ পণ্যের সারি পাওয়া যায়নি। কলামের নাম ঠিক আছে কিনা যাচাই করুন (ডেমো বা এক্সপোর্ট করা ফাইলের ফরম্যাট অনুযায়ী)।'); event.target.value=''; return; }
      if(newCategories.length){ settings.productCategories = [...settings.productCategories, ...newCategories]; }
      saveCollection('products', products);
      if(newCategories.length) saveSettings(settings);
      PROD_Q = ''; PROD_FILTER = 'all';
      setFlash('products', `✅ এক্সেল আপলোড সম্পন্ন — ${updated}টি পণ্য আপডেট এবং ${added}টি নতুন পণ্য যোগ হয়েছে।${skipped?` (${skipped}টি সারি বাদ গেছে)`:''}${addedNames.length ? `<br>নতুন পণ্য (তালিকার নিচে, হলুদ দাগে): ${addedNames.slice(0,12).map(esc).join('، ')}${addedNames.length>12?' ...':''}` : ''}`, addedIds);
      renderProducts();
      if(!addedIds.length) toTop();
    }catch(err){
      alert('ফাইলটি পড়া যায়নি। এটা ঠিক .xlsx ফরম্যাটের ফাইল কিনা এবং কলাম কাঠামো ঠিক আছে কিনা যাচাই করুন।');
    }
    event.target.value = '';
  };
  reader.readAsArrayBuffer(file);
}
function toggleProductHidden(id){
  FLASH = null;
  const products = CACHE.products.map(p => p.id===id ? {...p, hidden: !p.hidden} : p);
  saveCollection('products', products);
  renderProducts();
}

function updatePriceHint(){
  const unit = document.getElementById('f_unit').value || 'কেজি';
  const n = Number(document.getElementById('f_basis').value)||1;
  const bl = n===1 ? `প্রতি ১ ${unit}` : `${r3(n)} ${unit}-এর জন্য`;
  document.querySelectorAll('.basis-lbl').forEach(e=>e.textContent = bl);
  const rEl = document.getElementById('f_retail'), cEl = document.getElementById('f_cost');
  const r = Number(rEl.value||0)/n, c = cEl ? Number(cEl.value||0)/n : null;
  document.getElementById('f_pricehint').innerHTML = `📌 বিক্রয়মূল্য: <b>${money(Number(rEl.value||0))} / ${n===1?'১':r3(n)} ${esc(unit)}</b>`
    + (n!==1 ? ` → প্রতি ১ ${esc(unit)} <b>${money(r)}</b>` : '')
    + (c!==null ? `<br>ক্রয়মূল্য: <b>${money(Number(cEl.value||0))} / ${n===1?'১':r3(n)} ${esc(unit)}</b>`+(n!==1?` → প্রতি ১ ${esc(unit)} <b>${money(c)}</b>`:'') : '');
}
function openProductForm(id){
  const products = CACHE.products;
  const p = id ? products.find(x=>x.id===id) : null;
  const isAdmin = getSession().role==='admin';
  const html = `
    <div class="panel">
      <h3>${p?'পণ্য সম্পাদনা':'নতুন পণ্য যোগ করুন'}</h3>
      <div class="form-grid">
        <div class="form-field"><label>পণ্যের নাম</label><input id="f_name" value="${p?esc(p.name):''}"></div>
        <div class="form-field"><label>ক্যাটাগরি</label>
          <select id="f_cat">
            ${CACHE.settings.productCategories.map(c=>`<option ${p&&p.category===c?'selected':''}>${esc(c)}</option>`).join('')}
          </select>
        </div>
        <div class="form-field"><label>পরিমাণ/একক — মসলা, চাল, ডাল ইত্যাদির জন্য "কেজি" দিন, ডাল/চালের মতো পণ্যে "কেজি" রাখুন</label>
          <select id="f_unit">
            ${UNIT_OPTIONS.map(u=>`<option ${(p&&p.unit===u)||(!p&&u==='কেজি')?'selected':''}>${u}</option>`).join('')}
          </select>
        </div>
        <div class="form-field"><label>নিচের দাম কত পরিমাণের জন্য? (যেমন ১ কেজি, ৫ কেজি, ১ প্যাকেট)</label>
          <input id="f_basis" type="number" step="any" min="0" value="${p?(Number(p.priceBasis)||1):1}" oninput="updatePriceHint()">
          <span class="muted-cell" style="font-size:11.5px;">১ কেজির দাম হলে ১ রাখুন। ৫ কেজির দাম হলে ৫ লিখুন — তখন ক্রয়মূল্য ও বিক্রয়মূল্য ৫ কেজির দাম বসাবেন, সিস্টেম নিজে প্রতি একক হিসাব করে নেবে।</span>
        </div>
        ${isAdmin?`<div class="form-field"><label>ক্রয়মূল্য (৳) — <span class="basis-lbl"></span></label><input id="f_cost" type="number" step="any" value="${p?packPrice(p,'cost'):''}" oninput="updatePriceHint()"><span class="muted-cell" style="font-size:11.5px;">ক্রয় এন্ট্রি থাকলে এই দাম প্রতিবার ভাউচার গড় অনুযায়ী নিজে থেকে বদলায়।</span></div>`:''}
        <div class="form-field"><label>বিক্রয়মূল্য (৳) — <span class="basis-lbl"></span></label><input id="f_retail" type="number" step="any" value="${p?packPrice(p,'retail'):''}" oninput="updatePriceHint()"></div>
        <div class="form-field" style="grid-column:1/-1;"><div id="f_pricehint" class="flash" style="margin:0;"></div></div>
        <div class="form-field"><label>বর্তমান স্টক (এককে)</label><input id="f_stock" type="number" value="${p?p.stock:0}"></div>
        <div class="form-field"><label>ন্যূনতম স্টক সতর্কতা</label><input id="f_min" type="number" value="${p?p.minStock:5}"></div>
        <div class="form-field"><label>বিক্রির জন্য চালু?</label>
          <label style="display:flex;gap:8px;align-items:center;font-weight:400;"><input id="f_active" type="checkbox" ${p&&p.hidden?'':'checked'}> চালু (অর্ডারে দেখাবে)</label>
          <span class="muted-cell" style="font-size:11.5px;">এখনো কেনা হয়নি এমন পণ্যের টিক তুলে দিন — অর্ডারের সার্চে, লো-স্টক সতর্কতায় ও ইনভেন্টরি রিপোর্টে আসবে না। ক্রয় এন্ট্রি দিলে নিজে থেকেই চালু হয়ে যাবে।</span>
        </div>
      </div>

      <div style="margin-top:16px;display:flex;gap:10px;">
        <button class="btn btn-primary" onclick="saveProduct('${p?p.id:''}')">সংরক্ষণ করুন</button>
        <button class="btn btn-outline" onclick="closeForm(renderProducts)">বাতিল</button>
      </div>
    </div>`;
  openForm(html);
  document.getElementById('f_unit').addEventListener('change', updatePriceHint);
  updatePriceHint();
}

function saveProduct(id){
  const products = CACHE.products.slice();
  const isAdmin = getSession().role==='admin';
  const name = document.getElementById('f_name').value.trim();
  if(!name){ alert('পণ্যের নাম দিন'); return; }
  const basis = Number(document.getElementById('f_basis').value);
  if(!(basis>0)){ alert('দাম কত পরিমাণের জন্য তা সঠিকভাবে দিন (যেমন ১ বা ৫)'); return; }
  const per = v => Math.round(v/basis*10000)/10000;
  const data = {
    name,
    category: document.getElementById('f_cat').value,
    cost: isAdmin ? per(Number(document.getElementById('f_cost').value||0)) : (products.find(p=>p.id===id)?.cost || 0),
    unit: document.getElementById('f_unit').value.trim() || 'কেজি',
    priceBasis: basis,
    packSize: parsePackUnit(document.getElementById('f_unit').value.trim()) ? 0 : (products.find(p=>p.id===id)?.packSize || 0),
    retail: per(Number(document.getElementById('f_retail').value||0)),
    stock: Number(document.getElementById('f_stock').value||0),
    minStock: Number(document.getElementById('f_min').value||0),
    hidden: !document.getElementById('f_active').checked
  };
  if(id){
    const idx = products.findIndex(p=>p.id===id);
    const oldStock = Number(products[idx].stock||0);
    const adj = (products[idx].adj||[]).slice();
    if(r3(data.stock) !== r3(oldStock)) adj.push({d: todayStr(), q: r3(data.stock - oldStock)});
    products[idx] = {...products[idx], ...data, adj};
  } else {
    data.id = genId('P', products);
    data.createdAt = todayStr();
    if(Number(data.stock) > 0) data.adj = [{d: todayStr(), q: r3(data.stock), n:'প্রারম্ভিক স্টক'}];
    products.push(data);
  }
  saveCollection('products', products);
  const savedId = id || data.id;
  PROD_Q = ''; PROD_FILTER = 'all';
  if(id){
    setFlash('products', `✅ <b>${esc(name)}</b> (${savedId}) আপডেট হয়েছে — হলুদ দাগ দেওয়া সারিটি দেখুন।`, savedId);
  } else if(data.hidden){
    setFlash('products', `✅ নতুন পণ্য <b>${esc(name)}</b> (আইডি ${savedId}) পণ্য তালিকার <b>সবার নিচে</b> যোগ হয়েছে (হলুদ দাগ দেওয়া সারি)।<br>⚠️ পণ্যটি "লুকানো" অবস্থায় আছে, তাই অর্ডারের সার্চ, লো-স্টক সতর্কতা ও ইনভেন্টরি রিপোর্টে এখন দেখা যাবে না। এখনই চালু করতে চাইলে: <button class="btn btn-accent btn-sm" onclick="toggleProductHidden('${savedId}')">চালু করুন</button>`, savedId, true);
  } else {
    setFlash('products', `✅ নতুন পণ্য <b>${esc(name)}</b> (আইডি ${savedId}) পণ্য তালিকার <b>সবার নিচে</b> যোগ হয়েছে (হলুদ দাগ দেওয়া সারি)।<br>এটি এখন অর্ডারের সার্চ ও ইনভেন্টরি রিপোর্টেও দেখা যাবে।`, savedId);
  }
  renderProducts();
}
function deleteProduct(id){
  if(!confirm('এই পণ্যটি মুছে ফেলতে চান?')) return;
  saveCollection('products', CACHE.products.filter(p=>p.id!==id));
  renderProducts();
}

/* ============================================================
   ORDERS / SALES
   ============================================================ */
let ORD_MONTH = 'all';
function onOrderMonth(sel){ ORD_MONTH = sel.value; renderOrders(); }
function renderOrders(){
  const session = getSession();
  const orders = CACHE.orders.filter(o => ORD_MONTH==='all' || mOf(o.date)===ORD_MONTH);
  const products = CACHE.products;
  const isDelivery = session.role==='delivery';
  const canSeeMoney = !isDelivery;

  function itemsSummary(o){
    const items = orderItems(o);
    const names = items.map(it => {
      const p = products.find(p=>p.id===it.productId);
      return `${esc(p?p.name:'—')} x${fmtItem(it,p)}`;
    });
    if(names.length<=2) return names.join(', ');
    return names.slice(0,2).join(', ') + ` +আরও ${names.length-2}টি`;
  }

  let rows = orders.slice().reverse().map(o => `
    <tr>
      <td>${o.id} ${editedBadge(o)}</td><td>${o.date}</td>
      <td>${esc(o.customerName)}<br><span class="muted-cell">${esc(o.phone)}</span></td>
      <td>${itemsSummary(o)}</td>
      ${canSeeMoney ? `<td class="cell-num">${money(o.total)}</td>` : ''}
      <td class="cell-center">
        <select ${isDateLocked(o.date)?'disabled title="এই মাস লক করা"':''} onchange="updateOrderStatus('${o.id}', this.value)">
          ${['Pending','Processing','Delivered','Cancelled'].map(s=>`<option value="${s}" ${o.status===s?'selected':''}>${STATUS_BN[s]}</option>`).join('')}
        </select>
      </td>
      ${canSeeMoney ? `<td class="cell-center"><span class="badge ${PAY_BADGE[o.paymentStatus]}">${PAY_BN[o.paymentStatus]}</span></td>` : ''}
      ${!isDelivery ? `<td class="cell-center"><button class="icon-btn" title="ইনভয়েস দেখুন" onclick="viewInvoice('${o.id}')">🧾</button>${isAdmin() && isDateLocked(o.date) ? '<span title="এই মাস লক করা">🔒</span>' : isAdmin() ? `<button class="icon-btn" title="সংশোধন" onclick="openOrderForm('${o.id}')">✏️</button><button class="icon-btn danger" title="মুছুন" onclick="deleteOrder('${o.id}')">🗑️</button>` : ''}</td>` : ''}
    </tr>`).join('');

  document.getElementById('pageContent').innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h3>অর্ডার ও সেলস</h3>
        ${!isDelivery ? `<button class="btn btn-accent btn-sm" onclick="openOrderForm()">+ নতুন অর্ডার</button>` : ''}
      </div>
      <div class="toolbar">
        <label style="font-size:13px;">মাস:</label>
        <select onchange="onOrderMonth(this)">${monthOptionsHtml(ORD_MONTH, true)}</select>
        <span class="muted-cell">${orders.length}টি অর্ডার</span>
      </div>
      <div class="table-wrap"><table><thead><tr>
        <th>আইডি</th><th>তারিখ</th><th>কাস্টমার</th><th>পণ্য</th>
        ${canSeeMoney?'<th>মোট মূল্য</th>':''}
        <th>স্ট্যাটাস</th>
        ${canSeeMoney?'<th>পেমেন্ট</th>':''}
        ${!isDelivery?'<th>একশন</th>':''}
      </tr></thead><tbody>${rows || `<tr><td colspan="8" class="empty-state">কোনো অর্ডার নেই</td></tr>`}</tbody></table></div>
      ${session.role==='manager' ? `<p style="font-size:12px;color:var(--text-muted);margin-top:8px;">অর্ডার/ইনভয়েসে ভুল থাকলে সংশোধন বা মোছার ক্ষমতা শুধু অ্যাডমিনের — অ্যাডমিনকে জানান।</p>` : ''}
    </div>
    <div id="modalHolder"></div>
  `;
}

function updateOrderStatus(id, newStatus){
  const orders = CACHE.orders.slice();
  const products = CACHE.products.slice();
  const idx = orders.findIndex(o=>o.id===id);
  const order = {...orders[idx]};
  if(!guardDate(order.date, 'স্ট্যাটাস পরিবর্তন')){ renderOrders(); return; }
  const wasDelivered = order.status === 'Delivered';
  const willBeDelivered = newStatus === 'Delivered';

  if(wasDelivered !== willBeDelivered){
    const sign = willBeDelivered ? -1 : 1; // going TO delivered subtracts stock, coming FROM delivered restores it
    orderItems(order).forEach(it => {
      const pIdx = products.findIndex(p=>p.id===it.productId);
      if(pIdx>-1){ products[pIdx] = {...products[pIdx], stock: r3(Number(products[pIdx].stock) + sign*Number(it.qty))}; }
    });
  }
  order.status = newStatus;
  orders[idx] = order;
  saveCollection('products', products);
  saveCollection('orders', orders);
  renderOrders();
}

/* ---- Order form: multi-product cart with a searchable product picker ---- */
let ORDER_CART = [];   // [{productId, qty, unitPrice, standardPrice}]

let ORDER_FROM = 'orders', ORDER_EDIT_ID = '';
function cancelOrderForm(){
  if(ORDER_FROM==='invoice' && ORDER_EDIT_ID){ renderInvoice(ORDER_EDIT_ID); } else { renderOrders(); }
  toTop();
}
function viewInvoice(id){ INVOICE_PRESELECT = id; go('invoice'); }
function openOrderForm(id, from){
  if(id && !isAdmin()){ alert('অর্ডার/ইনভয়েস সংশোধন শুধু অ্যাডমিন করতে পারবেন।'); return; }
  if(id){ const eo = CACHE.orders.find(o=>o.id===id); if(eo && !guardDate(eo.date, 'সংশোধন')) return; }
  ORDER_FROM = from || 'orders'; ORDER_EDIT_ID = id || '';
  const orders = CACHE.orders;
  const o = id ? orders.find(x=>x.id===id) : null;
  ORDER_CART = o ? orderItems(o).map(it=>{
    const p = CACHE.products.find(x=>x.id===it.productId);
    const m = unitOptions(p).find(o=>o.label===it.du);
    return {...it, mode: m ? m.key : 'base'};
  }) : [];

  const html = `
    <div class="panel">
      <h3>${o?`ইনভয়েস/অর্ডার সংশোধন — ${o.id}`:'নতুন অর্ডার'}</h3>
      ${o ? `<p style="font-size:12.5px;color:var(--text-muted);margin-top:-2px;">নাম, ঠিকানা, পণ্য, পরিমাণ, দাম, ডেলিভারি চার্জ, ছাড়, পেমেন্ট — যা ভুল হয়েছে সেটা বদলে "সংরক্ষণ করুন" চাপুন।${o.status==='Delivered' ? ' অর্ডারটি ডেলিভারড হওয়ায় পণ্যের পরিমাণ বদলালে স্টক নিজে থেকেই ঠিক হয়ে যাবে।' : ''}</p>` : ''}
      <div class="form-grid">
        ${dateField('o_date', o?o.date:'')}
        <div class="form-field"><label>কাস্টমার নাম</label><input id="o_name" value="${o?esc(o.customerName):''}"></div>
        <div class="form-field"><label>মোবাইল নম্বর</label><input id="o_phone" value="${o?esc(o.phone):''}"></div>
        <div class="form-field span-2"><label>ডেলিভারি ঠিকানা</label><input id="o_addr" value="${o?esc(o.address):''}"></div>
        <div class="form-field"><label>ডেলিভারি চার্জ (৳)</label><input id="o_delivery" type="number" value="${o?o.deliveryCharge:0}" oninput="renderCart()"></div>
        <div class="form-field"><label>ছাড় / ডিসকাউন্ট (৳)</label><input id="o_discount" type="number" value="${o?(o.discount||0):0}" oninput="renderCart()"></div>
        <div class="form-field"><label>অর্ডার সোর্স</label>
          <select id="o_source">
            ${['Online App','Website','Offline Counter'].map(s=>`<option ${o&&o.source===s?'selected':''}>${s}</option>`).join('')}
          </select>
        </div>
        <div class="form-field"><label>পেমেন্ট স্ট্যাটাস</label>
          <select id="o_pay" onchange="onPaymentStatusChange()">
            ${['Paid','Due','Partial'].map(s=>`<option value="${s}" ${o&&o.paymentStatus===s?'selected':''}>${PAY_BN[s]}</option>`).join('')}
          </select>
        </div>
        <div class="form-field"><label>পরিশোধের পরিমাণ (৳)</label><input id="o_paid" type="number" value="${o?(o.paidAmount!=null?o.paidAmount:(o.paymentStatus==='Paid'?o.total:0)):0}"></div>
        <div class="form-field"><label>পেমেন্টের ধরন</label>
          <select id="o_paymethod" onchange="onPayMethodChange()">
            ${PAY_METHODS.map(m=>`<option value="${m.value}" ${(o&&o.paymentMethod===m.value) || (!o&&m.value==='Cash')?'selected':''}>${m.label}</option>`).join('')}
          </select>
        </div>
        <div class="form-field span-2 ${(o&&o.paymentMethod&&o.paymentMethod!=='Cash')?'':'hidden'}" id="o_txnref_wrap">
          <label>ট্রানজেকশন আইডি / অ্যাকাউন্ট নম্বর</label>
          <input id="o_txnref" value="${o?esc(o.transactionRef||''):''}">
        </div>
      </div>

      <div style="margin-top:18px;">
        <label style="font-size:12.5px;color:var(--text-muted);display:block;margin-bottom:5px;">পণ্য খুঁজুন ও যোগ করুন</label>
        <input id="o_search" type="text" placeholder="পণ্যের নাম লিখুন..." oninput="renderProductSearch(this.value)" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:7px;background:var(--bg);">
        <div id="searchResults" class="search-results"></div>
      </div>

      <div id="cartHolder" style="margin-top:14px;"></div>

      <div style="margin-top:16px;display:flex;gap:10px;">
        <button class="btn btn-primary" onclick="saveOrder('${o?o.id:''}')">সংরক্ষণ করুন</button>
        <button class="btn btn-outline" onclick="cancelOrderForm()">বাতিল</button>
      </div>
    </div>`;
  openForm(html);
  renderCart();
}

function renderProductSearch(query){
  const box = document.getElementById('searchResults');
  const q = query.trim().toLowerCase();
  if(!q){ box.innerHTML=''; box.classList.remove('open'); return; }
  const matches = CACHE.products.filter(p => !p.hidden && p.name.toLowerCase().includes(q)).slice(0,8);
  if(!matches.length){
    box.innerHTML = `<div class="search-empty">কোনো পণ্য পাওয়া যায়নি</div>`;
    box.classList.add('open');
    return;
  }
  box.innerHTML = matches.map(p => `
    <div class="search-result-item" onclick="addToCart('${p.id}')" style="flex-direction:column;align-items:flex-start;gap:2px;">
      <div style="display:flex;justify-content:space-between;width:100%;">
        <span>${esc(p.name)}</span>
        <span class="muted-cell">স্টক: ${fmtStock(p.stock, p)} · ${money(p.retail)}/${esc(p.unit||'কেজি')}</span>
      </div>
      ${p.priceTiers ? `<span class="muted-cell" style="font-size:11.5px;">${esc(p.priceTiers)}</span>` : ''}
    </div>`).join('');
  box.classList.add('open');
}

function addToCart(productId){
  const p = CACHE.products.find(x=>x.id===productId);
  if(!p) return;
  const existing = ORDER_CART.find(it=>it.productId===productId);
  if(existing){ existing.qty = Number(existing.qty) + 1; }
  else { ORDER_CART.push({productId, qty:1, unitPrice: p.retail, standardPrice: p.retail}); }
  document.getElementById('o_search').value = '';
  document.getElementById('searchResults').innerHTML = '';
  document.getElementById('searchResults').classList.remove('open');
  renderCart();
}
function updateCartQty(productId, qty){
  const it = ORDER_CART.find(x=>x.productId===productId);
  if(it){
    const v = Number(qty)||0;
    const o = optByKey(CACHE.products.find(x=>x.id===productId), it.mode);
    it.qty = Math.max(0.001, v/o.factor) || 1;
  }
  renderCart();
}
function setCartUnitMode(productId, mode){
  const it = ORDER_CART.find(x=>x.productId===productId);
  if(it){ it.mode = mode; }
  renderCart();
}
function removeFromCart(productId){
  ORDER_CART = ORDER_CART.filter(it=>it.productId!==productId);
  renderCart();
}

function cartTotal(){
  const deliveryCharge = Number(document.getElementById('o_delivery')?.value || 0);
  const discount = Number(document.getElementById('o_discount')?.value || 0);
  const subtotal = ORDER_CART.reduce((s,it)=>s+lineAmt(it),0);
  return Math.max(0, subtotal + deliveryCharge - discount);
}
function onPaymentStatusChange(){
  const status = document.getElementById('o_pay').value;
  const paidField = document.getElementById('o_paid');
  if(status==='Paid') paidField.value = cartTotal();
  else if(status==='Due') paidField.value = 0;
  // 'Partial' — leave whatever the user already typed, they fill it manually
}
function onPayMethodChange(){
  const method = document.getElementById('o_paymethod').value;
  document.getElementById('o_txnref_wrap').classList.toggle('hidden', method==='Cash');
}
function updateCartPrice(productId, price){
  const it = ORDER_CART.find(x=>x.productId===productId);
  if(it) it.unitPrice = Math.max(0, Number(price)||0);
  renderCart();
}
function renderCart(){
  const holder = document.getElementById('cartHolder');
  if(!holder) return;
  const deliveryCharge = Number(document.getElementById('o_delivery')?.value || 0);
  const discount = Number(document.getElementById('o_discount')?.value || 0);
  if(!ORDER_CART.length){
    holder.innerHTML = `<div class="empty-state" style="padding:16px;">এখনো কোনো পণ্য যোগ করা হয়নি — উপরে সার্চ করে পণ্য যোগ করুন</div>`;
    return;
  }
  let subtotal = 0;
  const rows = ORDER_CART.map(it=>{
    const p = CACHE.products.find(x=>x.id===it.productId);
    const lineTotal = lineAmt(it);
    subtotal += lineTotal;
    return `
      <tr>
        <td>${esc(p?p.name:'—')}</td>
        <td class="cell-center"><input type="number" min="0.001" step="any" value="${r3(it.qty*optByKey(p,it.mode).factor)}" style="width:75px;text-align:center;padding:5px;border:1px solid var(--border);border-radius:6px;" onchange="updateCartQty('${it.productId}', this.value)">
          ${unitSelectHtml(p, it.mode||'base', `onchange="setCartUnitMode('${it.productId}', this.value)"`)}</td>
        <td class="cell-center"><input type="number" min="0" value="${it.unitPrice}" style="width:80px;text-align:center;padding:5px;border:1px solid var(--border);border-radius:6px;" onchange="updateCartPrice('${it.productId}', this.value)"></td>
        <td class="cell-num">${money(lineTotal)}<br><span class="muted-cell">${r3(it.qty*optByKey(p,it.mode).factor)} ${esc(optByKey(p,it.mode).label)} = ${r3(it.qty)}টি ${esc(p?.unit||'কেজি')} × ${money(it.unitPrice)}</span></td>
        <td class="cell-center"><button class="icon-btn danger" onclick="removeFromCart('${it.productId}')">🗑️</button></td>
      </tr>`;
  }).join('');
  holder.innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>পণ্য</th><th>পরিমাণ</th><th>একক মূল্য (এডিট করা যাবে)</th><th>লাইন টোটাল</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <table style="margin-top:8px;">
      <tr><td>সাবটোটাল</td><td class="cell-num">${money(subtotal)}</td></tr>
      <tr><td>ডেলিভারি চার্জ</td><td class="cell-num">+ ${money(deliveryCharge)}</td></tr>
      ${discount>0 ? `<tr><td>ছাড় / ডিসকাউন্ট</td><td class="cell-num">− ${money(discount)}</td></tr>` : ''}
    </table>
    <div class="invoice-total-row" style="margin-top:6px;"><span>সর্বমোট</span><span>${money(Math.max(0,subtotal+deliveryCharge-discount))}</span></div>
    <p style="font-size:12px;color:var(--text-muted);margin-top:8px;">দাম বদলাতে চাইলে লাইনের "একক মূল্য" ঘরে নতুন দাম লিখুন। সামগ্রিক ছাড় উপরের "ছাড় / ডিসকাউন্ট" ঘরে দিন।</p>
  `;
}

function saveOrder(id){
  const orders = CACHE.orders.slice();
  const deliveryCharge = Number(document.getElementById('o_delivery').value||0);
  const discount = Number(document.getElementById('o_discount').value||0);
  const subtotal = ORDER_CART.reduce((s,it)=>s+lineAmt(it),0);
  const data = {
    date: pickedDate('o_date'),
    customerName: document.getElementById('o_name').value.trim(),
    phone: document.getElementById('o_phone').value.trim(),
    address: document.getElementById('o_addr').value.trim(),
    items: ORDER_CART.map(it=>{
      const p = CACHE.products.find(x=>x.id===it.productId);
      const o = optByKey(p, it.mode);
      return {productId:it.productId, qty:Number(it.qty), unitPrice:Number(it.unitPrice), standardPrice:Number(it.standardPrice!=null?it.standardPrice:it.unitPrice),
        dq: r3(Number(it.qty)*o.factor), du: o.label};
    }),
    discount,
    total: Math.max(0, subtotal + deliveryCharge - discount),
    deliveryCharge,
    source: document.getElementById('o_source').value,
    paymentStatus: document.getElementById('o_pay').value,
    paidAmount: Number(document.getElementById('o_paid').value||0),
    paymentMethod: document.getElementById('o_paymethod').value,
    transactionRef: document.getElementById('o_paymethod').value!=='Cash' ? document.getElementById('o_txnref').value.trim() : ''
  };
  if(!data.customerName){ alert('কাস্টমারের নাম দিন'); return; }
  if(!data.items.length){ alert('অন্তত একটি পণ্য যোগ করুন'); return; }
  if(!guardDates([data.date, id ? (orders.find(o=>o.id===id)||{}).date : ''], id ? 'সংশোধন' : 'এন্ট্রি')) return;
  if(ORD_MONTH!=='all') ORD_MONTH = mOf(data.date) || ORD_MONTH;
  if(data.paymentStatus==='Paid') data.paidAmount = Math.max(data.paidAmount, data.total);
  else if(data.paymentStatus==='Due') data.paidAmount = 0;
  if(id){
    const idx = orders.findIndex(o=>o.id===id);
    // drop legacy single-item fields so the order fully switches to the items[] shape
    const prev = {...orders[idx]};
    if(prev.status==='Delivered'){
      // ডেলিভারড অর্ডার সংশোধন: পুরোনো পরিমাণ স্টকে ফেরত, নতুন পরিমাণ স্টক থেকে বাদ
      const products = CACHE.products.map(p=>({...p}));
      adjustStock(products, orderItems(prev), +1);
      adjustStock(products, data.items, -1);
      saveCollection('products', products);
    }
    delete prev.productId; delete prev.qty; delete prev.unitPrice;
    orders[idx] = stampEdit({...prev, ...data});
  } else {
    data.id = genId('ORD-', orders);
    data.status = 'Pending';
    orders.push(data);
  }
  saveCollection('orders', orders);
  if(id && ORDER_FROM==='invoice'){ renderInvoice(id); } else { renderOrders(); }
  toTop();
}
function deleteOrder(id){
  if(!isAdmin()){ alert('অর্ডার মোছা শুধু অ্যাডমিন করতে পারবেন।'); return; }
  const o = CACHE.orders.find(x=>x.id===id); if(!o) return;
  if(!guardDate(o.date, 'মুছে ফেলা')) return;
  const delivered = o.status==='Delivered';
  if(!confirm(`এই অর্ডারটি (${id}) মুছে ফেলতে চান?${delivered ? '\n\nঅর্ডারটি ডেলিভারড ছিল — মুছলে এর পণ্যগুলো স্টকে ফেরত যাবে।' : ''}`)) return;
  if(delivered){
    const products = CACHE.products.map(p=>({...p}));
    adjustStock(products, orderItems(o), +1);
    saveCollection('products', products);
  }
  saveCollection('orders', CACHE.orders.filter(x=>x.id!==id));
  renderOrders();
}

/* ============================================================
   PURCHASES
   ============================================================ */
let PU_EDIT_ID = '';
let PU_Q = '', PU_PAY = 'all', PU_MONTH = curMonth();
function purchaseRowsHtml(){
  const admin = isAdmin();
  const products = CACHE.products;
  const q = PU_Q.trim().toLowerCase();
  const purchases = CACHE.purchases.filter(pu=>{
    if(PU_MONTH!=='all' && mOf(pu.date)!==PU_MONTH) return false;
    if(PU_PAY==='Paid' && pu.paymentStatus!=='Paid') return false;
    if(PU_PAY==='Due' && pu.paymentStatus==='Paid') return false;
    if(!q) return true;
    const prod = products.find(p=>p.id===pu.productId);
    return [pu.id, pu.supplier, pu.voucherNo, pu.productName, prod&&prod.name, pu.date].some(v=>String(v||'').toLowerCase().includes(q));
  });
  let rows = purchases.slice().reverse().map(pu => {
    const freeQty = Number(pu.freeQty||0);
    const avgUnitCost = pu.qty>0 ? pu.totalCost/pu.qty : 0;
    const prod = products.find(p=>p.id===pu.productId);
    const unit = esc(prod?.unit || 'কেজি');
    return `
    <tr class="${hlClass('purchases',pu.id)}">
      <td>${pu.id} ${editedBadge(pu)}</td><td>${pu.date}</td><td>${pu.voucherNo?esc(pu.voucherNo):'<span class="muted-cell">—</span>'}</td><td>${esc(pu.supplier)}</td>
      <td>${esc(prod?prod.name:(pu.productName||'—'))}</td>
      <td class="cell-num">${pu.qty} ${unit}${freeQty>0 ? ` <span class="badge" style="background:#DCF3E7;color:#167A54;">${freeQty} ফ্রি</span>` : ''}</td>
      <td class="cell-num">${money(pu.totalCost)}</td>
      <td class="cell-num muted-cell">${money(avgUnitCost)}/${unit}</td>
      <td class="cell-center"><span class="badge ${pu.paymentStatus==='Paid'?'badge-paid':'badge-due'}">${pu.paymentStatus==='Paid'?'পরিশোধিত':'বকেয়া'}</span></td>
      <td class="cell-center">${admin && isDateLocked(pu.date) ? '<span title="এই মাস লক করা">🔒</span>' : admin ? `<button class="icon-btn" title="ভুল সংশোধন করুন" onclick="openPurchaseForm('${pu.id}')">✏️</button><button class="icon-btn danger" title="মুছুন" onclick="deletePurchase('${pu.id}')">🗑️</button>` : '<span class="muted-cell">—</span>'}</td>
    </tr>`;
  }).join('');
  return rows || `<tr><td colspan="10" class="empty-state">${CACHE.purchases.length ? 'কিছু পাওয়া যায়নি' : 'কোনো ক্রয় এন্ট্রি নেই'}</td></tr>`;
}
function onPurchaseSearch(){
  PU_Q = document.getElementById('puSearch').value;
  PU_PAY = document.getElementById('puPay').value;
  PU_MONTH = document.getElementById('puMonth').value;
  document.getElementById('puBody').innerHTML = purchaseRowsHtml();
}
function renderPurchases(){
  const admin = isAdmin();
  document.getElementById('pageContent').innerHTML = `
    ${flashHtml('purchases')}
    <div class="panel">
      <div class="panel-head"><h3>ক্রয় খাতা (সোর্সিং)</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-outline btn-sm" onclick="downloadPurchaseTemplate()">📥 ক্রয় আপলোডের ফরম্যাট</button>
          <button class="btn btn-outline btn-sm" onclick="document.getElementById('puExcelInput').click()">📤 এক্সেল থেকে ক্রয় আপলোড</button>
          <input type="file" id="puExcelInput" accept=".xlsx,.xls" class="hidden" onchange="handlePurchaseExcel(event)">
          <button class="btn btn-accent btn-sm" onclick="openPurchaseForm()">+ নতুন ক্রয়</button>
        </div>
      </div>
      <div class="toolbar">
        <select id="puMonth" onchange="onPurchaseSearch()">${monthOptionsHtml(PU_MONTH, true)}</select>
        <input type="search" id="puSearch" placeholder="🔍 পণ্য / সরবরাহকারী / আইডি / তারিখ দিয়ে খুঁজুন" value="${esc(PU_Q)}" oninput="onPurchaseSearch()">
        <select id="puPay" onchange="onPurchaseSearch()">
          <option value="all" ${PU_PAY==='all'?'selected':''}>সব পেমেন্ট</option>
          <option value="Paid" ${PU_PAY==='Paid'?'selected':''}>পরিশোধিত</option>
          <option value="Due" ${PU_PAY==='Due'?'selected':''}>বকেয়া</option>
        </select>
      </div>
      <div class="table-wrap"><table><thead><tr>
        <th>আইডি</th><th>তারিখ</th><th>ভাউচার নং</th><th>সরবরাহকারী</th><th>পণ্য</th><th>পরিমাণ</th><th>মোট খরচ</th><th>গড় খরচ/একক</th><th>পেমেন্ট</th><th>একশন</th>
      </tr></thead><tbody id="puBody">${purchaseRowsHtml()}</tbody></table></div>
      <p style="font-size:12px;color:var(--text-muted);margin-top:8px;">ফ্রি আইটেম এলে মোট পরিমাণের মধ্যেই সেটা ধরে "গড় খরচ/একক" স্বয়ংক্রিয়ভাবে হিসাব হয় — আলাদা কিছু করতে হয় না।${admin ? ' ভুল এন্ট্রি ✏️ বাটনে সংশোধন করুন — স্টক নিজে থেকেই সমন্বয় হবে।' : ' ভুল এন্ট্রি সংশোধন বা মোছা শুধু অ্যাডমিন করতে পারবেন — অ্যাডমিনকে জানান।'}</p>
    </div>
    <div id="modalHolder"></div>
  `;
  scrollToHl();
}
/* ============================================================
   PURCHASE EXCEL IMPORT — ক্রয় ভাউচার এক্সেল থেকে একসাথে আপলোড
   ============================================================ */
let PU_IMPORT = null;
const BN_DIG = '০১২৩৪৫৬৭৮৯';
function bnToEn(v){ return String(v).replace(/[০-৯]/g, d => BN_DIG.indexOf(d)); }
function toNum(v){
  if(v===null || v===undefined || String(v).trim()==='') return null;
  if(typeof v==='number') return v;
  const n = Number(bnToEn(v).replace(/[,\s৳]/g,''));
  return isNaN(n) ? NaN : n;
}
function validYMD(y,m,d){ const dt = new Date(Date.UTC(y,m-1,d)); return dt.getUTCFullYear()===y && dt.getUTCMonth()===m-1 && dt.getUTCDate()===d; }
function parseXlDate(v){
  if(v===null || v===undefined || String(v).trim()==='') return '';
  let y,m,d;
  if(typeof v==='number'){ const dt = new Date(Date.UTC(1899,11,30) + Math.round(v)*864e5); y = dt.getUTCFullYear(); m = dt.getUTCMonth()+1; d = dt.getUTCDate(); }
  else {
    const s = bnToEn(v).trim(); let t;
    if((t = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/))){ y=+t[1]; m=+t[2]; d=+t[3]; }
    else if((t = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/))){ d=+t[1]; m=+t[2]; y=+t[3]; }
    else return '';
  }
  if(!validYMD(y,m,d)) return '';
  return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}
function normHeader(h){ return String(h||'').split('(')[0].replace(/\s+/g,' ').trim(); }
function normName(n){ return String(n||'').replace(/\s+/g,' ').trim().toLowerCase(); }
function planPurchaseImport(rawRows){
  const rows = []; const newNames = {};
  const prodByName = {}, prodById = {};
  CACHE.products.forEach(p => { prodByName[normName(p.name)] = p; prodById[String(p.id).toLowerCase()] = p; });
  const existingKeys = new Set(CACHE.purchases.map(pu => [pu.date, String(pu.voucherNo||'').trim().toLowerCase(), pu.productId, r3(pu.qty), r2(pu.totalCost)].join('|')));
  rawRows.forEach((raw, i) => {
    const r = {}; Object.keys(raw).forEach(k => { r[normHeader(k)] = raw[k]; });
    const blank = Object.keys(r).every(k => String(r[k]??'').trim()==='');
    if(blank) return;
    const o = {n: i+2, err:'', dup:false};
    o.date = parseXlDate(r['তারিখ']);
    o.voucher = String(r['ভাউচার নং']??'').trim();
    o.supplier = String(r['সরবরাহকারী']??'').trim();
    o.name = String(r['পণ্যের নাম']??'').trim();
    const pid = String(r['আইডি']??'').trim().toLowerCase();
    o.qty = toNum(r['পরিমাণ']); o.free = toNum(r['এর মধ্যে ফ্রি পরিমাণ']) || 0; o.cost = toNum(r['মোট খরচ']);
    const pay = String(r['পেমেন্ট']??'').trim();
    o.status = /বকেয়া|due|outstanding/i.test(pay) ? 'Outstanding' : 'Paid';
    const paid = toNum(r['পরিশোধিত টাকা']); o.paidIn = paid;
    o.cat = String(r['ক্যাটাগরি']??'').trim(); o.unit = String(r['একক']??'').trim(); o.retail = toNum(r['বিক্রয়মূল্য']);
    const errs = [];
    if(!o.date) errs.push('তারিখ ভুল/ফাঁকা (YYYY-MM-DD লিখুন)');
    else if(isDateLocked(o.date)) errs.push(monthLabel(mOf(o.date)) + ' মাস লক করা');
    if(!o.supplier) errs.push('সরবরাহকারী ফাঁকা');
    let prod = (pid && prodById[pid]) || prodByName[normName(o.name)] || null;
    if(!prod && !o.name) errs.push('পণ্যের নাম ফাঁকা');
    if(o.qty===null || isNaN(o.qty) || !(o.qty>0)) errs.push('পরিমাণ ভুল');
    if(isNaN(o.free) || o.free<0 || o.free>(o.qty||0)) errs.push('ফ্রি পরিমাণ ভুল');
    if(o.cost===null || isNaN(o.cost) || o.cost<0) errs.push('মোট খরচ ভুল');
    if(o.retail!==null && isNaN(o.retail)) errs.push('বিক্রয়মূল্য ভুল');
    o.err = errs.join(', ');
    if(prod){ o.pid = prod.id; o.name = prod.name; } else if(!o.err){ o.isNew = true; newNames[normName(o.name)] = o.name; }
    if(!o.err && o.pid){
      const key = [o.date, o.voucher.toLowerCase(), o.pid, r3(o.qty), r2(o.cost)].join('|');
      if(existingKeys.has(key)) o.dup = true;
    }
    rows.push(o);
  });
  return {rows, newNames: Object.values(newNames)};
}
function downloadPurchaseTemplate(){
  if(typeof XLSX==='undefined'){ alert('এক্সেল লাইব্রেরি লোড হয়নি — ইন্টারনেট চেক করে পেইজ রিফ্রেশ করুন'); return; }
  const head = ['তারিখ (YYYY-MM-DD)','ভাউচার নং','সরবরাহকারী','পণ্যের নাম','পরিমাণ','এর মধ্যে ফ্রি পরিমাণ','মোট খরচ (৳)','পেমেন্ট (পরিশোধিত/বকেয়া)','পরিশোধিত টাকা (বকেয়া হলে)','ক্যাটাগরি (শুধু নতুন পণ্যের জন্য)','একক (শুধু নতুন পণ্যের জন্য)','বিক্রয়মূল্য (শুধু নতুন পণ্যের জন্য)'];
  const ex = CACHE.products.slice(0,2);
  const rows = [head,
    [todayStr(),'V-1001','নমুনা সরবরাহকারী', ex[0]?ex[0].name:'চিনিগুড়া (পোলাও)', 50, 0, 10500, 'পরিশোধিত', '', '', '', ''],
    [todayStr(),'V-1001','নমুনা সরবরাহকারী', ex[1]?ex[1].name:'মসুর ডাল (দেশি)', 25, 1, 3200, 'বকেয়া', 1000, '', '', '']];
  const ws = XLSX.utils.aoa_to_sheet(rows); ws['!cols'] = head.map(() => ({wch:24}));
  const help = [['নির্দেশনা'],
    ['১. প্রতিটি সারি = একটি ভাউচারের একটি পণ্য। একই ভাউচারে ৫টি পণ্য থাকলে ৫টি সারি, ভাউচার নং সবগুলোয় একই।'],
    ['২. "পণ্যের নাম" পণ্য তালিকার নামের সাথে হুবহু মিলতে হবে (পাশের "পণ্যের তালিকা" শিটের নাম কপি করুন)। না মিললে নতুন পণ্য হিসেবে যোগ হবে।'],
    ['৩. "পরিমাণ" পণ্যের একক অনুযায়ী (যেমন কেজি পণ্যে কেজি, ৫০০ গ্রামের প্যাকেট পণ্যে প্যাকেট সংখ্যা)। ফ্রি আইটেমসহ মোট পরিমাণ লিখুন।'],
    ['৪. "মোট খরচ" = ওই সারির পণ্যের জন্য আসলে যত টাকা দিয়েছেন।'],
    ['৫. "পেমেন্ট": পরিশোধিত অথবা বকেয়া। ফাঁকা থাকলে পরিশোধিত ধরা হবে।'],
    ['৬. শেষ তিনটি ঘর (ক্যাটাগরি, একক, বিক্রয়মূল্য) শুধু নতুন পণ্যের জন্য — আগের পণ্যের জন্য ফাঁকা রাখুন।'],
    ['৭. একই ফাইল ভুলে দ্বিতীয়বার আপলোড করলে আগের এন্ট্রিগুলো "ডুপ্লিকেট" ধরে বাদ যাবে — স্টক দ্বিগুণ হবে না।']];
  const wh = XLSX.utils.aoa_to_sheet(help); wh['!cols'] = [{wch:120}];
  const wp = XLSX.utils.aoa_to_sheet([['আইডি','পণ্যের নাম','একক']].concat(CACHE.products.map(p => [p.id, p.name, p.unit||'কেজি']))); wp['!cols'] = [{wch:10},{wch:40},{wch:14}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ক্রয় ভাউচার'); XLSX.utils.book_append_sheet(wb, wh, 'নির্দেশনা'); XLSX.utils.book_append_sheet(wb, wp, 'পণ্যের তালিকা');
  XLSX.writeFile(wb, 'ক্রয়-আপলোড-ফরম্যাট.xlsx');
}
function handlePurchaseExcel(event){
  const file = event.target.files[0]; event.target.value = '';
  if(!file) return;
  if(typeof XLSX==='undefined'){ alert('এক্সেল লাইব্রেরি লোড হয়নি — ইন্টারনেট চেক করে পেইজ রিফ্রেশ করুন'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    try{
      const wb = XLSX.read(e.target.result, {type:'array'});
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, {defval:''});
      if(!raw.length){ alert('ফাইলে কোনো সারি পাওয়া যায়নি'); return; }
      showPurchaseImportPreview(planPurchaseImport(raw));
    }catch(err){ alert('ফাইলটি পড়া যায়নি: ' + err.message); }
  };
  reader.readAsArrayBuffer(file);
}
function showPurchaseImportPreview(plan){
  PU_IMPORT = plan;
  const ok = plan.rows.filter(r => !r.err && !r.dup), bad = plan.rows.filter(r => r.err), dup = plan.rows.filter(r => r.dup);
  const total = r2(ok.reduce((t,r) => t + r.cost, 0));
  openForm(`
    <div class="panel">
      <h3>📤 ক্রয় আপলোড — যাচাই</h3>
      <div class="flash ${bad.length?'warn':''}" style="margin-bottom:12px;">
        মোট সারি: <b>${plan.rows.length}</b> · আপলোড হবে: <b>${ok.length}</b> (মোট ${money(total)}) · ত্রুটি: <b>${bad.length}</b> · ডুপ্লিকেট (আগেই আছে, বাদ): <b>${dup.length}</b>
      </div>
      ${plan.newNames.length ? `<div class="flash warn" style="margin-bottom:12px;">🆕 <b>${plan.newNames.length}টি নতুন পণ্য</b> তৈরি হবে — বানান ঠিক আছে তো? (ভুল বানানে নতুন পণ্য হয়ে যায়)<br>${plan.newNames.slice(0,30).map(esc).join('، ')}${plan.newNames.length>30?' ...':''}</div>` : ''}
      ${bad.length ? `<div class="table-wrap"><table><thead><tr><th>সারি</th><th>পণ্য</th><th>সমস্যা</th></tr></thead><tbody>${bad.slice(0,50).map(r => `<tr><td>${r.n}</td><td>${esc(r.name)}</td><td style="color:#B3261E;">${esc(r.err)}</td></tr>`).join('')}</tbody></table></div>${bad.length>50?`<p class="muted-cell">আরও ${bad.length-50}টি ত্রুটি আছে</p>`:''}<p style="font-size:12.5px;color:var(--text-muted);">ত্রুটির সারিগুলো আপলোড হবে না। ফাইল ঠিক করে আবার আপলোড করতে পারেন — যেগুলো এখন আপলোড হবে সেগুলো তখন ডুপ্লিকেট ধরে বাদ যাবে।</p>` : ''}
      <p style="font-size:12.5px;color:var(--text-muted);margin:12px 0;">আপলোডের পর প্রতিটি পণ্যের ক্রয়মূল্য নিজে থেকে সব ক্রয় ভাউচারের গড় অনুযায়ী ঠিক হয়ে যাবে।</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button class="btn btn-primary" ${ok.length?'':'disabled'} onclick="confirmPurchaseImport()">✅ ${ok.length}টি ক্রয় এন্ট্রি আপলোড করুন (স্টকে যোগ হবে)</button>
        <button class="btn btn-outline" onclick="PU_IMPORT=null;closeForm(renderPurchases)">বাতিল</button>
      </div>
    </div>`);
}
function confirmPurchaseImport(){
  const plan = PU_IMPORT; if(!plan) return;
  const ok = plan.rows.filter(r => !r.err && !r.dup);
  if(!ok.length){ alert('আপলোডের মতো কোনো সঠিক সারি নেই'); return; }
  if(!guardDates(ok.map(r => r.date), 'আপলোড')) return;
  const products = CACHE.products.map(p => ({...p}));
  const purchases = CACHE.purchases.slice();
  const agg = {}, createdIds = [], newPurchaseIds = [];
  const byName = {}; products.forEach((p,i) => { byName[normName(p.name)] = i; });
  const cats = CACHE.settings.productCategories.slice(); let catsChanged = false;
  ok.forEach(r => {
    let pi = r.pid ? products.findIndex(p => p.id===r.pid) : (byName[normName(r.name)] ?? -1);
    let isNew = false;
    if(pi < 0){
      const np = {id: genId('P', products), name: r.name, category: r.cat || 'অন্যান্য', unit: r.unit || 'কেজি', cost: 0, retail: (r.retail>0 ? r.retail : 0), stock: 0, minStock: 5, hidden: false, createdAt: todayStr()};
      products.push(np); pi = products.length-1; byName[normName(r.name)] = pi; createdIds.push(np.id); isNew = true;
      if(np.category && !cats.includes(np.category)){ cats.push(np.category); catsChanged = true; }
    }
    const p = products[pi];
    products[pi] = {...p, hidden:false, stock: r3(Number(p.stock||0) + r.qty)};
    const a = agg[p.id] || (agg[p.id] = {q:0, c:0, isNew: createdIds.includes(p.id)}); a.q += r.qty; a.c += r.cost;
    const paid = r.status==='Paid' ? Math.max(r.paidIn||0, r.cost) : Math.min(r.paidIn||0, r.cost);
    const id = genId('PO-', purchases); newPurchaseIds.push(id);
    purchases.push({id, date: r.date, supplier: r.supplier, voucherNo: r.voucher, productId: p.id, productName: p.name, qty: r.qty, freeQty: r.free||0, totalCost: r.cost, paymentStatus: r.status, paidAmount: paid});
  });
  applyAvgCosts(products, purchases, Object.keys(agg));   // সব ক্রয়ের গড় অনুযায়ী ক্রয়মূল্য
  const okP = saveCollection('products', products);
  const okQ = okP && saveCollection('purchases', purchases);
  if(!okQ){ return; }
  if(catsChanged) saveSettings({...CACHE.settings, productCategories: cats});
  PU_IMPORT = null; PU_Q = ''; PU_PAY = 'all'; PU_MONTH = 'all';
  setFlash('purchases', `✅ এক্সেল থেকে ${ok.length}টি ক্রয় এন্ট্রি আপলোড হয়েছে${createdIds.length?` এবং ${createdIds.length}টি নতুন পণ্য তৈরি হয়েছে`:''} — স্টক যোগ হয়েছে ও ক্রয়মূল্য ভাউচার গড় অনুযায়ী ঠিক হয়েছে (হলুদ দাগের সারিগুলো)।${createdIds.length?'<br>⚠️ নতুন পণ্যের বিক্রয়মূল্য ০ থাকলে পণ্য তালিকা থেকে দাম বসিয়ে দিন।':''}`, newPurchaseIds);
  renderPurchases(); toTop();
}

function openPurchaseForm(id){
  if(id && !isAdmin()){ alert('ক্রয় এন্ট্রি সংশোধন শুধু অ্যাডমিন করতে পারবেন।'); return; }
  const pu = id ? CACHE.purchases.find(x=>x.id===id) : null;
  if(pu && !guardDate(pu.date, 'সংশোধন')) return;
  const products = CACHE.products;
  const hasProd = !!(pu && products.some(p=>p.id===pu.productId));
  PU_EDIT_ID = id || '';
  const cats = CACHE.settings.productCategories;
  openForm(`
    <div class="panel">
      <h3>${pu ? `ক্রয় এন্ট্রি সংশোধন — ${pu.id}` : 'নতুন ক্রয় এন্ট্রি'}</h3>
      ${pu ? `<p style="font-size:12.5px;color:var(--text-muted);margin-top:-2px;">সংশোধন করলে স্টক নিজে থেকেই ঠিক হয়ে যাবে — পুরোনো পরিমাণ স্টক থেকে বাদ গিয়ে নতুন পরিমাণ যোগ হবে।</p>` : ''}
      <div class="form-grid">
        ${dateField('pu_date', pu?pu.date:'')}
        <div class="form-field"><label>সরবরাহকারী/মিল/চাতাল নাম</label><input id="pu_supplier" value="${pu?esc(pu.supplier):''}"></div>
        <div class="form-field"><label>ভাউচার নম্বর (ঐচ্ছিক)</label><input id="pu_voucher" placeholder="যেমন: V-1024" value="${pu?esc(pu.voucherNo||''):''}"></div>
        <div class="form-field"><label>পণ্য — তালিকা থেকে বাছাই করুন</label>
          <select id="pu_product" onchange="onPurchaseProductPick()">
            <option value="">— তালিকা থেকে বাছাই করুন —</option>
            ${products.map(p=>`<option value="${p.id}" ${hasProd&&pu.productId===p.id?'selected':''}>${esc(p.name)} (একক: ${esc(p.unit||'কেজি')})${p.hidden?' — লুকানো':''}</option>`).join('')}
          </select>
        </div>
        <div class="form-field"><label>অথবা পণ্যের নাম লিখুন</label>
          <input id="pu_pname" list="pu_names" autocomplete="off" placeholder="নাম লিখুন (তালিকার পণ্য হলে সেটিই ধরা হবে)" value="${(pu && !hasProd) ? esc(pu.productName||'') : ''}" oninput="onPurchaseNameType()">
          <datalist id="pu_names">${products.map(p=>`<option value="${esc(p.name)}">`).join('')}</datalist>
          <span id="pu_matchhint" class="muted-cell" style="font-size:12px;"></span>
        </div>
      </div>

      <div id="pu_newprod" class="panel hidden" style="background:var(--bg);margin:14px 0;">
        <h3 style="font-size:15px;">🆕 নতুন পণ্যের তথ্য</h3>
        <p style="font-size:12px;color:var(--text-muted);margin-top:-6px;">এই নামে তালিকায় কোনো পণ্য নেই, তাই সংরক্ষণ করলে এটি নতুন পণ্য হিসেবে পণ্য তালিকায় যোগ হবে। নিচের ঘরগুলো পূরণ করুন।</p>
        <div class="form-grid">
          <div class="form-field"><label>ক্যাটাগরি</label>
            <select id="pu_newcat">${cats.map(c=>`<option ${c==='অন্যান্য'?'selected':''}>${esc(c)}</option>`).join('')}</select></div>
          <div class="form-field"><label>একক (এই এককেই নিচের পরিমাণ লিখবেন)</label>
            <select id="pu_newunit" onchange="refreshPurchaseUnit()">${UNIT_OPTIONS.map(u=>`<option ${u==='কেজি'?'selected':''}>${u}</option>`).join('')}</select></div>
          <div class="form-field"><label>বিক্রয়মূল্য (৳) — প্রতি এককে (পরে বদলানো যাবে)</label><input id="pu_newretail" type="number" value="0"></div>
        </div>
      </div>

      <div class="panel" style="background:var(--bg);margin:14px 0;">
        <h3 style="font-size:15px;">বস্তা/প্যাকেট থেকে মোট পরিমাণ হিসাব করুন (ঐচ্ছিক)</h3>
        <p style="font-size:12px;color:var(--text-muted);margin-top:-6px;">১০ বস্তা কিনলেন, প্রতি বস্তায় ৫০ কেজি করে হলে — নিচের দুটো ঘর পূরণ করুন, "মোট পরিমাণ" নিজে থেকেই হিসাব হয়ে যাবে।</p>
        <div class="form-grid">
          <div class="form-field"><label>কয়টি বস্তা/প্যাকেট</label><input id="pu_bags" type="number" placeholder="যেমন ১০" oninput="calcPurchaseQty()"></div>
          <div class="form-field"><label>প্রতি বস্তায়/প্যাকেটে কত (একক)</label><input id="pu_perbag" type="number" placeholder="যেমন ৫০" oninput="calcPurchaseQty()"></div>
        </div>
      </div>

      <div class="form-grid">
        <div class="form-field"><label>মোট পরিমাণ (ফ্রি আইটেমসহ)</label>
          <div style="display:flex;gap:6px;"><input id="pu_qty" type="number" step="any" value="${pu?pu.qty:1}" style="flex:1;"><select id="pu_qunit" style="width:90px;"></select></div></div>
        <div class="form-field"><label>এর মধ্যে ফ্রি পরিমাণ (ঐচ্ছিক)</label><input id="pu_freeqty" type="number" step="any" value="${pu?(pu.freeQty||0):0}"></div>
        <div class="form-field"><label>মোট খরচ — যত টাকা আসলে দিয়েছেন (৳)</label><input id="pu_cost" type="number" value="${pu?pu.totalCost:0}"></div>
        <div class="form-field"><label>পেমেন্ট স্ট্যাটাস</label>
          <select id="pu_pay" onchange="onPurchasePayChange()"><option value="Paid" ${!pu||pu.paymentStatus==='Paid'?'selected':''}>পরিশোধিত</option><option value="Outstanding" ${pu&&pu.paymentStatus!=='Paid'?'selected':''}>বকেয়া</option></select>
        </div>
        <div class="form-field"><label>পরিশোধের পরিমাণ (৳)</label><input id="pu_paid" type="number" value="${pu?(pu.paidAmount!=null?pu.paidAmount:(pu.paymentStatus==='Paid'?pu.totalCost:0)):0}"></div>
      </div>
      <p style="font-size:12px;color:var(--text-muted);margin-top:10px;">ফ্রি পেলে মোট পরিমাণে ফ্রিসহ লিখুন, আর "মোট খরচে" শুধু যত টাকা দিয়েছেন তা লিখুন।${pu ? ' (সংশোধনের সময় পরিমাণ পণ্যের মূল এককে দেখানো হচ্ছে।)' : ''}</p>
      <div style="margin-top:16px;display:flex;gap:10px;">
        <button class="btn btn-primary" onclick="savePurchase()">${pu ? 'সংশোধন সংরক্ষণ করুন (স্টক সমন্বয় হবে)' : 'সংরক্ষণ করুন (স্টকে যোগ হবে)'}</button>
        <button class="btn btn-outline" onclick="closeForm(renderPurchases)">বাতিল</button>
      </div>
    </div>`);
  refreshPurchaseUnit();
}
// ফর্মে এখন কোন পণ্য বোঝানো হয়েছে: তালিকা থেকে বাছাই, নাকি লেখা নাম (বিদ্যমান/নতুন)
function purchaseTargetProduct(){
  const typed = ((document.getElementById('pu_pname')||{}).value||'').trim();
  if(typed){
    const m = CACHE.products.find(p=>String(p.name).trim().toLowerCase()===typed.toLowerCase());
    return m ? {prod:m, isNew:false, name:typed} : {prod:null, isNew:true, name:typed};
  }
  const pid = (document.getElementById('pu_product')||{}).value;
  return {prod: CACHE.products.find(x=>x.id===pid) || null, isNew:false, name:''};
}
function onPurchaseProductPick(){ document.getElementById('pu_pname').value=''; refreshPurchaseUnit(); }
function onPurchaseNameType(){ if(document.getElementById('pu_pname').value.trim()) document.getElementById('pu_product').value=''; refreshPurchaseUnit(); }
function refreshPurchaseUnit(){
  const sel = document.getElementById('pu_qunit');
  if(!sel) return;
  const t = purchaseTargetProduct();
  const keep = sel.value;
  const hint = document.getElementById('pu_matchhint');
  const np = document.getElementById('pu_newprod');
  if(t.isNew){
    np.classList.remove('hidden');
    sel.innerHTML = `<option value="base">${esc(document.getElementById('pu_newunit').value)}</option>`;
    hint.textContent = '🆕 এই নামে কোনো পণ্য নেই — সংরক্ষণ করলে নতুন পণ্য হিসেবে যোগ হবে।';
  } else {
    np.classList.add('hidden');
    sel.innerHTML = unitOptions(t.prod).map(o=>`<option value="${o.key}">${esc(o.label)}</option>`).join('');
    if(Array.from(sel.options).some(o=>o.value===keep)) sel.value = keep;
    hint.textContent = (t.name && t.prod) ? `✔ তালিকার পণ্য "${t.prod.name}" পাওয়া গেছে — এতেই স্টক যোগ হবে।` : '';
  }
}
function calcPurchaseQty(){
  const bags = Number(document.getElementById('pu_bags').value||0);
  const perBag = Number(document.getElementById('pu_perbag').value||0);
  if(bags>0 && perBag>0){ document.getElementById('pu_qty').value = bags*perBag; }
}
function onPurchasePayChange(){
  const status = document.getElementById('pu_pay').value;
  const paidField = document.getElementById('pu_paid');
  if(status==='Paid') paidField.value = document.getElementById('pu_cost').value || 0;
  else paidField.value = 0;
}
function savePurchase(){
  const id = PU_EDIT_ID;
  if(id && !isAdmin()){ alert('ক্রয় এন্ট্রি সংশোধন শুধু অ্যাডমিন করতে পারবেন।'); return; }
  const purchases = CACHE.purchases.slice();
  const products = CACHE.products.map(p=>({...p}));
  const supplier = document.getElementById('pu_supplier').value.trim();
  const t = purchaseTargetProduct();
  if(!t.prod && !t.isNew){ alert('তালিকা থেকে পণ্য বাছাই করুন অথবা পণ্যের নাম লিখুন'); return; }
  if(!supplier){ alert('সরবরাহকারীর নাম দিন'); return; }
  const div = t.isNew ? 1 : optByKey(t.prod, document.getElementById('pu_qunit').value).factor;
  const qty = r3(Number(document.getElementById('pu_qty').value||0)/div);
  const freeQty = r3(Number(document.getElementById('pu_freeqty').value||0)/div);
  if(qty<=0){ alert('পরিমাণ সঠিকভাবে দিন'); return; }
  if(freeQty>qty){ alert('ফ্রি পরিমাণ মোট পরিমাণের চেয়ে বেশি হতে পারে না'); return; }
  if(!guardDates([pickedDate('pu_date'), id ? (purchases.find(x=>x.id===id)||{}).date : ''], id ? 'সংশোধন' : 'এন্ট্রি')) return;
  const totalCost = Number(document.getElementById('pu_cost').value||0);
  const status = document.getElementById('pu_pay').value;
  let paid = Number(document.getElementById('pu_paid').value||0);
  if(status==='Paid') paid = Math.max(paid, totalCost);

  // সংশোধন হলে আগের এন্ট্রির পরিমাণ আগে স্টক থেকে বাদ
  let old = null;
  if(id){
    old = purchases.find(x=>x.id===id);
    const oi = products.findIndex(p=>p.id===old.productId);
    if(oi>-1) products[oi] = {...products[oi], stock: r3(Number(products[oi].stock) - Number(old.qty||0))};
  }
  // নতুন নাম হলে পণ্য তৈরি
  let created = null, prod = t.prod;
  if(t.isNew){
    created = {
      id: genId('P', products), name: t.name,
      category: document.getElementById('pu_newcat').value,
      unit: document.getElementById('pu_newunit').value,
      cost: Math.round(totalCost/qty*100)/100,
      retail: Number(document.getElementById('pu_newretail').value||0),
      stock: 0, minStock: 5, hidden: false
    };
    products.push(created); prod = created;
  }
  const pi = products.findIndex(p=>p.id===prod.id);
  products[pi] = {...products[pi], hidden:false, stock: r3(Number(products[pi].stock) + qty)};
  const data = {
    date: pickedDate('pu_date'), supplier, voucherNo: (document.getElementById('pu_voucher')||{value:''}).value.trim(), productId: prod.id, productName: products[pi].name, qty, freeQty,
    totalCost, paymentStatus: status, paidAmount: paid
  };
  let savedId = id;
  if(id){
    const idx = purchases.findIndex(x=>x.id===id);
    purchases[idx] = stampEdit({...purchases[idx], ...data});
  } else {
    data.id = genId('PO-', purchases); savedId = data.id;
    purchases.push(data);
  }
  applyAvgCosts(products, purchases, [prod.id, old && old.productId]);   // ক্রয়মূল্য = ভাউচার গড়
  saveCollection('products', products);
  saveCollection('purchases', purchases);
  PU_Q = ''; PU_PAY = 'all'; if(PU_MONTH!=='all') PU_MONTH = mOf(data.date) || PU_MONTH;
  if(created){
    setFlash('purchases', `✅ ক্রয় সংরক্ষিত। <b>${esc(created.name)}</b> নতুন পণ্য হিসেবে পণ্য তালিকায় যোগ হয়েছে (আইডি ${created.id}), স্টক ${fmtStock(products[pi].stock, products[pi])}। ক্রয়মূল্য প্রতি এককে ${money(created.cost)} ধরা হয়েছে।${created.retail>0 ? '' : '<br>⚠️ বিক্রয়মূল্য এখনো ৳0 — <a href="#" onclick="go(\'products\');return false;">পণ্য তালিকা</a> থেকে দাম বসিয়ে দিন।'}`, savedId, !(created.retail>0));
  } else if(id){
    setFlash('purchases', `✅ ক্রয় এন্ট্রি ${id} সংশোধিত হয়েছে — ${esc(products[pi].name)}-এর স্টক এখন ${fmtStock(products[pi].stock, products[pi])}।`, savedId);
  } else {
    setFlash('purchases', `✅ ক্রয় সংরক্ষিত — ${esc(products[pi].name)}-এর স্টক এখন ${fmtStock(products[pi].stock, products[pi])}।`, savedId);
  }
  renderPurchases();
  toTop();
}
function deletePurchase(id){
  if(!isAdmin()){ alert('ক্রয় এন্ট্রি মোছা শুধু অ্যাডমিন করতে পারবেন।'); return; }
  const pu = CACHE.purchases.find(x=>x.id===id); if(!pu) return;
  if(!guardDate(pu.date, 'মুছে ফেলা')) return;
  if(!confirm(`এই ক্রয় এন্ট্রিটি (${id}) মুছে ফেলতে চান?\n\nএই এন্ট্রির ${pu.qty} পরিমাণ স্টক থেকে বাদ যাবে।`)) return;
  const products = CACHE.products.map(p=>({...p}));
  adjustStock(products, [{productId: pu.productId, qty: pu.qty}], -1);
  const restPurchases = CACHE.purchases.filter(p=>p.id!==id);
  applyAvgCosts(products, restPurchases, [pu.productId]);
  saveCollection('products', products);
  saveCollection('purchases', restPurchases);
  renderPurchases();
}

/* ============================================================
   EXPENSES  (ভাউচার নম্বরসহ — আয় ও খরচ দুই ক্ষেত্রেই)
   ============================================================ */
const INCOME_CATEGORIES = ['কোম্পানি কমিশন','রিবেট/ক্যাশব্যাক','অন্যান্য আয়'];
let EXP_EDIT_ID = '', EXP_KIND = '', EXP_Q = '', EXP_MONTH = curMonth();
function expenseRowsHtml(){
  const admin = isAdmin();
  const q = EXP_Q.trim().toLowerCase();
  const list = CACHE.expenses.slice().reverse().filter(e=>{
    if(EXP_MONTH!=='all' && mOf(e.date)!==EXP_MONTH) return false;
    if(!q) return true;
    return [e.id, e.voucherNo, e.category, e.approvedBy, e.date].some(v=>String(v||'').toLowerCase().includes(q));
  });
  return list.map(e => {
    const inc = e.kind==='income';
    return `
    <tr class="${hlClass('expenses',e.id)}">
      <td>${e.id} ${editedBadge(e)}</td><td>${e.date}</td>
      <td>${inc?'<span class="badge badge-paid">আয়</span> ':''}${esc(e.category)}</td>
      <td>${e.voucherNo ? esc(e.voucherNo) : '<span class="muted-cell">—</span>'}</td>
      <td class="cell-num" style="${inc?'color:#167A54;':''}">${inc?'+ ':''}${money(e.amount)}</td><td>${esc(e.method)}</td><td>${esc(e.approvedBy)}</td>
      <td class="cell-center">${admin && isDateLocked(e.date) ? '<span title="এই মাস লক করা">🔒</span>' : admin ? `<button class="icon-btn" title="সংশোধন" onclick="openExpenseForm('','${e.id}')">✏️</button><button class="icon-btn danger" title="মুছুন" onclick="deleteExpense('${e.id}')">🗑️</button>` : '<span class="muted-cell">—</span>'}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="8" class="empty-state">${CACHE.expenses.length ? 'কিছু পাওয়া যায়নি' : 'কোনো এন্ট্রি যোগ করা হয়নি'}</td></tr>`;
}
function expenseTotalsHtml(){
  const list = CACHE.expenses.filter(e => EXP_MONTH==='all' || mOf(e.date)===EXP_MONTH);
  const exp = list.filter(e=>e.kind!=='income').reduce((t,e)=>t+Number(e.amount||0),0);
  const inc = list.filter(e=>e.kind==='income').reduce((t,e)=>t+Number(e.amount||0),0);
  return `মোট খরচ: <b>${money(exp)}</b> · মোট আয় (কমিশন ইত্যাদি): <b>${money(inc)}</b>`;
}
function onExpenseSearch(){
  EXP_Q = document.getElementById('expSearch').value;
  EXP_MONTH = document.getElementById('expMonth').value;
  document.getElementById('expBody').innerHTML = expenseRowsHtml();
  document.getElementById('expTotals').innerHTML = expenseTotalsHtml();
}
function renderExpenses(){
  const admin = isAdmin();
  document.getElementById('pageContent').innerHTML = `
    ${flashHtml('expenses')}
    <div class="panel">
      <div class="panel-head"><h3>খরচ ও আয় খাতা</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-outline btn-sm" onclick="openExpenseForm('income')">+ কমিশন / অন্যান্য আয়</button>
          <button class="btn btn-accent btn-sm" onclick="openExpenseForm()">+ নতুন খরচ</button>
        </div>
      </div>
      <div class="toolbar">
        <select id="expMonth" onchange="onExpenseSearch()">${monthOptionsHtml(EXP_MONTH, true)}</select>
        <input type="search" id="expSearch" placeholder="🔍 ভাউচার নম্বর / ক্যাটাগরি / আইডি দিয়ে খুঁজুন" value="${esc(EXP_Q)}" oninput="onExpenseSearch()">
      </div>
      <p id="expTotals" style="font-size:13px;margin:0 0 10px;">${expenseTotalsHtml()}</p>
      <div class="table-wrap"><table><thead><tr>
        <th>আইডি</th><th>তারিখ</th><th>ক্যাটাগরি</th><th>ভাউচার নং</th><th>পরিমাণ</th><th>মাধ্যম</th><th>অনুমোদনকারী / উৎস</th><th>একশন</th>
      </tr></thead><tbody id="expBody">${expenseRowsHtml()}</tbody></table></div>
      <p style="font-size:12px;color:var(--text-muted);margin-top:8px;">কোম্পানির কাছ থেকে পাওয়া কমিশন "আয়" হিসেবে যোগ হয় এবং লাভ-ক্ষতির হিসাবে নিট লাভে যোগ হয়ে যায়। কমিশন যে ভাউচারে উল্লেখ আছে তার নম্বর "ভাউচার নং" ঘরে লিখে রাখুন।${admin ? '' : ' ভুল এন্ট্রি সংশোধন বা মোছা শুধু অ্যাডমিন করতে পারবেন।'}</p>
    </div>
    <div id="modalHolder"></div>
  `;
  scrollToHl();
}
function openExpenseForm(kind, id){
  if(id && !isAdmin()){ alert('এন্ট্রি সংশোধন শুধু অ্যাডমিন করতে পারবেন।'); return; }
  const e = id ? CACHE.expenses.find(x=>x.id===id) : null;
  if(e && !guardDate(e.date, 'সংশোধন')) return;
  const inc = e ? e.kind==='income' : kind==='income';
  EXP_EDIT_ID = id || ''; EXP_KIND = inc ? 'income' : '';
  let cats = inc ? INCOME_CATEGORIES : CACHE.settings.expenseCategories;
  if(e && e.category && !cats.includes(e.category)) cats = [...cats, e.category];
  const methods = ['Cash','bKash','Bank'];
  if(e && e.method && !methods.includes(e.method)) methods.push(e.method);
  openForm(`
    <div class="panel">
      <h3>${e ? (inc?'আয় এন্ট্রি সংশোধন':'খরচ এন্ট্রি সংশোধন')+' — '+e.id : (inc?'কমিশন / আয় এন্ট্রি':'নতুন খরচ এন্ট্রি')}</h3>
      <div class="form-grid">
        ${dateField('e_date', e?e.date:'')}
        <div class="form-field"><label>ক্যাটাগরি</label>
          <select id="e_cat">${cats.map(c=>`<option ${e&&e.category===c?'selected':''}>${esc(c)}</option>`).join('')}</select>
        </div>
        <div class="form-field"><label>${inc?'ভাউচার নম্বর — যে ভাউচারে এই কমিশন/আয় উল্লেখ আছে':'ভাউচার নম্বর (ঐচ্ছিক)'}</label>
          <input id="e_voucher" placeholder="যেমন: V-1024" value="${e?esc(e.voucherNo||''):''}"></div>
        <div class="form-field"><label>পরিমাণ (৳)</label><input id="e_amount" type="number" value="${e?e.amount:0}"></div>
        <div class="form-field"><label>${inc?'টাকা পাওয়ার মাধ্যম':'পেমেন্ট মাধ্যম'}</label>
          <select id="e_method">${methods.map(m=>`<option ${e&&e.method===m?'selected':''}>${esc(m)}</option>`).join('')}</select>
        </div>
        <div class="form-field"><label>${inc?'কোম্পানির নাম / বিবরণ':'অনুমোদনকারী'}</label><input id="e_approved" value="${e?esc(e.approvedBy||''):''}"></div>
      </div>
      <div style="margin-top:16px;display:flex;gap:10px;">
        <button class="btn btn-primary" onclick="saveExpense()">${e?'সংশোধন সংরক্ষণ করুন':'সংরক্ষণ করুন'}</button>
        <button class="btn btn-outline" onclick="closeForm(renderExpenses)">বাতিল</button>
      </div>
    </div>`);
}
function saveExpense(){
  const id = EXP_EDIT_ID;
  if(id && !isAdmin()){ alert('এন্ট্রি সংশোধন শুধু অ্যাডমিন করতে পারবেন।'); return; }
  const inc = EXP_KIND==='income';
  const amount = Number(document.getElementById('e_amount').value||0);
  const voucherNo = document.getElementById('e_voucher').value.trim();
  if(!(amount>0)){ alert('পরিমাণ সঠিকভাবে দিন'); return; }
  if(inc && !voucherNo && !confirm('ভাউচার নম্বর দেওয়া হয়নি। তবুও সংরক্ষণ করবেন?')) return;
  if(!guardDates([pickedDate('e_date'), id ? (CACHE.expenses.find(x=>x.id===id)||{}).date : ''], id ? 'সংশোধন' : 'এন্ট্রি')) return;
  const expenses = CACHE.expenses.slice();
  const data = {
    date: pickedDate('e_date'),
    category: document.getElementById('e_cat').value,
    voucherNo,
    amount,
    method: document.getElementById('e_method').value,
    approvedBy: document.getElementById('e_approved').value.trim()
  };
  let savedId = id;
  if(id){
    const idx = expenses.findIndex(x=>x.id===id);
    expenses[idx] = stampEdit({...expenses[idx], ...data});
  } else {
    data.id = genId('EXP-', expenses); savedId = data.id;
    if(inc) data.kind = 'income';
    expenses.push(data);
  }
  saveCollection('expenses', expenses);
  EXP_Q = ''; if(EXP_MONTH!=='all') EXP_MONTH = mOf(data.date) || EXP_MONTH;
  setFlash('expenses', `✅ ${inc?'আয়':'খরচ'} এন্ট্রি ${id?'সংশোধিত হয়েছে':'সংরক্ষিত হয়েছে'}${voucherNo?` — ভাউচার নং ${esc(voucherNo)}`:''}।`, savedId);
  renderExpenses();
  toTop();
}
function deleteExpense(id){
  if(!isAdmin()){ alert('এন্ট্রি মোছা শুধু অ্যাডমিন করতে পারবেন।'); return; }
  const exr = CACHE.expenses.find(x=>x.id===id);
  if(exr && !guardDate(exr.date, 'মুছে ফেলা')) return;
  if(!confirm('এই এন্ট্রিটি মুছে ফেলতে চান?')) return;
  saveCollection('expenses', CACHE.expenses.filter(e=>e.id!==id));
  renderExpenses();
}

/* ============================================================
   DUES — who owes us, and who we owe (admin + manager)
   ============================================================ */
function renderDues(){
  const orders = CACHE.orders.filter(o=>o.status!=='Cancelled');
  const purchases = CACHE.purchases;

  // group unpaid/partial orders by customer (phone if given, else name)
  const custMap = {};
  orders.forEach(o=>{
    const due = orderDue(o);
    if(due<=0) return;
    const key = (o.phone && o.phone.trim()) || o.customerName;
    if(!custMap[key]) custMap[key] = {name:o.customerName, phone:o.phone, due:0, orders:[]};
    custMap[key].due += due;
    custMap[key].orders.push(o.id);
  });
  const custRows = Object.values(custMap).sort((a,b)=>b.due-a.due);
  const totalCustDue = custRows.reduce((s,c)=>s+c.due,0);

  // group outstanding purchases by supplier
  const supMap = {};
  purchases.forEach(pu=>{
    const due = purchaseDue(pu);
    if(due<=0) return;
    if(!supMap[pu.supplier]) supMap[pu.supplier] = {name:pu.supplier, due:0, purchases:[]};
    supMap[pu.supplier].due += due;
    supMap[pu.supplier].purchases.push(pu.id);
  });
  const supRows = Object.values(supMap).sort((a,b)=>b.due-a.due);
  const totalSupDue = supRows.reduce((s,c)=>s+c.due,0);

  document.getElementById('pageContent').innerHTML = `
    <div class="grid grid-2">
      <div class="stat-card danger"><div class="label">মোট কাস্টমার বকেয়া (আমরা পাব)</div><div class="value">${money(totalCustDue)}</div></div>
      <div class="stat-card warn"><div class="label">মোট সরবরাহকারী বকেয়া (আমরা দেব)</div><div class="value">${money(totalSupDue)}</div></div>
    </div>

    <div class="panel">
      <h3>কাস্টমার বকেয়া — কে কত টাকা দেবে</h3>
      <div class="table-wrap"><table><thead><tr>
        <th>কাস্টমার</th><th>মোবাইল</th><th>বকেয়া অর্ডার</th><th>মোট বকেয়া</th>
      </tr></thead><tbody>
        ${custRows.map(c=>`
          <tr><td>${esc(c.name)}</td><td>${esc(c.phone)}</td><td>${c.orders.join(', ')}</td><td class="cell-num">${money(c.due)}</td></tr>
        `).join('') || `<tr><td colspan="4" class="empty-state">কোনো কাস্টমারের বকেয়া নেই 🎉</td></tr>`}
      </tbody></table></div>
    </div>

    <div class="panel">
      <h3>সরবরাহকারী বকেয়া — কাকে কত টাকা দিতে হবে</h3>
      <div class="table-wrap"><table><thead><tr>
        <th>সরবরাহকারী</th><th>বকেয়া ক্রয় এন্ট্রি</th><th>মোট বকেয়া</th>
      </tr></thead><tbody>
        ${supRows.map(s=>`
          <tr><td>${esc(s.name)}</td><td>${s.purchases.join(', ')}</td><td class="cell-num">${money(s.due)}</td></tr>
        `).join('') || `<tr><td colspan="3" class="empty-state">কোনো সরবরাহকারীর বকেয়া নেই 🎉</td></tr>`}
      </tbody></table></div>
      <p style="font-size:12px;color:var(--text-muted);margin-top:8px;">হিসাব অর্ডার/ক্রয় এন্ট্রির "পরিশোধের পরিমাণ" ফিল্ড থেকে বের করা হয় — কোনো অর্ডার/ক্রয় এডিট করে পেমেন্ট আপডেট করলে এই তালিকাও নিজে থেকেই হালনাগাদ হয়ে যাবে।</p>
    </div>
  `;
}

/* ============================================================
   RETURNS & ADJUSTMENTS — customer returns a product after the
   invoice was made. Every entry is logged (never a silent edit)
   so there's always an audit trail of what changed and why.
   ============================================================ */
function renderReturns(){
  const orders = CACHE.orders.filter(o=>o.status!=='Cancelled');
  const options = orders.slice().reverse().map(o=>`<option value="${o.id}">${o.id} — ${esc(o.customerName)} (${o.date})</option>`).join('');

  const historyRows = CACHE.returns.slice().reverse().map(r=>{
    const p = CACHE.products.find(x=>x.id===r.productId);
    return `<tr>
      <td>${r.date}</td><td>${r.orderId}</td><td>${esc(r.customerName)}</td><td>${esc(p?p.name:'—')}</td>
      <td class="cell-num">${(r.dq!=null&&r.du) ? r.dq+' '+r.du : fmtQty(r.qty, CACHE.products.find(x=>x.id===r.productId))}</td><td class="cell-num">${money(r.refundAmount)}</td><td>${esc(r.reason||'—')}</td>
    </tr>`;
  }).join('');

  document.getElementById('pageContent').innerHTML = `
    <div class="panel">
      <h3>নতুন রিটার্ন / সমন্বয় এন্ট্রি</h3>
      <p style="font-size:13px;color:var(--text-muted);">কাস্টমার কোনো পণ্য ফেরত দিতে চাইলে এখান থেকে এন্ট্রি করুন — অর্ডারের মোট বিল ও স্টক নিজে থেকেই হালনাগাদ হয়ে যাবে, এবং প্রতিটা এন্ট্রি নিচের হিস্ট্রিতে স্থায়ীভাবে জমা থাকবে (কেউ ডিলিট করতে পারবে না) — এতে কে কখন কী পরিমাণ ফেরত নিয়েছে তার পূর্ণ প্রমাণ থাকে।</p>
      <div class="form-field" style="max-width:420px;">
        <label>অর্ডার নির্বাচন করুন</label>
        <select id="ret_order" onchange="loadReturnOrder()">
          <option value="">— অর্ডার বাছাই করুন —</option>${options}
        </select>
      </div>
      <div id="returnFormHolder" style="margin-top:14px;"></div>
    </div>
    <div class="panel">
      <h3>রিটার্ন হিস্ট্রি</h3>
      <div class="table-wrap"><table><thead><tr>
        <th>তারিখ</th><th>অর্ডার</th><th>কাস্টমার</th><th>পণ্য</th><th>পরিমাণ</th><th>ফেরত টাকা</th><th>কারণ</th>
      </tr></thead><tbody>${historyRows || `<tr><td colspan="7" class="empty-state">কোনো রিটার্ন এন্ট্রি নেই</td></tr>`}</tbody></table></div>
    </div>
  `;
}

function loadReturnOrder(){
  const id = document.getElementById('ret_order').value;
  const holder = document.getElementById('returnFormHolder');
  if(!id){ holder.innerHTML=''; return; }
  const o = CACHE.orders.find(x=>x.id===id);
  const items = orderItems(o);
  if(!items.length){ holder.innerHTML = `<div class="empty-state">এই অর্ডারে কোনো পণ্য নেই</div>`; return; }
  const rows = items.map((it,idx)=>{
    const p = CACHE.products.find(x=>x.id===it.productId);
    return `<tr>
      <td>${esc(p?p.name:'—')}</td>
      <td class="cell-center">${fmtItem(it,p)}</td>
      <td class="cell-num">${money(it.unitPrice)}</td>
      <td class="cell-center"><input type="number" min="0" step="any" value="0" id="ret_qty_${idx}" style="width:80px;text-align:center;padding:5px;border:1px solid var(--border);border-radius:6px;">
        ${unitSelectHtml(p, (unitOptions(p).find(o=>o.label===it.du)||{key:'base'}).key, `id="ret_unit_${idx}"`)}</td>
    </tr>`;
  }).join('');
  holder.innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>পণ্য</th><th>অর্ডারকৃত পরিমাণ</th><th>একক মূল্য</th><th>কত ফেরত নেবেন</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div style="margin-top:12px;max-width:240px;">${dateField('ret_date')}</div>
    <div class="form-field" style="margin-top:12px;">
      <label>কারণ (ঐচ্ছিক)</label>
      <textarea id="ret_reason" rows="2" style="width:100%;padding:9px 11px;border:1px solid var(--border);border-radius:7px;background:var(--bg);"></textarea>
    </div>
    <button class="btn btn-primary" style="margin-top:12px;" onclick="submitReturn('${o.id}')">রিটার্ন সম্পন্ন করুন</button>
  `;
}

function submitReturn(orderId){
  const orders = CACHE.orders.slice();
  const products = CACHE.products.slice();
  const returns = CACHE.returns.slice();
  const idx = orders.findIndex(o=>o.id===orderId);
  const order = {...orders[idx]};
  const items = orderItems(order).map(it=>({...it}));
  const reason = document.getElementById('ret_reason').value.trim();
  if(!guardDates([order.date, pickedDate('ret_date')], 'রিটার্ন')) return;
  let anyReturned = false, overLimit = false;
  const newEntries = [];

  items.forEach((it, i)=>{
    const field = document.getElementById(`ret_qty_${i}`);
    const pRet = products.find(x=>x.id===it.productId);
    const unitSel = document.getElementById(`ret_unit_${i}`);
    const oRet = optByKey(pRet, unitSel ? unitSel.value : 'base');
    const typed = field ? Number(field.value||0) : 0;
    const retQty = r3(typed/oRet.factor);
    if(retQty > Number(it.qty) + 0.0005){ overLimit = true; return; }
    if(retQty>0){
      anyReturned = true;
      const refundAmount = retQty * Number(it.unitPrice);
      newEntries.push({
        id: genId('RET-', returns.concat(newEntries)),
        date: pickedDate('ret_date'), orderId: order.id, customerName: order.customerName,
        productId: it.productId, qty: retQty, refundAmount: Math.round(refundAmount*100)/100, reason,
        dq: r3(typed), du: oRet.label, restocked: order.status==='Delivered'
      });
      it.qty = r3(Number(it.qty) - retQty);
      syncDisp(it, products.find(x=>x.id===it.productId));
      if(order.status==='Delivered'){
        const pIdx = products.findIndex(p=>p.id===it.productId);
        if(pIdx>-1){ products[pIdx] = {...products[pIdx], stock: r3(Number(products[pIdx].stock)+retQty)}; }
      }
    }
  });

  if(overLimit){ alert('ফেরত নেওয়ার পরিমাণ অর্ডারের পরিমাণের চেয়ে বেশি হতে পারে না।'); return; }
  if(!anyReturned){ alert('অন্তত একটি পণ্যের রিটার্ন পরিমাণ দিন'); return; }

  const remainingItems = items.filter(it=>Number(it.qty)>0);
  order.items = remainingItems;
  order.total = remainingItems.reduce((s,it)=>s+lineAmt(it),0) + Number(order.deliveryCharge||0);
  delete order.productId; delete order.qty; delete order.unitPrice;

  orders[idx] = order;
  saveCollection('products', products);
  saveCollection('orders', orders);
  saveCollection('returns', returns.concat(newEntries));

  const paidSoFar = (order.paidAmount!=null) ? Number(order.paidAmount) : 0;
  if(paidSoFar > order.total){
    alert(`রিটার্ন সম্পন্ন হয়েছে। নতুন মোট বিল ৳${order.total}, কিন্তু কাস্টমার আগেই ৳${paidSoFar} পরিশোধ করেছেন — অতিরিক্ত ৳${paidSoFar-order.total} নগদ ফেরত দিতে হবে, অথবা পরবর্তী অর্ডারে সমন্বয় করুন।`);
  } else {
    alert('রিটার্ন সফলভাবে সম্পন্ন হয়েছে — অর্ডারের মোট বিল ও স্টক হালনাগাদ হয়েছে।');
  }
  renderReturns();
}

/* ============================================================
   DISCOUNT REGISTER — every order line sold below the product's
   standard price at the time of sale, so nothing gets buried.
   ============================================================ */
function renderDiscounts(){
  const orders = CACHE.orders.filter(o=>o.status!=='Cancelled');
  const products = CACHE.products;
  const rows = [];
  orders.forEach(o=>{
    orderItems(o).forEach(it=>{
      const std = Number(it.standardPrice!=null ? it.standardPrice : it.unitPrice);
      const actual = Number(it.unitPrice);
      if(std > actual){
        const p = products.find(x=>x.id===it.productId);
        rows.push({
          date:o.date, orderId:o.id, customerName:o.customerName,
          productName: p?p.name:'—', qty:it.qty, standardPrice:std, actual, lineDiscount:(std-actual)*Number(it.qty)
        });
      }
    });
  });
  rows.sort((a,b)=> (a.date<b.date?1:-1));
  const totalDiscount = rows.reduce((s,r)=>s+r.lineDiscount,0);

  document.getElementById('pageContent').innerHTML = `
    <div class="stat-card warn" style="max-width:320px;margin-bottom:16px;">
      <div class="label">এ পর্যন্ত মোট দেওয়া ছাড় (পণ্যভিত্তিক)</div>
      <div class="value">${money(totalDiscount)}</div>
    </div>
    <div class="panel">
      <h3>কোন কোন পণ্যে ছাড় দেওয়া হয়েছে</h3>
      <p style="font-size:12.5px;color:var(--text-muted);">অর্ডারের কার্টে কোনো পণ্যের "একক মূল্য" তার নির্ধারিত বিক্রয়মূল্যের চেয়ে কম বসালেই সেটা এখানে স্বয়ংক্রিয়ভাবে তালিকাভুক্ত হয়ে যায় — আলাদা করে কিছু লিখতে হয় না।</p>
      <div class="table-wrap"><table><thead><tr>
        <th>তারিখ</th><th>অর্ডার</th><th>কাস্টমার</th><th>পণ্য</th><th>পরিমাণ</th><th>নির্ধারিত মূল্য</th><th>বিক্রিত মূল্য</th><th>মোট ছাড়</th>
      </tr></thead><tbody>
        ${rows.map(r=>`
          <tr>
            <td>${r.date}</td><td>${r.orderId}</td><td>${esc(r.customerName)}</td><td>${esc(r.productName)}</td>
            <td class="cell-num">${r.qty}</td><td class="cell-num">${money(r.standardPrice)}</td><td class="cell-num">${money(r.actual)}</td>
            <td class="cell-num">${money(r.lineDiscount)}</td>
          </tr>`).join('') || `<tr><td colspan="8" class="empty-state">এখনো কোনো পণ্যে ছাড় দেওয়া হয়নি</td></tr>`}
      </tbody></table></div>
    </div>
  `;
}

/* ============================================================
   INVENTORY REPORT — this month's opening/purchased/sold/returned/
   closing stock per product, for month-end stock reconciliation.
   ============================================================ */
let INV_SHOW_HIDDEN = false;
function toggleInvHidden(chk){ INV_SHOW_HIDDEN = !!chk.checked; renderInventory(); }
function renderInventory(){
  if(!monthsList().includes(VIEW_MONTH)) VIEW_MONTH = curMonth();
  const month = VIEW_MONTH, d = monthData(month);
  const session = getSession();
  const canSeeValue = session.role==='admin';
  const isCur = month===curMonth();
  const rows = d.rows.filter(r => INV_SHOW_HIDDEN || !r[10]);
  const hiddenTotal = d.rows.filter(r => r[10]).length;
  document.getElementById('pageContent').innerHTML = `
    <div class="toolbar"><label style="font-size:13px;font-weight:700;">মাস:</label>
      <select onchange="onViewMonth(this)">${monthOptionsHtml(month, false)}</select></div>
    ${monthStatusHtml(month)}
    ${canSeeValue ? `<div class="grid grid-2" style="margin-bottom:16px;">
      <div class="stat-card"><div class="label">মাসের শুরুর স্টকের মূল্য (জের, ক্রয়মূল্যে)</div><div class="value">${money(d.openVal)}</div></div>
      <div class="stat-card"><div class="label">${isCur?'বর্তমান':'মাস শেষের'} স্টকের মূল্য (ক্রয়মূল্যে)</div><div class="value">${money(d.closeVal)}</div></div>
    </div>` : ''}
    <div class="panel">
      <div class="panel-head" style="flex-wrap:wrap;gap:8px;">
        <h3>মাসিক ইনভেন্টরি রিপোর্ট — ${monthLabel(month)}</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${(isCur || canSeeValue) ? `<button class="btn btn-accent btn-sm" onclick="printStockReport(false)">🖨️ স্টক রিপোর্ট প্রিন্ট (সব পণ্য)</button>
          <button class="btn btn-outline btn-sm" onclick="printStockReport(true)">🖨️ শুধু স্টকে আছে এমন পণ্য</button>` : ''}
        </div>
      </div>
      <p style="font-size:12.5px;color:var(--text-muted);">মাসের শুরুর স্টক = আগের মাসের শেষ স্টক (জের)। আগের মাসে পুরোনো তারিখে কোনো ক্রয়/বিক্রয় যোগ বা সংশোধন করলে পরের মাসের শুরুর স্টক নিজে থেকেই ঠিক হয়ে যায়। "সমন্বয়" = পণ্য তালিকা থেকে হাতে স্টক বদলানো/প্রারম্ভিক স্টক।</p>
      <div class="toolbar">
        <span class="muted-cell">রিপোর্টে দেখাচ্ছে ${rows.length}টি পণ্য${hiddenTotal && !INV_SHOW_HIDDEN ? ` · <b>${hiddenTotal}টি লুকানো পণ্য</b> বাদ` : ''}</span>
        ${hiddenTotal ? `<label style="display:flex;gap:6px;align-items:center;font-size:13px;"><input type="checkbox" ${INV_SHOW_HIDDEN?'checked':''} onchange="toggleInvHidden(this)"> লুকানো পণ্যও দেখান</label>` : ''}
      </div>
      <div class="table-wrap"><table><thead><tr>
        <th>পণ্য</th><th>মাসের শুরুর স্টক</th><th>+ক্রয়</th><th>−বিক্রয়</th><th>+রিটার্ন</th><th>±সমন্বয়</th><th>=${isCur?'বর্তমান':'শেষ'} স্টক</th>
        ${canSeeValue?'<th>স্টক মূল্য</th>':''}
      </tr></thead><tbody>
        ${rows.map(r=>`
          <tr>
            <td>${esc(r[1])}${r[10] ? ' <span class="badge badge-hidden">লুকানো</span>' : ''}</td>
            <td class="cell-num">${r[3]} ${esc(r[2])}</td>
            <td class="cell-num">${r[4]}</td>
            <td class="cell-num">${r[5]}</td>
            <td class="cell-num">${r[6]}</td>
            <td class="cell-num">${r[7]}</td>
            <td class="cell-num"><b>${r[8]} ${esc(r[2])}</b></td>
            ${canSeeValue?`<td class="cell-num">${money(r2(r[8]*r[9]))}</td>`:''}
          </tr>`).join('') || `<tr><td colspan="8" class="empty-state">কোনো পণ্য নেই</td></tr>`}
      </tbody></table></div>
    </div>
  `;
}

/* ============================================================
   SHAREHOLDERS — capital-weighted monthly dividend split.
   Each shareholder's invested balance grows as they contribute;
   the dividend pool is split in proportion to that balance.
   ============================================================ */
let SH_Q = '';
function shareholderTablesHtml(){
  const shareholders = CACHE.shareholders;
  const totalInvested = shareholders.reduce((s,sh)=>s+Number(sh.totalInvested||0),0);
  const q = SH_Q.trim().toLowerCase();
  const rows = shareholders.filter(sh=>!q || String(sh.name).toLowerCase().includes(q) || String(sh.id).toLowerCase().includes(q)).map(sh=>{
    const pct = totalInvested>0 ? (Number(sh.totalInvested)/totalInvested*100) : 0;
    return `<tr>
      <td>${esc(sh.name)}</td>
      <td class="cell-num">${money(sh.totalInvested)}</td>
      <td class="cell-num">${pct.toFixed(1)}%</td>
      <td class="cell-center">
        <button class="btn btn-outline btn-sm" onclick="openContributionForm('${sh.id}')">+ জমা যোগ করুন</button>
        <button class="icon-btn danger" onclick="deleteShareholder('${sh.id}')">🗑️</button>
      </td>
    </tr>`;
  }).join('');
  let contribs = CACHE.contributions.slice().reverse().filter(c=>{
    if(!q) return true;
    const sh = shareholders.find(s=>s.id===c.shareholderId);
    return String((sh&&sh.name)||'').toLowerCase().includes(q) || String(c.date||'').includes(q);
  });
  if(!q) contribs = contribs.slice(0,20);
  const contribRows = contribs.map(c=>{
    const sh = shareholders.find(s=>s.id===c.shareholderId);
    return `<tr><td>${c.date}</td><td>${esc(sh?sh.name:'—')}</td><td class="cell-num">${money(c.amount)}</td></tr>`;
  }).join('');
  return {
    rows: rows || `<tr><td colspan="4" class="empty-state">${shareholders.length?'কিছু পাওয়া যায়নি':'কোনো শেয়ারহোল্ডার যোগ করা হয়নি'}</td></tr>`,
    contribRows: contribRows || `<tr><td colspan="3" class="empty-state">${q?'কিছু পাওয়া যায়নি':'কোনো জমা এন্ট্রি নেই'}</td></tr>`
  };
}
function onShareholderSearch(){
  SH_Q = document.getElementById('shSearch').value;
  const t = shareholderTablesHtml();
  document.getElementById('shBody').innerHTML = t.rows;
  document.getElementById('shContribBody').innerHTML = t.contribRows;
  document.getElementById('shContribTitle').textContent = SH_Q.trim() ? 'জমার হিস্ট্রি (সার্চ ফলাফল)' : 'সাম্প্রতিক জমার হিস্ট্রি';
}
function renderShareholders(){
  const t = shareholderTablesHtml();
  document.getElementById('pageContent').innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>শেয়ারহোল্ডার তালিকা ও বিনিয়োগ</h3>
        <button class="btn btn-accent btn-sm" onclick="openShareholderForm()">+ নতুন শেয়ারহোল্ডার</button>
      </div>
      <div class="toolbar">
        <input type="search" id="shSearch" placeholder="🔍 শেয়ারহোল্ডারের নাম দিয়ে খুঁজুন" value="${esc(SH_Q)}" oninput="onShareholderSearch()">
      </div>
      <div class="table-wrap"><table><thead><tr>
        <th>নাম</th><th>মোট বিনিয়োগ</th><th>শেয়ারের হার</th><th>একশন</th>
      </tr></thead><tbody id="shBody">${t.rows}</tbody></table></div>
      <p style="font-size:12px;color:var(--text-muted);margin-top:10px;">"লাভ-ক্ষতি" পেইজে মোট শেয়ারহোল্ডার লভ্যাংশ এই অনুপাত অনুযায়ীই প্রতিটা শেয়ারহোল্ডারের মধ্যে ভাগ হয়ে দেখানো হবে।</p>
    </div>
    <div class="panel">
      <h3 id="shContribTitle">${SH_Q.trim() ? 'জমার হিস্ট্রি (সার্চ ফলাফল)' : 'সাম্প্রতিক জমার হিস্ট্রি'}</h3>
      <div class="table-wrap"><table><thead><tr><th>তারিখ</th><th>শেয়ারহোল্ডার</th><th>জমার পরিমাণ</th></tr></thead>
        <tbody id="shContribBody">${t.contribRows}</tbody></table></div>
    </div>
    <div id="modalHolder"></div>
  `;
}
function openShareholderForm(){
  openForm(`
    <div class="panel">
      <h3>নতুন শেয়ারহোল্ডার যোগ করুন</h3>
      <div class="form-grid">
        <div class="form-field"><label>নাম</label><input id="sh_name"></div>
        <div class="form-field"><label>শুরুর বিনিয়োগ (৳)</label><input id="sh_initial" type="number" value="0"></div>
      </div>
      <div style="margin-top:16px;display:flex;gap:10px;">
        <button class="btn btn-primary" onclick="saveShareholder()">সংরক্ষণ করুন</button>
        <button class="btn btn-outline" onclick="closeForm(renderShareholders)">বাতিল</button>
      </div>
    </div>`);
}
function saveShareholder(){
  const name = document.getElementById('sh_name').value.trim();
  if(!name){ alert('নাম দিন'); return; }
  const shareholders = CACHE.shareholders.slice();
  const initial = Number(document.getElementById('sh_initial').value||0);
  shareholders.push({ id: genId('SH-', shareholders), name, totalInvested: initial });
  saveCollection('shareholders', shareholders);
  renderShareholders(); toTop();
}
function deleteShareholder(id){
  const lockedC = CACHE.contributions.find(c => c.shareholderId===id && isDateLocked(c.date));
  if(lockedC){ alert(`🔒 এই শেয়ারহোল্ডারের জমা এন্ট্রি ${monthLabel(mOf(lockedC.date))} মাসে আছে, যা লক করা — মোছা যাবে না।`); return; }
  if(!confirm('এই শেয়ারহোল্ডারকে মুছে ফেলতে চান?')) return;
  saveCollection('shareholders', CACHE.shareholders.filter(s=>s.id!==id));
  renderShareholders();
}
function openContributionForm(shareholderId){
  const sh = CACHE.shareholders.find(s=>s.id===shareholderId);
  openForm(`
    <div class="panel">
      <h3>${esc(sh.name)} — নতুন শেয়ার ক্রয়/জমা যোগ করুন</h3>
      <div style="max-width:240px;margin-bottom:10px;">${dateField('c_date')}</div>
      <div class="form-field" style="max-width:220px;"><label>পরিমাণ (৳)</label><input id="c_amount" type="number" value="1000"></div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button class="btn btn-outline btn-sm" onclick="document.getElementById('c_amount').value=1000">৳১,০০০</button>
        <button class="btn btn-outline btn-sm" onclick="document.getElementById('c_amount').value=2000">৳২,০০০</button>
        <button class="btn btn-outline btn-sm" onclick="document.getElementById('c_amount').value=5000">৳৫,০০০</button>
      </div>
      <div style="margin-top:16px;display:flex;gap:10px;">
        <button class="btn btn-primary" onclick="saveContribution('${shareholderId}')">সংরক্ষণ করুন</button>
        <button class="btn btn-outline" onclick="closeForm(renderShareholders)">বাতিল</button>
      </div>
    </div>`);
}
function saveContribution(shareholderId){
  const amount = Number(document.getElementById('c_amount').value||0);
  if(amount<=0){ alert('সঠিক পরিমাণ দিন'); return; }
  if(!guardDate(pickedDate('c_date'), 'জমা এন্ট্রি')) return;
  const shareholders = CACHE.shareholders.slice();
  const idx = shareholders.findIndex(s=>s.id===shareholderId);
  shareholders[idx] = {...shareholders[idx], totalInvested: Number(shareholders[idx].totalInvested||0)+amount};
  const contributions = CACHE.contributions.slice();
  contributions.push({ id: genId('CON-', contributions), date: pickedDate('c_date'), shareholderId, amount });
  saveCollection('shareholders', shareholders);
  saveCollection('contributions', contributions);
  renderShareholders(); toTop();
}

/* ============================================================
   PROFIT & LOSS (admin only)
   ============================================================ */
function renderProfitLoss(){
  if(!monthsList().includes(VIEW_MONTH)) VIEW_MONTH = curMonth();
  const m = VIEW_MONTH, idx = moveIndex(), d = monthData(m, idx);
  const carry = carryForward(m, idx), carryEnd = r2(carry + d.net);
  document.getElementById('pageContent').innerHTML = `
    <div class="toolbar"><label style="font-size:13px;font-weight:700;">মাস:</label>
      <select onchange="onViewMonth(this)">${monthOptionsHtml(m, false)}</select></div>
    ${monthStatusHtml(m)}
    <div class="panel">
      <h3>আয়-ব্যয় বিবরণী — ${monthLabel(m)}</h3>
      <table>
        <tr><td>মোট বিক্রয় (ডেলিভারড অর্ডার)</td><td class="cell-num">${money(d.revenue)}</td></tr>
        <tr><td>বিক্রিত পণ্যের ক্রয়মূল্য (COGS)</td><td class="cell-num">${money(d.cogs)}</td></tr>
        <tr><td><b>গ্রস প্রফিট</b></td><td class="cell-num"><b>${money(d.gross)}</b></td></tr>
        <tr><td>কমিশন / অন্যান্য আয়</td><td class="cell-num">+ ${money(d.otherIncome)}</td></tr>
        <tr><td>মোট পরিচালন খরচ</td><td class="cell-num">− ${money(d.expenses)}</td></tr>
      </table>
      <div class="invoice-total-row"><span>নিট প্রফিট</span><span>${money(d.net)}</span></div>
    </div>
    <div class="panel">
      <h3>জের ও মাস শেষের অবস্থা</h3>
      <table>
        <tr><td>মাসের শুরুর স্টকের মূল্য (আগের মাস থেকে জের)</td><td class="cell-num">${money(d.openVal)}</td></tr>
        <tr><td>মাস শেষের স্টকের মূল্য</td><td class="cell-num">${money(d.closeVal)}</td></tr>
        <tr><td>আগের মাসগুলোর জমা নিট প্রফিট (জের)</td><td class="cell-num">${money(carry)}</td></tr>
        <tr><td>+ এই মাসের নিট প্রফিট</td><td class="cell-num">${money(d.net)}</td></tr>
        <tr><td>এই মাসে নতুন কাস্টমার বকেয়া</td><td class="cell-num">${money(d.custDueNew)}</td></tr>
        <tr><td>এই মাসে নতুন সরবরাহকারী বকেয়া</td><td class="cell-num">${money(d.supDueNew)}</td></tr>
      </table>
      <div class="invoice-total-row"><span>মাস শেষে মোট জমা নিট প্রফিট (পরের মাসে যাবে)</span><span>${money(carryEnd)}</span></div>
      <p style="font-size:12px;color:var(--text-muted);margin-top:8px;">জের পরের মাসে নিজে থেকেই যোগ হয়। আগের মাসে পুরোনো তারিখে কোনো এন্ট্রি দিলে পরের মাসের জের নিজে থেকেই ঠিক হয়ে যায়।</p>
    </div>
  `;
}

/* ============================================================
   INVOICE
   ============================================================ */
let INVOICE_PRESELECT = null;
function renderInvoice(preId){
  const sel = (typeof preId==='string' && preId) ? preId : (INVOICE_PRESELECT || '');
  INVOICE_PRESELECT = null;
  const orders = CACHE.orders;
  const options = orders.slice().reverse().map(o=>`<option value="${o.id}" ${o.id===sel?'selected':''}>${o.id} — ${esc(o.customerName)} (${o.date})</option>`).join('');
  document.getElementById('pageContent').innerHTML = `
    <div class="panel">
      <h3>ইনভয়েস তৈরি করুন</h3>
      <div class="form-field" style="max-width:420px;">
        <label>অর্ডার নির্বাচন করুন</label>
        <select id="inv_order" onchange="drawInvoice()">
          <option value="">— অর্ডার বাছাই করুন —</option>${options}
        </select>
      </div>
    </div>
    <div id="modalHolder"></div>
    <div id="invoiceHolder"></div>
  `;
  if(sel) drawInvoice();
}
function editInvoice(id){ openOrderForm(id, 'invoice'); }
function drawInvoice(){
  const id = document.getElementById('inv_order').value;
  const holder = document.getElementById('invoiceHolder');
  if(!id){ holder.innerHTML=''; return; }
  const o = CACHE.orders.find(x=>x.id===id);
  const items = orderItems(o);
  const itemRows = items.map(it=>{
    const p = CACHE.products.find(x=>x.id===it.productId);
    return `<tr>
      <td>${esc(p?p.name:'—')}</td>
      <td class="cell-num">${fmtItem(it, p)}</td><td class="cell-num">${money(it.unitPrice)}${p?.unit?`/${esc(p.unit)}`:''}</td><td class="cell-num">${money(lineAmt(it))}</td>
    </tr>`;
  }).join('');

  const invHtml = `
    <div class="invoice-box" id="invoiceBox">
      <div class="invoice-head">
        <div>
          <h3>Avera Mart</h3>
          <p class="tagline">প্রকৃতির ছোঁয়া, নিরাপদ আস্থা</p>
          <p style="font-size:11px;color:var(--text-muted);margin:2px 0 0;">${esc(CACHE.settings.businessAddress)}</p>
        </div>
        <img src="logo.jpg" alt="logo">
      </div>
      <div class="invoice-meta">
        <div>ইনভয়েস: ${o.id}<br>তারিখ: ${o.date}</div>
        <div style="text-align:left">${esc(o.customerName)}<br>${esc(o.phone)}<br>${esc(o.address)}</div>
      </div>
      <table>
        <thead><tr><th>পণ্য</th><th>পরিমাণ</th><th>একক মূল্য</th><th>মোট</th></tr></thead>
        <tbody>${itemRows}</tbody>
      </table>
      <table style="margin-top:8px;">
        <tr><td>ডেলিভারি চার্জ</td><td class="cell-num">${money(o.deliveryCharge)}</td></tr>
        ${o.discount>0 ? `<tr><td>ছাড় / ডিসকাউন্ট</td><td class="cell-num">− ${money(o.discount)}</td></tr>` : ''}
      </table>
      <div class="invoice-total-row"><span>সর্বমোট</span><span>${money(o.total)}</span></div>
      <p style="font-size:11.5px;color:var(--text-muted);margin-top:10px;">পেমেন্ট স্ট্যাটাস: ${PAY_BN[o.paymentStatus]||o.paymentStatus} — পরিশোধিত ${money(o.paidAmount!=null?o.paidAmount:(o.paymentStatus==='Paid'?o.total:0))}${orderDue(o)>0 ? `, বকেয়া ${money(orderDue(o))}` : ''}</p>
      ${o.paymentMethod ? `<p style="font-size:11.5px;color:var(--text-muted);margin-top:2px;">পেমেন্টের ধরন: ${esc((PAY_METHODS.find(m=>m.value===o.paymentMethod)||{}).label || o.paymentMethod)}${o.transactionRef ? ` — ট্রানজেকশন আইডি/অ্যাকাউন্ট: ${esc(o.transactionRef)}` : ''}</p>` : ''}
      <div class="invoice-sign">
        <div><span class="sign-line"></span>ক্রেতার স্বাক্ষর</div>
        <div><span class="sign-line"></span>বিক্রেতার স্বাক্ষর</div>
      </div>
    </div>
    <div class="invoice-actions">
      ${isAdmin() ? `<button class="btn btn-primary btn-sm" onclick="editInvoice('${o.id}')">✏️ ইনভয়েস সংশোধন করুন</button>` : ''}
      <button class="btn btn-outline btn-sm" onclick="printInvoice(false)">🖨️ সাধারণ প্রিন্ট</button>
      <button class="btn btn-outline btn-sm" onclick="printInvoice(true)">🧾 থার্মাল প্রিন্ট</button>
      <button class="btn btn-accent btn-sm" onclick="shareWhatsapp('${o.id}')">📲 হোয়াটসঅ্যাপে শেয়ার</button>
      <button class="btn btn-accent btn-sm" onclick="shareInvoiceImage()">🖼️ ছবি হিসেবে শেয়ার/ডাউনলোড</button>
    </div>
    <p id="imgShareStatus" style="text-align:center;font-size:12px;color:var(--text-muted);margin-top:8px;"></p>
    ${isAdmin() ? '' : `<p style="text-align:center;font-size:12px;color:var(--text-muted);">ইনভয়েসে ভুল থাকলে অ্যাডমিনকে জানান — সংশোধন শুধু অ্যাডমিন করতে পারেন।</p>`}
  `;
  holder.innerHTML = invHtml;
}
function printWhenReady(){
  const imgs = Array.from(document.querySelectorAll('#printArea img'));
  const waits = imgs.map(im => (im.complete && im.naturalWidth) ? Promise.resolve() : new Promise(r => { im.onload = r; im.onerror = r; }));
  const fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
  Promise.race([Promise.all([...waits, fontsReady]), new Promise(r => setTimeout(r, 3000))]).then(() => window.print());
}
function printInvoice(thermal){
  const box = document.getElementById('invoiceBox').outerHTML;
  document.getElementById('printArea').innerHTML = box;
  document.body.classList.toggle('thermal', !!thermal);
  printWhenReady();
}
function shareInvoiceImage(){
  const statusEl = document.getElementById('imgShareStatus');
  const box = document.getElementById('invoiceBox');
  if(typeof html2canvas === 'undefined'){
    statusEl.textContent = 'ছবি তৈরির লাইব্রেরি লোড হয়নি — ইন্টারনেট সংযোগ যাচাই করে পেইজ রিফ্রেশ করুন।';
    return;
  }
  statusEl.textContent = 'ছবি তৈরি হচ্ছে...';
  html2canvas(box, { scale: 2, backgroundColor: '#ffffff' }).then(canvas => {
    canvas.toBlob(async (blob) => {
      if(!blob){ statusEl.textContent = 'ছবি তৈরি করা যায়নি।'; return; }
      const fileName = `avera-mart-invoice-${document.getElementById('inv_order').value}.jpg`;
      const file = new File([blob], fileName, { type: 'image/jpeg' });
      if(navigator.canShare && navigator.canShare({ files: [file] })){
        try{
          await navigator.share({ files: [file], title: 'Avera Mart Invoice' });
          statusEl.textContent = '';
          return;
        }catch(err){ /* user cancelled or share failed — fall back to download below */ }
      }
      // Desktop or unsupported browser — just download the JPG so it can be attached anywhere manually
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      statusEl.textContent = 'ছবি ডাউনলোড হয়েছে — এখন যেকোনো অ্যাপ (WhatsApp, SMS, ইমেইল ইত্যাদি) দিয়ে সংযুক্ত করে পাঠাতে পারবেন।';
    }, 'image/jpeg', 0.95);
  });
}
function shareWhatsapp(orderId){
  const o = CACHE.orders.find(x=>x.id===orderId);
  const items = orderItems(o);
  const lines = items.map(it=>{
    const p = CACHE.products.find(x=>x.id===it.productId);
    return `${p?p.name:''} — ${fmtItem(it, p)} = ৳${lineAmt(it)}`;
  }).join('\n');
  const text = `Avera Mart ইনভয়েস ${o.id}\nকাস্টমার: ${o.customerName}\n${lines}\nসর্বমোট: ৳${o.total}\nধন্যবাদ প্রকৃতির ছোঁয়া, নিরাপদ আস্থা — Avera Mart থেকে কেনাকাটার জন্য।`;
  const phone = (o.phone||'').replace(/\D/g,'');
  const url = 'https://wa.me/' + (phone?phone:'') + '?text=' + encodeURIComponent(text);
  window.open(url, '_blank');
}

/* ============================================================
   SETTINGS (admin only)
   ============================================================ */
function renderSettings(){
  const settings = CACHE.settings;
  const users = CACHE.users;

  function categoryChips(list, removeFn){
    return list.map(c => `
      <span class="badge" style="background:#EEF1F6;color:var(--navy);display:inline-flex;align-items:center;gap:6px;margin:3px;">
        ${esc(c)} <button class="icon-btn danger" style="padding:0;font-size:12px;" onclick="${removeFn}('${esc(c).replace(/'/g,"\\'")}')">✕</button>
      </span>`).join('') || `<span class="muted-cell">কোনো ক্যাটাগরি নেই</span>`;
  }

  document.getElementById('pageContent').innerHTML = `
    <div class="grid grid-2">
      <div class="panel">
        <h3>প্রতিষ্ঠানের ঠিকানা</h3>
        <p style="font-size:12.5px;color:var(--text-muted);">ইনভয়েসের উপরে এই ঠিকানাটা দেখানো হয়।</p>
        <div class="form-field">
          <label>ঠিকানা</label>
          <textarea id="s_address" rows="2" style="padding:9px 11px;border:1px solid var(--border);border-radius:7px;background:var(--bg);">${esc(settings.businessAddress)}</textarea>
        </div>
        <button class="btn btn-primary btn-sm" style="margin-top:12px;" onclick="saveBusinessAddress()">সংরক্ষণ করুন</button>
      </div>
      <div class="panel">
        <h3>সার্ভার ব্যাকআপ (স্বয়ংক্রিয়)</h3>
        <p style="font-size:12.5px;color:var(--text-muted);">প্রতিদিন একবার সব ডেটার কপি সার্ভারের আলাদা জায়গায় জমা হয়। ৬০ দিনের দৈনিক কপি এবং প্রতি মাসের একটি কপি চিরকাল থাকে।</p>
        <p id="bkStatus" style="font-size:13px;">${bkStatusText()}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-primary btn-sm" onclick="runServerBackup(true)">☁️ এখনই ব্যাকআপ নিন</button>
          <button class="btn btn-outline btn-sm" onclick="loadServerBackups()">📂 ব্যাকআপ তালিকা / ফেরত আনুন</button>
        </div>
        <div id="bkList" style="margin-top:10px;"></div>
        <h3 style="margin-top:18px;">ডেটা ব্যবহার (প্রতিটি তথ্যের সীমা ১ MB)</h3>
        ${dataUsageHtml()}
      </div>
      <div class="panel">
        <h3>পিন পরিবর্তন করুন</h3>
        <div class="form-grid">
          <div class="form-field"><label>Admin PIN</label><input id="s_pin_admin" value="${users.admin.pin}"></div>
          <div class="form-field"><label>Manager PIN</label><input id="s_pin_manager" value="${users.manager.pin}"></div>
          <div class="form-field"><label>Delivery PIN</label><input id="s_pin_delivery" value="${users.delivery.pin}"></div>
        </div>
        <button class="btn btn-primary btn-sm" style="margin-top:12px;" onclick="savePins()">পিন সংরক্ষণ করুন</button>
      </div>
      <div class="panel">
        <h3>পণ্যের ক্যাটাগরি ম্যানেজ করুন</h3>
        <div style="margin-bottom:10px;">${categoryChips(settings.productCategories, 'removeProductCategory')}</div>
        <div style="display:flex;gap:8px;">
          <input id="s_new_pcat" placeholder="নতুন ক্যাটাগরির নাম" style="flex:1;padding:9px 11px;border:1px solid var(--border);border-radius:7px;background:var(--bg);">
          <button class="btn btn-accent btn-sm" onclick="addProductCategory()">+ যোগ করুন</button>
        </div>
      </div>
      <div class="panel">
        <h3>খরচের ক্যাটাগরি ম্যানেজ করুন</h3>
        <div style="margin-bottom:10px;">${categoryChips(settings.expenseCategories, 'removeExpenseCategory')}</div>
        <div style="display:flex;gap:8px;">
          <input id="s_new_ecat" placeholder="নতুন ক্যাটাগরির নাম" style="flex:1;padding:9px 11px;border:1px solid var(--border);border-radius:7px;background:var(--bg);">
          <button class="btn btn-accent btn-sm" onclick="addExpenseCategory()">+ যোগ করুন</button>
        </div>
      </div>
      <div class="panel">
        <h3>ডেটা ব্যাকআপ</h3>
        <p style="font-size:13px;color:var(--text-muted);">সব পণ্য, অর্ডার, ক্রয়, খরচ, বকেয়া ও রিটার্ন তথ্যের একটা কপি আপনার ফোন/কম্পিউটারে ডাউনলোড করে রাখুন — সপ্তাহে অন্তত একবার করার অভ্যাস রাখা ভালো।</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-primary btn-sm" onclick="downloadBackup()">📥 ব্যাকআপ ডাউনলোড করুন</button>
          <button class="btn btn-outline btn-sm" onclick="document.getElementById('restoreFileInput').click()">📤 ব্যাকআপ থেকে ডেটা ফিরিয়ে আনুন</button>
          <input type="file" id="restoreFileInput" accept=".json,application/json" class="hidden" onchange="restoreBackup(event)">
        </div>
        <p style="font-size:12px;color:var(--text-muted);margin-top:8px;">রিস্টোর করলে বর্তমান সব ডেটা ব্যাকআপ ফাইলের ডেটা দিয়ে প্রতিস্থাপিত হবে (পিন অপরিবর্তিত থাকবে)। রিস্টোরের আগে বর্তমান ডেটার একটা ব্যাকআপ নিজে থেকেই ডাউনলোড হয়ে যাবে।</p>
      </div>
    </div>
  `;
}
function downloadBackup(){
  const backup = {
    exportedAt: new Date().toISOString(),
    products: CACHE.products, orders: CACHE.orders, purchases: CACHE.purchases,
    expenses: CACHE.expenses, returns: CACHE.returns, shareholders: CACHE.shareholders,
    contributions: CACHE.contributions, closings: CACHE.closings, settings: CACHE.settings
  };
  try{ localStorage.setItem('AM_lastDownload', String(Date.now())); }catch(e){}
  const blob = new Blob([JSON.stringify(backup, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `averamart-backup-${todayStr()}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function saveBusinessAddress(){
  const settings = {...CACHE.settings};
  settings.businessAddress = document.getElementById('s_address').value.trim();
  saveSettings(settings);
  alert('সংরক্ষিত হয়েছে');
}
function saveDividend(){
  const settings = {...CACHE.settings};
  settings.dividendPercent = Number(document.getElementById('s_dividend').value||0);
  saveSettings(settings);
  alert('সংরক্ষিত হয়েছে');
}
function savePins(){
  const users = {
    admin:{pin: document.getElementById('s_pin_admin').value.trim()},
    manager:{pin: document.getElementById('s_pin_manager').value.trim()},
    delivery:{pin: document.getElementById('s_pin_delivery').value.trim()}
  };
  saveUsers(users);
  alert('পিন আপডেট হয়েছে');
}
function addProductCategory(){
  const input = document.getElementById('s_new_pcat');
  const name = input.value.trim();
  if(!name) return;
  const settings = {...CACHE.settings};
  if(settings.productCategories.includes(name)){ alert('এই ক্যাটাগরি আগে থেকেই আছে'); return; }
  settings.productCategories = [...settings.productCategories, name];
  saveSettings(settings);
  renderSettings();
}
function removeProductCategory(name){
  if(!confirm(`"${name}" ক্যাটাগরিটি মুছে ফেলতে চান?`)) return;
  const settings = {...CACHE.settings};
  settings.productCategories = settings.productCategories.filter(c=>c!==name);
  saveSettings(settings);
  renderSettings();
}
function addExpenseCategory(){
  const input = document.getElementById('s_new_ecat');
  const name = input.value.trim();
  if(!name) return;
  const settings = {...CACHE.settings};
  if(settings.expenseCategories.includes(name)){ alert('এই ক্যাটাগরি আগে থেকেই আছে'); return; }
  settings.expenseCategories = [...settings.expenseCategories, name];
  saveSettings(settings);
  renderSettings();
}
function removeExpenseCategory(name){
  if(!confirm(`"${name}" ক্যাটাগরিটি মুছে ফেলতে চান?`)) return;
  const settings = {...CACHE.settings};
  settings.expenseCategories = settings.expenseCategories.filter(c=>c!==name);
  saveSettings(settings);
  renderSettings();
}


/* ============================================================
   STOCK REPORT PRINT (for physical month-end stock counting)
   ============================================================ */
function printStockReport(onlyInStock){
  const isAdmin = getSession().role==='admin';
  const priceOf = p => Number(isAdmin ? p.cost : p.retail) || 0;   // manager never sees cost price
  const priceLabel = isAdmin ? 'ক্রয়মূল্য' : 'বিক্রয়মূল্য';
  const histMonth = (currentPage==='inventory' && VIEW_MONTH!==curMonth()) ? VIEW_MONTH : null;
  let srcProducts = CACHE.products;
  if(histMonth){
    srcProducts = monthData(histMonth).rows.filter(r=>!r[10]).map(r=>{ const lp = CACHE.products.find(x=>x.id===r[0]) || {};
      return {id:r[0], name:r[1], unit:r[2], stock:r[8], cost:r[9], retail:lp.retail||0, category:lp.category||'অন্যান্য', hidden:false}; });
  }
  const list = srcProducts.filter(p => !p.hidden && (!onlyInStock || Number(p.stock) > 0))
    .slice().sort((a,b) => String(a.category).localeCompare(String(b.category),'bn') || String(a.name).localeCompare(String(b.name),'bn'));
  if(!list.length){ alert('প্রিন্ট করার মতো কোনো পণ্য নেই।'); return; }
  let body = '', lastCat = null, n = 0, grand = 0, catSum = 0;
  const flushCat = () => { if(lastCat!==null) body += `<tr class="sp-sub"><td colspan="5" style="text-align:right;">${esc(lastCat||'অন্যান্য')} — উপমোট</td><td class="sp-num">${money(catSum)}</td><td></td><td></td></tr>`; catSum = 0; };
  list.forEach(p => {
    if(p.category !== lastCat){ flushCat(); lastCat = p.category; body += `<tr class="sp-cat"><td colspan="8">${esc(p.category||'অন্যান্য')}</td></tr>`; }
    n++;
    const value = Math.round(Number(p.stock||0) * priceOf(p) * 100) / 100;
    grand += value; catSum += value;
    body += `<tr><td>${n}</td><td>${esc(p.name)}</td><td>${esc(p.unit||'কেজি')}</td><td class="sp-num">${money(priceOf(p))}</td><td class="sp-num">${fmtStock(p.stock, p)}</td><td class="sp-num">${money(value)}</td><td class="sp-blank"></td><td class="sp-blank"></td></tr>`;
  });
  flushCat();
  const d = new Date();
  const dateStr = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  document.getElementById('printArea').innerHTML = `
    <div class="stock-print">
      <div class="sp-head">
        <img src="logo.jpg" alt="">
        <div><h3>Avera Mart — স্টক রিপোর্ট</h3>
        <div>${esc(CACHE.settings.businessAddress||'')}</div>
        <div>${histMonth ? 'মাস শেষের স্টক: '+monthLabel(histMonth) : 'তারিখ: '+dateStr} · ${onlyInStock?'শুধু স্টকে থাকা পণ্য':'সব চালু পণ্য'} · মোট ${list.length}টি পণ্য</div></div>
      </div>
      <table>
        <thead><tr><th>ক্র.</th><th>পণ্যের নাম</th><th>একক</th><th>${priceLabel}/একক</th><th>স্টক</th><th>মোট টাকা</th><th>ফিজিক্যাল গণনা</th><th>পার্থক্য</th></tr></thead>
        <tbody>${body}</tbody>
        <tfoot><tr class="sp-total"><td colspan="5" style="text-align:right;">সর্বমোট স্টকের মূল্য (${priceLabel}ে)</td><td class="sp-num">${money(grand)}</td><td colspan="2"></td></tr></tfoot>
      </table>
      <div class="sp-sign"><span>গণনাকারী: ____________</span><span>যাচাইকারী: ____________</span><span>অনুমোদন: ____________</span></div>
    </div>`;
  document.body.classList.remove('thermal');
  printWhenReady();
}

/* ============================================================
   RESTORE FROM BACKUP (.json made by downloadBackup)
   ============================================================ */
function restoreBackup(event){ FORCE_SAVE = true; setTimeout(()=>{ FORCE_SAVE = false; }, 90000); return restoreBackup_(event); }
function restoreBackup_(event){
  const file = event.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try{
      const data = JSON.parse(e.target.result);
      const labels = {products:'পণ্য', orders:'অর্ডার', purchases:'ক্রয়', expenses:'খরচ/আয়', returns:'রিটার্ন', shareholders:'শেয়ারহোল্ডার', contributions:'জমা', closings:'মাস ক্লোজিং'};
      const keys = Object.keys(labels).filter(k => Array.isArray(data[k]));
      if(!keys.length) throw new Error('not a backup');
      const summary = keys.map(k => `${labels[k]}: ${data[k].length}টি`).join(', ');
      if(!confirm(`ব্যাকআপ ফাইলে আছে — ${summary}\n\nবর্তমান সব ডেটা এই ফাইলের ডেটা দিয়ে প্রতিস্থাপিত হবে। এগিয়ে যাবেন?\n(এখনকার ডেটার একটা ব্যাকআপ আগে নিজে থেকেই ডাউনলোড হবে)`)){ event.target.value=''; return; }
      downloadBackup();
      keys.forEach(k => saveCollection(k, data[k]));
      if(data.settings && typeof data.settings === 'object') saveSettings({...CACHE.settings, ...data.settings});
      renderSettings();
      alert('✅ ডেটা সফলভাবে ফিরিয়ে আনা হয়েছে।');
    }catch(err){
      alert('এটা সঠিক ব্যাকআপ ফাইল নয়। "ব্যাকআপ ডাউনলোড করুন" বাটন থেকে নামানো .json ফাইল সিলেক্ট করুন।');
    }
    event.target.value = '';
  };
  reader.readAsText(file);
}


/* ============================================================
   INSTALL AS APP (PWA)
   ============================================================ */
let DEFERRED_INSTALL = null;
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
function setInstallButtons(show){
  ['installBtnLogin','installBtnSide'].forEach(id => { const b = document.getElementById(id); if(b) b.classList.toggle('hidden', !show); });
}
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  DEFERRED_INSTALL = e;
  if(!isStandalone()) setInstallButtons(true);
});
window.addEventListener('appinstalled', () => { DEFERRED_INSTALL = null; setInstallButtons(false); });
async function installApp(){
  if(!DEFERRED_INSTALL){ alert('ব্রাউজারের মেনু (⋮) থেকে "Install app" বা "Add to Home screen" বেছে নিন।'); return; }
  DEFERRED_INSTALL.prompt();
  await DEFERRED_INSTALL.userChoice;
  DEFERRED_INSTALL = null;
  setInstallButtons(false);
}
document.addEventListener('DOMContentLoaded', () => {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if(isIOS && !isStandalone()){ const h = document.getElementById('iosHint'); if(h) h.classList.remove('hidden'); }
});


/* ============================================================
   APP VERSION / LAST UPDATED
   ============================================================ */
const APP_VERSION = '৩.১';
const APP_UPDATED_FALLBACK = '2026-10-01T20:00:00+06:00';
function fmtUpdated(d){
  try{
    return new Intl.DateTimeFormat('bn-BD', {timeZone:'Asia/Dhaka', day:'numeric', month:'long', year:'numeric', hour:'numeric', minute:'2-digit', hour12:true}).format(d);
  }catch(e){ return d.toLocaleString(); }
}
async function showAppVersion(){
  let when = new Date(APP_UPDATED_FALLBACK);
  try{
    const res = await fetch('app.js', {method:'HEAD', cache:'no-store'});
    const lm = res.headers.get('Last-Modified');
    if(lm && !isNaN(new Date(lm))) when = new Date(lm);   // real publish time of the deployed file
  }catch(e){ /* offline: show the built-in date */ }
  const text = `সংস্করণ ${APP_VERSION} · সর্বশেষ আপডেট: ${fmtUpdated(when)}`;
  ['appVersionLogin','appVersionSide'].forEach(id => { const el = document.getElementById(id); if(el) el.textContent = text; });
}
async function forceRefreshApp(){
  if(!confirm('অ্যাপের সর্বশেষ সংস্করণ লোড করা হবে। চালিয়ে যাবেন?')) return;
  try{
    if('serviceWorker' in navigator){ const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r=>r.unregister())); }
    if(window.caches){ const keys = await caches.keys(); await Promise.all(keys.map(k=>caches.delete(k))); }
  }catch(e){}
  location.reload();
}
document.addEventListener('DOMContentLoaded', showAppVersion);
