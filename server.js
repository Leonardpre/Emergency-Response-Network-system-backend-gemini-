const http = require("http");
const path = require("path");
const express = require("express");
const { Server } = require("socket.io");
const cors = require("cors");
require("dotenv").config();

const connectDB = require("./config/db");
const { initEmergencySocket } = require("./sockets/emergencySocket");
const dispatchRoutes = require("./routes/dispatchRoutes");
const authRoutes = require("./routes/authRoutes");
const hospitalRoutes = require("./routes/hospitalRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const reportRoutes = require("./routes/reportRoutes");

// Initialize Express App
const app = express();

// Middlewares
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded audio/photo proofs statically
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Create HTTP Server
const server = http.createServer(app);

// Initialize Socket.io Server
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST"],
  },
});

// Initialize Socket Event Handlers
initEmergencySocket(io);

// API Routes
app.use("/api/dispatch", dispatchRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/hospitals", hospitalRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/reports", reportRoutes);



// Health Check Endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ONLINE",
    system: "Aide Check Emergency Response Network System",
    timestamp: new Date(),
  });
});

// 404 Route Handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// Connect Database & Start Server
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDB();
  server.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`  🚀 Aide Check Backend Server Running on Port ${PORT}`);
    console.log(`  🌐 Socket.io Engine Online`);
    console.log(`  📍 Geospatial 2dsphere Proximity Indexing Active`);
    console.log(`====================================================`);
  });
};

if (require.main === module) {
  startServer();
}

module.exports = { app, server, startServer };
