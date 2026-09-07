const mongoose = require("mongoose");

const connectDB = async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;

  if (!uri) {
    console.warn("⚠️ [MongoDB Warning] No MONGODB_URI or MONGO_URI set in .env.");
    return null;
  }

  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log(`✅ [MongoDB] Connected successfully: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.error(`❌ [MongoDB Error] Connection failed: ${error.message}`);
    console.warn(`💡 [Atlas Tip] If using MongoDB Atlas, make sure your IP is whitelisted (Network Access -> Allow Access from Anywhere: 0.0.0.0/0)`);
    console.warn(`⚠️ [Server Notice] Backend server will remain running for Socket.io and API requests.`);
    return null;
  }
};

module.exports = connectDB;

