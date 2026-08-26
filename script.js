(() => {
  "use strict";

  const firebaseConfig = {
    apiKey: "AIzaSyBLa7GaDNA8hXoXwlF-MKAl44cFpD-oIUE",
    authDomain: "cocobiz-d312b.firebaseapp.com",
    projectId: "cocobiz-d312b",
    storageBucket: "cocobiz-d312b.firebasestorage.app",
    messagingSenderId: "778317819430",
    appId: "1:778317819430:web:08f37685973d4c4acac0e7"
  };

  const WHATSAPP_NUMBER = "917463928290";
  const $ = id => document.getElementById(id);

  let auth;
  let db;
  let products = [];
  let orders = [];
  let cart = {};
  let searchTerm = "";
  let selfSaleItems = [];
  let currentRole = "admin";
  let currentProfile = null;
  let salesmanRates = {};
  let salesmen = [];
  let publicSalesmanId = new URLSearchParams(window.location.search).get("salesman") || "";
  let publicSalesmanProfile = null;

  const money = value =>
    `₹${Number(value || 0).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;

  const escapeHtml = value =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

  function publicRate(product) {
    if (publicSalesmanProfile?.rates && Object.prototype.hasOwnProperty.call(publicSalesmanProfile.rates, product.id)) return Number(publicSalesmanProfile.rates[product.id]);
    if (currentRole === "salesman" && Object.prototype.hasOwnProperty.call(salesmanRates || {}, product.id)) return Number(salesmanRates[product.id]);
    return Number(product.salePrice || 0);
  }

  async function loadPublicSalesmanProfile() {
    publicSalesmanProfile = null;
    if (!publicSalesmanId || !db) return;
    try {
      const snap = await db.collection("publicSalesmen").doc(publicSalesmanId).get();
      if (snap.exists && (snap.data().role === "salesman" || snap.data().role == null) && snap.data().active !== false) publicSalesmanProfile = { id: snap.id, ...snap.data(), role: "salesman" };
      else publicSalesmanId = "";
    } catch (e) { console.warn("Public salesman profile load failed", e); }
  }

  const errorText = error => {
    if (error?.code === "permission-denied") {
      return "Firebase permission denied. Firestore rules और admin login check करें।";
    }

    if (error?.code === "resource-exhausted") {
      return "Image बहुत बड़ी है। छोटी image upload करें।";
    }

    return error?.message || "Unknown error";
  };

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    });
  }

  async function initFirebase() {
    if (!window.firebase) {
      await loadScript("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
      await loadScript("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js");
      await loadScript("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js");
      await loadScript("https://www.gstatic.com/firebasejs/10.12.2/firebase-functions-compat.js");
    }

    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }

    auth = firebase.auth();
    db = firebase.firestore();
    try {
      await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    } catch (e) {
      console.warn("Firebase persistence set nahi ho saka:", e);
    }
    try {
      await db.enablePersistence({ synchronizeTabs: true });
    } catch (e) {
      console.warn("Firestore offline persistence:", e?.code || e?.message || e);
    }
  }

  function placeholderImage() {
    return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">
        <rect width="100%" height="100%" fill="#f1e5dc"/>
        <text x="50%" y="50%" text-anchor="middle"
          dominant-baseline="middle" fill="#806f67" font-size="28">
          CocoBiz Chocolate
        </text>
      </svg>
    `);
  }

  async function loadProducts() {
    if (!db) return;

    try {
      const snapshot = await db.collection("products").get();

      products = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) =>
          Number(b.createdAt || 0) - Number(a.createdAt || 0)
        );
    } catch (error) {
      console.error("Products load error:", error);
      products = [];
    }
  }

  async function loadOrders() {
    if (!db) return;
    if (!auth?.currentUser) {
      orders = [];
      return;
    }

    try {
      const snapshot = await db.collection("orders").get();

      const allOrders = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

      orders = currentRole === "salesman"
        ? allOrders.filter(order => order.salesmanId === auth.currentUser?.uid)
        : allOrders;

      if ($("orderCount")) {
        $("orderCount").textContent = orders.length;
      }
    } catch (error) {
      console.error("Orders load error:", error);
      orders = [];
    }
  }

  function renderProducts() {
    const grid = $("productGrid");
    if (!grid) return;

    const visibleProducts = products.filter(product => {
      const haystack = `${product.name || ""} ${product.description || ""}`.toLowerCase();
      return !searchTerm || haystack.includes(searchTerm);
    });

    $("emptyMessage")?.classList.toggle("hidden", visibleProducts.length > 0);
    $("emptyMessage").textContent = visibleProducts.length ? "" : (products.length ? "No matching products found." : "No products available yet.");

    grid.innerHTML = visibleProducts.map(product => `
      <article class="product-card">
        <img src="${product.image || placeholderImage()}"
             alt="${escapeHtml(product.name)}">

        <div class="product-content">
          <h3>${escapeHtml(product.name)}</h3>
          <p>${escapeHtml(product.description)}</p>

          <div class="price">
            <strong>${money(publicRate(product))}</strong>
            ${
              Number(product.actualPrice) > Number(product.salePrice)
                ? `<span class="old-price">${money(product.actualPrice)}</span>`
                : ""
            }
          </div>

          <button class="primary-button add-cart-button"
                  data-id="${escapeHtml(product.id)}">
            Add to Order
          </button>
        </div>
      </article>
    `).join("");

    grid.querySelectorAll(".add-cart-button").forEach(button => {
      button.addEventListener("click", () => {
        const id = button.dataset.id;
        cart[id] = Number(cart[id] || 0) + 1;
        updateCart();
      });
    });
  }

  function updateCart() {
    const count = Object.values(cart)
      .reduce((sum, quantity) => sum + Number(quantity), 0);

    if ($("cartCount")) $("cartCount").textContent = count;
    if ($("bottomCartCount")) $("bottomCartCount").textContent = count;

    $("bottomOrderBar")?.classList.toggle("hidden", count === 0);
  }

  function cartItems() {
    return Object.entries(cart)
      .map(([id, quantity]) => {
        const product = products.find(item => item.id === id);
        if (!product) return null;

        const price = publicRate(product);
        const safeQuantity = Number(quantity);

        return {
          id,
          name: product.name,
          quantity: safeQuantity,
          price,
          total: price * safeQuantity
        };
      })
      .filter(Boolean);
  }

  function renderSelectedProducts() {
    const box = $("selectedProducts");
    if (!box) return;

    const items = cartItems();
    const total = items.reduce((sum, item) => sum + item.total, 0);

    box.innerHTML = items.length
      ? items.map(item => `
          <div class="selected-line cart-line">
            <div class="cart-product-name">
              <strong>${escapeHtml(item.name)}</strong><br>
              <small>${money(item.price)} each</small>
            </div>
            <div class="quantity-control">
              <button type="button" data-qty-minus="${escapeHtml(item.id)}" aria-label="Decrease quantity">−</button>
              <strong>${item.quantity}</strong>
              <button type="button" data-qty-plus="${escapeHtml(item.id)}" aria-label="Increase quantity">+</button>
            </div>
            <strong>${money(item.total)}</strong>
            <button type="button" class="delete-button" data-remove="${escapeHtml(item.id)}">Delete</button>
          </div>
        `).join("") +
        `<div class="order-grand-total">Total: ${money(total)}</div>`
      : "<p>No product selected.</p>";

    box.querySelectorAll("[data-qty-plus]").forEach(button => {
      button.addEventListener("click", () => {
        const id = button.dataset.qtyPlus;
        cart[id] = Number(cart[id] || 0) + 1;
        updateCart();
        renderSelectedProducts();
      });
    });

    box.querySelectorAll("[data-qty-minus]").forEach(button => {
      button.addEventListener("click", () => {
        const id = button.dataset.qtyMinus;
        cart[id] = Math.max(0, Number(cart[id] || 0) - 1);
        if (!cart[id]) delete cart[id];
        updateCart();
        renderSelectedProducts();
        if (!Object.keys(cart).length) $("orderModal")?.classList.add("hidden");
      });
    });

    box.querySelectorAll("[data-remove]").forEach(button => {
      button.addEventListener("click", () => {
        delete cart[button.dataset.remove];
        updateCart();
        renderSelectedProducts();
        if (!Object.keys(cart).length) $("orderModal")?.classList.add("hidden");
      });
    });
  }

  function openOrderModal() {
    if (!Object.keys(cart).length) {
      alert("पहले कोई product select करें।");
      return;
    }

    renderSelectedProducts();
    $("orderModal")?.classList.remove("hidden");
  }

  function bindEvents() {
    $("openOrderButton")?.addEventListener("click", openOrderModal);
    $("bottomOrderButton")?.addEventListener("click", openOrderModal);
    $("productSearch")?.addEventListener("input", event => {
      searchTerm = event.target.value.trim().toLowerCase();
      renderProducts();
    });

    $("adminButton")?.addEventListener("click", openAdminFromLogo);
    $("logoButton")?.addEventListener("click", event => {
      event.preventDefault();
      openAdminFromLogo();
    });

    document.querySelectorAll("[data-close]").forEach(button => {
      button.addEventListener("click", () => {
        $(button.dataset.close)?.classList.add("hidden");
      });
    });

    $("loginForm")?.addEventListener("submit", loginAdmin);
    $("logoutButton")?.addEventListener("click", logoutAdmin);
    $("forgotPasswordButton")?.addEventListener("click", sendPasswordReset);
    $("salesmenTab")?.addEventListener("click", () => showAdminPanel("salesmen"));
    $("salesmanForm")?.addEventListener("submit", createSalesman);
    $("salesmenList")?.addEventListener("click", event => {
      const reset = event.target.closest("[data-reset-salesman]");
      if (reset) resetSalesmanPassword(reset.dataset.resetSalesman);
    });
    $("productForm")?.addEventListener("submit", saveProduct);
    $("cancelEdit")?.addEventListener("click", resetProductForm);
    $("orderForm")?.addEventListener("submit", submitOrder);
    $("addSelfSaleProduct")?.addEventListener("click", addSelfSaleProduct);
    $("selfSaleForm")?.addEventListener("submit", saveSelfSale);
    $("saleCustomerName")?.addEventListener("change", handleSelfSaleCustomerChange);

    $("dashboardTab")?.addEventListener("click", () =>
      showAdminPanel("dashboard")
    );

    $("saleTab")?.addEventListener("click", () =>
      showAdminPanel("sale")
    );

    $("productsTab")?.addEventListener("click", () =>
      showAdminPanel("products")
    );

    $("ordersTab")?.addEventListener("click", () =>
      showAdminPanel("orders")
    );

    $("adminOrders")?.addEventListener("click", event => {
      const returnButton = event.target.closest("[data-return-order]");
      const billButton = event.target.closest("[data-bill-order]");
      const acceptButton = event.target.closest("[data-accept-order]");
      const paymentButton = event.target.closest("[data-payment-order]");
      const deleteButton = event.target.closest("[data-delete-order]");
      if (returnButton) processReturn(returnButton.dataset.returnOrder);
      if (billButton) printOrderBill(billButton.dataset.billOrder);
      if (acceptButton) updateOrderStatus(acceptButton.dataset.acceptOrder);
      if (paymentButton) receivePayment(paymentButton.dataset.paymentOrder);
      if (deleteButton) deleteOrder(deleteButton.dataset.deleteOrder);
    });
  }

  async function openAdminFromLogo() {
    if (auth?.currentUser) {
      await loadAdminData();
      $("adminModal")?.classList.remove("hidden");
      return;
    }
    $("loginError").textContent = "";
    $("loginModal")?.classList.remove("hidden");
  }

  async function loadUserProfile(user) {
    currentRole = "admin";
    currentProfile = null;
    salesmanRates = {};
    try {
      const snap = await db.collection("users").doc(user.uid).get();
      if (snap.exists) {
        currentProfile = { id: snap.id, ...snap.data() };
        if (currentProfile.role === "salesman") {
          currentRole = "salesman";
          salesmanRates = currentProfile.rates || {};
          publicSalesmanId = user.uid;
          publicSalesmanProfile = currentProfile;
          renderProducts();
        }
      }
    } catch (e) {
      console.warn("Profile load failed; treating existing Firebase user as admin.", e);
    }
  }

  function generatePassword() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#";
    return Array.from({length: 10}, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  }

  async function sendPasswordReset() {
    const email = $("adminEmail")?.value.trim();
    if (!email) { alert("पहले email / login ID डालें।"); return; }
    try {
      await auth.sendPasswordResetEmail(email);
      alert("Password reset link email पर भेज दिया गया है।");
    } catch (error) {
      alert(`Reset link नहीं भेजा गया: ${errorText(error)}`);
    }
  }

  async function createSalesman(event) {
    event.preventDefault();
    if (currentRole !== "admin") return;
    const name = $("salesmanName").value.trim();
    const number = $("salesmanNumber").value.trim();
    const email = $("salesmanEmail").value.trim().toLowerCase();
    if (!name || !/^[0-9]{10}$/.test(number) || !email) { alert("Name, valid 10-digit mobile और email भरें।"); return; }

    const password = generatePassword();
    let secondaryApp;
    try {
      secondaryApp = firebase.apps.find(app => app.name === "CocoBizSalesmanCreator") || firebase.initializeApp(firebaseConfig, "CocoBizSalesmanCreator");
      const secondaryAuth = secondaryApp.auth();
      const cred = await secondaryAuth.createUserWithEmailAndPassword(email, password);
      await db.collection("users").doc(cred.user.uid).set({
        name, number, email, role: "salesman", rates: {}, createdAt: Date.now(), active: true
      });
      await db.collection("publicSalesmen").doc(cred.user.uid).set({
        name, number, email, role: "salesman", rates: {}, active: true, updatedAt: Date.now()
      });
      await secondaryAuth.signOut();
      $("salesmanCredentials").innerHTML = `<strong>Salesman created successfully</strong><br>Login ID: <b>${escapeHtml(email)}</b><br>Password: <b>${escapeHtml(password)}</b><br><small>Is password ko salesman ko de dein. Baad me Forgot / Reset Password se change kiya ja sakta hai.</small>`;
      $("salesmanCredentials").classList.remove("hidden");
      $("salesmanForm").reset();
      await loadSalesmen();
    } catch (error) {
      alert(`Salesman create नहीं हुआ: ${errorText(error)}`);
    }
  }

  async function loadSalesmen() {
    if (!db || currentRole !== "admin") return;
    try {
      const snap = await db.collection("users").where("role", "==", "salesman").get();
      salesmen = snap.docs.map(doc => ({id: doc.id, ...doc.data()})).sort((a,b) => String(a.name||"").localeCompare(String(b.name||"")));
      renderSalesmen();
    } catch (error) {
      console.error("Salesmen load error", error);
    }
  }

  function renderSalesmen() {
    const box = $("salesmenList");
    if (!box) return;
    box.innerHTML = salesmen.length ? salesmen.map(s => {
      const so = orders.filter(o => o.salesmanId === s.id);
      const pending = so.filter(o => ["salesman_pending","pending_admin"].includes(o.status));
      const accepted = so.filter(o => ["accepted","received"].includes(o.status));
      const paid = so.reduce((x,o)=>x+Number(o.paidAmount||0),0);
      const due = so.reduce((x,o)=>x+Math.max(0,Number(o.dueAmount||0)),0);
      const total = so.reduce((x,o)=>x+Number(o.netTotal ?? o.total ?? 0),0);
      const share = `${window.location.origin}${window.location.pathname}?salesman=${encodeURIComponent(s.id)}`;
      return `<details class="salesman-folder admin-product">
        <summary><div class="salesman-avatar">${escapeHtml((s.name||"S").charAt(0).toUpperCase())}</div><div><strong>${escapeHtml(s.name||"Salesman")}</strong><small><br>${escapeHtml(s.number||"")} · ${escapeHtml(s.email||"")}</small></div><span class="folder-count">${so.length} orders</span></summary>
        <div class="salesman-folder-body">
          <div class="sale-summary salesman-summary"><div><small>Total Orders</small><strong>${so.length}</strong></div><div><small>Accepted</small><strong>${accepted.length}</strong></div><div><small>Pending</small><strong>${pending.length}</strong></div><div><small>Due</small><strong>${money(due)}</strong></div></div>
          <p><b>Total:</b> ${money(total)} · <b>Received:</b> ${money(paid)} · <b>Due:</b> ${money(due)}</p>
          <div class="share-link-box"><input readonly value="${escapeHtml(share)}"><button class="secondary-button" data-copy-salesman-link="${escapeHtml(share)}">Copy Link</button></div>
          <div class="salesman-order-list">${so.length ? so.map(o=>`<div class="salesman-order-row"><div><b>#${escapeHtml(o.id)}</b> · ${escapeHtml(o.customer?.name||"Customer")}<br><small>${escapeHtml(o.date||"")}</small></div><div><b>${money(o.netTotal ?? o.total)}</b><br><span class="status-badge">${escapeHtml(o.status||"pending")}</span></div></div>`).join("") : '<p class="modal-subtitle">No orders yet.</p>'}</div>
          <div class="admin-product-actions"><button class="secondary-button" data-reset-salesman="${escapeHtml(s.email||"")}">Email Reset Link</button><button class="primary-button" data-change-salesman-password="${escapeHtml(s.id)}" data-salesman-email="${escapeHtml(s.email||"")}">Change Password</button></div>
        </div></details>`;
    }).join("") : `<p class="modal-subtitle">अभी कोई salesman नहीं है।</p>`;
    box.querySelectorAll("[data-reset-salesman]").forEach(b=>b.onclick=()=>resetSalesmanPassword(b.dataset.resetSalesman));
    box.querySelectorAll("[data-change-salesman-password]").forEach(b=>b.onclick=()=>changeSalesmanPassword(b.dataset.changeSalesmanPassword, b.dataset.salesmanEmail));
    box.querySelectorAll("[data-copy-salesman-link]").forEach(b=>b.onclick=async()=>{try{await navigator.clipboard.writeText(b.dataset.copySalesmanLink);alert("Salesman link copied.")}catch{prompt("Link copy करें:",b.dataset.copySalesmanLink)}});
  }

  async function resetSalesmanPassword(email) {
    if (!email) return;
    try {
      const actionSettings = {
        url: window.location.origin + window.location.pathname,
        handleCodeInApp: false
      };
      await auth.sendPasswordResetEmail(email, actionSettings);
      alert(`Reset link ${email} पर भेज दिया गया है। Inbox के साथ Spam/Promotions भी check करें।`);
    } catch (error) {
      alert(`Reset link नहीं भेजा गया: ${errorText(error)}\n\nFirebase Authentication > Settings > Authorized domains और Email/Password provider check करें।`);
    }
  }

  async function changeSalesmanPassword(uid, email) {
    const password = prompt(`Salesman (${email}) के लिए नया password डालें (कम से कम 6 characters):`);
    if (password === null) return;
    if (password.length < 6) { alert("Password कम से कम 6 characters का होना चाहिए।"); return; }
    try {
      if (!firebase.functions) throw new Error("Firebase Functions load नहीं हुआ।");
      const fn = firebase.functions().httpsCallable("adminChangeSalesmanPassword");
      await fn({ salesmanUid: uid, newPassword: password });
      alert("Salesman password successfully change हो गया।");
    } catch (error) {
      alert(`Password change नहीं हुआ: ${errorText(error)}\n\nCloud Function deploy होने के बाद यह option काम करेगा।`);
    }
  }

  async function loginAdmin(event) {
    event.preventDefault();

    const email = $("adminEmail").value.trim();
    const password = $("adminPassword").value;
    const errorBox = $("loginError");

    errorBox.textContent = "Logging in...";

    try {
      const credential = await auth.signInWithEmailAndPassword(email, password);
      await loadUserProfile(credential.user);

      errorBox.textContent = "";
      $("loginForm").reset();
      $("loginModal")?.classList.add("hidden");
      $("adminModal")?.classList.remove("hidden");
      const heading = document.querySelector(".admin-heading h2");
      if (heading) heading.textContent = currentRole === "salesman" ? "Salesman Dashboard" : "Admin Panel";
      document.querySelectorAll(".admin-only-tab").forEach(el => el.classList.toggle("hidden", currentRole !== "admin"));
      $("productForm")?.classList.toggle("hidden", currentRole === "salesman");

      await loadAdminData();
    } catch (error) {
      console.error("Login error:", error);
      errorBox.textContent = `Login failed: ${errorText(error)}`;
    }
  }

  async function logoutAdmin() {
    try {
      await auth.signOut();
      $("adminModal")?.classList.add("hidden");
    } catch (error) {
      console.error("Logout error:", error);
    }
  }

  async function loadAdminData() {
    await Promise.all([loadProducts(), loadOrders()]);

    renderProducts();
    renderAdminProducts();
    renderOrders();
    renderSalesDashboard();
    fillSaleProducts();
    fillCustomers();
    if (currentRole === "admin") await loadSalesmen();
    $("salesmenTab")?.classList.toggle("hidden", currentRole !== "admin");
    $("productForm")?.classList.toggle("hidden", currentRole === "salesman");
  }

  function showAdminPanel(name) {
    const panels = {
      dashboard: "dashboardPanel",
      sale: "salePanel",
      products: "productsPanel",
      orders: "ordersPanel",
      salesmen: "salesmenPanel"
    };

    Object.values(panels).forEach(id => {
      $(id)?.classList.add("hidden");
    });

    $(panels[name])?.classList.remove("hidden");

    document.querySelectorAll(".admin-tab").forEach(tab => {
      tab.classList.remove("active");
    });

    $(`${name}Tab`)?.classList.add("active");

    if (name === "dashboard") renderSalesDashboard();
    if (name === "products") renderAdminProducts();
    if (name === "orders") renderOrders();
    if (name === "sale") { fillSaleProducts(); fillCustomers(); }
    if (name === "salesmen" && currentRole === "admin") loadSalesmen();
    if (name === "products" && currentRole === "salesman") renderSalesmanProducts();
  }

  function renderSalesmanProducts() {
    const box = $("adminProducts");
    if (!box) return;
    box.innerHTML = products.length ? products.map(product => {
      const rate = Number(salesmanRates[product.id] ?? product.salePrice ?? 0);
      return `<div class="admin-product salesman-rate-card"><img src="${product.image || placeholderImage()}" alt="${escapeHtml(product.name)}"><div><strong>${escapeHtml(product.name)}</strong><small><br>Admin rate: ${money(product.salePrice)}</small></div><div class="salesman-rate-editor"><input type="number" min="0" step="0.01" value="${rate}" data-salesman-rate="${escapeHtml(product.id)}"><button class="secondary-button" data-save-salesman-rate="${escapeHtml(product.id)}">Save Rate</button></div></div>`;
    }).join("") : `<p class="modal-subtitle">No products added yet.</p>`;
    box.querySelectorAll("[data-save-salesman-rate]").forEach(btn => btn.onclick = () => saveSalesmanRate(btn.dataset.saveSalesmanRate));
  }

  async function saveSalesmanRate(productId) {
    const input = document.querySelector(`[data-salesman-rate="${CSS.escape(productId)}"]`);
    const rate = Number(input?.value);
    if (!Number.isFinite(rate) || rate < 0) { alert("Valid rate डालें।"); return; }
    salesmanRates[productId] = rate;
    try {
      await db.collection("users").doc(auth.currentUser.uid).set({ rates: salesmanRates, updatedAt: Date.now() }, { merge: true });
      await db.collection("publicSalesmen").doc(auth.currentUser.uid).set({ role: "salesman", rates: salesmanRates, updatedAt: Date.now(), name: currentProfile?.name || "Salesman", number: currentProfile?.number || "", active: currentProfile?.active !== false }, { merge: true });
      fillSaleProducts();
      alert("Personal salesman rate save हो गया। Admin product rate नहीं बदला गया।");
    } catch (error) { alert(`Rate save नहीं हुआ: ${errorText(error)}`); }
  }

  function renderAdminProducts() {
    const box = $("adminProducts");
    if (!box) return;

    box.innerHTML = products.length
      ? products.map(product => `
          <div class="admin-product">
            <img src="${product.image || placeholderImage()}"
                 alt="${escapeHtml(product.name)}">

            <div>
              <strong>${escapeHtml(product.name)}</strong>
              <small>
                <br>Sale: ${money(product.salePrice)}
                <br>Actual: ${money(product.actualPrice)}
              </small>
            </div>

            <div class="admin-product-actions">
              <button class="secondary-button"
                      data-edit="${escapeHtml(product.id)}">
                Edit
              </button>

              <button class="delete-button"
                      data-delete-product="${escapeHtml(product.id)}">
                Delete
              </button>
            </div>
          </div>
        `).join("")
      : "<p class='modal-subtitle'>No products added yet.</p>";

    box.querySelectorAll("[data-edit]").forEach(button => {
      button.onclick = () => editProduct(button.dataset.edit);
    });

    box.querySelectorAll("[data-delete-product]").forEach(button => {
      button.onclick = () => deleteProduct(button.dataset.deleteProduct);
    });
  }

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        resolve("");
        return;
      }

      if (!file.type.startsWith("image/")) {
        reject(new Error("Only image files are allowed."));
        return;
      }

      const reader = new FileReader();

      reader.onload = event => {
        const image = new Image();

        image.onload = () => {
          const maxSize = 800;
          const scale = Math.min(
            1,
            maxSize / Math.max(image.width, image.height)
          );

          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));

          const context = canvas.getContext("2d");
          context.drawImage(image, 0, 0, canvas.width, canvas.height);

          resolve(canvas.toDataURL("image/jpeg", 0.7));
        };

        image.onerror = () => reject(new Error("Image load नहीं हो सकी।"));
        image.src = event.target.result;
      };

      reader.onerror = () => reject(new Error("Image read नहीं हो सकी।"));
      reader.readAsDataURL(file);
    });
  }

  async function saveProduct(event) {
    event.preventDefault();

    const saveButton = $("saveButton");
    const id = $("productId").value.trim();
    const oldProduct = products.find(item => item.id === id);

    const name = $("productName").value.trim();
    const description = $("productDescription").value.trim();
    const actualPrice = Number($("actualPrice").value);
    const salePrice = Number($("salePrice").value);

    if (!name || !description) {
      alert("Product name और description भरें।");
      return;
    }

    if (
      !Number.isFinite(actualPrice) ||
      !Number.isFinite(salePrice) ||
      actualPrice < 0 ||
      salePrice < 0
    ) {
      alert("Price सही भरें।");
      return;
    }

    if (!auth?.currentUser) {
      alert("Product add करने से पहले admin login करें।");
      return;
    }

    try {
      saveButton.disabled = true;
      saveButton.textContent = id ? "Updating..." : "Saving...";

      const selectedFile = $("productImage")?.files?.[0];
      const image = selectedFile
        ? await compressImage(selectedFile)
        : oldProduct?.image || "";

      const data = {
        name,
        description,
        actualPrice,
        salePrice,
        image,
        createdAt: oldProduct?.createdAt || Date.now(),
        updatedAt: Date.now()
      };

      if (id) {
        await db.collection("products").doc(id).update(data);
      } else {
        await db.collection("products").add(data);
      }

      await loadProducts();
      renderProducts();
      renderAdminProducts();
      fillSaleProducts();
      resetProductForm();

      alert(id
        ? "Product successfully update हो गया।"
        : "Product successfully add हो गया।"
      );
    } catch (error) {
      console.error("Product save error:", error);
      alert(`Product save नहीं हुआ: ${errorText(error)}`);
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = $("productId").value
        ? "Update Product"
        : "Add Product";
    }
  }

  function editProduct(id) {
    const product = products.find(item => item.id === id);
    if (!product) return;

    $("productId").value = id;
    $("productName").value = product.name || "";
    $("productDescription").value = product.description || "";
    $("actualPrice").value = product.actualPrice ?? "";
    $("salePrice").value = product.salePrice ?? "";
    $("saveButton").textContent = "Update Product";
    $("cancelEdit")?.classList.remove("hidden");
  }

  async function deleteProduct(id) {
    if (!confirm("यह product delete करें?")) return;

    try {
      await db.collection("products").doc(id).delete();
      await loadProducts();
      renderProducts();
      renderAdminProducts();
      fillSaleProducts();
    } catch (error) {
      alert(`Delete नहीं हुआ: ${errorText(error)}`);
    }
  }

  function resetProductForm() {
    $("productForm")?.reset();
    $("productId").value = "";
    $("saveButton").textContent = "Add Product";
    $("cancelEdit")?.classList.add("hidden");
  }

  function fillSaleProducts() {
    const select = $("saleProduct");
    if (!select) return;

    select.innerHTML = `
      <option value="">Choose product</option>
      ${products.map(product => `
        <option value="${escapeHtml(product.id)}">
          ${escapeHtml(product.name)} - ${money(currentRole === "salesman" ? (salesmanRates[product.id] ?? product.salePrice) : product.salePrice)}
        </option>
      `).join("")}
    `;

    select.onchange = () => {
      const product = products.find(item => item.id === select.value);
      if ($("saleRate")) {
        $("saleRate").value = product ? (currentRole === "salesman" ? (salesmanRates[product.id] ?? product.salePrice) : product.salePrice) : "";
      }
    };
  }

  function fillCustomers() {
    const select = $("saleCustomerName");
    if (!select) return;

    const customers = [...new Map(
      orders
        .filter(order => order.customer?.number)
        .map(order => [order.customer.number, order.customer])
    ).values()];

    select.innerHTML = `
      <option value="">New customer</option>
      ${customers.map(customer => `
        <option value="${escapeHtml(customer.name)}">
          ${escapeHtml(customer.name)} - ${escapeHtml(customer.number)}
        </option>
      `).join("")}
    `;
  }

  function handleSelfSaleCustomerChange() {
    const select = $("saleCustomerName");
    const customer = orders.find(order => order.customer?.number && order.customer?.name === select?.value)?.customer;
    const isExisting = Boolean(select?.value);

    $("newSaleCustomerNameGroup")?.classList.toggle("hidden", isExisting);
    if (isExisting && customer) {
      $("saleCustomerNumber").value = customer.number || "";
      $("saleCustomerType").value = customer.type || "";
      $("newSaleCustomerName").value = customer.name || "";
    } else if (!isExisting) {
      $("saleCustomerNumber").value = "";
      $("saleCustomerType").value = "";
      $("newSaleCustomerName").value = "";
    }
  }

  function renderSelfSaleItems() {
    const box = $("selfSaleItems");
    if (!box) return;
    const total = selfSaleItems.reduce((sum, item) => sum + item.total, 0);

    box.innerHTML = selfSaleItems.length
      ? selfSaleItems.map((item, index) => `
          <div class="selected-line cart-line">
            <div class="cart-product-name"><strong>${escapeHtml(item.name)}</strong><br><small>${money(item.rate)} × ${item.quantity}</small></div>
            <strong>${money(item.total)}</strong>
            <button type="button" class="delete-button" data-self-sale-remove="${index}">Delete</button>
          </div>
        `).join("")
      : `<p class="modal-subtitle">अभी कोई product add नहीं किया गया है।</p>`;

    if ($("selfSaleTotal")) $("selfSaleTotal").textContent = `Total: ${money(total)}`;

    box.querySelectorAll("[data-self-sale-remove]").forEach(btn => {
      btn.onclick = () => {
        selfSaleItems.splice(Number(btn.dataset.selfSaleRemove), 1);
        renderSelfSaleItems();
      };
    });
  }

  function addSelfSaleProduct() {
    const productId = $("saleProduct")?.value;
    const product = products.find(item => item.id === productId);
    const rate = Number($("saleRate")?.value);
    const quantity = Number($("saleQuantity")?.value);

    if (!product) {
      alert("पहले product चुनें।");
      return;
    }
    if (!Number.isFinite(rate) || rate < 0 || !Number.isInteger(quantity) || quantity < 1) {
      alert("Rate और quantity सही भरें।");
      return;
    }

    const existing = selfSaleItems.find(item => item.productId === productId && Number(item.rate) === rate);
    if (existing) {
      existing.quantity += quantity;
      existing.total = existing.rate * existing.quantity;
    } else {
      selfSaleItems.push({
        productId,
        name: product.name,
        rate,
        quantity,
        total: rate * quantity
      });
    }
    renderSelfSaleItems();
    $("saleProduct").value = "";
    $("saleQuantity").value = "1";
    $("saleRate").value = "";
  }

  async function saveSelfSale(event) {
    event.preventDefault();
    if (!auth?.currentUser) {
      alert("Login required.");
      return;
    }
    if (!selfSaleItems.length) {
      alert("कम से कम एक product Add Product से जोड़ें।");
      return;
    }

    const existingName = $("saleCustomerName")?.value.trim();
    const name = existingName || $("newSaleCustomerName")?.value.trim();
    const number = $("saleCustomerNumber")?.value.trim();
    const type = $("saleCustomerType")?.value;
    const total = selfSaleItems.reduce((sum, item) => sum + item.total, 0);
    const paid = Number($("salePaid")?.value || 0);

    if (!name || !/^[0-9]{10}$/.test(number) || !type) {
      alert("Customer name, valid 10-digit mobile और customer type भरें।");
      return;
    }
    if (!Number.isFinite(paid) || paid < 0 || paid > total) {
      alert("Payment received amount सही भरें।");
      return;
    }

    const sale = {
      clientId: `SELF-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      createdAt: Date.now(),
      date: new Date().toLocaleString("en-IN"),
      source: "self-sale",
      status: paid >= total ? "received" : "accepted",
      customer: { name, number, type, address: "" },
      items: selfSaleItems.map(item => ({ id: item.productId, name: item.name, quantity: item.quantity, price: item.rate, total: item.total })),
      total,
      originalTotal: total,
      returnedTotal: 0,
      netTotal: total,
      paidAmount: paid,
      dueAmount: Math.max(0, total - paid),
      paymentMethod: $("salePayment")?.value || "Manual",
      salesmanId: currentRole === "salesman" ? auth.currentUser.uid : null,
      salesmanName: currentRole === "salesman" ? (currentProfile?.name || auth.currentUser.email) : null,
      paymentHistory: paid > 0 ? [{
        amount: paid,
        date: new Date().toLocaleDateString("en-IN"),
        time: new Date().toLocaleTimeString("en-IN"),
        timestamp: Date.now(),
        method: $("salePayment")?.value || "Manual"
      }] : []
    };

    try {
      await db.collection("orders").add(sale);
      selfSaleItems = [];
      $("selfSaleForm")?.reset();
      $("newSaleCustomerNameGroup")?.classList.remove("hidden");
      renderSelfSaleItems();
      await loadOrders();
      renderOrders();
      renderSalesDashboard();
      fillCustomers();
      alert("Self Sale successfully save हो गई।");
    } catch (error) {
      alert(`Self Sale save नहीं हुई: ${errorText(error)}`);
    }
  }

  async function submitOrder(event) {
    event.preventDefault();
    if (window.__cocoOrderWorking) return;
    window.__cocoOrderWorking = true;

    const items = cartItems();
    if (!items.length) {
      window.__cocoOrderWorking = false;
      return;
    }

    const total = items.reduce((sum, item) => sum + item.total, 0);
    const clientId = `CB-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    const data = {
      clientId,
      createdAt: Date.now(),
      date: new Date().toLocaleString("en-IN"),
      source: "online",
      status: "pending",
      customer: {
        name: $("customerName").value.trim(),
        number: $("customerNumber").value.trim(),
        address: $("customerAddress").value.trim(),
        type: $("customerType").value
      },
      items,
      returns: [],
      total,
      originalTotal: total,
      returnedTotal: 0,
      netTotal: total,
      paidAmount: 0,
      dueAmount: total,
      paymentMethod: "WhatsApp",
      paymentHistory: [],
      salesmanId: publicSalesmanId || null,
      salesmanName: publicSalesmanProfile?.name || null,
      salesmanNumber: publicSalesmanProfile?.number || null
    };
    data.status = publicSalesmanId ? "salesman_pending" : "pending";

    const saveCloud = async () => {
      await db.collection("orders").add(data);
    };

    try {
      // Try immediately; if the network is temporarily unavailable,
      // Firestore offline persistence will queue the write and sync later.
      await saveCloud();

      localStorage.removeItem("cocobiz_pending_order_" + clientId);

      const message = [
        "*CocoBiz NEW ORDER*",
        `Order ID: ${clientId}`,
        "",
        ...items.map(item => `${item.name} × ${item.quantity} = ${money(item.total)}`),
        "",
        `Total: ${money(total)}`,
        `Name: ${data.customer.name}`,
        `Mobile: ${data.customer.number}`,
        `Address: ${data.customer.address}`,
        `Type: ${data.customer.type}`
      ].join("\n");

      const targetNumber = data.salesmanNumber ? String(data.salesmanNumber).replace(/\D/g, "") : WHATSAPP_NUMBER;
      const normalizedTarget = targetNumber.length === 10 ? "91" + targetNumber : targetNumber;
      const waUrl = `https://wa.me/${normalizedTarget}?text=${encodeURIComponent(message)}`;
      try { window.open(waUrl, "_blank"); } catch {}

      showOrderSuccess(data.customer.number, clientId);

      cart = {};
      updateCart();
      $("orderForm").reset();
      $("orderModal")?.classList.add("hidden");
    } catch (error) {
      // Keep a local copy so it can be retried automatically after connectivity returns.
      localStorage.setItem(
        "cocobiz_pending_order_" + clientId,
        JSON.stringify(data)
      );

      alert(`Order cloud par save nahi hua: ${errorText(error)}\n\nInternet/Firebase connection theek hote hi retry kiya ja sakta hai.`);
    } finally {
      window.__cocoOrderWorking = false;
    }
  }

  function showOrderSuccess(customerNumber, orderId) {
    const modal = $("orderSuccessModal");
    if (!modal) return;

    const contact = String(customerNumber || "").replace(/\D/g, "");
    const whatsapp = contact.length === 10 ? "91" + contact : contact;

    const wa = $("successWhatsApp");
    const call = $("successCall");

    if (wa) {
      wa.href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(`CocoBiz order ${orderId} successfully received. Customer: ${customerNumber || "N/A"}`)}`;
    }
    if (call) call.href = `tel:${WHATSAPP_NUMBER}`;

    if ($("successOrderId")) $("successOrderId").textContent = orderId;
    modal.classList.remove("hidden");
  }

  async function retryPendingOrders() {
    if (!db || !navigator.onLine) return;

    const keys = Object.keys(localStorage)
      .filter(key => key.startsWith("cocobiz_pending_order_"));

    for (const key of keys) {
      try {
        const order = JSON.parse(localStorage.getItem(key));
        if (!order?.clientId) continue;
        await db.collection("orders").add(order);
        localStorage.removeItem(key);
        console.log("Pending order cloud sync ho gaya:", order.clientId);
      } catch (error) {
        console.warn("Pending order sync failed:", error);
      }
    }
  }

  function renderOrders() {
    const box = $("adminOrders");
    if (!box) return;

    if ($("orderCount")) $("orderCount").textContent = orders.length;

    box.innerHTML = orders.length
      ? orders.map(order => {
          const returned = Array.isArray(order.returns) ? order.returns : [];
          const returnedTotal = Number(order.returnedTotal || returned.reduce((x, r) => x + Number(r.total || 0), 0));
          const netTotal = Number(order.netTotal ?? (Number(order.total || 0) - returnedTotal));
          const paid = Number(order.paidAmount || 0);
          const due = Math.max(0, Number(order.dueAmount ?? netTotal - paid));

          return `
          <div class="admin-order" data-order-card="${escapeHtml(order.id)}">
            <div class="order-heading-row">
              <div>
                <strong>Order #${escapeHtml(order.id)}</strong>
                <small>${escapeHtml(order.date || "")}</small>
              </div>
              <span class="status-badge">${escapeHtml(order.status || "pending")}</span>
            </div>

            <p>
              ${order.salesmanName ? `<span class="salesman-tag">👤 ${escapeHtml(order.salesmanName)}</span><br>` : ""}
              <b>${escapeHtml(order.customer?.name || "Customer")}</b><br>
              Mobile: ${escapeHtml(order.customer?.number || "")}<br>
              ${escapeHtml(order.customer?.address || "")}
            </p>

            ${(order.items || []).map(item => `
              <div class="selected-line">
                <span>${escapeHtml(item.name)} × ${item.quantity}</span>
                <strong>${money(item.total)}</strong>
              </div>
            `).join("")}

            ${returned.length ? `
              <div class="return-box">
                <strong>Returned items</strong>
                ${returned.map(r => `
                  <div class="selected-line return-line">
                    <span>${escapeHtml(r.name)} × ${r.quantity}</span>
                    <strong>- ${money(r.total)}</strong>
                  </div>
                `).join("")}
              </div>` : ""}

            <div class="order-grand-total">
              Original: ${money(order.total)}<br>
              ${returnedTotal ? `Returned: -${money(returnedTotal)}<br>` : ""}
              <strong>Net Total: ${money(netTotal)}</strong><br>
              <span>Paid: ${money(paid)} · Due: ${money(due)}</span>
            </div>

            <div class="admin-order-actions">
              ${currentRole === "admin" && ["pending","pending_admin"].includes(order.status) ? `<button class="primary-button" data-accept-order="${escapeHtml(order.id)}">✓ Accept Order</button>` : ""}
              ${currentRole === "salesman" && order.salesmanId === auth.currentUser?.uid && order.status === "salesman_pending" ? `<button class="primary-button" data-accept-order="${escapeHtml(order.id)}">✓ Accept & Send to Admin</button>` : ""}
              ${due > 0 && ["accepted","received"].includes(order.status) ? `<button class="secondary-button" data-payment-order="${escapeHtml(order.id)}">💰 Received Payment</button>` : ""}
              <button class="secondary-button" data-return-order="${escapeHtml(order.id)}">↩ Return Item</button>
              <button class="secondary-button" data-bill-order="${escapeHtml(order.id)}">🧾 Bill</button>
              <a class="secondary-button" href="tel:${escapeHtml(order.customer?.number || "")}">☎ Contact</a>
              ${(currentRole === "admin" || (currentRole === "salesman" && order.salesmanId === auth.currentUser?.uid && ["salesman_pending","pending_admin"].includes(order.status))) ? `<button class="delete-button" data-delete-order="${escapeHtml(order.id)}">🗑 Delete Order</button>` : ""}
            </div>
          </div>`;
        }).join("")
      : "<p class='modal-subtitle'>No orders yet.</p>";
  }

  async function updateOrderStatus(orderId) {
    const order = orders.find(item => item.id === orderId);
    if (!order) return;
    let status = "accepted";
    let message = "Order accepted successfully.";
    if (currentRole === "salesman" && order.salesmanId === auth.currentUser?.uid && order.status === "salesman_pending") {
      status = "pending_admin";
      message = "Salesman ने order accept कर दिया. अब Admin approval pending है.";
    } else if (currentRole !== "admin") return;
    try {
      await db.collection("orders").doc(orderId).update({ status, salesmanAcceptedAt: status === "pending_admin" ? Date.now() : (order.salesmanAcceptedAt || null), acceptedAt: status === "accepted" ? Date.now() : (order.acceptedAt || null), updatedAt: Date.now() });
      await loadOrders(); renderOrders(); renderSalesDashboard(); if(currentRole === "admin") renderSalesmen();
      alert(message);
    } catch(error) { alert(`Order status update नहीं हुआ: ${errorText(error)}`); }
  }

  async function receivePayment(orderId) {
    const order = orders.find(item => item.id === orderId);
    if (!order) return;

    const netTotal = Number(order.netTotal ?? order.total ?? 0);
    const alreadyPaid = Number(order.paidAmount || 0);
    const remaining = Math.max(0, netTotal - alreadyPaid);
    if (remaining <= 0) {
      alert("इस order की पूरी payment already received है।");
      return;
    }

    const raw = prompt(`Payment received amount डालें. Remaining: ${money(remaining)}`, String(remaining));
    if (raw === null) return;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0 || amount > remaining) {
      alert("Valid amount डालें और remaining amount से ज्यादा नहीं होना चाहिए।");
      return;
    }

    const paidAmount = alreadyPaid + amount;
    const dueAmount = Math.max(0, netTotal - paidAmount);
    const paymentEntry = {
      amount,
      date: new Date().toLocaleDateString("en-IN"),
      time: new Date().toLocaleTimeString("en-IN"),
      timestamp: Date.now(),
      method: "Manual"
    };
    const paymentHistory = [...(order.paymentHistory || []), paymentEntry];

    try {
      await db.collection("orders").doc(orderId).update({
        paidAmount,
        dueAmount,
        paymentReceived: true,
        paymentReceivedAt: Date.now(),
        paymentHistory,
        status: dueAmount === 0 ? "received" : (order.status || "accepted"),
        updatedAt: Date.now()
      });
      await loadOrders();
      renderOrders();
      renderSalesDashboard();
      alert(`Payment ${money(amount)} received successfully.`);
    } catch (error) {
      alert(`Payment save नहीं हुआ: ${errorText(error)}`);
    }
  }

  async function deleteOrder(orderId) {
    if (!confirm("क्या आप इस order को permanently delete करना चाहते हैं?")) return;
    try {
      await db.collection("orders").doc(orderId).delete();
      await loadOrders();
      renderOrders();
      renderSalesDashboard();
      alert("Order deleted successfully.");
    } catch (error) {
      alert(`Order delete नहीं हुआ: ${errorText(error)}`);
    }
  }

  function customerKey(order) {
    return String(order.customer?.number || order.customer?.name || "unknown").trim().toLowerCase();
  }

  function renderAcceptedOrderFolders() {
    const box = $("acceptedOrderFolders");
    if (!box) return;

    const accepted = orders.filter(order => ["accepted", "received"].includes(order.status));
    const groups = new Map();

    accepted.forEach(order => {
      const key = customerKey(order);
      if (!groups.has(key)) {
        groups.set(key, {
          customer: order.customer || {},
          orders: []
        });
      }
      groups.get(key).orders.push(order);
    });

    if ($("acceptedOrderTotal")) $("acceptedOrderTotal").textContent = groups.size;

    if (!groups.size) {
      box.innerHTML = `<div class="folder-empty">📁 अभी कोई accepted customer नहीं है।</div>`;
      return;
    }

    box.innerHTML = [...groups.entries()].map(([key, group]) => {
      const total = group.orders.reduce((sum, o) => sum + Number(o.netTotal ?? o.total ?? 0), 0);
      const paid = group.orders.reduce((sum, o) => sum + Number(o.paidAmount || 0), 0);
      const due = Math.max(0, total - paid);
      const encoded = encodeURIComponent(key);

      return `
        <div class="order-folder customer-folder">
          <div class="folder-icon">📁</div>
          <div class="folder-content">
            <strong>${escapeHtml(group.customer.name || "Customer")}</strong>
            <small>📞 ${escapeHtml(group.customer.number || "No mobile")}</small>
            <small>${group.orders.length} accepted order(s)</small>
            <b>Due: ${money(due)}</b>
          </div>
          <button class="secondary-button" data-customer-folder="${encoded}">Open</button>
        </div>`;
    }).join("");

    box.querySelectorAll("[data-customer-folder]").forEach(button => {
      button.onclick = () => openCustomerAccount(decodeURIComponent(button.dataset.customerFolder));
    });
  }

  function openCustomerAccount(key) {
    const accepted = orders.filter(order =>
      ["accepted", "received"].includes(order.status) && customerKey(order) === key
    );
    if (!accepted.length) return;

    const customer = accepted[0].customer || {};
    const total = accepted.reduce((sum, o) => sum + Number(o.netTotal ?? o.total ?? 0), 0);
    const paid = accepted.reduce((sum, o) => sum + Number(o.paidAmount || 0), 0);
    const due = Math.max(0, total - paid);

    const modal = $("customerAccountModal");
    const body = $("customerAccountBody");
    if (!modal || !body) return;

    body.innerHTML = `
      <div class="account-head">
        <div><h2>${escapeHtml(customer.name || "Customer")}</h2>
        <p>${escapeHtml(customer.number || "")}<br>${escapeHtml(customer.address || "")}</p></div>
        <div class="account-summary">
          <div><small>Total</small><b>${money(total)}</b></div>
          <div><small>Paid</small><b>${money(paid)}</b></div>
          <div><small>Due</small><b>${money(due)}</b></div>
        </div>
      </div>

      ${accepted.map(order => {
        const orderTotal = Number(order.netTotal ?? order.total ?? 0);
        const orderPaid = Number(order.paidAmount || 0);
        const orderDue = Math.max(0, orderTotal - orderPaid);
        const history = Array.isArray(order.paymentHistory) ? order.paymentHistory : [];
        return `
          <div class="account-order">
            <div class="order-heading-row">
              <div><strong>Order #${escapeHtml(order.id)}</strong><small>${escapeHtml(order.date || "")}</small></div>
              <span class="status-badge">${escapeHtml(order.status || "")}</span>
            </div>
            ${(order.items || []).map(i => `<div class="selected-line"><span>${escapeHtml(i.name)} × ${i.quantity}</span><b>${money(i.total)}</b></div>`).join("")}
            <div class="order-grand-total">Order Total: ${money(orderTotal)} · Paid: ${money(orderPaid)} · <strong>Due: ${money(orderDue)}</strong></div>
            <h4>💰 Payment History</h4>
            ${history.length ? history.map(p => `<div class="payment-history-row"><span>${escapeHtml(p.date)} ${escapeHtml(p.time)}</span><b>${money(p.amount)}</b><small>${escapeHtml(p.method || "Payment")}</small></div>`).join("") : `<p class="modal-subtitle">No payment received yet.</p>`}
          </div>`;
      }).join("")}
    `;

    modal.classList.remove("hidden");
  }

  async function processReturn(orderId) {
    const order = orders.find(item => item.id === orderId);
    if (!order) return;

    const available = (order.items || []).filter(item => {
      const returnedQty = (order.returns || [])
        .filter(r => r.productId === item.id)
        .reduce((sum, r) => sum + Number(r.quantity || 0), 0);
      return Number(item.quantity) - returnedQty > 0;
    });

    if (!available.length) {
      alert("Is order ke saare items already return ho chuke hain.");
      return;
    }

    const choices = available.map((item, index) =>
      `${index + 1}. ${item.name} (available: ${item.quantity})`
    ).join("\n");

    const selected = Number(prompt(`Return karne wala product number likhein:\n\n${choices}`));
    if (!Number.isInteger(selected) || selected < 1 || selected > available.length) return;

    const item = available[selected - 1];
    const alreadyReturned = (order.returns || [])
      .filter(r => r.productId === item.id)
      .reduce((sum, r) => sum + Number(r.quantity || 0), 0);
    const maxQty = Number(item.quantity) - alreadyReturned;

    const qty = Number(prompt(`"${item.name}" ki kitni quantity return hui? (1-${maxQty})`, "1"));
    if (!Number.isInteger(qty) || qty < 1 || qty > maxQty) {
      alert("Invalid quantity.");
      return;
    }

    const returnEntry = {
      productId: item.id,
      name: item.name,
      quantity: qty,
      price: Number(item.price || 0),
      total: Number(item.price || 0) * qty,
      date: new Date().toLocaleString("en-IN")
    };

    const returns = [...(order.returns || []), returnEntry];
    const returnedTotal = returns.reduce((sum, r) => sum + Number(r.total || 0), 0);
    const netTotal = Math.max(0, Number(order.total || 0) - returnedTotal);
    const paidAmount = Math.min(Number(order.paidAmount || 0), netTotal);
    const dueAmount = Math.max(0, netTotal - paidAmount);

    try {
      await db.collection("orders").doc(orderId).update({
        returns,
        returnedTotal,
        netTotal,
        paidAmount,
        dueAmount,
        updatedAt: Date.now()
      });

      await loadOrders();
      renderOrders();
      renderSalesDashboard();
      alert("Return successfully save ho gaya. Bill me bhi return show hoga.");
    } catch (error) {
      alert(`Return save nahi hua: ${errorText(error)}`);
    }
  }

  function printOrderBill(orderId) {
    const order = orders.find(item => item.id === orderId);
    if (!order) return;

    const returned = Array.isArray(order.returns) ? order.returns : [];
    const returnedTotal = Number(order.returnedTotal || 0);
    const originalTotal = Number(order.originalTotal ?? order.total ?? 0);
    const netTotal = Number(order.netTotal ?? Math.max(0, originalTotal - returnedTotal));
    const paid = Number(order.paidAmount || 0);
    const due = Math.max(0, Number(order.dueAmount ?? netTotal - paid));
    const history = Array.isArray(order.paymentHistory) ? order.paymentHistory : [];
    const status = order.status || "accepted";
    const customer = order.customer || {};
    const orderDate = order.date || new Date(order.createdAt || Date.now()).toLocaleString("en-IN");

    const rows = (order.items || []).map(item => `
      <tr>
        <td>${escapeHtml(item.name)}</td>
        <td class="text-center">${Number(item.quantity || 0)}</td>
        <td class="text-right">${Number(item.total || 0).toFixed(2)}</td>
      </tr>
    `).join("");

    const returnRows = returned.map(item => `
      <tr class="returned-row">
        <td>${escapeHtml(item.name)} <span class="return-label">(Returned)</span></td>
        <td class="text-center">-${Number(item.quantity || 0)}</td>
        <td class="text-right">-${Number(item.total || 0).toFixed(2)}</td>
      </tr>
    `).join("");

    const paymentDetails = history.length
      ? history.map(p => `
          <div class="payment-row">
            <span>${escapeHtml(p.date || "")} ${escapeHtml(p.time || "")}</span>
            <b>₹${Number(p.amount || 0).toFixed(2)}</b>
            <small>${escapeHtml(p.method || "Payment")}</small>
          </div>
        `).join("")
      : `<span class="muted">No payment received yet.</span>`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CocoBiz Bill - ${escapeHtml(order.id)}</title>
<style>
  body{font-family:Arial,sans-serif;background:#f6eee7;margin:0;padding:20px;color:#3f2a20}
  .bill-container{max-width:650px;margin:0 auto;background:#fff;padding:30px;border-radius:12px;box-shadow:0 8px 24px rgba(75,45,28,.12);border-top:5px solid #8b4a2f}
  .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #ead9cb;padding-bottom:18px;margin-bottom:20px;gap:20px}
  .brand{display:flex;align-items:center;gap:10px;margin-bottom:7px}
  .brand-logo{width:42px;height:42px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#6f3b24,#d8954d);color:#fff5df;font-size:22px;font-weight:bold;box-shadow:0 4px 10px rgba(111,59,36,.22)}
  .brand-title{font-size:28px;font-weight:bold;color:#5a301f;margin:0}
  .brand-title em{color:#d58a3b;font-style:normal}
  .company-info{font-size:13px;color:#715f55;line-height:1.5}
  .order-meta{text-align:right;font-size:13px;line-height:1.5;color:#5e514b}
  .status-badge{display:inline-block;background:#fff0dc;color:#8b4a2f;padding:4px 11px;border-radius:12px;font-size:12px;font-weight:bold;text-transform:capitalize;margin-top:4px}
  .customer-section{background:linear-gradient(135deg,#fff8f1,#f9eee5);padding:14px 18px;border-radius:8px;margin-bottom:25px;font-size:14px;line-height:1.6;border:1px solid #f0dfd1}
  .section-title{font-size:16px;font-weight:bold;margin-bottom:10px;color:#5a301f;border-bottom:2px solid #d8954d;padding-bottom:6px}
  table{width:100%;border-collapse:collapse;margin-bottom:20px;font-size:14px;overflow:hidden;border-radius:7px}
  th{background:#7b432b;color:#fff;text-align:left;padding:10px 12px;border-bottom:2px solid #63351f}
  td{padding:10px 12px;border-bottom:1px solid #f0e3da}
  .text-center{text-align:center}.text-right{text-align:right}
  .total-row td{font-weight:bold;border-top:2px solid #d8954d;background:#fff8f1;border-bottom:none;font-size:15px}
  .returned-row{color:#a0442c;background:#fff3ef}.return-label{font-size:12px;font-weight:bold}
  .payment-signature-grid{display:flex;justify-content:space-between;gap:25px;margin-top:25px;padding-top:15px;border-top:1px solid #ead9cb}
  .payment-details{font-size:13px;line-height:1.6;min-width:55%}
  .payment-row{display:grid;grid-template-columns:1fr auto;gap:3px 12px;padding:7px 0;border-bottom:1px solid #f0e3da}
  .payment-row b{color:#7b432b}
  .payment-row small{grid-column:1/-1;color:#8a776c}
  .signature-block{text-align:center;margin-top:30px}
  .signature-line{border-top:1px dashed #b08a73;width:180px;margin-bottom:6px}
  .signature-text{font-size:12px;color:#6b7280}
  .print-actions{text-align:center;margin-top:24px}.print-actions button{border:0;border-radius:7px;padding:10px 18px;cursor:pointer;font-weight:bold}
  .muted{color:#6b7280}
  @media(max-width:600px){body{padding:8px}.bill-container{padding:18px}.header{flex-direction:column}.order-meta{text-align:left}.payment-signature-grid{flex-direction:column}.signature-block{align-self:flex-end}}
  @media print{body{background:#fff;padding:0}.bill-container{box-shadow:none;max-width:none}.print-actions{display:none}}
</style>
</head>
<body>
<div class="bill-container">
  <div class="header">
    <div>
      <div class="brand">
        <div class="brand-logo">✦</div>
        <h1 class="brand-title">Coco<em>Biz</em></h1>
      </div>
      <div class="company-info">
        <strong>CocoBiz Chocolate</strong><br>
        Phone: 7463928290<br>
        Email: kunalkrverma5555@gmail.com
      </div>
    </div>
    <div class="order-meta">
      <div><strong>Order ID:</strong> ${escapeHtml(order.id)}</div>
      <div><strong>Date &amp; Time:</strong> ${escapeHtml(orderDate)}</div>
      <div><strong>Status:</strong> <span class="status-badge">${escapeHtml(status)}</span></div>
    </div>
  </div>

  <div class="customer-section">
    <strong>Customer Details:</strong><br>
    <strong>Customer:</strong> ${escapeHtml(customer.name || "Customer")}<br>
    <strong>Mobile:</strong> ${escapeHtml(customer.number || "")}<br>
    <strong>Address:</strong> ${escapeHtml(customer.address || customer.type || "")}
  </div>

  <div class="section-title">Order Details</div>
  <table>
    <thead><tr><th>Product</th><th class="text-center">Quantity</th><th class="text-right">Amount (₹)</th></tr></thead>
    <tbody>
      ${rows}
      ${returnRows}
      <tr class="total-row"><td colspan="2" class="text-right">Original Total:</td><td class="text-right">₹${originalTotal.toFixed(2)}</td></tr>
      ${returnedTotal ? `<tr><td colspan="2" class="text-right">Returned:</td><td class="text-right">-₹${returnedTotal.toFixed(2)}</td></tr>` : ""}
      <tr class="total-row"><td colspan="2" class="text-right">Net Total:</td><td class="text-right">₹${netTotal.toFixed(2)}</td></tr>
    </tbody>
  </table>

  <div class="payment-signature-grid">
    <div class="payment-details">
      <strong>Payment Details</strong><br>
      ${paymentDetails}<br>
      Total Received: ₹${paid.toFixed(2)}<br>
      <strong>Total Due: ₹${due.toFixed(2)}</strong>
    </div>
    <div class="signature-block">
      <div class="signature-line"></div>
      <div class="signature-text">Authorised Signature</div>
    </div>
  </div>

  <div class="print-actions"><button onclick="window.print()">Print / Save PDF</button></div>
</div>
</body>
</html>`;

    const win = window.open("", "_blank");
    if (win) {
      win.document.open();
      win.document.write(html);
      win.document.close();
    }
  }

  function renderSalesDashboard() {
    const total = orders.reduce((sum, order) => sum + Number(order.netTotal ?? order.total ?? 0), 0);
    const paid = orders.reduce((sum, order) => sum + Number(order.paidAmount || 0), 0);
    const due = orders.reduce((sum, order) => sum + Math.max(0, Number(order.dueAmount ?? (Number(order.netTotal ?? order.total ?? 0) - Number(order.paidAmount || 0)))), 0);

    if ($("todaySale")) $("todaySale").textContent = money(total);
    if ($("todayPaid")) $("todayPaid").textContent = money(paid);
    if ($("todayDue")) $("todayDue").textContent = money(due);
    renderAcceptedOrderFolders();
  }

  async function loadInitialData() {
    await loadPublicSalesmanProfile();
    await Promise.all([loadProducts(), loadOrders()]);
    renderProducts();
    updateCart();
  }

  async function start() {
    bindEvents();

    try {
      await initFirebase();

      auth.onAuthStateChanged(async user => {
        if (!user) {
          currentRole = "admin"; currentProfile = null; salesmanRates = {};
          $("adminModal")?.classList.add("hidden");
          return;
        }

        await loadUserProfile(user);
        if (!$("loginModal")?.classList.contains("hidden")) return;
        const heading = document.querySelector(".admin-heading h2");
        if (heading) heading.textContent = currentRole === "salesman" ? "Salesman Dashboard" : "Admin Panel";
        document.querySelectorAll(".admin-only-tab").forEach(el => el.classList.toggle("hidden", currentRole !== "admin"));
        await loadAdminData();
      });

      await loadInitialData();
      window.addEventListener("online", retryPendingOrders);
      setTimeout(retryPendingOrders, 1500);
    } catch (error) {
      console.error("Firebase initialization error:", error);
      alert(`Firebase connect नहीं हो सका: ${errorText(error)}`);
    }
  }

  start();
})();