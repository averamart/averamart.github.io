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
  settings: {
    dividendPercent: 50,
    productCategories: ['খাদ্যশস্য','ডাল','তেল','মসলা','অর্গানিক আইটেম','অন্যান্য'],
    expenseCategories: ['দোকান ভাড়া','পরিবহন ও কুরিয়ার','প্যাকেজিং','বেতন','বিদ্যুৎ বিল','অন্যান্য'],
    businessAddress: 'রাজশাহী, বাংলাদেশ'
  },
  users: { admin:{pin:'1234'}, manager:{pin:'2222'}, delivery:{pin:'3333'} }
};
const LOADED = { products:false, orders:false, purchases:false, expenses:false, returns:false, shareholders:false, contributions:false, settings:false, users:false };

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

function attachListeners(){
  docRef('products').onSnapshot(snap => {
    if(snap.exists){ CACHE.products = snap.data().items || []; }
    else { docRef('products').set({items: DEFAULT_PRODUCTS}); CACHE.products = DEFAULT_PRODUCTS; }
    LOADED.products = true; onCloudUpdate();
  });
  docRef('orders').onSnapshot(snap => {
    if(snap.exists){ CACHE.orders = snap.data().items || []; }
    else { docRef('orders').set({items: []}); CACHE.orders = []; }
    LOADED.orders = true; onCloudUpdate();
  });
  docRef('purchases').onSnapshot(snap => {
    if(snap.exists){ CACHE.purchases = snap.data().items || []; }
    else { docRef('purchases').set({items: []}); CACHE.purchases = []; }
    LOADED.purchases = true; onCloudUpdate();
  });
  docRef('expenses').onSnapshot(snap => {
    if(snap.exists){ CACHE.expenses = snap.data().items || []; }
    else { docRef('expenses').set({items: []}); CACHE.expenses = []; }
    LOADED.expenses = true; onCloudUpdate();
  });
  docRef('returns').onSnapshot(snap => {
    if(snap.exists){ CACHE.returns = snap.data().items || []; }
    else { docRef('returns').set({items: []}); CACHE.returns = []; }
    LOADED.returns = true; onCloudUpdate();
  });
  docRef('shareholders').onSnapshot(snap => {
    if(snap.exists){ CACHE.shareholders = snap.data().items || []; }
    else { docRef('shareholders').set({items: []}); CACHE.shareholders = []; }
    LOADED.shareholders = true; onCloudUpdate();
  });
  docRef('contributions').onSnapshot(snap => {
    if(snap.exists){ CACHE.contributions = snap.data().items || []; }
    else { docRef('contributions').set({items: []}); CACHE.contributions = []; }
    LOADED.contributions = true; onCloudUpdate();
  });
  docRef('settings').onSnapshot(snap => {
    if(snap.exists){
      const data = snap.data();
      // older deployments may not have the category lists yet — merge in the defaults once
      const merged = {
        dividendPercent: data.dividendPercent ?? CACHE.settings.dividendPercent,
        productCategories: data.productCategories && data.productCategories.length ? data.productCategories : CACHE.settings.productCategories,
        expenseCategories: data.expenseCategories && data.expenseCategories.length ? data.expenseCategories : CACHE.settings.expenseCategories,
        businessAddress: data.businessAddress || CACHE.settings.businessAddress
      };
      CACHE.settings = merged;
      if(!data.productCategories || !data.expenseCategories || !data.businessAddress) docRef('settings').set(merged);
    } else { docRef('settings').set(CACHE.settings); }
    LOADED.settings = true; onCloudUpdate();
  });
  docRef('users').onSnapshot(snap => {
    if(snap.exists){ CACHE.users = snap.data(); }
    else { docRef('users').set(CACHE.users); }
    LOADED.users = true; onCloudUpdate();
  });
}

function allLoaded(){ return Object.values(LOADED).every(Boolean); }

function onCloudUpdate(){
  if(!allLoaded()) return;
  const loginScreenVisible = !document.getElementById('loginScreen').classList.contains('hidden');
  if(loginScreenVisible){
    document.getElementById('loginStatus').textContent = '';
    document.getElementById('loginFormWrap').classList.remove('hidden');
  } else {
    // live re-render current page so every device sees updates instantly
    const renderers = {
      dashboard: renderDashboard, products: renderProducts, orders: renderOrders,
      purchases: renderPurchases, expenses: renderExpenses, dues: renderDues, returns: renderReturns, discounts: renderDiscounts, inventory: renderInventory, shareholders: renderShareholders, profitloss: renderProfitLoss,
      invoice: renderInvoice, settings: renderSettings
    };
    (renderers[currentPage] || renderDashboard)();
  }
}

/* ---------------- Firestore write helpers ---------------- */
function saveCollection(name, arr){ CACHE[name] = arr; docRef(name).set({items: arr}); }
function saveSettings(obj){ CACHE.settings = obj; docRef('settings').set(obj); }
function saveUsers(obj){ CACHE.users = obj; docRef('users').set(obj); }

/* ---------------- Helpers ---------------- */
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
  if(Number(p.packSize)>0) return {label: p.packLabel || 'গ্রাম', factor: Number(p.packSize), pack:true};
  const f = UNIT_FAMILY[p.unit];
  return f ? {...f} : null;
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
  const info = subInfo(p);
  it.dq = (info && it.du===info.label) ? r3(it.qty*info.factor) : r3(it.qty);
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
  {key:'shareholders', label:'শেয়ারহোল্ডার', icon:'💼', roles:['admin']},
  {key:'profitloss', label:'লাভ-ক্ষতি', icon:'📊', roles:['admin']},
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
  renderNav();
  document.querySelector('.sidebar').classList.remove('open');
  document.getElementById('sidebarBackdrop').classList.remove('show');
  const titles = Object.fromEntries(NAV_ITEMS.map(i=>[i.key,i.label]));
  document.getElementById('pageTitle').textContent = titles[page] || '';
  const renderers = {
    dashboard: renderDashboard, products: renderProducts, orders: renderOrders,
    purchases: renderPurchases, expenses: renderExpenses, dues: renderDues, returns: renderReturns, discounts: renderDiscounts, inventory: renderInventory, shareholders: renderShareholders, profitloss: renderProfitLoss,
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

  let cards = `
    <div class="stat-card accent"><div class="label">এই মাসের বিক্রয় (ডেলিভারড)</div><div class="value">${money(totalSalesMonth)}</div></div>
    <div class="stat-card warn"><div class="label">এই মাসের খরচ</div><div class="value">${money(monthExpenses)}</div></div>
    <div class="stat-card ${lowStock.length?'danger':''}"><div class="label">কম স্টকের পণ্য</div><div class="value">${lowStock.length} টি</div></div>
    <div class="stat-card"><div class="label">পেন্ডিং/প্রসেসিং অর্ডার</div><div class="value">${pending.length} টি</div></div>
  `;
  if(session.role==='admin'){
    cards = `<div class="stat-card"><div class="label">এই মাসের নিট লাভ</div><div class="value">${money(netProfit)}</div></div>` + cards;
  }

  let html = `<div class="grid grid-4">${cards}</div>`;

  if(lowStock.length){
    html += `<div class="alert-strip">⚠️ কম স্টকে থাকা পণ্য: ${lowStock.map(p=>esc(p.name)).join('، ')}</div>`;
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
function renderProducts(){
  const session = getSession();
  const isAdmin = session.role==='admin';
  const products = CACHE.products;

  let rows = products.map(p => `
    <tr style="${p.hidden?'opacity:.55;':''}">
      <td>${p.id}</td>
      <td>${esc(p.name)}${p.hidden ? ' <span class="badge badge-cancelled">লুকানো</span>' : ''}${p.priceTiers ? `<br><span class="muted-cell">${esc(p.priceTiers)}</span>` : ''}</td>
      <td>${esc(p.category)}</td>
      <td>${esc(p.unit||'কেজি')}</td>
      ${isAdmin ? `<td class="cell-num">${money(p.cost)}</td>` : ''}
      <td class="cell-num">${money(p.retail)}</td>
      <td>${fmtStock(p.stock, p)} ${Number(p.stock)<=Number(p.minStock) ? '<span class="badge badge-low">লো স্টক</span>' : ''}</td>
      <td class="cell-center">
        <button class="icon-btn" title="${p.hidden?'আবার চালু করুন':'লুকিয়ে রাখুন'}" onclick="toggleProductHidden('${p.id}')">${p.hidden?'🙈':'👁️'}</button>
        <button class="icon-btn" onclick="openProductForm('${p.id}')">✏️</button>
        ${isAdmin ? `<button class="icon-btn danger" onclick="deleteProduct('${p.id}')">🗑️</button>` : ''}
      </td>
    </tr>`).join('');

  document.getElementById('pageContent').innerHTML = `
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
      <div class="table-wrap"><table><thead><tr>
        <th>আইডি</th><th>পণ্যের নাম</th><th>ক্যাটাগরি</th><th>একক</th>
        ${isAdmin?'<th>ক্রয়মূল্য</th>':''}
        <th>বিক্রয়মূল্য</th><th>স্টক</th><th>একশন</th>
      </tr></thead><tbody>${rows || `<tr><td colspan="8" class="empty-state">কোনো পণ্য যোগ করা হয়নি</td></tr>`}</tbody></table></div>
    </div>
    <div id="modalHolder"></div>
  `;
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
          if(updateStock && stock!==null) ch.stock = Number(stock);
          if(active!==null) ch.hidden = isNo(active);
          products[idx] = {...old, ...ch};
          updated++;
        } else if(name){
          products.push({
            id: genId('P', products), name,
            category: cat ? String(cat).trim() : 'অন্যান্য',
            unit: unit ? String(unit).trim() : 'কেজি',
            cost: Number(cost||0), retail: Number(retail||0),
            stock: Number(stock||0), minStock: Number(min ?? 5),
            hidden: active!==null ? isNo(active) : false
          });
          added++;
        } else { skipped++; }
      });

      if(added===0 && updated===0){ alert('ফাইলে কোনো বৈধ পণ্যের সারি পাওয়া যায়নি। কলামের নাম ঠিক আছে কিনা যাচাই করুন (ডেমো বা এক্সপোর্ট করা ফাইলের ফরম্যাট অনুযায়ী)।'); event.target.value=''; return; }
      if(newCategories.length){ settings.productCategories = [...settings.productCategories, ...newCategories]; }
      saveCollection('products', products);
      if(newCategories.length) saveSettings(settings);
      renderProducts();
      alert(`✅ ${updated}টি পণ্য আপডেট এবং ${added}টি নতুন পণ্য যোগ হয়েছে।${skipped?` (${skipped}টি সারি বাদ গেছে)`:''}`);
    }catch(err){
      alert('ফাইলটি পড়া যায়নি। এটা ঠিক .xlsx ফরম্যাটের ফাইল কিনা এবং কলাম কাঠামো ঠিক আছে কিনা যাচাই করুন।');
    }
    event.target.value = '';
  };
  reader.readAsArrayBuffer(file);
}
function toggleProductHidden(id){
  const products = CACHE.products.map(p => p.id===id ? {...p, hidden: !p.hidden} : p);
  saveCollection('products', products);
  renderProducts();
}

function openProductForm(id){
  const products = CACHE.products;
  const p = id ? products.find(x=>x.id===id) : null;
  const isAdmin = getSession().role==='admin';
  const UNIT_OPTIONS = ['কেজি','গ্রাম','লিটার','মিলিলিটার','পিস','ডজন','হালি','প্যাকেট','বস্তা'];
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
        <div class="form-field"><label>পরিমাণ/একক — মসলা, চাল, ডাল ইত্যাদির জন্য "কেজি" দিন, দামও প্রতি কেজির দিন</label>
          <select id="f_unit">
            ${UNIT_OPTIONS.map(u=>`<option ${(p&&p.unit===u)||(!p&&u==='কেজি')?'selected':''}>${u}</option>`).join('')}
          </select>
        </div>
        ${isAdmin?`<div class="form-field"><label>ক্রয়মূল্য (৳) — এই এককে</label><input id="f_cost" type="number" value="${p?p.cost:''}"></div>`:''}
        <div class="form-field"><label>বিক্রয়মূল্য (৳) — প্রতি এককে</label><input id="f_retail" type="number" value="${p?p.retail:''}"></div>
        <div class="form-field"><label>বর্তমান স্টক (এককে)</label><input id="f_stock" type="number" value="${p?p.stock:0}"></div>
        <div class="form-field"><label>ন্যূনতম স্টক সতর্কতা</label><input id="f_min" type="number" value="${p?p.minStock:5}"></div>
        <div class="form-field"><label>বিক্রির জন্য চালু?</label>
          <label style="display:flex;gap:8px;align-items:center;font-weight:400;"><input id="f_active" type="checkbox" ${p&&p.hidden?'':'checked'}> চালু (অর্ডারে দেখাবে)</label>
          <span class="muted-cell" style="font-size:11.5px;">এখনো কেনা হয়নি এমন পণ্যের টিক তুলে দিন — অর্ডারের সার্চে, লো-স্টক সতর্কতায় ও ইনভেন্টরি রিপোর্টে আসবে না। ক্রয় এন্ট্রি দিলে নিজে থেকেই চালু হয়ে যাবে।</span>
        </div>
      </div>

      <div style="margin-top:16px;display:flex;gap:10px;">
        <button class="btn btn-primary" onclick="saveProduct('${p?p.id:''}')">সংরক্ষণ করুন</button>
        <button class="btn btn-outline" onclick="renderProducts()">বাতিল</button>
      </div>
    </div>`;
  document.getElementById('modalHolder').innerHTML = html;
}

function saveProduct(id){
  const products = CACHE.products.slice();
  const isAdmin = getSession().role==='admin';
  const name = document.getElementById('f_name').value.trim();
  if(!name){ alert('পণ্যের নাম দিন'); return; }
  const data = {
    name,
    category: document.getElementById('f_cat').value,
    cost: isAdmin ? Number(document.getElementById('f_cost').value||0) : (products.find(p=>p.id===id)?.cost || 0),
    unit: document.getElementById('f_unit').value.trim() || 'কেজি',
    retail: Number(document.getElementById('f_retail').value||0),
    stock: Number(document.getElementById('f_stock').value||0),
    minStock: Number(document.getElementById('f_min').value||0),
    hidden: !document.getElementById('f_active').checked
  };
  if(id){
    const idx = products.findIndex(p=>p.id===id);
    products[idx] = {...products[idx], ...data};
  } else {
    data.id = genId('P', products);
    products.push(data);
  }
  saveCollection('products', products);
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
function renderOrders(){
  const session = getSession();
  const orders = CACHE.orders;
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
      <td>${o.id}</td><td>${o.date}</td>
      <td>${esc(o.customerName)}<br><span class="muted-cell">${esc(o.phone)}</span></td>
      <td>${itemsSummary(o)}</td>
      ${canSeeMoney ? `<td class="cell-num">${money(o.total)}</td>` : ''}
      <td class="cell-center">
        <select onchange="updateOrderStatus('${o.id}', this.value)">
          ${['Pending','Processing','Delivered','Cancelled'].map(s=>`<option value="${s}" ${o.status===s?'selected':''}>${STATUS_BN[s]}</option>`).join('')}
        </select>
      </td>
      ${canSeeMoney ? `<td class="cell-center"><span class="badge ${PAY_BADGE[o.paymentStatus]}">${PAY_BN[o.paymentStatus]}</span></td>` : ''}
      ${!isDelivery ? `<td class="cell-center"><button class="icon-btn" onclick="openOrderForm('${o.id}')">✏️</button><button class="icon-btn danger" onclick="deleteOrder('${o.id}')">🗑️</button></td>` : ''}
    </tr>`).join('');

  document.getElementById('pageContent').innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h3>অর্ডার ও সেলস</h3>
        ${!isDelivery ? `<button class="btn btn-accent btn-sm" onclick="openOrderForm()">+ নতুন অর্ডার</button>` : ''}
      </div>
      <div class="table-wrap"><table><thead><tr>
        <th>আইডি</th><th>তারিখ</th><th>কাস্টমার</th><th>পণ্য</th>
        ${canSeeMoney?'<th>মোট মূল্য</th>':''}
        <th>স্ট্যাটাস</th>
        ${canSeeMoney?'<th>পেমেন্ট</th>':''}
        ${!isDelivery?'<th>একশন</th>':''}
      </tr></thead><tbody>${rows || `<tr><td colspan="8" class="empty-state">কোনো অর্ডার নেই</td></tr>`}</tbody></table></div>
    </div>
    <div id="modalHolder"></div>
  `;
}

function updateOrderStatus(id, newStatus){
  const orders = CACHE.orders.slice();
  const products = CACHE.products.slice();
  const idx = orders.findIndex(o=>o.id===id);
  const order = {...orders[idx]};
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

function openOrderForm(id){
  const orders = CACHE.orders;
  const o = id ? orders.find(x=>x.id===id) : null;
  ORDER_CART = o ? orderItems(o).map(it=>{
    const p = CACHE.products.find(x=>x.id===it.productId), info = subInfo(p);
    return {...it, sub: !!(info && it.du===info.label)};
  }) : [];

  const html = `
    <div class="panel">
      <h3>${o?'অর্ডার সম্পাদনা':'নতুন অর্ডার'}</h3>
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
        <button class="btn btn-outline" onclick="renderOrders()">বাতিল</button>
      </div>
    </div>`;
  document.getElementById('modalHolder').innerHTML = html;
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
    const f = (subInfo(CACHE.products.find(x=>x.id===productId))||{factor:1000}).factor;
    it.qty = Math.max(0.001, it.sub ? v/f : v) || 1;
  }
  renderCart();
}
function setCartUnitMode(productId, sub){
  const it = ORDER_CART.find(x=>x.productId===productId);
  if(it){ it.sub = !!sub; }
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
        <td class="cell-center"><input type="number" min="0.001" step="any" value="${it.sub ? r3(it.qty*(subInfo(p)||{factor:1000}).factor) : r3(it.qty)}" style="width:75px;text-align:center;padding:5px;border:1px solid var(--border);border-radius:6px;" onchange="updateCartQty('${it.productId}', this.value)">
          ${subInfo(p) ? `<select onchange="setCartUnitMode('${it.productId}', this.value==='sub')" style="padding:4px;border:1px solid var(--border);border-radius:6px;"><option value="base" ${it.sub?'':'selected'}>${esc(p?.unit||'কেজি')}</option><option value="sub" ${it.sub?'selected':''}>${subInfo(p).label}</option></select>` : `<span class="muted-cell">${esc(p?.unit||'কেজি')}</span>`}</td>
        <td class="cell-center"><input type="number" min="0" value="${it.unitPrice}" style="width:80px;text-align:center;padding:5px;border:1px solid var(--border);border-radius:6px;" onchange="updateCartPrice('${it.productId}', this.value)"></td>
        <td class="cell-num">${money(lineTotal)}<br><span class="muted-cell">${it.sub&&subInfo(p) ? r3(it.qty*subInfo(p).factor)+' '+subInfo(p).label : r3(it.qty)+' '+esc(p?.unit||'কেজি')} × ${money(it.unitPrice)}/${esc(p?.unit||'কেজি')}</span></td>
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
      const info = subInfo(p);
      const useSub = !!(it.sub && info);
      return {productId:it.productId, qty:Number(it.qty), unitPrice:Number(it.unitPrice), standardPrice:Number(it.standardPrice!=null?it.standardPrice:it.unitPrice),
        dq: useSub ? r3(Number(it.qty)*info.factor) : r3(Number(it.qty)), du: useSub ? info.label : ((p&&p.unit)||'কেজি')};
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
  if(id){
    const idx = orders.findIndex(o=>o.id===id);
    // drop legacy single-item fields so the order fully switches to the items[] shape
    const prev = {...orders[idx]};
    delete prev.productId; delete prev.qty; delete prev.unitPrice;
    orders[idx] = {...prev, ...data};
  } else {
    data.id = genId('ORD-', orders);
    data.status = 'Pending';
    orders.push(data);
  }
  saveCollection('orders', orders);
  renderOrders();
}
function deleteOrder(id){
  if(!confirm('এই অর্ডারটি মুছে ফেলতে চান?')) return;
  saveCollection('orders', CACHE.orders.filter(o=>o.id!==id));
  renderOrders();
}

/* ============================================================
   PURCHASES
   ============================================================ */
function renderPurchases(){
  const purchases = CACHE.purchases;
  const products = CACHE.products;
  let rows = purchases.slice().reverse().map(pu => {
    const freeQty = Number(pu.freeQty||0);
    const avgUnitCost = pu.qty>0 ? pu.totalCost/pu.qty : 0;
    const prod = products.find(p=>p.id===pu.productId);
    const unit = esc(prod?.unit || 'কেজি');
    return `
    <tr>
      <td>${pu.id}</td><td>${pu.date}</td><td>${esc(pu.supplier)}</td>
      <td>${esc(prod?prod.name:'—')}</td>
      <td class="cell-num">${pu.qty} ${unit}${freeQty>0 ? ` <span class="badge" style="background:#DCF3E7;color:#167A54;">${freeQty} ফ্রি</span>` : ''}</td>
      <td class="cell-num">${money(pu.totalCost)}</td>
      <td class="cell-num muted-cell">${money(avgUnitCost)}/${unit}</td>
      <td class="cell-center"><span class="badge ${pu.paymentStatus==='Paid'?'badge-paid':'badge-due'}">${pu.paymentStatus==='Paid'?'পরিশোধিত':'বকেয়া'}</span></td>
      <td class="cell-center"><button class="icon-btn danger" onclick="deletePurchase('${pu.id}')">🗑️</button></td>
    </tr>`;
  }).join('');

  document.getElementById('pageContent').innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>ক্রয় খাতা (সোর্সিং)</h3>
        <button class="btn btn-accent btn-sm" onclick="openPurchaseForm()">+ নতুন ক্রয়</button>
      </div>
      <div class="table-wrap"><table><thead><tr>
        <th>আইডি</th><th>তারিখ</th><th>সরবরাহকারী</th><th>পণ্য</th><th>পরিমাণ</th><th>মোট খরচ</th><th>গড় খরচ/একক</th><th>পেমেন্ট</th><th>একশন</th>
      </tr></thead><tbody>${rows || `<tr><td colspan="9" class="empty-state">কোনো ক্রয় এন্ট্রি নেই</td></tr>`}</tbody></table></div>
      <p style="font-size:12px;color:var(--text-muted);margin-top:8px;">ফ্রি আইটেম এলে মোট পরিমাণের মধ্যেই সেটা ধরে "গড় খরচ/একক" স্বয়ংক্রিয়ভাবে হিসাব হয় — আলাদা কিছু করতে হয় না।</p>
    </div>
    <div id="modalHolder"></div>
  `;
}
function openPurchaseForm(){
  const products = CACHE.products;
  document.getElementById('modalHolder').innerHTML = `
    <div class="panel">
      <h3>নতুন ক্রয় এন্ট্রি</h3>
      <div class="form-grid">
        ${dateField('pu_date')}
        <div class="form-field"><label>সরবরাহকারী/মিল/চাতাল নাম</label><input id="pu_supplier"></div>
        <div class="form-field"><label>পণ্য</label>
          <select id="pu_product" onchange="refreshPurchaseUnit()">${products.map(p=>`<option value="${p.id}">${esc(p.name)} (একক: ${esc(p.unit||'কেজি')})</option>`).join('')}</select>
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
          <div style="display:flex;gap:6px;"><input id="pu_qty" type="number" step="any" value="1" style="flex:1;"><select id="pu_qunit" style="width:90px;"></select></div></div>
        <div class="form-field"><label>এর মধ্যে ফ্রি পরিমাণ (ঐচ্ছিক)</label><input id="pu_freeqty" type="number" value="0"></div>
        <div class="form-field"><label>মোট খরচ — যত টাকা আসলে দিয়েছেন (৳)</label><input id="pu_cost" type="number" value="0"></div>
        <div class="form-field"><label>পেমেন্ট স্ট্যাটাস</label>
          <select id="pu_pay" onchange="onPurchasePayChange()"><option value="Paid">পরিশোধিত</option><option value="Outstanding">বকেয়া</option></select>
        </div>
        <div class="form-field"><label>পরিশোধের পরিমাণ (৳)</label><input id="pu_paid" type="number" value="0"></div>
      </div>
      <p style="font-size:12px;color:var(--text-muted);margin-top:10px;">ফ্রি পেলে মোট পরিমাণে ফ্রিসহ লিখুন, আর "মোট খরচে" শুধু যত টাকা দিয়েছেন তা লিখুন।</p>
      <div style="margin-top:16px;display:flex;gap:10px;">
        <button class="btn btn-primary" onclick="savePurchase()">সংরক্ষণ করুন (স্টকে যোগ হবে)</button>
        <button class="btn btn-outline" onclick="renderPurchases()">বাতিল</button>
      </div>
    </div>`;
  refreshPurchaseUnit();
}
function refreshPurchaseUnit(){
  const p = CACHE.products.find(x=>x.id===document.getElementById('pu_product').value);
  const info = subInfo(p), sel = document.getElementById('pu_qunit');
  if(!sel) return;
  sel.innerHTML = `<option value="base">${esc((p&&p.unit)||'কেজি')}</option>` + (info ? `<option value="sub">${info.label}</option>` : '');
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
  const purchases = CACHE.purchases.slice();
  const products = CACHE.products.slice();
  const supplier = document.getElementById('pu_supplier').value.trim();
  const productId = document.getElementById('pu_product').value;
  const pSel = products.find(x=>x.id===productId);
  const info = subInfo(pSel);
  const div = (document.getElementById('pu_qunit').value==='sub' && info) ? info.factor : 1;
  const qty = r3(Number(document.getElementById('pu_qty').value||0)/div);
  const freeQty = r3(Number(document.getElementById('pu_freeqty').value||0)/div);
  if(!supplier || qty<=0){ alert('সরবরাহকারীর নাম ও পরিমাণ সঠিকভাবে দিন'); return; }
  if(freeQty>qty){ alert('ফ্রি পরিমাণ মোট পরিমাণের চেয়ে বেশি হতে পারে না'); return; }
  const data = {
    id: genId('PO-', purchases), date: pickedDate('pu_date'), supplier, productId, qty, freeQty,
    totalCost: Number(document.getElementById('pu_cost').value||0),
    paymentStatus: document.getElementById('pu_pay').value,
    paidAmount: Number(document.getElementById('pu_paid').value||0)
  };
  purchases.push(data);
  const pIdx = products.findIndex(p=>p.id===productId);
  if(pIdx>-1){ products[pIdx] = {...products[pIdx], hidden:false, stock: r3(Number(products[pIdx].stock) + qty)}; }
  saveCollection('products', products);
  saveCollection('purchases', purchases);
  renderPurchases();
}
function deletePurchase(id){
  if(!confirm('এই এন্ট্রিটি মুছে ফেলতে চান? (স্টক স্বয়ংক্রিয়ভাবে সমন্বয় হবে না)')) return;
  saveCollection('purchases', CACHE.purchases.filter(p=>p.id!==id));
  renderPurchases();
}

/* ============================================================
   EXPENSES
   ============================================================ */
const INCOME_CATEGORIES = ['কোম্পানি কমিশন','রিবেট/ক্যাশব্যাক','অন্যান্য আয়'];
function renderExpenses(){
  const expenses = CACHE.expenses;
  let rows = expenses.slice().reverse().map(e => {
    const inc = e.kind==='income';
    return `
    <tr>
      <td>${e.id}</td><td>${e.date}</td>
      <td>${inc?'<span class="badge badge-paid">আয়</span> ':''}${esc(e.category)}</td>
      <td class="cell-num" style="${inc?'color:#167A54;':''}">${inc?'+ ':''}${money(e.amount)}</td><td>${esc(e.method)}</td><td>${esc(e.approvedBy)}</td>
      <td class="cell-center"><button class="icon-btn danger" onclick="deleteExpense('${e.id}')">🗑️</button></td>
    </tr>`;
  }).join('');
  document.getElementById('pageContent').innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>খরচ ও আয় খাতা</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-outline btn-sm" onclick="openExpenseForm('income')">+ কমিশন / অন্যান্য আয়</button>
          <button class="btn btn-accent btn-sm" onclick="openExpenseForm()">+ নতুন খরচ</button>
        </div>
      </div>
      <div class="table-wrap"><table><thead><tr>
        <th>আইডি</th><th>তারিখ</th><th>ক্যাটাগরি</th><th>পরিমাণ</th><th>মাধ্যম</th><th>অনুমোদনকারী / উৎস</th><th>একশন</th>
      </tr></thead><tbody>${rows || `<tr><td colspan="7" class="empty-state">কোনো এন্ট্রি যোগ করা হয়নি</td></tr>`}</tbody></table></div>
      <p style="font-size:12px;color:var(--text-muted);margin-top:8px;">কোম্পানির কাছ থেকে পাওয়া কমিশন "আয়" হিসেবে যোগ হয় এবং লাভ-ক্ষতির হিসাবে নিট লাভে যোগ হয়ে যায়।</p>
    </div>
    <div id="modalHolder"></div>
  `;
}
function openExpenseForm(kind){
  const inc = kind==='income';
  const cats = inc ? INCOME_CATEGORIES : CACHE.settings.expenseCategories;
  document.getElementById('modalHolder').innerHTML = `
    <div class="panel">
      <h3>${inc?'কমিশন / আয় এন্ট্রি':'নতুন খরচ এন্ট্রি'}</h3>
      <div class="form-grid">
        ${dateField('e_date')}
        <div class="form-field"><label>ক্যাটাগরি</label>
          <select id="e_cat">${cats.map(c=>`<option>${esc(c)}</option>`).join('')}</select>
        </div>
        <div class="form-field"><label>পরিমাণ (৳)</label><input id="e_amount" type="number" value="0"></div>
        <div class="form-field"><label>${inc?'টাকা পাওয়ার মাধ্যম':'পেমেন্ট মাধ্যম'}</label>
          <select id="e_method"><option>Cash</option><option>bKash</option><option>Bank</option></select>
        </div>
        <div class="form-field"><label>${inc?'কোম্পানির নাম / বিবরণ':'অনুমোদনকারী'}</label><input id="e_approved"></div>
      </div>
      <div style="margin-top:16px;display:flex;gap:10px;">
        <button class="btn btn-primary" onclick="saveExpense('${inc?'income':''}')">সংরক্ষণ করুন</button>
        <button class="btn btn-outline" onclick="renderExpenses()">বাতিল</button>
      </div>
    </div>`;
}
function saveExpense(kind){
  const expenses = CACHE.expenses.slice();
  const data = {
    id: genId('EXP-', expenses), date: pickedDate('e_date'),
    category: document.getElementById('e_cat').value,
    amount: Number(document.getElementById('e_amount').value||0),
    method: document.getElementById('e_method').value,
    approvedBy: document.getElementById('e_approved').value.trim()
  };
  if(kind==='income') data.kind = 'income';
  expenses.push(data);
  saveCollection('expenses', expenses);
  renderExpenses();
}
function deleteExpense(id){
  if(!confirm('এই খরচ এন্ট্রিটি মুছে ফেলতে চান?')) return;
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
        ${subInfo(p) ? `<select id="ret_unit_${idx}" style="padding:4px;border:1px solid var(--border);border-radius:6px;"><option value="base" ${it.du===subInfo(p).label?'':'selected'}>${esc(p.unit||'কেজি')}</option><option value="sub" ${it.du===subInfo(p).label?'selected':''}>${subInfo(p).label}</option></select>` : `<span class="muted-cell">${esc((p&&p.unit)||'কেজি')}</span>`}</td>
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
  let anyReturned = false, overLimit = false;
  const newEntries = [];

  items.forEach((it, i)=>{
    const field = document.getElementById(`ret_qty_${i}`);
    const pRet = products.find(x=>x.id===it.productId);
    const infoRet = subInfo(pRet);
    const unitSel = document.getElementById(`ret_unit_${i}`);
    const useSub = !!(unitSel && unitSel.value==='sub' && infoRet);
    const typed = field ? Number(field.value||0) : 0;
    const retQty = r3(useSub ? typed/infoRet.factor : typed);
    if(retQty > Number(it.qty) + 0.0005){ overLimit = true; return; }
    if(retQty>0){
      anyReturned = true;
      const refundAmount = retQty * Number(it.unitPrice);
      newEntries.push({
        id: genId('RET-', returns.concat(newEntries)),
        date: pickedDate('ret_date'), orderId: order.id, customerName: order.customerName,
        productId: it.productId, qty: retQty, refundAmount: Math.round(refundAmount*100)/100, reason,
        dq: r3(typed), du: useSub ? infoRet.label : ((pRet&&pRet.unit)||'কেজি')
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
function renderInventory(){
  const products = CACHE.products;
  const purchases = CACHE.purchases;
  const orders = CACHE.orders;
  const returns = CACHE.returns;
  const month = todayStr().slice(0,7);

  const rows = products.filter(p=>!p.hidden).map(p=>{
    const purchasedThisMonth = purchases.filter(pu=>pu.productId===p.id && pu.date && pu.date.slice(0,7)===month)
      .reduce((s,pu)=>s+Number(pu.qty||0),0);
    const soldThisMonth = orders.filter(o=>o.status==='Delivered' && o.date && o.date.slice(0,7)===month)
      .reduce((s,o)=> s + orderItems(o).filter(it=>it.productId===p.id).reduce((s2,it)=>s2+Number(it.qty||0),0), 0);
    const returnedThisMonth = returns.filter(r=>r.productId===p.id && r.date && r.date.slice(0,7)===month)
      .reduce((s,r)=>s+Number(r.qty||0),0);
    const closingStock = Number(p.stock||0);
    const openingStock = closingStock - purchasedThisMonth + soldThisMonth - returnedThisMonth;
    const stockValue = closingStock * Number(p.cost||0);
    return {p, openingStock, purchasedThisMonth, soldThisMonth, returnedThisMonth, closingStock, stockValue};
  });
  const totalValue = rows.reduce((s,r)=>s+r.stockValue,0);
  const session = getSession();
  const canSeeValue = session.role==='admin';

  document.getElementById('pageContent').innerHTML = `
    ${canSeeValue ? `<div class="stat-card" style="max-width:320px;margin-bottom:16px;">
      <div class="label">বর্তমান মোট স্টকের মূল্য (ক্রয়মূল্যে)</div>
      <div class="value">${money(totalValue)}</div>
    </div>` : ''}
    <div class="panel">
      <div class="panel-head" style="flex-wrap:wrap;gap:8px;">
        <h3>মাসিক ইনভেন্টরি রিপোর্ট — ${month}</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-accent btn-sm" onclick="printStockReport(false)">🖨️ স্টক রিপোর্ট প্রিন্ট (সব পণ্য)</button>
          <button class="btn btn-outline btn-sm" onclick="printStockReport(true)">🖨️ শুধু স্টকে আছে এমন পণ্য</button>
        </div>
      </div>
      <p style="font-size:12.5px;color:var(--text-muted);">এই মাসের শুরুর স্টক, ক্রয়, বিক্রয়, রিটার্ন ও বর্তমান (ক্লোজিং) স্টক এক নজরে — ফিজিক্যাল গণনার সাথে মিলিয়ে দেখতে ব্যবহার করুন। কোনো পার্থক্য থাকলে বুঝবেন কোথাও এন্ট্রি বাদ পড়েছে বা স্টক ক্ষতিগ্রস্ত/চুরি হয়েছে।</p>
      <div class="table-wrap"><table><thead><tr>
        <th>পণ্য</th><th>মাসের শুরুর স্টক</th><th>+ক্রয়</th><th>−বিক্রয়</th><th>+রিটার্ন</th><th>=বর্তমান স্টক</th>
        ${canSeeValue?'<th>স্টক মূল্য</th>':''}
      </tr></thead><tbody>
        ${rows.map(r=>`
          <tr>
            <td>${esc(r.p.name)}</td>
            <td class="cell-num">${r.openingStock} ${esc(r.p.unit||'কেজি')}</td>
            <td class="cell-num">${r.purchasedThisMonth}</td>
            <td class="cell-num">${r.soldThisMonth}</td>
            <td class="cell-num">${r.returnedThisMonth}</td>
            <td class="cell-num"><b>${r.closingStock} ${esc(r.p.unit||'কেজি')}</b></td>
            ${canSeeValue?`<td class="cell-num">${money(r.stockValue)}</td>`:''}
          </tr>`).join('') || `<tr><td colspan="7" class="empty-state">কোনো পণ্য নেই</td></tr>`}
      </tbody></table></div>
    </div>
  `;
}

/* ============================================================
   SHAREHOLDERS — capital-weighted monthly dividend split.
   Each shareholder's invested balance grows as they contribute;
   the dividend pool is split in proportion to that balance.
   ============================================================ */
function renderShareholders(){
  const shareholders = CACHE.shareholders;
  const totalInvested = shareholders.reduce((s,sh)=>s+Number(sh.totalInvested||0),0);

  const rows = shareholders.map(sh=>{
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

  const contribRows = CACHE.contributions.slice().reverse().slice(0,20).map(c=>{
    const sh = shareholders.find(s=>s.id===c.shareholderId);
    return `<tr><td>${c.date}</td><td>${esc(sh?sh.name:'—')}</td><td class="cell-num">${money(c.amount)}</td></tr>`;
  }).join('');

  document.getElementById('pageContent').innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>শেয়ারহোল্ডার তালিকা ও বিনিয়োগ</h3>
        <button class="btn btn-accent btn-sm" onclick="openShareholderForm()">+ নতুন শেয়ারহোল্ডার</button>
      </div>
      <div class="table-wrap"><table><thead><tr>
        <th>নাম</th><th>মোট বিনিয়োগ</th><th>শেয়ারের হার</th><th>একশন</th>
      </tr></thead><tbody>${rows || `<tr><td colspan="4" class="empty-state">কোনো শেয়ারহোল্ডার যোগ করা হয়নি</td></tr>`}</tbody></table></div>
      <p style="font-size:12px;color:var(--text-muted);margin-top:10px;">"লাভ-ক্ষতি" পেইজে মোট শেয়ারহোল্ডার লভ্যাংশ এই অনুপাত অনুযায়ীই প্রতিটা শেয়ারহোল্ডারের মধ্যে ভাগ হয়ে দেখানো হবে।</p>
    </div>
    <div class="panel">
      <h3>সাম্প্রতিক জমার হিস্ট্রি</h3>
      <div class="table-wrap"><table><thead><tr><th>তারিখ</th><th>শেয়ারহোল্ডার</th><th>জমার পরিমাণ</th></tr></thead>
        <tbody>${contribRows || `<tr><td colspan="3" class="empty-state">কোনো জমা এন্ট্রি নেই</td></tr>`}</tbody></table></div>
    </div>
    <div id="modalHolder"></div>
  `;
}
function openShareholderForm(){
  document.getElementById('modalHolder').innerHTML = `
    <div class="panel">
      <h3>নতুন শেয়ারহোল্ডার যোগ করুন</h3>
      <div class="form-grid">
        <div class="form-field"><label>নাম</label><input id="sh_name"></div>
        <div class="form-field"><label>শুরুর বিনিয়োগ (৳)</label><input id="sh_initial" type="number" value="0"></div>
      </div>
      <div style="margin-top:16px;display:flex;gap:10px;">
        <button class="btn btn-primary" onclick="saveShareholder()">সংরক্ষণ করুন</button>
        <button class="btn btn-outline" onclick="renderShareholders()">বাতিল</button>
      </div>
    </div>`;
}
function saveShareholder(){
  const name = document.getElementById('sh_name').value.trim();
  if(!name){ alert('নাম দিন'); return; }
  const shareholders = CACHE.shareholders.slice();
  const initial = Number(document.getElementById('sh_initial').value||0);
  shareholders.push({ id: genId('SH-', shareholders), name, totalInvested: initial });
  saveCollection('shareholders', shareholders);
  renderShareholders();
}
function deleteShareholder(id){
  if(!confirm('এই শেয়ারহোল্ডারকে মুছে ফেলতে চান?')) return;
  saveCollection('shareholders', CACHE.shareholders.filter(s=>s.id!==id));
  renderShareholders();
}
function openContributionForm(shareholderId){
  const sh = CACHE.shareholders.find(s=>s.id===shareholderId);
  document.getElementById('modalHolder').innerHTML = `
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
        <button class="btn btn-outline" onclick="renderShareholders()">বাতিল</button>
      </div>
    </div>`;
}
function saveContribution(shareholderId){
  const amount = Number(document.getElementById('c_amount').value||0);
  if(amount<=0){ alert('সঠিক পরিমাণ দিন'); return; }
  const shareholders = CACHE.shareholders.slice();
  const idx = shareholders.findIndex(s=>s.id===shareholderId);
  shareholders[idx] = {...shareholders[idx], totalInvested: Number(shareholders[idx].totalInvested||0)+amount};
  const contributions = CACHE.contributions.slice();
  contributions.push({ id: genId('CON-', contributions), date: pickedDate('c_date'), shareholderId, amount });
  saveCollection('shareholders', shareholders);
  saveCollection('contributions', contributions);
  renderShareholders();
}

/* ============================================================
   PROFIT & LOSS (admin only)
   ============================================================ */
function renderProfitLoss(){
  const orders = CACHE.orders.filter(o=>o.status==='Delivered');
  const products = CACHE.products;
  const expenses = CACHE.expenses;
  const settings = CACHE.settings;

  const revenue = orders.reduce((s,o)=>s+Number(o.total||0),0);
  const cogs = orders.reduce((s,o)=> s + orderItems(o).reduce((s2,it)=>{ const p=products.find(p=>p.id===it.productId); return s2+(p?p.cost:0)*Number(it.qty||0); },0), 0);
  const grossProfit = revenue - cogs;
  const totalExpenses = expenses.filter(e=>e.kind!=='income').reduce((s,e)=>s+Number(e.amount||0),0);
  const otherIncome = expenses.filter(e=>e.kind==='income').reduce((s,e)=>s+Number(e.amount||0),0);
  const netProfit = grossProfit + otherIncome - totalExpenses;
  const dividendPool = netProfit>0 ? netProfit * (settings.dividendPercent/100) : 0;
  const retainedShare = netProfit>0 ? netProfit - dividendPool : 0;
  const retainedPercent = 100 - settings.dividendPercent;
  const shareholders = CACHE.shareholders;
  const totalInvested = shareholders.reduce((s,sh)=>s+Number(sh.totalInvested||0),0);

  document.getElementById('pageContent').innerHTML = `
    <div class="grid grid-2">
      <div class="panel">
        <h3>আয়-ব্যয় বিবরণী</h3>
        <table>
          <tr><td>মোট বিক্রয় (ডেলিভারড অর্ডার)</td><td class="cell-num">${money(revenue)}</td></tr>
          <tr><td>বিক্রিত পণ্যের ক্রয়মূল্য (COGS)</td><td class="cell-num">${money(cogs)}</td></tr>
          <tr><td><b>গ্রস প্রফিট</b></td><td class="cell-num"><b>${money(grossProfit)}</b></td></tr>
          <tr><td>কমিশন / অন্যান্য আয়</td><td class="cell-num">+ ${money(otherIncome)}</td></tr>
          <tr><td>মোট পরিচালন খরচ</td><td class="cell-num">${money(totalExpenses)}</td></tr>
        </table>
        <div class="invoice-total-row"><span>নিট লাভ</span><span>${money(netProfit)}</span></div>
      </div>
      <div class="panel">
        <h3>নিট লাভের বণ্টন</h3>
        <p style="color:var(--text-muted);font-size:13.5px;">নিট লাভ থেকে বর্তমান নির্ধারিত হার অনুযায়ী স্বয়ংক্রিয় হিসাব:</p>
        <table>
          <tr><td>লভ্যাংশ বণ্টনের হার</td><td class="cell-num">${settings.dividendPercent}%</td></tr>
          <tr><td>নিট লাভ</td><td class="cell-num">${money(netProfit)}</td></tr>
        </table>
        <div class="invoice-total-row"><span>শেয়ারহোল্ডার পুল (${settings.dividendPercent}%)</span><span>${money(dividendPool)}</span></div>
        <div class="invoice-total-row" style="margin-top:8px;"><span>প্রতিষ্ঠানের নিজস্ব অংশ (${retainedPercent}%)</span><span>${money(retainedShare)}</span></div>
        <p style="font-size:12px;color:var(--text-muted);margin-top:10px;">লভ্যাংশের হার পরিবর্তন করতে সেটিংস পেইজে যান।</p>
      </div>
    </div>
    <div class="panel">
      <h3>শেয়ারহোল্ডার অনুযায়ী লভ্যাংশ বণ্টন (বিনিয়োগের অনুপাতে)</h3>
      <div class="table-wrap"><table><thead><tr>
        <th>শেয়ারহোল্ডার</th><th>মোট বিনিয়োগ</th><th>শেয়ারের হার</th><th>এই মাসের প্রাপ্য লভ্যাংশ</th>
      </tr></thead><tbody>
        ${shareholders.length ? shareholders.map(sh=>{
          const pct = totalInvested>0 ? Number(sh.totalInvested)/totalInvested : 0;
          return `<tr><td>${esc(sh.name)}</td><td class="cell-num">${money(sh.totalInvested)}</td><td class="cell-num">${(pct*100).toFixed(1)}%</td><td class="cell-num">${money(dividendPool*pct)}</td></tr>`;
        }).join('') : `<tr><td colspan="4" class="empty-state">এখনো কোনো শেয়ারহোল্ডার যোগ করা হয়নি — "শেয়ারহোল্ডার" পেইজ থেকে যোগ করুন</td></tr>`}
      </tbody></table></div>
      <p style="font-size:12px;color:var(--text-muted);margin-top:8px;">প্রতিটা শেয়ারহোল্ডারের অংশ = শেয়ারহোল্ডার পুল × (তার বিনিয়োগ ÷ সবার মোট বিনিয়োগ)। কেউ নতুন করে জমা দিলে এই হিসাব নিজে থেকেই আপডেট হয়ে যাবে।</p>
    </div>
  `;
}

/* ============================================================
   INVOICE
   ============================================================ */
function renderInvoice(){
  const orders = CACHE.orders;
  const options = orders.slice().reverse().map(o=>`<option value="${o.id}">${o.id} — ${esc(o.customerName)} (${o.date})</option>`).join('');
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
    <div id="invoiceHolder"></div>
  `;
}
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
      <button class="btn btn-outline btn-sm" onclick="printInvoice(false)">🖨️ সাধারণ প্রিন্ট</button>
      <button class="btn btn-outline btn-sm" onclick="printInvoice(true)">🧾 থার্মাল প্রিন্ট</button>
      <button class="btn btn-accent btn-sm" onclick="shareWhatsapp('${o.id}')">📲 হোয়াটসঅ্যাপে শেয়ার</button>
      <button class="btn btn-accent btn-sm" onclick="shareInvoiceImage()">🖼️ ছবি হিসেবে শেয়ার/ডাউনলোড</button>
    </div>
    <p id="imgShareStatus" style="text-align:center;font-size:12px;color:var(--text-muted);margin-top:8px;"></p>
  `;
  holder.innerHTML = invHtml;
}
function printWhenReady(){
  const imgs = Array.from(document.querySelectorAll('#printArea img'));
  const waits = imgs.map(im => (im.complete && im.naturalWidth) ? Promise.resolve() : new Promise(r => { im.onload = r; im.onerror = r; }));
  Promise.race([Promise.all(waits), new Promise(r => setTimeout(r, 3000))]).then(() => window.print());
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
        <h3>লভ্যাংশ বণ্টনের হার</h3>
        <div class="form-field" style="max-width:220px;">
          <label>শেয়ারহোল্ডার লভ্যাংশ (%)</label>
          <input id="s_dividend" type="number" value="${settings.dividendPercent}">
        </div>
        <button class="btn btn-primary btn-sm" style="margin-top:12px;" onclick="saveDividend()">সংরক্ষণ করুন</button>
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
        <p style="font-size:13px;color:var(--text-muted);">সব পণ্য, অর্ডার, ক্রয়, খরচ, বকেয়া, রিটার্ন ও শেয়ারহোল্ডার তথ্যের একটা কপি আপনার ফোন/কম্পিউটারে ডাউনলোড করে রাখুন — সপ্তাহে অন্তত একবার করার অভ্যাস রাখা ভালো।</p>
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
    contributions: CACHE.contributions, settings: CACHE.settings
  };
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
  const list = CACHE.products.filter(p => !p.hidden && (!onlyInStock || Number(p.stock) > 0))
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
        <div>তারিখ: ${dateStr} · ${onlyInStock?'শুধু স্টকে থাকা পণ্য':'সব চালু পণ্য'} · মোট ${list.length}টি পণ্য</div></div>
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
function restoreBackup(event){
  const file = event.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try{
      const data = JSON.parse(e.target.result);
      const labels = {products:'পণ্য', orders:'অর্ডার', purchases:'ক্রয়', expenses:'খরচ/আয়', returns:'রিটার্ন', shareholders:'শেয়ারহোল্ডার', contributions:'জমা'};
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
const APP_VERSION = '২.০';
const APP_UPDATED_FALLBACK = '2026-10-01T12:00:00+06:00';
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
