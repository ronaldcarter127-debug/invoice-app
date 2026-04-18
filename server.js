require("dotenv").config();

const express = require("express");
const Stripe = require("stripe");
const cors = require("cors");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const APP_BASE_URL = (process.env.APP_BASE_URL || "http://127.0.0.1:5500").replace(/\/+$/, "");
const CORS_ORIGIN = (process.env.CORS_ORIGIN || APP_BASE_URL).replace(/\/+$/, "");
const API_BASE_URL = (process.env.API_BASE_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");

// ✅ define before app.use(cors)
const ALLOWED_ORIGINS = [
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  process.env.FRONTEND_URL,
  process.env.CORS_ORIGIN
].filter(Boolean);

// --- hardening helpers ---
function toAmount(value) {
  if (value === null || value === undefined) return 0;
  const n = Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function cleanText(value, max = 500) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function requiredEnv(name) {
  if (!process.env[name] || !String(process.env[name]).trim()) {
    throw new Error(`Missing required env: ${name}`);
  }
}

// ⚠️ Webhook must use raw body — before express.json()
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.log("Webhook error:", err.message);
    return res.status(400).send("Webhook Error: " + err.message);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const invoiceNumber = String((session.metadata && session.metadata.invoiceNumber) || "").trim();

    if (invoiceNumber) {
      await Invoice.updateOne(
        { invoiceNumber: invoiceNumber },
        {
          $set: {
            invoiceNumber: invoiceNumber,
            status: "Paid",
            amountPaid: Number((session.amount_total || 0) / 100),
            balanceDue: 0,
            paidAt: new Date()
          }
        },
        { upsert: true }
      ).catch(function (e) {
        console.log("Webhook DB update failed:", e.message);
      });

      console.log("✅ Payment received for Invoice #" + invoiceNumber);
    }
  }

  res.json({ received: true });
});

app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: function (origin, cb) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS: " + origin));
  }
}));
app.use(express.json({ limit: "2mb" }));

app.get("/health", function (_req, res) {
  const vars = ["EMAIL", "EMAIL_PASS", "MONGO_URI", "STRIPE_SECRET_KEY", "APP_BASE_URL", "FRONTEND_URL", "CORS_ORIGIN"];
  const status = {};
  vars.forEach(function (k) {
    status[k] = process.env[k] ? "✅ set" : "❌ missing";
  });
  res.status(200).json({ ok: true, env: status });
});

// 🔥 CONNECT DATABASE
if (process.env.MONGO_URI) {
  mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("MongoDB Connected"))
    .catch(err => console.log("MongoDB error:", err.message));
}

// 📦 SCHEMA
const Invoice = mongoose.model("Invoice", {
  invoiceNumber: { type: String, index: true, unique: true, sparse: true },
  email: String,
  customer: String,
  total: Number,
  items: Array,
  status: { type: String, default: "Unpaid" },
  amountPaid: { type: Number, default: 0 },
  balanceDue: { type: Number, default: 0 },
  paidAt: Date,
  created: { type: Date, default: Date.now }
});

// ✅ missing model
const Quote = mongoose.model("Quote", {
  quoteNumber: { type: String, index: true, unique: true, sparse: true },
  email: String,
  customer: String,
  businessName: String,
  date: String,
  dueDate: String,
  notes: String,
  total: Number,
  taxAmount: Number,
  finalTotal: Number,
  balanceDue: Number,
  items: Array,
  status: { type: String, default: "Pending" },
  acceptedAt: Date,
  created: { type: Date, default: Date.now }
});

// 💳 STRIPE
app.post("/create-checkout-session", async (req, res) => {
  try {
    const body = req.body || {};
    const amount = Math.round(toAmount(body.amount));
    if (!Number.isInteger(amount) || amount <= 0) {
      return res.status(400).json({ error: "Invalid invoice amount." });
    }

    const invoiceNumber = cleanText(body.invoiceNumber, 80);
    const customer = cleanText(body.customer, 120);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: amount,
          product_data: {
            name: invoiceNumber ? "Invoice #" + invoiceNumber : "Invoice Payment",
            description: customer ? "Customer: " + customer : "JobFlow Pro invoice payment"
          }
        }
      }],
      metadata: { invoiceNumber, customer },
      success_url: `${APP_BASE_URL}/paid.html?invoice=${encodeURIComponent(invoiceNumber)}`,
      cancel_url: `${APP_BASE_URL}/payment-cancelled.html?invoice=${encodeURIComponent(invoiceNumber)}`
    });

    return res.json({ url: session.url });
  } catch (error) {
    console.error("create-checkout-session error:", error.message);
    return res.status(500).json({ error: "Stripe checkout failed." });
  }
});

// � PREMIUM UPGRADE CHECKOUT
app.post("/create-premium-checkout", async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: Number(process.env.PREMIUM_PRICE_CENTS) || 999,
          product_data: {
            name: "JobFlow Pro — Premium Upgrade",
            description: "Unlock full invoice/quote history and premium features."
          }
        }
      }],
      success_url: `${APP_BASE_URL}/success.html`,
      cancel_url: `${APP_BASE_URL}/invoice.html`
    });
    return res.json({ url: session.url });
  } catch (error) {
    console.error("create-premium-checkout error:", error.message);
    return res.status(500).json({ error: "Premium checkout failed." });
  }
});

// �💾 SAVE INVOICE (upsert by invoiceNumber)
app.post("/save-invoice", async (req, res) => {
  try {
    const body = req.body || {};
    const invoiceNumber = String(body.invoiceNumber || "").trim();

    if (!invoiceNumber) {
      return res.status(400).json({ success: false, error: "invoiceNumber is required." });
    }

    await Invoice.updateOne(
      { invoiceNumber: invoiceNumber },
      { $set: body, $setOnInsert: { created: new Date() } },
      { upsert: true }
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 🔎 PAYMENT STATUS (frontend can poll this)
app.get("/payment-status/:invoiceNumber", async (req, res) => {
  try {
    const invoiceNumber = String(req.params.invoiceNumber || "").trim();
    const invoice = await Invoice.findOne({ invoiceNumber: invoiceNumber }).lean();

    if (!invoice) return res.json({ found: false, paid: false });

    res.json({
      found: true,
      paid: String(invoice.status || "").toLowerCase() === "paid",
      status: invoice.status || "Unpaid",
      paidAt: invoice.paidAt || null
    });
  } catch (error) {
    res.status(500).json({ found: false, paid: false, error: error.message });
  }
});

// 📤 SEND EMAIL
app.post("/send-email", async (req, res) => {
  try {
    requiredEnv("EMAIL");
    requiredEnv("EMAIL_PASS");

    const body = req.body || {};
    const to = cleanText(body.to, 254);
    if (!isEmail(to)) return res.status(400).json({ sent: false, error: "Invalid recipient email." });

    const invoiceNumber = cleanText(body.invoiceNumber, 80);
    const customer = cleanText(body.customer, 120);
    const date = cleanText(body.date, 40);
    const dueDate = cleanText(body.dueDate, 40);
    const notes = cleanText(body.notes, 2000);
    const businessName = cleanText(body.businessName || "JobFlow Pro", 120);

    const safeItems = Array.isArray(body.items) ? body.items : [];
    const itemRows = safeItems.map(function (it) {
      const name = cleanText(it && it.name, 120) || "Item";
      const qty = Math.max(1, Math.round(toAmount(it && it.qty)));
      const price = toAmount(it && it.price);
      const line = qty * price;
      return `<tr><td>${name}</td><td>${qty}</td><td>$${price.toFixed(2)}</td><td>$${line.toFixed(2)}</td></tr>`;
    }).join("");

    const itemsSubtotal = calcItemsSubtotal(safeItems);

    const total = toAmount(body.total) || itemsSubtotal;
    const taxAmount = toAmount(body.taxAmount);
    const finalTotal = toAmount(body.finalTotal) || (total + taxAmount);
    const amountPaid = toAmount(body.amountPaid); // ✅ add
    const balanceDue = toAmount(body.balanceDue) || Math.max(0, finalTotal - amountPaid); // ✅ fix fallback

    // robust amount fallback chain
    const baseAmount =
      balanceDue > 0 ? balanceDue :
      finalTotal > 0 ? finalTotal :
      total > 0 ? total :
      itemsSubtotal;

    const amountCents = Math.round(baseAmount * 100);
    let payUrl = "";

    if (amountCents > 0) {
      try {
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          mode: "payment",
          line_items: [{
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: amountCents,
              product_data: {
                name: invoiceNumber ? "Invoice #" + invoiceNumber : "Invoice Payment",
                description: customer ? "Customer: " + customer : "JobFlow Pro invoice payment"
              }
            }
          }],
          metadata: { invoiceNumber, customer },
          success_url: `${APP_BASE_URL}/paid.html?invoice=${encodeURIComponent(invoiceNumber)}`,
          cancel_url: `${APP_BASE_URL}/payment-cancelled.html?invoice=${encodeURIComponent(invoiceNumber)}`
        });
        payUrl = session.url || "";
      } catch (stripeErr) {
        console.warn("Stripe pay link skipped:", stripeErr.message);
      }
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: cleanText(process.env.EMAIL, 254),
        pass: String(process.env.EMAIL_PASS || "").replace(/\s+/g, "")
      }
    });

    const paySection = payUrl
      ? `<p><a href="${payUrl}" style="display:inline-block;padding:10px 16px;background:#16a34a;color:#fff;text-decoration:none;border-radius:6px;"><strong>Pay Now</strong></a></p><p><a href="${payUrl}">${payUrl}</a></p>`
      : "";

    const html = `
      <h2>${businessName} - Invoice ${invoiceNumber}</h2>
      <p><strong>Customer:</strong> ${customer}</p>
      <p><strong>Date:</strong> ${date}</p>
      <p><strong>Due Date:</strong> ${dueDate}</p>
      <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;">
        <thead><tr><th>Service</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
        <tbody>${itemRows || "<tr><td colspan='4'>No items</td></tr>"}</tbody>
      </table>
      <p><strong>Subtotal:</strong> $${total.toFixed(2)}</p>
      <p><strong>Tax:</strong> $${taxAmount.toFixed(2)}</p>
      <p><strong>Total:</strong> $${finalTotal.toFixed(2)}</p>
      <p><strong style="color:#16a34a;">Payments Received:</strong> <span style="color:#16a34a;">$${amountPaid.toFixed(2)}</span></p>
      <p><strong>Balance Due:</strong> $${balanceDue.toFixed(2)}</p>
      ${paySection}
      <p><strong>Notes:</strong> ${notes || "Payment due upon completion."}</p>
    `;

    const mailOptions = {
      from: `"JobFlow Pro" <${cleanText(process.env.EMAIL, 254)}>`,
      to,
      subject: `Invoice ${invoiceNumber}`.trim(),
      text: `Invoice ${invoiceNumber}\n` +
        `Customer: ${customer}\n` +
        `Subtotal: $${total.toFixed(2)}\n` +
        `Tax: $${taxAmount.toFixed(2)}\n` +
        `Total: $${finalTotal.toFixed(2)}\n` +
        `Payments Received: $${amountPaid.toFixed(2)}\n` +
        `Balance Due: $${balanceDue.toFixed(2)}`,
      html
    };

    const info = await transporter.sendMail(mailOptions);

    const accepted = Array.isArray(info.accepted) ? info.accepted : [];
    const rejected = Array.isArray(info.rejected) ? info.rejected : [];

    console.log("mail result:", {
      route: req.path,
      messageId: info.messageId || "",
      accepted,
      rejected,
      response: info.response || ""
    });

    if (accepted.length === 0) {
      return res.status(502).json({
        sent: false,
        error: "SMTP did not accept recipient.",
        accepted,
        rejected,
        response: info.response || ""
      });
    }

    return res.json({
      sent: true,
      accepted,
      rejected,
      messageId: info.messageId || "",
      response: info.response || ""
    });
  } catch (error) {
    console.error("send-email error:", error.message);
    return res.status(500).json({ sent: false, error: error.message || "Email send failed." });
  }
});

// 📄 GET INVOICES
app.get("/invoices", async (req, res) => {
  try {
    const data = await Invoice.find().sort({ created: -1 });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save/Upsert quote
app.post("/save-quote", async (req, res) => {
  try {
    const body = req.body || {};
    const quoteNumber = cleanText(body.quoteNumber, 80);
    if (!quoteNumber) {
      return res.status(400).json({ success: false, error: "quoteNumber is required." });
    }

    const items = Array.isArray(body.items) ? body.items : [];
    const total = toAmount(body.total) || calcItemsSubtotal(items);
    const taxAmount = toAmount(body.taxAmount);
    const finalTotal = toAmount(body.finalTotal) || (total + taxAmount);
    const amountPaid = toAmount(body.amountPaid); // ✅ add
    const balanceDue = toAmount(body.balanceDue) || Math.max(0, finalTotal - amountPaid); // ✅ add

    await Quote.updateOne(
      { quoteNumber },
      {
        $set: {
          quoteNumber,
          email: cleanText(body.to || body.email, 254),
          customer: cleanText(body.customer, 120),
          businessName: cleanText(body.businessName || "JobFlow Pro", 120),
          date: cleanText(body.date, 40),
          dueDate: cleanText(body.dueDate, 40),
          notes: cleanText(body.notes, 2000),
          items,
          total,
          taxAmount,
          finalTotal,
          balanceDue,
          status: cleanText(body.status || "Pending", 40)
        },
        $setOnInsert: { created: new Date() }
      },
      { upsert: true }
    );

    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// Quote status for app sync
app.get("/quote-status/:quoteNumber", async (req, res) => {
  try {
    const quoteNumber = cleanText(req.params.quoteNumber, 80);
    const q = await Quote.findOne({ quoteNumber }).lean();
    if (!q) return res.json({ found: false, accepted: false, status: "Pending" });
    return res.json({
      found: true,
      accepted: String(q.status || "").toLowerCase() === "accepted",
      status: q.status || "Pending",
      acceptedAt: q.acceptedAt || null
    });
  } catch (e) {
    return res.status(500).json({ found: false, accepted: false, error: e.message });
  }
});

// Accept quote (clicked from email)
app.get("/accept-quote/:quoteNumber", async (req, res) => {
  try {
    const quoteNumber = cleanText(req.params.quoteNumber, 80);
    if (!quoteNumber) return res.status(400).send("Missing quote number.");

    await Quote.updateOne(
      { quoteNumber },
      { $set: { status: "Accepted", acceptedAt: new Date() } },
      { upsert: false }
    );

    return res.redirect(`${APP_BASE_URL}/quote-accepted.html?quote=${encodeURIComponent(quoteNumber)}`);
  } catch (e) {
    return res.status(500).send("Unable to accept quote.");
  }
});

// Send quote email with Accept button
app.post("/send-quote-email", async (req, res) => {
  try {
    requiredEnv("EMAIL");
    requiredEnv("EMAIL_PASS");

    const body = req.body || {};
    const to = cleanText(body.to, 254);
    if (!isEmail(to)) {
      return res.status(400).json({ sent: false, error: "Invalid recipient email." });
    }

    const quoteNumber = cleanText(body.quoteNumber, 80);
    const customer = cleanText(body.customer, 120);
    const businessName = cleanText(body.businessName || "JobFlow Pro", 120);
    const date = cleanText(body.date, 40) || new Date().toLocaleDateString();
    const notes = cleanText(body.notes, 2000);

    const items = Array.isArray(body.items) ? body.items : [];
    const total = toAmount(body.total) || calcItemsSubtotal(items);
    const taxAmount = toAmount(body.taxAmount);
    const finalTotal = toAmount(body.finalTotal) || (total + taxAmount);
    const amountPaid = toAmount(body.amountPaid); // ✅ add
    const balanceDue = toAmount(body.balanceDue) || Math.max(0, finalTotal - amountPaid); // ✅ add

    if (!quoteNumber) {
      return res.status(400).json({ sent: false, error: "quoteNumber is required." });
    }

    await Quote.updateOne(
      { quoteNumber },
      {
        $set: {
          quoteNumber,
          email: to,
          customer,
          businessName,
          date,
          notes,
          items,
          total,
          taxAmount,
          finalTotal,
          balanceDue,
          status: "Pending"
        },
        $setOnInsert: { created: new Date() }
      },
      { upsert: true }
    );

    const acceptUrl = `${API_BASE_URL}/accept-quote/${encodeURIComponent(quoteNumber)}`;

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: cleanText(process.env.EMAIL, 254),
        pass: String(process.env.EMAIL_PASS || "").replace(/\s+/g, "")
      }
    });

    const quoteRows = items.map(function (it) {
      const name = cleanText(it && it.name, 120) || "Item";
      const qty = Math.max(1, Math.round(toAmount(it && it.qty)));
      const price = toAmount(it && it.price);
      const line = qty * price;

      return `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">${name}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${qty}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">$${price.toFixed(2)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">$${line.toFixed(2)}</td>
        </tr>
      `;
    }).join("");

    await transporter.sendMail({
      from: cleanText(process.env.EMAIL, 254),
      to,
      subject: `Quote ${quoteNumber}`,
      text:
        `Quote ${quoteNumber}\n` +
        `Business: ${businessName}\n` +
        `Customer: ${customer}\n` +
        `Subtotal: $${total.toFixed(2)}\n` +
        `Tax: $${taxAmount.toFixed(2)}\n` +
        `Total: $${finalTotal.toFixed(2)}\n` +
        `Accept Quote: ${acceptUrl}`,
      html: `
        <div style="margin:0;padding:0;background:#f3f4f6;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;margin:0;padding:24px 0;">
            <tr>
              <td align="center">
                <table role="presentation" width="680" cellpadding="0" cellspacing="0" border="0" style="width:680px;max-width:680px;background:#ffffff;border-radius:14px;overflow:hidden;font-family:Arial,sans-serif;color:#111827;">
                  <tr>
                    <td style="background:#111827;padding:24px 28px;">
                      <div style="font-size:28px;font-weight:700;color:#ffffff;">Quote ${quoteNumber}</div>
                      <div style="font-size:14px;color:#d1d5db;margin-top:6px;">${businessName}</div>
                    </td>
                  </tr>

                  <tr>
                    <td style="padding:24px 28px 10px 28px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td style="font-size:14px;color:#6b7280;padding-bottom:6px;">Customer</td>
                          <td style="font-size:14px;color:#6b7280;padding-bottom:6px;">Quote Date</td>
                        </tr>
                        <tr>
                          <td style="font-size:16px;font-weight:600;padding-bottom:18px;">${customer || "-"}</td>
                          <td style="font-size:16px;font-weight:600;padding-bottom:18px;">${date}</td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <tr>
                    <td style="padding:0 28px 8px 28px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
                        <thead>
                          <tr style="background:#f9fafb;">
                            <th style="padding:12px;text-align:left;font-size:13px;color:#374151;border-bottom:1px solid #e5e7eb;">Item</th>
                            <th style="padding:12px;text-align:center;font-size:13px;color:#374151;border-bottom:1px solid #e5e7eb;">Qty</th>
                            <th style="padding:12px;text-align:right;font-size:13px;color:#374151;border-bottom:1px solid #e5e7eb;">Price</th>
                            <th style="padding:12px;text-align:right;font-size:13px;color:#374151;border-bottom:1px solid #e5e7eb;">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${quoteRows || `<tr><td colspan="4" style="padding:14px;text-align:center;color:#6b7280;">No items listed</td></tr>`}
                        </tbody>
                      </table>
                    </td>
                  </tr>

                  <tr>
                    <td style="padding:8px 28px 0 28px;">
                      <table role="presentation" align="right" cellpadding="0" cellspacing="0" border="0" style="width:260px;">
                        <tr>
                          <td style="padding:6px 0;font-size:14px;color:#6b7280;">Subtotal</td>
                          <td style="padding:6px 0;font-size:14px;color:#111827;text-align:right;">$${total.toFixed(2)}</td>
                        </tr>
                        <tr>
                          <td style="padding:6px 0;font-size:14px;color:#6b7280;">Tax</td>
                          <td style="padding:6px 0;font-size:14px;color:#111827;text-align:right;">$${taxAmount.toFixed(2)}</td>
                        </tr>
                        <tr>
                          <td style="padding:6px 0;font-size:14px;font-weight:700;color:#111827;">Total</td>
                          <td style="padding:6px 0;font-size:14px;font-weight:700;color:#111827;text-align:right;">$${finalTotal.toFixed(2)}</td>
                        </tr>
                        <tr>
                          <td colspan="2" style="padding:8px 0 0 0;">
                            <div style="border-top:2px solid #00e676;"></div>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding:8px 0 0 0;font-size:14px;font-weight:700;color:#00e676;">Payments Received</td>
                          <td style="padding:8px 0 0 0;font-size:14px;font-weight:700;color:#00e676;text-align:right;">$${amountPaid.toFixed(2)}</td>
                        </tr>
                        <tr>
                          <td style="padding:6px 0;font-size:14px;font-weight:700;color:#111827;">Balance Due</td>
                          <td style="padding:6px 0;font-size:14px;font-weight:700;color:#111827;text-align:right;">$${balanceDue.toFixed(2)}</td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <tr>
                    <td style="padding:28px;" align="center">
                      <a href="${acceptUrl}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;padding:14px 24px;border-radius:10px;">
                        Accept Quote
                      </a>
                      <div style="font-size:12px;color:#6b7280;margin-top:14px;">
                        If the button does not work, use this link:<br>
                        <a href="${acceptUrl}" style="color:#2563eb;word-break:break-all;">${acceptUrl}</a>
                      </div>
                    </td>
                  </tr>

                  <tr>
                    <td style="padding:0 28px 28px 28px;font-size:13px;line-height:1.6;color:#6b7280;">
                      ${notes || "Thank you for the opportunity. If you approve this quote, click the button above and it will update in the app."}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </div>
      `
    });

    return res.json({ sent: true });
  } catch (e) {
    console.error("send-quote-email error:", e.message);
    return res.status(500).json({ sent: false, error: e.message || "Quote email failed." });
  }
});

// startup env checks
try {
  requiredEnv("STRIPE_SECRET_KEY");
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

function calcItemsSubtotal(items) {
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, it) => {
    const qty = Math.max(1, Math.round(toAmount(it && it.qty)));
    const price = toAmount(it && it.price);
    return sum + qty * price;
  }, 0);
}

// ✅ IMPORTANT: do NOT define itemRows globally.
// itemRows must stay inside /send-email where safeItems exists.

// start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});

// startup checks AFTER listen
try {
  requiredEnv("STRIPE_SECRET_KEY");
  requiredEnv("EMAIL");
  requiredEnv("EMAIL_PASS");
  requiredEnv("MONGO_URI");
} catch (e) {
  console.error("⚠️ Missing env var:", e.message);
  // do not process.exit in production — log and continue
}