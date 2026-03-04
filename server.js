const express = require("express");
const Tesseract = require("tesseract.js");
const fetch = require("node-fetch");

const app = express();
app.use(express.json({ limit: "20mb" }));

// CORS — allow your Vercel app to call this server
app.use((req, res, next) => {
  const allowed = process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", allowed);
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Auth middleware — simple shared secret
function requireSecret(req, res, next) {
  const secret = req.headers["x-ocr-secret"];
  if (secret !== process.env.OCR_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "warranty-vault-ocr" });
});

// POST /ocr — receives imageUrl, returns extracted text
app.post("/ocr", requireSecret, async (req, res) => {
  const { imageUrl } = req.body;

  if (!imageUrl) {
    return res.status(400).json({ error: "No imageUrl provided" });
  }

  try {
    console.log("Starting OCR for:", imageUrl);

    const { data } = await Tesseract.recognize(imageUrl, "eng", {
      logger: (m) => {
        if (m.status === "recognizing text") {
          console.log(`OCR progress: ${Math.round(m.progress * 100)}%`);
        }
      },
    });

    const rawText = data.text?.trim() ?? "";
    console.log("OCR complete. Text length:", rawText.length);

    if (!rawText || rawText.length < 5) {
      return res.status(422).json({
        error: "No readable text found. Try a clearer photo.",
      });
    }

    return res.json({ rawText });
  } catch (err) {
    console.error("OCR error:", err);
    return res.status(500).json({ error: "OCR processing failed." });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`OCR server running on port ${PORT}`);
});