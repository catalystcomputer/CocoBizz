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

      orders = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) =>
          Number(b.createdAt || 0) - Number(a.createdAt || 0)
        );

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
            <strong>${money(product.salePrice)}</strong>
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

        const price = Number(product.salePrice || 0);
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
    $("productForm")?.addEventListener("submit", saveProduct);
    $("cancelEdit")?.addEventListener("click", resetProductForm);
    $("orderForm")?.addEventListener("submit", submitOrder);

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
      if (acceptButton) updateOrderStatus(acceptButton.dataset.acceptOrder, "accepted");
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

  async function loginAdmin(event) {
    event.preventDefault();

    const email = $("adminEmail").value.trim();
    const password = $("adminPassword").value;
    const errorBox = $("loginError");

    errorBox.textContent = "Logging in...";

    try {
      await auth.signInWithEmailAndPassword(email, password);

      errorBox.textContent = "";
      $("loginForm").reset();
      $("loginModal")?.classList.add("hidden");
      $("adminModal")?.classList.remove("hidden");

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
  }

  function showAdminPanel(name) {
    const panels = {
      dashboard: "dashboardPanel",
      sale: "salePanel",
      products: "productsPanel",
      orders: "ordersPanel"
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
    if (name === "sale") {
      fillSaleProducts();
      fillCustomers();
    }
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
          ${escapeHtml(product.name)} - ${money(product.salePrice)}
        </option>
      `).join("")}
    `;

    select.onchange = () => {
      const product = products.find(item => item.id === select.value);
      if ($("saleRate")) {
        $("saleRate").value = product?.salePrice ?? "";
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
      paymentMethod: "WhatsApp"
    };

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

      const waUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
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
      wa.href = whatsapp
        ? `https://wa.me/${whatsapp}`
        : `https://wa.me/${WHATSAPP_NUMBER}`;
    }
    if (call) call.href = `tel:${contact || WHATSAPP_NUMBER}`;

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
              <strong>Net Total: ${money(netTotal)}</strong>
            </div>

            <div class="admin-order-actions">
              ${order.status !== "accepted" && order.status !== "received" ? `<button class="primary-button" data-accept-order="${escapeHtml(order.id)}">✓ Accept Order</button>` : ""}
              <button class="secondary-button" data-payment-order="${escapeHtml(order.id)}">💰 Received Payment</button>
              <button class="secondary-button" data-return-order="${escapeHtml(order.id)}">↩ Return Item</button>
              <button class="secondary-button" data-bill-order="${escapeHtml(order.id)}">🧾 Bill</button>
              <a class="secondary-button" href="tel:${escapeHtml(order.customer?.number || "")}">☎ Contact</a>
              <button class="delete-button" data-delete-order="${escapeHtml(order.id)}">🗑 Delete Order</button>
            </div>
          </div>`;
        }).join("")
      : "<p class='modal-subtitle'>No orders yet.</p>";
  }

  async function updateOrderStatus(orderId, status) {
    const order = orders.find(item => item.id === orderId);
    if (!order) return;
    try {
      await db.collection("orders").doc(orderId).update({
        status,
        acceptedAt: status === "accepted" ? Date.now() : (order.acceptedAt || null),
        updatedAt: Date.now()
      });
      await loadOrders();
      renderOrders();
      renderSalesDashboard();
      alert("Order accepted successfully.");
    } catch (error) {
      alert(`Order status update नहीं हुआ: ${errorText(error)}`);
    }
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
    try {
      await db.collection("orders").doc(orderId).update({
        paidAmount,
        dueAmount,
        paymentReceived: true,
        paymentReceivedAt: Date.now(),
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

  function renderAcceptedOrderFolders() {
    const box = $("acceptedOrderFolders");
    if (!box) return;

    const accepted = orders.filter(order => ["accepted", "received"].includes(order.status));
    if (!accepted.length) {
      box.innerHTML = `<div class="folder-empty">📁 अभी कोई accepted order नहीं है।</div>`;
      if ($("acceptedOrderTotal")) $("acceptedOrderTotal").textContent = "0";
      return;
    }

    if ($("acceptedOrderTotal")) $("acceptedOrderTotal").textContent = accepted.length;
    box.innerHTML = accepted.map(order => `
      <div class="order-folder">
        <div class="folder-icon">📁</div>
        <div class="folder-content">
          <strong>${escapeHtml(order.customer?.name || "Customer")}</strong>
          <small>Order #${escapeHtml(order.id)} · ${escapeHtml(order.date || "")}</small>
          <small>${(order.items || []).map(i => `${escapeHtml(i.name)} × ${i.quantity}`).join(" • ")}</small>
          <b>${money(order.netTotal ?? order.total)} · ${escapeHtml(order.status || "accepted")}</b>
        </div>
        <button class="secondary-button" data-dashboard-order="${escapeHtml(order.id)}">View</button>
      </div>
    `).join("");

    box.querySelectorAll("[data-dashboard-order]").forEach(button => {
      button.onclick = () => {
        showAdminPanel("orders");
        setTimeout(() => document.querySelector(`[data-order-card="${CSS.escape(button.dataset.dashboardOrder)}"]`)?.scrollIntoView({behavior:"smooth", block:"center"}), 50);
      };
    });
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
    const netTotal = Number(order.netTotal ?? Number(order.total || 0) - returnedTotal);

    const rows = (order.items || []).map(item => `
      <tr><td>${escapeHtml(item.name)}</td><td>${item.quantity}</td><td>${money(item.total)}</td></tr>
    `).join("");

    const returnRows = returned.map(item => `
      <tr class="returned"><td>${escapeHtml(item.name)} (Returned)</td><td>-${item.quantity}</td><td>-${money(item.total)}</td></tr>
    `).join("");

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>CocoBiz Bill ${escapeHtml(order.id)}</title>
      <style>
        body{font-family:Arial,sans-serif;padding:30px;color:#3b211b}main{max-width:800px;margin:auto}
        header{display:flex;justify-content:space-between;border-bottom:2px solid #3b211b;padding-bottom:15px}
        table{width:100%;border-collapse:collapse;margin-top:25px}th,td{padding:10px;border-bottom:1px solid #ddd;text-align:left}
        td:last-child,th:last-child{text-align:right}.returned{color:#a33}.total{text-align:right;font-size:22px;font-weight:bold;margin-top:18px}
        .muted{color:#777}@media print{button{display:none}}
      </style></head><body><main>
      <header><div><h1>✦ CocoBiz</h1><div>Quality chocolates for every occasion</div></div>
      <div>Bill To:<br><b>${escapeHtml(order.customer?.name || "Customer")}</b><br>${escapeHtml(order.customer?.number || "")}<br>${escapeHtml(order.customer?.address || "")}</div></header>
      <p class="muted">Order ID: ${escapeHtml(order.id)}<br>Date: ${escapeHtml(order.date || "")}</p>
      <table><thead><tr><th>Product</th><th>Qty</th><th>Amount</th></tr></thead><tbody>${rows}${returnRows}</tbody></table>
      <div class="total">Original Total: ${money(order.total)}<br>${returnedTotal ? `Returned: -${money(returnedTotal)}<br>` : ""}Net Total: ${money(netTotal)}<br><small>Paid: ${money(order.paidAmount)} | Due: ${money(order.dueAmount)}</small></div>
      <p style="margin-top:40px">Thank you for choosing CocoBiz ❤️</p><button onclick="window.print()">Print / Save PDF</button>
      </main></body></html>`;

    const win = window.open("", "_blank");
    if (win) {
      win.document.write(html);
      win.document.close();
    }
  }

  function renderSalesDashboard() {
    const total = orders.reduce(
      (sum, order) => sum + Number(order.total || 0), 0
    );

    const paid = orders.reduce(
      (sum, order) => sum + Number(order.paidAmount || 0), 0
    );

    const due = orders.reduce(
      (sum, order) => sum + Number(order.dueAmount || 0), 0
    );

    if ($("todaySale")) $("todaySale").textContent = money(total);
    if ($("todayPaid")) $("todayPaid").textContent = money(paid);
    if ($("todayDue")) $("todayDue").textContent = money(due);
    renderAcceptedOrderFolders();
  }

  async function loadInitialData() {
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
          $("adminModal")?.classList.add("hidden");
          return;
        }

        // Login ke baad hi admin panel open hoga.
        if (!$("loginModal")?.classList.contains("hidden")) return;

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