const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Storage engine configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const incidentId = req.params?.id || "general";
    const timestamp = Date.now();
    const cleanOriginalName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_");
    const uniqueSuffix = `${incidentId}_${timestamp}_${cleanOriginalName}`;
    cb(null, uniqueSuffix);
  },
});

// File filter for audio notes and photo proofs
const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    // Photos
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    // Audio / Voice Notes
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/webm",
    "audio/ogg",
    "audio/mp4",
    "audio/m4a",
    "audio/x-m4a",
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `Unsupported media format (${file.mimetype}). Allowed: JPEG, PNG, WEBP, MP3, WAV, WEBM, OGG, M4A`
      ),
      false
    );
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 25 * 1024 * 1024, // 25 MB max
  },
});

module.exports = upload;
