(function () {
  "use strict";

  const GH_API = "https://api.github.com";
  const VAULT_PATH = "vault.json"; // relative fetch path (we're already inside /admin/)
  const VAULT_REPO_PATH = "admin/vault.json"; // full path from the repo root, for GitHub API calls
  const SESSION_KEY = "dvv_admin_session_v1";

  // ---------------- Base64 (UTF-8 safe) helpers ----------------
  function b64EncodeUtf8(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }
  function b64DecodeUtf8(str) {
    return decodeURIComponent(escape(atob(str)));
  }
  function bufToB64(buf) {
    let binary = "";
    const bytes = new Uint8Array(buf);
    bytes.forEach((b) => (binary += String.fromCharCode(b)));
    return btoa(binary);
  }
  function b64ToBuf(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  // ---------------- Crypto (passphrase-encrypted vault) ----------------
  async function deriveKey(passphrase, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encryptVault(passphrase, dataObj) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt);
    const enc = new TextEncoder();
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(dataObj)));
    return { salt: bufToB64(salt), iv: bufToB64(iv), data: bufToB64(ciphertext) };
  }

  async function decryptVault(passphrase, vault) {
    const salt = new Uint8Array(b64ToBuf(vault.salt));
    const iv = new Uint8Array(b64ToBuf(vault.iv));
    const key = await deriveKey(passphrase, salt);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, b64ToBuf(vault.data));
    return JSON.parse(new TextDecoder().decode(plaintext));
  }

  function getStoredVault() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function storeSession(sessionObj) {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(sessionObj)); } catch (e) {}
  }
  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  // The encrypted vault lives IN THE REPO (admin/vault.json), not per-device.
  // Any device that opens /admin/ fetches this same file, so every device only
  // ever needs the passphrase — never the GitHub token — after the one-time setup.
  async function fetchRepoVault() {
    try {
      const res = await fetch("vault.json", { cache: "no-store" });
      if (!res.ok) return null;
      return res.json();
    } catch (e) {
      return null;
    }
  }

  // ---------------- GitHub API ----------------
  function ghHeaders(session) {
    return {
      Authorization: `Bearer ${session.token}`,
      Accept: "application/vnd.github+json",
    };
  }

  async function ghGetFile(session, path) {
    const url = `${GH_API}/repos/${session.owner}/${session.repo}/contents/${path}?ref=${encodeURIComponent(session.branch)}`;
    const res = await fetch(url, { headers: ghHeaders(session) });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`No se pudo leer ${path} (HTTP ${res.status}). ${body.message || ""}`);
    }
    const json = await res.json();
    const content = b64DecodeUtf8(json.content.replace(/\n/g, ""));
    return { content: JSON.parse(content), sha: json.sha };
  }

  async function ghGetShaIfExists(session, path) {
    try {
      const url = `${GH_API}/repos/${session.owner}/${session.repo}/contents/${path}?ref=${encodeURIComponent(session.branch)}`;
      const res = await fetch(url, { headers: ghHeaders(session) });
      if (!res.ok) return null;
      const json = await res.json();
      return json.sha;
    } catch (e) {
      return null;
    }
  }

  async function ghPutJSON(session, path, dataObj, sha, message) {
    const content = b64EncodeUtf8(JSON.stringify(dataObj, null, 2));
    const body = { message, content, branch: session.branch };
    if (sha) body.sha = sha;
    const res = await fetch(`${GH_API}/repos/${session.owner}/${session.repo}/contents/${path}`, {
      method: "PUT",
      headers: { ...ghHeaders(session), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`No se pudo guardar ${path} (HTTP ${res.status}). ${err.message || ""}`);
    }
    return res.json();
  }

  async function ghPutImage(session, path, base64Content, message) {
    const sha = await ghGetShaIfExists(session, path);
    const body = { message, content: base64Content, branch: session.branch };
    if (sha) body.sha = sha;
    const res = await fetch(`${GH_API}/repos/${session.owner}/${session.repo}/contents/${path}`, {
      method: "PUT",
      headers: { ...ghHeaders(session), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`No se pudo subir la imagen ${path} (HTTP ${res.status}). ${err.message || ""}`);
    }
    return res.json();
  }

  // ---------------- App state ----------------
  let session = null; // { owner, repo, branch, token }
  let state = {
    products: [], productsSha: null,
    sections: [], sectionsSha: null,
  };
  let pendingImages = {}; // path -> base64content (no data: prefix)
  let dirty = false;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function formatPrice(n) {
    return "$" + Number(n || 0).toLocaleString("es-AR");
  }

  function slugify(str) {
    return str
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }

  function showStatus(msg, kind) {
    const bar = $("#statusBar");
    bar.textContent = msg;
    bar.className = "a-status " + (kind || "");
    bar.hidden = false;
  }
  function hideStatus() {
    $("#statusBar").hidden = true;
  }

  // ---------------- Gate: setup / unlock ----------------
  let cachedVault = null; // the encrypted blob fetched from the repo (not the decrypted secrets)

  async function initGate() {
    // Session cache (this tab only) — skip straight in if we already unlocked earlier in this tab.
    const cachedSession = getStoredVault();
    if (cachedSession) {
      session = cachedSession;
      enterDashboard();
      return;
    }

    $("#setupForm").hidden = true;
    $("#unlockForm").hidden = true;
    showStatus("Verificando configuración…", "loading");
    cachedVault = await fetchRepoVault();
    hideStatus();

    if (cachedVault) {
      $("#unlockForm").hidden = false;
    } else {
      $("#setupForm").hidden = false;
    }
  }

  $("#setupSubmit").addEventListener("click", async () => {
    const owner = $("#setupOwner").value.trim();
    const repo = $("#setupRepo").value.trim();
    const branch = $("#setupBranch").value.trim() || "main";
    const token = $("#setupToken").value.trim();
    const pass = $("#setupPass").value;
    const pass2 = $("#setupPass2").value;
    const errEl = $("#setupError");

    if (!owner || !repo || !token || !pass) {
      errEl.textContent = "Completá usuario, repositorio, token y clave.";
      errEl.hidden = false;
      return;
    }
    if (pass !== pass2) {
      errEl.textContent = "Las claves no coinciden.";
      errEl.hidden = false;
      return;
    }
    errEl.hidden = true;

    const btn = $("#setupSubmit");
    const original = btn.textContent;
    btn.textContent = "Guardando en GitHub…";
    btn.disabled = true;

    try {
      const tempSession = { owner, repo, branch, token };
      const vault = await encryptVault(pass, tempSession);
      const existingSha = await ghGetShaIfExists(tempSession, VAULT_REPO_PATH);
      await ghPutJSON(tempSession, VAULT_REPO_PATH, vault, existingSha, "Admin: configura acceso del panel");

      session = tempSession;
      storeSession(session);
      enterDashboard();
    } catch (e) {
      errEl.textContent = "Error guardando la configuración: " + e.message;
      errEl.hidden = false;
    } finally {
      btn.textContent = original;
      btn.disabled = false;
    }
  });

  $("#unlockSubmit").addEventListener("click", async () => {
    const pass = $("#unlockPass").value;
    const errEl = $("#unlockError");
    if (!cachedVault) {
      await initGate();
      return;
    }
    try {
      const data = await decryptVault(pass, cachedVault);
      session = data;
      storeSession(session);
      errEl.hidden = true;
      enterDashboard();
    } catch (e) {
      errEl.textContent = "Clave incorrecta.";
      errEl.hidden = false;
    }
  });

  $("#unlockPass").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("#unlockSubmit").click();
  });

  $("#resetVaultBtn").addEventListener("click", () => {
    if (confirm("Esto te lleva a reconfigurar el panel (vas a necesitar el token de GitHub de nuevo). La clave anterior deja de servir. ¿Seguro?")) {
      $("#unlockForm").hidden = true;
      $("#setupForm").hidden = false;
    }
  });

  $("#lockBtn").addEventListener("click", () => {
    session = null;
    clearSession();
    $("#dashScreen").hidden = true;
    $("#topbarActions").hidden = true;
    $("#gateScreen").hidden = false;
    initGate();
  });

  // ---------------- Dashboard ----------------
  async function enterDashboard() {
    $("#gateScreen").hidden = true;
    $("#dashScreen").hidden = false;
    $("#topbarActions").hidden = false;
    $("#repoTag").textContent = `${session.owner}/${session.repo} (${session.branch})`;

    showStatus("Cargando catálogo desde GitHub…", "loading");
    try {
      const [productsRes, sectionsRes] = await Promise.all([
        ghGetFile(session, "data/products.json"),
        ghGetFile(session, "data/sections.json"),
      ]);
      state.products = productsRes.content;
      state.productsSha = productsRes.sha;
      state.sections = sectionsRes.content;
      state.sectionsSha = sectionsRes.sha;
      pendingImages = {};
      dirty = false;
      hideStatus();
      renderProductsTable();
      renderSectionsTable();
      populateTagSelect();
    } catch (e) {
      showStatus("Error cargando: " + e.message, "err");
    }
  }

  function markDirty() {
    dirty = true;
  }

  // ---------------- Products table ----------------
  function renderProductsTable(filterText) {
    const el = $("#productsTable");
    const q = (filterText || "").toLowerCase();
    const list = state.products.filter((p) => !q || (p.brand + " " + p.flavor).toLowerCase().includes(q));

    if (list.length === 0) {
      el.innerHTML = `<p class="a-empty">No hay productos que coincidan.</p>`;
      return;
    }

    el.innerHTML = list
      .map((p) => {
        const imgSrc = pendingImages["assets/products/" + p.img]
          ? "data:image/*;base64," + pendingImages["assets/products/" + p.img]
          : "../assets/products/" + p.img;
        return `
        <div class="a-row" data-id="${p.id}">
          <img src="${imgSrc}" alt="">
          <div class="a-row__info">
            <div class="a-row__brand">${p.brand}</div>
            <div class="a-row__flavor">${p.flavor}</div>
            <div class="a-row__meta">${p.tag}${p.puffs ? " · " + p.puffs + " puffs" : ""}</div>
          </div>
          <div class="a-row__price">${formatPrice(p.price)}</div>
          <div class="a-row__actions">
            <button class="a-btn a-btn--secondary a-btn--sm" data-edit="${p.id}">Editar</button>
          </div>
        </div>`;
      })
      .join("");

    $$("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => openProductModal(btn.getAttribute("data-edit")));
    });
  }

  $("#productSearch").addEventListener("input", (e) => renderProductsTable(e.target.value));
  $("#addProductBtn").addEventListener("click", () => openProductModal(null));

  function populateTagSelect() {
    const sel = $("#pTag");
    sel.innerHTML = state.sections.map((s) => `<option value="${s.tag}">${s.label} (${s.tag})</option>`).join("");
  }

  // ---------------- Product modal ----------------
  let currentEditId = null;
  let currentImageFile = null;

  function openProductModal(id) {
    currentEditId = id;
    currentImageFile = null;
    $("#productModalError").hidden = true;
    $("#pImagePreview").innerHTML = "";
    $("#pImageFile").value = "";

    if (id) {
      const p = state.products.find((x) => x.id === id);
      $("#productModalTitle").textContent = "Editar producto";
      $("#pId").value = p.id;
      $("#pBrand").value = p.brand;
      $("#pFlavor").value = p.flavor;
      $("#pPrice").value = p.price;
      $("#pPuffs").value = p.puffs || "";
      $("#pTag").value = p.tag;
      $("#pImagePreview").innerHTML = `<img src="../assets/products/${p.img}" alt="">`;
      $("#pDeleteBtn").hidden = false;
    } else {
      $("#productModalTitle").textContent = "Nuevo producto";
      $("#pId").value = "";
      $("#pBrand").value = "";
      $("#pFlavor").value = "";
      $("#pPrice").value = "";
      $("#pPuffs").value = "";
      $("#pTag").value = state.sections[0] ? state.sections[0].tag : "";
      $("#pDeleteBtn").hidden = true;
    }

    $("#productModalOverlay").hidden = false;
    $("#productModal").hidden = false;
  }

  function closeProductModal() {
    $("#productModalOverlay").hidden = true;
    $("#productModal").hidden = true;
  }
  $("#productModalClose").addEventListener("click", closeProductModal);
  $("#productModalOverlay").addEventListener("click", closeProductModal);

  $("#pImageFile").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    currentImageFile = file;
    const reader = new FileReader();
    reader.onload = () => {
      $("#pImagePreview").innerHTML = `<img src="${reader.result}" alt="">`;
    };
    reader.readAsDataURL(file);
  });

  $("#pSaveBtn").addEventListener("click", async () => {
    const brand = $("#pBrand").value.trim();
    const flavor = $("#pFlavor").value.trim();
    const price = parseInt($("#pPrice").value, 10);
    const puffs = $("#pPuffs").value.trim();
    const tag = $("#pTag").value;
    const errEl = $("#productModalError");

    if (!brand || !flavor || !price || !tag) {
      errEl.textContent = "Completá marca, sabor, precio y sección.";
      errEl.hidden = false;
      return;
    }
    errEl.hidden = true;

    let imgFilename = currentEditId ? state.products.find((p) => p.id === currentEditId).img : null;

    if (currentImageFile) {
      const ext = currentImageFile.name.split(".").pop().toLowerCase();
      imgFilename = `${slugify(brand)}_${slugify(flavor)}.${ext}`;
      const base64 = await fileToBase64(currentImageFile);
      pendingImages["assets/products/" + imgFilename] = base64;
    }

    if (!imgFilename) {
      errEl.textContent = "Subí una foto para el producto.";
      errEl.hidden = false;
      return;
    }

    if (currentEditId) {
      const p = state.products.find((x) => x.id === currentEditId);
      p.brand = brand;
      p.flavor = flavor;
      p.price = price;
      p.puffs = puffs || undefined;
      p.tag = tag;
      p.img = imgFilename;
    } else {
      const id = slugify(brand) + "-" + slugify(flavor) + "-" + Math.random().toString(36).slice(2, 6);
      state.products.push({ id, brand, flavor, price, puffs: puffs || undefined, tag, img: imgFilename });
    }

    markDirty();
    closeProductModal();
    renderProductsTable($("#productSearch").value);
  });

  $("#pDeleteBtn").addEventListener("click", () => {
    if (!currentEditId) return;
    if (!confirm("¿Eliminar este producto de la lista? (se aplica al publicar)")) return;
    state.products = state.products.filter((p) => p.id !== currentEditId);
    markDirty();
    closeProductModal();
    renderProductsTable($("#productSearch").value);
  });

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ---------------- Sections table ----------------
  function renderSectionsTable() {
    const el = $("#sectionsTable");
    el.innerHTML = state.sections
      .map(
        (s, i) => `
      <div class="a-section-row" data-idx="${i}">
        <img src="../assets/sections/${s.img}" alt="">
        <div>
          <input type="text" data-field="label" value="${s.label}" placeholder="Nombre visible">
          <input type="text" data-field="sub" value="${s.sub}" placeholder="Subtítulo (ej: 30.000 puffs)">
        </div>
        <span class="a-row__meta">tag: ${s.tag}</span>
      </div>`
      )
      .join("");

    $$("#sectionsTable input").forEach((input) => {
      input.addEventListener("input", () => {
        const idx = parseInt(input.closest(".a-section-row").getAttribute("data-idx"), 10);
        const field = input.getAttribute("data-field");
        state.sections[idx][field] = input.value;
        markDirty();
      });
    });
  }

  // ---------------- Tabs ----------------
  $$(".a-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".a-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const target = tab.getAttribute("data-tab");
      $("#tabProducts").hidden = target !== "products";
      $("#tabSections").hidden = target !== "sections";
    });
  });

  // ---------------- Publish (save to GitHub) ----------------
  $("#saveBtn").addEventListener("click", async () => {
    if (!dirty && Object.keys(pendingImages).length === 0) {
      showStatus("No hay cambios para publicar.", "ok");
      setTimeout(hideStatus, 2500);
      return;
    }
    showStatus("Publicando cambios en GitHub…", "loading");
    try {
      const imagePaths = Object.keys(pendingImages);
      for (const path of imagePaths) {
        await ghPutImage(session, path, pendingImages[path], `Admin: actualiza imagen ${path}`);
      }
      pendingImages = {};

      const prodResult = await ghPutJSON(session, "data/products.json", state.products, state.productsSha, "Admin: actualiza productos");
      state.productsSha = prodResult.content.sha;

      const secResult = await ghPutJSON(session, "data/sections.json", state.sections, state.sectionsSha, "Admin: actualiza secciones");
      state.sectionsSha = secResult.content.sha;

      dirty = false;
      showStatus("✓ Publicado. Netlify va a tardar 1-2 minutos en actualizar el sitio.", "ok");
    } catch (e) {
      showStatus("Error publicando: " + e.message + " — probá recargar el panel (los cambios locales se pierden, publicá seguido).", "err");
    }
  });

  // ---------------- Init ----------------
  initGate();
})();
