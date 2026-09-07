const express = require("express");
const router = express.Router();
const {
  registerUser,
  loginUser,
  getMe,
  updateLocation,
} = require("../controllers/authController");
const { protect } = require("../middleware/authMiddleware");

// @route   POST /api/auth/register
// @desc    Register a new user / responder
// @access  Public
router.post("/register", registerUser);

// @route   POST /api/auth/login
// @desc    Authenticate user & get JWT token
// @access  Public
router.post("/login", loginUser);

// @route   GET /api/auth/me
// @desc    Get current logged in user profile
// @access  Private
router.get("/me", protect, getMe);

// @route   PATCH /api/auth/location
// @desc    Update live coordinates of current user / responder
// @access  Private
router.patch("/location", protect, updateLocation);

module.exports = router;
