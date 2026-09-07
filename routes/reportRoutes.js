const express = require("express");
const router = express.Router();
const {
  getSummaryReport,
  getResponseTimesReport,
  getHotspotsReport,
  getHospitalUtilisationReport,
  getResponderActivityReport,
} = require("../controllers/reportController");

// @route   GET /api/reports/summary
// @desc    Incident totals by status, type, active/resolved
// @access  Public
router.get("/summary", getSummaryReport);

// @route   GET /api/reports/response-times
// @desc    Average response times to ON_SCENE and RESOLVED per type
// @access  Public
router.get("/response-times", getResponseTimesReport);

// @route   GET /api/reports/hotspots
// @desc    Top geographic coordinates with most incidents
// @access  Public
router.get("/hotspots", getHotspotsReport);

// @route   GET /api/reports/hospital-utilisation
// @desc    Bed occupancy rate & capacity breakdown per hospital
// @access  Public
router.get("/hospital-utilisation", getHospitalUtilisationReport);

// @route   GET /api/reports/responder-activity
// @desc    Assignments and dispatch counts by unit/responder
// @access  Public
router.get("/responder-activity", getResponderActivityReport);

module.exports = router;
