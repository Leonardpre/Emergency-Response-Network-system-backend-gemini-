const assert = require("assert");
const http = require("http");
const path = require("path");
const fs = require("fs");
const express = require("express");
const { Server } = require("socket.io");
const { io: Client } = require("socket.io-client");

const {
  registerUser,
  loginUser,
  getMe,
  updateLocation,
} = require("../controllers/authController");
const {
  attachVerificationMedia,
} = require("../controllers/dispatchController");
const { initEmergencySocket } = require("../sockets/emergencySocket");
const { generateToken } = require("../middleware/authMiddleware");

const User = require("../models/User");
const Incident = require("../models/Incident");

async function runPhase2Tests() {
  console.log("=================================================");
  console.log(" 🧪 Phase 2 Verification: Uploads, Auth & RBAC");
  console.log("=================================================");

  const port = 5097;
  const app = express();
  app.use(express.json());
  app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

  const server = http.createServer(app);
  const ioServer = new Server(server);
  initEmergencySocket(ioServer);

  await new Promise((r) => server.listen(port, r));
  const clientSocket = Client(`http://localhost:${port}`);
  await new Promise((r) => clientSocket.on("connect", r));

  clientSocket.emit("JOIN_ROOM", "dispatch_consoles");
  await new Promise((r) => setTimeout(r, 100));

  let resCode = 0;
  let resBody = null;
  const resMock = {
    status: (code) => {
      resCode = code;
      return {
        json: (data) => {
          resBody = data;
        },
      };
    },
  };

  try {
    // -------------------------------------------------------------
    // Test 1: Multer File Upload Attachment
    // -------------------------------------------------------------
    console.log("\n --- 1. Testing Multer Direct Audio Upload ---");
    const testIncidentId = "inc_phase2_test";
    const testUploadDir = path.join(__dirname, "..", "uploads");
    if (!fs.existsSync(testUploadDir)) fs.mkdirSync(testUploadDir, { recursive: true });

    const dummyFilename = `${testIncidentId}_12345_voicenote.mp3`;
    const dummyFilePath = path.join(testUploadDir, dummyFilename);
    fs.writeFileSync(dummyFilePath, Buffer.from("FAKE_AUDIO_BYTES_TEST"));

    const mockIncident = {
      _id: testIncidentId,
      media: [],
      save: function () {
        return Promise.resolve(this);
      },
    };

    Incident.findById = function (id) {
      assert.strictEqual(id, testIncidentId);
      return Promise.resolve(mockIncident);
    };

    let mediaAttachedSocket = null;
    clientSocket.on("MEDIA_ATTACHED", (p) => {
      mediaAttachedSocket = p;
    });

    const reqMockUpload = {
      params: { id: testIncidentId },
      protocol: "http",
      get: (header) => (header === "host" ? `localhost:${port}` : null),
      file: {
        filename: dummyFilename,
        mimetype: "audio/mpeg",
        size: 1024,
      },
      body: {},
    };

    await attachVerificationMedia(reqMockUpload, resMock);
    await new Promise((r) => setTimeout(r, 150));

    assert.strictEqual(resCode, 200);
    assert.strictEqual(mockIncident.media.length, 1);
    assert.strictEqual(mockIncident.media[0].mediaType, "VOICE_NOTE");
    assert.ok(mockIncident.media[0].url.includes(`/uploads/${dummyFilename}`));
    assert.ok(mediaAttachedSocket, "MEDIA_ATTACHED socket event must be emitted");
    console.log(" ✅ Multer Audio Upload & MEDIA_ATTACHED Socket Event Passed.");

    // Clean up test file
    if (fs.existsSync(dummyFilePath)) fs.unlinkSync(dummyFilePath);

    // -------------------------------------------------------------
    // Test 2: User Registration & Password Hashing
    // -------------------------------------------------------------
    console.log("\n --- 2. Testing User Registration (Auth) ---");
    const mockUser = {
      _id: "user_12345",
      name: "Dispatcher Sarah",
      email: "sarah@aidecheck.org",
      phone: "+2348011223344",
      role: "dispatcher",
      location: { type: "Point", coordinates: [3.37, 6.52] },
      isAvailable: true,
      matchPassword: function (pwd) {
        return Promise.resolve(pwd === "SecretPassword123");
      },
      save: function () {
        return Promise.resolve(this);
      },
    };

    User.findOne = function ({ email }) {
      return Promise.resolve(null); // No collision
    };
    User.create = function (data) {
      return Promise.resolve({ ...mockUser, ...data });
    };

    await registerUser(
      {
        body: {
          name: "Dispatcher Sarah",
          email: "sarah@aidecheck.org",
          password: "SecretPassword123",
          phone: "+2348011223344",
          role: "dispatcher",
          coordinates: [3.37, 6.52],
        },
      },
      resMock
    );

    assert.strictEqual(resCode, 201);
    assert.ok(resBody.token, "JWT token must be generated");
    assert.strictEqual(resBody.user.role, "dispatcher");
    console.log(" ✅ User Registration & JWT Token Generation Passed.");

    // -------------------------------------------------------------
    // Test 3: User Login & Credential Verification
    // -------------------------------------------------------------
    console.log("\n --- 3. Testing User Login ---");
    User.findOne = function ({ email }) {
      return {
        select: () => Promise.resolve(mockUser),
      };
    };

    await loginUser(
      {
        body: {
          email: "sarah@aidecheck.org",
          password: "SecretPassword123",
        },
      },
      resMock
    );

    assert.strictEqual(resCode, 200);
    assert.ok(resBody.token, "Login must return JWT token");
    assert.strictEqual(resBody.user.email, "sarah@aidecheck.org");
    console.log(" ✅ User Login & Password Validation Passed.");

    // -------------------------------------------------------------
    // Test 4: Protected Profile Endpoint (getMe)
    // -------------------------------------------------------------
    console.log("\n --- 4. Testing Protected Profile (getMe) ---");
    await getMe({ user: mockUser }, resMock);
    assert.strictEqual(resCode, 200);
    assert.strictEqual(resBody.user.name, "Dispatcher Sarah");
    console.log(" ✅ Protected Profile Retrieval Passed.");

    // -------------------------------------------------------------
    // Test 5: Live Location Update
    // -------------------------------------------------------------
    console.log("\n --- 5. Testing Live Location Telemetry Update ---");
    User.findById = function (id) {
      return Promise.resolve(mockUser);
    };

    await updateLocation(
      {
        user: mockUser,
        body: { coordinates: [3.40, 6.55] },
      },
      resMock
    );

    assert.strictEqual(resCode, 200);
    assert.strictEqual(mockUser.location.coordinates[0], 3.40);
    assert.strictEqual(mockUser.location.coordinates[1], 6.55);
    console.log(" ✅ Live Location Coordinate Update Passed.");

    console.log("\n=================================================");
    console.log(" 🎉 ALL PHASE 2 TESTS (UPLOADS & AUTH) PASSED!");
    console.log("=================================================\n");
  } finally {
    clientSocket.close();
    server.close();
  }
}

runPhase2Tests();
