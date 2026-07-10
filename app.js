(function () {
  "use strict";

  let PRODUCTS = [];
  let SECTIONS = [];
  let WHATSAPP_NUMBER = "";

  const catalogEl = document.getElementById("catalog");
  const emptyStateEl = document.getElementById("emptyState");
  const pillsWrapEl = document.getElementById("filterPillsWrap");
  const pillsEl = document.getElementById("filterPills");
  const sectionPickerEl = document.getElementById("sectionPicker");
  const sectionsGridEl = document.getElementById("sectionsGrid");
  const filtersEl = document.getElementById("filters");
  const viewAllBtn = document.getElementById("viewAllBtn");
  const backBtn = document.getElementById("backToSections");

  let activeTag = null; // null = landing (no catalog shown yet)
  let activeModel = "all"; // sub-filter within a section (by product.brand)

  // ---------- Cart state ----------
  const CART_KEY = "dvv_cart_v1";
  let cart = {}; // { productId: qty }
  try {
    cart = JSON.parse(localStorage.getItem(CART_KEY)) || {};
  } catch (e) {
    cart = {};
  }

  function saveCart() {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) {}
  }

  function cartCount() {
    return Object.values(cart).reduce((a, b) => a + b, 0);
  }

  function addToCart(id) {
    cart[id] = (cart[id] || 0) + 1;
    saveCart();
    renderCartBadge();
    renderCartPanel();
  }

  function setQty(id, qty) {
    if (qty <= 0) delete cart[id];
    else cart[id] = qty;
    saveCart();
    renderCartBadge();
    renderCartPanel();
  }

  function clearCart() {
    cart = {};
    saveCart();
    renderCartBadge();
    renderCartPanel();
  }

  function renderCartBadge() {
    const n = cartCount();
    const badge = document.getElementById("cartCount");
    badge.textContent = n;
    badge.hidden = n === 0;
    badge.classList.remove("badge-pulse");
    void badge.offsetWidth; // restart animation
    badge.classList.add("badge-pulse");
  }

  function cartLines() {
    return Object.entries(cart)
      .map(([id, qty]) => ({ product: PRODUCTS.find((p) => p.id === id), qty }))
      .filter((l) => l.product);
  }

  function renderCartPanel() {
    const itemsEl = document.getElementById("cartItems");
    const totalEl = document.getElementById("cartTotal");
    const checkoutBtn = document.getElementById("cartCheckout");
    const lines = cartLines();

    if (lines.length === 0) {
      itemsEl.innerHTML = `<p class="cart-empty">Todavía no agregaste nada. Elegí sabores del catálogo y tocá "Agregar".</p>`;
      totalEl.textContent = formatPrice(0);
      checkoutBtn.setAttribute("aria-disabled", "true");
      checkoutBtn.href = "#";
      return;
    }

    let total = 0;
    itemsEl.innerHTML = lines
      .map(({ product, qty }) => {
        const subtotal = product.price * qty;
        total += subtotal;
        return `
        <div class="cart-item" data-id="${product.id}">
          <img src="assets/products/${product.img}" alt="">
          <div class="cart-item__info">
            <span class="cart-item__brand">${product.brand}</span>
            <span class="cart-item__flavor">${product.flavor}</span>
            <span class="cart-item__price">${formatPrice(product.price)} c/u</span>
          </div>
          <div class="cart-item__qty">
            <button class="qty-btn" data-action="dec" data-id="${product.id}" aria-label="Quitar uno">−</button>
            <span>${qty}</span>
            <button class="qty-btn" data-action="inc" data-id="${product.id}" aria-label="Agregar uno">+</button>
          </div>
        </div>`;
      })
      .join("");

    totalEl.textContent = formatPrice(total);
    checkoutBtn.removeAttribute("aria-disabled");
    checkoutBtn.href = buildCartWaLink(lines, total);

    itemsEl.querySelectorAll(".qty-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const current = cart[id] || 0;
        setQty(id, btn.getAttribute("data-action") === "inc" ? current + 1 : current - 1);
      });
    });
  }

  function buildCartWaLink(lines, total) {
    const body = lines
      .map(({ product, qty }) => `• ${qty}x ${product.brand} - ${product.flavor} — ${formatPrice(product.price * qty)}`)
      .join("\n");
    const msg = `Hola! Quiero hacer este pedido:\n${body}\n\nTotal: ${formatPrice(total)}`;
    return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`;
  }

  function openCart() {
    document.getElementById("cartOverlay").hidden = false;
    document.getElementById("cartPanel").hidden = false;
    renderCartPanel();
  }
  function closeCart() {
    document.getElementById("cartOverlay").hidden = true;
    document.getElementById("cartPanel").hidden = true;
  }

  // ---------- Formatting ----------
  function formatPrice(n) {
    return "$" + n.toLocaleString("es-AR");
  }

  function formatWaDisplay(num) {
    let digits = String(num).replace(/\D/g, "");
    if (digits.startsWith("549")) digits = digits.slice(3);
    else if (digits.startsWith("54")) digits = digits.slice(2);
    if (digits.length === 10) {
      return `+54 9 ${digits.slice(0, 4)} ${digits.slice(4, 6)}-${digits.slice(6)}`;
    }
    return "+54 9 " + digits;
  }

  // ---------- Catalog filtering/render ----------
  function matches(product) {
    const tagOk = activeTag === "all" || product.tag === activeTag;
    if (!tagOk) return false;
    const modelOk = activeModel === "all" || product.brand === activeModel;
    return modelOk;
  }

  function render() {
    const list = PRODUCTS.filter(matches);
    catalogEl.innerHTML = "";
    emptyStateEl.hidden = list.length !== 0;

    const frag = document.createDocumentFragment();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.forEach((p, i) => {
      const card = document.createElement("article");
      card.className = "card";
      if (!reduceMotion) card.style.transitionDelay = `${Math.min(i, 8) * 40}ms`;
      card.innerHTML = `
        <div class="card__imgwrap">
          <img src="assets/products/${p.img}" alt="${p.brand} ${p.flavor}" loading="lazy">
        </div>
        <div class="card__body">
          <span class="card__brand">${p.brand}</span>
          <h3 class="card__flavor">${p.flavor}</h3>
          <div class="card__meta">
            <span class="card__price">${formatPrice(p.price)}</span>
            ${p.puffs ? `<span class="card__puffs">${p.puffs} puffs</span>` : ""}
          </div>
          <button class="btn btn--primary btn--sm card__cta" data-add="${p.id}">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
            <span>Agregar</span>
          </button>
        </div>
      `;
      frag.appendChild(card);
    });
    catalogEl.appendChild(frag);

    if (reduceMotion) {
      catalogEl.querySelectorAll(".card").forEach((c) => c.classList.add("in-view"));
    } else {
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add("in-view");
              io.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
      );
      catalogEl.querySelectorAll(".card").forEach((c) => io.observe(c));
    }

    catalogEl.querySelectorAll("[data-add]").forEach((btn) => {
      btn.addEventListener("click", () => {
        addToCart(btn.getAttribute("data-add"));
        const span = btn.querySelector("span");
        const original = span.textContent;
        span.textContent = "Agregado ✓";
        btn.classList.add("added");
        setTimeout(() => {
          span.textContent = original;
          btn.classList.remove("added");
        }, 900);
      });
    });
  }

  // ---------- Filter pills (context-aware) ----------
  function buildPillsForAll() {
    pillsWrapEl.hidden = false;
    pillsEl.innerHTML = "";
    const allBtn = makePill("Todos", "all", activeTag === "all");
    pillsEl.appendChild(allBtn);
    SECTIONS.forEach((s) => {
      pillsEl.appendChild(makePill(s.label, s.tag, activeTag === s.tag, () => showCatalog(s.tag)));
    });
  }

  function buildPillsForModels(tag) {
    const brandsInSection = [...new Set(PRODUCTS.filter((p) => p.tag === tag).map((p) => p.brand))];
    pillsEl.innerHTML = "";
    if (brandsInSection.length <= 1) {
      pillsWrapEl.hidden = true;
      return;
    }
    pillsWrapEl.hidden = false;
    pillsEl.appendChild(
      makePill("Todos", "all", activeModel === "all", () => {
        activeModel = "all";
        refreshModelPillsActive();
        render();
      })
    );
    brandsInSection.forEach((brand) => {
      pillsEl.appendChild(
        makePill(brand, brand, activeModel === brand, () => {
          activeModel = brand;
          refreshModelPillsActive();
          render();
        })
      );
    });
  }

  function refreshModelPillsActive() {
    [...pillsEl.children].forEach((c) => {
      c.classList.toggle("active", c.getAttribute("data-val") === activeModel);
    });
  }

  function makePill(label, val, isActive, onClick) {
    const btn = document.createElement("button");
    btn.className = "pill" + (isActive ? " active" : "");
    btn.textContent = label;
    btn.setAttribute("data-val", val);
    btn.addEventListener("click", onClick || (() => {}));
    return btn;
  }

  // ---------- Navigation between landing / catalog ----------
  function showCatalog(tag) {
    activeTag = tag;
    activeModel = "all";
    sectionPickerEl.hidden = true;
    filtersEl.hidden = false;
    catalogEl.hidden = false;

    if (tag === "all") {
      buildPillsForAll();
    } else {
      buildPillsForModels(tag);
    }
    render();
    filtersEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function showSections() {
    activeTag = null;
    sectionPickerEl.hidden = false;
    filtersEl.hidden = true;
    catalogEl.hidden = true;
    emptyStateEl.hidden = true;
    sectionPickerEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function buildSectionTiles() {
    sectionsGridEl.innerHTML = "";
    SECTIONS.forEach((s) => {
      const count = PRODUCTS.filter((p) => p.tag === s.tag).length;
      const card = document.createElement("button");
      card.className = "section-card";
      card.setAttribute("aria-label", `Ver ${s.label}`);
      card.innerHTML = `
        <img src="assets/sections/${s.img}" alt="" loading="lazy">
        <span class="section-card__tap">${count} sabores</span>
        <div class="section-card__label">
          <span class="section-card__name">${s.label}</span>
          <span class="section-card__sub">${s.sub}</span>
        </div>
      `;
      card.addEventListener("click", () => showCatalog(s.tag));
      sectionsGridEl.appendChild(card);
    });
  }

  viewAllBtn.addEventListener("click", () => showCatalog("all"));
  backBtn.addEventListener("click", showSections);

  function buildHeroBrandLinks() {
    const el = document.getElementById("heroBrandLinks");
    el.innerHTML = SECTIONS.map((s) => `<a href="#" data-tag="${s.tag}">${s.label}</a>`).join('<span class="sep">·</span>');
    el.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        showCatalog(a.getAttribute("data-tag"));
      });
    });
  }

  // ---------- Cart UI wiring (data-independent, wire immediately) ----------
  document.getElementById("cartButton").addEventListener("click", openCart);
  document.getElementById("cartClose").addEventListener("click", closeCart);
  document.getElementById("cartOverlay").addEventListener("click", closeCart);
  document.getElementById("cartClear").addEventListener("click", clearCart);
  renderCartBadge();

  // ---------- Age gate (data-independent, wire immediately) ----------
  const AGE_KEY = "dvv_age_verified";
  const yesBtn = document.getElementById("ageYes");
  if (sessionStorage.getItem(AGE_KEY) === "1") {
    document.body.classList.add("verified");
  }
  yesBtn.addEventListener("click", () => {
    sessionStorage.setItem(AGE_KEY, "1");
    document.body.classList.add("verified");
  });

  // ---------- Load catalog data, then build the data-dependent UI ----------
  const DATA_BASE = "data/";
  async function loadJSON(name) {
    const res = await fetch(DATA_BASE + name, { cache: "no-store" });
    if (!res.ok) throw new Error(`No se pudo cargar ${name} (${res.status})`);
    return res.json();
  }

  async function init() {
    try {
      const [products, sections, config] = await Promise.all([
        loadJSON("products.json"),
        loadJSON("sections.json"),
        loadJSON("config.json"),
      ]);
      PRODUCTS = products;
      SECTIONS = sections;
      WHATSAPP_NUMBER = config.whatsappNumber;

      buildHeroBrandLinks();
      buildSectionTiles();

      const genericWa = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent("Hola! Quería consultar por el catálogo de Del Valle Vapes.")}`;
      const footerLink = document.getElementById("footerWhatsapp");
      footerLink.href = genericWa;
      footerLink.textContent = formatWaDisplay(WHATSAPP_NUMBER);
      document.getElementById("whatsappFab").href = genericWa;
    } catch (err) {
      console.error("Error cargando el catálogo:", err);
      sectionsGridEl.innerHTML = `<p style="color:#a6a2bd">No se pudo cargar el catálogo. Recargá la página o avisale a Simon.</p>`;
    }
  }

  init();
})();
