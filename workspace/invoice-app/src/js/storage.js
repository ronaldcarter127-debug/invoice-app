// This file handles local storage operations, including saving and retrieving invoices and quotes from the browser's local storage.

function saveToLocalStorage(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
}

function getFromLocalStorage(key) {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
}

function removeFromLocalStorage(key) {
    localStorage.removeItem(key);
}

function clearLocalStorage() {
    localStorage.clear();
}

function getSavedInvoices() {
    return getFromLocalStorage('invoiceHistory') || [];
}

function saveInvoice(invoice) {
    const invoices = getSavedInvoices();
    invoices.push(invoice);
    saveToLocalStorage('invoiceHistory', invoices);
}

function getSavedQuotes() {
    return getFromLocalStorage('quoteHistory') || [];
}

function saveQuote(quote) {
    const quotes = getSavedQuotes();
    quotes.push(quote);
    saveToLocalStorage('quoteHistory', quotes);
}