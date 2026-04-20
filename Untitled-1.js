app.use(express.json({ limit: "2mb" }));

// ✅ add this
app.get("/health", function (_req, res) {
  res.status(200).json({ ok: true });
});