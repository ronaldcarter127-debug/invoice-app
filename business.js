function updateLogoSize() {
  const size = getVal("logoSize");
  $id("logoSizeValue").textContent = size + "px";
  updateLogoPreview(localStorage.getItem("businessLogo"));
  saveBusinessInfo();
}

function updateLogoCrop() {
  updateLogoPreview(localStorage.getItem("businessLogo"));
  saveBusinessInfo();
}

function handleLogoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const logoData = e.target.result;
    localStorage.setItem("businessLogo", logoData);
    updateLogoPreview(logoData);
    saveBusinessInfo();
  };
  reader.readAsDataURL(file);
}

function saveBusinessInfo() {
  const businessInfo = {
    name: getVal("businessName"),
    address: getVal("businessAddress"),
    phone: getVal("businessPhone"),
    email: getVal("businessEmail"),
    stripeUrl: getVal("businessStripeUrl"),
    license: getVal("businessLicense"),
    signatureName: getVal("businessSignatureName"),
    logo: localStorage.getItem("businessLogo"),
    logoSize: getVal("logoSize"),
    logoCrop: getVal("logoCrop")
  };
  saveBusinessInfoToStorage(businessInfo);
}

function loadBusinessInfo() {
  const businessInfo = getBusinessInfo();
  if (!businessInfo) return;

  setVal("businessName", businessInfo.name || "Your Business Name");
  setVal("businessAddress", businessInfo.address || "123 Main St, Murfreesboro, TN");
  setVal("businessPhone", businessInfo.phone || "615-XXX-XXXX");
  setVal("businessEmail", businessInfo.email || "you@email.com");
  setVal("businessStripeUrl", businessInfo.stripeUrl || "");
  setVal("businessLicense", businessInfo.license || "");
  setVal("businessSignatureName", businessInfo.signatureName || "");
  setVal("logoSize", businessInfo.logoSize || 50);
  $id("logoSizeValue").textContent = (businessInfo.logoSize || 50) + "px";
  setVal("logoCrop", businessInfo.logoCrop || "center");

  if (businessInfo.logo) {
    localStorage.setItem("businessLogo", businessInfo.logo);
    updateLogoPreview(businessInfo.logo);
  }
}

function loadSavedCustomers() {
  const customers = getSavedCustomers();
  const select = document.getElementById("savedCustomers");
  select.innerHTML = '<option value="">Select Saved Customer</option>';
  customers.forEach(function(customer) {
    const option = document.createElement("option");
    option.value = customer.name;
    option.textContent = customer.name;
    select.appendChild(option);
  });
}

function saveCurrentCustomer() {
  const name = getVal("customer");
  const contact = getVal("contact");
  const address = getVal("address");

  if (!name) {
    alert("Customer name is required to save.");
    return;
  }

  const customers = getSavedCustomers();
  const existingIndex = customers.findIndex(function(c) { return c.name === name; });
  const customer = { name: name, contact: contact, address: address };

  if (existingIndex >= 0) {
    customers[existingIndex] = customer;
  } else {
    customers.push(customer);
  }

  writeJson("savedCustomers", customers);
  loadSavedCustomers();
  alert("Customer saved!");
}

function loadSavedCustomer() {
  const selectedName = getVal("savedCustomers");
  if (!selectedName) return;

  const customer = getSavedCustomers().find(function(c) {
    return c.name === selectedName;
  });

  if (!customer) return;
  setVal("customer", customer.name);
  setVal("contact", customer.contact || "");
  setVal("address", customer.address || "");
}
