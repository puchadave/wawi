/* WaWi Shop-Kern v2.0 — Shop-Logik (Vanilla JS, kein CDN)
   Inkl. WhatsApp-Klick-zu-Chat und Facebook-Marketplace-Weiterleitung */
'use strict';

let cart = JSON.parse(localStorage.getItem('wawi-cart') || '[]');
let SHOP_CFG = { whatsappNumber: '', shopName: 'Uptempo Store' };

function money(n) { return n.toFixed(2).replace('.', ',') + ' EUR'; }

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function waLink(number, text) {
  return 'https://wa.me/' + number.replace(/[^0-9]/g, '') + '?text=' + encodeURIComponent(text);
}

async function loadConfig() {
  try {
    const r = await fetch('/api/config');
    if (r.ok) SHOP_CFG = await r.json();
  } catch (e) { /* Shop läuft auch ohne Config */ }
}

async function loadProducts() {
  const r = await fetch('/api/products');
  const data = await r.json();
  const grid = document.getElementById('productGrid');
  grid.innerHTML = '';
  for (const p of data.products) {
    const card = document.createElement('div');
    card.className = 'card';
    const waBtn = SHOP_CFG.whatsappNumber
      ? `<button class="wa" data-wa="${esc(p.id)}" data-waname="${esc(p.name)}" data-waprice="${p.price}">WhatsApp bestellen</button>`
      : '';
    card.innerHTML = `
      <span class="cat">${p.category}</span>
      <h3>${esc(p.name)}</h3>
      <p class="desc">${esc(p.description)}</p>
      <div class="price">${money(p.price)}</div>
      <div class="stock">Lager: ${p.stock} Stück</div>
      <select data-size aria-label="Größe">
        ${p.sizes.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}
      </select>
      <button class="primary" data-add="${p.id}">In den Warenkorb</button>
      ${waBtn}
    `;
    grid.appendChild(card);
  }
  document.querySelectorAll('[data-add]').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.card');
      const size = card.querySelector('[data-size]').value;
      const id = btn.dataset.add;
      const found = cart.find(c => c.id === id && c.size === size);
      if (found) found.qty++;
      else cart.push({ id, size, qty: 1 });
      saveCart();
      renderCart();
      document.getElementById('cartBtn').scrollIntoView({ behavior: 'smooth' });
    });
  });
  document.querySelectorAll('[data-wa]').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.card');
      const size = card.querySelector('[data-size]').value;
      const text = `Hallo! Ich möchte folgendes bestellen:\n\n▪ ${btn.dataset.waname} (${size}) — ${money(+btn.dataset.waprice)}\n\nLieferung bitte per Express.`;
      window.open(waLink(SHOP_CFG.whatsappNumber, text), '_blank', 'noopener');
    });
  });
}

function saveCart() {
  localStorage.setItem('wawi-cart', JSON.stringify(cart));
}

function renderCart() {
  const count = cart.reduce((a, c) => a + c.qty, 0);
  document.getElementById('cartCount').textContent = count;
  const box = document.getElementById('cartBox');
  if (cart.length === 0) {
    box.innerHTML = '<p style="color:var(--muted)">Warenkorb ist leer.</p>';
    document.getElementById('orderForm').style.display = 'none';
    return;
  }
  document.getElementById('orderForm').style.display = 'flex';
  box.innerHTML = '';
  cart.forEach((c, i) => {
    const item = document.createElement('div');
    item.className = 'cart-item';
    item.innerHTML = `
      <span class="ci-name">${esc(c.id)} (${esc(c.size)})</span>
      <div class="ci-qty">
        <button data-dec="${i}">−</button>
        <b>${c.qty}</b>
        <button data-inc="${i}">+</button>
      </div>
    `;
    box.appendChild(item);
  });
  const t = document.createElement('div');
  t.className = 'cart-total';
  t.textContent = 'Summe wird beim Bestellen verbindlich berechnet';
  box.appendChild(t);

  box.querySelectorAll('[data-dec]').forEach(b => b.addEventListener('click', () => {
    const i = +b.dataset.dec;
    cart[i].qty--;
    if (cart[i].qty <= 0) cart.splice(i, 1);
    saveCart(); renderCart();
  }));
  box.querySelectorAll('[data-inc]').forEach(b => b.addEventListener('click', () => {
    cart[+b.dataset.inc].qty++;
    saveCart(); renderCart();
  }));
}

document.getElementById('orderForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = document.getElementById('orderBtn');
  btn.disabled = true;
  btn.textContent = 'Wird gesendet …';
  const resEl = document.getElementById('orderResult');
  resEl.className = 'result';

  const payload = {
    customer: {
      name: document.getElementById('fName').value,
      email: document.getElementById('fEmail').value,
      phone: document.getElementById('fPhone').value,
      street: document.getElementById('fStreet').value,
      zip: document.getElementById('fZip').value,
      city: document.getElementById('fCity').value,
      note: document.getElementById('fNote').value,
    },
    items: cart.map(c => ({ id: c.id, size: c.size, qty: c.qty })),
  };

  try {
    const r = await fetch('/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (r.ok) {
      let html = `Bestellung ${data.orderId} eingegangen — Summe ${money(data.total)}. Du erhältst die Bestätigung per E-Mail.`;
      if (data.whatsappNumber) {
        const txt = `Hallo! Ich habe soeben im ${SHOP_CFG.shopName} bestellt:\n\nBestellnummer: ${data.orderId}\nSumme: ${money(data.total)}\nName: ${payload.customer.name}\n\nMeine Bestellung bestätigen?`;
        html += `<br><br><a class="wa-btn" href="${waLink(data.whatsappNumber, txt)}" target="_blank" rel="noopener">Bestellung jetzt per WhatsApp bestätigen</a>`;
      }
      resEl.className = 'result ok';
      resEl.innerHTML = html;
      cart = [];
      saveCart();
      renderCart();
      document.getElementById('orderForm').reset();
    } else {
      resEl.className = 'result err';
      resEl.textContent = 'Fehler: ' + data.error;
    }
  } catch (e) {
    resEl.className = 'result err';
    resEl.textContent = 'Server nicht erreichbar. Bitte später erneut versuchen.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Bestellung verbindlich aufgeben';
  }
});

loadConfig().then(loadProducts);
renderCart();