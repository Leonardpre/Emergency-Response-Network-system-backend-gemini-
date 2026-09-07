const express = require("express");
const router = express.Router();
const {
  dispatchSOS,
  attachVerificationMedia,
  seedFacilities,
  getIncidents,
  getIncidentById,
  updateIncidentStatus,
  getFacilities,
  getIncidentAuditTrail,
} = require("../controllers/dispatchController");
const upload = require("../middleware/uploadMiddleware");

// @route   POST /api/dispatch/sos
// @desc    Trigger Medical/Security SOS or Cascading Fire Outbreak Protocol
// @access  Public
router.post("/sos", dispatchSOS);

// @route   POST /api/dispatch/incident/:id/media
// @desc    Asynchronously attach voice notes or photo proofs to existing SOS Incident (supports file upload or JSON URL)
// @access  Public
router.post("/incident/:id/media", upload.single("mediaFile"), attachVerificationMedia);

// @route   GET /api/dispatch/incidents
// @desc    Fetch incidents with optional status/type filters & pagination
// @access  Public
router.get("/incidents", getIncidents);

// @route   GET /api/dispatch/incident/:id
// @desc    Fetch incident details by ID
// @access  Public
router.get("/incident/:id", getIncidentById);

// @route   GET /api/dispatch/incident/:id/audit-trail
// @desc    Fetch chronological timeline & audit history for an incident
// @access  Public
router.get("/incident/:id/audit-trail", getIncidentAuditTrail);


// @route   PATCH /api/dispatch/incident/:id/status
// @desc    Update incident status (ACKNOWLEDGED, EN_ROUTE, ON_SCENE, RESOLVED, CANCELLED)
// @access  Public
router.patch("/incident/:id/status", updateIncidentStatus);

// @route   GET /api/dispatch/facilities
// @desc    Fetch operational hospitals, fire stations, and active volunteers
// @access  Public
router.get("/facilities", getFacilities);

// @route   POST /api/dispatch/seed
// @desc    Seed sample hospitals, fire stations, and community volunteers for geospatial testing
// @access  Public
router.post("/seed", seedFacilities);

module.exports = router;

