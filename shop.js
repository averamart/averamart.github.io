/* Avera Mart — অনলাইন দোকানের স্ক্রিপ্ট (কাস্টমারের পেইজ; লগইন লাগে না)
   পড়ে:  averamart_public/shop      (অ্যাডমিন অ্যাপ থেকে সিঙ্ক হওয়া পণ্য ও দোকানের তথ্য — ক্রয়মূল্য এখানে নেই)
          averamart_public_img/<id>  (পণ্যের ছোট ছবি)
   লেখে:  averamart_weborders/<id>   (শুধু নতুন অর্ডার তৈরি; পড়া/বদলানো যায় না) */
(function () {
  'use strict';
  var $ = function (i) { return document.getElementById(i); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var r2 = function (n) { return Math.round(Number(n || 0) * 100) / 100; };
  var r3 = function (n) { return Math.round(Number(n || 0) * 1000) / 1000; };
  var tk = function (n) { return '৳' + Number(n || 0).toLocaleString('en-BD', { maximumFractionDigits: 2 }); };
  var bnToEn = function (v) { return String(v).replace(/[০-৯]/g, function (d) { return '০১২৩৪৫৬৭৮৯'.indexOf(d); }); };

  var S = {}, P = [], cart = {}, area = 'local', loaded = false, cat = 'সব', Q = '', SORT = 'def', IMG = {}, db = null, pendingId = '', openedAt = 0;
  try { cart = JSON.parse(localStorage.getItem('am_cart') || '{}') || {}; } catch (e) { cart = {}; }
  var PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="#EEF2EC"/><text x="60" y="70" font-size="40" text-anchor="middle" fill="#1E9E6C">🌿</text></svg>');

  function saveCart() { try { localStorage.setItem('am_cart', JSON.stringify(cart)); } catch (e) {} }
  function toast(t) { var el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { el.hidden = true; }, 2600); }
  function copy(text, msg) {
    function fb() { var ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta); toast(msg); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast(msg); }, fb); else fb();
  }
  function waUrl(text) { return S.whatsapp ? 'https://wa.me/' + S.whatsapp + (text ? '?text=' + encodeURIComponent(text) : '') : ''; }

  /* ---------- পণ্যের হিসাব (একক, দাম, ধাপ) ---------- */
  function byId(id) { return P.filter(function (p) { return p.id === id; })[0]; }
  function lotPrice(p) { return r2(p.lot * p.pr); }                          // একটি "ধাপ"-এর দাম
  function qtyOf(p, lots) { return r3(lots * p.lot); }                       // বেস এককে পরিমাণ (কেজি ইত্যাদি)
  function grossOf(p, lots) { return r2(qtyOf(p, lots) * p.pr); }            // অ্যাডমিন অ্যাপের lineGross-এর একই সূত্র
  function tierPick(p, qty) { var best = null; (p.qd || []).forEach(function (t) { if (qty + 1e-9 >= t.m) best = t; }); return best; }
  function discOf(p, lots) {                                                  // অ্যাডমিন অ্যাপের পরিমাণ-ছাড় (স্তর) হুবহু
    var q = qtyOf(p, lots), g = grossOf(p, lots), t = tierPick(p, q); if (!t) return 0;
    var d = t.t === 'pct' ? Math.round(g * t.v) / 100 : (t.t === 'unit' ? r2(Math.round(t.v * q * 100) / 100) : r2(t.v));
    return Math.min(g, d);
  }
  function lineAmt(p, lots) { return r2(grossOf(p, lots) - discOf(p, lots)); }
  function tierLabel(t, p) { return r3(t.m) + ' ' + p.u + '+ → ' + (t.t === 'pct' ? t.v + '%' : '৳' + r3(t.v)) + ' ছাড়' + (t.t === 'unit' ? ' (প্রতি ' + p.u + ')' : ''); }
  function tierText(p) { return (p.qd && p.qd.length) ? '🏷️ ' + p.qd.map(function (t) { return tierLabel(t, p); }).join(' · ') : ''; }
  function tierHint(p, lots) {
    if (!p.qd || !p.qd.length) return '';
    var q = qtyOf(p, lots), cur = tierPick(p, q), nx = null;
    p.qd.forEach(function (t) { if (!nx && t.m > q + 1e-9) nx = t; });
    if (nx) return (cur ? 'ছাড় পাচ্ছেন। ' : '') + r3(nx.m - q) + ' ' + p.u + ' আরও নিলে ' + (nx.t === 'pct' ? nx.v + '%' : '৳' + r3(nx.v)) + ' ছাড়' + (nx.t === 'unit' ? ' (প্রতি ' + p.u + ')' : '');
    return cur ? 'সর্বোচ্চ ছাড় পাচ্ছেন 🎉' : '';
  }
  function maxLots(p) { return Math.max(0, Math.floor(p.s / p.lot + 1e-9)); }
  function showPrice(p) { return r2(p.pr * (p.b !== 1 ? p.b : 1)); }          // কার্ডে যে দাম দেখায়
  function showPer(p) { return p.b !== 1 ? p.b + ' ' + p.u : (/[0-9০-৯]/.test(p.u) ? p.u : 'প্রতি ' + p.u); }
  function qtyText(p, lots) {
    if (p.lot === 1) return lots + ' ' + p.u;
    if (p.b !== 1) return lots + ' × ' + p.b + ' ' + p.u;
    return r3(lots * p.lot) + ' ' + p.u;
  }
  function stepText(p) { return p.b !== 1 ? '১ প্যাক = ' + p.b + ' ' + p.u : (p.lot !== 1 ? 'প্রতিবার ' + p.lot + ' ' + p.u : ''); }

  /* ---------- দোকানের তথ্য ---------- */
  function applySettings() {
    document.title = (S.name || 'Avera Mart') + ' — অনলাইন দোকান';
    $('shopName').textContent = S.name || 'Avera Mart'; $('tagline').textContent = S.tagline || '';
    $('heroTitle').textContent = S.heroTitle || ''; $('heroText').textContent = S.heroText || '';
    $('fName').textContent = S.name || 'Avera Mart'; $('fAddr').textContent = S.address || '';
    $('codNote').textContent = 'ক্যাশ অন ডেলিভারি: ' + (S.codNote || 'পণ্য হাতে পেয়ে টাকা পরিশোধ করুন') + '। অর্ডারের পর আমরা ফোনে কনফার্ম করব।';
    var charge = (S.deliveryLocal || S.deliveryOutside)
      ? (S.localArea || 'স্থানীয়') + ' ' + tk(S.deliveryLocal) + ', অন্য জেলা ' + tk(S.deliveryOutside) + (S.freeDeliveryMin ? '। ' + tk(S.freeDeliveryMin) + '-এর বেশি কিনলে ফ্রি' : '')
      : 'ডেলিভারি চার্জ অর্ডার কনফার্মের সময় জানানো হবে';
    $('strip').innerHTML = '<div><b>' + esc(S.strip1t || 'ক্যাশ অন ডেলিভারি') + '</b>' + esc(S.strip1d || S.codNote || 'পণ্য হাতে পেয়ে টাকা দিন') + '</div>' +
      '<div><b>' + esc(S.strip2t || 'হোম ডেলিভারি') + '</b>' + esc(S.strip2d || charge) + '</div>' +
      '<div><b>' + esc(S.strip3t || 'সহজ অর্ডার') + '</b>' + esc(S.strip3d || 'কার্ট থেকে অর্ডার করুন অথবা সরাসরি মেসেজ দিন') + '</div>';
    $('howTitle').textContent = S.howTitle || 'কীভাবে অর্ডার করবেন';
    $('how').innerHTML = [
      [S.how1t || 'পছন্দ করুন', S.how1d || 'পণ্যের নিচের বাটনে ক্লিক করে কার্টে যোগ করুন।'],
      [S.how2t || 'ঠিকানা দিন', S.how2d || 'নাম, মোবাইল নম্বর ও পূর্ণ ঠিকানা লিখুন।'],
      [S.how3t || 'পণ্য হাতে পেয়ে টাকা দিন', S.how3d || 'অর্ডারের পর আমরা ফোনে কনফার্ম করব। টাকা দিতে হবে ডেলিভারির সময়।']
    ].map(function (x) { return '<li><b>' + esc(x[0]) + '</b><span>' + esc(x[1]) + '</span></li>'; }).join('');
    var ICON_PH = '<svg viewBox="0 0 24 24" aria-hidden="true" style="stroke:#123C69;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>';
    var ICON_FB = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.77-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0 0 22 12z"/></svg>';
    var ICON_WA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.21 3.08.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2-1.41.25-.69.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35zM12.05 21.8h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.9-9.88 2.64 0 5.12 1.03 6.99 2.9a9.82 9.82 0 0 1 2.89 6.99c0 5.45-4.44 9.88-9.89 9.88z"/></svg>';
    $('phones').innerHTML = [S.phone1, S.phone2].filter(Boolean).map(function (n) {
      return '<div class="ph">' + ICON_PH + '<code>' + esc(n) + '</code><button class="copy" type="button" data-copy="' + esc(n) + '">কপি</button></div>';
    }).join('');
    var links = [];
    if (S.facebook) links.push('<a class="clink fb" href="' + esc(S.facebook) + '" target="_blank" rel="noopener">' + ICON_FB + '<span>ফেসবুক পেজ</span></a>');
    var wa = waUrl('');
    if (wa) links.push('<a class="clink wa" href="' + esc(wa) + '" target="_blank" rel="noopener">' + ICON_WA + '<span>WhatsApp-এ মেসেজ দিন</span></a>');
    $('links').innerHTML = links.join('');
    var fab = $('wafab'); fab.hidden = !wa; fab.href = wa || '#';
    fab.innerHTML = ICON_WA.replace('<svg', '<svg style="width:20px;height:20px;fill:#fff;vertical-align:-4px;margin-right:6px"') + 'WhatsApp';
    $('areas').innerHTML = '<label><input type="radio" name="area" value="local"' + (area === 'local' ? ' checked' : '') + '><b>' + esc(S.localArea || 'স্থানীয়') + '</b><small>ডেলিভারি ' + (S.deliveryLocal ? tk(S.deliveryLocal) : 'চার্জ জানানো হবে') + '</small></label>' +
      '<label><input type="radio" name="area" value="outside"' + (area === 'outside' ? ' checked' : '') + '><b>অন্য জেলা</b><small>ডেলিভারি ' + (S.deliveryOutside ? tk(S.deliveryOutside) : 'চার্জ জানানো হবে') + '</small></label>';
    var cl = $('closed');
    if (S.enabled === false) { cl.hidden = false; cl.textContent = 'অনলাইন অর্ডার এখন সাময়িকভাবে বন্ধ আছে। পণ্য দেখতে পারেন; অর্ডারের জন্য ফোন বা মেসেজ করুন।'; }
    else cl.hidden = true;
  }

  /* ---------- পণ্যের তালিকা ---------- */
  function ordering() { return S.enabled !== false; }
  function visible() {
    var toks = bnToEn(Q).toLowerCase().trim().split(/\s+/).filter(Boolean);
    var list = P.filter(function (p) {
      if (cat !== 'সব' && p.c !== cat) return false;
      var hay = bnToEn(p.n + ' ' + (p.c || '') + ' ' + (p.br || '') + ' ' + (p.d || '')).toLowerCase();
      return toks.every(function (t) { return hay.indexOf(t) >= 0; });
    });
    if (SORT === 'low') list.sort(function (a, b) { return showPrice(a) - showPrice(b); });
    else if (SORT === 'high') list.sort(function (a, b) { return showPrice(b) - showPrice(a); });
    else if (SORT === 'name') list.sort(function (a, b) { return a.n.localeCompare(b.n, 'bn'); });
    return list;
  }
  function renderCats() {
    var cs = ['সব']; P.forEach(function (p) { if (p.c && cs.indexOf(p.c) < 0) cs.push(p.c); });
    $('cats').hidden = cs.length < 3;
    $('cats').innerHTML = cs.map(function (c) { return '<button type="button" data-cat="' + esc(c) + '" class="' + (c === cat ? 'on' : '') + '">' + esc(c) + '</button>'; }).join('');
  }
  function stepper(p, q) {
    var val = p.b !== 1 ? q : qtyOf(p, q), unit = p.b !== 1 ? '× ' + p.b + ' ' + p.u : p.u;
    return '<span class="step"><button type="button" data-d="-1" data-id="' + esc(p.id) + '" aria-label="কমান">−</button>' +
      '<input class="qin" inputmode="decimal" data-qid="' + esc(p.id) + '" value="' + esc(val) + '" aria-label="পরিমাণ (' + esc(p.n) + ')"><em>' + esc(unit) + '</em>' +
      '<button type="button" data-d="1" data-id="' + esc(p.id) + '" aria-label="বাড়ান">+</button></span>';
  }
  function card(p) {
    var q = cart[p.id] || 0, mx = maxLots(p), out = mx < 1, act;
    if (!ordering()) act = '';
    else if (out) act = '<button class="add" disabled>স্টক শেষ</button>';
    else if (q) act = stepper(p, q);
    else act = '<button class="add" type="button" data-d="1" data-id="' + esc(p.id) + '">কার্টে যোগ করুন</button>';
    var st = stepText(p);
    return '<article class="card"><div class="pic">' + ((p.br || p.c) ? '<span class="tag">' + esc(p.br || p.c) + '</span>' : '') + (out ? '<span class="tag out">স্টক শেষ</span>' : '') +
      '<img src="' + (IMG[p.id] || PLACEHOLDER) + '" alt="' + esc(p.n) + '"' + (p.hi && !IMG[p.id] ? ' data-pid="' + esc(p.id) + '" data-iv="' + esc(p.iv || '') + '"' : '') + ' loading="lazy"></div>' +
      '<div class="body"><h3>' + esc(p.n) + '</h3>' + (p.d ? '<p>' + esc(p.d) + '</p>' : '') + (st ? '<p>' + esc(st) + '</p>' : '') + (tierText(p) ? '<p style="color:#0E7448;font-weight:600">' + esc(tierText(p)) + '</p>' : '') +
      '<div class="buy"><span class="price num">' + tk(showPrice(p)) + '<small>' + esc(showPer(p)) + '</small></span>' + act + '</div></div></article>';
  }
  var observer = null;
  function watchImages() {
    var imgs = document.querySelectorAll('img[data-pid]');
    if (!imgs.length) return;
    if (!('IntersectionObserver' in window)) { imgs.forEach(function (im) { fillImg(im); }); return; }
    if (!observer) observer = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { observer.unobserve(e.target); fillImg(e.target); } }); }, { rootMargin: '300px' });
    imgs.forEach(function (im) { observer.observe(im); });
  }
  function fillImg(im) { var pid = im.getAttribute('data-pid'); im.removeAttribute('data-pid'); loadImg(pid, im.getAttribute('data-iv')).then(function (d) { if (d) im.src = d; }); }
  function loadImg(pid, iv) {
    if (IMG[pid]) return Promise.resolve(IMG[pid]);
    var ref = db.collection('averamart_public_img').doc(pid);
    function fromServer() { return ref.get().then(function (s) { if (s.exists) { IMG[pid] = s.data().data; return IMG[pid]; } return null; }).catch(function () { return null; }); }
    return ref.get({ source: 'cache' }).then(function (s) {
      if (s.exists && String(s.data().v) === String(iv)) { IMG[pid] = s.data().data; return IMG[pid]; }
      return fromServer();
    }, fromServer);
  }
  function renderGrid() {
    var list = visible();
    $('grid').innerHTML = list.length ? list.map(card).join('') : '<p class="empty">' + (P.length ? 'এই খোঁজে কোনো পণ্য পাওয়া যায়নি।' : 'এখনো কোনো পণ্য যোগ করা হয়নি।') + '</p>';
    $('pcount').textContent = P.length ? list.length + 'টি পণ্য' : '';
    watchImages();
  }

  /* ---------- কার্ট ---------- */
  function lines() { return Object.keys(cart).map(function (k) { return { p: byId(k), q: cart[k] }; }).filter(function (l) { return l.p && l.q > 0; }); }
  function sums() {
    var sub = 0, disc = 0; lines().forEach(function (l) { sub += lineAmt(l.p, l.q); disc += discOf(l.p, l.q); }); sub = r2(sub); disc = r2(disc);
    var tbd = !(S.deliveryLocal || S.deliveryOutside);
    var del = tbd ? 0 : ((S.freeDeliveryMin > 0 && sub >= S.freeDeliveryMin) ? 0 : (area === 'outside' ? S.deliveryOutside : S.deliveryLocal));
    return { sub: sub, disc: disc, del: del, tbd: tbd, total: r2(sub + del) };
  }
  function cartCount() { return lines().length; }
  function renderCart() {
    var n = cartCount(), t = sums();
    $('topCount').textContent = n;
    $('bar').hidden = n === 0 || !ordering(); $('wafab').classList.toggle('up', n > 0 && ordering());
    $('barText').textContent = n + 'টি পণ্য · ' + tk(t.sub);
    var ls = lines();
    if (!ls.length) { $('lines').innerHTML = '<p style="text-align:center;color:var(--muted);padding:24px 0">কার্ট এখনো খালি। পছন্দের পণ্য যোগ করুন।</p>'; $('checkout').hidden = true; return; }
    $('checkout').hidden = !ordering();
    $('lines').innerHTML = ls.map(function (l) {
      return '<div class="line"><img src="' + (IMG[l.p.id] || PLACEHOLDER) + '" alt=""><div><b>' + esc(l.p.n) + '</b><small class="num">' + esc(qtyText(l.p, l.q)) + ' = ' + tk(lineAmt(l.p, l.q)) + '</small>' + (discOf(l.p, l.q) ? '<br><small style="color:#0E7448">ছাড় −' + tk(discOf(l.p, l.q)) + ' বাদ দিয়ে</small>' : '') + (tierHint(l.p, l.q) ? '<br><small style="color:#8a5d10">' + esc(tierHint(l.p, l.q)) + '</small>' : '') + '</div>' +
        stepper(l.p, l.q) + '</div>';
    }).join('');
    $('sum').innerHTML = (t.disc ? '<div><span>পণ্যের দাম</span><span>' + tk(r2(t.sub + t.disc)) + '</span></div><div style="color:#0E7448"><span>পরিমাণ ছাড়</span><span>−' + tk(t.disc) + '</span></div>' : '<div><span>পণ্যের দাম</span><span>' + tk(t.sub) + '</span></div>') + '<div><span>ডেলিভারি চার্জ</span><span>' + (t.tbd ? 'কনফার্মের সময়' : (t.del ? tk(t.del) : 'ফ্রি')) + '</span></div><div class="t"><span>মোট (ক্যাশ অন ডেলিভারি)</span><span>' + tk(t.total) + '</span></div>';
  }
  function change(id, d) {
    var p = byId(id); if (!p || !ordering()) return;
    var q = (cart[id] || 0) + d, mx = maxLots(p);
    if (q > mx) { toast('স্টকে আছে মাত্র ' + qtyText(p, mx)); q = mx; }
    if (q <= 0) delete cart[id]; else cart[id] = Math.min(q, 5000);
    saveCart(); renderGrid(); renderCart();
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-d]'); if (b) { change(b.getAttribute('data-id'), +b.getAttribute('data-d')); return; }
    var c = e.target.closest('[data-copy]'); if (c) { copy(c.getAttribute('data-copy'), 'কপি হয়েছে'); return; }
    var tr = e.target.closest('[data-track]'); if (tr) { closeCart(); openTrack(tr.getAttribute('data-track')); return; }
    var k = e.target.closest('[data-cat]'); if (k) { cat = k.getAttribute('data-cat'); renderCats(); renderGrid(); }
  });
  document.addEventListener('change', function (e) {
    if (e.target.name === 'area') { area = e.target.value; renderCart(); return; }
    var el = e.target.closest && e.target.closest('.qin'); if (!el) return;          // হাতে লেখা পরিমাণ
    var id = el.getAttribute('data-qid'), p = byId(id); if (!p) return;
    var raw = bnToEn(String(el.value).normalize('NFKC')).trim().replace(',', '.'), v = parseFloat(raw);
    if (raw !== '' && isNaN(v)) { renderGrid(); renderCart(); return; }                 // অক্ষর লিখলে আগের সংখ্যাই থাকবে, কার্ট মুছবে না
    if (!(v > 0)) delete cart[id];
    else {
      var lots = p.b !== 1 ? Math.round(v) : Math.ceil(v / p.lot - 1e-9);          // প্যাকে পূর্ণসংখ্যা; অন্যথায় ধাপে ওপরে মিলিয়ে নেয়
      lots = Math.max(1, lots);
      var mx = maxLots(p); if (lots > mx) { toast('স্টকে আছে মাত্র ' + qtyText(p, mx)); lots = mx; }
      cart[id] = lots;
    }
    saveCart(); renderGrid(); renderCart();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('qin')) { e.preventDefault(); e.target.blur(); } });
  $('q').addEventListener('input', function () { Q = this.value; renderGrid(); });
  $('sort').addEventListener('change', function () { SORT = this.value; renderGrid(); });
  function openCart() {
    $('done').hidden = true; $('veil').hidden = false; openedAt = Date.now(); renderCart(); $('close').focus();
    refresh(true);   // খোলার সময় আবার স্টক/দাম মিলিয়ে নেওয়া
  }
  function closeCart() { $('veil').hidden = true; }
  $('topCart').onclick = openCart; $('barBtn').onclick = openCart; $('close').onclick = closeCart;
  $('veil').addEventListener('click', function (e) { if (e.target === $('veil')) closeCart(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('veil').hidden) closeCart(); });

  /* ---------- অর্ডার ---------- */
  function normPhone(v) { var s = bnToEn(v).replace(/[\s\-()]/g, ''); if (s.indexOf('+88') === 0) s = s.slice(3); else if (s.indexOf('88') === 0 && s.length === 13) s = s.slice(2); return s; }
  function validPhone(s) { return /^01[0-9]{9}$/.test(s); }
  function newId() { var a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = ''; for (var i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)]; return 'W-' + s; }
  function validate() {
    var err = '', t = sums();
    if (!ordering()) err = 'অনলাইন অর্ডার এখন বন্ধ আছে।';
    else if (!lines().length) err = 'কার্ট খালি।';
    else if (!$('nm').value.trim()) err = 'আপনার নাম লিখুন।';
    else if (!validPhone(normPhone($('ph').value))) err = '11 সংখ্যার সঠিক মোবাইল নম্বর লিখুন (যেমন 017XXXXXXXX)।';
    else if ($('ad').value.trim().length < 8) err = 'জেলা ও থানাসহ পূর্ণ ঠিকানা লিখুন।';
    else if (S.minOrder > 0 && t.sub < S.minOrder) err = 'সর্বনিম্ন অর্ডার ' + tk(S.minOrder) + '। আরও পণ্য যোগ করুন।';
    $('err').textContent = err; return !err;
  }
  function withTimeout(promise, ms) { return Promise.race([promise, new Promise(function (_, rej) { setTimeout(function () { rej({ code: 'timeout' }); }, ms); })]); }
  $('checkout').addEventListener('submit', function (e) {
    e.preventDefault();
    if ($('web').value) return;                                                    // হানিপট: বট ধরা
    if (Date.now() - openedAt < 3000) { $('err').textContent = 'একটু অপেক্ষা করে আবার চাপুন।'; return; }
    var last = Number(localStorage.getItem('am_last_order') || 0);
    if (Date.now() - last < 20000) { $('err').textContent = 'একটু আগেই অর্ডার পাঠানো হয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।'; return; }
    if (!validate()) return;
    if (navigator.onLine === false) { $('err').textContent = 'ইন্টারনেট সংযোগ নেই। নেট ঠিক হলে আবার চাপুন।'; return; }
    var btn = $('place'); btn.disabled = true; btn.textContent = 'অর্ডার পাঠানো হচ্ছে...';
    var t = sums(), ls = lines();
    var doc = {
      customerName: $('nm').value.trim(), phone: normPhone($('ph').value), address: $('ad').value.trim(), note: $('nt').value.trim(), area: area,
      items: ls.map(function (l) { return { pid: l.p.id, name: l.p.n, qty: qtyOf(l.p, l.q), unit: l.p.u, price: l.p.pr, disc: discOf(l.p, l.q), line: lineAmt(l.p, l.q) }; }),
      discount: t.disc, subtotal: t.sub, delivery: t.del, deliveryTbd: t.tbd, total: t.total, status: 'new', source: 'shop',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    var id = pendingId || (pendingId = newId()), tries = 0;
    function attempt() {
      tries++;
      var batch = db.batch();
      batch.set(db.collection('averamart_weborders').doc(id), doc);
      batch.set(db.collection('averamart_track').doc(id), { s: 'new', t: firebase.firestore.FieldValue.serverTimestamp() });
      return withTimeout(batch.commit(), 20000).catch(function (err) {
        if (err && err.code === 'permission-denied' && tries < 4) { id = pendingId = newId(); return attempt(); }   // একই নম্বর আগে থেকে থাকলে নতুন নম্বর
        throw err;
      });
    }
    attempt().then(function () {
      pendingId = ''; localStorage.setItem('am_last_order', String(Date.now())); try { localStorage.setItem('am_last_id', id); } catch (e3) {}
      sendEmail(id, doc, t);
      try { localStorage.setItem('am_cust', JSON.stringify({ n: doc.customerName, p: $('ph').value, a: doc.address })); } catch (e2) {}
      var text = 'আসসালামু আলাইকুম, আমি অর্ডার করেছি।\nঅর্ডার নম্বর: ' + id + '\n' + doc.items.map(function (s, i) { return (i + 1) + '. ' + s.name + ' × ' + s.qty + ' ' + s.unit; }).join('\n') + '\nমোট: ' + tk(t.total) + (t.tbd ? ' (ডেলিভারি চার্জ আলাদা)' : '') + '\nনাম: ' + doc.customerName + '\nমোবাইল: ' + doc.phone;
      cart = {}; saveCart(); renderGrid(); renderCart();
      $('checkout').hidden = true; $('lines').innerHTML = '';
      var w = waUrl(text);
      $('done').innerHTML = '<h2>অর্ডার হয়েছে ✓</h2><p>ধন্যবাদ, ' + esc(doc.customerName) + '। আমরা শীঘ্রই ফোনে কনফার্ম করব।</p>' +
        '<div class="oid">' + esc(id) + '</div><p class="num">মোট ' + tk(t.total) + (t.tbd ? ' + ডেলিভারি চার্জ' : '') + ' (ক্যাশ অন ডেলিভারি)</p>' +
        '<div class="send">' + (w ? '<a class="btn wa" href="' + esc(w) + '" target="_blank" rel="noopener">WhatsApp-এ অর্ডার নম্বর পাঠান</a>' : '') +
        '<button class="btn ghost" type="button" data-copy="' + esc(id) + '">অর্ডার নম্বর কপি করুন</button><button class="btn ghost" type="button" data-track="' + esc(id) + '">অর্ডারের অবস্থা দেখুন</button><button class="btn soft" type="button" id="again">আরও কেনাকাটা করুন</button></div>';
      $('done').hidden = false; $('again').onclick = closeCart;
    }).catch(function (err) {
      $('err').textContent = (err && err.code === 'timeout') ? 'সার্ভার সাড়া দেয়নি। ইন্টারনেট দেখে আবার চেষ্টা করুন।' : 'অর্ডার পাঠানো যায়নি। কিছুক্ষণ পরে আবার চেষ্টা করুন বা ফোন করুন।';
    }).then(function () { btn.disabled = false; btn.textContent = 'অর্ডার নিশ্চিত করুন (ক্যাশ অন ডেলিভারি)'; });
  });
  try { var cu = JSON.parse(localStorage.getItem('am_cust') || 'null'); if (cu) { $('nm').value = cu.n || ''; $('ph').value = cu.p || ''; $('ad').value = cu.a || ''; } } catch (e) {}

  /* ---------- মালিককে ইমেইল (FormSubmit — ফ্রি, কোনো অ্যাকাউন্ট লাগে না) ---------- */
  function sendEmail(id, doc, t) {
    var to = (S.notifyEmail || '').trim(); if (!to) return;
    var body = {
      _subject: 'নতুন অর্ডার ' + id + ' — ' + tk(t.total), _template: 'table', _captcha: 'false',
      'অর্ডার নম্বর': id, 'কাস্টমার': doc.customerName, 'মোবাইল': doc.phone, 'ঠিকানা': doc.address, 'নোট': doc.note || '—',
      'এলাকা': doc.area === 'outside' ? 'অন্য জেলা' : 'স্থানীয়',
      'পণ্য': doc.items.map(function (s, i) { return (i + 1) + '. ' + s.name + ' × ' + s.qty + ' ' + s.unit + ' = ' + tk(s.line) + (s.disc ? ' (ছাড় ' + tk(s.disc) + ')' : ''); }).join('\n'),
      'পণ্যের দাম': tk(t.sub), 'ছাড়': tk(t.disc), 'ডেলিভারি': t.tbd ? 'জানানো হয়নি' : tk(t.del), 'মোট': tk(t.total), 'পেমেন্ট': 'ক্যাশ অন ডেলিভারি'
    };
    try {
      fetch('https://formsubmit.co/ajax/' + encodeURIComponent(to), { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(function () {});
    } catch (e) {}
  }

  /* ---------- অর্ডার ট্র্যাকিং ---------- */
  var STEPS = [['new', 'অর্ডার পেয়েছি', 'আপনার অর্ডার আমাদের কাছে এসেছে, কনফার্মের অপেক্ষায়'], ['confirmed', 'কনফার্ম হয়েছে', 'আমরা অর্ডার গ্রহণ করেছি'], ['packing', 'প্যাকিং হচ্ছে', 'আপনার পণ্য প্যাক করা হচ্ছে'], ['delivered', 'ডেলিভারি সম্পন্ন', 'পণ্য পৌঁছে গেছে। ধন্যবাদ!']];
  function normId(v) { v = bnToEn(v).toUpperCase().replace(/\s/g, ''); if (/^[A-Z0-9]{6}$/.test(v)) v = 'W-' + v; return v; }
  function openTrack(id) {
    $('tveil').hidden = false; $('tres').innerHTML = '';
    var last = ''; try { last = localStorage.getItem('am_last_id') || ''; } catch (e) {}
    $('tid').value = id || last || ''; $('tid').focus();
    if (id) runTrack();
  }
  function runTrack() {
    var id = normId($('tid').value), out = $('tres');
    if (!/^W-[A-Z0-9]{6}$/.test(id)) { out.innerHTML = '<p class="err">অর্ডার নম্বর সঠিক দিন (যেমন W-AB12CD)।</p>'; return; }
    out.innerHTML = '<p class="note">খোঁজা হচ্ছে...</p>';
    db.collection('averamart_track').doc(id).get({ source: 'server' }).then(function (s) {
      if (!s.exists) { out.innerHTML = '<p class="err">এই নম্বরে কোনো অর্ডার পাওয়া যায়নি। নম্বরটি আবার মিলিয়ে দেখুন।</p>'; return; }
      var d = s.data(), st = d.s, when = '';
      try { when = d.t && d.t.toDate ? d.t.toDate().toLocaleString('bn-BD', { dateStyle: 'medium', timeStyle: 'short' }) : ''; } catch (e) {}
      if (st === 'cancelled') { out.innerHTML = '<h3>অর্ডার ' + esc(id) + '</h3><p class="err" style="min-height:0">এই অর্ডারটি বাতিল হয়েছে। জানতে ফোন করুন।</p>'; return; }
      var idx = 0; STEPS.forEach(function (x, i) { if (x[0] === st) idx = i; });
      out.innerHTML = '<h3>অর্ডার ' + esc(id) + '</h3><ol class="tl">' + STEPS.map(function (x, i) {
        return '<li class="' + (i <= idx ? 'on' : '') + (i === idx ? ' cur' : '') + '"><i>' + (i <= idx ? '✓' : (i + 1)) + '</i><span>' + esc(x[1]) + (i === idx ? '<br><small style="font-weight:400;color:var(--muted)">' + esc(x[2]) + '</small>' : '') + '</span></li>';
      }).join('') + '</ol>' + (when ? '<p class="note">সর্বশেষ হালনাগাদ: ' + esc(when) + '</p>' : '');
    }).catch(function () { out.innerHTML = '<p class="err">এখন অবস্থা আনা যায়নি। ইন্টারনেট দেখে আবার চেষ্টা করুন।</p>'; });
  }
  $('trackBtn').onclick = function () { openTrack(''); };
  $('tclose').onclick = function () { $('tveil').hidden = true; };
  $('tveil').addEventListener('click', function (e) { if (e.target === $('tveil')) $('tveil').hidden = true; });
  $('tgo').addEventListener('click', runTrack);
  $('tid').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); runTrack(); } });

  /* ---------- লোড ---------- */
  function apply(d) {
    S = Object.assign({ enabled: true }, d.shop || {});
    ['deliveryLocal', 'deliveryOutside', 'freeDeliveryMin', 'minOrder'].forEach(function (k) { S[k] = Number(S[k]) || 0; });
    P = (d.items || []).map(function (p) { return Object.assign({ b: 1, lot: 1, s: 0, pr: 0, u: 'কেজি' }, p); }).filter(function (p) { return p.pr > 0; });
    Object.keys(cart).forEach(function (k) { var p = byId(k); if (!p || maxLots(p) < 1) delete cart[k]; else if (cart[k] > maxLots(p)) cart[k] = maxLots(p); });
    saveCart(); applySettings(); renderCats(); renderGrid(); renderCart();
  }
  function refresh(quiet) {
    return db.collection('averamart_public').doc('shop').get().then(function (s) {
      if (!s.exists) { if (!loaded) { $('grid').innerHTML = '<p class="empty">দোকান এখনো প্রস্তুত হয়নি। একটু পরে আবার দেখুন।</p>'; $('pcount').textContent = ''; } return; }
      loaded = true; var d = s.data(); apply(d);
      try { localStorage.setItem('am_public_cache', JSON.stringify(d)); } catch (e) {}
    }).catch(function (e) { if (!loaded && !quiet) $('grid').innerHTML = '<p class="empty">দোকানের তথ্য আনা যায়নি। ইন্টারনেট দেখে পেইজ রিফ্রেশ করুন।<br><small>(কোড: ' + esc((e && e.code) || 'unknown') + ')</small></p>'; });
  }
  try { firebase.initializeApp(firebaseConfig); } catch (e) {}
  db = firebase.firestore();
  try { db.enablePersistence({ synchronizeTabs: true }).catch(function () {}); } catch (e) {}
  applySettings();
  try { var cache = JSON.parse(localStorage.getItem('am_public_cache') || 'null'); if (cache) { apply(cache); loaded = true; } } catch (e) {}
  refresh(false);
})();
