require("dotenv").config();

const express = require("express");
const Stripe = require("stripe");
const cors = require("cors");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
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

function requiredOneOfEnv(names) {
  const ok = names.some(function (name) {
    return process.env[name] && String(process.env[name]).trim();
  });
  if (!ok) {
    throw new Error(`Missing required env: one of ${names.join(" or ")}`);
  }
}

function getEmailPassword() {
  return String(process.env.EMAIL_PASS || process.env.EMAIL_PASSWORD || "").replace(/\s+/g, "");
}

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(function () {
        reject(new Error(message || "Operation timed out."));
      }, Number(timeoutMs) || 1000);
    })
  ]);
}

function isMongoReady() {
  return mongoose && mongoose.connection && mongoose.connection.readyState === 1;
}

function requireMongoReady() {
  if (!isMongoReady()) {
    throw new Error("Database is not connected. Please try again in a moment.");
  }
}

function applyPaymentToInvoiceDoc(existing, paymentAmount, paidAt) {
  const prevPaid = toAmount(existing && existing.amountPaid);
  const finalTotal = toAmount((existing && (existing.finalTotal || existing.total)) || 0);
  const paidNow = Math.max(0, toAmount(paymentAmount));

  let nextAmountPaid = prevPaid + paidNow;
  if (finalTotal > 0) {
    nextAmountPaid = Math.min(nextAmountPaid, finalTotal);
  }

  let nextBalanceDue = 0;
  if (finalTotal > 0) {
    nextBalanceDue = Math.max(0, finalTotal - nextAmountPaid);
  } else {
    nextBalanceDue = Math.max(0, toAmount(existing && existing.balanceDue) - paidNow);
  }

  const nextStatus = nextBalanceDue <= 0 ? "Paid" : "Partial";

  return {
    amountPaid: nextAmountPaid,
    balanceDue: nextBalanceDue,
    status: nextStatus,
    paidAt: paidAt || new Date()
  };
}

const transientQuoteStatus = new Map();
let mongoConnectInFlight = false;
let lastMongoError = "";

function setTransientQuoteStatus(quoteNumber, status, acceptedAt) {
  const key = cleanText(quoteNumber, 80);
  if (!key) return;
  transientQuoteStatus.set(key, {
    status: cleanText(status || "Pending", 40),
    acceptedAt: acceptedAt || null,
    expiresAt: Date.now() + (24 * 60 * 60 * 1000)
  });
}

function getTransientQuoteStatus(quoteNumber) {
  const key = cleanText(quoteNumber, 80);
  if (!key) return null;
  const value = transientQuoteStatus.get(key);
  if (!value) return null;
  if (Number(value.expiresAt || 0) <= Date.now()) {
    transientQuoteStatus.delete(key);
    return null;
  }
  return value;
}

function quoteSemanticKey(quote) {
  const q = quote || {};
  const items = Array.isArray(q.items) ? q.items : [];
  const itemKey = items.map(function (it) {
    const name = cleanText(it && it.name, 120).toLowerCase();
    const qty = Math.max(0, Number(it && it.qty || 0) || 0);
    const price = toAmount(it && it.price);
    return name + "|" + qty + "|" + price.toFixed(2);
  }).join(";");

  return [
    cleanText(q.customer, 120).toLowerCase(),
    toAmount(q.total).toFixed(2),
    toAmount(q.taxAmount).toFixed(2),
    toAmount(q.finalTotal).toFixed(2),
    toAmount(q.amountPaid).toFixed(2),
    toAmount(q.balanceDue).toFixed(2),
    cleanText(q.notes, 400).toLowerCase(),
    itemKey
  ].join("||");
}

function choosePreferredQuoteDoc(a, b) {
  if (!a) return b;
  if (!b) return a;

  const aAccepted = String(a.status || "").toLowerCase() === "accepted";
  const bAccepted = String(b.status || "").toLowerCase() === "accepted";
  if (aAccepted !== bAccepted) return bAccepted ? b : a;

  const aAcceptedAt = new Date(a.acceptedAt || 0).getTime() || 0;
  const bAcceptedAt = new Date(b.acceptedAt || 0).getTime() || 0;
  if (aAcceptedAt !== bAcceptedAt) return bAcceptedAt > aAcceptedAt ? b : a;

  const aCreated = new Date(a.created || 0).getTime() || 0;
  const bCreated = new Date(b.created || 0).getTime() || 0;
  if (aCreated !== bCreated) return bCreated > aCreated ? b : a;

  return String(b.quoteNumber || "") > String(a.quoteNumber || "") ? b : a;
}

function makeSalt() {
  return crypto.randomBytes(16).toString("hex");
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(String(password || ""), String(salt || ""), 120000, 64, "sha512").toString("hex");
}

function makeSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function getBearerToken(req) {
  const auth = String((req.headers && req.headers.authorization) || "").trim();
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? String(m[1] || "").trim() : "";
}

async function createSession(userId) {
  const raw = makeSessionToken();
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000));
  await Session.create({ userId, tokenHash, expiresAt });
  return raw;
}

async function getSessionUser(req) {
  const rawToken = getBearerToken(req);
  if (!rawToken) return null;

  const tokenHash = hashToken(rawToken);
  const session = await withTimeout(
    Session.findOne({ tokenHash, expiresAt: { $gt: new Date() } }).lean(),
    1500,
    "Session lookup timed out."
  );
  if (!session) return null;

  const user = await withTimeout(
    User.findById(session.userId).lean(),
    1500,
    "User lookup timed out."
  );
  if (!user) return null;

  return { user, session, rawToken };
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
    const metadata = (session && session.metadata) || {};
    const checkoutType = String(metadata.checkoutType || "").trim().toLowerCase();
    const premiumUserId = String(metadata.userId || "").trim();

    if (checkoutType === "premium_upgrade" && premiumUserId) {
      await User.updateOne(
        { _id: premiumUserId },
        {
          $set: {
            isPremium: true,
            premiumSince: new Date(),
            premiumCheckoutSessionId: String(session.id || "")
          }
        }
      ).catch(function (e) {
        console.log("Webhook premium update failed:", e.message);
      });

      console.log("✅ Premium activated for user " + premiumUserId);
      return res.json({ received: true });
    }

    const invoiceNumber = String((session.metadata && session.metadata.invoiceNumber) || "").trim();

    if (invoiceNumber) {
      const existingInvoice = await Invoice.findOne({ invoiceNumber: invoiceNumber }).lean().catch(function () { return null; });
      const paidCalc = applyPaymentToInvoiceDoc(existingInvoice, Number((session.amount_total || 0) / 100), new Date());

      await Invoice.updateOne(
        { invoiceNumber: invoiceNumber },
        {
          $set: {
            invoiceNumber: invoiceNumber,
            status: paidCalc.status,
            amountPaid: paidCalc.amountPaid,
            balanceDue: paidCalc.balanceDue,
            paidAt: paidCalc.paidAt
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
  const vars = ["EMAIL", "EMAIL_PASS", "EMAIL_PASSWORD", "MONGO_URI", "STRIPE_SECRET_KEY", "APP_BASE_URL", "FRONTEND_URL", "CORS_ORIGIN"];
  const status = {};
  vars.forEach(function (k) {
    status[k] = process.env[k] ? "✅ set" : "❌ missing";
  });
  status.EMAIL_AUTH = getEmailPassword() ? "✅ set" : "❌ missing (set EMAIL_PASS or EMAIL_PASSWORD)";
  status.MONGO_STATUS = isMongoReady() ? "✅ connected" : "❌ disconnected";
  status.MONGO_LAST_ERROR = lastMongoError || "";
  res.status(200).json({ ok: true, env: status });
});

// 🔥 CONNECT DATABASE
async function ensureMongoConnection() {
  if (!process.env.MONGO_URI || mongoConnectInFlight || isMongoReady()) return;
  mongoConnectInFlight = true;
  try {
    await mongoose.connect(process.env.MONGO_URI);
    lastMongoError = "";
    console.log("MongoDB Connected");
  } catch (err) {
    lastMongoError = String(err && err.message || "Unknown Mongo error");
    console.log("MongoDB error:", err.message);
  } finally {
    mongoConnectInFlight = false;
  }
}

if (process.env.MONGO_URI) {
  ensureMongoConnection();
  setInterval(function () {
    ensureMongoConnection();
  }, 15000);
}

// 📦 SCHEMA
const Invoice = mongoose.model("Invoice", {
  ownerId: { type: String, index: true },
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
  ownerId: { type: String, index: true },
  quoteNumber: { type: String, index: true, unique: true, sparse: true },
  email: String,
  customer: String,
  businessName: String,
  date: String,
  dueDate: String,
  notes: String,
  taxPercent: Number,
  total: Number,
  taxAmount: Number,
  finalTotal: Number,
  amountPaid: Number,
  balanceDue: Number,
  items: Array,
  status: { type: String, default: "Pending" },
  acceptedAt: Date,
  created: { type: Date, default: Date.now }
});

const User = mongoose.model("User", {
  email: { type: String, unique: true, index: true },
  passwordSalt: String,
  passwordHash: String,
  isPremium: { type: Boolean, default: false },
  premiumSince: Date,
  premiumCheckoutSessionId: String,
  created: { type: Date, default: Date.now }
});

const Session = mongoose.model("Session", {
  userId: { type: mongoose.Schema.Types.ObjectId, index: true },
  tokenHash: { type: String, unique: true, index: true },
  expiresAt: { type: Date, index: true },
  created: { type: Date, default: Date.now }
});

// 🔐 AUTH
app.post("/auth/signup", async (req, res) => {
  try {
    const email = cleanText((req.body || {}).email, 254).toLowerCase();
    const password = String((req.body || {}).password || "");

    if (!isEmail(email)) return res.status(400).json({ ok: false, error: "Valid email is required." });
    if (password.length < 8) return res.status(400).json({ ok: false, error: "Password must be at least 8 characters." });

    requireMongoReady();

    const existing = await withTimeout(
      User.findOne({ email }).lean(),
      1500,
      "Database lookup timed out. Please try again."
    );
    if (existing) return res.status(409).json({ ok: false, error: "Email already registered." });

    const salt = makeSalt();
    const passwordHash = hashPassword(password, salt);
    const user = await User.create({ email, passwordSalt: salt, passwordHash, isPremium: false });
    const token = await createSession(user._id);

    return res.json({
      ok: true,
      token,
      user: {
        id: String(user._id),
        email: user.email,
        isPremium: !!user.isPremium,
        premiumSince: user.premiumSince || null,
        plan: user.isPremium ? "Premium" : "Free",
        subscriptionStatus: user.isPremium ? "active" : "free"
      }
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || "Signup failed." });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const email = cleanText((req.body || {}).email, 254).toLowerCase();
    const password = String((req.body || {}).password || "");

    if (!isEmail(email) || !password) {
      return res.status(400).json({ ok: false, error: "Email and password are required." });
    }

    requireMongoReady();

    const user = await withTimeout(
      User.findOne({ email }).lean(),
      1500,
      "Database lookup timed out. Please try again."
    );
    if (!user) return res.status(401).json({ ok: false, error: "Invalid credentials." });

    const expectedHash = hashPassword(password, user.passwordSalt);
    if (expectedHash !== user.passwordHash) {
      return res.status(401).json({ ok: false, error: "Invalid credentials." });
    }

    const token = await createSession(user._id);
    return res.json({
      ok: true,
      token,
      user: {
        id: String(user._id),
        email: user.email,
        isPremium: !!user.isPremium,
        premiumSince: user.premiumSince || null,
        plan: user.isPremium ? "Premium" : "Free",
        subscriptionStatus: user.isPremium ? "active" : "free"
      }
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || "Login failed." });
  }
});

app.get("/auth/me", async (req, res) => {
  try {
    requireMongoReady();
    const auth = await getSessionUser(req);
    if (!auth) return res.status(401).json({ ok: false, error: "Unauthorized." });

    return res.json({
      ok: true,
      user: {
        id: String(auth.user._id),
        email: auth.user.email,
        isPremium: !!auth.user.isPremium,
        premiumSince: auth.user.premiumSince || null,
        premiumCheckoutSessionId: auth.user.premiumCheckoutSessionId || null,
        plan: auth.user.isPremium ? "Premium" : "Free",
        subscriptionStatus: auth.user.isPremium ? "active" : "free"
      }
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || "Auth check failed." });
  }
});

app.post("/auth/logout", async (req, res) => {
  try {
    const rawToken = getBearerToken(req);
    if (!rawToken) return res.json({ ok: true });

    await Session.deleteOne({ tokenHash: hashToken(rawToken) });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || "Logout failed." });
  }
});

// ✅ DIRECT PREMIUM ACTIVATION (for success page, handles webhook delays)
app.post("/activate-premium-direct", async (req, res) => {
  try {
    requireMongoReady();
    const auth = await getSessionUser(req);
    if (!auth) return res.status(401).json({ ok: false, error: "Unauthorized." });

    const userId = String(auth.user._id || "").trim();

    // Mark premium active immediately (webhook will confirm later)
    const updated = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          isPremium: true,
          premiumSince: new Date()
        }
      },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(500).json({ ok: false, error: "Failed to activate premium." });
    }

    console.log("✅ Premium activated directly for user " + userId);

    return res.json({
      ok: true,
      user: {
        id: String(updated._id),
        email: updated.email,
        isPremium: !!updated.isPremium,
        premiumSince: updated.premiumSince || null,
        plan: updated.isPremium ? "Premium" : "Free",
        subscriptionStatus: updated.isPremium ? "active" : "free"
      }
    });
  } catch (error) {
    console.error("activate-premium-direct error:", error.message);
    return res.status(500).json({ ok: false, error: error.message || "Premium activation failed." });
  }
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
      success_url: `${APP_BASE_URL}/paid.html?invoice=${encodeURIComponent(invoiceNumber)}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_BASE_URL}/payment-cancelled.html?invoice=${encodeURIComponent(invoiceNumber)}`
    });

    return res.json({ url: session.url });
  } catch (error) {
    console.error("create-checkout-session error:", error.message);
    return res.status(500).json({ error: "Stripe checkout failed." });
  }
});

app.post("/confirm-payment", async (req, res) => {
  try {
    const body = req.body || {};
    const sessionId = cleanText(body.sessionId, 200);
    const invoiceHint = cleanText(body.invoiceNumber, 80);

    if (!sessionId) {
      return res.status(400).json({ ok: false, error: "sessionId is required." });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const sessionStatus = String(session && session.payment_status || "").toLowerCase();
    const paid = sessionStatus === "paid";
    const invoiceNumber = cleanText((session && session.metadata && session.metadata.invoiceNumber) || invoiceHint, 80);

    if (!invoiceNumber) {
      return res.status(400).json({ ok: false, error: "invoiceNumber not found in checkout session." });
    }

    if (!paid) {
      return res.json({ ok: true, paid: false, invoiceNumber: invoiceNumber });
    }

    const paidAt = new Date();
    const existingInvoice = await Invoice.findOne({ invoiceNumber: invoiceNumber }).lean().catch(function () { return null; });
    const paidCalc = applyPaymentToInvoiceDoc(existingInvoice, Number((session.amount_total || 0) / 100), paidAt);

    await Invoice.updateOne(
      { invoiceNumber: invoiceNumber },
      {
        $set: {
          invoiceNumber: invoiceNumber,
          status: paidCalc.status,
          amountPaid: paidCalc.amountPaid,
          balanceDue: paidCalc.balanceDue,
          paidAt: paidCalc.paidAt
        }
      },
      { upsert: true }
    );

    return res.json({ ok: true, paid: true, invoiceNumber: invoiceNumber, paidAt: paidAt });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Unable to confirm payment." });
  }
});

// � PREMIUM UPGRADE CHECKOUT
app.post("/create-premium-checkout", async (req, res) => {
  try {
    requireMongoReady();
    const auth = await getSessionUser(req);
    if (!auth) return res.status(401).json({ error: "Unauthorized." });
    if (auth.user && auth.user.isPremium) {
      return res.status(409).json({ error: "Premium is already active on this account." });
    }

    const userId = String(auth.user._id || "").trim();
    const userEmail = cleanText(auth.user.email, 254);

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
      customer_email: userEmail,
      metadata: {
        checkoutType: "premium_upgrade",
        userId: userId,
        userEmail: userEmail
      },
      success_url: `${APP_BASE_URL}/success.html?upgrade=success`,
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
    requireMongoReady();
    const auth = await getSessionUser(req);
    if (!auth) return res.status(401).json({ success: false, error: "Unauthorized." });

    const body = req.body || {};
    const invoiceNumber = String(body.invoiceNumber || "").trim();

    if (!invoiceNumber) {
      return res.status(400).json({ success: false, error: "invoiceNumber is required." });
    }

    const ownerId = String(auth.user._id || "").trim();

    await Invoice.updateOne(
      { invoiceNumber: invoiceNumber },
      {
        $set: Object.assign({}, body, { ownerId: ownerId }),
        $setOnInsert: { created: new Date() }
      },
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
      paidAt: invoice.paidAt || null,
      amountPaid: toAmount(invoice.amountPaid),
      balanceDue: toAmount(invoice.balanceDue)
    });
  } catch (error) {
    res.status(500).json({ found: false, paid: false, error: error.message });
  }
});

// 📤 SEND EMAIL
app.post("/send-email", async (req, res) => {
  try {
    requiredEnv("EMAIL");
    requiredOneOfEnv(["EMAIL_PASS", "EMAIL_PASSWORD"]);

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
    const taxPercent = toAmount(body.taxPercent);
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
          success_url: `${APP_BASE_URL}/paid.html?invoice=${encodeURIComponent(invoiceNumber)}&session_id={CHECKOUT_SESSION_ID}`,
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
        pass: getEmailPassword()
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
    requireMongoReady();
    const auth = await getSessionUser(req);
    if (!auth) return res.status(401).json({ error: "Unauthorized." });

    const ownerId = String(auth.user._id || "").trim();
    const data = await Invoice.find({ ownerId: ownerId }).sort({ created: -1 });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/quotes", async (req, res) => {
  try {
    requireMongoReady();
    const auth = await getSessionUser(req);
    if (!auth) return res.status(401).json({ error: "Unauthorized." });

    const ownerId = String(auth.user._id || "").trim();
    const data = await Quote.find({ ownerId: ownerId }).sort({ created: -1 });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/maintenance/dedupe-quotes", async (req, res) => {
  try {
    requireMongoReady();
    const auth = await getSessionUser(req);
    if (!auth) return res.status(401).json({ ok: false, error: "Unauthorized." });

    const ownerId = String(auth.user._id || "").trim();
    const quotes = await Quote.find({ ownerId: ownerId }).lean();

    const bySemantic = {};
    const toDeleteIds = [];

    quotes.forEach(function (q) {
      const key = quoteSemanticKey(q);
      const existing = bySemantic[key];
      if (!existing) {
        bySemantic[key] = q;
        return;
      }

      const keep = choosePreferredQuoteDoc(existing, q);
      const drop = keep === existing ? q : existing;
      bySemantic[key] = keep;
      if (drop && drop._id) toDeleteIds.push(drop._id);
    });

    if (toDeleteIds.length) {
      await Quote.deleteMany({ _id: { $in: toDeleteIds } });
    }

    return res.json({ ok: true, scanned: quotes.length, deleted: toDeleteIds.length });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "Quote dedupe failed." });
  }
});

// Save/Upsert quote
app.post("/save-quote", async (req, res) => {
  try {
    requireMongoReady();
    const auth = await getSessionUser(req);
    if (!auth) return res.status(401).json({ success: false, error: "Unauthorized." });

    const body = req.body || {};
    const quoteNumber = cleanText(body.quoteNumber, 80);
    if (!quoteNumber) {
      return res.status(400).json({ success: false, error: "quoteNumber is required." });
    }

    const items = Array.isArray(body.items) ? body.items : [];
    const total = toAmount(body.total) || calcItemsSubtotal(items);
    const taxPercent = toAmount(body.taxPercent);
    const taxAmount = toAmount(body.taxAmount);
    const finalTotal = toAmount(body.finalTotal) || (total + taxAmount);
    const amountPaid = toAmount(body.amountPaid); // ✅ add
    const balanceDue = toAmount(body.balanceDue) || Math.max(0, finalTotal - amountPaid); // ✅ add

    const ownerId = String(auth.user._id || "").trim();

    const payload = {
      ownerId,
      email: cleanText(body.to || body.email, 254),
      customer: cleanText(body.customer, 120),
      businessName: cleanText(body.businessName || "JobFlow Pro", 120),
      date: cleanText(body.date, 40),
      dueDate: cleanText(body.dueDate, 40),
      notes: cleanText(body.notes, 2000),
      items,
      taxPercent,
      total,
      taxAmount,
      finalTotal,
      amountPaid,
      balanceDue,
      status: cleanText(body.status || "Pending", 40)
    };

    let savedQuoteNumber = quoteNumber;
    try {
      await Quote.updateOne(
        { ownerId, quoteNumber },
        {
          $set: Object.assign({}, payload, { quoteNumber }),
          $setOnInsert: { created: new Date() }
        },
        { upsert: true }
      );
    } catch (saveErr) {
      if (!(saveErr && Number(saveErr.code) === 11000)) throw saveErr;

      savedQuoteNumber = "Q-" + Date.now() + "-" + String(Math.floor(Math.random() * 10000)).padStart(4, "0");
      await Quote.updateOne(
        { ownerId, quoteNumber: savedQuoteNumber },
        {
          $set: Object.assign({}, payload, { quoteNumber: savedQuoteNumber }),
          $setOnInsert: { created: new Date() }
        },
        { upsert: true }
      );
    }

    return res.json({ success: true, quoteNumber: savedQuoteNumber });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// Quote status for app sync
app.get("/quote-status/:quoteNumber", async (req, res) => {
  const quoteNumber = cleanText(req.params.quoteNumber, 80);
  const transient = getTransientQuoteStatus(quoteNumber);
  try {
    const q = await withTimeout(
      Quote.findOne({ quoteNumber }).lean(),
      1200,
      "Quote status DB timeout."
    );
    if (!q) {
      if (transient) {
        const tStatus = transient.status || "Pending";
        return res.json({
          found: true,
          accepted: String(tStatus).toLowerCase() === "accepted",
          status: tStatus,
          acceptedAt: transient.acceptedAt || null,
          source: "transient"
        });
      }
      return res.json({ found: false, accepted: false, status: "Pending" });
    }
    return res.json({
      found: true,
      accepted: String(q.status || "").toLowerCase() === "accepted",
      status: q.status || "Pending",
      acceptedAt: q.acceptedAt || null
    });
  } catch (e) {
    if (transient) {
      const tStatus = transient.status || "Pending";
      return res.json({
        found: true,
        accepted: String(tStatus).toLowerCase() === "accepted",
        status: tStatus,
        acceptedAt: transient.acceptedAt || null,
        source: "transient"
      });
    }
    return res.status(500).json({ found: false, accepted: false, error: e.message });
  }
});

// Accept quote (clicked from email)
app.get("/accept-quote/:quoteNumber", async (req, res) => {
  try {
    const quoteNumber = cleanText(req.params.quoteNumber, 80);
    if (!quoteNumber) return res.status(400).send("Missing quote number.");

    const acceptedAt = new Date();
    setTransientQuoteStatus(quoteNumber, "Accepted", acceptedAt.toISOString());

    withTimeout(
      Quote.updateOne(
        { quoteNumber },
        { $set: { status: "Accepted", acceptedAt } },
        { upsert: true }
      ),
      1800,
      "Quote acceptance DB timeout."
    ).catch(function (dbErr) {
      console.warn("accept-quote warning:", dbErr.message);
    });

    return res.redirect(`${APP_BASE_URL}/quote-accepted.html?quote=${encodeURIComponent(quoteNumber)}&db=1`);
  } catch (e) {
    const quoteNumber = cleanText(req.params.quoteNumber, 80);
    if (quoteNumber) {
      return res.redirect(`${APP_BASE_URL}/quote-accepted.html?quote=${encodeURIComponent(quoteNumber)}&db=0`);
    }
    return res.status(500).send("Unable to accept quote.");
  }
});

// Send quote email with Accept button
app.post("/send-quote-email", async (req, res) => {
  try {
    requiredEnv("EMAIL");
    requiredOneOfEnv(["EMAIL_PASS", "EMAIL_PASSWORD"]);

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

    let quoteStored = true;
    let quoteStoreError = "";
    try {
      await withTimeout(
        Quote.updateOne(
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
        ),
        900,
        "Quote save DB timeout."
      );
    } catch (dbErr) {
      quoteStored = false;
      quoteStoreError = dbErr && dbErr.message ? dbErr.message : "Quote persistence failed.";
      console.warn("quote persistence warning:", quoteStoreError);
    }

    const runtimeApiBase = `${req.protocol}://${req.get("host")}`.replace(/\/+$/, "");
    const publicApiBase = (process.env.API_BASE_URL || runtimeApiBase).replace(/\/+$/, "");
    const acceptUrl = `${publicApiBase}/accept-quote/${encodeURIComponent(quoteNumber)}`;

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: cleanText(process.env.EMAIL, 254),
        pass: getEmailPassword()
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

    return res.json({ sent: true, quoteStored, quoteStoreError });
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
  requiredOneOfEnv(["EMAIL_PASS", "EMAIL_PASSWORD"]);
  requiredEnv("MONGO_URI");
} catch (e) {
  console.error("⚠️ Missing env var:", e.message);
  // do not process.exit in production — log and continue
}