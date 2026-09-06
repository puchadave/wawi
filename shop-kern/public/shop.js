/* WaWi Shop-Kern v2.3 — Shop-Logik (Vanilla JS, kein CDN)
   Inkl. WhatsApp-Klick-zu-Chat, Sofort-Suche, Kategorie-Filter und GiroCode-Unterstützung */
'use strict';

let cart = JSON.parse(localStorage.getItem('wawi-cart') || '[]');
let SHOP_CFG = { whatsappNumber: '', shopName: 'Uptempo Store' };
let ALL_PRODUCTS = [];
let ACTIVE_CATEGORY = 'all';

function money(n) { return (Number(n) || 0).toFixed(2).replace('.', ',') + ' EUR'; }

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function waLink(number, text) {
  return 'https://wa.me/' + number.replace(/[^0-9]/g, '') + '?text=' + encodeURIComponent(text);
}

async function loadConfig() {
  try {
    const r = await fetch('/api/config');
    if (r.ok) SHOP_CFG = await r.json();
  } catch (e) {}
}

async function loadProducts() {
  try {
    const r = await fetch('/api/products');
    const data = await r.json();
    ALL_PRODUCTS = data.products || [];
    renderCategories();
    renderProducts();
  } catch (e) {
    document.getElementById('productGrid').innerHTML = '<p style="color:var(--warn)">Fehler beim Laden der Produkte.</p>';
  }
}

function renderCategories() {
  const cats = new Set(['all']);
  ALL_PRODUCTS.forEach(p => { if (p.category) cats.add(p.category); });
  
  const filterContainer = document.getElementById('categoryFilters');
  if (!filterContainer) return;

  filterContainer.innerHTML = Array.from(cats).map(c => `
    <button class="filter-btn ${c === ACTIVE_CATEGORY ? 'active' : ''}" data-cat="${esc(c)}">
      ${c === 'all' ? 'Alle' : esc(c)}
    </button>
  `).join('');

  filterContainer.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      ACTIVE_CATEGORY = btn.getAttribute('data-cat');
      filterContainer.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderProducts();
    });
  });
}

function renderProducts() {
  const q = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
  const grid = document.getElementById('productGrid');
  grid.innerHTML = '';

  const filtered = ALL_PRODUCTS.filter(p => {
    const matchesCat = ACTIVE_CATEGORY === 'all' || p.category === ACTIVE_CATEGORY;
    const matchesSearch = !q || (p.name && p.name.toLowerCase().includes(q)) || (p.description && p.description.toLowerCase().includes(q));
    return matchesCat && matchesSearch;
  });

  if (filtered.length === 0) {
    grid.innerHTML = '<p style="color:var(--muted);grid-column:1/-1">Keine Artikel gefunden.</p>';
    return;
  }

  for (const p of filtered) {
    const card = document.createElement('div');
    card.className = 'card';
    
    const waBtn = SHOP_CFG.whatsappNumber
      ? `<button class="wa" data-wa="${esc(p.id)}" data-waname="${esc(p.name)}" data-waprice="${p.price}">Per WhatsApp bestellen</button>`
      : '';

    const stockBadge = p.stock <= 5
      ? `<div class="badge-low-stock">Nur noch ${p.stock} auf Lager!</div>`
      : `<div class="badge-in-stock">Sofort lieferbar (${p.stock} Stk.)</div>`;

    const sizes = Array.isArray(p.sizes) && p.sizes.length > 0 ? p.sizes : ['Standard'];

    card.innerHTML = `
      <span class="cat">${esc(p.category || 'Festival')}</span>
      <h3>${esc(p.name)}</h3>
      <p class="desc">${esc(p.description)}</p>
      <div class="price">${money(p.price)}</div>
      ${stockBadge}
      <select data-size aria-label="Größe" style="margin-top:6px">
        ${sizes.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}
      </select>
      <button class="primary" data-add="${esc(p.id)}">In den Warenkorb</button>
      ${waBtn}
    `;
    grid.appendChild(card);
  }

  // Event Listener
  grid.querySelectorAll('button[data-add]').forEach(btn => {
    btn.addEventListener('click', e => {
      const id = btn.getAttribute('data-add');
      const prod = ALL_PRODUCTS.find(p => p.id === id);
      const card = btn.closest('.card');
      const size = card.querySelector('select[data-size]').value;
      addToCart(prod, size);
    });
  });

  grid.querySelectorAll('button[data-wa]').forEach(btn => {
    btn.addEventListener('click', e => {
      const id = btn.getAttribute('data-wa');
      const name = btn.getAttribute('data-waname');
      const price = btn.getAttribute('data-waprice');
      const card = btn.closest('.card');
      const size = card.querySelector('select[data-size]').value;
      const text = `Hi! Ich möchte folgendes bei dir bestellen:\n\n• ${name} (Größe: ${size})\n• Preis: ${money(parseFloat(price))}\n\nBitte um Zahlungsdaten & Lieferinfo!`;
      window.open(waLink(SHOP_CFG.whatsappNumber, text), '_blank');
    });
  });
}

function addToCart(prod, size) {
  const existing = cart.find(it => it.id === prod.id && it.size === size);
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({
      id: prod.id,
      name: prod.name,
      price: prod.price,
      size: size,
      quantity: 1,
    });
  }
  saveCart();
  renderCart();
  
  // Feedback
  const cartBtn = document.getElementById('cartBtn');
  cartBtn.style.color = 'var(--accent)';
  setTimeout(() => { cartBtn.style.color = ''; }, 600);
}

function saveCart() {
  localStorage.setItem('wawi-cart', JSON.stringify(cart));
  updateCartCount();
}

function updateCartCount() {
  const totalQty = cart.reduce((sum, it) => sum + it.quantity, 0);
  document.getElementById('cartCount').textContent = totalQty;
}

function renderCart() {
  const box = document.getElementById('cartBox');
  if (cart.length === 0) {
    box.innerHTML = '<p style="color:var(--muted)">Dein Warenkorb ist leer.</p>';
    return;
  }

  let total = 0;
  let html = '<table style="width:100%;border-collapse:collapse;margin-bottom:16px">';
  html += '<thead><tr style="border-bottom:1px solid var(--line);color:var(--muted);font-size:.8rem;text-align:left"><th>Artikel</th><th>Größe</th><th>Anzahl</th><th>Preis</th><th></th></tr></thead><tbody>';

  for (const it of cart) {
    const itTotal = it.price * it.quantity;
    total += itTotal;
    html += `
      <tr style="border-bottom:1px solid var(--line);font-size:.9rem">
        <td style="padding:8px 4px"><b>${esc(it.name)}</b></td>
        <td style="padding:8px 4px">${esc(it.size)}</td>
        <td style="padding:8px 4px">
          <button onclick="changeQty('${esc(it.id)}', '${esc(it.size)}', -1)" style="padding:2px 6px">-</button>
          <span style="margin:0 6px">${it.quantity}</span>
          <button onclick="changeQty('${esc(it.id)}', '${esc(it.size)}', 1)" style="padding:2px 6px">+</button>
        </td>
        <td style="padding:8px 4px"><b>${money(itTotal)}</b></td>
        <td style="padding:8px 4px"><button onclick="removeFromCart('${esc(it.id)}', '${esc(it.size)}')" style="color:var(--accent);background:none;border:none;cursor:pointer">&times;</button></td>
      </tr>
    `;
  }
  html += `</tbody></table><div style="font-size:1.1rem;font-weight:bold;text-align:right;margin-bottom:16px">Gesamtsumme: <span style="color:var(--accent)">${money(total)}</span></div>`;
  box.innerHTML = html;
}

window.changeQty = function(id, size, delta) {
  const item = cart.find(it => it.id === id && it.size === size);
  if (!item) return;
  item.quantity += delta;
  if (item.quantity <= 0) {
    cart = cart.filter(it => !(it.id === id && it.size === size));
  }
  saveCart();
  renderCart();
};

window.removeFromCart = function(id, size) {
  cart = cart.filter(it => !(it.id === id && it.size === size));
  saveCart();
  renderCart();
};

// Checkout
document.getElementById('orderForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (cart.length === 0) {
    alert('Bitte lege zuerst Artikel in den Warenkorb!');
    return;
  }

  const customer = {
    name: document.getElementById('fName').value,
    email: document.getElementById('fEmail').value,
    phone: document.getElementById('fPhone').value,
    street: document.getElementById('fStreet').value,
    zip: document.getElementById('fZip').value,
    city: document.getElementById('fCity').value,
    note: document.getElementById('fNote').value,
  };

  const paymentMethod = document.getElementById('fPaymentMethod').value;

  const items = cart.map(it => ({
    productId: it.id,
    quantity: it.quantity,
    size: it.size,
  }));

  const resDiv = document.getElementById('orderResult');
  resDiv.style.display = 'block';
  resDiv.className = 'result';
  resDiv.innerHTML = 'Verarbeite Bestellung...';

  try {
    const r = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer, items, paymentMethod }),
    });

    const data = await r.json();
    if (r.ok && data.ok) {
      cart = [];
      saveCart();
      renderCart();
      document.getElementById('orderForm').reset();

      let payHtml = '';
      if (data.payment && data.payment.method === 'vorkasse' && data.payment.bank) {
        payHtml = `
          <div class="girocode-box">
            <b>Bankverbindung für Überweisung:</b><br>
            Empfänger: <b>${esc(data.payment.bank.holder)}</b><br>
            IBAN: <b>${esc(data.payment.bank.iban)}</b><br>
            BIC: <b>${esc(data.payment.bank.bic)}</b><br>
            Bank: ${esc(data.payment.bank.bank)}<br>
            Verwendungszweck: <b>${esc(data.payment.bank.reference)}</b><br><br>
            <i>${esc(data.payment.instructions)}</i>
          </div>
        `;
      } else if (data.payment && data.payment.links && data.payment.links.paypal) {
        payHtml = `<div style="margin-top:12px"><a href="${data.payment.links.paypal}" target="_blank" class="btn primary">Jetzt mit PayPal zahlen</a></div>`;
      }

      let waBtnHtml = '';
      if (data.whatsappNumber && data.whatsappMessageText) {
        waBtnHtml = `
          <div style="margin-top:12px">
            <a href="${waLink(data.whatsappNumber, data.whatsappMessageText)}" target="_blank" class="btn wa" style="display:inline-block;text-decoration:none">
              Bestellung per WhatsApp bestätigen
            </a>
          </div>
        `;
      }

      resDiv.className = 'result ok';
      resDiv.innerHTML = `
        <h3 style="color:var(--ok)">Vielen Dank für deine Bestellung!</h3>
        <p>Bestellnummer: <b>${data.orderId}</b> | Summe: <b>${money(data.total)}</b></p>
        <p style="margin-top:6px;font-size:.85rem;color:var(--muted)">Eine Bestätigung wurde per E-Mail versendet. Express-Versand erfolgt via DHL.</p>
        ${payHtml}
        ${waBtnHtml}
      `;
    } else {
      resDiv.className = 'result err';
      resDiv.textContent = data.error || 'Fehler beim Absenden der Bestellung.';
    }
  } catch (err) {
    resDiv.className = 'result err';
    resDiv.textContent = 'Netzwerkfehler beim Absenden.';
  }
});

// Live Search Listener
document.getElementById('searchInput')?.addEventListener('input', () => {
  renderProducts();
});

// Init
loadConfig().then(() => {
  loadProducts();
  renderCart();
  updateCartCount();
});
