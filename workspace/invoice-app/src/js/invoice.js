// This file contains functions related to creating and managing invoices. 
// It includes logic for calculating totals, saving invoices, and rendering invoice previews.

window.onload = function() {
    loadInvoices();
    document.getElementById("createInvoiceBtn").addEventListener("click", createInvoice);
};

function createInvoice() {
    const invoiceData = getInvoiceData();
    if (validateInvoiceData(invoiceData)) {
        saveInvoice(invoiceData);
        renderInvoicePreview(invoiceData);
        resetInvoiceForm();
    } else {
        alert("Please fill in all required fields.");
    }
}

function getInvoiceData() {
    return {
        customerName: document.getElementById("customerName").value,
        customerAddress: document.getElementById("customerAddress").value,
        items: getInvoiceItems(),
        total: calculateTotal(),
        date: new Date().toLocaleDateString(),
        dueDate: document.getElementById("dueDate").value,
        notes: document.getElementById("notes").value
    };
}

function getInvoiceItems() {
    const items = [];
    const itemRows = document.querySelectorAll(".item-row");
    itemRows.forEach(row => {
        const service = row.querySelector(".service").value;
        const qty = parseFloat(row.querySelector(".qty").value) || 0;
        const price = parseFloat(row.querySelector(".price").value) || 0;
        if (service && qty > 0 && price > 0) {
            items.push({ service, qty, price });
        }
    });
    return items;
}

function calculateTotal() {
    const items = getInvoiceItems();
    return items.reduce((total, item) => total + (item.qty * item.price), 0).toFixed(2);
}

function validateInvoiceData(data) {
    return data.customerName && data.customerAddress && data.items.length > 0;
}

function saveInvoice(invoiceData) {
    const invoices = JSON.parse(localStorage.getItem("invoices")) || [];
    invoices.push(invoiceData);
    localStorage.setItem("invoices", JSON.stringify(invoices));
}

function renderInvoicePreview(invoiceData) {
    const previewArea = document.getElementById("invoicePreview");
    previewArea.innerHTML = `
        <h2>Invoice Preview</h2>
        <p><strong>Customer:</strong> ${invoiceData.customerName}</p>
        <p><strong>Address:</strong> ${invoiceData.customerAddress}</p>
        <p><strong>Date:</strong> ${invoiceData.date}</p>
        <p><strong>Due Date:</strong> ${invoiceData.dueDate}</p>
        <h3>Items:</h3>
        <ul>
            ${invoiceData.items.map(item => `<li>${item.service} - Qty: ${item.qty}, Price: $${item.price.toFixed(2)}</li>`).join('')}
        </ul>
        <h3>Total: $${invoiceData.total}</h3>
        <p><strong>Notes:</strong> ${invoiceData.notes}</p>
    `;
}

function resetInvoiceForm() {
    document.getElementById("customerName").value = "";
    document.getElementById("customerAddress").value = "";
    document.getElementById("dueDate").value = "";
    document.getElementById("notes").value = "";
    document.querySelectorAll(".item-row").forEach(row => row.remove());
    addItemRow();
}

function loadInvoices() {
    const invoices = JSON.parse(localStorage.getItem("invoices")) || [];
    // Logic to display saved invoices can be added here
}

function addItemRow() {
    const itemRow = document.createElement("div");
    itemRow.className = "item-row";
    itemRow.innerHTML = `
        <input type="text" class="service" placeholder="Service" required>
        <input type="number" class="qty" placeholder="Qty" min="1" required>
        <input type="number" class="price" placeholder="Price" min="0" step="0.01" required>
        <button onclick="removeItemRow(this)">Remove</button>
    `;
    document.getElementById("itemsContainer").appendChild(itemRow);
}

function removeItemRow(button) {
    button.parentElement.remove();
}