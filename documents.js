function getApiBaseUrl() {
  return "https://jobflow-api-bebm.onrender.com";
}

const API_BASE_URL = getApiBaseUrl();

// ─── storage helpers ──────────────────────────────────────────────────────────

function normalizeDocNumber(value) {
  return String(value == null ? "" : value).trim();
}


function getStoredQuotes() {
  return readJson("quoteHistory", []);
}

function saveStoredQuotes(quotes) {
  writeJson("quoteHistory", Array.isArray(quotes) ? quotes : []);
}

function getStoredInvoices() {
  return readJson("invoiceHistory", []);
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

async function fetchJsonWithTimeout(url, timeoutMs, fetchOptions) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, Number(timeoutMs) || 2000);
  try {
    const options = Object.assign({}, fetchOptions || {});
    const headers = Object.assign({}, options.headers || {});
    const token = (typeof getAuthToken === "function") ? String(getAuthToken() || "").trim() : "";
    if (token && !headers.Authorization) {
      headers.Authorization = "Bearer " + token;
    }
    if (options.method && String(options.method).toUpperCase() !== "GET" && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    options.headers = headers;
    options.signal = controller.signal;

    const response = await fetch(url, options);
    if (!response.ok) return null;
    return await response.json();
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function postJsonWithTimeout(url, payload, timeoutMs) {
  return fetchJsonWithTimeout(url, timeoutMs, {
    method: "POST",
    body: JSON.stringify(payload || {})
  });
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
  await Promise.all(quotes.map(async function (quote, i) {
    const qn = normalizeDocNumber(quote.quoteNumber);
    if (!qn) return;
    const s = await fetchJsonWithTimeout(`${API_BASE_URL}/quote-status/${encodeURIComponent(qn)}`, 6000);
    if (s && s.found) {
      quotes[i].status = s.status || quotes[i].status || "Pending";
      quotes[i].acceptedAt = s.acceptedAt || quotes[i].acceptedAt || null;
    }
  }));
  saveStoredQuotes(quotes);
}

function mergeByKey(localRows, remoteRows, keyField) {
  const merged = [];
  const seen = new Set();

  (Array.isArray(remoteRows) ? remoteRows : []).forEach(function (row) {
    const key = normalizeDocNumber(row && row[keyField]);
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(row);
  });

  (Array.isArray(localRows) ? localRows : []).forEach(function (row) {
    const key = normalizeDocNumber(row && row[keyField]);
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(row);
  });

  return merged;
}

function makeClientQuoteNumber() {
  const stamp = Date.now();
  const rand = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
  return "Q-" + stamp + "-" + rand;
}

function normalizeLocalQuotesForSync(quotes) {
  const list = Array.isArray(quotes) ? quotes.slice() : [];
  const seen = new Set();

  return list.map(function (quote) {
    const row = Object.assign({}, quote || {});
    let qn = normalizeDocNumber(row.quoteNumber);

    if (!qn || seen.has(qn)) {
      do {
        qn = makeClientQuoteNumber();
      } while (seen.has(qn));
      row.quoteNumber = qn;
    }

    seen.add(qn);
    return row;
  });
}

function getQuoteSemanticKey(quote) {
  const q = quote || {};
  const items = Array.isArray(q.items) ? q.items : [];
  const itemKey = items.map(function (it) {
    const name = String(it && it.name || "").trim().toLowerCase();
    const qty = Number(it && it.qty || 0) || 0;
    const price = Number(it && it.price || 0) || 0;
    return name + "|" + qty + "|" + price;
  }).join(";");

  return [
    String(q.customer || "").trim().toLowerCase(),
    Number(q.total || 0).toFixed(2),
    Number(q.taxAmount || 0).toFixed(2),
    Number(q.finalTotal || 0).toFixed(2),
    Number(q.amountPaid || 0).toFixed(2),
    Number(q.balanceDue || 0).toFixed(2),
    String(q.notes || "").trim().toLowerCase(),
    itemKey
  ].join("||");
}

function choosePreferredQuote(a, b) {
  if (!a) return b;
  if (!b) return a;

  const aAccepted = String(a.status || "").toLowerCase() === "accepted";
  const bAccepted = String(b.status || "").toLowerCase() === "accepted";
  if (aAccepted !== bAccepted) return bAccepted ? b : a;

  const aAcceptedAt = new Date(a.acceptedAt || 0).getTime() || 0;
  const bAcceptedAt = new Date(b.acceptedAt || 0).getTime() || 0;
  if (aAcceptedAt !== bAcceptedAt) return bAcceptedAt > aAcceptedAt ? b : a;

  const aNum = normalizeDocNumber(a.quoteNumber);
  const bNum = normalizeDocNumber(b.quoteNumber);
  return bNum > aNum ? b : a;
}

function dedupeQuotesByContent(quotes) {
  const byQuoteNumber = {};
  (Array.isArray(quotes) ? quotes : []).forEach(function (q) {
    const key = normalizeDocNumber(q && q.quoteNumber);
    if (!key) return;
    byQuoteNumber[key] = choosePreferredQuote(byQuoteNumber[key], q);
  });

  const bySemantic = {};
  Object.keys(byQuoteNumber).forEach(function (qn) {
    const row = byQuoteNumber[qn];
    const sKey = getQuoteSemanticKey(row);
    bySemantic[sKey] = choosePreferredQuote(bySemantic[sKey], row);
  });

  return Object.keys(bySemantic).map(function (k) {
    return bySemantic[k];
  });
}

function normalizeInvoiceForStorage(invoice) {
  const row = Object.assign({}, invoice || {});
  const paid = String(row.status || "").toLowerCase() === "paid";
  row.amountPaid = toAmount(row.amountPaid);
  row.finalTotal = toAmount(row.finalTotal || row.total || calcItemsTotal(row.items));
  if (paid && row.finalTotal > row.amountPaid) {
    row.amountPaid = row.finalTotal;
  }
  row.balanceDue = paid ? 0 : Math.max(0, toAmount(row.balanceDue || (row.finalTotal - row.amountPaid)));
  return row;
}

function shouldBackfillInvoiceFromLocal(localInvoice, remoteInvoice) {
  if (!localInvoice || !remoteInvoice) return false;
  const localPaid = toAmount(localInvoice.amountPaid);
  const remotePaid = toAmount(remoteInvoice.amountPaid);
  const localBalance = toAmount(localInvoice.balanceDue);
  const remoteBalance = toAmount(remoteInvoice.balanceDue);
  const localStatus = String(localInvoice.status || "").toLowerCase();
  const remoteStatus = String(remoteInvoice.status || "").toLowerCase();

  if (localPaid > remotePaid + 0.009) return true;
  if (localBalance + 0.009 < remoteBalance) return true;
  if (localStatus === "paid" && remoteStatus !== "paid") return true;
  return false;
}

function getCurrentAuthUserId() {
  try {
    const raw = localStorage.getItem("authUser");
    const parsed = raw ? JSON.parse(raw) : null;
    return normalizeDocNumber(parsed && (parsed.id || parsed.email));
  } catch (_) {
    return "";
  }
}

async function runQuoteDedupeMaintenanceOnce() {
  const userId = getCurrentAuthUserId();
  if (!userId) return;

  const key = "quoteDedupeRun:" + userId;
  if (localStorage.getItem(key) === "1") return;

  const result = await postJsonWithTimeout(`${API_BASE_URL}/maintenance/dedupe-quotes`, {}, 12000);
  if (result && result.ok) {
    localStorage.setItem(key, "1");
  }
}

async function syncAccountDocuments() {
  const token = (typeof getAuthToken === "function") ? String(getAuthToken() || "").trim() : "";
  if (!token) return;

  const localInvoices = getStoredInvoices().map(normalizeInvoiceForStorage);
  const localQuotes = dedupeQuotesByContent(normalizeLocalQuotesForSync(getStoredQuotes()));

  writeJson("quoteHistory", localQuotes);

  await runQuoteDedupeMaintenanceOnce().catch(function () {});

  // First, try to upsert local docs so whichever device has the latest entries
  // can seed the account dataset for other devices.
  await Promise.all([
    Promise.all(localInvoices.map(function (inv) {
      return syncInvoiceToServer(inv).catch(function () {});
    })),
    Promise.all(localQuotes.map(function (q) {
      return syncQuoteToServer(q).catch(function () {});
    }))
  ]);

  const results = await Promise.all([
    fetchJsonWithTimeout(`${API_BASE_URL}/invoices`, 8000),
    fetchJsonWithTimeout(`${API_BASE_URL}/quotes`, 8000)
  ]);

  const remoteInvoices = Array.isArray(results[0]) ? results[0].map(normalizeInvoiceForStorage) : null;
  const remoteQuotes = Array.isArray(results[1]) ? results[1] : null;

  const freshLocalInvoices = getStoredInvoices();
  const freshLocalQuotes = dedupeQuotesByContent(normalizeLocalQuotesForSync(getStoredQuotes()));
  writeJson("quoteHistory", freshLocalQuotes);

  if (remoteInvoices) {
    const remoteInvoiceMap = {};
    remoteInvoices.forEach(function (inv) {
      const key = normalizeDocNumber(inv && inv.invoiceNumber);
      if (key) remoteInvoiceMap[key] = inv;
    });

    const improvedLocalInvoices = freshLocalInvoices.filter(function (inv) {
      const key = normalizeDocNumber(inv && inv.invoiceNumber);
      if (!key) return false;
      const remote = remoteInvoiceMap[key];
      return shouldBackfillInvoiceFromLocal(normalizeInvoiceForStorage(inv), normalizeInvoiceForStorage(remote));
    });

    if (improvedLocalInvoices.length) {
      await Promise.all(improvedLocalInvoices.map(function (inv) {
        return syncInvoiceToServer(inv).catch(function () {});
      }));
    }

    const mergedInvoices = mergeByKey(freshLocalInvoices, remoteInvoices, "invoiceNumber");
    writeJson("invoiceHistory", mergedInvoices);
  }
  if (remoteQuotes) {
    const mergedQuotes = dedupeQuotesByContent(mergeByKey(freshLocalQuotes, remoteQuotes, "quoteNumber"));
    writeJson("quoteHistory", mergedQuotes);
  }
}

async function syncInvoiceToServer(invoiceData) {
  const invoice = normalizeInvoiceForStorage(invoiceData);
  await postJsonWithTimeout(`${API_BASE_URL}/save-invoice`, invoice, 8000);
}

function remapQuoteNumberLocally(oldQuoteNumber, newQuoteNumber) {
  const from = normalizeDocNumber(oldQuoteNumber);
  const to = normalizeDocNumber(newQuoteNumber);
  if (!from || !to || from === to) return;

  const list = getStoredQuotes();
  let changed = false;
  const next = list.map(function (q) {
    if (normalizeDocNumber(q && q.quoteNumber) !== from) return q;
    changed = true;
    const updated = Object.assign({}, q || {});
    updated.quoteNumber = to;
    return updated;
  });

  if (changed) {
    saveStoredQuotes(next);
    if (normalizeDocNumber(App.activeQuoteNumber) === from) {
      App.activeQuoteNumber = to;
    }
  }
}

async function syncQuoteToServer(quoteData) {
  const payload = Object.assign({}, quoteData || {});
  const oldQuoteNumber = normalizeDocNumber(payload.quoteNumber);
  const result = await postJsonWithTimeout(`${API_BASE_URL}/save-quote`, payload, 8000);

  const savedQuoteNumber = normalizeDocNumber(result && result.quoteNumber);
  if (oldQuoteNumber && savedQuoteNumber && oldQuoteNumber !== savedQuoteNumber) {
    remapQuoteNumberLocally(oldQuoteNumber, savedQuoteNumber);
    if (quoteData && typeof quoteData === "object") {
      quoteData.quoteNumber = savedQuoteNumber;
    }
  }

  return result;
}

// ─── create ───────────────────────────────────────────────────────────────────

function createQuote() {
  const laborAmount = Number((document.getElementById("laborAmount") || {}).value || 0);
  const materialsAmount = Number((document.getElementById("materialsAmount") || {}).value || 0);
  const isSteppedForm = laborAmount > 0 || materialsAmount > 0 || (App.items && App.items.length > 0);
  const data = getDocumentData();
  if (data.total <= 0) { alert("Add at least one item before creating quote"); return; }

  // Keep any payments received entered on the form
  data.amountPaid = Number(data.amountPaid) || 0;
  data.balanceDue = Math.max(0, data.finalTotal - data.amountPaid);

  data.quoteNumber = normalizeDocNumber(getNextQuoteNumber());
  data.date = new Date().toLocaleString();
  data.status = "Pending";
  App.activeQuoteNumber = String(data.quoteNumber || "").trim();
  App.activeInvoiceNumber = "";
  setQuoteReadOnly(false);
  clearAcceptedQuoteBanner();
  setInvoiceEditingLocked(false, "");
  saveQuote(data);
  syncQuoteToServer(data)
    .then(function () { return syncAccountDocuments(); })
    .catch(function () {});

  if (isSteppedForm && typeof showDoneScreen === "function") {
    // Instead of showing done screen, go directly to dashboard and update quote history
    showDashboard();
  } else {
    renderDocument("Quote", data, true);
    resetEntryFieldsAfterCreate();
    showOutputView();
  }
}

function createDoc() {
  // Check if using stepped form (has labor/materials inputs) or traditional form (has App.items already set from stepped form)
  const laborAmount = Number((document.getElementById("laborAmount") || {}).value || 0);
  const materialsAmount = Number((document.getElementById("materialsAmount") || {}).value || 0);
  const isSteppedForm = laborAmount > 0 || materialsAmount > 0 || (App.items && App.items.length > 0);
  
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
  const saveResult = saveInvoice(data) || { saved: true };
  syncInvoiceToServer(data).catch(function () {});
  
  // Show done screen for stepped form, output view for traditional form
  if (isSteppedForm && typeof showDoneScreen === "function") {
    // Get business Stripe URL for payment link
    const stripeUrl = localStorage.getItem("businessStripeUrl") || "";
    showDoneScreen(data.invoiceNumber, stripeUrl);
  } else {
    renderDocument("Invoice", data, false);
    showOutputView();
  }
  
  if (!saveResult.saved && saveResult.reason === "free-limit") {
    alert("Free plan stores up to " + saveResult.limit + " invoices in history. Upgrade to save more.");
  }
}

function convertQuoteToInvoice(quoteData) {
  const q = quoteData || getDocumentData();
  const subtotal = toAmount(q.total || calcItemsTotal(q.items));
  const hasTaxPercent = q.taxPercent !== null && q.taxPercent !== undefined && String(q.taxPercent).trim() !== "";
  const taxPercent = hasTaxPercent ? toAmount(q.taxPercent) : "";
  const taxAmount = hasTaxPercent ? (subtotal * (taxPercent / 100)) : toAmount(q.taxAmount);
  const finalTotal = toAmount(q.finalTotal || (subtotal + taxAmount));
  const amountPaid = toAmount(q.amountPaid);
  const balanceDue = Math.max(0, toAmount(q.balanceDue || (finalTotal - amountPaid)));
  const status = balanceDue <= 0 ? "Paid" : (amountPaid > 0 ? "Partial" : "Unpaid");

  const invoice = Object.assign({}, q, {
    quoteNumber: "",
    invoiceNumber: getNextInvoiceNumber(),
    date: new Date().toLocaleString(),
    taxPercent: taxPercent,
    total: subtotal,
    taxAmount: taxAmount,
    finalTotal: finalTotal,
    amountPaid: amountPaid,
    balanceDue: balanceDue,
    status: status
  });

  // Preserve quote-calculated financials when taxPercent is missing in older records.
  if (hasTaxPercent) {
    refreshInvoiceComputedFields(invoice);
  }
  const saveResult = saveInvoice(invoice) || { saved: true };
  syncInvoiceToServer(invoice).catch(function () {});
  App.activeInvoiceNumber = String(invoice.invoiceNumber || "").trim();
  App.activeQuoteNumber = "";
  setQuoteReadOnly(false);
  clearAcceptedQuoteBanner();
  setInvoiceEditingLocked(true, invoice.invoiceNumber);
  renderDocument("Invoice", invoice, false);
  if (!saveResult.saved && saveResult.reason === "free-limit") {
    alert("Invoice created, but free plan history is full (" + saveResult.limit + " max). Upgrade to save more.");
  }
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

async function showQuoteHistory(filter, targetId) {
  if (typeof showSpinner === "function") showSpinner("Loading quotes...");
  try {
    // Only refresh statuses in background, do not sync all
    if (typeof refreshAllQuoteStatuses === "function") {
      setTimeout(() => { refreshAllQuoteStatuses().catch(() => {}); }, 100);
    }
    const normalizedFilter = String(filter || "all").toLowerCase();
    const quotes = dedupeQuotesByContent(getStoredQuotes());
    saveStoredQuotes(quotes);
    const filtered = normalizedFilter === "accepted"
      ? quotes.filter(function (q) { return String(q.status || "").toLowerCase() === "accepted"; })
      : quotes;

    let html = "<div class='invoice-box'>";
    html += "<h2>Quote History</h2>";
    html += "<div class='history-tabs'>";
    html += "<button type='button' class='history-tab " + (normalizedFilter === 'all' ? 'active' : '') + "' onclick=\"showQuoteHistory('all')\" >All Quotes</button>";
    html += "<button type='button' class='history-tab " + (normalizedFilter === 'accepted' ? 'active' : '') + "' onclick=\"showQuoteHistory('accepted')\" >Accepted Quotes</button>";
    html += "</div>";

    if (!filtered.length) {
      html += "<p>No quotes found.</p></div>";
      if (targetId && document.getElementById(targetId)) {
        document.getElementById(targetId).innerHTML = html;
      } else {
        displayInvoice(html);
      }
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
    if (targetId && document.getElementById(targetId)) {
      document.getElementById(targetId).innerHTML = html;
    } else {
      displayInvoice(html);
    }
  } finally {
    if (typeof hideSpinner === "function") hideSpinner();
  }
}

function showAcceptedQuotes() { return showQuoteHistory("accepted"); }

async function showInvoiceHistory() {
  if (typeof showSpinner === "function") showSpinner("Syncing invoices...");
  try {
  await syncAccountDocuments();
  let invoices = refreshAllInvoiceStatuses();
  if (!invoices.length) { displayInvoice("<div class='invoice-box'><p>No invoices found.</p></div>"); return; }

  const freeMonthlyLimit = typeof getFreeInvoiceMonthlyLimit === "function" ? getFreeInvoiceMonthlyLimit() : 5;
  const currentMonthKey = (function () {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  })();
  const isPremium = !!App.premium;

  // Sync payment status from server for each invoice
  await Promise.all(invoices.map(async function (invoice) {
    const invNum = normalizeDocNumber(invoice.invoiceNumber);
    if (!invNum) return;
    const s = await fetchJsonWithTimeout(`${API_BASE_URL}/payment-status/${encodeURIComponent(invNum)}`, 6000);
    if (s && s.found && s.paid) {
      invoice.status = "Paid";
      invoice.paidAt = s.paidAt || invoice.paidAt || null;
      const finalTotal = toAmount(invoice.finalTotal || invoice.total || calcItemsTotal(invoice.items));
      invoice.amountPaid = Math.max(toAmount(invoice.amountPaid), toAmount(s.amountPaid), finalTotal);
      invoice.balanceDue = 0;
    } else if (s && s.found && s.status) {
      invoice.status = s.status;
      if (typeof s.amountPaid === "number") invoice.amountPaid = Math.max(toAmount(invoice.amountPaid), toAmount(s.amountPaid));
      if (typeof s.balanceDue === "number") invoice.balanceDue = toAmount(s.balanceDue);
    }
  }));

  // Save synced statuses back to localStorage
  const stored = getStoredInvoices();
  invoices.forEach(function (inv) {
    const idx = stored.findIndex(function (s) {
      return normalizeDocNumber(s.invoiceNumber) === normalizeDocNumber(inv.invoiceNumber);
    });
    if (idx !== -1) stored[idx] = Object.assign(stored[idx], { status: inv.status, balanceDue: inv.balanceDue, paidAt: inv.paidAt });
  });
  writeJson("invoiceHistory", stored);

  let html = "<div class='invoice-box'><h2>Invoice History</h2>";
  if (!isPremium) {
    const used = typeof getFreeInvoiceMonthlyUsage === "function" ? getFreeInvoiceMonthlyUsage(invoices) : 0;
    html += "<p style='margin:0 0 12px 0;color:#6b7280;'>Free plan: " + used + "/" + freeMonthlyLimit + " invoices this month. Older entries this month are locked.</p>";
  }

  let unlockedThisMonthCount = 0;
  invoices.slice().reverse().forEach(function (invoice) {
    const status = invoice.status || getInvoiceStatus(invoice);
    const statusClass = "status-" + status.toLowerCase();
    const invKey = String(invoice.invoiceNumber || "").replace(/"/g, "&quot;");

    const monthKey = String(invoice.createdMonthKey || "").trim();
    const isCurrentMonth = monthKey === currentMonthKey;
    const shouldLock = !isPremium && isCurrentMonth && unlockedThisMonthCount >= freeMonthlyLimit;
    if (!shouldLock && isCurrentMonth) unlockedThisMonthCount += 1;

    html += "<div class='quote-entry" + (shouldLock ? " invoice-entry-locked" : "") + "'>";
    if (shouldLock) {
      html += "<span class='invoice-locked-content'><strong>" + invoice.invoiceNumber + "</strong> <span class='status-badge status-locked'>LOCKED</span><br>" + (invoice.date || "No date") + "<br>" + (invoice.customer || "No customer") + "</span>";
      html += "<span><button onclick='upgrade()'>Upgrade</button></span>";
    } else {
      html += "<span><strong>" + invoice.invoiceNumber + "</strong> <span class='status-badge " + statusClass + "'>" + status.toUpperCase() + "</span><br>" + (invoice.date || "No date") + "<br>" + (invoice.customer || "No customer") + "</span>";
      html += "<span><button onclick='loadInvoice(\"" + invKey + "\")'>Open</button> <button onclick='deleteInvoice(\"" + invKey + "\")'>Delete</button></span>";
    }
    html += "</div>";
  });
  html += "</div>";
  displayInvoice(html);
  } finally {
    if (typeof hideSpinner === "function") hideSpinner();
  }
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
  // Safely restore form fields, handling both stepped and traditional form structures
  const safeSetValue = function(id, value) {
    const el = document.getElementById(id);
    if (el && el.type !== "hidden") el.value = value || "";
  };
  
  safeSetValue("customer", data.customer || "");
  safeSetValue("contact", data.contact || "");
  safeSetValue("customerEmail", data.email || data.to || "");
  safeSetValue("address", data.address || "");
  safeSetValue("description", data.description || "");
  safeSetValue("tax", data.taxPercent || "");
  safeSetValue("amountPaid", data.amountPaid || "");
  safeSetValue("paymentMethod", data.paymentMethod || "");
  safeSetValue("dueDate", data.dueDate || "");
  safeSetValue("notes", data.notes || "");
  
  // Only restore items if using traditional form (not stepped form)
  const itemsContainer = document.getElementById("items");
  if (itemsContainer && itemsContainer.style.display !== "none") {
    itemsContainer.innerHTML = "";
    App.items = [];
    if (data.items && data.items.length) {
      data.items.forEach(function (item) { 
        if (typeof addItem === "function") addItem(item); 
      });
    } else {
      if (typeof addItem === "function") addItem();
    }
  }
  
  if (typeof updateLiveTotals === "function") updateLiveTotals();
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
  if (typeof showOutputView === "function") showOutputView();
}

function deleteQuote(quoteNumber) {
  const target = normalizeDocNumber(quoteNumber);
  saveStoredQuotes(getStoredQuotes().filter(function (q) {
    return normalizeDocNumber(q.quoteNumber) !== target;
  }));
  alert("Quote #" + target + " deleted.");
  showQuoteHistory();
}

async function loadInvoice(invoiceNumber) {
  const target = normalizeDocNumber(invoiceNumber);
  let invoice = refreshAllInvoiceStatuses().find(function (i) {
    return normalizeDocNumber(i.invoiceNumber) === target;
  });
  if (!invoice) { alert("Invoice not found."); return; }

  const status = await fetchJsonWithTimeout(`${API_BASE_URL}/payment-status/${encodeURIComponent(target)}`, 6000);
  if (status && status.found) {
    if (status.paid) {
      invoice.status = "Paid";
      invoice.paidAt = status.paidAt || invoice.paidAt || null;
      const finalTotal = toAmount(invoice.finalTotal || invoice.total || calcItemsTotal(invoice.items));
      invoice.amountPaid = Math.max(toAmount(status.amountPaid), finalTotal);
      invoice.balanceDue = 0;
    } else {
      if (status.status) invoice.status = status.status;
      if (typeof status.amountPaid === "number") invoice.amountPaid = Math.max(toAmount(invoice.amountPaid), toAmount(status.amountPaid));
      if (typeof status.balanceDue === "number") invoice.balanceDue = toAmount(status.balanceDue);
    }
  }

  App.activeInvoiceNumber = normalizeDocNumber(invoice.invoiceNumber);
  App.activeQuoteNumber = "";
  setQuoteReadOnly(false);
  clearAcceptedQuoteBanner();
  refreshInvoiceComputedFields(invoice);
  updateSavedInvoice(invoice);
  restoreInvoiceForm(invoice);
  setInvoiceEditingLocked(true, invoice.invoiceNumber);
  renderDocument("Invoice", invoice, false);
  if (typeof showOutputView === "function") showOutputView();
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
  if (App && String(App.lastRenderedDocKind || "").toLowerCase() === "quote") return "quote";
  if (App && String(App.lastRenderedDocKind || "").toLowerCase() === "invoice") return "invoice";
  const titleEl = document.querySelector("#output .invoice-meta h2, #printArea .invoice-meta h2, #output h2, #printArea h2");
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
  if (!source && App && App.lastRenderedDoc) {
    const renderedKind = String(App.lastRenderedDocKind || "").toLowerCase();
    if (!renderedKind || renderedKind === kind) {
      source = JSON.parse(JSON.stringify(App.lastRenderedDoc));
    }
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

  if (kind === "quote" && !payload.quoteNumber) {
    alert("Create or open a quote before sending email.");
    return false;
  }
  if (kind === "invoice" && !payload.invoiceNumber) {
    alert("Create or open an invoice before sending email.");
    return false;
  }

  const endpoint = kind === "quote"
    ? `${API_BASE_URL}/send-quote-email`
    : `${API_BASE_URL}/send-email`;

  if (typeof showSpinner === "function") showSpinner("Sending email...");
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
  } finally {
    if (typeof hideSpinner === "function") hideSpinner();
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
    const list = getStoredQuotes();
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
window.syncAccountDocuments = syncAccountDocuments;
window.saveCurrentAsTemplate = saveCurrentAsTemplate;
window.applySelectedTemplate = applySelectedTemplate;
window.refreshInvoiceComputedFields = refreshInvoiceComputedFields;
window.setQuoteReadOnly = setQuoteReadOnly;
window.renderAcceptedQuoteBanner = renderAcceptedQuoteBanner;
window.clearAcceptedQuoteBanner = clearAcceptedQuoteBanner;

document.addEventListener("DOMContentLoaded", refreshTemplateSelect);
