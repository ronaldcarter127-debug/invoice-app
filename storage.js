function getAccountStoragePrefix() {
  try {
    const raw = localStorage.getItem("authUser");
    const parsed = raw ? JSON.parse(raw) : null;
    const id = String((parsed && (parsed.id || parsed.email)) || "").trim();
    if (!id) return "acct:guest:";
    return "acct:" + id + ":";
  } catch (_) {
    return "acct:guest:";
  }
}

function scopedStorageKey(key) {
  return getAccountStoragePrefix() + String(key || "").trim();
}

function readJson(key, fallbackValue) {
  const raw = localStorage.getItem(scopedStorageKey(key));
  if (!raw) return fallbackValue;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return fallbackValue;
  }
}

function writeJson(key, value) {
  localStorage.setItem(scopedStorageKey(key), JSON.stringify(value));
}

function getSavedQuotes() {
  return readJson("quoteHistory", []);
}

function saveQuote(data) {
  const quotes = getSavedQuotes();
  quotes.push(data);
  writeJson("quoteHistory", quotes);
}

function getNextQuoteNumber() {
  return Date.now();
}

function getSavedInvoices() {
  return readJson("invoiceHistory", []);
}

function saveInvoice(data) {
  const invoices = getSavedInvoices();
  invoices.push(data);
  writeJson("invoiceHistory", invoices);
}

function updateSavedInvoice(data) {
  const invoices = getSavedInvoices();
  const updated = invoices.map(function(invoice) {
    return invoice.invoiceNumber === data.invoiceNumber ? data : invoice;
  });
  writeJson("invoiceHistory", updated);
}

function getNextInvoiceNumber() {
  const scopedInvoiceNumKey = scopedStorageKey("invoiceNum");
  if (!localStorage.getItem(scopedInvoiceNumKey)) {
    localStorage.setItem(scopedInvoiceNumKey, "1");
  }
  let invoiceNum = Number(localStorage.getItem(scopedInvoiceNumKey) || "1");
  const existingNumbers = new Set(getSavedInvoices().map(function(invoice) {
    return invoice.invoiceNumber;
  }));

  let invoiceNumber = "INV-" + invoiceNum.toString().padStart(4, "0");
  while (existingNumbers.has(invoiceNumber)) {
    invoiceNum += 1;
    invoiceNumber = "INV-" + invoiceNum.toString().padStart(4, "0");
  }

  localStorage.setItem(scopedInvoiceNumKey, String(invoiceNum + 1));
  return invoiceNumber;
}

function getSavedCustomers() {
  return readJson("savedCustomers", []);
}

function getBusinessInfo() {
  return readJson("businessInfo", null);
}

function saveBusinessInfoToStorage(data) {
  writeJson("businessInfo", data);
}

function getAutoSavedFormData() {
  return readJson("autoSavedForm", null);
}

function saveAutoSavedFormData(data) {
  writeJson("autoSavedForm", data);
}

function getSavedCustomersList() {
  try {
    const list = readJson("savedCustomers", []);
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
}

function setSavedCustomersList(list) {
  writeJson("savedCustomers", Array.isArray(list) ? list : []);
}

function refreshSavedCustomersDropdown() {
  const select = document.getElementById("savedCustomers");
  if (!select) return;

  const customers = getSavedCustomersList();
  select.innerHTML = `<option value="">Select Saved Customer</option>` +
    customers.map((c, i) => {
      const label = [c.name, c.phone, c.email].filter(Boolean).join(" • ");
      return `<option value="${i}">${label || "Unnamed Customer"}</option>`;
    }).join("");
}

function saveCurrentCustomer() {
  const name = String((document.getElementById("customer") || {}).value || "").trim();
  const phone = String((document.getElementById("contact") || {}).value || "").trim();
  const email = String((document.getElementById("customerEmail") || {}).value || "").trim();
  const address = String((document.getElementById("address") || {}).value || "").trim();

  if (!name) {
    alert("Customer name is required.");
    return;
  }

  const customers = getSavedCustomersList();
  const key = name.toLowerCase();

  const existingIndex = customers.findIndex(c => String(c.name || "").trim().toLowerCase() === key);
  const record = { name, phone, email, address };

  if (existingIndex >= 0) customers[existingIndex] = record;
  else customers.push(record);

  setSavedCustomersList(customers);
  refreshSavedCustomersDropdown();
  alert("Customer saved.");
}

function loadSavedCustomer() {
  const select = document.getElementById("savedCustomers");
  if (!select) return;

  const idx = Number(select.value);
  if (!Number.isFinite(idx)) return;

  const customers = getSavedCustomersList();
  const c = customers[idx];
  if (!c) return;

  const nameEl = document.getElementById("customer");
  const phoneEl = document.getElementById("contact");
  const emailEl = document.getElementById("customerEmail");
  const addrEl = document.getElementById("address");

  if (nameEl) nameEl.value = c.name || "";
  if (phoneEl) phoneEl.value = c.phone || "";
  if (emailEl) emailEl.value = c.email || "";
  if (addrEl) addrEl.value = c.address || "";
}

window.saveCurrentCustomer = saveCurrentCustomer;
window.loadSavedCustomer = loadSavedCustomer;
window.refreshSavedCustomersDropdown = refreshSavedCustomersDropdown;

document.addEventListener("DOMContentLoaded", refreshSavedCustomersDropdown);
