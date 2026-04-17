function calculateTotals(items, taxPercent, amountPaid) {
  const safeItems = (items || []).filter(function(item) {
    return item && (item.name || item.price);
  });

  const subtotal = safeItems.reduce(function(sum, item) {
    const qty = Number(item.qty) || 1;
    const price = Number(item.price) || 0;
    return sum + (price * qty);
  }, 0);

  const tax = subtotal * ((Number(taxPercent) || 0) / 100);
  const total = subtotal + tax;
  const paid = Math.max(0, Math.min(Number(amountPaid) || 0, total));
  const balance = total - paid;

  return { subtotal: subtotal, tax: tax, total: total, paid: paid, balance: balance };
}

function getInvoiceStatus(data) {
  const totals = calculateTotals(data.items || [], data.taxPercent || 0, data.amountPaid || 0);

  if (totals.paid >= totals.total && totals.total > 0) {
    return "paid";
  }
  if (totals.paid > 0 && totals.paid < totals.total) {
    return "partial";
  }
  if (data.dueDate) {
    const dueDate = new Date(data.dueDate);
    const today = new Date();
    if (dueDate < today) {
      return "overdue";
    }
  }
  return "unpaid";
}
