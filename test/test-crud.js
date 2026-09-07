/**
 * ================================================================
 *  Emergency Response Network — FULL CRUD TEST SUITE
 *  Tests: POST · GET · PATCH · DELETE (404 edges)
 *  Coverage:
 *    ✅ Auth Routes       (POST register, POST login, GET me, PATCH location)
 *    ✅ Dispatch Routes   (POST sos, POST media, GET incidents, GET incident/:id,
 *                          GET incident/:id/audit-trail, PATCH status, GET facilities)
 *    ✅ Hospital Routes   (GET capacity-overview, GET /:id/capacity, PATCH /:id/capacity)
 *    ✅ Notification      (POST sms-webhook)
 *    ✅ 404 / Validation  (missing fields, bad IDs, wrong status values)
 * ================================================================
 */

const assert = require("assert");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const { io: Client } = require("socket.io-client");

// ── Controllers ──────────────────────────────────────────────────────────────
const {
  dispatchSOS,
  attachVerificationMedia,
  getIncidents,
  getIncidentById,
  updateIncidentStatus,
  getFacilities,
  getIncidentAuditTrail,
} = require("../controllers/dispatchController");

const {
  getCapacityOverview,
  getHospitalCapacity,
  updateHospitalCapacity,
} = require("../controllers/hospitalController");

const {
  registerUser,
  loginUser,
  getMe,
  updateLocation,
} = require("../controllers/authController");

const { handleSmsWebhook } = require("../controllers/notificationController");
const { initEmergencySocket } = require("../sockets/emergencySocket");

// ── Models ────────────────────────────────────────────────────────────────────
const Hospital = require("../models/Hospital");
const FireStation = require("../models/FireStation");
const User = require("../models/User");
const Incident = require("../models/Incident");

// ── Auth ──────────────────────────────────────────────────────────────────────
const { generateToken } = require("../middleware/authMiddleware");

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Build a mock Express res object */
function buildRes() {
  let statusCode = null;
  let body = null;
  const res = {
    status(code) { statusCode = code; return res; },
    json(data)   { body = data; return res; },
    get code()   { return statusCode; },
    get body()   { return body; },
  };
  return res;
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST RUNNER
// ─────────────────────────────────────────────────────────────────────────────

async function runCrudTests() {
  console.log("=================================================================");
  console.log(" 🧪  FULL CRUD TEST SUITE  —  Emergency Response Network Backend");
  console.log("=================================================================\n");

  // ── Socket server (needed by controllers that emit events) ─────────────────
  const port = 5099;
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  const ioServer = new Server(server);
  initEmergencySocket(ioServer);

  await new Promise((r) => server.listen(port, r));
  const client = Client(`http://localhost:${port}`);
  await new Promise((r) => client.on("connect", r));
  client.emit("JOIN_ROOM", "hospitals");
  client.emit("JOIN_ROOM", "dispatch_consoles");
  await new Promise((r) => setTimeout(r, 80));

  // Save originals so we can restore after every section
  const orig = {
    HospitalFind:     Hospital.find,
    HospitalFindById: Hospital.findById,
    HospitalCreate:   Hospital.create,
    FireFind:         FireStation.find,
    UserFind:         User.find,
    UserFindOne:      User.findOne,
    UserCreate:       User.create,
    UserFindById:     User.findById,
    IncidentFind:     Incident.find,
    IncidentFindById: Incident.findById,
    IncidentCreate:   Incident.create,
    IncidentCount:    Incident.countDocuments,
  };

  let passed = 0;
  let failed = 0;

  function ok(label) {
    console.log(`   ✅  ${label}`);
    passed++;
  }
  function fail(label, err) {
    console.error(`   ❌  ${label}`);
    console.error(`       ${err?.message || err}`);
    failed++;
  }

  try {

    // ══════════════════════════════════════════════════════════════════════════
    //  SECTION A — AUTH  (POST register · POST login · GET me · PATCH location)
    // ══════════════════════════════════════════════════════════════════════════
    console.log("── SECTION A: AUTH ──────────────────────────────────────────────");

    // ── A1  POST /api/auth/register  (happy path) ────────────────────────────
    try {
      User.findOne = () => Promise.resolve(null);  // no duplicate email
      User.create = (data) => Promise.resolve({
        _id: "user_001",
        name: data.name,
        email: data.email,
        phone: data.phone,
        role: data.role || "victim",
        agency: data.agency,
        location: data.location,
      });

      const res = buildRes();
      await registerUser(
        { body: { name: "Test User", email: "test@ern.ng", phone: "+2348001112222", password: "Secret123" } },
        res
      );
      assert.strictEqual(res.code, 201, "register → 201");
      assert.ok(res.body.token, "register → token present");
      assert.strictEqual(res.body.user.email, "test@ern.ng");
      ok("A1 · POST /api/auth/register (success)");
    } catch (e) { fail("A1 · POST /api/auth/register (success)", e); }

    // ── A2  POST /api/auth/register  — missing required fields ──────────────
    try {
      const res = buildRes();
      await registerUser({ body: { email: "nophone@ern.ng" } }, res);
      assert.strictEqual(res.code, 400, "missing name/phone → 400");
      ok("A2 · POST /api/auth/register (missing name/phone → 400)");
    } catch (e) { fail("A2 · POST /api/auth/register (missing name/phone → 400)", e); }

    // ── A3  POST /api/auth/register  — duplicate email ───────────────────────
    try {
      User.findOne = () => Promise.resolve({ _id: "existing" }); // duplicate
      const res = buildRes();
      await registerUser(
        { body: { name: "Dup", email: "dup@ern.ng", phone: "+2348009999999" } },
        res
      );
      assert.strictEqual(res.code, 400, "dup email → 400");
      ok("A3 · POST /api/auth/register (duplicate email → 400)");
    } catch (e) { fail("A3 · POST /api/auth/register (duplicate email → 400)", e); }

    // ── A4  POST /api/auth/login  (happy path) ───────────────────────────────
    try {
      User.findOne = () => ({
        select: () => Promise.resolve({
          _id: "user_001",
          name: "Test User",
          email: "test@ern.ng",
          phone: "+2348001112222",
          role: "victim",
          matchPassword: () => Promise.resolve(true),
        }),
      });

      const res = buildRes();
      await loginUser({ body: { email: "test@ern.ng", password: "Secret123" } }, res);
      assert.strictEqual(res.code, 200, "login → 200");
      assert.ok(res.body.token, "login → token present");
      ok("A4 · POST /api/auth/login (success)");
    } catch (e) { fail("A4 · POST /api/auth/login (success)", e); }

    // ── A5  POST /api/auth/login  — bad credentials ──────────────────────────
    try {
      User.findOne = () => ({
        select: () => Promise.resolve({
          _id: "user_001",
          matchPassword: () => Promise.resolve(false),
        }),
      });

      const res = buildRes();
      await loginUser({ body: { email: "test@ern.ng", password: "wrongpass" } }, res);
      assert.strictEqual(res.code, 401, "bad password → 401");
      ok("A5 · POST /api/auth/login (wrong password → 401)");
    } catch (e) { fail("A5 · POST /api/auth/login (wrong password → 401)", e); }

    // ── A6  POST /api/auth/login  — missing body ─────────────────────────────
    try {
      const res = buildRes();
      await loginUser({ body: {} }, res);
      assert.strictEqual(res.code, 400, "missing email/pass → 400");
      ok("A6 · POST /api/auth/login (missing email/password → 400)");
    } catch (e) { fail("A6 · POST /api/auth/login (missing email/password → 400)", e); }

    // ── A7  GET /api/auth/me  (happy path) ───────────────────────────────────
    try {
      const res = buildRes();
      await getMe({ user: { _id: "user_001", name: "Test User", role: "victim" } }, res);
      assert.strictEqual(res.code, 200, "getMe → 200");
      assert.ok(res.body.user, "getMe → user present");
      ok("A7 · GET /api/auth/me (success)");
    } catch (e) { fail("A7 · GET /api/auth/me (success)", e); }

    // ── A8  PATCH /api/auth/location  (happy path) ───────────────────────────
    try {
      const mockUser = {
        _id: "user_001",
        location: {},
        save: function () { return Promise.resolve(this); },
      };
      User.findById = () => Promise.resolve(mockUser);

      const res = buildRes();
      await updateLocation(
        { user: { _id: "user_001" }, body: { coordinates: [3.3792, 6.5244] } },
        res
      );
      assert.strictEqual(res.code, 200, "updateLocation → 200");
      assert.deepStrictEqual(mockUser.location.coordinates, [3.3792, 6.5244]);
      ok("A8 · PATCH /api/auth/location (success)");
    } catch (e) { fail("A8 · PATCH /api/auth/location (success)", e); }

    // ── A9  PATCH /api/auth/location  — bad coordinates ──────────────────────
    try {
      const res = buildRes();
      await updateLocation(
        { user: { _id: "user_001" }, body: { coordinates: [3.3792] } }, // only 1 value
        res
      );
      assert.strictEqual(res.code, 400, "bad coordinates → 400");
      ok("A9 · PATCH /api/auth/location (bad coordinates → 400)");
    } catch (e) { fail("A9 · PATCH /api/auth/location (bad coordinates → 400)", e); }

    // ══════════════════════════════════════════════════════════════════════════
    //  SECTION B — DISPATCH  (POST sos · POST media · GET · PATCH)
    // ══════════════════════════════════════════════════════════════════════════
    console.log("\n── SECTION B: DISPATCH ──────────────────────────────────────────");

    const mockIncident = {
      _id: "inc_crud_001",
      type: "MEDICAL",
      status: "DISPATCHED",
      statusHistory: [],
      media: [],
      assignedUnits: [{ name: "St. Nicholas Hospital" }],
      createdAt: new Date(),
      save: function () { return Promise.resolve(this); },
    };

    // ── B1  POST /api/dispatch/sos  MEDICAL  (happy path) ────────────────────
    try {
      Hospital.find = () => Promise.resolve([{ _id: "h1", name: "Central Hospital" }]);
      Incident.create = (data) => Promise.resolve({ _id: "inc_med_01", ...data, media: [] });

      const res = buildRes();
      await dispatchSOS(
        { body: { type: "MEDICAL", coordinates: [3.3792, 6.5244], description: "Heart attack" } },
        res
      );
      assert.strictEqual(res.code, 201, "medical sos → 201");
      assert.ok(res.body.incident._id, "medical sos → incident created");
      assert.strictEqual(res.body.dispatchTier, "TIER_1_HOSPITAL");
      ok("B1 · POST /api/dispatch/sos (MEDICAL success → TIER_1_HOSPITAL)");
    } catch (e) { fail("B1 · POST /api/dispatch/sos (MEDICAL success)", e); }

    // ── B2  POST /api/dispatch/sos  FIRE Tier-1  (happy path) ────────────────
    try {
      FireStation.find = () => Promise.resolve([{ _id: "fs1", name: "Ikeja Fire Station" }]);
      Incident.create = (data) => Promise.resolve({ _id: "inc_fire_01", ...data, media: [] });

      const res = buildRes();
      await dispatchSOS(
        { body: { type: "FIRE", coordinates: [3.3792, 6.5244] } },
        res
      );
      assert.strictEqual(res.code, 201, "fire tier1 sos → 201");
      assert.strictEqual(res.body.dispatchTier, "TIER_1_FIRE_STATION");
      ok("B2 · POST /api/dispatch/sos (FIRE Tier-1 success → TIER_1_FIRE_STATION)");
    } catch (e) { fail("B2 · POST /api/dispatch/sos (FIRE Tier-1 success)", e); }

    // ── B3  POST /api/dispatch/sos  FIRE Tier-2 fallback ─────────────────────
    try {
      FireStation.find = () => Promise.resolve([]);  // no fire stations
      User.find = () => Promise.resolve([{ _id: "v1", name: "Volunteer A" }]);
      Incident.create = (data) => Promise.resolve({ _id: "inc_fire_02", ...data, media: [] });

      const res = buildRes();
      await dispatchSOS(
        { body: { type: "FIRE", coordinates: [3.3792, 6.5244] } },
        res
      );
      assert.strictEqual(res.code, 201, "fire tier2 fallback → 201");
      assert.strictEqual(res.body.dispatchTier, "TIER_2_VOLUNTEER_VICINITY");
      ok("B3 · POST /api/dispatch/sos (FIRE Tier-2 fallback → TIER_2_VOLUNTEER_VICINITY)");
    } catch (e) { fail("B3 · POST /api/dispatch/sos (FIRE Tier-2 fallback)", e); }

    // ── B4  POST /api/dispatch/sos  — invalid type ───────────────────────────
    try {
      const res = buildRes();
      await dispatchSOS(
        { body: { type: "EARTHQUAKE", coordinates: [3.3792, 6.5244] } },
        res
      );
      assert.strictEqual(res.code, 400, "invalid type → 400");
      ok("B4 · POST /api/dispatch/sos (invalid type → 400)");
    } catch (e) { fail("B4 · POST /api/dispatch/sos (invalid type → 400)", e); }

    // ── B5  POST /api/dispatch/sos  — missing coordinates ────────────────────
    try {
      const res = buildRes();
      await dispatchSOS(
        { body: { type: "MEDICAL" } },  // no coordinates
        res
      );
      assert.strictEqual(res.code, 400, "missing coords → 400");
      ok("B5 · POST /api/dispatch/sos (missing coordinates → 400)");
    } catch (e) { fail("B5 · POST /api/dispatch/sos (missing coordinates → 400)", e); }

    // ── B6  POST /api/dispatch/incident/:id/media  — JSON URL ────────────────
    try {
      const localIncident = {
        _id: "inc_crud_001",
        media: [],
        save: function () { return Promise.resolve(this); },
      };
      Incident.findById = () => Promise.resolve(localIncident);

      const res = buildRes();
      await attachVerificationMedia(
        {
          params: { id: "inc_crud_001" },
          body: { mediaUrl: "https://cdn.ern.ng/photo.jpg", mediaType: "PHOTO" },
          file: null,
          protocol: "http",
          get: () => "localhost:5099",
        },
        res
      );
      assert.strictEqual(res.code, 200, "attach media → 200");
      assert.strictEqual(localIncident.media.length, 1);
      assert.strictEqual(localIncident.media[0].mediaType, "PHOTO");
      ok("B6 · POST /api/dispatch/incident/:id/media (JSON URL success)");
    } catch (e) { fail("B6 · POST /api/dispatch/incident/:id/media (JSON URL)", e); }

    // ── B7  POST /api/dispatch/incident/:id/media  — incident not found ───────
    try {
      Incident.findById = () => Promise.resolve(null);
      const res = buildRes();
      await attachVerificationMedia(
        {
          params: { id: "nonexistent_id" },
          body: { mediaUrl: "https://cdn.ern.ng/photo.jpg" },
          file: null,
          protocol: "http",
          get: () => "localhost:5099",
        },
        res
      );
      assert.strictEqual(res.code, 404, "incident not found → 404");
      ok("B7 · POST /api/dispatch/incident/:id/media (incident not found → 404)");
    } catch (e) { fail("B7 · POST /api/dispatch/incident/:id/media (not found → 404)", e); }

    // ── B8  POST /api/dispatch/incident/:id/media  — no URL & no file ────────
    try {
      Incident.findById = () => Promise.resolve({ _id: "inc_crud_001", media: [] });
      const res = buildRes();
      await attachVerificationMedia(
        {
          params: { id: "inc_crud_001" },
          body: {},
          file: null,
          protocol: "http",
          get: () => "localhost:5099",
        },
        res
      );
      assert.strictEqual(res.code, 400, "no URL or file → 400");
      ok("B8 · POST /api/dispatch/incident/:id/media (no URL/file → 400)");
    } catch (e) { fail("B8 · POST /api/dispatch/incident/:id/media (no URL/file → 400)", e); }

    // ── B9  GET /api/dispatch/incidents  (happy path) ────────────────────────
    try {
      Incident.find = () => ({
        sort: () => ({ skip: () => ({ limit: () => Promise.resolve([mockIncident]) }) }),
      });
      Incident.countDocuments = () => Promise.resolve(1);

      const res = buildRes();
      await getIncidents({ query: {} }, res);
      assert.strictEqual(res.code, 200, "get incidents → 200");
      assert.strictEqual(res.body.incidents.length, 1);
      assert.strictEqual(res.body.total, 1);
      ok("B9 · GET /api/dispatch/incidents (success)");
    } catch (e) { fail("B9 · GET /api/dispatch/incidents (success)", e); }

    // ── B10 GET /api/dispatch/incidents  — filtered by status & type ──────────
    try {
      let capturedFilter = {};
      Incident.find = (filter) => {
        capturedFilter = filter;
        return {
          sort: () => ({ skip: () => ({ limit: () => Promise.resolve([]) }) }),
        };
      };
      Incident.countDocuments = () => Promise.resolve(0);

      const res = buildRes();
      await getIncidents({ query: { status: "dispatched", type: "fire", page: "1", limit: "10" } }, res);
      assert.strictEqual(res.code, 200, "filtered incidents → 200");
      assert.strictEqual(capturedFilter.status, "DISPATCHED", "filter status uppercased");
      assert.strictEqual(capturedFilter.type, "FIRE", "filter type uppercased");
      ok("B10 · GET /api/dispatch/incidents (filters: status & type, uppercased)");
    } catch (e) { fail("B10 · GET /api/dispatch/incidents (filters)", e); }

    // ── B11 GET /api/dispatch/incident/:id  (happy path) ─────────────────────
    try {
      Incident.findById = () => Promise.resolve(mockIncident);
      const res = buildRes();
      await getIncidentById({ params: { id: "inc_crud_001" } }, res);
      assert.strictEqual(res.code, 200, "get by id → 200");
      assert.strictEqual(res.body.incident._id, "inc_crud_001");
      ok("B11 · GET /api/dispatch/incident/:id (success)");
    } catch (e) { fail("B11 · GET /api/dispatch/incident/:id (success)", e); }

    // ── B12 GET /api/dispatch/incident/:id  — not found ──────────────────────
    try {
      Incident.findById = () => Promise.resolve(null);
      const res = buildRes();
      await getIncidentById({ params: { id: "bad_id" } }, res);
      assert.strictEqual(res.code, 404, "not found → 404");
      ok("B12 · GET /api/dispatch/incident/:id (not found → 404)");
    } catch (e) { fail("B12 · GET /api/dispatch/incident/:id (not found → 404)", e); }

    // ── B13 PATCH /api/dispatch/incident/:id/status  (happy path) ────────────
    try {
      const patchableIncident = {
        _id: "inc_crud_001",
        status: "DISPATCHED",
        statusHistory: [],
        save: function () { return Promise.resolve(this); },
      };
      Incident.findById = () => Promise.resolve(patchableIncident);

      const res = buildRes();
      await updateIncidentStatus(
        { params: { id: "inc_crud_001" }, body: { status: "acknowledged", note: "Unit confirmed", responderName: "Unit A" } },
        res
      );
      assert.strictEqual(res.code, 200, "status update → 200");
      assert.strictEqual(patchableIncident.status, "ACKNOWLEDGED");
      assert.strictEqual(patchableIncident.statusHistory.length, 1);
      ok("B13 · PATCH /api/dispatch/incident/:id/status (EN_ROUTE success)");
    } catch (e) { fail("B13 · PATCH /api/dispatch/incident/:id/status (success)", e); }

    // ── B14 PATCH /api/dispatch/incident/:id/status  — invalid status ────────
    try {
      const res = buildRes();
      await updateIncidentStatus(
        { params: { id: "inc_crud_001" }, body: { status: "TELEPORTED" } },
        res
      );
      assert.strictEqual(res.code, 400, "invalid status → 400");
      ok("B14 · PATCH /api/dispatch/incident/:id/status (invalid status → 400)");
    } catch (e) { fail("B14 · PATCH /api/dispatch/incident/:id/status (invalid status → 400)", e); }

    // ── B15 PATCH /api/dispatch/incident/:id/status  — incident not found ─────
    try {
      Incident.findById = () => Promise.resolve(null);
      const res = buildRes();
      await updateIncidentStatus(
        { params: { id: "ghost_id" }, body: { status: "RESOLVED" } },
        res
      );
      assert.strictEqual(res.code, 404, "not found → 404");
      ok("B15 · PATCH /api/dispatch/incident/:id/status (incident not found → 404)");
    } catch (e) { fail("B15 · PATCH /api/dispatch/incident/:id/status (not found → 404)", e); }

    // ── B16 GET /api/dispatch/incident/:id/audit-trail  (happy path) ──────────
    try {
      Incident.findById = () => ({
        select: () => Promise.resolve({
          _id: "inc_crud_001",
          type: "MEDICAL",
          status: "RESOLVED",
          createdAt: new Date(),
          statusHistory: [
            { status: "DISPATCHED", changedAt: new Date(), note: "Initial" },
            { status: "EN_ROUTE",   changedAt: new Date(), note: "Moving" },
            { status: "RESOLVED",   changedAt: new Date(), note: "Done" },
          ],
          assignedUnits: [{ name: "Unit 1" }],
        }),
      });

      const res = buildRes();
      await getIncidentAuditTrail({ params: { id: "inc_crud_001" } }, res);
      assert.strictEqual(res.code, 200, "audit trail → 200");
      assert.strictEqual(res.body.totalTransitions, 3);
      assert.strictEqual(res.body.timeline.length, 3);
      ok("B16 · GET /api/dispatch/incident/:id/audit-trail (3 transitions)");
    } catch (e) { fail("B16 · GET /api/dispatch/incident/:id/audit-trail (success)", e); }

    // ── B17 GET /api/dispatch/incident/:id/audit-trail  — not found ───────────
    try {
      Incident.findById = () => ({ select: () => Promise.resolve(null) });
      const res = buildRes();
      await getIncidentAuditTrail({ params: { id: "ghost_id" } }, res);
      assert.strictEqual(res.code, 404, "audit trail not found → 404");
      ok("B17 · GET /api/dispatch/incident/:id/audit-trail (not found → 404)");
    } catch (e) { fail("B17 · GET /api/dispatch/incident/:id/audit-trail (not found → 404)", e); }

    // ── B18 GET /api/dispatch/facilities  (happy path) ────────────────────────
    try {
      Hospital.find   = () => Promise.resolve([{ name: "General Hospital" }]);
      FireStation.find = () => Promise.resolve([{ name: "Central Fire" }]);
      User.find       = () => ({ select: () => Promise.resolve([{ name: "Volunteer Eze" }]) });

      const res = buildRes();
      await getFacilities({}, res);
      assert.strictEqual(res.code, 200, "facilities → 200");
      assert.strictEqual(res.body.facilities.hospitals.length, 1);
      assert.strictEqual(res.body.facilities.fireStations.length, 1);
      assert.strictEqual(res.body.facilities.volunteers.length, 1);
      ok("B18 · GET /api/dispatch/facilities (success)");
    } catch (e) { fail("B18 · GET /api/dispatch/facilities (success)", e); }

    // ══════════════════════════════════════════════════════════════════════════
    //  SECTION C — HOSPITALS  (GET capacity-overview · GET/:id/capacity · PATCH)
    // ══════════════════════════════════════════════════════════════════════════
    console.log("\n── SECTION C: HOSPITALS ─────────────────────────────────────────");

    const mockHospitals = [
      {
        _id: "hosp_1",
        name: "Lagos Central",
        isOperational: true,
        capacity: { total: 50, available: 20, icuAvailable: 5 },
        ambulances: { total: 6, activeOnCall: 2 },
      },
      {
        _id: "hosp_2",
        name: "LUTH",
        isOperational: true,
        capacity: { total: 100, available: 40, icuAvailable: 10 },
        ambulances: { total: 10, activeOnCall: 4 },
      },
    ];

    // ── C1  GET /api/hospitals/capacity-overview  (happy path) ───────────────
    try {
      Hospital.find = () => ({ select: () => Promise.resolve(mockHospitals) });
      const res = buildRes();
      await getCapacityOverview({}, res);
      assert.strictEqual(res.code, 200, "capacity overview → 200");
      assert.strictEqual(res.body.summary.totalHospitals, 2);
      assert.strictEqual(res.body.summary.totalBeds, 150);
      assert.strictEqual(res.body.summary.availableBeds, 60);
      assert.strictEqual(res.body.summary.totalIcuBeds, 15);
      assert.strictEqual(res.body.summary.totalAmbulances, 16);
      assert.strictEqual(res.body.summary.ambulancesOnCall, 6);
      ok("C1 · GET /api/hospitals/capacity-overview (totals correct)");
    } catch (e) { fail("C1 · GET /api/hospitals/capacity-overview (totals correct)", e); }

    // ── C2  GET /api/hospitals/capacity-overview  — empty ────────────────────
    try {
      Hospital.find = () => ({ select: () => Promise.resolve([]) });
      const res = buildRes();
      await getCapacityOverview({}, res);
      assert.strictEqual(res.code, 200, "empty overview → 200");
      assert.strictEqual(res.body.summary.totalHospitals, 0);
      assert.strictEqual(res.body.summary.totalBeds, 0);
      ok("C2 · GET /api/hospitals/capacity-overview (empty list → 200)");
    } catch (e) { fail("C2 · GET /api/hospitals/capacity-overview (empty)", e); }

    // ── C3  GET /api/hospitals/:id/capacity  (happy path) ────────────────────
    try {
      Hospital.findById = () => ({
        select: () => Promise.resolve({
          _id: "hosp_1",
          name: "Lagos Central",
          isOperational: true,
          capacity: { total: 50, available: 20, icuAvailable: 5 },
          ambulances: { total: 6, activeOnCall: 2 },
        }),
      });

      const res = buildRes();
      await getHospitalCapacity({ params: { id: "hosp_1" } }, res);
      assert.strictEqual(res.code, 200, "hospital capacity → 200");
      assert.strictEqual(res.body.name, "Lagos Central");
      assert.strictEqual(res.body.capacity.total, 50);
      ok("C3 · GET /api/hospitals/:id/capacity (success)");
    } catch (e) { fail("C3 · GET /api/hospitals/:id/capacity (success)", e); }

    // ── C4  GET /api/hospitals/:id/capacity  — not found ─────────────────────
    try {
      Hospital.findById = () => ({ select: () => Promise.resolve(null) });
      const res = buildRes();
      await getHospitalCapacity({ params: { id: "ghost_hosp" } }, res);
      assert.strictEqual(res.code, 404, "hospital not found → 404");
      ok("C4 · GET /api/hospitals/:id/capacity (not found → 404)");
    } catch (e) { fail("C4 · GET /api/hospitals/:id/capacity (not found → 404)", e); }

    // ── C5  PATCH /api/hospitals/:id/capacity  (happy path) ──────────────────
    try {
      const liveHospital = {
        _id: "hosp_1",
        name: "Lagos Central",
        isOperational: true,
        capacity: { total: 50, available: 20, icuAvailable: 5, oxygenAvailable: false },
        ambulances: { total: 6, activeOnCall: 2 },
        availableAmbulances: 6,
        save: function () { return Promise.resolve(this); },
      };
      Hospital.findById = () => Promise.resolve(liveHospital);

      const res = buildRes();
      await updateHospitalCapacity(
        {
          params: { id: "hosp_1" },
          body: {
            capacity: { available: 12, icuAvailable: 3, oxygenAvailable: true },
            ambulances: { activeOnCall: 3 },
          },
        },
        res
      );
      assert.strictEqual(res.code, 200, "update capacity → 200");
      assert.strictEqual(liveHospital.capacity.available, 12);
      assert.strictEqual(liveHospital.capacity.icuAvailable, 3);
      assert.strictEqual(liveHospital.capacity.oxygenAvailable, true);
      assert.strictEqual(liveHospital.ambulances.activeOnCall, 3);
      ok("C5 · PATCH /api/hospitals/:id/capacity (success, values updated)");
    } catch (e) { fail("C5 · PATCH /api/hospitals/:id/capacity (success)", e); }

    // ── C6  PATCH /api/hospitals/:id/capacity  — not found ───────────────────
    try {
      Hospital.findById = () => Promise.resolve(null);
      const res = buildRes();
      await updateHospitalCapacity(
        { params: { id: "ghost_hosp" }, body: { capacity: { available: 5 } } },
        res
      );
      assert.strictEqual(res.code, 404, "hospital not found → 404");
      ok("C6 · PATCH /api/hospitals/:id/capacity (not found → 404)");
    } catch (e) { fail("C6 · PATCH /api/hospitals/:id/capacity (not found → 404)", e); }

    // ── C7  PATCH /api/hospitals/:id/capacity  — toggle isOperational ────────
    try {
      const opHospital = {
        _id: "hosp_1",
        name: "Lagos Central",
        isOperational: true,
        capacity: { total: 50, available: 20, icuAvailable: 5 },
        ambulances: { total: 6, activeOnCall: 2 },
        save: function () { return Promise.resolve(this); },
      };
      Hospital.findById = () => Promise.resolve(opHospital);

      const res = buildRes();
      await updateHospitalCapacity(
        { params: { id: "hosp_1" }, body: { isOperational: false } },
        res
      );
      assert.strictEqual(res.code, 200, "toggle isOperational → 200");
      assert.strictEqual(opHospital.isOperational, false, "hospital marked offline");
      ok("C7 · PATCH /api/hospitals/:id/capacity (toggle isOperational: false)");
    } catch (e) { fail("C7 · PATCH /api/hospitals/:id/capacity (toggle isOperational)", e); }

    // ══════════════════════════════════════════════════════════════════════════
    //  SECTION D — NOTIFICATIONS  (POST sms-webhook)
    // ══════════════════════════════════════════════════════════════════════════
    console.log("\n── SECTION D: NOTIFICATIONS ─────────────────────────────────────");

    // ── D1  POST /api/notifications/sms-webhook  (happy path EN_ROUTE) ───────
    try {
      User.findOne = () => Promise.resolve({ name: "Responder Ali", phone: "+2347010001111" });
      const smsIncident = {
        _id: "inc_sms_01",
        status: "DISPATCHED",
        statusHistory: [],
        save: function () { return Promise.resolve(this); },
      };
      Incident.findById = () => Promise.resolve(smsIncident);

      const res = buildRes();
      await handleSmsWebhook(
        { body: { from: "+2347010001111", message: "EN ROUTE", incidentId: "inc_sms_01" }, headers: {} },
        res
      );
      assert.strictEqual(res.code, 200, "sms webhook → 200");
      assert.strictEqual(smsIncident.status, "EN_ROUTE");
      assert.strictEqual(smsIncident.statusHistory.length, 1);
      ok("D1 · POST /api/notifications/sms-webhook (EN ROUTE transition)");
    } catch (e) { fail("D1 · POST /api/notifications/sms-webhook (EN ROUTE)", e); }

    // ── D2  POST /api/notifications/sms-webhook  (ON SCENE) ──────────────────
    try {
      User.findOne = () => Promise.resolve({ name: "Responder Ali", phone: "+2347010001111" });
      const smsIncident2 = {
        _id: "inc_sms_02",
        status: "EN_ROUTE",
        statusHistory: [],
        save: function () { return Promise.resolve(this); },
      };
      Incident.findById = () => Promise.resolve(smsIncident2);

      const res = buildRes();
      await handleSmsWebhook(
        { body: { from: "+2347010001111", message: "ON SCENE", incidentId: "inc_sms_02" }, headers: {} },
        res
      );
      assert.strictEqual(res.code, 200, "on scene webhook → 200");
      assert.strictEqual(smsIncident2.status, "ON_SCENE");
      ok("D2 · POST /api/notifications/sms-webhook (ON SCENE transition)");
    } catch (e) { fail("D2 · POST /api/notifications/sms-webhook (ON SCENE)", e); }

    // ── D3  POST /api/notifications/sms-webhook  — unknown sender still processes ─
    try {
      // The controller does NOT reject unknown senders — it uses the phone number
      // as a fallback responder name and still processes the incident.
      User.findOne = () => Promise.resolve(null);  // unknown number → fallback name used
      const smsIncident3 = {
        _id: "inc_sms_03",
        status: "DISPATCHED",
        statusHistory: [],
        save: function () { return Promise.resolve(this); },
      };
      Incident.findById = () => Promise.resolve(smsIncident3);

      const res = buildRes();
      await handleSmsWebhook(
        { body: { from: "+0000000000", message: "EN ROUTE", incidentId: "inc_sms_03" }, headers: {} },
        res
      );
      // Unknown sender: controller falls back to phone as name, still updates incident
      assert.strictEqual(res.code, 200, "unknown sender fallback → 200");
      assert.strictEqual(smsIncident3.status, "EN_ROUTE");
      ok("D3 · POST /api/notifications/sms-webhook (unknown sender → fallback name, still 200)");
    } catch (e) { fail("D3 · POST /api/notifications/sms-webhook (unknown sender fallback)", e); }

    // ── D4  POST /api/notifications/sms-webhook  — missing body fields ───────
    try {
      const res = buildRes();
      await handleSmsWebhook(
        { body: {}, headers: {} },  // no from, no message
        res
      );
      assert.strictEqual(res.code, 400, "missing fields → 400");
      ok("D4 · POST /api/notifications/sms-webhook (missing from/message → 400)");
    } catch (e) { fail("D4 · POST /api/notifications/sms-webhook (missing fields → 400)", e); }

  } finally {
    // ── Restore all mocked model methods ────────────────────────────────────
    Hospital.find     = orig.HospitalFind;
    Hospital.findById = orig.HospitalFindById;
    Hospital.create   = orig.HospitalCreate;
    FireStation.find  = orig.FireFind;
    User.find         = orig.UserFind;
    User.findOne      = orig.UserFindOne;
    User.create       = orig.UserCreate;
    User.findById     = orig.UserFindById;
    Incident.find     = orig.IncidentFind;
    Incident.findById = orig.IncidentFindById;
    Incident.create   = orig.IncidentCreate;
    Incident.countDocuments = orig.IncidentCount;

    client.close();
    server.close();
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log("\n=================================================================");
  if (failed === 0) {
    console.log(` 🎉  ALL ${total} CRUD TESTS PASSED!  (${passed} passed · 0 failed)`);
  } else {
    console.log(` ⚠️   ${passed}/${total} TESTS PASSED  —  ${failed} FAILED`);
  }
  console.log("=================================================================\n");

  if (failed > 0) process.exit(1);
}

runCrudTests().catch((err) => {
  console.error("\n[FATAL TEST ERROR]", err);
  process.exit(1);
});
