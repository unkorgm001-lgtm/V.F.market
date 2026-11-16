let authToken = localStorage.getItem("bm_token") || "";
let currentUser = null;
let products = [];
let sales = [];
let users = [];
let cart = [];

const ALERT_EMAIL = "mohammedabdelnasser707@gmail.com";

async function safeJson(res) {
  const text = await res.text();
  if (!text) {
    throw new Error(`Empty server response (Status ${res.status}). Make sure python server.py is running.`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON response: ${text.slice(0, 80)}`);
  }
}

async function apiFetch(url, options = {}) {
  const headers = Object.assign({ "Content-Type": "application/json" }, options.headers || {});
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  const res = await fetch(url, Object.assign({}, options, { headers }));
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function fill(u, p) {
  document.getElementById("loginUser").value = u;
  document.getElementById("loginPass").value = p;
}

function showLoginError(msg) {
  const box = document.getElementById("loginAlert");
  box.textContent = msg;
  box.style.display = "block";
}

async function login() {
  const username = document.getElementById("loginUser").value.trim();
  const password = document.getElementById("loginPass").value.trim();
  document.getElementById("loginAlert").style.display = "none";

  try {
    const data = await apiFetch("/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });
    authToken = data.token;
    localStorage.setItem("bm_token", authToken);
    await loadDashboard();
  } catch (err) {
    showLoginError(err.message);
  }
}

function logout() {
  authToken = "";
  currentUser = null;
  cart = [];
  localStorage.removeItem("bm_token");
  document.getElementById("appView").style.display = "none";
  document.getElementById("loginView").style.display = "flex";
}

async function loadDashboard() {
  try {
    const data = await apiFetch("/api/state");
    currentUser = data.user;
    products = data.products || [];
    sales = data.sales || [];
    users = data.users || [];

    document.getElementById("loginView").style.display = "none";
    document.getElementById("appView").style.display = "block";
    applyRoleUI();
    renderAll();
  } catch (err) {
    logout();
    showLoginError(err.message);
  }
}

function applyRoleUI() {
  const role = currentUser.role;
  const badge = document.getElementById("roleBadge");
  badge.textContent = role;
  badge.className = `badge badge-${role}`;
  document.getElementById("userLabel").textContent = currentUser.username;

  const isCustomer = role === "customer";
  const canEdit = role === "orgunk" || role === "admin";
  const isOwner = role === "orgunk";

  document.getElementById("desktopTabs").style.display = isCustomer ? "none" : "flex";
  const mNav = document.getElementById("mobileNav");
  if (isCustomer) mNav.classList.remove("show-nav");
  else mNav.classList.add("show-nav");

  document.getElementById("usersTabBtn").style.display = isOwner ? "inline-block" : "none";
  document.getElementById("mUsersBtn").style.display = isOwner ? "flex" : "none";
  document.getElementById("addProdCard").style.display = canEdit ? "block" : "none";
  document.getElementById("wipeSalesBtn").style.display = isOwner ? "inline-flex" : "none";

  const banner = document.getElementById("permBanner");
  if (role === "orgunk") {
    banner.textContent = "Owner (orgunk): Full Read, Edit, Delete, Sales & User Management active.";
  } else if (role === "admin") {
    banner.textContent = "Admin: Read & Edit Products and Restock active.";
  } else if (role === "employment") {
    banner.textContent = "Employment: Read-Only access to Products & Sales logs.";
  } else {
    banner.textContent = "Customer Mode: Browse products and complete purchases.";
  }

  document.getElementById("dbModeNote").textContent = canEdit ? "Edit fields & tap Save" : "Read-only mode";
  openTab("shopTab");
}

function openTab(tabId) {
  document.querySelectorAll(".tab-section").forEach(s => s.style.display = "none");
  document.getElementById(tabId).style.display = "block";
  document.querySelectorAll(".tab-btn, .bnav-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === tabId);
  });
}

function renderShop() {
  const q = document.getElementById("shopSearch").value.toLowerCase();
  const grid = document.getElementById("shopGrid");
  grid.innerHTML = "";
  const isCustomer = currentUser.role === "customer";

  products
    .filter(p => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q))
    .forEach(p => {
      const available = isCustomer ? p.inStock : p.stock > 0;
      const stockLabel = isCustomer
        ? (available ? "Available" : "Out of Stock")
        : `Stock: ${p.stock}`;

      grid.innerHTML += `
        <div class="prod-card">
          <img class="prod-img" src="${p.image}" alt="${p.name}" onerror="this.src='https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=600&q=80'" />
          <div class="prod-body">
            <div class="prod-cat">${p.category}</div>
            <div class="prod-name">${p.name}</div>
            <div class="prod-row">
              <span class="price">$${Number(p.price).toFixed(2)}</span>
              <span style="color:${available ? 'var(--muted)' : 'var(--danger)'}">${stockLabel}</span>
            </div>
            <button class="btn btn-primary" style="padding:8px;" ${available ? "" : "disabled"} onclick="addToCart('${p.id}')">
              ${available ? "+ Add to Basket" : "Sold Out"}
            </button>
          </div>
        </div>
      `;
    });
}

function addToCart(pid) {
  const prod = products.find(p => p.id === pid);
  if (!prod) return;
  const maxStock = currentUser.role === "customer" ? 99 : prod.stock;
  const item = cart.find(c => c.id === pid);
  if (item) {
    if (item.qty >= maxStock) return alert("Maximum available quantity reached.");
    item.qty++;
  } else {
    cart.push({ id: prod.id, name: prod.name, price: Number(prod.price), qty: 1 });
  }
  renderCart();
}

function clearCart() {
  cart = [];
  renderCart();
}

function renderCart() {
  const tbody = document.getElementById("cartBody");
  tbody.innerHTML = "";
  let total = 0;
  cart.forEach((c, i) => {
    const sub = c.price * c.qty;
    total += sub;
    tbody.innerHTML += `
      <tr>
        <td>${c.name}</td>
        <td>${c.qty}</td>
        <td>$${sub.toFixed(2)}</td>
        <td><button class="btn btn-danger" style="padding:3px 8px;" onclick="cart.splice(${i},1);renderCart()">✕</button></td>
      </tr>
    `;
  });
  document.getElementById("cartTotal").textContent = `$${total.toFixed(2)}`;
}

function getNowString() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function checkout() {
  if (!cart.length) return alert("Basket is empty.");
  try {
    const res = await apiFetch("/api/checkout", {
      method: "POST",
      body: JSON.stringify({ items: cart, date: getNowString() })
    });
    if (res.outOfStock && res.outOfStock.length) {
      res.outOfStock.forEach(p => sendEmailAlert("OUT OF STOCK", p));
    }
    cart = [];
    alert("Purchase completed & saved to sales.txt!");
    await loadDashboard();
  } catch (err) {
    alert(err.message);
  }
}

function renderDbEditor() {
  if (currentUser.role === "customer") return;
  const grid = document.getElementById("dbEditGrid");
  grid.innerHTML = "";
  const canEdit = currentUser.role === "orgunk" || currentUser.role === "admin";
  const isOwner = currentUser.role === "orgunk";

  products.forEach(p => {
    grid.innerHTML += `
      <div class="edit-card">
        <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
          <strong style="color:var(--sky);">${p.id}</strong>
          <span style="font-size:0.8rem; color:${p.stock === 0 ? 'var(--danger)' : 'var(--teal)'};">
            ${p.stock === 0 ? 'OUT OF STOCK' : 'In Stock: ' + p.stock}
          </span>
        </div>
        <label>Name</label>
        <input id="ed-name-${p.id}" value="${p.name}" ${canEdit ? "" : "disabled"} />
        <div class="row-2">
          <div>
            <label>Category</label>
            <input id="ed-cat-${p.id}" value="${p.category}" ${canEdit ? "" : "disabled"} />
          </div>
          <div>
            <label>Price ($)</label>
            <input type="number" step="0.01" id="ed-price-${p.id}" value="${Number(p.price).toFixed(2)}" ${canEdit ? "" : "disabled"} />
          </div>
        </div>
        <label>Stock Qty</label>
        <input type="number" id="ed-stock-${p.id}" value="${p.stock}" ${canEdit ? "" : "disabled"} />
        ${canEdit ? `
          <div style="display:flex; gap:8px; margin-top:6px;">
            <button class="btn btn-teal" style="flex:1;" onclick="quickRestock('${p.id}', 10)">+10 Restock</button>
            <button class="btn btn-sky" style="flex:1;" onclick="updateProduct('${p.id}')">Save</button>
            ${isOwner ? `<button class="btn btn-danger" onclick="deleteProduct('${p.id}')">🗑️</button>` : ""}
          </div>
        ` : `<div style="color:var(--muted); font-size:0.8rem; margin-top:6px;">🔒 Read-Only</div>`}
      </div>
    `;
  });
}

async function quickRestock(pid, amount) {
  const input = document.getElementById(`ed-stock-${pid}`);
  input.value = (parseInt(input.value, 10) || 0) + amount;
  await updateProduct(pid);
}

async function updateProduct(pid) {
  const existing = products.find(p => p.id === pid);
  const payload = {
    id: pid,
    name: document.getElementById(`ed-name-${pid}`).value.trim(),
    category: document.getElementById(`ed-cat-${pid}`).value.trim(),
    price: parseFloat(document.getElementById(`ed-price-${pid}`).value),
    stock: parseInt(document.getElementById(`ed-stock-${pid}`).value, 10),
    image: existing ? existing.image : ""
  };
  try {
    const res = await apiFetch("/api/products/save", { method: "POST", body: JSON.stringify(payload) });
    if (res.restocked) sendEmailAlert("RESTOCKED", res.restocked);
    await loadDashboard();
  } catch (err) {
    alert(err.message);
  }
}

async function saveNewProduct() {
  const payload = {
    id: document.getElementById("newId").value.trim().toUpperCase(),
    name: document.getElementById("newName").value.trim(),
    category: document.getElementById("newCat").value.trim() || "General",
    price: parseFloat(document.getElementById("newPrice").value),
    stock: parseInt(document.getElementById("newStock").value, 10),
    image: document.getElementById("newImg").value.trim()
  };
  try {
    const res = await apiFetch("/api/products/save", { method: "POST", body: JSON.stringify(payload) });
    if (res.restocked) sendEmailAlert("RESTOCKED", res.restocked);
    ["newId","newName","newCat","newPrice","newStock","newImg"].forEach(id => document.getElementById(id).value = "");
    await loadDashboard();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteProduct(pid) {
  if (!confirm(`Delete ${pid} from products.txt?`)) return;
  try {
    await apiFetch("/api/products/delete", { method: "POST", body: JSON.stringify({ id: pid }) });
    await loadDashboard();
  } catch (err) {
    alert(err.message);
  }
}

function renderSales() {
  if (currentUser.role === "customer") return;
  const tbody = document.getElementById("salesBody");
  tbody.innerHTML = "";
  let total = 0;
  [...sales].reverse().forEach(s => {
    total += Number(s.total);
    tbody.innerHTML += `
      <tr>
        <td><strong>${s.saleId}</strong></td>
        <td>${s.date}</td>
        <td>${s.buyer}</td>
        <td>${s.productName}</td>
        <td>${s.qty}</td>
        <td style="color:var(--teal); font-weight:700;">$${Number(s.total).toFixed(2)}</td>
      </tr>
    `;
  });
  document.getElementById("revTotal").textContent = `Revenue: $${total.toFixed(2)}`;
}

async function clearSales() {
  if (!confirm("Wipe all records in sales.txt?")) return;
  try {
    await apiFetch("/api/sales/clear", { method: "POST", body: JSON.stringify({}) });
    await loadDashboard();
  } catch (err) {
    alert(err.message);
  }
}

function renderUsers() {
  if (currentUser.role !== "orgunk") return;
  const tbody = document.getElementById("usersBody");
  tbody.innerHTML = "";
  users.forEach(u => {
    tbody.innerHTML += `
      <tr>
        <td><strong>${u.username}</strong></td>
        <td>${u.password}</td>
        <td><span class="badge badge-${u.role}">${u.role}</span></td>
        <td>
          ${u.username !== "orgunk"
            ? `<button class="btn btn-danger" style="padding:4px 10px;" onclick="deleteUser('${u.username}')">Remove</button>`
            : `<span style="color:var(--purple);">Protected</span>`}
        </td>
      </tr>
    `;
  });
}

async function addUser() {
  const payload = {
    username: document.getElementById("uName").value.trim(),
    password: document.getElementById("uPass").value.trim(),
    role: document.getElementById("uRole").value
  };
  try {
    await apiFetch("/api/users/add", { method: "POST", body: JSON.stringify(payload) });
    document.getElementById("uName").value = "";
    document.getElementById("uPass").value = "";
    await loadDashboard();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteUser(username) {
  try {
    await apiFetch("/api/users/delete", { method: "POST", body: JSON.stringify({ username }) });
    await loadDashboard();
  } catch (err) {
    alert(err.message);
  }
}

function sendEmailAlert(type, product) {
  let iframe = document.getElementById("mail_iframe");
  if (!iframe) {
    iframe = document.createElement("iframe");
    iframe.name = "mail_iframe";
    iframe.id = "mail_iframe";
    iframe.style.display = "none";
    document.body.appendChild(iframe);
  }
  const form = document.createElement("form");
  form.method = "POST";
  form.action = `https://formsubmit.co/${ALERT_EMAIL}`;
  form.target = "mail_iframe";

  const fields = {
    _subject: `BlueMart ${type}: ${product.name} (${product.id})`,
    _captcha: "false",
    _template: "table",
    Alert_Type: type,
    Product_ID: product.id,
    Product_Name: product.name,
    Current_Stock: String(product.stock),
    Timestamp: getNowString(),
    System: "BlueMart Python Server // ORG | UNK"
  };

  for (const [k, v] of Object.entries(fields)) {
    const inp = document.createElement("input");
    inp.type = "hidden";
    inp.name = k;
    inp.value = v;
    form.appendChild(inp);
  }
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

function renderAll() {
  renderShop();
  renderCart();
  renderDbEditor();
  renderSales();
  renderUsers();
}

if (authToken) loadDashboard();
