const express = require("express");
const Tesseract = require("tesseract.js");

const app = express();
app.use(express.json({ limit: "20mb" }));

// CORS
app.use((req, res, next) => {
  const allowed = process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", allowed);
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-ocr-secret");

  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Secret Auth Middleware
function requireSecret(req, res, next) {
  const secret = req.headers["x-ocr-secret"];

  // if (!secret || secret !== process.env.OCR_SECRET) {
  //   return res.status(401).json({
  //     success: false,
  //     error: "Unauthorized request1",
  //   });
  // }

  next();
}

// Health Check
app.get("/health", (req, res) => {
  return res.json({
    success: true,
    service: "warranty-vault-ocr",
    status: "ok",
  });
});

// OCR Endpoint
app.post("/ocr", requireSecret, async (req, res) => {
  try {
    const { imageUrl } = req.body;
    console.log(imageUrl);

    if (!imageUrl || typeof imageUrl !== "string") {
      return res.status(400).json({
        success: false,
        error: "imageUrl is required",
      });
    }

    console.log("Starting OCR for:", imageUrl);

    const result = await Tesseract.recognize(imageUrl, "eng", {
      logger: (m) => {
        if (m.status === "recognizing text") {
          console.log(`OCR progress: ${Math.round(m.progress * 100)}%`);
        }
      },
    });

    const rawText = result?.data?.text?.trim() || "";

    if (!rawText || rawText.length < 5) {
      return res.status(422).json({
        success: false,
        error: "No readable text detected. Try a clearer image.",
      });
    }

    return res.json({
      success: true,
      data: {
        rawText,
        length: rawText.length,
      },
    });

  } catch (error) {
    console.error("OCR Processing Error:", error);

    return res.status(500).json({
      success: false,
      error: "OCR processing failed",
      details: error.message,
    });
  }
});

// Global Error Handler (Safety Net)
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);

  res.status(500).json({
    success: false,
    error: "Internal server error",
  });
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`OCR server running on port ${PORT}`);
});