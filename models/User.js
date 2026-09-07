const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      unique: true,
      sparse: true,
      match: [/^\S+@\S+\.\S+$/, "Please provide a valid email address"],
    },
    password: {
      type: String,
      minlength: [6, "Password must be at least 6 characters"],
      select: false,
    },
    phone: {
      type: String,
      required: [true, "Phone number is required"],
    },
    role: {
      type: String,
      enum: [
        "victim",
        "volunteer",
        "dispatcher",
        "responder",
        "hospital_staff",
        "fire_crew",
        "admin",
      ],
      default: "victim",
    },
    agency: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "agencyType",
    },
    agencyType: {
      type: String,
      enum: ["Hospital", "FireStation"],
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: [0, 0],
      },
    },
  },
  { timestamps: true }
);

// Hash password before saving
UserSchema.pre("save", async function () {
  if (!this.isModified("password") || !this.password) {
    return;
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});


// Compare password method
UserSchema.methods.matchPassword = async function (enteredPassword) {
  if (!this.password) return false;
  return await bcrypt.compare(enteredPassword, this.password);
};

// 2dsphere index for community volunteer vicinity queries ($nearSphere)
UserSchema.index({ location: "2dsphere" });

module.exports = mongoose.model("User", UserSchema);

