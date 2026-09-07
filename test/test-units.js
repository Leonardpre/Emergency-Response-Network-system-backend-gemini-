const assert = require("assert");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const { io: Client } = require("socket.io-client");

const {
  dispatchSOS,
  attachVerificationMedia,
} = require("../controllers/dispatchController");
const { initEmergencySocket } = require("../sockets/emergencySocket");

const Hospital = require("../models/Hospital");
const FireStation = require("../models/FireStation");
const User = require("../models/User");
const Incident = require("../models/Incident");

async function runUnitVerification() {
  console.log("=================================================");
  console.log(" 🧪 Unit Logic Verification Suite (Fast Mock Runner)");
  console.log("=================================================");

  const port = 5098;
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  const ioServer = new Server(server);
  initEmergencySocket(ioServer);

  await new Promise((r) => server.listen(port, r));
  const clientSocket = Client(`http://localhost:${port}`);
  await new Promise((r) => clientSocket.on("connect", r));

  clientSocket.emit("JOIN_ROOM", "hospitals");
  clientSocket.emit("JOIN_ROOM", "fire_stations");
  clientSocket.emit("JOIN_ROOM", "volunteers");
  await new Promise((r) => setTimeout(r, 100));

  try {
    // 1. Mock Hospital Find & Incident Create for Medical SOS
    const origHospitalFind = Hospital.find;
    const origIncidentCreate = Incident.create;
    const origFireFind = FireStation.find;
    const origUserFind = User.find;
    const origIncidentFindById = Incident.findById;

    Hospital.find = function (query) {
      assert.strictEqual(query.isOperational, true);
      assert.strictEqual(query.location.$nearSphere.$maxDistance, 10000);
      return Promise.resolve([
        { _id: "hosp1", name: "St. Nicholas Hospital" },
        { _id: "hosp2", name: "Lagos University Teaching Hospital" },
      ]);
    };

    Incident.create = function (data) {
      return Promise.resolve({
        _id: "inc_12345",
        ...data,
        media: [],
        save: function () {
          return Promise.resolve(this);
        },
      });
    };

    // Test Medical SOS
    console.log("\n --- 1. Testing Medical SOS (10km Radius & Socket Alert) ---");
    let medicalEventPayload = null;
    clientSocket.on("DISPATCH_SOS", (payload) => {
      medicalEventPayload = payload;
    });

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

    await dispatchSOS(
      {
        body: {
          type: "MEDICAL",
          coordinates: [3.3792, 6.5244],
          description: "Severe emergency",
        },
      },
      resMock
    );

    await new Promise((r) => setTimeout(r, 200));

    assert.strictEqual(resCode, 201);
    assert.strictEqual(resBody.success, true);
    assert.strictEqual(resBody.matchedCount, 2);
    assert.strictEqual(resBody.dispatchTier, "TIER_1_HOSPITAL");
    assert.ok(medicalEventPayload, "Socket DISPATCH_SOS event must be emitted");
    console.log(" ✅ Medical SOS 10km query & Socket notification passed.");

    // Test Fire SOS Tier 1 (Fire Stations available within 20km)
    console.log("\n --- 2. Testing Cascading Fire Outbreak Protocol (Tier 1 CAD Dispatch) ---");
    FireStation.find = function (query) {
      assert.strictEqual(query.location.$nearSphere.$maxDistance, 20000);
      return Promise.resolve([
        { _id: "fs1", name: "Ikeja Fire HQ" }
      ]);
    };

    let fireCadPayload = null;
    clientSocket.on("FIRE_EMERGENCY_DISPATCH", (p) => {
      fireCadPayload = p;
    });

    await dispatchSOS(
      {
        body: {
          type: "FIRE",
          coordinates: [3.3792, 6.5244],
          description: "Factory fire outbreak",
        },
      },
      resMock
    );

    await new Promise((r) => setTimeout(r, 200));

    assert.strictEqual(resCode, 201);
    assert.strictEqual(resBody.dispatchTier, "TIER_1_FIRE_STATION");
    assert.ok(fireCadPayload, "Socket FIRE_EMERGENCY_DISPATCH must be emitted");
    console.log(" ✅ Fire Tier 1 20km query & CAD socket notification passed.");

    // Test Fire SOS Tier 2 Fallback (0 Fire Stations within 20km -> 2km Vicinity Broadcast)
    console.log("\n --- 3. Testing Cascading Fire Outbreak Protocol (Tier 2 Fallback Vicinity Broadcast) ---");
    FireStation.find = function () {
      return Promise.resolve([]); // 0 stations
    };

    User.find = function (query) {
      assert.strictEqual(query.role, "volunteer");
      assert.strictEqual(query.location.$nearSphere.$maxDistance, 2000);
      return Promise.resolve([
        { _id: "vol1", name: "Volunteer John" },
        { _id: "vol2", name: "Volunteer Jane" },
      ]);
    };

    let vicinityPayload = null;
    clientSocket.on("VICINITY_FIRE_BROADCAST", (p) => {
      vicinityPayload = p;
    });

    await dispatchSOS(
      {
        body: {
          type: "FIRE",
          coordinates: [3.3792, 6.5244],
          description: "Wildfire in isolated area",
        },
      },
      resMock
    );

    await new Promise((r) => setTimeout(r, 200));

    assert.strictEqual(resCode, 201);
    assert.strictEqual(resBody.dispatchTier, "TIER_2_VOLUNTEER_VICINITY");
    assert.strictEqual(resBody.matchedCount, 2);
    assert.ok(vicinityPayload, "Socket VICINITY_FIRE_BROADCAST must be emitted");
    console.log(" ✅ Fire Tier 2 Fallback 2km volunteer query & Vicinity broadcast passed.");

    // Test Async Verification Engine (Media attachment)
    console.log("\n --- 4. Testing Asynchronous Verification Proof Engine ---");
    const mockIncidentInstance = {
      _id: "inc_12345",
      media: [],
      save: function () {
        return Promise.resolve(this);
      },
    };

    Incident.findById = function (id) {
      assert.strictEqual(id, "inc_12345");
      return Promise.resolve(mockIncidentInstance);
    };

    let mediaPayload = null;
    clientSocket.on("MEDIA_ATTACHED", (p) => {
      mediaPayload = p;
    });

    await attachVerificationMedia(
      {
        params: { id: "inc_12345" },
        body: {
          mediaUrl: "https://storage.aidecheck.org/voice/note1.mp3",
          mediaType: "VOICE_NOTE",
        },
      },
      resMock
    );

    await new Promise((r) => setTimeout(r, 200));

    assert.strictEqual(resCode, 200);
    assert.strictEqual(mockIncidentInstance.media.length, 1);
    assert.strictEqual(mockIncidentInstance.media[0].mediaType, "VOICE_NOTE");
    assert.ok(mediaPayload, "Socket MEDIA_ATTACHED must be emitted");
    console.log(" ✅ Asynchronous Proof Media Attachment & Socket notification passed.");

    // --- 5. Testing GET /api/dispatch/incidents ---
    console.log("\n --- 5. Testing Incident Listing (getIncidents) ---");
    const { getIncidents, getIncidentById, updateIncidentStatus, getFacilities } = require("../controllers/dispatchController");
    Incident.find = function () {
      return {
        sort: () => ({
          skip: () => ({
            limit: () => Promise.resolve([mockIncidentInstance]),
          }),
        }),
      };
    };
    Incident.countDocuments = () => Promise.resolve(1);

    await getIncidents({ query: {} }, resMock);
    assert.strictEqual(resCode, 200);
    assert.strictEqual(resBody.count, 1);
    console.log(" ✅ Incident listing (getIncidents) passed.");

    // --- 6. Testing PATCH /api/dispatch/incident/:id/status ---
    console.log("\n --- 6. Testing Status Transition & Socket Broadcast (updateIncidentStatus) ---");
    mockIncidentInstance.status = "DISPATCHED";
    mockIncidentInstance.statusHistory = [];

    let statusUpdatedSocket = null;
    clientSocket.on("STATUS_UPDATED", (p) => {
      statusUpdatedSocket = p;
    });

    await updateIncidentStatus(
      {
        params: { id: "inc_12345" },
        body: { status: "EN_ROUTE", note: "Ambulance en route", responderName: "Unit 4" },
      },
      resMock
    );

    await new Promise((r) => setTimeout(r, 200));

    assert.strictEqual(resCode, 200);
    assert.strictEqual(mockIncidentInstance.status, "EN_ROUTE");
    assert.strictEqual(mockIncidentInstance.statusHistory.length, 1);
    assert.ok(statusUpdatedSocket, "STATUS_UPDATED socket event must be emitted");
    assert.strictEqual(statusUpdatedSocket.status, "EN_ROUTE");
    console.log(" ✅ Incident status transition to EN_ROUTE & STATUS_UPDATED socket event passed.");

    // --- 7. Testing GET /api/dispatch/facilities ---
    console.log("\n --- 7. Testing Facilities Query (getFacilities) ---");
    Hospital.find = () => Promise.resolve([{ name: "General Hospital" }]);
    FireStation.find = () => Promise.resolve([{ name: "Central Fire" }]);
    User.find = () => ({ select: () => Promise.resolve([{ name: "Volunteer John" }]) });

    await getFacilities({}, resMock);
    assert.strictEqual(resCode, 200);
    assert.strictEqual(resBody.facilities.hospitals.length, 1);
    assert.strictEqual(resBody.facilities.fireStations.length, 1);
    assert.strictEqual(resBody.facilities.volunteers.length, 1);
    console.log(" ✅ Facilities query (getFacilities) passed.");

    // --- 8. Testing GET /api/dispatch/incident/:id/audit-trail ---
    console.log("\n --- 8. Testing Incident Audit Trail (getIncidentAuditTrail) ---");
    const { getIncidentAuditTrail } = require("../controllers/dispatchController");
    Incident.findById = (id) => ({
      select: () => Promise.resolve({
        _id: id,
        type: "MEDICAL",
        status: "EN_ROUTE",
        createdAt: new Date(),
        statusHistory: [
          { status: "DISPATCHED", changedAt: new Date(), note: "Dispatched initial" },
          { status: "EN_ROUTE", changedAt: new Date(), note: "Ambulance moving" }
        ],
        assignedUnits: [{ name: "Ambulance Unit 1" }]
      })
    });

    await getIncidentAuditTrail({ params: { id: "inc_12345" } }, resMock);
    assert.strictEqual(resCode, 200);
    assert.strictEqual(resBody.success, true);
    assert.strictEqual(resBody.totalTransitions, 2);
    assert.strictEqual(resBody.timeline.length, 2);
    console.log(" ✅ Incident Audit Trail retrieval passed.");

    // --- 9. Testing GET /api/hospitals/capacity-overview ---
    console.log("\n --- 9. Testing Hospital Capacity Overview (getCapacityOverview) ---");
    const { getCapacityOverview, updateHospitalCapacity } = require("../controllers/hospitalController");
    const mockHospitalsList = [
      {
        _id: "hosp_1",
        name: "Lagos St. Nicholas",
        isOperational: true,
        capacity: { total: 40, available: 15, icuAvailable: 4 },
        ambulances: { total: 4, activeOnCall: 1 }
      },
      {
        _id: "hosp_2",
        name: "LUTH Central",
        isOperational: true,
        capacity: { total: 100, available: 30, icuAvailable: 10 },
        ambulances: { total: 8, activeOnCall: 3 }
      }
    ];
    Hospital.find = () => ({
      select: () => Promise.resolve(mockHospitalsList)
    });

    await getCapacityOverview({}, resMock);
    assert.strictEqual(resCode, 200);
    assert.strictEqual(resBody.summary.totalHospitals, 2);
    assert.strictEqual(resBody.summary.totalBeds, 140);
    assert.strictEqual(resBody.summary.availableBeds, 45);
    assert.strictEqual(resBody.summary.totalIcuBeds, 14);
    assert.strictEqual(resBody.summary.totalAmbulances, 12);
    assert.strictEqual(resBody.summary.ambulancesOnCall, 4);
    console.log(" ✅ Hospital Capacity Overview passed.");

    // --- 10. Testing PATCH /api/hospitals/:id/capacity & Socket Broadcast ---
    console.log("\n --- 10. Testing Hospital Capacity Update & Socket Broadcast ---");
    const mockHospitalDoc = {
      _id: "hosp_1",
      name: "Lagos St. Nicholas",
      isOperational: true,
      capacity: { total: 40, available: 15, icuAvailable: 4, oxygenAvailable: true },
      ambulances: { total: 4, activeOnCall: 1 },
      availableAmbulances: 4,
      save: function () { return Promise.resolve(this); }
    };
    Hospital.findById = () => Promise.resolve(mockHospitalDoc);

    let capacitySocketEvent = null;
    clientSocket.on("HOSPITAL_CAPACITY_UPDATED", (p) => {
      capacitySocketEvent = p;
    });

    await updateHospitalCapacity(
      {
        params: { id: "hosp_1" },
        body: {
          capacity: { available: 10, icuAvailable: 2, oxygenAvailable: true },
          ambulances: { activeOnCall: 2 }
        }
      },
      resMock
    );

    await new Promise((r) => setTimeout(r, 200));
    assert.strictEqual(resCode, 200);
    assert.strictEqual(mockHospitalDoc.capacity.available, 10);
    assert.strictEqual(mockHospitalDoc.capacity.icuAvailable, 2);
    assert.strictEqual(mockHospitalDoc.ambulances.activeOnCall, 2);
    assert.ok(capacitySocketEvent, "HOSPITAL_CAPACITY_UPDATED socket event must be received");
    console.log(" ✅ Hospital Capacity Update & Socket Broadcast passed.");

    // --- 11. Testing POST /api/notifications/sms-webhook ---
    console.log("\n --- 11. Testing SMS Fallback Webhook (handleSmsWebhook) ---");
    const { handleSmsWebhook } = require("../controllers/notificationController");
    User.findOne = () => Promise.resolve({ name: "Volunteer John", phone: "+2347010001111" });
    const mockSmsIncident = {
      _id: "inc_9999",
      status: "DISPATCHED",
      statusHistory: [],
      save: function () { return Promise.resolve(this); }
    };
    Incident.findById = () => Promise.resolve(mockSmsIncident);

    await handleSmsWebhook(
      {
        body: {
          from: "+2347010001111",
          message: "EN ROUTE",
          incidentId: "inc_9999"
        },
        headers: {}
      },
      resMock
    );

    assert.strictEqual(resCode, 200);
    assert.strictEqual(resBody.success, true);
    assert.strictEqual(resBody.updatedStatus, "EN_ROUTE");
    assert.strictEqual(mockSmsIncident.status, "EN_ROUTE");
    assert.strictEqual(mockSmsIncident.statusHistory.length, 1);
    console.log(" ✅ SMS Fallback Webhook status transition passed.");

    // Restore functions
    Hospital.find = origHospitalFind;
    Incident.create = origIncidentCreate;
    FireStation.find = origFireFind;
    User.find = origUserFind;
    Incident.findById = origIncidentFindById;

    console.log("\n=================================================");
    console.log(" 🎉 ALL 11 COMPREHENSIVE ARCHITECTURAL TESTS PASSED!");
    console.log("=================================================\n");
  } finally {
    clientSocket.close();
    server.close();
  }
}

runUnitVerification();
