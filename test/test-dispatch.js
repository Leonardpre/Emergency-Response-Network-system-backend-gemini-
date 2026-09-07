const mongoose = require("mongoose");
const http = require("http");
const { io: Client } = require("socket.io-client");
const { MongoMemoryServer } = require("mongodb-memory-server");
require("dotenv").config();

const Hospital = require("../models/Hospital");
const FireStation = require("../models/FireStation");
const User = require("../models/User");
const Incident = require("../models/Incident");

const {
  dispatchSOS,
  attachVerificationMedia,
  seedFacilities,
} = require("../controllers/dispatchController");
const { initEmergencySocket } = require("../sockets/emergencySocket");

async function runTests() {
  console.log("=================================================");
  console.log(" 🧪 Starting Aide Check Verification Test Suite");
  console.log("=================================================");

  let mongod = null;
  let server = null;
  let clientSocket = null;
  const port = 5099;

  try {
    // 1. Setup Mongo Memory Server for reliable isolated testing
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    await mongoose.connect(uri);
    console.log(` ✅ 1. Connected to In-Memory MongoDB (${uri})`);

    // Ensure 2dsphere indexes
    await Hospital.ensureIndexes();
    await FireStation.ensureIndexes();
    await User.ensureIndexes();
    await Incident.ensureIndexes();
    console.log(" ✅ 2. 2dsphere Geospatial Indexes Verified");

    // 2. Setup HTTP & Socket Server
    const express = require("express");
    const { Server } = require("socket.io");
    const app = express();
    app.use(express.json());

    server = http.createServer(app);
    const ioServer = new Server(server);
    initEmergencySocket(ioServer);

    await new Promise((resolve) => server.listen(port, resolve));
    console.log(` ✅ 3. Test HTTP & Socket.io Server listening on port ${port}`);

    // Socket client setup
    clientSocket = Client(`http://localhost:${port}`);
    await new Promise((resolve) => clientSocket.on("connect", resolve));
    clientSocket.emit("JOIN_ROOM", "hospitals");
    clientSocket.emit("JOIN_ROOM", "fire_stations");
    clientSocket.emit("JOIN_ROOM", "volunteers");
    console.log(" ✅ 4. Client socket connected and joined responder rooms");

    // 3. Seed Facilities
    const reqMock = {};
    const resMockSeed = {
      status: (code) => ({
        json: (data) => data,
      }),
    };
    await seedFacilities(reqMock, resMockSeed);
    console.log(" ✅ 5. Test Facilities & Volunteers Seeded");

    // Base point: Lagos center [3.3792, 6.5244]
    const victimLng = 3.3792;
    const victimLat = 6.5244;

    // 4. Test Medical SOS (10 km radius)
    console.log("\n --- Testing Medical SOS (10 km Radius Query) ---");
    let receivedSocketEvent = null;
    clientSocket.on("DISPATCH_SOS", (payload) => {
      receivedSocketEvent = payload;
    });

    const resMockMedical = {
      status: (code) => ({
        json: (data) => {
          console.log(`   Response Status: ${code}`);
          console.log(`   Matched Hospitals: ${data.matchedCount}`);
          console.log(`   Message: ${data.message}`);
          if (data.matchedCount < 1) throw new Error("Expected at least 1 hospital within 10 km!");
          return data;
        },
      }),
    };

    await dispatchSOS(
      {
        body: {
          type: "MEDICAL",
          coordinates: [victimLng, victimLat],
          description: "Victim severe asthma attack",
          victimInfo: { name: "Alice", phone: "+123456789" },
        },
      },
      resMockMedical
    );

    await new Promise((r) => setTimeout(r, 200));
    if (!receivedSocketEvent) {
      throw new Error("DISPATCH_SOS socket event was NOT emitted!");
    }
    console.log(" ✅ Medical SOS Dispatch & DISPATCH_SOS Socket Event Passed");

    // 5. Test Fire SOS Tier 1 (20 km radius query)
    console.log("\n --- Testing Fire SOS Tier 1 (20 km Radius CAD Protocol) ---");
    let receivedFireSocket = null;
    clientSocket.on("FIRE_EMERGENCY_DISPATCH", (payload) => {
      receivedFireSocket = payload;
    });

    const resMockFireTier1 = {
      status: (code) => ({
        json: (data) => {
          console.log(`   Response Status: ${code}`);
          console.log(`   Dispatch Tier: ${data.dispatchTier}`);
          console.log(`   Matched Fire Stations: ${data.matchedCount}`);
          if (data.dispatchTier !== "TIER_1_FIRE_STATION") {
            throw new Error(`Expected TIER_1_FIRE_STATION but got ${data.dispatchTier}`);
          }
          return data;
        },
      }),
    };

    await dispatchSOS(
      {
        body: {
          type: "FIRE",
          coordinates: [victimLng, victimLat],
          description: "Building fire near main street",
        },
      },
      resMockFireTier1
    );

    await new Promise((r) => setTimeout(r, 200));
    if (!receivedFireSocket) {
      throw new Error("FIRE_EMERGENCY_DISPATCH socket event was NOT emitted!");
    }
    console.log(" ✅ Fire SOS Tier 1 Dispatch & Socket Event Passed");

    // 6. Test Fire SOS Tier 2 Fallback (0 stations within 20 km -> 2 km Volunteer Vicinity Broadcast)
    console.log("\n --- Testing Fire SOS Tier 2 (Fallback Vicinity Broadcast) ---");
    // Delete fire stations to simulate zero stations available
    await FireStation.deleteMany({});

    let receivedVicinitySocket = null;
    clientSocket.on("VICINITY_FIRE_BROADCAST", (payload) => {
      receivedVicinitySocket = payload;
    });

    const resMockFireTier2 = {
      status: (code) => ({
        json: (data) => {
          console.log(`   Response Status: ${code}`);
          console.log(`   Dispatch Tier: ${data.dispatchTier}`);
          console.log(`   Matched Volunteers within 2km: ${data.matchedCount}`);
          if (data.dispatchTier !== "TIER_2_VOLUNTEER_VICINITY") {
            throw new Error(`Expected TIER_2_VOLUNTEER_VICINITY but got ${data.dispatchTier}`);
          }
          return data;
        },
      }),
    };

    await dispatchSOS(
      {
        body: {
          type: "FIRE",
          coordinates: [victimLng, victimLat],
          description: "Wildfire approaching village, zero fire stations nearby",
        },
      },
      resMockFireTier2
    );

    await new Promise((r) => setTimeout(r, 200));
    if (!receivedVicinitySocket) {
      throw new Error("VICINITY_FIRE_BROADCAST socket event was NOT emitted!");
    }
    console.log(" ✅ Fire SOS Tier 2 Fallback & VICINITY_FIRE_BROADCAST Socket Event Passed");

    // 7. Test Asynchronous Verification Proof Attachment
    console.log("\n --- Testing Asynchronous Verification Proof Engine ---");
    const testIncident = await Incident.findOne({});
    let receivedMediaSocket = null;
    clientSocket.on("MEDIA_ATTACHED", (payload) => {
      receivedMediaSocket = payload;
    });

    const resMockMedia = {
      status: (code) => ({
        json: (data) => {
          console.log(`   Response Status: ${code}`);
          console.log(`   Attached Media URL: ${data.attachedMedia?.url}`);
          if (!data.success) throw new Error("Attach media failed!");
          return data;
        },
      }),
    };

    await attachVerificationMedia(
      {
        params: { id: testIncident._id.toString() },
        body: {
          mediaUrl: "https://storage.aidecheck.org/voice_notes/incident_123.mp3",
          mediaType: "VOICE_NOTE",
        },
      },
      resMockMedia
    );

    await new Promise((r) => setTimeout(r, 200));
    if (!receivedMediaSocket) {
      throw new Error("MEDIA_ATTACHED socket event was NOT emitted!");
    }
    console.log(" ✅ Async Verification Media Attachment & MEDIA_ATTACHED Socket Event Passed");

    console.log("\n=================================================");
    console.log(" 🎉 ALL 7 VERIFICATION TESTS PASSED SUCCESSFULLY!");
    console.log("=================================================\n");
  } catch (err) {
    console.error("\n❌ TEST SUITE FAILURE:", err);
    process.exitCode = 1;
  } finally {
    if (clientSocket) clientSocket.close();
    if (server) server.close();
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
  }
}

runTests();
