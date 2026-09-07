const mongoose = require("mongoose");

const HospitalSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Hospital name is required"],
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
    capacity: {
      total: { type: Number, default: 50 },
      available: { type: Number, default: 20 },
      icuAvailable: { type: Number, default: 5 },
      oxygenAvailable: { type: Boolean, default: true },
    },
    ambulances: {
      total: { type: Number, default: 5 },
      activeOnCall: { type: Number, default: 0 },
    },
    availableAmbulances: {
      type: Number,
      default: 5,
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
HospitalSchema.index({ location: "2dsphere" });

module.exports = mongoose.model("Hospital", HospitalSchema);
