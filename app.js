// Allow abandoning the form and returning to dashboard
function abandonFormAndReturnToDashboard() {
  if (confirm('Are you sure you want to abandon this quote/invoice and return to the dashboard?')) {
    // Optionally reset form fields here if needed
    showDashboard();
  }
}
// ...existing code...
// Expose for inline HTML
window.abandonFormAndReturnToDashboard = abandonFormAndReturnToDashboard;
const App = {
  items: [],
  premium: false,
  invoiceLocked: false,
  activeInvoiceNumber: "",
  activeQuoteNumber: "", // ✅ track current quote
  user: null,
  authReady: false,
  currentStep: 2,
  formMode: "invoice" // invoice or quote
};

// ─── Form Step Navigation ──────────────────────────────────────────────────
function showFormStep(step) {
  document.querySelectorAll(".form-step").forEach(function(el) {
    el.style.display = el.getAttribute("data-step") == step ? "block" : "none";
  });
  
  // Update indicator
  document.querySelectorAll(".form-step-dot").forEach(function(dot) {
    const dotStep = parseInt(dot.getAttribute("data-step"));
    dot.classList.remove("active", "completed");
    if (dotStep === step) {
      dot.classList.add("active");
    } else if (dotStep < step) {
      dot.classList.add("completed");
    }
  });
  
  // Update step lines
  document.querySelectorAll(".form-step-line").forEach(function(line, idx) {
    line.classList.remove("active");
    if (idx < step - 2) line.classList.add("active");
  });
  
  App.currentStep = step;
}

function nextFormStep(fromStep) {
  if (fromStep === 2) {
    // Validate client name
    const name = (document.getElementById("customer") || {}).value;
    if (!name || !String(name).trim()) {
      alert("Please enter a client name");
      return;
    }
    showFormStep(3);
  } else if (fromStep === 3) {
    // Validate job breakdown
    const labor = Number((document.getElementById("laborAmount") || {}).value || 0);
    const materials = Number((document.getElementById("materialsAmount") || {}).value || 0);
    if (labor <= 0 && materials <= 0) {
      alert("Add at least Labor or Materials amount");
      return;
    }
    showFormStep(4);
    updateReviewScreen();
  } else if (fromStep === 4) {
    if (App.formMode === "quote") {
      createSteppedQuote();
    } else {
      createSteppedInvoice();
    }
  }
}

function prevFormStep(fromStep) {
  if (fromStep >= 3) showFormStep(fromStep - 1);
}

function updateReviewScreen() {
  const mode = App.formMode === "quote" ? "quote" : "invoice";
  const clientName = (document.getElementById("customer") || {}).value || "";
  const clientEmail = (document.getElementById("customerEmail") || {}).value || "";
  const labor = Number((document.getElementById("laborAmount") || {}).value || 0);
  const materials = Number((document.getElementById("materialsAmount") || {}).value || 0);
  const total = labor + materials;
  const heading = document.getElementById("reviewHeading");
  const dueRow = document.getElementById("reviewDueRow");
  const sendBtn = document.getElementById("sendAndGetPaidBtn");

  if (heading) heading.textContent = mode === "quote" ? "Review Your Quote" : "Review Your Invoice";
  if (dueRow) dueRow.style.display = mode === "quote" ? "none" : "flex";
  if (sendBtn) sendBtn.textContent = mode === "quote" ? "Send Quote" : "Send & Get Paid";
  
  (document.getElementById("reviewClient") || {}).textContent = clientName;
  (document.getElementById("reviewEmail") || {}).textContent = clientEmail || "(not provided)";
  (document.getElementById("reviewLabor") || {}).textContent = "$" + labor.toFixed(2);
  (document.getElementById("reviewMaterials") || {}).textContent = "$" + materials.toFixed(2);
  (document.getElementById("reviewTotal") || {}).textContent = "$" + total.toFixed(2);
}

function createSteppedInvoice() {
  // Build items array from labor + materials for createDoc() to use
  const items = [];
  const labor = Number((document.getElementById("laborAmount") || {}).value || 0);
  const materials = Number((document.getElementById("materialsAmount") || {}).value || 0);
  
  if (labor > 0) {
    items.push({ description: "Labor", qty: 1, price: labor });
  }
  if (materials > 0) {
    items.push({ description: "Materials", qty: 1, price: materials });
  }
  
  App.items = items;
  createDoc();
}

function createSteppedQuote() {
  const items = [];
  const labor = Number((document.getElementById("laborAmount") || {}).value || 0);
  const materials = Number((document.getElementById("materialsAmount") || {}).value || 0);

  if (labor > 0) {
    items.push({ description: "Labor", qty: 1, price: labor });
  }
  if (materials > 0) {
    items.push({ description: "Materials", qty: 1, price: materials });
  }

  App.items = items;
  createQuote();
}

function showDoneScreen(docNumber, stripeUrl, mode) {
  showFormStep(5);
  const docMode = mode === "quote" ? "quote" : "invoice";
  const doneTitle = document.getElementById("doneTitle");
  const doneMessage = document.getElementById("doneMessage");
  const openPaymentLinkBtn = document.getElementById("openPaymentLinkBtn");
  const sendAnotherBtn = document.getElementById("sendAnotherBtn");
  App.lastDoneMode = docMode;

  if (doneTitle) doneTitle.textContent = docMode === "quote" ? "Quote Sent!" : "Invoice Sent!";
  if (doneMessage) {
    doneMessage.textContent = docMode === "quote"
      ? "Your quote is ready and has been added to your quote history."
      : "Your invoice has been created and is ready to send.";
  }
  if (openPaymentLinkBtn) {
    openPaymentLinkBtn.style.display = "block";
    openPaymentLinkBtn.textContent = docMode === "quote" ? "Send Quote Email" : "Open Payment Link";
  }
  if (sendAnotherBtn) sendAnotherBtn.textContent = docMode === "quote" ? "Send Another Quote" : "Send Another";
  
  // Update payment link container
  const container = document.getElementById("paymentLinkContainer");
  if (container) {
    if (docMode === "invoice" && stripeUrl) {
      container.innerHTML = '<p style="font-size:13px;color:#9ca3af;">Payment link has been created and your client can pay online.</p>';
    } else {
      container.innerHTML = "";
    }
  }
  
  // Store for later use
  App.lastInvoiceNumber = docNumber;
  App.lastStripeUrl = stripeUrl;
}

function openPaymentLink() {
  if (App.lastDoneMode === "quote") {
    const quote = normalizeDocNumber(App.activeQuoteNumber)
      ? getStoredQuoteByNumber(App.activeQuoteNumber)
      : (typeof getDocumentData === "function" ? getDocumentData() : null);
    const preferred = (typeof getBestCustomerEmail === "function") ? getBestCustomerEmail(quote || {}) : "";
    Promise.resolve(sendEmail(preferred)).then(function (sent) {
      if (sent) {
        const doneMessage = document.getElementById("doneMessage");
        if (doneMessage) doneMessage.textContent = "Quote emailed successfully.";
      }
    });
    return;
  }

  if (App.lastStripeUrl) {
    window.open(App.lastStripeUrl, "_blank");
  } else {
    alert("No payment link available");
  }
}

function createAnother() {
  // Reset form and go back to step 2
  document.getElementById("customer").value = "";
  document.getElementById("customerEmail").value = "";
  document.getElementById("laborAmount").value = "";
  document.getElementById("materialsAmount").value = "";
  document.getElementById("notes").value = "";
  App.items = [];
  updateReviewScreen();
  showFormStep(2);
}

function resolvePremiumFromUser(user) {
  const u = user || {};
  if (typeof u.isPremium === "boolean") return u.isPremium;
  const plan = String(u.plan || u.planName || "").toLowerCase();
  if (plan === "premium" || plan === "pro") return true;
  const status = String(u.subscriptionStatus || "").toLowerCase();
  return status === "active" || status === "premium";
}

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
  App.premium = resolvePremiumFromUser(user);
  App.authReady = true;
}

function clearAuthSession() {
  localStorage.removeItem("authToken");
  localStorage.removeItem("authUser");
  localStorage.removeItem("accountLastSyncedAt");
  localStorage.removeItem("premium");
  localStorage.removeItem("isPremium");
  App.user = null;
  App.premium = false;
  App.authReady = false;
}

function formatSyncTime(ts) {
  if (!ts) return "never";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "unknown";
  return d.toLocaleString();
}

function markAccountSynced(ts) {
  const value = ts || new Date().toISOString();
  localStorage.setItem("accountLastSyncedAt", value);
}

function updateDashboardAccountSync() {
  const el = document.getElementById("dashAccountSync");
  if (!el) return;
  const lastSyncedAt = localStorage.getItem("accountLastSyncedAt");
  el.textContent = "Last synced: " + formatSyncTime(lastSyncedAt);
}

function showAuthGate(errorMessage) {
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("appContainer").style.display = "none";
  document.getElementById("historyView").style.display = "none";
  document.getElementById("settingsView").style.display = "none";
  document.getElementById("customerListView").style.display = "none";
  const accountView = document.getElementById("accountView");
  if (accountView) accountView.style.display = "none";

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
    markAccountSynced();
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

  // Premium now comes from authenticated account state (/auth/me), not per-device localStorage.
  App.premium = resolvePremiumFromUser(App.user);
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

  // If no local invoices or quotes, sync once in background, then show dashboard
  const hasLocalInvoices = typeof getStoredInvoices === "function" && getStoredInvoices().length > 0;
  const hasLocalQuotes = typeof getStoredQuotes === "function" && getStoredQuotes().length > 0;
  if (!hasLocalInvoices && !hasLocalQuotes && typeof syncAccountDocuments === "function") {
    // Show dashboard immediately (empty), then sync and reload dashboard
    showDashboard();
    syncAccountDocuments().then(() => {
      // After sync, refresh quote statuses, then reload dashboard to show new data
      if (typeof refreshAllQuoteStatuses === "function") {
        refreshAllQuoteStatuses().then(() => {
          setTimeout(showDashboard, 350);
        }).catch(() => setTimeout(showDashboard, 350));
      } else {
        setTimeout(showDashboard, 350);
      }
    }).catch(() => {});
  } else {
    showDashboard();
  }
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
  let itemsData = App.items.map(function(id) {
    return {
      name: getVal("name-" + id),
      qty: Number(getVal("qty-" + id)) || 1,
      price: Number(getVal("price-" + id))
    };
  }).filter(function(item) {
    return item.name || item.price;
  });

  // Support stepped flow where App.items may already be item objects instead of DOM row ids.
  if (!itemsData.length) {
    itemsData = (Array.isArray(App.items) ? App.items : []).map(function (entry) {
      if (!entry || typeof entry !== "object") return null;
      const name = String(entry.name || entry.description || "").trim();
      const qty = Number(entry.qty || 1) || 1;
      const price = Number(entry.price || 0);
      if (!name && !price) return null;
      return { name: name, qty: qty, price: price };
    }).filter(function (item) {
      return !!item;
    });
  }

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

  if (params.get("upgrade") === "success") {
    const token = getAuthToken();
    if (token) {
      const applyPremiumState = function (user) {
        setAuthSession(token, user || null);
        markAccountSynced();
        checkPremium();
        updateDashboard();
        updateDashboardAccountSync();
      };

      const tryDirectPremiumActivation = function () {
        return authRequest("/activate-premium-direct", { forceActivate: true }, token)
          .then(function (result) {
            if (result && result.ok) {
              applyPremiumState(result.user || App.user);
              alert("✅ Premium is now active on your account.");
            } else {
              alert("Payment received. Premium activation is still syncing.");
            }
          })
          .catch(function () {
            alert("Payment received. Premium activation is still syncing.");
          });
      };

      authRequest("/auth/me", null, token)
        .then(function (result) {
          applyPremiumState(result.user || null);
          if (App.premium) {
            alert("✅ Premium is now active on your account.");
            return;
          }
          return tryDirectPremiumActivation();
        })
        .catch(function () {
          // If /auth/me fails, still try to activate premium directly.
          tryDirectPremiumActivation();
        });
    }
    window.history.replaceState({}, document.title, "/invoice.html");
  }
}

// ─── Dashboard Pipelines ──────────────────────────────────────────────────────

function escText(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "$0.00";
  return "$" + n.toFixed(2);
}

function quoteBucket(status) {
  const s = String(status || "").toLowerCase();
  if (s.includes("accept")) return "Accepted";
  if (s.includes("declin") || s.includes("reject")) return "Declined";
  return "Pending";
}

function invoiceBucket(invoice) {
  const explicit = String((invoice && invoice.status) || "").toLowerCase();
  const resolved = explicit || (typeof getInvoiceStatus === "function" ? String(getInvoiceStatus(invoice) || "").toLowerCase() : "");
  if (resolved.includes("paid")) return "Paid";
  if (resolved.includes("overdue")) return "Overdue";
  return "Pending";
}

function renderGroup(name, rows) {
  const items = Array.isArray(rows) ? rows : [];
  let html = '<div class="dash-group">';
  html += '<div class="dash-group-head"><span>' + escText(name) + '</span><span class="dash-group-count">' + items.length + '</span></div>';
  html += '<div class="dash-item-list">';
  if (!items.length) {
    html += '<div class="dash-item-empty">No items</div>';
  } else {
    items.slice(0, 4).forEach(function (row) {
      html += '<div class="dash-item-row">';
      html += '<div class="dash-item-main">';
      html += '<div class="dash-item-title">' + escText(row.title) + '</div>';
      html += '<div class="dash-item-meta">' + escText(row.meta) + '</div>';
      html += '</div>';
      html += '<div class="dash-item-amount">' + escText(row.amount) + '</div>';
      html += '</div>';
    });
  }
  html += '</div></div>';
  return html;
}

function loadAndDisplayDashboardPipelines() {
  const quoteHost = document.getElementById("dashQuotesPipeline");
  const invoiceHost = document.getElementById("dashInvoicesPipeline");
  if (!quoteHost || !invoiceHost) return;

  try {
    const quotes = typeof getStoredQuotes === "function" ? getStoredQuotes() : [];
    const invoices = typeof getSavedInvoices === "function" ? getSavedInvoices() : [];

    const quoteGroups = { Pending: [], Accepted: [], Declined: [] };
    (quotes || []).slice().reverse().forEach(function (q) {
      const bucket = quoteBucket(q && q.status);
      const amount = Number((q && (q.finalTotal || q.total)) || 0);
      quoteGroups[bucket].push({
        title: (q && (q.customer || q.description)) || "Unnamed quote",
        meta: (q && q.quoteNumber) || "Quote",
        amount: toMoney(amount)
      });
    });

    const invoiceGroups = { Pending: [], Paid: [], Overdue: [] };
    (invoices || []).slice().reverse().forEach(function (inv) {
      const bucket = invoiceBucket(inv || {});
      const amount = Number((inv && (inv.finalTotal || inv.total)) || 0);
      invoiceGroups[bucket].push({
        title: (inv && (inv.customer || inv.description)) || "Unnamed invoice",
        meta: (inv && inv.invoiceNumber) || "Invoice",
        amount: toMoney(amount)
      });
    });

    quoteHost.innerHTML =
      renderGroup("Pending", quoteGroups.Pending) +
      renderGroup("Accepted", quoteGroups.Accepted) +
      renderGroup("Declined", quoteGroups.Declined);

    invoiceHost.innerHTML =
      renderGroup("Pending", invoiceGroups.Pending) +
      renderGroup("Paid", invoiceGroups.Paid) +
      renderGroup("Overdue", invoiceGroups.Overdue);
  } catch (_) {
    quoteHost.innerHTML = '<div class="dash-item-empty">Unable to load quotes</div>';
    invoiceHost.innerHTML = '<div class="dash-item-empty">Unable to load invoices</div>';
  }
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function showOutputView() {
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("appContainer").style.display = "none";
  document.getElementById("historyView").style.display = "block";
  document.getElementById("settingsView").style.display = "none";
  document.getElementById("customerListView").style.display = "none";
  const accountView = document.getElementById("accountView");
  if (accountView) accountView.style.display = "none";
  window.scrollTo(0, 0);
}

window.showOutputView = showOutputView;

function showDashboard() {
  document.getElementById("dashboard").style.display = "block";
  document.getElementById("appContainer").style.display = "none";
  document.getElementById("historyView").style.display = "none";
  document.getElementById("settingsView").style.display = "none";
  document.getElementById("customerListView").style.display = "none";
  const accountView = document.getElementById("accountView");
  if (accountView) accountView.style.display = "none";
  document.getElementById("output").innerHTML = "";
  const previewArea = document.getElementById("previewArea");
  if (previewArea) previewArea.classList.remove("show");
  updateDashboard();
  updateDashboardAccountSync();
  loadAndDisplayDashboardPipelines();
  // Always refresh quote statuses and update quote history panel
  if (typeof refreshAllQuoteStatuses === "function") {
    setTimeout(() => { refreshAllQuoteStatuses().then(() => {
      if (typeof showQuoteHistory === "function") {
        showQuoteHistory("all", "dashQuotesHistory");
      }
    }).catch(() => {}); }, 100);
  }
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

  if (badge) badge.textContent = premium ? "Premium Plan Active" : "Free Plan";
  if (msg) msg.textContent = premium ? "All features unlocked." : "Tracking " + usageText;
  if (upgradeBtn) upgradeBtn.style.display = "none";
}

function openForm(mode) {
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("historyView").style.display = "none";
  document.getElementById("appContainer").style.display = "block";
  document.getElementById("settingsView").style.display = "none";
  document.getElementById("customerListView").style.display = "none";
  const accountView = document.getElementById("accountView");
  if (accountView) accountView.style.display = "none";
  App._dashMode = mode;
  App.formMode = mode;
  updateReviewScreen();

  // Initialize stepped form for invoice mode
  if (mode === "invoice") {
    showFormStep(2);
  } else if (mode === "quote") {
    showFormStep(2);
  }
}


function openInvoiceHistory() {
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("appContainer").style.display = "none";
  document.getElementById("historyView").style.display = "block";
  document.getElementById("settingsView").style.display = "none";
  document.getElementById("customerListView").style.display = "none";
  const accountView = document.getElementById("accountView");
  if (accountView) accountView.style.display = "none";
  showInvoiceHistory();
}

function openQuoteHistoryDash() {
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("appContainer").style.display = "none";
  document.getElementById("historyView").style.display = "block";
  document.getElementById("settingsView").style.display = "none";
  document.getElementById("customerListView").style.display = "none";
  const accountView = document.getElementById("accountView");
  if (accountView) accountView.style.display = "none";
  showQuoteHistory("all");
}

function openSettings() {
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("appContainer").style.display = "none";
  document.getElementById("historyView").style.display = "none";
  document.getElementById("settingsView").style.display = "block";
  document.getElementById("customerListView").style.display = "none";
  const accountView = document.getElementById("accountView");
  if (accountView) accountView.style.display = "none";
  loadBusinessInfo();
  updateLogoPreview(localStorage.getItem("businessLogo"));
}

function openCustomerList() {
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("appContainer").style.display = "none";
  document.getElementById("historyView").style.display = "none";
  document.getElementById("settingsView").style.display = "none";
  document.getElementById("customerListView").style.display = "block";
  const accountView = document.getElementById("accountView");
  if (accountView) accountView.style.display = "none";
  renderCustomerList();
}

function formatAccountValue(value) {
  if (value === null || value === undefined || value === "") return "Not available";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    if (!value.length) return "None";
    return value.map(function (entry) {
      return typeof entry === "object" ? JSON.stringify(entry) : String(entry);
    }).join(", ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatAccountDate(value) {
  if (!value) return "Unknown";
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

function renderAccountDetails() {
  const out = document.getElementById("accountDetailsOutput");
  if (!out) return;

  const user = App.user || {};
  const email = String(user.email || "Not available");
  const premium = App.premium;
  const token = getAuthToken();
  const tokenStatus = token ? "Active" : "Missing";
  const tokenPreview = token ? (token.slice(0, 8) + "..." + token.slice(-4)) : "N/A";
  const lastSynced = formatSyncTime(localStorage.getItem("accountLastSyncedAt"));

  const memberSince = formatAccountDate(user.createdAt);
  const lastUpdated = formatAccountDate(user.updatedAt);
  const renewalDate = formatAccountDate(user.renewalDate || user.currentPeriodEnd || user.subscriptionEndsAt);

  const knownKeys = {
    email: true,
    createdAt: true,
    updatedAt: true,
    role: true,
    id: true,
    userId: true,
    plan: true,
    planName: true,
    subscriptionStatus: true,
    stripeCustomerId: true,
    trialEndsAt: true,
    renewalDate: true,
    currentPeriodEnd: true,
    subscriptionEndsAt: true
  };

  let extraHtml = "";
  Object.keys(user).forEach(function (key) {
    if (knownKeys[key]) return;
    if (/password|token|secret|hash/i.test(key)) return;
    extraHtml += "<p><strong>" + escapeHtml(key) + ":</strong> " + escapeHtml(formatAccountValue(user[key])) + "</p>";
  });

  const planLabel = formatAccountValue(user.plan || user.planName || (premium ? "Premium" : "Free"));
  const subscriptionStatus = formatAccountValue(user.subscriptionStatus || (premium ? "Active" : "Free Tier"));

  out.innerHTML = "" +
    "<div class='section'>" +
    "<h3>Profile</h3>" +
    "<p><strong>Email:</strong> " + escapeHtml(email) + "</p>" +
    "<p><strong>User ID:</strong> " + escapeHtml(formatAccountValue(user.id || user.userId)) + "</p>" +
    "<p><strong>Role:</strong> " + escapeHtml(formatAccountValue(user.role)) + "</p>" +
    "<p><strong>Member Since:</strong> " + escapeHtml(memberSince) + "</p>" +
    "<p><strong>Last Updated:</strong> " + escapeHtml(lastUpdated) + "</p>" +
    "</div>" +
    "<div class='section'>" +
    "<h3>Subscription</h3>" +
    "<p><strong>Plan:</strong> " + escapeHtml(planLabel) + "</p>" +
    "<p><strong>Status:</strong> " + escapeHtml(subscriptionStatus) + "</p>" +
    "<p><strong>Renews/Ends:</strong> " + escapeHtml(renewalDate) + "</p>" +
    "<p><strong>Stripe Customer:</strong> " + escapeHtml(formatAccountValue(user.stripeCustomerId)) + "</p>" +
    "<p><strong>Trial Ends:</strong> " + escapeHtml(formatAccountDate(user.trialEndsAt)) + "</p>" +
    "</div>" +
    "<div class='section'>" +
    "<h3>Session</h3>" +
    "<p><strong>Auth Token:</strong> " + tokenStatus + "</p>" +
    "<p><strong>Token Preview:</strong> " + escapeHtml(tokenPreview) + "</p>" +
    "<p><strong>Last Synced:</strong> " + escapeHtml(lastSynced) + "</p>" +
    "</div>" +
    "<div class='section'>" +
    "<h3>Backend Fields</h3>" +
    (extraHtml || "<p style='color:#6b7280;'>No additional fields returned.</p>") +
    "</div>" +
    "<button type='button' class='utility' onclick='refreshAccountDetails()'>Refresh Account Data</button>" +
    "<div id='accountRefreshMsg' style='margin-top:8px;font-size:12px;color:#94a3b8;'></div>" +
    "</div>";
}

async function refreshAccountDetails() {
  const msg = document.getElementById("accountRefreshMsg");
  if (msg) msg.textContent = "Refreshing account data...";

  try {
    const token = getAuthToken();
    if (!token) throw new Error("No auth token found.");
    const result = await authRequest("/auth/me", null, token);
    App.user = result.user || null;
    App.premium = resolvePremiumFromUser(App.user);
    markAccountSynced();
    updateDashboardAccountSync();
    checkPremium();
    updateDashboard();
    renderAccountDetails();
    const nextMsg = document.getElementById("accountRefreshMsg");
    if (nextMsg) nextMsg.textContent = "Account data updated.";
  } catch (e) {
    const nextMsg = document.getElementById("accountRefreshMsg");
    if (nextMsg) nextMsg.textContent = e && e.message ? e.message : "Unable to refresh account data.";
  }
}

function openAccountDetails() {
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("appContainer").style.display = "none";
  document.getElementById("historyView").style.display = "none";
  document.getElementById("settingsView").style.display = "none";
  document.getElementById("customerListView").style.display = "none";
  const accountView = document.getElementById("accountView");
  if (accountView) accountView.style.display = "block";
  renderAccountDetails();
}

function logoutUser() {
  clearAuthSession();
  showAuthGate("You have been logged out.");
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
window.openAccountDetails = openAccountDetails;
window.refreshAccountDetails = refreshAccountDetails;
window.logoutUser = logoutUser;
window.renderCustomerList = renderCustomerList;
window.deleteCustomerByIndex = deleteCustomerByIndex;

window.showDashboard = showDashboard;
window.openForm = openForm;
window.openInvoiceHistory = openInvoiceHistory;
window.openQuoteHistoryDash = openQuoteHistoryDash;
window.updateDashboardAccountSync = updateDashboardAccountSync;

function bindTap(el, handler) {
  if (!el || typeof handler !== "function") return;

  const TAP_KEY = "__lastTapAt";
  const CLICK_GUARD_KEY = "__ignoreClickUntil";
  let touchStartX = 0;
  let touchStartY = 0;
  let touchMoved = false;
  const MOVE_THRESHOLD = 14;

  const invoke = function (event) {
    const now = Date.now();
    const last = Number(el[TAP_KEY] || 0);
    if (now - last < 350) return;
    el[TAP_KEY] = now;
    handler(event);
  };

  el.addEventListener("touchstart", function (event) {
    const t = event && event.changedTouches && event.changedTouches[0];
    touchStartX = t ? Number(t.clientX || 0) : 0;
    touchStartY = t ? Number(t.clientY || 0) : 0;
    touchMoved = false;
  }, { passive: true });

  el.addEventListener("touchmove", function (event) {
    const t = event && event.changedTouches && event.changedTouches[0];
    if (!t) return;
    const dx = Math.abs(Number(t.clientX || 0) - touchStartX);
    const dy = Math.abs(Number(t.clientY || 0) - touchStartY);
    if (dx > MOVE_THRESHOLD || dy > MOVE_THRESHOLD) {
      touchMoved = true;
    }
  }, { passive: true });

  el.addEventListener("touchend", function (event) {
    if (touchMoved) return;
    el[CLICK_GUARD_KEY] = Date.now() + 500;
    invoke(event);
  }, { passive: true });

  el.onclick = function (event) {
    const guard = Number(el[CLICK_GUARD_KEY] || 0);
    if (Date.now() < guard) return;
    invoke(event);
  };
}

function bindPrimaryActionButtons() {
  const createInvoiceBtn = $id("createInvoiceBtn");
  const createQuoteBtn = $id("createQuoteBtn");
  const saveBusinessInfoBtn = $id("saveBusinessInfoBtn");
  const previewInvoiceBtn = $id("previewInvoiceBtn");
  const addItemBtn = $id("addItemBtn");
  const dashCreateInvoiceBtn = $id("dashCreateInvoiceBtn");
  const dashCreateQuoteBtn = $id("dashCreateQuoteBtn");
  const dashCustomersBtn = $id("dashCustomersBtn");
  const dashSettingsBtn = $id("dashSettingsBtn");
  const dashAccountBtn = $id("dashAccountBtn");
  const dashInvHistoryBtn = $id("dashInvHistory");
  const dashQuoteHistoryBtn = $id("dashQuoteHistory");

  bindTap(createInvoiceBtn, function () { createDoc(); });
  bindTap(createQuoteBtn, function () { createQuote(); });
  bindTap(saveBusinessInfoBtn, function () {
    saveBusinessInfo();
    const msg = document.getElementById("settingsSaveMsg");
    if (msg) {
      msg.textContent = "Saved.";
      msg.style.color = "#22c55e";
      setTimeout(function () {
        if (msg.textContent === "Saved.") msg.textContent = "";
      }, 1800);
    }
  });
  bindTap(previewInvoiceBtn, function () { previewInvoice(); });
  bindTap(addItemBtn, function () { addItem(); });
  bindTap(dashCreateInvoiceBtn, function () { openForm("invoice"); });
  bindTap(dashCreateQuoteBtn, function () { openForm("quote"); });
  bindTap(dashCustomersBtn, function () { openCustomerList(); });
  bindTap(dashSettingsBtn, function () { openSettings(); });
  bindTap(dashAccountBtn, function () { openAccountDetails(); });
  bindTap(dashInvHistoryBtn, function () { openInvoiceHistory(); });
  bindTap(dashQuoteHistoryBtn, function () { openQuoteHistoryDash(); });
}

let accountSyncInFlight = false;

async function syncAccountStateSilently(force) {
  // Do nothing
}


window.onload = async function() {
  const authed = await ensureAuthenticated();
  if (!authed) return;
  await syncAccountStateSilently(true); // Always force sync on load
  runAppInitOnce();
};

document.addEventListener("visibilitychange", function () {
  if (!document.hidden) {
    syncAccountStateSilently(false);
  }
});

window.addEventListener("pageshow", function () {
  syncAccountStateSilently(false);
});

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
