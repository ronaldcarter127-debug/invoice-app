// Allow abandoning the form and returning to dashboard
function abandonFormAndReturnToDashboard() {
  if (confirm('Are you sure you want to abandon this quote/invoice and return to the dashboard?')) {
    // Optionally reset form fields here if needed
    showDashboard();
  }
}
async function ensureAuthenticated() {
  // Stub: always resolve as authenticated for now
  return true;
}
window.ensureAuthenticated = ensureAuthenticated;
function runAppInitOnce() {
  // TODO: Add initialization logic here
}
window.runAppInitOnce = runAppInitOnce;
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

function showAuthGate() {
  const gate = document.getElementById('authGate');
  if (!gate) {
    console.error('authGate element not found');
    return;
  }
  gate.style.display = '';
}

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

document.addEventListener("DOMContentLoaded", function() {
  // ...existing initialization code...
});

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
