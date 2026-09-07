const mongoose = require("mongoose");

const FireStationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Fire Station name is required"],
      trim: true,
    },
    contactNumber: {
      type: String,
      required: [true, "Contact number is required"],
    },
    isOperational: {
      type: Boolean,
      default: true,
    },
    availableEngineTrucks: {
      type: Number,
      default: 3,
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
  },
  { timestamps: true }
);

// 2dsphere index for proximity geospatial queries ($nearSphere)
FireStationSchema.index({ location: "2dsphere" });

module.exports = mongoose.model("FireStation", FireStationSchema);
