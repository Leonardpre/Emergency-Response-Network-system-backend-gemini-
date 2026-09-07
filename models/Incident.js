const mongoose = require("mongoose");

const MediaSchema = new mongoose.Schema({
  url: {
    type: String,
    required: true,
  },
  mediaType: {
    type: String,
    enum: ["PHOTO", "VOICE_NOTE", "VIDEO", "OTHER"],
    default: "PHOTO",
  },
  uploadedAt: {
    type: Date,
    default: Date.now,
  },
});

const IncidentSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["MEDICAL", "SECURITY", "FIRE"],
      required: [true, "Emergency type is required"],
    },
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
        required: true,
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: true,
      },
    },
    description: {
      type: String,
      default: "Emergency SOS Alert",
    },
    status: {
      type: String,
      enum: [
        "PENDING",
        "DISPATCHED",
        "ACKNOWLEDGED",
        "EN_ROUTE",
        "ON_SCENE",
        "RESOLVED",
        "CANCELLED",
      ],
      default: "DISPATCHED",
    },
    statusHistory: [
      {
        status: {
          type: String,
          enum: [
            "PENDING",
            "DISPATCHED",
            "ACKNOWLEDGED",
            "EN_ROUTE",
            "ON_SCENE",
            "RESOLVED",
            "CANCELLED",
          ],
        },
        changedAt: {
          type: Date,
          default: Date.now,
        },
        note: {
          type: String,
          default: "",
        },
      },
    ],
    dispatchTier: {
      type: String,
      enum: ["TIER_1_HOSPITAL", "TIER_1_FIRE_STATION", "TIER_2_VOLUNTEER_VICINITY"],
      required: true,
    },
    assignedUnits: [
      {
        unitId: mongoose.Schema.Types.ObjectId,
        unitType: {
          type: String,
          enum: ["Hospital", "FireStation", "User"],
        },
        name: String,
        distanceMeters: Number,
      },
    ],
    media: [MediaSchema],
    victimInfo: {
      name: String,
      phone: String,
    },
  },
  { timestamps: true }
);

// 2dsphere index for geospatial incident queries
IncidentSchema.index({ location: "2dsphere" });

module.exports = mongoose.model("Incident", IncidentSchema);
