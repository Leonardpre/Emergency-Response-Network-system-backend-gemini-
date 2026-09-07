const User = require("../models/User");
const { generateToken } = require("../middleware/authMiddleware");

/**
 * Register a new user account (Citizen, Responder, Dispatcher, Volunteer)
 * POST /api/auth/register
 */
const registerUser = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      phone,
      role = "victim",
      agency,
      agencyType,
      coordinates,
    } = req.body;

    if (!name || !phone) {
      return res.status(400).json({
        success: false,
        message: "Name and phone number are required.",
      });
    }

    if (email) {
      const existingUser = await User.findOne({ email: email.toLowerCase() });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: "An account with this email already exists.",
        });
      }
    }

    let locationPoint = { type: "Point", coordinates: [0, 0] };
    if (Array.isArray(coordinates) && coordinates.length === 2) {
      locationPoint.coordinates = [
        parseFloat(coordinates[0]),
        parseFloat(coordinates[1]),
      ];
    }

    const user = await User.create({
      name,
      email: email ? email.toLowerCase() : undefined,
      password,
      phone,
      role,
      agency: agency || undefined,
      agencyType: agencyType || undefined,
      location: locationPoint,
      isAvailable: true,
    });

    const token = generateToken(user._id, user.role);

    return res.status(201).json({
      success: true,
      message: "User registered successfully.",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        agency: user.agency,
        location: user.location,
      },
    });
  } catch (error) {
    console.error("[Register Controller Error]:", error);
    return res.status(500).json({
      success: false,
      message: "Server error during registration.",
      error: error.message,
    });
  }
};

/**
 * Authenticate user with Email & Password
 * POST /api/auth/login
 */
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide both email and password.",
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select(
      "+password"
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    const token = generateToken(user._id, user.role);

    return res.status(200).json({
      success: true,
      message: "Logged in successfully.",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        agency: user.agency,
        agencyType: user.agencyType,
        location: user.location,
      },
    });
  } catch (error) {
    console.error("[Login Controller Error]:", error);
    return res.status(500).json({
      success: false,
      message: "Server error during login.",
      error: error.message,
    });
  }
};

/**
 * Get current authenticated user profile
 * GET /api/auth/me
 */
const getMe = async (req, res) => {
  try {
    return res.status(200).json({
      success: true,
      user: req.user,
    });
  } catch (error) {
    console.error("[GetMe Error]:", error);
    return res.status(500).json({
      success: false,
      message: "Server error fetching user profile.",
      error: error.message,
    });
  }
};

/**
 * Update user's live location coordinates
 * PATCH /api/auth/location
 */
const updateLocation = async (req, res) => {
  try {
    const { coordinates } = req.body;

    if (!Array.isArray(coordinates) || coordinates.length !== 2) {
      return res.status(400).json({
        success: false,
        message: "Coordinates must be [longitude, latitude].",
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    user.location = {
      type: "Point",
      coordinates: [parseFloat(coordinates[0]), parseFloat(coordinates[1])],
    };
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Location updated successfully.",
      location: user.location,
    });
  } catch (error) {
    console.error("[Update Location Error]:", error);
    return res.status(500).json({
      success: false,
      message: "Server error updating location.",
      error: error.message,
    });
  }
};

module.exports = {
  registerUser,
  loginUser,
  getMe,
  updateLocation,
};
