const App = {
  items: [],
  premium: false,
  invoiceLocked: false,
  activeInvoiceNumber: "",
  activeQuoteNumber: "" // ✅ track current quote
};

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

window.onload = function() {
  App.premium = localStorage.getItem("isPremium") === "true" || localStorage.getItem("premium") === "true";
  checkPaymentReturn();
  addItem();
  setInvoiceEditingLocked(false, "");
  updateLiveTotals();

  // loadSavedCustomers(); // ❌ remove
  refreshSavedCustomersDropdown(); // ✅ use the function you actually expose

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
  window.loadSavedCustomers = refreshSavedCustomersDropdown; // ✅ compatibility alias

  document.addEventListener("DOMContentLoaded", refreshSavedCustomersDropdown);
})();
