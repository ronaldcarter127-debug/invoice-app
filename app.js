const App = {
  items: [],
  premium: false,
  invoiceLocked: false,
  activeInvoiceNumber: "",
  activeQuoteNumber: "", // ✅ track current quote
  user: null,
  authReady: false
};

function getApiBaseForAuth() {
  if (typeof getApiBaseUrl === "function") return getApiBaseUrl();
  return "https://jobflow-api-bebm.onrender.com";
}

async function authRequest(path, payload, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;

  const response = await fetch(getApiBaseForAuth() + path, {
    method: payload ? "POST" : "GET",
    headers,
    body: payload ? JSON.stringify(payload) : undefined
  });

  let data = {};
  try {
    data = await response.json();
  } catch (_) {
    data = {};
  }

  if (!response.ok || data.ok === false) {
    throw new Error(data.error || "Authentication failed.");
  }
  return data;
}

function getAuthToken() {
  return String(localStorage.getItem("authToken") || "").trim();
}

function setAuthSession(token, user) {
  localStorage.setItem("authToken", String(token || ""));
  localStorage.setItem("authUser", JSON.stringify(user || null));
  App.user = user || null;
  App.authReady = true;
}

function clearAuthSession() {
  localStorage.removeItem("authToken");
  localStorage.removeItem("authUser");
  App.user = null;
  App.authReady = false;
}

function showAuthGate(errorMessage) {
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("appContainer").style.display = "none";
  document.getElementById("historyView").style.display = "none";
  document.getElementById("settingsView").style.display = "none";
  document.getElementById("customerListView").style.display = "none";

  let gate = document.getElementById("authGate");
  if (!gate) {
    gate = document.createElement("div");
    gate.id = "authGate";
    gate.style.cssText = "position:fixed;inset:0;z-index:10000;background:#0b1220;display:flex;align-items:center;justify-content:center;padding:16px;";
    gate.innerHTML = "" +
      "<div style='width:100%;max-width:420px;background:#111827;border:1px solid #334155;border-radius:14px;padding:20px;color:#f8fafc;'>" +
      "<h2 style='margin:0 0 6px 0;'>JobFlow Pro</h2>" +
      "<p style='margin:0 0 14px 0;color:#94a3b8;'>Create an account or log in to use the app.</p>" +
      "<div id='authError' style='display:none;background:#7f1d1d;color:#fecaca;border:1px solid #991b1b;border-radius:8px;padding:8px 10px;margin-bottom:10px;'></div>" +
      "<input id='authEmail' type='email' placeholder='Email' style='width:100%;box-sizing:border-box;margin-bottom:8px;padding:10px;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#f8fafc;'>" +
      "<input id='authPassword' type='password' placeholder='Password (min 8 chars)' style='width:100%;box-sizing:border-box;margin-bottom:10px;padding:10px;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#f8fafc;'>" +
      "<div style='display:grid;grid-template-columns:1fr 1fr;gap:8px;'>" +
      "<button id='signupBtn' type='button' style='padding:10px;border:none;border-radius:8px;background:#00ee58;color:#052e16;font-weight:700;cursor:pointer;'>Create Account</button>" +
      "<button id='loginBtn' type='button' style='padding:10px;border:none;border-radius:8px;background:#1d4ed8;color:#eff6ff;font-weight:700;cursor:pointer;'>Log In</button>" +
      "</div>" +
      "</div>";
    document.body.appendChild(gate);
  } else {
    gate.style.display = "flex";
  }

  const err = document.getElementById("authError");
  function setAuthError(msg) {
    if (!err) return;
    if (!msg) {
      err.style.display = "none";
      err.textContent = "";
      return;
    }
    err.style.display = "block";
    err.textContent = msg;
  }
  if (err) {
    if (errorMessage) {
      setAuthError(errorMessage);
    } else {
      setAuthError("");
    }
  }

  const signupBtn = document.getElementById("signupBtn");
  const loginBtn = document.getElementById("loginBtn");
  const emailEl = document.getElementById("authEmail");
  const passEl = document.getElementById("authPassword");

  async function submit(mode) {
    const email = String((emailEl && emailEl.value) || "").trim();
    const password = String((passEl && passEl.value) || "");
    if (!email || !password) return setAuthError("Email and password are required.");

    try {
      const endpoint = mode === "signup" ? "/auth/signup" : "/auth/login";
      const payload = { email, password };
      const result = await authRequest(endpoint, payload);
      setAuthError("");
      setAuthSession(result.token, result.user || { email });
      gate.style.display = "none";
      runAppInitOnce();
    } catch (e) {
      setAuthError(e && e.message ? e.message : "Authentication failed.");
    }
  }

  if (signupBtn) signupBtn.onclick = function () { submit("signup"); };
  if (loginBtn) loginBtn.onclick = function () { submit("login"); };
}

async function ensureAuthenticated() {
  const token = getAuthToken();
  if (!token) {
    showAuthGate("");
    return false;
  }

  try {
    const result = await authRequest("/auth/me", null, token);
    setAuthSession(token, result.user || null);
    const gate = document.getElementById("authGate");
    if (gate) gate.style.display = "none";
    return true;
  } catch (_) {
    clearAuthSession();
    showAuthGate("Session expired. Please log in again.");
    return false;
  }
}

let appInitialized = false;

function runAppInitOnce() {
  if (appInitialized) return;
  appInitialized = true;

  App.premium = localStorage.getItem("isPremium") === "true" || localStorage.getItem("premium") === "true";
  checkPaymentReturn();
  bindPrimaryActionButtons();
  addItem();
  setInvoiceEditingLocked(false, "");
  updateLiveTotals();

  refreshSavedCustomersDropdown();

  loadAutoSavedForm();
  loadBusinessInfo();
  updateLogoPreview(localStorage.getItem("businessLogo"));
  checkPremium();

  const amountPaidInput = $id("amountPaid");
  if (amountPaidInput) {
    amountPaidInput.addEventListener("blur", function() {
      const val = parseFloat(this.value) || 0;
      this.value = val.toFixed(2);
      updateLiveTotals();
    });
  }

  const appContainer = $id("appContainer");
  if (appContainer) {
    let updateTimeout;
    appContainer.addEventListener("input", function() {
      clearTimeout(updateTimeout);
      updateTimeout = setTimeout(function() {
        updateLiveTotals();
        autoSaveForm();
      }, 300);
    });
  }

  showDashboard();
}

function setInvoiceEditingLocked(locked, invoiceNumber) {
  App.invoiceLocked = !!locked;
  App.activeInvoiceNumber = invoiceNumber || "";

  const editableIds = [
    "savedCustomers",
    "customer",
    "contact",
    "customerEmail", // add
    "address",
    "description",
    "tax",
    "amountPaid",
    "paymentMethod",
    "dueDate",
    "notes",
    "addItemBtn",
    "saveCustomerBtn"
  ];

  editableIds.forEach(function(id) {
    const el = $id(id);
    if (el) el.disabled = App.invoiceLocked;
  });

  document.querySelectorAll("#items input, #items select, #items textarea").forEach(function(el) {
    el.disabled = App.invoiceLocked;
  });
}

function unlockInvoiceEditing(invoiceNumber) {
  if (!invoiceNumber || (App.activeInvoiceNumber && App.activeInvoiceNumber !== invoiceNumber)) {
    return;
  }
  setInvoiceEditingLocked(false, invoiceNumber);
}

function getDocumentData() {
  const itemsData = App.items.map(function(id) {
    return {
      name: getVal("name-" + id),
      qty: Number(getVal("qty-" + id)) || 1,
      price: Number(getVal("price-" + id))
    };
  }).filter(function(item) {
    return item.name || item.price;
  });

  const taxPercent = Number(getVal("tax")) || 0;
  const amountPaid = Number(getVal("amountPaid")) || 0;
  const totals = calculateTotals(itemsData, taxPercent, amountPaid);

  return {
    // ✅ ensure invoice number is always present
    invoiceNumber: String(App.activeInvoiceNumber || "").trim(),
    date: new Date().toLocaleDateString(),

    businessName: getVal("businessName"),
    businessAddress: getVal("businessAddress"),
    businessPhone: getVal("businessPhone"),
    businessEmail: getVal("businessEmail"),
    businessStripeUrl: getVal("businessStripeUrl"),
    businessLicense: getVal("businessLicense"),
    businessSignatureName: getVal("businessSignatureName").trim(),
    businessLogo: localStorage.getItem("businessLogo"),
    businessLogoSize: getVal("logoSize"),
    businessLogoCrop: getVal("logoCrop"),
    customer: getVal("customer"),
    contact: getVal("contact"),
    email: getVal("customerEmail"), // add
    address: getVal("address"),
    description: getVal("description"),
    taxPercent: taxPercent,
    amountPaid: totals.paid,
    paymentMethod: getVal("paymentMethod"),
    dueDate: getVal("dueDate"),
    notes: getVal("notes"),
    items: itemsData,
    total: totals.subtotal,
    taxAmount: totals.tax,
    finalTotal: totals.total,
    balanceDue: totals.balance
  };
}

function resetEntryFieldsAfterCreate() {
  setVal("savedCustomers", "");
  setVal("customer", "");
  setVal("contact", "");
  setVal("address", "");
  setVal("description", "");
  setVal("tax", "");
  setVal("amountPaid", "0.00"); // force reset
  setVal("paymentMethod", "");
  setVal("dueDate", "");
  setVal("notes", "");
  setHTML("items", "");
  removeClass("previewArea", "show");
  App.items = [];
  App.activeInvoiceNumber = "";
  App.activeQuoteNumber = ""; // clear quote context too
  App.invoiceLocked = false;
  addItem();
  setInvoiceEditingLocked(false, "");
  updateLiveTotals();
  autoSaveForm();
}

function autoSaveForm() {
  const formData = {
    businessName: getVal("businessName"),
    businessAddress: getVal("businessAddress"),
    businessPhone: getVal("businessPhone"),
    businessEmail: getVal("businessEmail"),
    businessStripeUrl: getVal("businessStripeUrl"),
    customer: getVal("customer"),
    contact: getVal("contact"),
    customerEmail: getVal("customerEmail"), // add
    address: getVal("address"),
    description: getVal("description"),
    tax: getVal("tax"),
    amountPaid: getVal("amountPaid"),
    paymentMethod: getVal("paymentMethod"),
    dueDate: getVal("dueDate"),
    notes: getVal("notes")
  };
  saveAutoSavedFormData(formData);
}

function loadAutoSavedForm() {
  const formData = getAutoSavedFormData();
  if (!formData) return;

  setVal("businessName", formData.businessName || "Your Business Name");
  setVal("businessAddress", formData.businessAddress || "123 Main St, Murfreesboro, TN");
  setVal("businessPhone", formData.businessPhone || "615-XXX-XXXX");
  setVal("businessEmail", formData.businessEmail || "you@email.com");
  setVal("businessStripeUrl", formData.businessStripeUrl || "");
  setVal("customer", formData.customer || "");
  setVal("contact", formData.contact || "");
  setVal("customerEmail", formData.customerEmail || ""); // add
  setVal("address", formData.address || "");
  setVal("description", formData.description || "");
  setVal("tax", formData.tax || "");
  setVal("amountPaid", formData.amountPaid || "");
  setVal("paymentMethod", formData.paymentMethod || "");
  setVal("dueDate", formData.dueDate || "");
  setVal("notes", formData.notes || "");
}

// ✅ CHECK IF RETURNING FROM STRIPE PAYMENT
function checkPaymentReturn() {
  const params = new URLSearchParams(window.location.search);

  if (params.get("paid") === "1") {
    const invoiceNumber = decodeURIComponent(params.get("invoice") || "");
    const invoices = readJson("invoiceHistory", []);

    if (invoiceNumber) {
      const idx = invoices.findIndex(function(inv) {
        return String(inv.invoiceNumber).trim() === String(invoiceNumber).trim();
      });

      if (idx !== -1) {
        invoices[idx].status = "Paid";
        invoices[idx].amountPaid = invoices[idx].finalTotal || invoices[idx].total || 0;
        invoices[idx].balanceDue = 0;
        invoices[idx].paidAt = new Date().toLocaleString();
        writeJson("invoiceHistory", invoices);
        alert("✅ Payment received! Invoice #" + invoiceNumber + " marked as Paid.");
      } else {
        alert("⚠️ Payment received but invoice #" + invoiceNumber + " not found.");
      }
    }

    window.history.replaceState({}, document.title, "/invoice.html");
  }

  if (params.get("payment") === "cancelled") {
    alert("Payment cancelled. Invoice was not charged.");
    window.history.replaceState({}, document.title, "/invoice.html");
  }
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function showOutputView() {
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("appContainer").style.display = "none";
  document.getElementById("historyView").style.display = "block";
  document.getElementById("settingsView").style.display = "none";
  document.getElementById("customerListView").style.display = "none";
  window.scrollTo(0, 0);
}

window.showOutputView = showOutputView;

function showDashboard() {
  document.getElementById("dashboard").style.display = "block";
  document.getElementById("appContainer").style.display = "none";
  document.getElementById("historyView").style.display = "none";
  document.getElementById("settingsView").style.display = "none";
  document.getElementById("customerListView").style.display = "none";
  document.getElementById("output").innerHTML = "";
  const previewArea = document.getElementById("previewArea");
  if (previewArea) previewArea.classList.remove("show");
  updateDashboard();
}

function updateDashboard() {
  const premium = App.premium;
  const FREE_INVOICE_HISTORY_LIMIT = typeof getFreeInvoiceMonthlyLimit === "function" ? getFreeInvoiceMonthlyLimit() : 5;
  const used = typeof getFreeInvoiceMonthlyUsage === "function" ? getFreeInvoiceMonthlyUsage() : 0;
  const clampedUsed = Math.max(0, used);
  const usageText = clampedUsed + "/" + FREE_INVOICE_HISTORY_LIMIT + " this month";
  const badge = document.getElementById("dashPlanBadge");
  const msg = document.getElementById("dashPlanMsg");
  const upgradeBtn = document.getElementById("upgradeBtn");
  const invCard = document.getElementById("dashInvHistory");
  const invSub = document.getElementById("dashInvSub");

  if (badge) badge.textContent = premium ? "Premium Plan Active" : "Free Plan";
  if (msg) msg.textContent = premium ? "All features unlocked." : "Invoice history: " + usageText + ". Upgrade for unlimited visibility and status.";
  if (upgradeBtn) upgradeBtn.style.display = premium ? "none" : "block";
  if (invCard) invCard.style.opacity = premium ? "1" : "0.55";
  if (invSub) invSub.textContent = premium ? "Unlimited history" : "Free: " + usageText;
}

function openForm(mode) {
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("historyView").style.display = "none";
  document.getElementById("appContainer").style.display = "block";
  App._dashMode = mode;

  const createInvoiceBtn = document.getElementById("createInvoiceBtn");
  const createQuoteBtn = document.getElementById("createQuoteBtn");
  const sendQuoteConvertBtn = document.getElementById("sendQuoteConvertBtn");

  if (mode === "invoice") {
    if (createInvoiceBtn) createInvoiceBtn.style.display = "";
    if (createQuoteBtn) createQuoteBtn.style.display = "none";
    if (sendQuoteConvertBtn) sendQuoteConvertBtn.style.display = "none";
  } else if (mode === "quote") {
    if (createInvoiceBtn) createInvoiceBtn.style.display = "none";
    if (createQuoteBtn) createQuoteBtn.style.display = "";
    if (sendQuoteConvertBtn) sendQuoteConvertBtn.style.display = "";
  }
}

function openInvoiceHistory() {
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("appContainer").style.display = "none";
  document.getElementById("historyView").style.display = "block";
  document.getElementById("settingsView").style.display = "none";
  document.getElementById("customerListView").style.display = "none";
  showInvoiceHistory();
}

function openQuoteHistoryDash() {
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("appContainer").style.display = "none";
  document.getElementById("historyView").style.display = "block";
  document.getElementById("settingsView").style.display = "none";
  document.getElementById("customerListView").style.display = "none";
  showQuoteHistory("all");
}

function openSettings() {
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("appContainer").style.display = "none";
  document.getElementById("historyView").style.display = "none";
  document.getElementById("settingsView").style.display = "block";
  document.getElementById("customerListView").style.display = "none";
  loadBusinessInfo();
  updateLogoPreview(localStorage.getItem("businessLogo"));
}

function openCustomerList() {
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("appContainer").style.display = "none";
  document.getElementById("historyView").style.display = "none";
  document.getElementById("settingsView").style.display = "none";
  document.getElementById("customerListView").style.display = "block";
  renderCustomerList();
}

function renderCustomerList() {
  const out = document.getElementById("customerListOutput");
  if (!out) return;
  const customers = getSavedCustomersListSafe();
  if (!customers.length) {
    out.innerHTML = "<p style='color:#6b7280;'>No saved customers yet.</p>";
    return;
  }
  let html = "";
  customers.forEach(function (c, i) {
    html += "<div class='quote-entry'>";
    html += "<div><strong>" + escapeHtml(c.name || "No name") + "</strong><br>";
    if (c.phone) html += "<span style='color:#6b7280;font-size:13px;'>" + escapeHtml(c.phone) + "</span><br>";
    if (c.email) html += "<span style='color:#6b7280;font-size:13px;'>" + escapeHtml(c.email) + "</span>";
    html += "</div>";
    html += "<div style='display:flex;gap:8px;'>";
    html += "<button onclick='deleteCustomerByIndex(" + i + ")' style='background:#dc2626;color:white;border:none;border-radius:6px;padding:8px 12px;cursor:pointer;'>Delete</button>";
    html += "</div></div>";
  });
  out.innerHTML = html;
}

function deleteCustomerByIndex(index) {
  const list = getSavedCustomersListSafe();
  list.splice(index, 1);
  setSavedCustomersListSafe(list);
  refreshSavedCustomersDropdown();
  renderCustomerList();
}

window.openSettings = openSettings;
window.openCustomerList = openCustomerList;
window.renderCustomerList = renderCustomerList;
window.deleteCustomerByIndex = deleteCustomerByIndex;

window.showDashboard = showDashboard;
window.openForm = openForm;
window.openInvoiceHistory = openInvoiceHistory;
window.openQuoteHistoryDash = openQuoteHistoryDash;

function bindPrimaryActionButtons() {
  const createInvoiceBtn = $id("createInvoiceBtn");
  const createQuoteBtn = $id("createQuoteBtn");
  const previewInvoiceBtn = $id("previewInvoiceBtn");
  const addItemBtn = $id("addItemBtn");
  const dashCreateInvoiceBtn = $id("dashCreateInvoiceBtn");
  const dashCreateQuoteBtn = $id("dashCreateQuoteBtn");
  const dashCustomersBtn = $id("dashCustomersBtn");
  const dashSettingsBtn = $id("dashSettingsBtn");
  const dashInvHistoryBtn = $id("dashInvHistory");
  const dashQuoteHistoryBtn = $id("dashQuoteHistory");

  if (createInvoiceBtn) createInvoiceBtn.onclick = function () { createDoc(); };
  if (createQuoteBtn) createQuoteBtn.onclick = function () { createQuote(); };
  if (previewInvoiceBtn) previewInvoiceBtn.onclick = function () { previewInvoice(); };
  if (addItemBtn) addItemBtn.onclick = function () { addItem(); };
  if (dashCreateInvoiceBtn) dashCreateInvoiceBtn.onclick = function () { openForm("invoice"); };
  if (dashCreateQuoteBtn) dashCreateQuoteBtn.onclick = function () { openForm("quote"); };
  if (dashCustomersBtn) dashCustomersBtn.onclick = function () { openCustomerList(); };
  if (dashSettingsBtn) dashSettingsBtn.onclick = function () { openSettings(); };
  if (dashInvHistoryBtn) dashInvHistoryBtn.onclick = function () { openInvoiceHistory(); };
  if (dashQuoteHistoryBtn) dashQuoteHistoryBtn.onclick = function () { openQuoteHistoryDash(); };
}

window.onload = async function() {
  const authed = await ensureAuthenticated();
  if (!authed) return;
  runAppInitOnce();
};

(function () {
  const KEY = "savedCustomers";
  const SELECTED_KEY = "selectedSavedCustomerIndex";

  function readCustomers() {
    try {
      const arr = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return [];
    }
  }

  function writeCustomers(arr) {
    localStorage.setItem(KEY, JSON.stringify(Array.isArray(arr) ? arr : []));
  }

  function val(id) {
    const el = document.getElementById(id);
    return el ? String(el.value || "").trim() : "";
  }

  function setVal(id, v) {
    const el = document.getElementById(id);
    if (el) el.value = String(v || "");
  }

  function emailOnly(s) {
    const m = String(s || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return m ? m[0] : "";
  }

  function refreshSavedCustomersDropdown() {
    const sel = document.getElementById("savedCustomers");
    if (!sel) return;

    const list = readCustomers();
    sel.innerHTML = `<option value="">Select Saved Customer</option>` + list.map((c, i) => {
      const name = String(c.name || "").trim();
      const phone = String(c.phone || c.contact || "").trim();
      const email = String(c.email || c.customerEmail || "").trim();
      const label = [name, phone, email].filter(Boolean).join(" • ");
      return `<option value="${i}">${label || `Customer ${i + 1}`}</option>`;
    }).join("");

    // ✅ restore last selected customer on refresh
    const savedIndex = localStorage.getItem(SELECTED_KEY);
    if (savedIndex !== null && list[Number(savedIndex)]) {
      sel.value = String(savedIndex);
      loadSavedCustomer();
    } else {
      sel.value = "";
    }
  }

  function loadSavedCustomer() {
    const sel = document.getElementById("savedCustomers");
    const list = readCustomers();
    const idx = Number(sel && sel.value);
    const c = Number.isFinite(idx) ? list[idx] : null;

    // ✅ remember selection for next refresh
    if (sel && sel.value !== "") localStorage.setItem(SELECTED_KEY, sel.value);
    else localStorage.removeItem(SELECTED_KEY);

    setVal("customer", c ? (c.name || "") : "");
    setVal("contact", c ? (c.phone || c.contact || "") : "");
    setVal("customerEmail", c ? (c.email || c.customerEmail || "") : "");
    setVal("address", c ? (c.address || "") : "");
  }

  function saveCurrentCustomer() {
    const name = val("customer");
    if (!name) return alert("Customer name is required.");

    const record = {
      name: name,
      phone: val("contact"),
      email: val("customerEmail"), // ✅ save email
      address: val("address")
    };

    const list = readCustomers();
    const idx = list.findIndex(function(c) {
      return String(c && c.name || "").trim().toLowerCase() === name.toLowerCase();
    });

    if (idx >= 0) list[idx] = record;
    else list.push(record);

    writeCustomers(list);
    refreshSavedCustomersDropdown();

    const sel = document.getElementById("savedCustomers");
    if (sel) sel.value = String(idx >= 0 ? idx : list.length - 1);

    loadSavedCustomer();
  }

  window.saveCurrentCustomer = saveCurrentCustomer;
  window.loadSavedCustomer = loadSavedCustomer;
  window.refreshSavedCustomersDropdown = refreshSavedCustomersDropdown;

})();
