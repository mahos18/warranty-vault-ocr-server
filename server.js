const express = require("express");
const Tesseract = require("tesseract.js");

const app = express();
app.use(express.json({ limit: "20mb" }));

// ── CORS ──────────────────────────────────────────────────
app.use((req, res, next) => {
  const allowed = process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", allowed);
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-ocr-secret");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ── Auth Middleware ────────────────────────────────────────
function requireSecret(req, res, next) {
  const secret = req.headers["x-ocr-secret"];
  if (process.env.OCR_SECRET && secret !== process.env.OCR_SECRET) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  next();
}

// ── Health Check ──────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ success: true, service: "warranty-vault-ocr", status: "ok" });
});

// ── Fetch remote file as buffer ───────────────────────────
async function fetchBuffer(url) {
  // node-fetch v2 is CommonJS compatible
  const fetch = require("node-fetch");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
  const contentType = response.headers.get("content-type") || "";
  const arrayBuffer = await response.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), contentType };
}

// ── Detect if URL is a PDF ────────────────────────────────
function detectPdf(url, contentType) {
  return (
    contentType.includes("pdf") ||
    url.toLowerCase().endsWith(".pdf") ||
    url.toLowerCase().includes("/raw/") // Cloudinary raw uploads
  );
}

// ── Convert PDF first page → PNG buffer ──────────────────
async function pdfFirstPageToImageBuffer(pdfBuffer) {
  // pdf-to-img is ESM only — use dynamic import inside async function
  const { pdf } = await import("pdf-to-img");

  const doc = await pdf(pdfBuffer, { scale: 2.5 }); // scale=2.5 gives better OCR quality

  // Iterate to get first page
  for await (const pageBuffer of doc) {
    return pageBuffer; // returns PNG Buffer of first page
  }

  throw new Error("PDF has no pages");
}

// ── Run Tesseract OCR on image source ────────────────────
async function runOCR(imageSource) {
  const result = await Tesseract.recognize(imageSource, "eng", {
    logger: (m) => {
      if (m.status === "recognizing text") {
        process.stdout.write(`\rOCR progress: ${Math.round(m.progress * 100)}%`);
      }
    },
  });
  process.stdout.write("\n");
  return result?.data?.text?.trim() || "";
}

// ── OCR Endpoint ──────────────────────────────────────────
// Accepts: { imageUrl: string }
// imageUrl can be a JPG/PNG/WebP image OR a PDF
app.post("/ocr", requireSecret, async (req, res) => {
  const { imageUrl } = req.body;

  if (!imageUrl || typeof imageUrl !== "string") {
    return res.status(400).json({ success: false, error: "imageUrl is required" });
  }

  console.log("Received OCR request for:", imageUrl);

  try {
    // ── Step 1: Fetch the file ──
    const { buffer, contentType } = await fetchBuffer(imageUrl);
    const isPdf = detectPdf(imageUrl, contentType);

    console.log(`File type: ${isPdf ? "PDF" : "Image"} (${contentType})`);

    let imageSource;

    if (isPdf) {
      // ── Step 2a: PDF → convert first page to image ──
      console.log("Converting PDF first page to image...");
      try {
        const pageBuffer = await pdfFirstPageToImageBuffer(buffer);
        // Convert PNG buffer to base64 data URL for Tesseract
        imageSource = `data:image/png;base64,${pageBuffer.toString("base64")}`;
        console.log("PDF converted successfully");
      } catch (pdfErr) {
        console.error("PDF conversion failed:", pdfErr.message);
        return res.status(422).json({
          success: false,
          error: "Could not convert PDF. Make sure it is not encrypted or corrupted.",
        });
      }
    } else {
      // ── Step 2b: Image → use URL directly (faster) ──
      imageSource = imageUrl;
    }

    // ── Step 3: Run OCR ──
    console.log("Running Tesseract OCR...");
    const rawText = await runOCR(imageSource);

    if (!rawText || rawText.length < 5) {
      return res.status(422).json({
        success: false,
        error: "No readable text detected. Try a clearer image or higher quality scan.",
      });
    }

    console.log(`OCR complete — extracted ${rawText.length} characters`);

    return res.json({
      success: true,
      data: {
        rawText,
        length: rawText.length,
        wasPdf: isPdf,
      },
    });

  } catch (error) {
    console.error("OCR Processing Error:", error.message);
    return res.status(500).json({
      success: false,
      error: "OCR processing failed",
      details: error.message,
    });
  }
});

// ── Global Error Handler ──────────────────────────────────
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ success: false, error: "Internal server error" });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`OCR server running on port ${PORT}`);
});