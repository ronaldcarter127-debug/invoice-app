function showSpinner(msg) {
  const el = document.getElementById("spinner");
  if (!el) return;
  document.getElementById("spinnerMsg").textContent = msg || "Loading...";
  el.style.display = "flex";
}

function hideSpinner() {
  const el = document.getElementById("spinner");
  if (el) el.style.display = "none";
}

window.showSpinner = showSpinner;
window.hideSpinner = hideSpinner;

async function upgrade() {
  try {
    const apiBase = (typeof getApiBaseUrl === "function" ? getApiBaseUrl() : "https://jobflow-api-bebm.onrender.com");
    const token = (typeof getAuthToken === "function" ? getAuthToken() : "");
    if (!token) {
      alert("Please log in before upgrading.");
      return;
    }
    const res = await fetch(apiBase + "/create-premium-checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + token
      }
    });
    const data = await res.json();
    if (!res.ok || !data.url) throw new Error(data.error || "Checkout failed.");
    window.location.href = data.url;
  } catch (err) {
    alert("Upgrade failed: " + err.message);
  }
}

function checkPremium() {
  App.premium = !!App.premium;
  const FREE_INVOICE_HISTORY_LIMIT = typeof getFreeInvoiceMonthlyLimit === "function" ? getFreeInvoiceMonthlyLimit() : 5;
  const usedInvoices = typeof getFreeInvoiceMonthlyUsage === "function" ? getFreeInvoiceMonthlyUsage() : 0;
  const usedLabel = Math.max(0, usedInvoices) + "/" + FREE_INVOICE_HISTORY_LIMIT;

  const quoteHistoryBtn = document.getElementById("quoteHistoryBtn");
  const invoiceHistoryBtn = document.getElementById("invoiceHistoryBtn");
  const upgradeBtn = document.getElementById("upgradeBtn");
  const planBadge = document.getElementById("planBadge");
  const planMessage = document.getElementById("planMessage");

  document.body.classList.remove("free-mode", "premium-mode");
  document.body.classList.add(App.premium ? "premium-mode" : "free-mode");

  if (quoteHistoryBtn && invoiceHistoryBtn) {
    quoteHistoryBtn.disabled = !App.premium;
    invoiceHistoryBtn.disabled = false;
    quoteHistoryBtn.classList.toggle("locked", !App.premium);
    invoiceHistoryBtn.classList.remove("locked");
    quoteHistoryBtn.textContent = App.premium ? "Quote History" : "Quote History (Premium)";
    invoiceHistoryBtn.textContent = App.premium ? "Invoice History" : "Invoice History (" + usedLabel + " this month)";
  }

  if (upgradeBtn) {
    upgradeBtn.style.display = App.premium ? "none" : "inline-block";
  }

  if (planBadge && planMessage) {
    if (App.premium) {
      planBadge.textContent = "Premium Plan Active";
      planMessage.textContent = "All features unlocked: full history, polished export flow, and premium experience.";
    } else {
      planBadge.textContent = "Free Plan";
      planMessage.textContent = "Create invoices and quotes. Invoice history: " + usedLabel + " this month. Upgrade for unlimited history.";
    }
  }
}

function updateLogoPreview(logoData) {
  const preview = document.getElementById("logoPreview");
  if (logoData) {
    const size = document.getElementById("logoSize").value || 50;
    const crop = document.getElementById("logoCrop").value || "center";
    preview.innerHTML = '<img src="' + logoData + '" style="height:' + size + 'px;max-width:140px;object-fit:contain;object-position:' + crop + ';">';
  } else {
    preview.innerHTML = '<span style="color:#6b7280;font-size:12px;">No logo uploaded</span>';
  }
}

function updateLiveTotals() {
  const itemsContainer = document.getElementById('items');
  if (!itemsContainer) {
    console.warn('[updateLiveTotals] Could not find #items container.');
    return;
  }
  const data = getDocumentData();
  const totalsDiv = document.getElementById("liveTotals");
  totalsDiv.innerHTML = [
    '<div>Subtotal: $' + data.total.toFixed(2) + '</div>',
    '<div>Payments Received: $' + data.amountPaid.toFixed(2) + '</div>',
    '<div>Tax: $' + data.taxAmount.toFixed(2) + '</div>',
    '<div class="total">TOTAL: $' + data.finalTotal.toFixed(2) + '</div>',
    '<div>Balance Due: $' + Math.max(0, data.balanceDue).toFixed(2) + '</div>'
  ].join("");
}

function addItem(item) {
  const sourceItem = item || {};
  const id = "item-" + Date.now() + "-" + Math.floor(Math.random() * 10000);

  const div = document.createElement("div");
  div.className = "item-row";

  const name = document.createElement("input");
  name.placeholder = "Service";
  name.id = "name-" + id;
  name.value = sourceItem.name || "";

  const qty = document.createElement("input");
  qty.type = "number";
  qty.min = "1";
  qty.placeholder = "Qty";
  qty.id = "qty-" + id;
  qty.value = sourceItem.qty || 1;

  const price = document.createElement("input");
  price.type = "number";
  price.step = "0.01";
  price.min = "0";
  price.placeholder = "Price";
  price.id = "price-" + id;
  price.value = sourceItem.price !== undefined && sourceItem.price !== null ? sourceItem.price : "";

  div.appendChild(name);
  div.appendChild(qty);
  div.appendChild(price);

  const itemsContainer = document.getElementById("items");
  if (!itemsContainer) {
    console.warn('[addItem] Could not find #items container.');
    return;
  }
  itemsContainer.appendChild(div);
  App.items.push(id);
}

function getSavedSignatureNameFallback() {
  try {
    const raw = localStorage.getItem("businessInfo");
    const parsed = raw ? JSON.parse(raw) : {};
    return String(
      parsed.signatureName ||
      parsed.businessSignatureName ||
      ""
    ).trim();
  } catch (_) {
    return "";
  }
}

function generateSignatureImage(signatureName) {
  const name = String(signatureName || "").trim();
  if (!name) return "";

  const canvas = document.createElement("canvas");
  canvas.width = 1400;
  canvas.height = 320;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#2d3748";
  ctx.textBaseline = "middle";
  ctx.font = '700 128px "Great Vibes", "Dancing Script", "Allura", "Alex Brush", "Brush Script MT", "Lucida Handwriting", cursive';
  ctx.fillText(name, 18, 165);

  return canvas.toDataURL("image/png");
}

// 💳 STRIPE CHECKOUT
async function startInvoiceCheckout(data) {
  const balance = toAmount(
    toAmount(data.balanceDue) > 0 ? data.balanceDue : (toAmount(data.finalTotal) > 0 ? data.finalTotal : data.total)
  );
  const apiBase = (typeof getApiBaseUrl === "function" ? getApiBaseUrl() : "https://jobflow-api-bebm.onrender.com");
  const amount = Math.round(balance * 100);

  if (!Number.isInteger(amount) || amount <= 0) {
    alert("This invoice has no balance due.");
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(function () { controller.abort(); }, 15000);

  try {
    const response = await fetch(apiBase + "/create-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        invoiceNumber: data.invoiceNumber || "",
        customer: data.customer || "",
        amount: amount
      })
    });

    let result = {};
    try {
      result = await response.json();
    } catch (_) {
      result = {};
    }

    if (!response.ok || !result.url) {
      throw new Error(result.error || "Unable to start Stripe checkout.");
    }

    window.open(result.url, "_blank", "noopener");
  } catch (error) {
    alert(error.name === "AbortError" ? "Checkout timed out. Please try again." : (error.message || "Stripe checkout failed."));
  } finally {
    clearTimeout(timeout);
  }
}

function renderInvoiceHTML(title, data, isQuote) {
  let fallbackSignatureName = "";
  try {
    const savedBusinessInfo = typeof getBusinessInfo === "function" ? (getBusinessInfo() || {}) : {};
    fallbackSignatureName = String(savedBusinessInfo.signatureName || savedBusinessInfo.businessSignatureName || "").trim();
  } catch (_) {
    fallbackSignatureName = "";
  }

  const signatureInput = document.getElementById("businessSignatureName");
  const activeSignatureName = String(
    data.businessSignatureName ||
    data.signatureName ||
    fallbackSignatureName ||
    getSavedSignatureNameFallback() ||
    (signatureInput ? signatureInput.value : "") ||
    ""
  ).trim();

  let html = "<div id='printArea' class='invoice-box'>";
  html += "<div class='invoice-header'>";
  html += "<div class='business-info'>";
  if (data.businessLogo) {
    const logoSize = data.businessLogoSize || 50;
    const logoCrop = data.businessLogoCrop || "center";
    html += "<img src='" + data.businessLogo + "' style='height:" + logoSize + "px;margin-bottom:10px;object-fit:contain;object-position:" + logoCrop + ";max-width:150px;'>";
  }
  html += "<h1>" + escapeHtml(data.businessName || "Your Business Name") + "</h1>";
  html += "<p>" + escapeHtml(data.businessAddress || "123 Main St, Murfreesboro, TN") + "</p>";
  html += "<p><a href='tel:" + escapeHtml(data.businessPhone || "615-XXX-XXXX") + "' style='color:#0066cc;text-decoration:none;'>" + escapeHtml(data.businessPhone || "615-XXX-XXXX") + "</a></p>";
  html += "<p><a href='mailto:" + escapeHtml(data.businessEmail || "you@email.com") + "' style='color:#0066cc;text-decoration:none;'>" + escapeHtml(data.businessEmail || "you@email.com") + "</a></p>";
  html += "</div>";
  html += "<div class='invoice-meta'>";
  html += "<h2>" + title + "</h2>";
  const documentNumber = isQuote ? data.quoteNumber : data.invoiceNumber;
  if (documentNumber) {
    html += "<p><strong>" + (isQuote ? "Quote" : "Invoice") + " #:</strong> " + documentNumber;
    if (!isQuote) {
      const status = data.status || getInvoiceStatus(data);
      const statusClass = "status-" + status.toLowerCase();
      html += " <span class='status-badge " + statusClass + "'>" + status.toUpperCase() + "</span>";
    }
    html += "</p>";
  }
  if (data.date) {
    html += "<p><strong>Date:</strong> " + data.date + "</p>";
  }
  html += "</div></div>";

  html += "<div class='bill-to-section' style='margin:30px 0;'>";
  html += "<h3 style='margin-bottom:10px;color:#333;'>Bill To:</h3>";
  if (data.customer) html += "<p style='margin:5px 0;font-weight:bold;'>" + escapeHtml(data.customer) + "</p>";
  if (data.contact) html += "<p style='margin:5px 0;'>" + escapeHtml(data.contact) + "</p>";
  if (data.address) html += "<p style='margin:5px 0;'>" + escapeHtml(data.address) + "</p>";

  if (data.description) {
    html += "<div style='margin:20px 0;'><p><strong>Description:</strong> " + escapeHtml(data.description) + "</p></div>";
  }

  if (data.items.length) {
    html += "<div class='invoice-table-wrap'><table class='invoice-table'><thead><tr><th>Service</th><th>Qty</th><th>Price</th><th class='total-col'>Total</th></tr></thead><tbody>";
    data.items.forEach(function(item) {
      const hasPrice = item.price !== "" && item.price !== null && item.price !== undefined && !isNaN(Number(item.price));
      if (item.name && hasPrice) {
        const qty = Number(item.qty) || 1;
        const price = Number(item.price) || 0;
        const itemTotal = price * qty;
        html += "<tr><td>" + escapeHtml(item.name) + "</td><td>" + qty + "</td><td>$" + price.toFixed(2) + "</td><td class='total-col'>$" + itemTotal.toFixed(2) + "</td></tr>";
      }
    });
    html += "</tbody></table></div>";
  }

  const subtotal = Number(data.total || 0);
  const taxAmount = Number(data.taxAmount || 0);
  const finalTotal = Number(data.finalTotal || 0);
  const paymentsReceived = Number(data.amountPaid || 0);
  const balanceDue = Number(data.balanceDue || 0);

  const taxLabel = Number(
    data.taxPercent != null && data.taxPercent !== ""
      ? data.taxPercent
      : (data.tax != null && data.tax !== ""
          ? data.tax
          : (data.total > 0 ? (data.taxAmount / data.total) * 100 : 0))
  );

  const totalsHtml = `
    <div style="margin-top:18px; margin-left:auto; max-width:320px; width:100%;">
      <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
        <span><strong>Subtotal:</strong></span>
        <span>$${subtotal.toFixed(2)}</span>
      </div>

      <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
        <span><strong>Tax (${taxLabel.toFixed(2)}%):</strong></span>
        <span>$${taxAmount.toFixed(2)}</span>
      </div>

      <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
        <span><strong>Total:</strong></span>
        <span><strong>$${finalTotal.toFixed(2)}</strong></span>
      </div>

      <div style="border-top:2px solid #00e676; margin:10px 0 10px;"></div>

      ${paymentsReceived > 0 ? `
      <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
        <span style="color:#00e676; font-weight:800;">Payments Received:</span>
        <span style="color:#00e676; font-weight:800;">$${paymentsReceived.toFixed(2)}</span>
      </div>
      ` : ""}

      <div style="display:flex; justify-content:space-between;">
        <span><strong>Balance Due:</strong></span>
        <span><strong>$${balanceDue.toFixed(2)}</strong></span>
      </div>
    </div>
  `;

  html += "<div class='totals-section' style='margin:30px 0;display:flex;justify-content:flex-end;'>";
  html += totalsHtml;
  html += "</div>";

  if (data.paymentMethod || data.dueDate) {
    html += "<div style='margin:20px 0;padding:15px;background:#f8fafc;border-radius:8px;border-left:4px solid #00ee58;'>";
    if (data.paymentMethod) html += "<p style='font-size:16px;font-weight:bold;color:#00ee58;margin:0;'><strong>Payment Method:</strong> " + data.paymentMethod + "</p>";
    if (data.dueDate) html += "<p style='margin:5px 0 0 0;'><strong>Due Date:</strong> " + data.dueDate + "</p>";
    html += "</div>";
  }

  if (!isQuote && Number(data.balanceDue || data.finalTotal || 0) > 0) {
    html += "<div style='margin:18px 0;'>";
    html += "<p style='margin:0;color:#374151;'><strong>Online payment available.</strong> Use the Pay Now button below.</p>";
    html += "</div>";
  }

  html += "<div style='margin:30px 0;border-top:1px solid #e5e7eb;padding-top:20px;'>";
  html += "<h4 style='margin-bottom:10px;color:#333;'>Notes / Terms:</h4>";
  html += "<p>" + (data.notes || "Payment due upon completion. Thank you for your business.") + "</p>";
  html += "<p style='margin-top:12px;font-size:14px;color:#4b5563;'><strong>Payment Terms:</strong> Due on receipt</p>";
  if (data.businessLicense) html += "<p style='margin-top:8px;font-size:14px;color:#4b5563;'><strong>License #:</strong> " + data.businessLicense + "</p>";
  html += "<div style='margin-top:18px;'>";
  html += "<p style='font-size:14px;color:#4b5563;margin-bottom:5px;'><strong>Signature:</strong></p>";
  if (activeSignatureName) {
    const signatureImage = generateSignatureImage(activeSignatureName);
    if (signatureImage) {
      html += "<img src='" + signatureImage + "' style='height:62px;width:auto;max-width:300px;border-bottom:1px solid #000;padding-bottom:6px;margin-top:5px;' alt='Signature'>";
    } else {
      html += "<div style='font-family:\"Dancing Script\", \"Great Vibes\", \"Allura\", \"Alex Brush\", \"Brush Script MT\", \"Lucida Handwriting\", cursive;font-size:28px;border-bottom:1px solid #000;width:280px;padding-bottom:8px;margin-top:5px;color:#2d3748;'>" + activeSignatureName + "</div>";
    }
  } else {
    html += "<div style='border-bottom:1px solid #000;width:200px;height:50px;'></div>";
  }
  html += "</div></div>";
  html += "<div id='buttons'></div>";
  html += "</div>";
  return html;
}

function displayInvoice(html) {
  document.getElementById("output").innerHTML = html;
}

async function ensureSignatureFontsReady() {
  if (!document.fonts || !document.fonts.ready) return;
  try {
    await document.fonts.load('700 64px "Great Vibes"');
    await document.fonts.load('700 64px "Dancing Script"');
    await document.fonts.ready;
  } catch (e) {
    // non-blocking
  }
}

function mountActionButtons(target, data, isQuote) {
  if (!target) return;
  target.innerHTML = "";

  // ✅ force invoice mode if invoiceNumber exists
  const hasInvoiceNumber = !!String((data && data.invoiceNumber) || "").trim();
  const useQuoteMode = !!isQuote && !hasInvoiceNumber;

  target.style.display = "flex";
  target.style.gap = "8px";
  target.style.marginTop = "14px";
  target.style.flexWrap = "wrap";

  function addBtn(label, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.style.padding = "8px 12px";
    b.style.borderRadius = "8px";
    b.style.border = "1px solid #d1d5db";
    b.style.background = "#ffffff";
    b.style.cursor = "pointer";
    b.onclick = onClick;
    target.appendChild(b);
  }

  addBtn("PDF", function () {
    if (typeof window.downloadPDF === "function") return window.downloadPDF();
    window.print();
  });

  addBtn("Email", function () {
    if (typeof window.sendEmail === "function") window.sendEmail();
  });

  if (useQuoteMode) {
    addBtn("Convert to Invoice", function () {
      if (typeof window.convertQuoteToInvoice === "function") {
        window.convertQuoteToInvoice(JSON.parse(JSON.stringify(data || {})));
      }
    });
  } else {
    const status = String((data && data.status) || "").toLowerCase();
    if (status !== "paid") {
      addBtn("Mark as Paid", function () {
        if (typeof window.markInvoiceAsPaid === "function") {
          window.markInvoiceAsPaid(JSON.parse(JSON.stringify(data || {})));
        }
      });
    }
  }
}

async function renderDocument(title, data, isQuote) {
  const output = document.getElementById("output");
  if (!output) return;

  await ensureSignatureFontsReady();

  // ✅ normalize mode from title + data
  let useQuoteMode = !!isQuote;
  if (String(title || "").toLowerCase().includes("invoice")) useQuoteMode = false;
  if (String((data && data.invoiceNumber) || "").trim()) useQuoteMode = false;

  if (typeof App === "object" && App) {
    App.lastRenderedDoc = JSON.parse(JSON.stringify(data || {}));
    App.lastRenderedDocKind = useQuoteMode ? "quote" : "invoice";
  }

  output.innerHTML = renderInvoiceHTML(useQuoteMode ? "Quote" : "Invoice", data, useQuoteMode);

  const btnHost = output.querySelector("#buttons");
  mountActionButtons(btnHost, data, useQuoteMode);

  const previewArea = document.getElementById("previewArea");
  if (previewArea) previewArea.classList.add("show");
}

function previewInvoice() {
  const data = getDocumentData();
  const previewArea = document.getElementById("previewArea");
  let html = "<h2>Invoice Preview</h2>";

  if (data.customer) html += "<p><strong>Customer:</strong> " + data.customer + "</p>";
  if (data.contact) html += "<p><strong>Phone:</strong> " + data.contact + "</p>";
  if (data.address) html += "<p><strong>Address:</strong> " + data.address + "</p>";
  if (data.description) html += "<p><strong>Description:</strong> " + data.description + "</p>";

  if (data.items.length) {
    html += "<div><strong>Items:</strong></div>";
    data.items.forEach(function(item) {
      if (item.name && item.price) {
        const qtyText = item.qty > 1 ? " (x" + item.qty + ")" : "";
        html += "<p>" + item.name + qtyText + " - $" + item.price.toFixed(2) + "</p>";
      }
    });
  }

  const subtotal = Number(data.total || 0);
  const taxAmount = Number(data.taxAmount || 0);
  const finalTotal = Number(data.finalTotal || 0);
  const paymentsReceived = Number(data.amountPaid || 0);
  const balanceDue = Number(data.balanceDue || 0);

  const taxLabel = Number(
    data.taxPercent != null && data.taxPercent !== ""
      ? data.taxPercent
      : (data.tax != null && data.tax !== ""
          ? data.tax
          : (data.total > 0 ? (data.taxAmount / data.total) * 100 : 0))
  );

  html += "<h4>Tax (" + taxLabel.toFixed(2) + "%): $" + data.taxAmount.toFixed(2) + "</h4>";
  html += "<h3>Total: $" + data.finalTotal.toFixed(2) + "</h3>";
  html += "<h4>Balance Due: $" + Math.max(0, data.balanceDue).toFixed(2) + "</h4>";
  if (data.notes) html += "<p><strong>Notes:</strong> " + data.notes + "</p>";

  previewArea.innerHTML = html;
  previewArea.classList.add("show");
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toAmount(value) {
  if (value === null || value === undefined) return 0;
  const n = Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function downloadPDF() {
  window.print();
}

window.downloadPDF = downloadPDF;
window.renderDocument = renderDocument;

function getSavedCustomersListSafe() {
  try {
    const list = JSON.parse(localStorage.getItem("savedCustomers") || "[]");
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
}

function setSavedCustomersListSafe(list) {
  localStorage.setItem("savedCustomers", JSON.stringify(Array.isArray(list) ? list : []));
}

function refreshSavedCustomersDropdown() {
  const select = document.getElementById("savedCustomers");
  if (!select) return;

  const customers = getSavedCustomersListSafe();
  select.innerHTML = "<option value=''>Select Saved Customer</option>" + customers.map(function (c, i) {
    const name = String(c.name || c.customer || "").trim();
    const phone = String(c.phone || c.contact || "").trim();
    const email = String(c.email || c.customerEmail || "").trim();
    const label = [name, phone, email].filter(Boolean).join(" • ");
    return "<option value='" + i + "'>" + (label || ("Customer " + (i + 1))) + "</option>";
  }).join("");
}

function loadSavedCustomer() {
  const select = document.getElementById("savedCustomers");
  if (!select) return;

  const idx = Number(select.value);
  const list = getSavedCustomersListSafe();
  const c = Number.isFinite(idx) ? list[idx] : null;

  const nameEl = document.getElementById("customer");
  const phoneEl = document.getElementById("contact");
  const emailEl = document.getElementById("customerEmail");
  const addressEl = document.getElementById("address");

  // Always overwrite so previous customer data does not stick
  if (nameEl) nameEl.value = c ? String(c.name || c.customer || "") : "";
  if (phoneEl) phoneEl.value = c ? String(c.phone || c.contact || "") : "";
  if (emailEl) emailEl.value = c ? String(c.email || c.customerEmail || "") : "";
  if (addressEl) addressEl.value = c ? String(c.address || "") : "";
}

function bindSavedCustomerEvents() {
  const select = document.getElementById("savedCustomers");
  if (select && !select.dataset.bound) {
    select.addEventListener("change", loadSavedCustomer);
    select.dataset.bound = "1";
  }
  refreshSavedCustomersDropdown();
}

window.loadSavedCustomer = loadSavedCustomer;
window.refreshSavedCustomersDropdown = refreshSavedCustomersDropdown;

// keep only one DOMContentLoaded binding for this
document.addEventListener("DOMContentLoaded", bindSavedCustomerEvents);

function extractFirstEmail(text) {
  const s = String(text || "").trim();
  const m = s.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0] : "";
}

function saveCurrentCustomer() {
  const nameEl = document.getElementById("customer");
  const phoneEl = document.getElementById("contact");
  const emailEl = document.getElementById("customerEmail");
  const addrEl = document.getElementById("address");

  const name = String((nameEl && nameEl.value) || "").trim();
  const phone = String((phoneEl && phoneEl.value) || "").trim();
  const email = extractFirstEmail((emailEl && emailEl.value) || "");
  const address = String((addrEl && addrEl.value) || "").trim();

  if (!name) return alert("Customer name is required.");

  const list = getSavedCustomersListSafe();
  const key = name.toLowerCase();
  const idx = list.findIndex(c => String(c && c.name || "").trim().toLowerCase() === key);

  const record = { name, phone, email, address };
  if (idx >= 0) list[idx] = record;
  else list.push(record);

  setSavedCustomersListSafe(list);
  refreshSavedCustomersDropdown();

  const sel = document.getElementById("savedCustomers");
  if (sel) sel.value = String(idx >= 0 ? idx : list.length - 1);

  alert("Customer saved.");
}

window.saveCurrentCustomer = saveCurrentCustomer;
window.loadSavedCustomer = loadSavedCustomer;
window.refreshSavedCustomersDropdown = refreshSavedCustomersDropdown;

// Track current form mode: 'invoice' or 'quote'
let currentFormMode = null;

function showInvoiceForm() {
  currentFormMode = 'invoice';
  document.getElementById('appContainer').style.display = '';
  document.querySelector('.dashboard-main').style.display = 'none';
  // Optionally update form title/fields for invoice
}

function showQuoteForm() {
  currentFormMode = 'quote';
  document.getElementById('appContainer').style.display = '';
  document.querySelector('.dashboard-main').style.display = 'none';
  // Optionally update form title/fields for quote
}

window.showInvoiceForm = showInvoiceForm;
window.showQuoteForm = showQuoteForm;

function showDashboard() {
  document.getElementById('appContainer').style.display = 'none';
  document.querySelector('.dashboard-main').style.display = '';
}

window.showDashboard = showDashboard;
