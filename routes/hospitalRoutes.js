const express = require("express");
const router = express.Router();
const {
  getHospitalCapacity,
  updateHospitalCapacity,
  getCapacityOverview,
} = require("../controllers/hospitalController");

// @route   GET /api/hospitals/capacity-overview
// @desc    Get system-wide bed and resource capacity overview for dispatchers
// @access  Public
router.get("/capacity-overview", getCapacityOverview);

// @route   GET /api/hospitals/:id/capacity
// @desc    Get live capacity for a specific hospital
// @access  Public
router.get("/:id/capacity", getHospitalCapacity);

// @route   PATCH /api/hospitals/:id/capacity
// @desc    Update live capacity (beds, ICU, oxygen, ambulances)
// @access  Public
router.patch("/:id/capacity", updateHospitalCapacity);

module.exports = router;
