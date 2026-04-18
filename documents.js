function getApiBaseUrl() {
  return "https://jobflow-api-bebm.onrender.com";
}

const API_BASE_URL = getApiBaseUrl();

// ─── storage helpers ──────────────────────────────────────────────────────────

function normalizeDocNumber(value) {
  return String(value == null ? "" : value).trim();
}


function getStoredQuotes() {
  return JSON.parse(localStorage.getItem("quoteHistory") || "[]");
}

function saveStoredQuotes(quotes) {
  localStorage.setItem("quoteHistory", JSON.stringify(Array.isArray(quotes) ? quotes : []));
}

function getStoredInvoices() {
  return JSON.parse(localStorage.getItem("invoiceHistory") || "[]");
}

function getStoredQuoteByNumber(quoteNumber) {
  const target = normalizeDocNumber(quoteNumber);
  return getStoredQuotes().find(function (q) {
    return normalizeDocNumber(q.quoteNumber) === target;
  }) || null;
}

function getStoredInvoiceByNumber(invoiceNumber) {
  const target = normalizeDocNumber(invoiceNumber);
  return getStoredInvoices().find(function (i) {
    return normalizeDocNumber(i.invoiceNumber) === target;
  }) || null;
}

function calcItemsTotal(items) {
  if (!Array.isArray(items)) return 0;
  return items.reduce(function (sum, item) {
    const qty = Number(item && item.qty || 0) || 0;
    const price = Number(item && item.price || 0) || 0;
    return sum + (qty * price);
  }, 0);
}

// ─── read/write helpers ───────────────────────────────────────────────────────

async function readJsonSafe(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch (_) { return { raw: text }; }
}

// ─── invoice computed fields ──────────────────────────────────────────────────

function refreshInvoiceComputedFields(invoiceData) {
  if (!invoiceData) return invoiceData;
  const totals = calculateTotals(invoiceData.items || [], invoiceData.taxPercent || 0, invoiceData.amountPaid || 0);
  invoiceData.total = totals.subtotal;
  invoiceData.taxAmount = totals.tax;
  invoiceData.finalTotal = totals.total;
  invoiceData.amountPaid = totals.paid;
  invoiceData.balanceDue = totals.balance;
  invoiceData.status = getInvoiceStatus(invoiceData);
  return invoiceData;
}

function refreshAllInvoiceStatuses() {
  const invoices = getSavedInvoices();
  let changed = false;
  const refreshed = invoices.map(function (invoice) {
    const originalStatus = invoice.status;
    refreshInvoiceComputedFields(invoice);
    if (invoice.status !== originalStatus) changed = true;
    return invoice;
  });
  if (changed) writeJson("invoiceHistory", refreshed);
  return refreshed;
}

async function refreshAllQuoteStatuses() {
  const quotes = getStoredQuotes();
  if (!quotes.length) return;
  for (let i = 0; i < quotes.length; i++) {
    const qn = normalizeDocNumber(quotes[i].quoteNumber);
    if (!qn) continue;
    try {
      const r = await fetch(`${API_BASE_URL}/quote-status/${encodeURIComponent(qn)}`);
      if (!r.ok) continue;
      const s = await r.json();
      if (s && s.found) {
        quotes[i].status = s.status || quotes[i].status || "Pending";
        quotes[i].acceptedAt = s.acceptedAt || quotes[i].acceptedAt || null;
      }
    } catch (_) {}
  }
  saveStoredQuotes(quotes);
}

// ─── create ───────────────────────────────────────────────────────────────────

function createQuote() {
  const data = getDocumentData();
  if (data.total <= 0) { alert("Add at least one item before creating quote"); return; }

  // Quotes should not carry prior invoice payments
  data.amountPaid = 0;
  data.balanceDue = data.finalTotal;

  data.quoteNumber = getNextQuoteNumber();
  data.date = new Date().toLocaleString();
  data.status = "Pending";
  App.activeQuoteNumber = String(data.quoteNumber || "").trim();
  App.activeInvoiceNumber = "";
  setQuoteReadOnly(false);
  clearAcceptedQuoteBanner();
  setInvoiceEditingLocked(false, "");
  saveQuote(data);
  renderDocument("Quote", data, true);
  alert("Quote #" + data.quoteNumber + " saved for later invoicing.");
  resetEntryFieldsAfterCreate();
}

function createDoc() {
  const data = getDocumentData();
  data.email = String((document.getElementById("customerEmail") || {}).value || data.email || "").trim();
  if (data.total <= 0) { alert("Add at least one item before creating invoice"); return; }
  data.invoiceNumber = getNextInvoiceNumber();
  data.date = new Date().toLocaleString();
  App.activeInvoiceNumber = String(data.invoiceNumber || "").trim();
  App.activeQuoteNumber = "";
  setQuoteReadOnly(false);
  clearAcceptedQuoteBanner();
  refreshInvoiceComputedFields(data);
  saveInvoice(data);
  renderDocument("Invoice", data, false);
  resetEntryFieldsAfterCreate();
}

function convertQuoteToInvoice(quoteData) {
  const q = quoteData || getDocumentData();
  const invoice = Object.assign({}, q, {
    quoteNumber: "",
    invoiceNumber: getNextInvoiceNumber(),
    date: new Date().toLocaleString(),
    status: "Unpaid",
    amountPaid: Number(q.amountPaid || 0)
  });
  refreshInvoiceComputedFields(invoice);
  saveInvoice(invoice);
  App.activeInvoiceNumber = String(invoice.invoiceNumber || "").trim();
  App.activeQuoteNumber = "";
  setQuoteReadOnly(false);
  clearAcceptedQuoteBanner();
  setInvoiceEditingLocked(true, invoice.invoiceNumber);
  renderDocument("Invoice", invoice, false);
}

function markInvoiceAsPaid(invoiceData) {
  const totals = calculateTotals(invoiceData.items, invoiceData.taxPercent, invoiceData.finalTotal);
  invoiceData.amountPaid = totals.total;
  invoiceData.balanceDue = 0;
  refreshInvoiceComputedFields(invoiceData);
  invoiceData.status = "paid";
  updateSavedInvoice(invoiceData);
  setInvoiceEditingLocked(true, invoiceData.invoiceNumber);
  renderDocument("Invoice", invoiceData, false);
  alert("Invoice marked as paid!");
}

// ─── history ──────────────────────────────────────────────────────────────────

async function showQuoteHistory(filter) {
  await refreshAllQuoteStatuses();
  const normalizedFilter = String(filter || "all").toLowerCase();
  const quotes = getStoredQuotes();
  const filtered = normalizedFilter === "accepted"
    ? quotes.filter(function (q) { return String(q.status || "").toLowerCase() === "accepted"; })
    : quotes;

  let html = "<div class='invoice-box'>";
  html += "<h2>Quote History</h2>";
  html += "<div class='history-tabs'>";
  html += "<button type='button' class='history-tab " + (normalizedFilter === "all" ? "active" : "") + "' onclick=\"showQuoteHistory('all')\">All Quotes</button>";
  html += "<button type='button' class='history-tab " + (normalizedFilter === "accepted" ? "active" : "") + "' onclick=\"showQuoteHistory('accepted')\">Accepted Quotes</button>";
  html += "</div>";

  if (!filtered.length) {
    html += "<p>No quotes found.</p></div>";
    displayInvoice(html);
    return;
  }

  filtered.slice().reverse().forEach(function (quote) {
    const status = String(quote.status || "Pending");
    const statusClass = "status-" + status.toLowerCase();
    const quoteKey = normalizeDocNumber(quote.quoteNumber).replace(/'/g, "\\'");
    html += "<div class='quote-entry'>";
    html += "<div>";
    html += "<strong>" + escapeHtml(normalizeDocNumber(quote.quoteNumber) || "No quote #") + "</strong> ";
    html += "<span class='status-badge " + statusClass + "'>" + escapeHtml(status.toUpperCase()) + "</span><br>";
    html += "<span>" + escapeHtml(quote.date || "No date") + "</span><br>";
    html += "<span>" + escapeHtml(quote.customer || "No customer") + "</span>";
    html += "</div>";
    html += "<div>";
    html += "<button type='button' onclick=\"loadQuote('" + quoteKey + "')\">Open</button> ";
    html += "<button type='button' onclick=\"deleteQuote('" + quoteKey + "')\">Delete</button>";
    html += "</div>";
    html += "</div>";
  });

  html += "</div>";
  displayInvoice(html);
}

function showAcceptedQuotes() { return showQuoteHistory("accepted"); }

function showInvoiceHistory() {
  if (!App.premium) {
    alert("Invoice History is a premium feature.");
    return;
  }
  const invoices = refreshAllInvoiceStatuses();
  if (!invoices.length) { alert("No previous invoices found."); return; }

  let html = "<div class='invoice-box'><h2>Invoice History</h2>";
  invoices.slice().reverse().forEach(function (invoice) {
    const status = invoice.status || getInvoiceStatus(invoice);
    const statusClass = "status-" + status.toLowerCase();
    const invKey = String(invoice.invoiceNumber || "").replace(/"/g, "&quot;");
    html += "<div class='quote-entry'>";
    html += "<span><strong>" + invoice.invoiceNumber + "</strong> <span class='status-badge " + statusClass + "'>" + status.toUpperCase() + "</span><br>" + (invoice.date || "No date") + "<br>" + (invoice.customer || "No customer") + "</span>";
    html += "<span><button onclick='loadInvoice(\"" + invKey + "\")'>Open</button> <button onclick='deleteInvoice(\"" + invKey + "\")'>Delete</button></span>";
    html += "</div>";
  });
  html += "</div>";
  displayInvoice(html);
}

// ─── load / delete ────────────────────────────────────────────────────────────

function restoreQuoteForm(data) {
  document.getElementById("customer").value = data.customer || "";
  document.getElementById("contact").value = data.contact || "";
  const emailEl = document.getElementById("customerEmail");
  if (emailEl) emailEl.value = data.email || data.to || "";
  document.getElementById("address").value = data.address || "";
  document.getElementById("description").value = data.description || "";
  document.getElementById("tax").value = data.taxPercent || "";
  document.getElementById("amountPaid").value = data.amountPaid || "";
  document.getElementById("notes").value = data.notes || "";
  document.getElementById("items").innerHTML = "";
  App.items = [];
  if (data.items && data.items.length) data.items.forEach(function (item) { addItem(item); });
  else addItem();
  updateLiveTotals();
}

function restoreInvoiceForm(data) {
  document.getElementById("customer").value = data.customer || "";
  document.getElementById("contact").value = data.contact || "";
  const emailEl = document.getElementById("customerEmail");
  if (emailEl) emailEl.value = data.email || data.to || "";
  document.getElementById("address").value = data.address || "";
  document.getElementById("description").value = data.description || "";
  document.getElementById("tax").value = data.taxPercent || "";
  document.getElementById("amountPaid").value = data.amountPaid || "";
  document.getElementById("paymentMethod").value = data.paymentMethod || "";
  document.getElementById("dueDate").value = data.dueDate || "";
  document.getElementById("notes").value = data.notes || "";
  document.getElementById("items").innerHTML = "";
  App.items = [];
  if (data.items && data.items.length) data.items.forEach(function (item) { addItem(item); });
  else addItem();
  updateLiveTotals();
}

function loadQuote(quoteNumber) {
  const target = normalizeDocNumber(quoteNumber);
  const quote = getStoredQuotes().find(function (q) {
    return normalizeDocNumber(q.quoteNumber) === target;
  });
  if (!quote) { alert("Quote not found."); return; }
  App.activeQuoteNumber = normalizeDocNumber(quote.quoteNumber);
  App.activeInvoiceNumber = "";
  restoreQuoteForm(quote);
  renderDocument("Quote", quote, true);
  const isAccepted = String(quote.status || "").toLowerCase() === "accepted";
  setInvoiceEditingLocked(false, "");
  setQuoteReadOnly(isAccepted);
  if (isAccepted) { renderAcceptedQuoteBanner(quote); alert("This quote has already been accepted."); }
  else clearAcceptedQuoteBanner();
}

function deleteQuote(quoteNumber) {
  const target = normalizeDocNumber(quoteNumber);
  saveStoredQuotes(getStoredQuotes().filter(function (q) {
    return normalizeDocNumber(q.quoteNumber) !== target;
  }));
  alert("Quote #" + target + " deleted.");
  showQuoteHistory();
}

function loadInvoice(invoiceNumber) {
  const target = normalizeDocNumber(invoiceNumber);
  const invoice = refreshAllInvoiceStatuses().find(function (i) {
    return normalizeDocNumber(i.invoiceNumber) === target;
  });
  if (!invoice) { alert("Invoice not found."); return; }
  App.activeInvoiceNumber = normalizeDocNumber(invoice.invoiceNumber);
  App.activeQuoteNumber = "";
  setQuoteReadOnly(false);
  clearAcceptedQuoteBanner();
  refreshInvoiceComputedFields(invoice);
  updateSavedInvoice(invoice);
  restoreInvoiceForm(invoice);
  setInvoiceEditingLocked(true, invoice.invoiceNumber);
  renderDocument("Invoice", invoice, false);
}

function deleteInvoice(invoiceNumber) {
  const target = normalizeDocNumber(invoiceNumber);
  writeJson("invoiceHistory", getSavedInvoices().filter(function (i) {
    return normalizeDocNumber(i.invoiceNumber) !== target;
  }));
  alert("Invoice " + target + " deleted.");
  showInvoiceHistory();
}

// ─── email ────────────────────────────────────────────────────────────────────
const CUSTOMER_EMAIL_BOOK_KEY = "customerEmailBook";

function getActiveDocKind() {
  if (normalizeDocNumber(App.activeInvoiceNumber)) return "invoice";
  if (normalizeDocNumber(App.activeQuoteNumber)) return "quote";
  const titleEl = document.querySelector("#output h1, #output h2, #printArea h1, #printArea h2");
  const title = String((titleEl && titleEl.textContent) || "").toLowerCase();
  return title.includes("quote") ? "quote" : "invoice";
}

function buildEmailPayload(source, kind, to) {
  return {
    to: to,
    invoiceNumber: String(source && source.invoiceNumber || "").trim(),
    quoteNumber: String(source && source.quoteNumber || "").trim(),
    customer: String(source && source.customer || "").trim(),
    contact: String(source && source.contact || "").trim(),
    email: String(source && source.email || "").trim(),
    address: String(source && source.address || "").trim(),
    businessName: String(source && source.businessName || "").trim(),
    businessPhone: String(source && source.businessPhone || "").trim(),
    businessEmail: String(source && source.businessEmail || "").trim(),
    businessAddress: String(source && source.businessAddress || "").trim(),
    date: String(source && source.date || "").trim(),
    dueDate: String(source && source.dueDate || "").trim(),
    notes: String(source && source.notes || "").trim(),
    items: Array.isArray(source && source.items) ? source.items : [],
    total: Number(source && source.total) || 0,
    taxAmount: Number(source && source.taxAmount) || 0,
    finalTotal: Number(source && source.finalTotal) || 0,
    amountPaid: Number(source && source.amountPaid) || 0,
    balanceDue: Number(source && source.balanceDue) || 0
  };
}

function extractFirstEmail(text) {
  const s = String(text || "").trim();
  const m = s.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0].trim() : "";
}

function getCustomerEmailBook() {
  try {
    const obj = JSON.parse(localStorage.getItem(CUSTOMER_EMAIL_BOOK_KEY) || "{}");
    return obj && typeof obj === "object" ? obj : {};
  } catch (_) {
    return {};
  }
}

function saveCustomerEmailBook(book) {
  localStorage.setItem(CUSTOMER_EMAIL_BOOK_KEY, JSON.stringify(book && typeof book === "object" ? book : {}));
}

function rememberCustomerEmail(customerName, email) {
  const key = String(customerName || "").trim().toLowerCase();
  const em = extractFirstEmail(email);
  if (!key || !em) return;
  const book = getCustomerEmailBook();
  book[key] = em;
  saveCustomerEmailBook(book);
}

function getBestCustomerEmail(source) {
  const direct = extractFirstEmail(source && (source.email || source.to));
  if (direct) return direct;

  const fromContact = extractFirstEmail(source && source.contact);
  if (fromContact) return fromContact;

  const contactEl = document.getElementById("contact");
  const uiContact = extractFirstEmail(contactEl && contactEl.value);
  if (uiContact) return uiContact;

  const customerName = String(source && source.customer || (document.getElementById("customer") || {}).value || "").trim().toLowerCase();
  if (customerName) {
    const book = getCustomerEmailBook();
    if (extractFirstEmail(book[customerName])) return book[customerName];
  }

  return "";
}

async function sendEmail(toOverride) {
  const kind = getActiveDocKind();
  let source = null;

  if (kind === "quote") {
    source = normalizeDocNumber(App.activeQuoteNumber)
      ? getStoredQuoteByNumber(App.activeQuoteNumber) : null;
  } else {
    source = normalizeDocNumber(App.activeInvoiceNumber)
      ? getStoredInvoiceByNumber(App.activeInvoiceNumber) : null;
  }
  if (!source) source = typeof getDocumentData === "function" ? getDocumentData() : {};

  const emailInput = document.getElementById("customerEmail");
  const enteredEmail = String((emailInput && emailInput.value) || "").trim();

  const suggested = String(
    toOverride ||
    enteredEmail ||
    getBestCustomerEmail(source) ||
    ""
  ).trim();

  const to = suggested || String(prompt("Enter customer email:") || "").trim();
  if (!to) return false;

  const payload = buildEmailPayload(source, kind, to);

  if (kind === "quote" && !payload.quoteNumber) return false;
  if (kind === "invoice" && !payload.invoiceNumber) return false;

  const endpoint = kind === "quote"
    ? `${API_BASE_URL}/send-quote-email`
    : `${API_BASE_URL}/send-email`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const result = await readJsonSafe(response);
    if (!response.ok) throw new Error(result.error || result.raw || "Email send failed.");

    // Backward-compatible success check:
    // - require sent === true
    // - only enforce accepted.length if backend actually includes `accepted`
    if (!result || result.sent !== true) {
      throw new Error((result && result.error) || "Email send failed.");
    }

    const hasAcceptedField = Object.prototype.hasOwnProperty.call(result, "accepted");
    if (hasAcceptedField) {
      const accepted = Array.isArray(result.accepted) ? result.accepted : [];
      if (accepted.length === 0) {
        throw new Error((result && result.error) || "Mail provider did not accept recipient.");
      }
    }

    alert(kind === "quote" ? "Quote email sent." : "Invoice email sent.");
    if (emailInput) emailInput.value = to;
    rememberCustomerEmail(payload.customer, to);
    return true;
  } catch (err) {
    alert("API request failed: " + endpoint + "\n" + String(err && err.message || "Email send failed."));
    return false;
  }
}

async function sendQuoteThenConvert() {
  if (App._sendConvertBusy) return;
  App._sendConvertBusy = true;

  try {
    if (!App.activeQuoteNumber) createQuote();
    if (!App.activeQuoteNumber) return;

    const quote = getStoredQuoteByNumber(App.activeQuoteNumber) || getDocumentData();
    const autoEmail = getBestCustomerEmail(quote);
    const sent = await sendEmail(autoEmail);
    if (!sent) return;

    const qn = String(App.activeQuoteNumber || "").trim();
    const list = JSON.parse(localStorage.getItem("quoteHistory") || "[]");
    const latest = list.find(q => String(q && q.quoteNumber || "").trim() === qn) || quote;

    convertQuoteToInvoice(latest);
  } finally {
    App._sendConvertBusy = false;
  }
}

// ─── templates ────────────────────────────────────────────────────────────────

const JOB_TEMPLATE_KEY = "jobTemplates";

function getJobTemplates() {
  return JSON.parse(localStorage.getItem(JOB_TEMPLATE_KEY) || "[]");
}

function saveJobTemplates(list) {
  localStorage.setItem(JOB_TEMPLATE_KEY, JSON.stringify(Array.isArray(list) ? list : []));
}

function refreshTemplateSelect() {
  const sel = document.getElementById("templateSelect");
  if (!sel) return;
  const templates = getJobTemplates();
  sel.innerHTML = "<option value=''>Select Template</option>" +
    templates.map(t => `<option value="${String(t.name).replace(/"/g, "&quot;")}">${t.name}</option>`).join("");
}

function saveCurrentAsTemplate() {
  const name = String(prompt("Template name:") || "").trim();
  if (!name) return;
  const data = getDocumentData();
  const templates = getJobTemplates();
  const next = {
    name,
    description: data.description || "",
    notes: data.notes || "",
    taxPercent: Number(data.taxPercent || 0),
    items: Array.isArray(data.items) ? data.items.map(i => ({
      name: i.name || "",
      qty: Number(i.qty || 0),
      price: Number(i.price || 0)
    })) : []
  };
  const idx = templates.findIndex(t => String(t.name).toLowerCase() === name.toLowerCase());
  if (idx >= 0) templates[idx] = next; else templates.push(next);
  saveJobTemplates(templates);
  refreshTemplateSelect();
  alert(`Template "${name}" saved.`);
}

function applySelectedTemplate() {
  const sel = document.getElementById("templateSelect");
  const name = String((sel && sel.value) || "").trim();
  if (!name) return alert("Select a template first.");
  const t = getJobTemplates().find(x => String(x.name).toLowerCase() === name.toLowerCase());
  if (!t) return alert("Template not found.");
  const description = document.getElementById("description");
  const notes = document.getElementById("notes");
  const tax = document.getElementById("tax");
  const itemsEl = document.getElementById("items");
  if (description) description.value = t.description || "";
  if (notes) notes.value = t.notes || "";
  if (tax) tax.value = Number(t.taxPercent || 0);
  if (itemsEl) itemsEl.innerHTML = "";
  if (Array.isArray(App.items)) App.items = [];
  if (Array.isArray(t.items) && t.items.length) t.items.forEach(it => addItem(it));
  else addItem();
  updateLiveTotals();
  alert(`Template "${t.name}" applied.`);
}

// ─── read-only helpers ────────────────────────────────────────────────────────

function setQuoteReadOnly(isReadOnly) {
  ["customer","contact","customerEmail","address","description","tax","amountPaid","paymentMethod","dueDate","notes","savedCustomers"]
    .forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.disabled = !!isReadOnly;
    });
  document.querySelectorAll("#items input, #items select, #items textarea, #items button")
    .forEach(function (el) { el.disabled = !!isReadOnly; });
}

function renderAcceptedQuoteBanner(quote) {
  const output = document.getElementById("output");
  if (!output) return;
  const printArea = output.querySelector("#printArea") || output.querySelector(".invoice-box");
  if (!printArea) return;
  const existing = output.querySelector(".accepted-quote-banner");
  if (existing) existing.remove();
  const banner = document.createElement("div");
  banner.className = "accepted-quote-banner";
  banner.style.cssText = "margin-bottom:12px;padding:10px 14px;border-radius:10px;background:#dcfce7;color:#166534;font-weight:700;";
  banner.textContent = "Accepted Quote" +
    (quote && quote.acceptedAt ? " • " + new Date(quote.acceptedAt).toLocaleString() : "");
  printArea.prepend(banner);
}

function clearAcceptedQuoteBanner() {
  const existing = document.querySelector(".accepted-quote-banner");
  if (existing) existing.remove();
}

// ─── global exports ───────────────────────────────────────────────────────────

window.createDoc = createDoc;
window.createQuote = createQuote;
window.sendEmail = sendEmail;
window.sendQuoteThenConvert = sendQuoteThenConvert;
window.markInvoiceAsPaid = markInvoiceAsPaid;
window.convertQuoteToInvoice = convertQuoteToInvoice;
window.loadQuote = loadQuote;
window.loadInvoice = loadInvoice;
window.deleteQuote = deleteQuote;
window.deleteInvoice = deleteInvoice;
window.showQuoteHistory = showQuoteHistory;
window.showAcceptedQuotes = showAcceptedQuotes;
window.showInvoiceHistory = showInvoiceHistory;
window.saveCurrentAsTemplate = saveCurrentAsTemplate;
window.applySelectedTemplate = applySelectedTemplate;
window.refreshInvoiceComputedFields = refreshInvoiceComputedFields;
window.setQuoteReadOnly = setQuoteReadOnly;
window.renderAcceptedQuoteBanner = renderAcceptedQuoteBanner;
window.clearAcceptedQuoteBanner = clearAcceptedQuoteBanner;

document.addEventListener("DOMContentLoaded", refreshTemplateSelect);
