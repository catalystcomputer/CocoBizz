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
  let activeCategory = "all";
  let selfSaleItems = [];
  let currentRole = "admin";
  let currentProfile = null;
  let salesmanRates = {};
  let salesmen = [];
  let publicSalesmanId = new URLSearchParams(window.location.search).get("salesman") || "";
  let publicSalesmanProfile = null;
  let activeOffer = null;
  let lastCustomerOfferId = null;
  let reportPeriod = "all";
  let knownOrderIds = new Set();
  let notificationPrimed = false;
  let orderPollTimer = null;
  let storeSettings = { deliveryCharge: 0, freeDeliveryAbove: 0, freeDeliveryRadiusKm: 10, platformFeeEnabled: false, platformFeeType: "flat", platformFeeValue: 0, upiEnabled: true, upiId: "kunalverma5555@ibl", upiName: "CocoBiz", upiQrImage: "", onlinePaymentEnabled: false, razorpayKeyId: "", deliveryRadiusKm: 0, deliveryMinDays: 7, deliveryMaxDays: 15, storeLatitude: 26.291018, storeLongitude: 87.2711 };
  let appliedCoupon = null;
  let customerLocation = null;
  const ORDER_STATUSES = [
    ["pending", "Order Placed"], ["accepted", "Confirmed"], ["packed", "Packed"],
    ["shipped", "Shipped"], ["out_for_delivery", "Out for Delivery"], ["delivered", "Delivered"],
    ["cancelled", "Cancelled"], ["returned", "Returned"]
  ];

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

  function offerTime(value) {
    const time = value == null ? 0 : Number(value);
    return Number.isFinite(time) ? time : 0;
  }

  function offerStatus(offer, now = Date.now()) {
    const start = offerTime(offer.startAt);
    const end = offerTime(offer.endAt);
    if (offer.active === false) return "inactive";
    if (start && now < start) return "scheduled";
    if (end && now >= end) return "expired";
    return "active";
  }

  function formatOfferDate(value) {
    const time = offerTime(value);
    if (!time) return "Not set";
    return new Date(time).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  }

  function toDateTimeLocalValue(value) {
    const d = new Date(value);
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function loadOffer() {
    activeOffer = null;
    if (!db) return;
    try {
      // Always prefer the server so a newly scheduled offer is not hidden by
      // a stale Firestore offline cache.
      let snap;
      try { snap = await db.collection("offers").get({ source: "server" }); }
      catch (_) { snap = await db.collection("offers").get(); }

      const now = Date.now();
      const allOffers = [];
      snap.forEach(doc => allOffers.push({ id: doc.id, ...doc.data() }));

      // Pick the offer whose start time is the latest among all currently
      // live offers. This makes back-to-back scheduled offers switch cleanly.
      const eligible = allOffers
        .filter(offer => offerStatus(offer, now) === "active" && offer.image)
        .sort((a, b) => offerTime(b.startAt || b.updatedAt) - offerTime(a.startAt || a.updatedAt));

      if (eligible.length) activeOffer = eligible[0];
      renderOfferAdmin(allOffers);

      // If an admin is logged in, remove expired offers from Firestore.
      // Customers simply stop seeing them automatically; this cleanup keeps
      // the admin list tidy without requiring the customer to delete anything.
      if (currentRole === "admin" && auth?.currentUser) {
        const expired = allOffers.filter(o => offerStatus(o, now) === "expired");
        await Promise.all(expired.map(o => db.collection("offers").doc(o.id).delete().catch(() => null)));
        if (expired.length) {
          const refreshed = await db.collection("offers").get({ source: "server" }).catch(() => null);
          if (refreshed) {
            const remaining = []; refreshed.forEach(doc => remaining.push({ id: doc.id, ...doc.data() }));
            renderOfferAdmin(remaining);
          }
        }
      }
    } catch (e) {
      console.warn("Offer load failed:", e);
    }
  }

  function renderCustomerOffer(force = false) {
    const modal = $("offerModal");
    const imageWrap = $("customerOfferImageWrap");
    const title = $("customerOfferTitle");
    if (!modal || !imageWrap) return;
    if (!activeOffer?.image) {
      modal.classList.add("hidden");
      return;
    }
    // Show on first load and when the scheduled offer changes, but do not reopen
    // the same popup every minute after the customer has closed it.
    if (!force && lastCustomerOfferId === activeOffer.id) return;
    lastCustomerOfferId = activeOffer.id;
    if (title) title.textContent = activeOffer.title || "Special Offer";
    imageWrap.innerHTML = `<img src="${activeOffer.image}" alt="${escapeHtml(activeOffer.title || "CocoBiz Offer")}">`;
    modal.classList.remove("hidden");
  }

  function renderOfferAdmin(allOffers = activeOffer ? [activeOffer] : []) {
    const box = $("offerAdminPreview");
    if (!box) return;
    const sorted = [...allOffers].sort((a,b) => offerTime(b.startAt || b.updatedAt) - offerTime(a.startAt || a.updatedAt));
    if (!sorted.length) {
      box.innerHTML = `<div class="offer-empty-state"><strong>No offers scheduled.</strong><span>Poster, start time aur end time set karke pehla offer schedule karein.</span></div>`;
      return;
    }

    box.innerHTML = sorted.map(offer => {
      const status = offerStatus(offer);
      const badgeClass = status === "active" ? "offer-status-active" : status === "scheduled" ? "offer-status-scheduled" : "offer-status-expired";
      const label = status === "active" ? "LIVE NOW" : status === "scheduled" ? "SCHEDULED" : status === "expired" ? "EXPIRED" : "INACTIVE";
      return `<div class="offer-preview-card ${status === "active" ? "is-live" : ""}">
        <div class="offer-card-heading">
          <div><strong>${escapeHtml(offer.title || "Special Offer")}</strong><small>${formatOfferDate(offer.startAt)} → ${formatOfferDate(offer.endAt)}</small></div>
          <span class="offer-status ${badgeClass}">${label}</span>
        </div>
        ${offer.image ? `<img src="${offer.image}" alt="Offer preview">` : ""}
        <div class="offer-card-actions">
          ${status === "active" ? `<span class="offer-live-note">Customer popup me abhi ye offer dikh raha hai.</span>` : status === "scheduled" ? `<span class="offer-live-note">Start hote hi automatically live hoga.</span>` : `<span class="offer-live-note">Ye offer customer ko nahi dikh raha.</span>`}
          <button class="delete-button" type="button" data-delete-offer="${escapeHtml(offer.id)}">🗑 Delete</button>
        </div>
      </div>`;
    }).join("");
  }

  function compressImage(file, maxSize = 1200, quality = 0.78) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith("image/")) return reject(new Error("Valid image file select करें।"));
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.onerror = () => reject(new Error("Image read नहीं हो सकी।"));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error("Image read नहीं हो सकी।"));
      reader.readAsDataURL(file);
    });
  }

  async function saveOffer(event) {
    event.preventDefault();
    if (currentRole !== "admin") return;
    const file = $("offerImage")?.files?.[0];
    if (!file) { alert("Offer poster select करें।"); return; }
    try {
      const startValue = $("offerStart")?.value;
      const endValue = $("offerEnd")?.value;
      const startAt = new Date(startValue).getTime();
      const endAt = new Date(endValue).getTime();
      if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) { alert("Start aur end date/time सही भरें।"); return; }
      if (endAt <= startAt) { alert("End date/time, start date/time के बाद होना चाहिए।"); return; }
      if (endAt <= Date.now()) { alert("End date/time future में रखें।"); return; }

      const image = await compressImage(file);
      if (image.length > 900000) {
        alert("Image बहुत बड़ी है। थोड़ा छोटा/हल्का poster upload करें।");
        return;
      }
      const title = $("offerTitle")?.value.trim() || "Special Offer";
      await db.collection("offers").add({
        title,
        image,
        active: true,
        startAt,
        endAt,
        updatedAt: Date.now(),
        updatedBy: auth.currentUser.uid
      });
      await loadOffer();
      alert(startAt > Date.now() ? "Offer schedule हो गया। Start time पर automatically live होगा." : "Offer successfully live हो गया।");
      $("offerForm")?.reset();
    } catch (error) {
      alert(`Offer schedule नहीं हुआ: ${errorText(error)}`);
    }
  }

  async function deleteOfferById(id) {
    if (currentRole !== "admin" || !id) return;
    try {
      await db.collection("offers").doc(id).delete();
      await loadOffer();
      if (!activeOffer) $("offerModal")?.classList.add("hidden");
      alert("Offer delete हो गया।");
    } catch (error) {
      alert(`Offer delete नहीं हुआ: ${errorText(error)}`);
    }
  }

  async function deleteOffer() {
    if (currentRole !== "admin") return;
    if (!activeOffer?.id) { alert("अभी कोई live offer नहीं है।"); return; }
    if (!confirm("Live offer delete करना है? Customer को popup दिखना बंद हो जाएगा.")) return;
    await deleteOfferById(activeOffer.id);
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
      // Backfill public tracking records for existing orders.
      if (currentRole === "admin") {
        for (const order of orders.slice(0, 200)) {
          if (order?.clientId) syncPublicTracking(order).catch(() => {});
        }
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
      const category = String(product.category || "gift").toLowerCase();
      const matchesSearch = !searchTerm || haystack.includes(searchTerm);
      const matchesCategory = activeCategory === "all" || category === activeCategory;
      return matchesSearch && matchesCategory;
    });

    $("emptyMessage")?.classList.toggle("hidden", visibleProducts.length > 0);
    $("emptyMessage").textContent = visibleProducts.length ? "" : (products.length ? "No matching products found." : "No products available yet.");

    grid.innerHTML = visibleProducts.map(product => `
      <article class="product-card">
        <img src="${product.image || placeholderImage()}"
             alt="${escapeHtml(product.name)}">

        <div class="product-content">
          <div class="product-category-badge">${product.category === "chocolate" ? "🍫 Chocolate" : product.category === "kitchen" ? "🍳 Kitchen" : "🎁 Gift"}</div>
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
          ${product.stock != null ? `<div class="stock-label ${Number(product.stock) <= 10 ? "stock-low" : ""}">${Number(product.stock) > 0 ? `${Number(product.stock)} in stock` : "Out of stock"}</div>` : ""}

          <button class="primary-button add-cart-button"
                  data-id="${escapeHtml(product.id)}" ${product.stock != null && Number(product.stock) <= 0 ? "disabled" : ""}>
            ${product.stock != null && Number(product.stock) <= 0 ? "Out of Stock" : "Add to Order"}
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
          costPrice: product.costPrice == null ? null : Number(product.costPrice),
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
        if (!Object.keys(cart).length) { $("orderModal")?.classList.add("hidden"); document.body.classList.remove("order-open"); }
      });
    });

    box.querySelectorAll("[data-remove]").forEach(button => {
      button.addEventListener("click", () => {
        delete cart[button.dataset.remove];
        updateCart();
        renderSelectedProducts();
        if (!Object.keys(cart).length) { $("orderModal")?.classList.add("hidden"); document.body.classList.remove("order-open"); }
      });
    });
  }

  function openOrderModal() {
    appliedCoupon = null; customerLocation = null;
    if (!Object.keys(cart).length) {
      alert("पहले कोई product select करें।");
      return;
    }

    renderSelectedProducts();
    setCheckoutStep(1);
    $("orderModal")?.classList.remove("hidden");
    document.body.classList.add("order-open");
    setTimeout(() => useMyLocation(true), 250);
  }

  function bindEvents() {
    $("openOrderButton")?.addEventListener("click", openOrderModal);
    $("bottomOrderButton")?.addEventListener("click", openOrderModal);
    $("productSearch")?.addEventListener("input", event => {
      searchTerm = event.target.value.trim().toLowerCase();
      renderProducts();
    });

    document.querySelectorAll(".category-filter").forEach(button => {
      button.addEventListener("click", () => {
        activeCategory = button.dataset.category || "all";
        document.querySelectorAll(".category-filter").forEach(b => b.classList.toggle("active", b === button));
        renderProducts();
      });
    });

    $("adminButton")?.addEventListener("click", openAdminFromLogo);
    $("logoButton")?.addEventListener("click", event => {
      event.preventDefault();
      openAdminFromLogo();
    });

    document.querySelectorAll("[data-close]").forEach(button => {
      button.addEventListener("click", () => {
        $(button.dataset.close)?.classList.add("hidden");
        if (button.dataset.close === "orderModal") document.body.classList.remove("order-open");
      });
    });

    $("loginForm")?.addEventListener("submit", loginAdmin);
    $("logoutButton")?.addEventListener("click", logoutAdmin);
    $("forgotPasswordButton")?.addEventListener("click", sendPasswordReset);
    $("reportPeriod")?.addEventListener("change", event => { reportPeriod = event.target.value; renderSalesDashboard(); });
    $("exportDataButton")?.addEventListener("click", exportBusinessCSV);
    $("backupDataButton")?.addEventListener("click", exportFullBackup);
    $("enableNotificationsButton")?.addEventListener("click", enableOrderNotifications);
    $("salesmenTab")?.addEventListener("click", () => showAdminPanel("salesmen"));
    $("offersTab")?.addEventListener("click", () => showAdminPanel("offers"));
    $("offerForm")?.addEventListener("submit", saveOffer);
    $("settingsTab")?.addEventListener("click", () => showAdminPanel("settings"));
    $("couponsTab")?.addEventListener("click", () => showAdminPanel("coupons"));
    $("couponForm")?.addEventListener("submit", saveCoupon);
    $("generateCouponCode")?.addEventListener("click", () => { $("couponCode").value = generateCouponCode(); });
    $("applyCouponButton")?.addEventListener("click", applyCouponFromCheckout);
    $("checkoutNextButton")?.addEventListener("click", goToPaymentStep);
    $("checkoutBackButton")?.addEventListener("click", () => setCheckoutStep(1));
    $("useMyLocationButton")?.addEventListener("click", useMyLocation);
    $("storeSettingsForm")?.addEventListener("submit", saveStoreSettings);
    const openTrackOrder = (prefill = {}) => {
      const modal = $("trackOrderModal");
      const toggle = $("trackOrderToggle");
      if (!modal) return;
      $("adminModal")?.classList.add("hidden");
      $("orderModal")?.classList.add("hidden");
      $("orderSuccessModal")?.classList.add("hidden");
      if (toggle) toggle.checked = true;
      modal.classList.remove("hidden");
      modal.style.setProperty("display", "grid", "important");
      modal.style.setProperty("z-index", "999999", "important");
      modal.setAttribute("aria-hidden", "false");
      if (prefill.orderId && $("trackOrderId")) $("trackOrderId").value = String(prefill.orderId).replace(/^#/, "").toUpperCase();
      if (prefill.mobile && $("trackMobile")) $("trackMobile").value = String(prefill.mobile).replace(/\D/g, "").slice(-10);
      setTimeout(() => $("trackOrderId")?.focus(), 50);
    };
    window.openCocoBizTrackOrder = openTrackOrder;
    window.cocoOpenTrackOrder = openTrackOrder;
    // The main Track Order control is CSS-backed, so it still opens even if Firebase/JS is slow.
    $("trackOrderToggle")?.addEventListener("change", event => {
      if (event.target.checked) {
        $("adminModal")?.classList.add("hidden");
        $("orderModal")?.classList.add("hidden");
        $("orderSuccessModal")?.classList.add("hidden");
        $("trackOrderModal")?.classList.remove("hidden");
        $("trackOrderModal")?.setAttribute("aria-hidden", "false");
        setTimeout(() => $("trackOrderId")?.focus(), 50);
      } else {
        $("trackOrderModal")?.classList.add("hidden");
        $("trackOrderModal")?.setAttribute("aria-hidden", "true");
      }
    });
    $("trackOrderForm")?.addEventListener("submit", trackOrder);
    $("customerPaymentMethod")?.addEventListener("change", renderOrderCharges);
    $("upiPayButton")?.addEventListener("click", event => {
      event.preventDefault();
      const href = $("upiPayButton").getAttribute("href");
      if (!href || href === "#") { alert("Pehle UPI payment option select karein."); return; }
      try {
        window.location.href = href;
        setTimeout(() => {
          if (document.visibilityState === "visible" && /Android/i.test(navigator.userAgent)) alert("UPI app open nahi hua. QR scan karke payment karein ya UPI app installed hai check karein.");
        }, 1200);
      } catch (_) { alert("UPI app open nahi hua. QR scan karke payment karein."); }
    });
    $("deleteOfferButton")?.addEventListener("click", deleteOffer);
    $("offerAdminPreview")?.addEventListener("click", event => {
      const button = event.target.closest("[data-delete-offer]");
      if (!button) return;
      const id = button.dataset.deleteOffer;
      if (confirm("Is scheduled offer ko delete karna hai?")) deleteOfferById(id);
    });
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

    $("customerAccountBody")?.addEventListener("click", event => {
      const reminder = event.target.closest("[data-remind-customer]");
      const bill = event.target.closest("[data-bill-customer-order]");
      if (reminder) sendDueReminder(decodeURIComponent(reminder.dataset.remindCustomer));
      if (bill) printOrderBill(bill.dataset.billCustomerOrder);
    });

    $("adminOrders")?.addEventListener("click", event => {
      const returnButton = event.target.closest("[data-return-order]");
      const billButton = event.target.closest("[data-bill-order]");
      const acceptButton = event.target.closest("[data-accept-order]");
      const paymentButton = event.target.closest("[data-payment-order]");
      const undoPaymentButton = event.target.closest("[data-undo-payment-order]");
      const deleteButton = event.target.closest("[data-delete-order]");
      if (returnButton) processReturn(returnButton.dataset.returnOrder);
      if (billButton) printOrderBill(billButton.dataset.billOrder);
      const statusSelect = event.target.closest("[data-status-order]");
      if (statusSelect) updateOrderStatusDirect(statusSelect.dataset.statusOrder, statusSelect.value);
      if (acceptButton) updateOrderStatus(acceptButton.dataset.acceptOrder);
      if (paymentButton) receivePayment(paymentButton.dataset.paymentOrder);
      if (undoPaymentButton) undoLastPayment(undoPaymentButton.dataset.undoPaymentOrder);
      const paymentMessageButton = event.target.closest("[data-payment-message-order]");
      if (paymentMessageButton) sendPaymentMessage(paymentMessageButton.dataset.paymentMessageOrder);
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

    // Default password for newly created salesmen. Admin can change it later from Salesmen.
    const password = "Pritam@8541";
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

  function getSalesmanCostTotal(order) {
    if (!order || !order.salesmanId || !["accepted", "received"].includes(order.status)) return 0;
    const returnedQty = new Map();
    (order.returns || []).forEach(r => {
      const key = r.productId || r.productName || r.name;
      returnedQty.set(key, (returnedQty.get(key) || 0) + Number(r.quantity || 0));
    });
    let total = 0;
    (order.items || []).forEach(item => {
      let cost = item.costPrice;
      if (cost == null) cost = products.find(p => p.id === item.id)?.costPrice;
      if (cost == null) return;
      const key = item.id || item.name;
      const qty = Math.max(0, Number(item.quantity || 0) - Number(returnedQty.get(key) || 0));
      total += Number(cost) * qty;
    });
    return total;
  }

  function getSalesmanReceived(salesman) {
    return Number(salesman?.salesmanReceivedAmount || 0);
  }

  function getSalesmanReceivable(salesman) {
    const accepted = orders.filter(o => o.salesmanId === salesman.id && ["accepted", "received"].includes(o.status));
    const payable = accepted.reduce((sum, o) => sum + getSalesmanCostTotal(o), 0);
    return { orders: accepted, payable, received: getSalesmanReceived(salesman), due: Math.max(0, payable - getSalesmanReceived(salesman)), credit: Math.max(0, getSalesmanReceived(salesman) - payable) };
  }

  function renderSalesmen() {
    const box = $("salesmenList");
    if (!box) return;
    box.innerHTML = salesmen.length ? salesmen.map(s => {
      const so = orders.filter(o => o.salesmanId === s.id);
      const pending = so.filter(o => ["salesman_pending","pending_admin"].includes(o.status));
      const accepted = so.filter(o => ["accepted","received"].includes(o.status));
      const customerPaid = so.reduce((x,o)=>x+Number(o.paidAmount||0),0);
      const customerDue = so.reduce((x,o)=>x+Math.max(0,Number(o.dueAmount||0)),0);
      const total = accepted.reduce((x,o)=>x+Number(o.netTotal ?? o.total ?? 0),0);
      const receivable = getSalesmanReceivable(s);
      const share = `${window.location.origin}${window.location.pathname}?salesman=${encodeURIComponent(s.id)}`;
      return `<details class="salesman-folder admin-product">
        <summary><div class="salesman-avatar">${escapeHtml((s.name||"S").charAt(0).toUpperCase())}</div><div><strong>${escapeHtml(s.name||"Salesman")}</strong><small><br>${escapeHtml(s.number||"")} · ${escapeHtml(s.email||"")}</small></div><span class="folder-count">${so.length} orders</span></summary>
        <div class="salesman-folder-body">
          <div class="sale-summary salesman-summary"><div><small>Total Orders</small><strong>${so.length}</strong></div><div><small>Accepted</small><strong>${accepted.length}</strong></div><div><small>Pending</small><strong>${pending.length}</strong></div><div><small>Customer Due</small><strong>${money(customerDue)}</strong></div></div>
          <div class="salesman-payable-card"><div><small>Salesman ko aapko dena hai (Cost Rate)</small><strong>${money(receivable.payable)}</strong></div><div><small>Salesman se Received</small><strong>${money(receivable.received)}</strong></div><div><small>Salesman se Lena Baaki</small><strong>${money(receivable.due)}</strong></div>${receivable.credit ? `<div><small>Extra Received / Credit</small><strong>${money(receivable.credit)}</strong></div>` : ""}</div>
          <p><b>Customer Sales:</b> ${money(total)} · <b>Customer Received:</b> ${money(customerPaid)} · <b>Customer Due:</b> ${money(customerDue)}</p>
          <div class="share-link-box"><input readonly value="${escapeHtml(share)}"><button class="secondary-button" data-copy-salesman-link="${escapeHtml(share)}">Copy Link</button></div>
          <div class="salesman-order-list">${so.length ? so.map(o=>`<div class="salesman-order-row"><div><b>#${escapeHtml(o.id)}</b> · ${escapeHtml(o.customer?.name||"Customer")}<br><small>${escapeHtml(o.date||"")}</small></div><div><b>${money(o.netTotal ?? o.total)}</b><br><span class="status-badge">${escapeHtml(o.status||"pending")}</span></div></div>`).join("") : '<p class="modal-subtitle">No orders yet.</p>'}</div>
          <div class="admin-product-actions"><button class="secondary-button" data-salesman-payment="${escapeHtml(s.id)}">💰 Received Payment</button><button class="secondary-button" data-reset-salesman="${escapeHtml(s.email||"")}">Email Reset Link</button><button class="primary-button" data-change-salesman-password="${escapeHtml(s.id)}" data-salesman-email="${escapeHtml(s.email||"")}">Change Password</button></div>
        </div></details>`;
    }).join("") : `<p class="modal-subtitle">अभी कोई salesman नहीं है।</p>`;
    box.querySelectorAll("[data-salesman-payment]").forEach(b=>b.onclick=()=>receiveSalesmanPayment(b.dataset.salesmanPayment));
    box.querySelectorAll("[data-reset-salesman]").forEach(b=>b.onclick=()=>resetSalesmanPassword(b.dataset.resetSalesman));
    box.querySelectorAll("[data-change-salesman-password]").forEach(b=>b.onclick=()=>changeSalesmanPassword(b.dataset.changeSalesmanPassword, b.dataset.salesmanEmail));
    box.querySelectorAll("[data-copy-salesman-link]").forEach(b=>b.onclick=async()=>{try{await navigator.clipboard.writeText(b.dataset.copySalesmanLink);alert("Salesman link copied.")}catch{prompt("Link copy करें:",b.dataset.copySalesmanLink)}});
  }

  async function receiveSalesmanPayment(salesmanId) {
    if (currentRole !== "admin") return;
    const salesman = salesmen.find(s => s.id === salesmanId);
    if (!salesman) return;
    const receivable = getSalesmanReceivable(salesman);
    if (receivable.due <= 0) {
      alert(receivable.credit > 0 ? `Salesman se ${money(receivable.credit)} extra received hai.` : "Is salesman se abhi koi payment due nahi hai.");
      return;
    }
    const raw = prompt(`Salesman se received amount डालें. Lena baaki: ${money(receivable.due)}`, String(receivable.due));
    if (raw === null) return;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0 || amount > receivable.due) {
      alert("Valid amount डालें aur due se zyada nahi hona chahiye.");
      return;
    }
    const methodChoice = prompt("Payment mode चुनें:\n1 = Cash\n2 = Online", "1");
    if (methodChoice === null) return;
    const method = String(methodChoice).trim() === "2" ? "Online" : String(methodChoice).trim() === "1" ? "Cash" : null;
    if (!method) { alert("Sirf 1 (Cash) ya 2 (Online) चुनें।"); return; }
    const note = prompt("Note (optional) — blank छोड़ सकते हैं:", "");
    if (note === null) return;
    const entry = { amount, date: new Date().toLocaleDateString("en-IN"), time: new Date().toLocaleTimeString("en-IN"), timestamp: Date.now(), method, ...(String(note).trim() ? { note: String(note).trim() } : {}) };
    try {
      const ref = db.collection("users").doc(salesmanId);
      await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error("Salesman profile nahi mila.");
        const data = snap.data() || {};
        const history = Array.isArray(data.salesmanPaymentHistory) ? data.salesmanPaymentHistory : [];
        const received = Number(data.salesmanReceivedAmount || 0) + amount;
        tx.update(ref, { salesmanReceivedAmount: received, salesmanPaymentHistory: [...history, entry], updatedAt: Date.now() });
      });
      await loadSalesmen();
      await loadUserProfile(auth.currentUser);
      renderSalesDashboard();
      alert(`Salesman se ${money(amount)} received successfully.`);
    } catch (error) {
      alert(`Salesman payment save nahi hua: ${errorText(error)}`);
    }
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
    if (currentRole === "admin") {
      await loadSalesmen();
      await loadOffer();
      await loadCoupons();
    }
    $("salesmenTab")?.classList.toggle("hidden", currentRole !== "admin");
    $("offersTab")?.classList.toggle("hidden", currentRole !== "admin");
    $("productForm")?.classList.toggle("hidden", currentRole === "salesman");
  }

  function showAdminPanel(name) {
    const panels = {
      dashboard: "dashboardPanel",
      sale: "salePanel",
      products: "productsPanel",
      orders: "ordersPanel",
      salesmen: "salesmenPanel",
      offers: "offersPanel",
      settings: "settingsPanel",
      coupons: "couponsPanel"
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
    if (name === "offers" && currentRole === "admin") loadOffer();
    if (name === "settings" && currentRole === "admin") renderStoreSettings();
    if (name === "coupons" && currentRole === "admin") loadCoupons();
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
                <br>Cost: ${product.costPrice == null ? "Not set" : money(product.costPrice)}
                <br>Stock: ${product.stock == null ? "Not tracked" : Number(product.stock)}
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
    const category = $("productCategory")?.value || oldProduct?.category || "gift";
    const actualPrice = Number($("actualPrice").value);
    const salePrice = Number($("salePrice").value);
    const costRaw = $("costPrice")?.value.trim();
    const stockRaw = $("stockQty")?.value.trim();
    const costPrice = costRaw === "" ? null : Number(costRaw);
    const stock = stockRaw === "" ? null : Number(stockRaw);

    if (!name || !description) {
      alert("Product name और description भरें।");
      return;
    }

    if (
      !Number.isFinite(actualPrice) ||
      !Number.isFinite(salePrice) ||
      actualPrice < 0 ||
      salePrice < 0 ||
      (costPrice !== null && (!Number.isFinite(costPrice) || costPrice < 0)) ||
      (stock !== null && (!Number.isFinite(stock) || stock < 0 || !Number.isInteger(stock)))
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
        category,
        actualPrice,
        salePrice,
        costPrice,
        stock,
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
    if ($("productCategory")) $("productCategory").value = product.category || "gift";
    $("actualPrice").value = product.actualPrice ?? "";
    $("salePrice").value = product.salePrice ?? "";
    if ($("costPrice")) $("costPrice").value = product.costPrice ?? "";
    if ($("stockQty")) $("stockQty").value = product.stock ?? "";
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
        costPrice: product.costPrice == null ? null : Number(product.costPrice),
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
      items: selfSaleItems.map(item => ({ id: item.productId, name: item.name, quantity: item.quantity, price: item.rate, costPrice: item.costPrice ?? null, total: item.total })),
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

    let stockAdjusted = false;
    try {
      await adjustStockForOrder(sale, -1);
      stockAdjusted = true;
      await db.collection("orders").add(sale);
      await loadProducts();
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
      if (stockAdjusted) { try { await adjustStockForOrder(sale, 1); } catch (_) {} }
      alert(`Self Sale save नहीं हुई: ${errorText(error)}`);
    }
  }

  function calculateOrderCharges(subtotal) {
    const freeAbove = Number(storeSettings.freeDeliveryAbove || 0);
    const freeRadius = Number(storeSettings.freeDeliveryRadiusKm ?? 10);
    const withinFreeRadius = customerLocation && Number.isFinite(Number(storeSettings.storeLatitude)) && Number.isFinite(Number(storeSettings.storeLongitude))
      ? haversineKm(Number(storeSettings.storeLatitude), Number(storeSettings.storeLongitude), Number(customerLocation.lat), Number(customerLocation.lng)) <= freeRadius
      : false;
    const delivery = (withinFreeRadius || (freeAbove > 0 && subtotal >= freeAbove)) ? 0 : Number(storeSettings.deliveryCharge || 0);
    const feeBase = Number(storeSettings.platformFeeValue || 0);
    const platformFee = storeSettings.platformFeeEnabled ? (storeSettings.platformFeeType === "percent" ? subtotal * feeBase / 100 : feeBase) : 0;
    const beforeCoupon = subtotal + delivery + platformFee;
    let discount = 0;
    if (appliedCoupon) {
      if (appliedCoupon.type === "percent") discount = beforeCoupon * Number(appliedCoupon.value || 0) / 100;
      else discount = Number(appliedCoupon.value || 0);
      if (appliedCoupon.maxDiscount > 0) discount = Math.min(discount, Number(appliedCoupon.maxDiscount));
      discount = Math.min(discount, beforeCoupon);
    }
    return { subtotal, delivery, platformFee, couponDiscount: discount, grandTotal: Math.max(0, beforeCoupon - discount) };
  }

  function renderOrderCharges() {
    const box = $("orderCharges"); if (!box) return;
    const subtotal = cartItems().reduce((sum, item) => sum + item.total, 0);
    const c = calculateOrderCharges(subtotal);
    box.innerHTML = `<div class="charge-row"><span>Items subtotal</span><b>${money(c.subtotal)}</b></div>
      <div class="charge-row"><span>Delivery</span><b>${c.delivery ? money(c.delivery) : "FREE"}</b></div>
      <div class="charge-row"><span>Platform fee</span><b>${c.platformFee ? money(c.platformFee) : "FREE"}</b></div>
      ${c.couponDiscount ? `<div class="charge-row discount"><span>Coupon (${escapeHtml(appliedCoupon?.code || "")})</span><b>- ${money(c.couponDiscount)}</b></div>` : ""}
      <div class="charge-row total"><span>Total payable</span><b>${money(c.grandTotal)}</b></div>`;
    const pm = $("customerPaymentMethod");
    if (pm) {
      const onlineAllowed = !!storeSettings.onlinePaymentEnabled;
      const upiAllowed = !!storeSettings.upiEnabled;
      const upiOption = pm.querySelector('option[value="UPI"]');
      const onlineOption = pm.querySelector('option[value="ONLINE"]');
      if (upiOption) upiOption.hidden = !upiAllowed;
      if (onlineOption) onlineOption.hidden = !onlineAllowed;
      if (pm.value === "UPI" && !upiAllowed) pm.value = "COD";
      if (pm.value === "ONLINE" && !onlineAllowed) pm.value = upiAllowed ? "UPI" : "COD";
    }
    const upiBox = $("upiPaymentBox");
    if (upiBox) {
      const show = $("customerPaymentMethod")?.value === "UPI" && !!storeSettings.upiEnabled;
      upiBox.classList.toggle("hidden", !show);
      if (show) {
        const upiId = storeSettings.upiId || "kunalverma5555@ibl";
        const name = encodeURIComponent(storeSettings.upiName || "CocoBiz");
        const amount = Number(c.grandTotal || 0).toFixed(2);
        const txn = `CB-${Date.now()}`;
        const note = encodeURIComponent(`CocoBiz Order ${txn}`);
        const uri = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${name}&am=${amount}&cu=INR&tn=${note}`;
        if ($("upiIdDisplay")) $("upiIdDisplay").textContent = upiId;
        if ($("upiAmountText")) $("upiAmountText").textContent = `Pay ${money(c.grandTotal)}`;
        if ($("upiQrAmountText")) $("upiQrAmountText").textContent = money(c.grandTotal);
        if ($("upiPayButton")) $("upiPayButton").href = uri;
        renderDynamicUpiQr(uri);
      }
    }
  }

  function renderDynamicUpiQr(uri) {
    const box = $("dynamicUpiQr"); if (!box) return;
    box.innerHTML = "";
    const img = document.createElement("img");
    img.className = "upi-qr"; img.alt = "CocoBiz UPI QR"; img.loading = "eager";
    const encoded = encodeURIComponent(uri);
    const primary = `https://quickchart.io/qr?size=360&margin=2&text=${encoded}`;
    const secondary = `https://api.qrserver.com/v1/create-qr-code/?size=360x360&margin=8&data=${encoded}`;
    img.src = primary;
    img.onerror = () => {
      if (img.dataset.retry !== "1") { img.dataset.retry = "1"; img.src = secondary; return; }
      box.innerHTML = storeSettings.upiQrImage
        ? `<img src="${storeSettings.upiQrImage}" alt="CocoBiz UPI QR" class="upi-qr">`
        : `<div class="qr-fallback"><b>QR temporarily unavailable</b><br>Pay with UPI button use karein.</div>`;
    };
    box.appendChild(img);
  }

  async function loadStoreSettings() {
    try {
      const snap = await db.collection("settings").doc("store").get();
      if (snap.exists) storeSettings = { ...storeSettings, ...snap.data() };
    } catch (e) { console.warn("Store settings load failed", e); }
  }

  async function saveStoreSettings(event) {
    event.preventDefault();
    if (currentRole !== "admin") return;
    let qrImage = storeSettings.upiQrImage || "";
    const qrFile = $("upiQrUpload")?.files?.[0];
    if (qrFile) {
      try { qrImage = await compressImage(qrFile, 1000, 0.82); } catch (e) { alert(`QR image save nahi hua: ${errorText(e)}`); return; }
    }
    const minDays = Math.max(1, Number($("deliveryMinDays")?.value || 7));
    const maxDays = Math.max(minDays, Number($("deliveryMaxDays")?.value || 15));
    storeSettings = {
      ...storeSettings,
      deliveryCharge: Math.max(0, Number($("deliveryCharge").value || 0)),
      freeDeliveryRadiusKm: Math.max(0, Number($("freeDeliveryRadiusKm")?.value || 10)),
      freeDeliveryAbove: Math.max(0, Number($("freeDeliveryAbove").value || 0)),
      platformFeeEnabled: $("platformFeeEnabled").checked,
      platformFeeType: $("platformFeeType").value,
      platformFeeValue: Math.max(0, Number($("platformFeeValue").value || 0)),
      upiEnabled: $("upiEnabled").checked,
      upiId: $("upiId").value.trim() || "kunalverma5555@ibl",
      upiName: "CocoBiz",
      upiQrImage: qrImage,
      onlinePaymentEnabled: $("onlinePaymentEnabled").checked,
      razorpayKeyId: $("razorpayKeyId").value.trim(),
      deliveryRadiusKm: 0,
      deliveryMinDays: minDays,
      deliveryMaxDays: maxDays,
      storeLatitude: $("storeLatitude")?.value === "" ? 26.291018 : Number($("storeLatitude").value),
      storeLongitude: $("storeLongitude")?.value === "" ? 87.2711 : Number($("storeLongitude").value),
      updatedAt: Date.now()
    };
    try { await db.collection("settings").doc("store").set(storeSettings, { merge: true }); renderOrderCharges(); renderStoreSettings(); alert("Store settings save ho gayi."); }
    catch (e) { alert(`Settings save nahi hui: ${errorText(e)}`); }
  }

  function renderStoreSettings() {
    if ($("deliveryCharge")) $("deliveryCharge").value = storeSettings.deliveryCharge || 0;
    if ($("freeDeliveryRadiusKm")) $("freeDeliveryRadiusKm").value = storeSettings.freeDeliveryRadiusKm ?? 10;
    if ($("freeDeliveryAbove")) $("freeDeliveryAbove").value = storeSettings.freeDeliveryAbove || "";
    if ($("platformFeeEnabled")) $("platformFeeEnabled").checked = !!storeSettings.platformFeeEnabled;
    if ($("platformFeeType")) $("platformFeeType").value = storeSettings.platformFeeType || "flat";
    if ($("platformFeeValue")) $("platformFeeValue").value = storeSettings.platformFeeValue || 0;
    if ($("upiEnabled")) $("upiEnabled").checked = storeSettings.upiEnabled !== false;
    if ($("upiId")) $("upiId").value = storeSettings.upiId || "kunalverma5555@ibl";
    if ($("deliveryRadiusKm")) $("deliveryRadiusKm").value = "";
    if ($("deliveryMinDays")) $("deliveryMinDays").value = storeSettings.deliveryMinDays ?? 7;
    if ($("deliveryMaxDays")) $("deliveryMaxDays").value = storeSettings.deliveryMaxDays ?? 15;
    if ($("storeLatitude")) $("storeLatitude").value = storeSettings.storeLatitude ?? 26.291018;
    if ($("storeLongitude")) $("storeLongitude").value = storeSettings.storeLongitude ?? 87.2711;
    if ($("settingsQrPreview")) $("settingsQrPreview").src = storeSettings.upiQrImage || "assets/cocobiz_upi_qr.png";
    if ($("onlinePaymentEnabled")) $("onlinePaymentEnabled").checked = !!storeSettings.onlinePaymentEnabled;
    if ($("razorpayKeyId")) $("razorpayKeyId").value = storeSettings.razorpayKeyId || "";
  }

  function statusLabel(status) { return ORDER_STATUSES.find(x => x[0] === status)?.[1] || status || "Order Placed"; }
  function statusTimeline(order) {
    const current = order.status || "pending";
    const idx = ORDER_STATUSES.findIndex(x => x[0] === current);
    const visible = ORDER_STATUSES.filter(x => !["cancelled","returned"].includes(x[0]));
    return `<div class="status-timeline">${visible.map((x,i)=>{ const done = idx >= ORDER_STATUSES.findIndex(y=>y[0]===x[0]); return `<div class="timeline-step ${done?"done":""}"><span>${done?"✓":i+1}</span><small>${x[1]}</small></div>`; }).join("")}</div>${["cancelled","returned"].includes(current)?`<div class="exception-status">${current === "cancelled" ? "❌ Order Cancelled" : "↩ Order Returned"}</div>`:""}`;
  }

  async function hashTrackingMobile(mobile) {
    const text = String(mobile || '').replace(/\D/g, '');
    if (window.crypto?.subtle) {
      const bytes = new TextEncoder().encode(text);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return String(h >>> 0);
  }

  async function syncPublicTracking(order, extra = {}) {
    if (!db || !order?.clientId) return;
    try {
      const mobileHash = order.mobileHash || await hashTrackingMobile(order.customer?.number || '');
      const payload = {
        clientId: order.clientId,
        mobileHash,
        status: extra.status ?? order.status ?? 'pending',
        deliveryEstimate: extra.deliveryEstimate ?? order.deliveryEstimate ?? '7–15 days',
        deliveryDistanceKm: extra.deliveryDistanceKm ?? order.deliveryDistanceKm ?? null,
        total: Number(extra.netTotal ?? extra.total ?? order.netTotal ?? order.total ?? 0),
        updatedAt: extra.updatedAt ?? Date.now(),
        createdAt: order.createdAt || Date.now()
      };
      const trackingId = String(order.clientId).trim().replace(/^#/, '').toUpperCase();
      payload.clientId = trackingId;
      await db.collection('publicOrderTracking').doc(trackingId).set(payload, { merge: true });
      try { localStorage.setItem('cocobiz_tracking_' + trackingId, JSON.stringify(payload)); } catch (_) {}
    } catch (e) {
      console.warn('Public tracking sync failed:', e?.message || e);
    }
  }

  async function trackOrder(event) {
    event.preventDefault();
    const id = $("trackOrderId")?.value.trim().replace(/^#/, '').toUpperCase();
    const mobile = $("trackMobile")?.value.replace(/\D/g, '').slice(-10);
    const box = $("trackOrderResult");
    if (!box) return;
    if (!id || mobile.length !== 10) {
      box.innerHTML = `<p class="modal-subtitle">Please enter a valid Order ID and 10-digit mobile number.</p>`;
      return;
    }
    box.innerHTML = `<p class="modal-subtitle">🔎 Order search ho raha hai...</p>`;
    try {
      if (!db) throw new Error("Firebase database connect nahi hua. Page refresh karke dobara try karein.");
      const mobileHash = await hashTrackingMobile(mobile);
      const snap = await db.collection("publicOrderTracking").doc(id).get();
      if (!snap.exists) {
        box.innerHTML = `<div class="tracking-empty"><strong>Order nahi mila.</strong><br><small>Order ID exactly wahi daalein jo order confirmation me mila tha.</small></div>`;
        return;
      }
      const tracking = snap.data();
      if (tracking.mobileHash && tracking.mobileHash !== mobileHash) {
        box.innerHTML = `<div class="tracking-empty"><strong>Mobile number match nahi hua.</strong><br><small>Order place karte waqt jo mobile number diya tha wahi use karein.</small></div>`;
        return;
      }
      box.innerHTML = `<div class="tracking-card"><div class="order-heading-row"><strong>#${escapeHtml(tracking.clientId || id)}</strong><span class="status-badge">${escapeHtml(statusLabel(tracking.status))}</span></div>${statusTimeline(tracking)}<div class="delivery-estimate-card">🚚 <b>Estimated Delivery</b><br>${escapeHtml(tracking.deliveryEstimate || "7–15 days")}${tracking.deliveryDistanceKm != null ? `<br><small>Approx. distance: ${Number(tracking.deliveryDistanceKm).toFixed(1)} km</small>` : ""}</div><div class="order-grand-total">Total: <strong>${money(tracking.total || 0)}</strong><br><small>Last updated: ${new Date(tracking.updatedAt || tracking.createdAt || Date.now()).toLocaleString("en-IN")}</small></div></div>`;
    } catch(e) {
      console.error('Track order error:', e);
      const msg = String(e?.code || '').includes('permission-denied')
        ? 'Tracking permission Firebase me deploy nahi hui hai. Firebase Console → Firestore Database → Rules me latest firestore.rules publish karein.'
        : errorText(e);
      box.innerHTML = `<div class="tracking-empty"><strong>Tracking open nahi ho pa raha.</strong><br><small>${escapeHtml(msg)}</small></div>`;
    }
  }

  async function openOnlinePayment(orderData, amount) {
    if (!storeSettings.onlinePaymentEnabled || !storeSettings.razorpayKeyId) throw new Error("Online payment abhi configure nahi hai. Admin Store Settings me Razorpay Key ID set karein.");
    await loadScript("https://checkout.razorpay.com/v1/checkout.js");
    const createPaymentOrder = firebase.functions().httpsCallable("createRazorpayOrder");
    const result = await createPaymentOrder({ amount: Math.round(amount * 100), currency: "INR", receipt: orderData.clientId });
    const rzpOrder = result.data;
    return new Promise((resolve, reject) => {
      const options = { key: storeSettings.razorpayKeyId, amount: rzpOrder.amount, currency: "INR", name: "CocoBiz", description: `Order ${orderData.clientId}`, order_id: rzpOrder.id, prefill: { name: orderData.customer.name, contact: orderData.customer.number }, handler: async response => {
        try { const verify = firebase.functions().httpsCallable("verifyRazorpayPayment"); await verify({ orderId: rzpOrder.id, paymentId: response.razorpay_payment_id, signature: response.razorpay_signature, clientId: orderData.clientId }); resolve(response); } catch(e) { reject(e); }
      }, modal: { ondismiss: () => reject(new Error("Payment cancelled.")) } };
      const rzp = new Razorpay(options); rzp.open();
    });
  }


  function formatDeliveryRange(createdAt) {
    const base = new Date(createdAt || Date.now());
    const min = new Date(base); min.setDate(min.getDate() + Number(storeSettings.deliveryMinDays || 7));
    const max = new Date(base); max.setDate(max.getDate() + Number(storeSettings.deliveryMaxDays || 15));
    const fmt = d => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    return `${fmt(min)} – ${fmt(max)}`;
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R=6371, toRad=x=>x*Math.PI/180;
    const dLat=toRad(lat2-lat1), dLon=toRad(lon2-lon1);
    const a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
    return 2*R*Math.asin(Math.sqrt(a));
  }

  function useMyLocation(silent = false) {
    if (!navigator.geolocation) { $("deliveryLocationMessage").textContent = "Is device me location support nahi hai."; return; }
    if (!silent) $("deliveryLocationMessage").textContent = "Location check ho raha hai...";
    navigator.geolocation.getCurrentPosition(pos => {
      customerLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const sLat=Number(storeSettings.storeLatitude), sLng=Number(storeSettings.storeLongitude);
      if (Number.isFinite(sLat) && Number.isFinite(sLng)) {
        const distance=haversineKm(sLat,sLng,customerLocation.lat,customerLocation.lng);
        const freeRadius = Number(storeSettings.freeDeliveryRadiusKm ?? 10);
        $("deliveryLocationMessage").textContent = distance <= freeRadius ? `🚚 FREE delivery • approx. ${distance.toFixed(1)} km away` : `🚚 Delivery available • ${distance.toFixed(1)} km away • Delivery charge ${money(storeSettings.deliveryCharge || 0)}`;
        renderOrderCharges();
      } else {
        $("deliveryLocationMessage").textContent = "Location saved. Delivery charge will be calculated automatically.";
      }
    }, () => { $("deliveryLocationMessage").textContent = "Location permission nahi mili. Address se order continue kar sakte hain."; }, { enableHighAccuracy: true, timeout: 10000 });
  }

  function setCheckoutStep(step) {
    document.querySelectorAll(".checkout-step").forEach(el => el.classList.toggle("hidden", Number(el.dataset.step)!==step));
    const modal=document.querySelector("#orderModal .modal-box"); if(modal) modal.dataset.checkoutStep=String(step);
    if(step===1) renderOrderCharges();
    else renderOrderCharges();
  }

  function goToPaymentStep() {
    if (!$('customerName')?.value.trim() || !$('customerNumber')?.value.trim() || !$('customerAddress')?.value.trim() || !$('customerType')?.value) { alert("Name, mobile, address aur customer type complete karein."); return; }
    if (!/^[0-9]{10}$/.test($("customerNumber").value.trim())) { alert("10-digit mobile number enter karein."); return; }
    setCheckoutStep(2);
    renderOrderCharges();
  }

  function generateCouponCode() {
    return "COCO" + Math.random().toString(36).slice(2,8).toUpperCase();
  }

  async function loadCoupons() {
    if (!db) return [];
    try { const snap=await db.collection("coupons").get(); const list=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>String(a.code||"").localeCompare(String(b.code||""))); renderCouponsAdmin(list); return list; }
    catch(e){ console.warn("Coupons load failed",e); return []; }
  }

  function renderCouponsAdmin(list) {
    const box=$("couponsList"); if(!box) return;
    const now=Date.now();
    box.innerHTML=list.length?list.map(c=>{ const exp=c.validUntil && Number(c.validUntil)<now; return `<div class="admin-product"><div><strong>${escapeHtml(c.code)}</strong><small><br>${c.type==='percent'?Number(c.value||0)+'%':money(c.value)} off · Min ${money(c.minOrder||0)}<br>Uses: ${Number(c.usageCount||0)} / ${Number(c.usageLimit||0)||'∞'} · ${c.validUntil?('Until '+new Date(c.validUntil).toLocaleString('en-IN')):'No expiry'}</small></div><span class="status-badge">${!c.active?'Inactive':exp?'Expired':'Active'}</span><button class="delete-button" data-delete-coupon="${escapeHtml(c.id)}">Delete</button></div>`}).join(''):'<p class="modal-subtitle">Abhi koi coupon nahi hai.</p>';
    box.querySelectorAll('[data-delete-coupon]').forEach(b=>b.onclick=()=>deleteCoupon(b.dataset.deleteCoupon));
  }

  async function saveCoupon(event) {
    event.preventDefault(); if(currentRole!=="admin") return;
    const code=$("couponCode").value.trim().toUpperCase().replace(/\s+/g,'');
    const type=$("couponType").value; const value=Number($("couponValue").value||0);
    if(!code || !value || value<0){alert("Coupon code aur valid discount value dein.");return;}
    const validUntil=$("couponValidUntil").value ? new Date($("couponValidUntil").value).getTime() : null;
    if(validUntil && validUntil<=Date.now()){alert("Expiry future me rakhein.");return;}
    const data={code,type,value,minOrder:Math.max(0,Number($("couponMinOrder").value||0)),maxDiscount:Math.max(0,Number($("couponMaxDiscount").value||0)),usageLimit:Math.max(0,parseInt($("couponUsageLimit").value||0,10)),perCustomerLimit:Math.max(0,parseInt($("couponPerCustomerLimit").value||0,10)),validUntil,active:$("couponActive").checked,usageCount:0,updatedAt:Date.now(),createdBy:auth.currentUser.uid};
    try { await db.collection("coupons").doc(code).set(data,{merge:true}); $("couponForm").reset(); $("couponActive").checked=true; await loadCoupons(); alert("Coupon save ho gaya."); } catch(e){alert(`Coupon save nahi hua: ${errorText(e)}`);}
  }

  async function deleteCoupon(id) { if(currentRole!=="admin"||!id)return; if(!confirm("Is coupon ko delete karna hai?"))return; try{await db.collection("coupons").doc(id).delete();await loadCoupons();}catch(e){alert(`Coupon delete nahi hua: ${errorText(e)}`)} }

  async function applyCouponFromCheckout() {
    const code=$("couponCodeInput")?.value.trim().toUpperCase().replace(/\s+/g,''); const msg=$("couponMessage");
    if(!code){appliedCoupon=null; msg.textContent="Coupon code enter karein."; renderOrderCharges(); return;}
    try {
      const snap=await db.collection("coupons").doc(code).get();
      if(!snap.exists){appliedCoupon=null;msg.textContent="Invalid coupon code.";renderOrderCharges();return;}
      const c={id:snap.id,...snap.data()}; const subtotal=cartItems().reduce((s,i)=>s+i.total,0);
      if(c.active===false){throw new Error("Coupon inactive hai.");}
      if(c.validUntil && Date.now()>Number(c.validUntil)){throw new Error("Coupon expire ho gaya hai.");}
      if(Number(c.usageLimit||0)>0 && Number(c.usageCount||0)>=Number(c.usageLimit)){throw new Error("Coupon usage limit complete ho gayi hai.");}
      if(subtotal<Number(c.minOrder||0)){throw new Error(`Minimum order ${money(c.minOrder)} hona chahiye.`);}
      appliedCoupon=c; msg.textContent=`Coupon applied: ${c.type==='percent'?Number(c.value)+'%':money(c.value)} off`; renderOrderCharges();
    }catch(e){appliedCoupon=null;msg.textContent=errorText(e);renderOrderCharges();}
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

    const subtotal = items.reduce((sum, item) => sum + item.total, 0);
    const charges = calculateOrderCharges(subtotal);
    const total = charges.grandTotal;
    const clientId = `CB-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const paymentMethod = $("customerPaymentMethod")?.value || "COD";
    if (paymentMethod === "UPI" && !$("upiUtr")?.value.trim()) { window.__cocoOrderWorking=false; alert("UPI payment ke baad UTR / Transaction ID enter karein."); return; }
    const deliveryEstimate = formatDeliveryRange(Date.now());

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
      subtotal: charges.subtotal,
      deliveryCharge: charges.delivery,
      platformFee: charges.platformFee,
      couponCode: appliedCoupon?.code || null,
      couponDiscount: charges.couponDiscount || 0,
      total,
      deliveryEstimate,
      deliveryDistanceKm: customerLocation && Number.isFinite(Number(storeSettings.storeLatitude)) && Number.isFinite(Number(storeSettings.storeLongitude)) ? haversineKm(Number(storeSettings.storeLatitude), Number(storeSettings.storeLongitude), customerLocation.lat, customerLocation.lng) : null,
      originalTotal: total,
      returnedTotal: 0,
      netTotal: total,
      paidAmount: 0,
      dueAmount: total,
      paymentMethod,
      paymentStatus: paymentMethod === "UPI" && $("upiUtr")?.value.trim() ? "submitted" : "pending",
      utr: paymentMethod === "UPI" ? ($("upiUtr")?.value.trim() || null) : null,
      paymentHistory: [],
      salesmanId: publicSalesmanId || null,
      salesmanName: publicSalesmanProfile?.name || null,
      salesmanNumber: publicSalesmanProfile?.number || null
    };
    data.status = publicSalesmanId ? "salesman_pending" : "pending";

    const saveCloud = async () => {
      data.mobileHash = await hashTrackingMobile(data.customer.number);
      const ref = await db.collection("orders").add(data);
      // Tracking sync must never delay or block the final order confirmation.
      try { await syncPublicTracking(data); } catch (trackingError) { console.warn("Tracking sync deferred:", trackingError); }
      return ref;
    };

    try {
      // Try immediately; if the network is temporarily unavailable,
      // Firestore offline persistence will queue the write and sync later.
      await saveCloud();
      if (data.paymentMethod === "ONLINE") {
        try {
          const payment = await openOnlinePayment(data, total);
          data.paymentStatus = "paid"; data.paidAmount = total; data.dueAmount = 0; data.paymentId = payment.razorpay_payment_id; data.status = "accepted"; data.updatedAt = Date.now();
          const ref = (await db.collection("orders").where("clientId", "==", clientId).limit(1).get()).docs[0];
          if (ref) {
            const onlinePatch = { paymentStatus: "paid", paidAmount: total, dueAmount: 0, paymentId: data.paymentId, status: "accepted", acceptedAt: Date.now(), updatedAt: Date.now() };
            await ref.ref.update(onlinePatch);
            try { await syncPublicTracking({ ...data, ...onlinePatch, netTotal: total }); } catch (trackingError) { console.warn("Tracking update deferred:", trackingError); }
          }
        } catch (paymentError) {
          alert(`Online payment complete nahi hua: ${errorText(paymentError)}\n\nOrder ko COD/pending ke roop me rakha gaya hai.`);
        }
      }

      localStorage.removeItem("cocobiz_pending_order_" + clientId);

      const message = [
        "*CocoBiz NEW ORDER*",
        `Order ID: ${clientId}`,
        "",
        ...items.map(item => `${item.name} × ${item.quantity} = ${money(item.total)}`),
        "",
        `Subtotal: ${money(charges.subtotal)}`, `Delivery: ${charges.delivery ? money(charges.delivery) : "FREE"}`, `Platform fee: ${charges.platformFee ? money(charges.platformFee) : "FREE"}`, `Coupon: ${data.couponCode || "None"}`, `Discount: ${data.couponDiscount ? money(data.couponDiscount) : "₹0.00"}`, `Total: ${money(total)}`, `Estimated delivery: ${deliveryEstimate}`, `Payment: ${data.paymentMethod}`,
        ...(data.paymentMethod === "UPI" ? [`UPI ID: ${storeSettings.upiId}`, `UTR: ${data.utr || "Not submitted"}`] : []),
        `Name: ${data.customer.name}`,
        `Mobile: ${data.customer.number}`,
        `Address: ${data.customer.address}`,
        `Type: ${data.customer.type}`
      ].join("\n");

      const targetNumber = data.salesmanNumber ? String(data.salesmanNumber).replace(/\D/g, "") : WHATSAPP_NUMBER;
      const normalizedTarget = targetNumber.length === 10 ? "91" + targetNumber : targetNumber;
      const waUrl = `https://wa.me/${normalizedTarget}?text=${encodeURIComponent(message)}`;
      // Open WhatsApp first, then show the website confirmation so the customer sees
      // the confirmation after the WhatsApp hand-off. A WhatsApp web/app hand-off
      // cannot report delivery status back to the website, so this is intentionally
      // a short UI hand-off rather than pretending WhatsApp confirmed delivery.
      // Save a short-lived handoff marker before opening WhatsApp. If the browser
      // switches to WhatsApp and restores this page later, pageshow/visibilitychange
      // will put the confirmation popup back on this same page.
      try {
        sessionStorage.setItem("cocobiz_pending_confirmation", JSON.stringify({ orderId: clientId, mobile: data.customer.number }));
      } catch (_) {}

      try { window.open(waUrl, "_blank", "noopener,noreferrer"); } catch {}

      showOrderSuccess(data.customer.number, clientId);

      cart = {};
      updateCart();
      $("orderForm").reset();
      appliedCoupon = null; customerLocation = null; setCheckoutStep(1);
      $("orderModal")?.classList.add("hidden");
      document.body.classList.remove("order-open");
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

    const wa = $("successWhatsApp");
    const call = $("successCall");
    const track = $("successTrack");

    if (wa) {
      wa.href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(`CocoBiz order ${orderId} successfully received.`)}`;
    }
    if (call) call.href = `tel:+${WHATSAPP_NUMBER}`;
    if ($("successOrderId")) $("successOrderId").textContent = orderId;

    // Make the tracking action one tap: store the details locally and open tracking.
    try { localStorage.setItem("cocobiz_last_order", JSON.stringify({ orderId, mobile: customerNumber })); } catch (_) {}
    if (track) {
      track.onclick = (e) => {
        e.preventDefault();
        modal.classList.add("hidden");
        if (typeof window.openCocoBizTrackOrder === "function") {
          window.openCocoBizTrackOrder({ orderId, mobile: customerNumber });
          setTimeout(() => $("trackOrderForm")?.requestSubmit(), 100);
        }
      };
    }
    modal.classList.remove("hidden");
    modal.style.display = "grid";
    modal.style.zIndex = "100000";
    modal.setAttribute("aria-hidden", "false");
    try { sessionStorage.removeItem("cocobiz_pending_confirmation"); } catch (_) {}
  }

  function restorePendingOrderConfirmation() {
    try {
      const raw = sessionStorage.getItem("cocobiz_pending_confirmation");
      if (!raw) return;
      const pending = JSON.parse(raw);
      if (pending?.orderId && pending?.mobile) showOrderSuccess(pending.mobile, pending.orderId);
    } catch (_) {}
  }

  window.addEventListener("pageshow", restorePendingOrderConfirmation);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") restorePendingOrderConfirmation();
  });

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
          const credit = Math.max(0, Number(order.creditAmount ?? paid - netTotal));

          return `
          <div class="admin-order" data-order-card="${escapeHtml(order.id)}">
            <div class="order-heading-row">
              <div>
                <strong>Order #${escapeHtml(order.id)}</strong>
                <small>${escapeHtml(order.date || "")}</small>
              </div>
              <div class="status-control-wrap"><span class="status-badge">${escapeHtml(statusLabel(order.status || "pending"))}</span>${currentRole === "admin" ? `<select class="status-select" data-status-order="${escapeHtml(order.id)}">${ORDER_STATUSES.map(st=>`<option value="${st[0]}" ${st[0]===(order.status||"pending")?"selected":""}>${st[1]}</option>`).join("")}</select>` : ""}</div>
            </div>

            ${statusTimeline(order)}
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
              <span>Paid: ${money(paid)} · Due: ${money(due)}${credit ? ` · Credit/Refund: ${money(credit)}` : ""}</span>
            </div>

            <div class="admin-order-actions">
              ${currentRole === "admin" && ["pending","pending_admin"].includes(order.status) ? `<button class="primary-button" data-accept-order="${escapeHtml(order.id)}">✓ Accept Order</button>` : ""}
              ${currentRole === "salesman" && order.salesmanId === auth.currentUser?.uid && order.status === "salesman_pending" ? `<button class="primary-button" data-accept-order="${escapeHtml(order.id)}">✓ Accept & Send to Admin</button>` : ""}
              ${due > 0 && ["accepted","received"].includes(order.status) ? `<button class="secondary-button" data-payment-order="${escapeHtml(order.id)}">💰 Received Payment</button>` : ""}
              ${paid > 0 ? `<button class="secondary-button" data-payment-message-order="${escapeHtml(order.id)}">💬 Payment Message</button>` : ""}
              ${currentRole === "admin" && Array.isArray(order.paymentHistory) && order.paymentHistory.length ? `<button class="secondary-button" data-undo-payment-order="${escapeHtml(order.id)}">↩ Undo Last Payment</button>` : ""}
              <button class="secondary-button" data-return-order="${escapeHtml(order.id)}">↩ Return Item</button>
              <button class="secondary-button" data-bill-order="${escapeHtml(order.id)}">🧾 Bill</button>
              <a class="secondary-button" href="tel:${escapeHtml(order.customer?.number || "")}">☎ Contact</a>
              ${(currentRole === "admin" || (currentRole === "salesman" && order.salesmanId === auth.currentUser?.uid && ["salesman_pending","pending_admin"].includes(order.status))) ? `<button class="delete-button" data-delete-order="${escapeHtml(order.id)}">🗑 Delete Order</button>` : ""}
            </div>
          </div>`;
        }).join("")
      : "<p class='modal-subtitle'>No orders yet.</p>";
  }

  async function adjustStockForOrder(order, direction) {
    const tracked = (order.items || []).filter(item => products.find(p => p.id === item.id)?.stock != null);
    if (!tracked.length) return;
    for (const item of tracked) {
      const ref = db.collection("products").doc(item.id);
      await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists) return;
        const current = Number(snap.data().stock);
        const next = current + direction * Number(item.quantity || 0);
        if (next < 0) throw new Error(`${item.name} ka stock insufficient hai. Available: ${current}`);
        tx.update(ref, {stock: next, updatedAt: Date.now()});
      });
    }
  }

  async function updateOrderStatusDirect(orderId, status) {
    const order = orders.find(o => o.id === orderId); if (!order || currentRole !== "admin") return;
    try {
      if (status === "accepted" && !["accepted","received","packed","shipped","out_for_delivery","delivered"].includes(order.status)) await adjustStockForOrder(order, -1);
      const statusPatch = { status, updatedAt: Date.now(), ...(status === "accepted" ? { acceptedAt: Date.now() } : {}), ...(status === "delivered" ? { deliveredAt: Date.now() } : {}) };
      await db.collection("orders").doc(orderId).update(statusPatch);
      await syncPublicTracking({ ...order, ...statusPatch });
      await loadOrders(); renderOrders(); renderSalesDashboard();
    } catch(e) { alert(`Status update nahi hua: ${errorText(e)}`); }
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
      if (status === "accepted" && !["accepted","received"].includes(order.status)) await adjustStockForOrder(order, -1);
      const statusPatch = { status, salesmanAcceptedAt: status === "pending_admin" ? Date.now() : (order.salesmanAcceptedAt || null), acceptedAt: status === "accepted" ? Date.now() : (order.acceptedAt || null), updatedAt: Date.now() };
      await db.collection("orders").doc(orderId).update(statusPatch);
      await syncPublicTracking({ ...order, ...statusPatch });
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

    const methodChoice = prompt("Payment mode चुनें:\n1 = Cash\n2 = Online", "1");
    if (methodChoice === null) return;
    const method = String(methodChoice).trim() === "2" ? "Online" : String(methodChoice).trim() === "1" ? "Cash" : null;
    if (!method) { alert("Sirf 1 (Cash) ya 2 (Online) चुनें।"); return; }
    const note = prompt("Note (optional) — blank छोड़ सकते हैं:", "");
    if (note === null) return;

    const paidAmount = alreadyPaid + amount;
    const dueAmount = Math.max(0, netTotal - paidAmount);
    const paymentEntry = {
      amount,
      date: new Date().toLocaleDateString("en-IN"),
      time: new Date().toLocaleTimeString("en-IN"),
      timestamp: Date.now(),
      method,
      ...(String(note).trim() ? { note: String(note).trim() } : {})
    };
    const paymentHistory = [...(order.paymentHistory || []), paymentEntry];

    try {
      const paymentPatch = { paidAmount, dueAmount, paymentReceived: true, paymentReceivedAt: Date.now(), paymentHistory, status: dueAmount === 0 ? "received" : (order.status || "accepted"), updatedAt: Date.now() };
      await db.collection("orders").doc(orderId).update(paymentPatch);
      await syncPublicTracking({ ...order, ...paymentPatch, netTotal });
      await loadOrders();
      renderOrders();
      renderSalesDashboard();
      alert(`Payment ${money(amount)} received successfully.`);
    } catch (error) {
      alert(`Payment save नहीं हुआ: ${errorText(error)}`);
    }
  }

  function sendPaymentMessage(orderId) {
    const order = orders.find(item => item.id === orderId);
    if (!order) return;
    const rawNumber = String(order.customer?.number || "").replace(/\D/g, "");
    if (rawNumber.length < 10) {
      alert("Customer ka valid mobile number available nahi hai.");
      return;
    }
    const number = rawNumber.length === 10 ? `91${rawNumber}` : rawNumber;
    const paid = Number(order.paidAmount || 0);
    const netTotal = Number(order.netTotal ?? order.total ?? 0);
    const due = Math.max(0, Number(order.dueAmount ?? netTotal - paid));
    const message = `CocoBiz Payment Update\n\nDear ${order.customer?.name || "Customer"},\n\nPayment of ${money(paid)} has been received for Order #${order.id}.\nTotal Bill: ${money(netTotal)}\nTotal Received: ${money(paid)}\n${due > 0 ? `Remaining Due: ${money(due)}` : "Payment fully received. Thank you!"}\n\nThank you for doing business with CocoBiz.`;
    window.open(`https://wa.me/${number}?text=${encodeURIComponent(message)}`, "_blank", "noopener");
  }

  async function undoLastPayment(orderId) {
    if (currentRole !== "admin") return;
    const order = orders.find(item => item.id === orderId);
    if (!order) return;

    const history = Array.isArray(order.paymentHistory) ? [...order.paymentHistory] : [];
    if (!history.length) {
      alert("Is order me undo karne ke liye payment history nahi hai.");
      return;
    }

    const last = history[history.length - 1];
    const amount = Number(last.amount || 0);
    if (!confirm(`Last payment ${money(amount)} ko undo karna hai?\n\nPayment: ${money(amount)}\nDate: ${last.date || ""} ${last.time || ""}`)) return;

    const newHistory = history.slice(0, -1);
    const paidAmount = newHistory.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const netTotal = Number(order.netTotal ?? order.total ?? 0);
    const dueAmount = Math.max(0, netTotal - paidAmount);
    const creditAmount = Math.max(0, paidAmount - netTotal);
    const status = dueAmount === 0 && paidAmount > 0 ? "received" : "accepted";

    try {
      const undoPatch = { paymentHistory: newHistory, paidAmount, dueAmount, creditAmount, paymentReceived: paidAmount > 0, paymentReceivedAt: paidAmount > 0 ? (newHistory[newHistory.length - 1]?.timestamp || null) : null, status, updatedAt: Date.now() };
      await db.collection("orders").doc(orderId).update(undoPatch);
      await syncPublicTracking({ ...order, ...undoPatch, netTotal });
      await loadOrders();
      renderOrders();
      renderSalesDashboard();
      alert(`Last payment ${money(amount)} undo ho gaya.`);
    } catch (error) {
      alert(`Payment undo nahi hua: ${errorText(error)}`);
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

    const accepted = orders.filter(order => !["pending","salesman_pending","pending_admin","cancelled","returned"].includes(order.status));
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
      !["pending","salesman_pending","pending_admin","cancelled","returned"].includes(order.status) && customerKey(order) === key
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
      <div class="account-actions">
        <button class="primary-button" type="button" data-remind-customer="${encodeURIComponent(key)}">📲 Send Due Reminder</button>
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
            <div class="account-order-actions"><button class="secondary-button" type="button" data-bill-customer-order="${escapeHtml(order.id)}">🧾 Bill</button></div>
            <h4>💰 Payment History</h4>
            ${history.length ? history.map(p => `<div class="payment-history-row"><span>${escapeHtml(p.date)} ${escapeHtml(p.time)}</span><b>${money(p.amount)}</b><small>${escapeHtml(p.method || "Payment")}${p.note ? ` · ${escapeHtml(p.note)}` : ""}</small></div>`).join("") : `<p class="modal-subtitle">No payment received yet.</p>`}
          </div>`;
      }).join("")}
    `;

    modal.classList.remove("hidden");
  }

  function cleanFirestoreValue(value) {
    if (Array.isArray(value)) return value.map(cleanFirestoreValue);
    if (value && typeof value === "object" && !(value instanceof Date)) {
      const out = {};
      Object.entries(value).forEach(([key, val]) => {
        if (val !== undefined) out[key] = cleanFirestoreValue(val);
      });
      return out;
    }
    return value;
  }

  async function processReturn(orderId) {
    const order = orders.find(item => item.id === orderId);
    if (!order) return;

    // Some older orders may not have an item.id. Firestore rejects undefined
    // values inside arrays, so always use a stable fallback key.
    const itemKey = (item) => String(item?.id ?? item?.productId ?? item?.sku ?? item?.name ?? "");
    const available = (order.items || []).filter(item => {
      const key = itemKey(item);
      const returnedQty = (order.returns || [])
        .filter(r => itemKey(r) === key)
        .reduce((sum, r) => sum + Number(r.quantity || 0), 0);
      return Number(item.quantity || 0) - returnedQty > 0;
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
    const productId = itemKey(item);
    const alreadyReturned = (order.returns || [])
      .filter(r => itemKey(r) === productId)
      .reduce((sum, r) => sum + Number(r.quantity || 0), 0);
    const maxQty = Number(item.quantity || 0) - alreadyReturned;

    const qty = Number(prompt(`"${item.name}" ki kitni quantity return hui? (1-${maxQty})`, "1"));
    if (!Number.isInteger(qty) || qty < 1 || qty > maxQty) {
      alert("Invalid quantity.");
      return;
    }

    const unitPrice = Number(item.price ?? item.rate ?? 0);
    const returnEntry = {
      productId,
      name: String(item.name ?? "Product"),
      quantity: qty,
      price: unitPrice,
      total: unitPrice * qty,
      date: new Date().toLocaleString("en-IN"),
      timestamp: Date.now()
    };

    const returns = [...(order.returns || []), returnEntry];
    const returnedTotal = returns.reduce((sum, r) => sum + Number(r.total || 0), 0);
    const netTotal = Math.max(0, Number(order.total || 0) - returnedTotal);
    // A return must NEVER silently reduce or increase the money already received.
    // Keep paidAmount exactly as recorded; only recalculate the new due.
    const paidAmount = Number(order.paidAmount || 0);
    const dueAmount = Math.max(0, netTotal - paidAmount);
    const creditAmount = Math.max(0, paidAmount - netTotal);

    try {
      const returnUpdate = cleanFirestoreValue({
        returns,
        returnedTotal,
        netTotal,
        // Payment received is NEVER changed by a return.
        paidAmount,
        dueAmount,
        creditAmount,
        updatedAt: Date.now()
      });
      await db.collection("orders").doc(orderId).update(returnUpdate);
      await syncPublicTracking({ ...order, ...returnUpdate, netTotal });
      // Returned quantity is added back to tracked stock.
      const trackedProduct = products.find(p => p.id === item.id || p.id === productId);
      if (trackedProduct?.stock != null && trackedProduct.id) {
        await db.collection("products").doc(trackedProduct.id).update({stock: Number(trackedProduct.stock) + qty, updatedAt: Date.now()});
        await loadProducts();
      }

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
    const credit = Math.max(0, Number(order.creditAmount ?? paid - netTotal));
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
      <strong>Total Due: ₹${due.toFixed(2)}</strong>${credit ? `<br><strong>Credit / Refund Due: ₹${credit.toFixed(2)}</strong>` : ""}
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

  function acceptedOrdersForReports() {
    const accepted = orders.filter(order => !["pending","salesman_pending","pending_admin","cancelled","returned"].includes(order.status));
    if (reportPeriod === "all") return accepted;
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    if (reportPeriod === "7days") start.setDate(start.getDate() - 6);
    return accepted.filter(order => Number(order.createdAt || 0) >= start.getTime());
  }

  function getOrderNet(order) {
    return Number(order.netTotal ?? order.total ?? 0);
  }

  function getOrderDue(order) {
    return Math.max(0, Number(order.dueAmount ?? (getOrderNet(order) - Number(order.paidAmount || 0))));
  }

  function estimateOrderProfit(order) {
    let profit = 0, known = false;
    const returnedQty = new Map();
    (order.returns || []).forEach(r => returnedQty.set(r.productId, (returnedQty.get(r.productId)||0) + Number(r.quantity||0)));
    (order.items || []).forEach(item => {
      let cost = item.costPrice;
      if (cost == null) cost = products.find(p=>p.id===item.id)?.costPrice;
      if (cost == null) return;
      known = true;
      const qty = Math.max(0, Number(item.quantity||0) - Number(returnedQty.get(item.id)||0));
      profit += (Number(item.price ?? (item.total/(Number(item.quantity)||1))) - Number(cost)) * qty;
    });
    return known ? profit : null;
  }

  function renderDashboardInsights(dashboardOrders) {
    const low = products.filter(p => p.stock != null && Number(p.stock) <= 10).sort((a,b)=>Number(a.stock)-Number(b.stock));
    const lowBox = $("lowStockList");
    if (lowBox) lowBox.innerHTML = low.length
      ? low.map(p => `<div class="insight-row"><span>${escapeHtml(p.name)}</span><b>${Number(p.stock)} left</b></div>`).join("")
      : `<span class="muted">No low-stock items. Add stock quantity in Products.</span>`;

    const counts = new Map();
    dashboardOrders.forEach(order => (order.items || []).forEach(item => {
      const key = item.id || item.name;
      const entry = counts.get(key) || {name:item.name, qty:0, sales:0, profit:0, profitKnown:false};
      entry.qty += Number(item.quantity || 0);
      entry.sales += Number(item.total || 0);
      const cost = item.costPrice == null ? products.find(p=>p.id===item.id)?.costPrice : item.costPrice;
      if (cost != null) { entry.profit += (Number(item.price ?? 0)-Number(cost))*Number(item.quantity||0); entry.profitKnown=true; }
      counts.set(key, entry);
    }));
    const top = [...counts.values()].sort((a,b)=>b.sales-a.sales).slice(0,5);
    const topBox = $("topProductsList");
    if (topBox) topBox.innerHTML = top.length
      ? top.map((x,i)=>`<div class="insight-row"><span>${i+1}. ${escapeHtml(x.name)}</span><b>${x.qty} · ${money(x.sales)}${x.profitKnown ? ` · P ${money(x.profit)}` : ""}</b></div>`).join("")
      : `<span class="muted">No sales data.</span>`;

    const performance = $("salesmanPerformance");
    if (!performance) return;
    const map = new Map();
    dashboardOrders.filter(o=>o.salesmanId).forEach(o=>{
      const key=o.salesmanId;
      const e=map.get(key)||{name:o.salesmanName||"Salesman",orders:0,sales:0,paid:0,due:0,profit:0,profitKnown:false};
      e.orders++; e.sales+=getOrderNet(o); e.paid+=Number(o.paidAmount||0); e.due+=getOrderDue(o);
      const p=estimateOrderProfit(o); if(p!=null){e.profit+=p;e.profitKnown=true;} map.set(key,e);
    });
    const rows=[...map.values()].sort((a,b)=>b.sales-a.sales);
    performance.innerHTML=rows.length ? rows.map(x=>`<div class="report-row"><div><b>👤 ${escapeHtml(x.name)}</b><small>${x.orders} accepted order(s)</small></div><div><b>${money(x.sales)}</b><small>Received ${money(x.paid)} · Due ${money(x.due)}${x.profitKnown ? ` · Profit ${money(x.profit)}` : ""}</small></div></div>`).join("") : `<p class="modal-subtitle">No accepted salesman sales yet.</p>`;
  }

  function sendDueReminder(key) {
    const accepted = orders.filter(o=>["accepted","received"].includes(o.status) && customerKey(o)===key);
    if (!accepted.length) return;
    const customer=accepted[0].customer||{};
    const due=accepted.reduce((s,o)=>s+getOrderDue(o),0);
    if (due<=0) { alert("Is customer ka koi due nahi hai."); return; }
    const number=String(customer.number||"").replace(/\D/g,"");
    if (number.length!==10) { alert("Customer ka valid 10-digit mobile number nahi mila."); return; }
    const message=`CocoBiz – Payment Reminder\n\nDear ${customer.name||"Customer"},\nYour pending amount is ${money(due)}.\nKindly clear your outstanding payment.\n\nThank you for doing business with CocoBiz. 🍫`;
    window.open(`https://wa.me/91${number}?text=${encodeURIComponent(message)}`,"_blank");
  }

  function exportBusinessCSV() {
    const accepted = orders.filter(o=>["accepted","received"].includes(o.status));
    const rows = [["Order ID","Date","Customer","Mobile","Salesman","Status","Total","Paid","Due","Products"]];
    accepted.forEach(o=>rows.push([
      o.id,o.date||"",o.customer?.name||"",o.customer?.number||"",o.salesmanName||"",o.status||"",
      getOrderNet(o).toFixed(2),Number(o.paidAmount||0).toFixed(2),getOrderDue(o).toFixed(2),
      (o.items||[]).map(i=>`${i.name} x ${i.quantity}`).join(" | ")
    ]));
    const csv=rows.map(r=>r.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8;"});
    const url=URL.createObjectURL(blob); const a=document.createElement("a");
    a.href=url; a.download=`cocobiz-business-${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  function exportFullBackup() {
    const backup = {
      exportedAt: new Date().toISOString(),
      app: "CocoBiz",
      products,
      orders,
      salesmen: salesmen.map(s => ({ id:s.id, name:s.name, number:s.number, email:s.email, role:s.role, rates:s.rates || {}, active:s.active !== false }))
    };
    const blob=new Blob([JSON.stringify(backup,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob); const a=document.createElement("a");
    a.href=url; a.download=`cocobiz-full-backup-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(url);
    alert("Full business backup download ho gaya. Is file ko safe jagah par rakhein.");
  }

  async function enableOrderNotifications() {
    if (currentRole !== "admin") { alert("Order alerts sirf Admin ke liye available hain."); return; }
    if (!("Notification" in window)) { alert("Is browser me notifications supported nahi hain."); return; }
    const permission=await Notification.requestPermission();
    if (permission === "granted") { notificationPrimed=true; alert("Order alerts enabled. CocoBiz tab open rehne par naye orders ki notification milegi."); }
    else alert("Notification permission allow nahi hua.");
  }

  function notifyNewOrders(previousOrders, newOrders) {
    if (currentRole !== "admin" || !notificationPrimed || !window.Notification || Notification.permission !== "granted") return;
    const prev=new Set(previousOrders.map(o=>o.id));
    newOrders.filter(o=>!prev.has(o.id) && ["pending","pending_admin"].includes(o.status)).forEach(o=>{
      new Notification("CocoBiz — New Order", {body:`${o.customer?.name||"Customer"} · ${money(getOrderNet(o))}\nStatus: ${o.status}`});
    });
  }

  async function pollOrdersForNotifications() {
    if (!db || currentRole !== "admin" || !auth?.currentUser) return;
    try {
      const previous=orders.slice();
      await loadOrders();
      notifyNewOrders(previous, orders);
      renderOrders(); renderSalesDashboard();
      if (currentRole === "admin") renderSalesmen();
    } catch(e) { console.warn("Order notification poll failed",e); }
  }

  function renderSalesDashboard() {
    const dashboardOrders = acceptedOrdersForReports();
    const total = dashboardOrders.reduce((sum, order) => sum + getOrderNet(order), 0);
    const paid = dashboardOrders.reduce((sum, order) => sum + Number(order.paidAmount || 0), 0);
    const due = dashboardOrders.reduce((sum, order) => sum + getOrderDue(order), 0);
    const profitValues = dashboardOrders.map(estimateOrderProfit).filter(v => v != null);
    const estimatedProfit = profitValues.reduce((a,b)=>a+b,0);
    if ($("todaySale")) $("todaySale").textContent = money(total);
    if ($("todayPaid")) $("todayPaid").textContent = money(paid);
    if ($("todayDue")) $("todayDue").textContent = money(due);
    if ($("estimatedProfit")) $("estimatedProfit").textContent = profitValues.length ? money(estimatedProfit) : "Not set";
    if ($("acceptedOrderTotal")) $("acceptedOrderTotal").textContent = dashboardOrders.length;
    const salesmanPayableBox = $("salesmanPayableSummary");
    if (salesmanPayableBox) {
      if (currentRole === "salesman" && currentProfile) {
        const payable = dashboardOrders.reduce((sum,o)=>sum+getSalesmanCostTotal(o),0);
        const received = Number(currentProfile.salesmanReceivedAmount || 0);
        const dueToAdmin = Math.max(0, payable - received);
        salesmanPayableBox.innerHTML = `<div><small>Aapko CocoBiz ko dena hai (Cost Rate)</small><strong>${money(payable)}</strong></div><div><small>Admin ko aapne diya</small><strong>${money(received)}</strong></div><div><small>Abhi dena baaki</small><strong>${money(dueToAdmin)}</strong></div>`;
        salesmanPayableBox.classList.remove("hidden");
      } else if (currentRole === "admin") {
        const totalReceivable = salesmen.reduce((sum,s)=>sum+getSalesmanReceivable(s).due,0);
        salesmanPayableBox.innerHTML = `<div><small>Salesmen se Lena Baaki (Cost Rate)</small><strong>${money(totalReceivable)}</strong></div>`;
        salesmanPayableBox.classList.remove("hidden");
      } else { salesmanPayableBox.classList.add("hidden"); }
    }
    renderAcceptedOrderFolders();
    renderDashboardInsights(dashboardOrders);
  }

  async function loadInitialData() {
    await loadPublicSalesmanProfile();
    await Promise.all([loadProducts(), loadOrders(), loadOffer(), loadStoreSettings()]);
    renderStoreSettings();
    renderProducts();
    renderCustomerOffer();
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
      // Re-check scheduled offers so start/end transitions happen automatically while the page is open.
      const refreshScheduledOffer = async () => {
        if (!db) return;
        const previousOfferId = activeOffer?.id || null;
        await loadOffer();
        const currentOfferId = activeOffer?.id || null;
        if (document.visibilityState !== "hidden" && currentOfferId !== previousOfferId) {
          renderCustomerOffer(true);
        }
      };
      // Check frequently enough that a scheduled start/end changes almost
      // immediately, even when the customer leaves the page open.
      setInterval(refreshScheduledOffer, 10000);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") refreshScheduledOffer();
      });
      window.addEventListener("online", retryPendingOrders);
      setTimeout(retryPendingOrders, 1500);
      // Lightweight in-page order alerts; no external notification service required.
      clearInterval(orderPollTimer);
      orderPollTimer = setInterval(pollOrdersForNotifications, 30000);
    } catch (error) {
      console.error("Firebase initialization error:", error);
      alert(`Firebase connect नहीं हो सका: ${errorText(error)}`);
    }
  }

  start();
})();