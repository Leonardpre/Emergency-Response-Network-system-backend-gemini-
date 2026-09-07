/**
 * ================================================================
 *  Emergency Response Network — NEGATIVE / ERROR-PATH TEST SUITE
 *  Phase 1 of the full implementation plan
 *
 *  Tests every controller's REJECTION paths:
 *    ✅ Auth         — missing fields, bad tokens, expired JWT, no-password accounts
 *    ✅ Dispatch     — NaN coords, empty body, malformed IDs, invalid status,
 *                      pagination clamping, media edge cases
 *    ✅ Hospitals    — negative numbers, string coercion, not-found
 *    ✅ Notifications — unrecognised SMS keyword, already-resolved incident,
 *                       missing body, unknown incidentId
 *    ✅ Middleware   — protect() rejects missing / tampered / expired tokens
 * ================================================================
 */

const assert = require("assert");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const { io: Client } = require("socket.io-client");
const jwt = require("jsonwebtoken");

// ── Controllers ───────────────────────────────────────────────────────────────
const {
  dispatchSOS,
  attachVerificationMedia,
  getIncidents,
  getIncidentById,
  updateIncidentStatus,
} = require("../controllers/dispatchController");

const {
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
const { protect, authorize } = require("../middleware/authMiddleware");
const { initEmergencySocket } = require("../sockets/emergencySocket");

// ── Models ────────────────────────────────────────────────────────────────────
const Hospital = require("../models/Hospital");
const FireStation = require("../models/FireStation");
const User = require("../models/User");
const Incident = require("../models/Incident");

const JWT_SECRET = process.env.JWT_SECRET || "aide_check_emergency_jwt_secret_2026";

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

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

/** Simulate the protect() middleware with a given req, returns { code, body } if rejected */
async function runProtect(req) {
  return new Promise((resolve) => {
    const res = buildRes();
    const next = () => resolve(null); // null means it passed through
    protect(req, res, next).then(() => {
      if (res.code) resolve(res);
    }).catch(() => resolve(res));
  });
}

/** Simulate the authorize() middleware */
function runAuthorize(roles, req) {
  return new Promise((resolve) => {
    const res = buildRes();
    const next = () => resolve(null);
    const fn = authorize(...roles);
    fn(req, res, next);
    if (res.code) resolve(res);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST RUNNER
// ─────────────────────────────────────────────────────────────────────────────

async function runNegativeTests() {
  console.log("=================================================================");
  console.log(" 🔴  NEGATIVE / ERROR-PATH TEST SUITE  —  ERN Backend Phase 1");
  console.log("=================================================================\n");

  // ── Socket server setup ───────────────────────────────────────────────────
  const port = 5100;
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  const ioServer = new Server(server);
  initEmergencySocket(ioServer);

  await new Promise((r) => server.listen(port, r));
  const client = Client(`http://localhost:${port}`);
  await new Promise((r) => client.on("connect", r));
  await new Promise((r) => setTimeout(r, 80));

  // Save originals for restore
  const orig = {
    HospitalFind:     Hospital.find,
    HospitalFindById: Hospital.findById,
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
    //  SECTION M — AUTH MIDDLEWARE (protect & authorize)
    // ══════════════════════════════════════════════════════════════════════════
    console.log("── SECTION M: AUTH MIDDLEWARE ───────────────────────────────────");

    // ── M1  protect() — no Authorization header at all
    try {
      const res = await runProtect({ headers: {} });
      assert.ok(res, "should have been rejected");
      assert.strictEqual(res.code, 401, "no token → 401");
      ok("M1 · protect() — no Authorization header → 401");
    } catch (e) { fail("M1 · protect() — no Authorization header → 401", e); }

    // ── M2  protect() — header present but not 'Bearer' format
    try {
      const res = await runProtect({ headers: { authorization: "Basic abc123" } });
      assert.ok(res, "should have been rejected");
      assert.strictEqual(res.code, 401);
      ok("M2 · protect() — Basic auth header (not Bearer) → 401");
    } catch (e) { fail("M2 · protect() — Basic auth header → 401", e); }

    // ── M3  protect() — Bearer token with tampered payload
    try {
      const fakeToken = "Bearer eyJhbGciOiJIUzI1NiJ9.eyJpZCI6ImZha2UifQ.INVALIDSIG";
      const res = await runProtect({ headers: { authorization: fakeToken } });
      assert.ok(res, "tampered token should be rejected");
      assert.strictEqual(res.code, 401);
      ok("M3 · protect() — tampered/invalid JWT signature → 401");
    } catch (e) { fail("M3 · protect() — tampered JWT → 401", e); }

    // ── M4  protect() — expired JWT
    try {
      const expiredToken = jwt.sign({ id: "user_001", role: "victim" }, JWT_SECRET, { expiresIn: "-1s" });
      const res = await runProtect({ headers: { authorization: `Bearer ${expiredToken}` } });
      assert.ok(res, "expired token should be rejected");
      assert.strictEqual(res.code, 401);
      ok("M4 · protect() — expired JWT → 401");
    } catch (e) { fail("M4 · protect() — expired JWT → 401", e); }

    // ── M5  protect() — valid token but user deleted from DB
    try {
      const ghostToken = jwt.sign({ id: "deleted_user_id", role: "victim" }, JWT_SECRET, { expiresIn: "30d" });
      User.findById = () => ({ select: () => Promise.resolve(null) });
      const res = await runProtect({ headers: { authorization: `Bearer ${ghostToken}` } });
      assert.ok(res, "ghost user should be rejected");
      assert.strictEqual(res.code, 401);
      ok("M5 · protect() — valid token but user deleted from DB → 401");
    } catch (e) { fail("M5 · protect() — deleted user → 401", e); }

    // ── M6  authorize() — user role not in allowed list
    try {
      const res = await runAuthorize(
        ["admin", "dispatcher"],
        { user: { _id: "u1", role: "victim" } }
      );
      assert.ok(res, "victim should be forbidden");
      assert.strictEqual(res.code, 403);
      ok("M6 · authorize(['admin','dispatcher']) — victim role → 403 Forbidden");
    } catch (e) { fail("M6 · authorize() — wrong role → 403", e); }

    // ── M7  authorize() — correct role is allowed through
    try {
      const result = await runAuthorize(
        ["admin", "dispatcher"],
        { user: { _id: "u1", role: "dispatcher" } }
      );
      assert.strictEqual(result, null, "dispatcher should pass through");
      ok("M7 · authorize(['admin','dispatcher']) — dispatcher role → passes through");
    } catch (e) { fail("M7 · authorize() — correct role → passes", e); }


    // ══════════════════════════════════════════════════════════════════════════
    //  SECTION A — AUTH CONTROLLER NEGATIVES
    // ══════════════════════════════════════════════════════════════════════════
    console.log("\n── SECTION A: AUTH CONTROLLER NEGATIVES ─────────────────────────");

    // ── A1  register — completely empty body
    try {
      const res = buildRes();
      await registerUser({ body: {} }, res);
      assert.strictEqual(res.code, 400);
      ok("A1 · POST /api/auth/register — empty body → 400");
    } catch (e) { fail("A1 · register — empty body → 400", e); }

    // ── A2  register — name only, no phone
    try {
      const res = buildRes();
      await registerUser({ body: { name: "James" } }, res);
      assert.strictEqual(res.code, 400);
      ok("A2 · POST /api/auth/register — name only, no phone → 400");
    } catch (e) { fail("A2 · register — no phone → 400", e); }

    // ── A3  register — phone only, no name
    try {
      const res = buildRes();
      await registerUser({ body: { phone: "+2348000000001" } }, res);
      assert.strictEqual(res.code, 400);
      ok("A3 · POST /api/auth/register — phone only, no name → 400");
    } catch (e) { fail("A3 · register — no name → 400", e); }

    // ── A4  login — empty body
    try {
      const res = buildRes();
      await loginUser({ body: {} }, res);
      assert.strictEqual(res.code, 400);
      ok("A4 · POST /api/auth/login — empty body → 400");
    } catch (e) { fail("A4 · login — empty body → 400", e); }

    // ── A5  login — email only (no password)
    try {
      const res = buildRes();
      await loginUser({ body: { email: "test@ern.ng" } }, res);
      assert.strictEqual(res.code, 400);
      ok("A5 · POST /api/auth/login — email only → 400");
    } catch (e) { fail("A5 · login — no password → 400", e); }

    // ── A6  login — user not found in DB
    try {
      User.findOne = () => ({ select: () => Promise.resolve(null) });
      const res = buildRes();
      await loginUser({ body: { email: "ghost@ern.ng", password: "any" } }, res);
      assert.strictEqual(res.code, 401);
      ok("A6 · POST /api/auth/login — user not in DB → 401");
    } catch (e) { fail("A6 · login — not in DB → 401", e); }

    // ── A7  login — account exists but no password set (OAuth-style)
    try {
      User.findOne = () => ({
        select: () => Promise.resolve({
          _id: "user_oauth",
          email: "oauth@ern.ng",
          password: undefined,
          matchPassword: async () => false,
        }),
      });
      const res = buildRes();
      await loginUser({ body: { email: "oauth@ern.ng", password: "anything" } }, res);
      assert.strictEqual(res.code, 401);
      ok("A7 · POST /api/auth/login — no-password account → 401");
    } catch (e) { fail("A7 · login — no-password account → 401", e); }

    // ── A8  updateLocation — missing coordinates key
    try {
      const res = buildRes();
      await updateLocation({ user: { _id: "u1" }, body: {} }, res);
      assert.strictEqual(res.code, 400);
      ok("A8 · PATCH /api/auth/location — missing coordinates → 400");
    } catch (e) { fail("A8 · location — missing coords → 400", e); }

    // ── A9  updateLocation — only 1 coordinate
    try {
      const res = buildRes();
      await updateLocation({ user: { _id: "u1" }, body: { coordinates: [3.3792] } }, res);
      assert.strictEqual(res.code, 400);
      ok("A9 · PATCH /api/auth/location — 1 value array → 400");
    } catch (e) { fail("A9 · location — 1 value → 400", e); }

    // ── A10 updateLocation — string instead of array
    try {
      const res = buildRes();
      await updateLocation({ user: { _id: "u1" }, body: { coordinates: "3.3,6.5" } }, res);
      assert.strictEqual(res.code, 400);
      ok("A10 · PATCH /api/auth/location — string coords → 400");
    } catch (e) { fail("A10 · location — string → 400", e); }

    // ── A11 updateLocation — user not found
    try {
      User.findById = () => Promise.resolve(null);
      const res = buildRes();
      await updateLocation({ user: { _id: "ghost" }, body: { coordinates: [3.3, 6.5] } }, res);
      assert.strictEqual(res.code, 404);
      ok("A11 · PATCH /api/auth/location — user not found → 404");
    } catch (e) { fail("A11 · location — not found → 404", e); }


    // ══════════════════════════════════════════════════════════════════════════
    //  SECTION B — DISPATCH CONTROLLER NEGATIVES
    // ══════════════════════════════════════════════════════════════════════════
    console.log("\n── SECTION B: DISPATCH CONTROLLER NEGATIVES ─────────────────────");

    // ── B1  dispatchSOS — completely empty body
    try {
      const res = buildRes();
      await dispatchSOS({ body: {} }, res);
      assert.strictEqual(res.code, 400);
      ok("B1 · POST /api/dispatch/sos — empty body → 400");
    } catch (e) { fail("B1 · sos — empty body → 400", e); }

    // ── B2  dispatchSOS — type missing but coords present
    try {
      const res = buildRes();
      await dispatchSOS({ body: { coordinates: [3.3792, 6.5244] } }, res);
      assert.strictEqual(res.code, 400);
      ok("B2 · POST /api/dispatch/sos — type missing → 400");
    } catch (e) { fail("B2 · sos — missing type → 400", e); }

    // ── B3  dispatchSOS — coords are NaN strings
    try {
      const res = buildRes();
      await dispatchSOS({ body: { type: "MEDICAL", coordinates: ["abc", "xyz"] } }, res);
      assert.strictEqual(res.code, 400);
      ok("B3 · POST /api/dispatch/sos — NaN string coords → 400");
    } catch (e) { fail("B3 · sos — NaN coords → 400", e); }

    // ── B4  dispatchSOS — lowercase 'fire' accepted (case insensitive)
    try {
      FireStation.find = () => Promise.resolve([{ _id: "fs1", name: "Test Station" }]);
      Incident.create = (data) => Promise.resolve({ _id: "inc_x", ...data, media: [] });
      const res = buildRes();
      await dispatchSOS({ body: { type: "fire", coordinates: [3.3792, 6.5244] } }, res);
      assert.strictEqual(res.code, 201);
      ok("B4 · POST /api/dispatch/sos — lowercase 'fire' → case-insensitive → 201");
    } catch (e) { fail("B4 · sos — lowercase type → 201", e); }

    // ── B5  dispatchSOS — numeric type value
    try {
      const res = buildRes();
      await dispatchSOS({ body: { type: 999, coordinates: [3.3792, 6.5244] } }, res);
      assert.strictEqual(res.code, 400);
      ok("B5 · POST /api/dispatch/sos — numeric type → 400");
    } catch (e) { fail("B5 · sos — numeric type → 400", e); }

    // ── B6  dispatchSOS — {longitude, latitude} alternative format works
    try {
      Hospital.find = () => Promise.resolve([{ _id: "h1", name: "Hospital X" }]);
      Incident.create = (data) => Promise.resolve({ _id: "inc_alt", ...data, media: [] });
      const res = buildRes();
      await dispatchSOS({ body: { type: "MEDICAL", longitude: 3.3792, latitude: 6.5244 } }, res);
      assert.strictEqual(res.code, 201);
      ok("B6 · POST /api/dispatch/sos — {longitude, latitude} alt format → 201");
    } catch (e) { fail("B6 · sos — alt coord format → 201", e); }

    // ── B7  getIncidents — page=0 clamped to 1
    try {
      let capturedSkip = null;
      Incident.find = () => ({
        sort: () => ({
          skip: (n) => { capturedSkip = n; return { limit: () => Promise.resolve([]) }; },
        }),
      });
      Incident.countDocuments = () => Promise.resolve(0);
      const res = buildRes();
      await getIncidents({ query: { page: "0" } }, res);
      assert.strictEqual(res.code, 200);
      assert.strictEqual(capturedSkip, 0, "page=0 clamped to 1, skip=0");
      ok("B7 · GET /api/dispatch/incidents — page=0 clamped → 200");
    } catch (e) { fail("B7 · incidents — page=0 clamped → 200", e); }

    // ── B8  getIncidents — page=-99 clamped to 1
    try {
      let capturedSkip = null;
      Incident.find = () => ({
        sort: () => ({
          skip: (n) => { capturedSkip = n; return { limit: () => Promise.resolve([]) }; },
        }),
      });
      Incident.countDocuments = () => Promise.resolve(0);
      const res = buildRes();
      await getIncidents({ query: { page: "-99" } }, res);
      assert.strictEqual(res.code, 200);
      assert.strictEqual(capturedSkip, 0);
      ok("B8 · GET /api/dispatch/incidents — page=-99 clamped → 200");
    } catch (e) { fail("B8 · incidents — page=-99 → 200 safe", e); }

    // ── B9  getIncidents — limit=999 capped at 100
    try {
      let capturedLimit = null;
      Incident.find = () => ({
        sort: () => ({
          skip: () => ({
            limit: (n) => { capturedLimit = n; return Promise.resolve([]); },
          }),
        }),
      });
      Incident.countDocuments = () => Promise.resolve(0);
      const res = buildRes();
      await getIncidents({ query: { limit: "999" } }, res);
      assert.strictEqual(res.code, 200);
      assert.strictEqual(capturedLimit, 100);
      ok("B9 · GET /api/dispatch/incidents — limit=999 capped at 100 → 200");
    } catch (e) { fail("B9 · incidents — limit=999 → capped 100", e); }

    // ── B10 getIncidents — limit=0 floored to 1
    try {
      let capturedLimit = null;
      Incident.find = () => ({
        sort: () => ({
          skip: () => ({
            limit: (n) => { capturedLimit = n; return Promise.resolve([]); },
          }),
        }),
      });
      Incident.countDocuments = () => Promise.resolve(0);
      const res = buildRes();
      await getIncidents({ query: { limit: "0" } }, res);
      assert.strictEqual(res.code, 200);
      assert.ok(capturedLimit >= 1, `limit floored to ${capturedLimit}`);
      ok(`B10 · GET /api/dispatch/incidents — limit=0 floored to ${capturedLimit} → 200`);
    } catch (e) { fail("B10 · incidents — limit=0 → floored", e); }

    // ── B11 getIncidentById — not found
    try {
      Incident.findById = () => Promise.resolve(null);
      const res = buildRes();
      await getIncidentById({ params: { id: "nonexistent" } }, res);
      assert.strictEqual(res.code, 404);
      ok("B11 · GET /api/dispatch/incident/:id — not found → 404");
    } catch (e) { fail("B11 · incident by id — not found → 404", e); }

    // ── B12 updateIncidentStatus — missing status field
    try {
      const res = buildRes();
      await updateIncidentStatus({ params: { id: "inc_001" }, body: {} }, res);
      assert.strictEqual(res.code, 400);
      ok("B12 · PATCH status — missing status → 400");
    } catch (e) { fail("B12 · status — missing → 400", e); }

    // ── B13 updateIncidentStatus — null status
    try {
      const res = buildRes();
      await updateIncidentStatus({ params: { id: "inc_001" }, body: { status: null } }, res);
      assert.strictEqual(res.code, 400);
      ok("B13 · PATCH status — null → 400");
    } catch (e) { fail("B13 · status — null → 400", e); }

    // ── B14 updateIncidentStatus — numeric status
    try {
      const res = buildRes();
      await updateIncidentStatus({ params: { id: "inc_001" }, body: { status: 999 } }, res);
      assert.strictEqual(res.code, 400);
      ok("B14 · PATCH status — numeric → 400");
    } catch (e) { fail("B14 · status — numeric → 400", e); }

    // ── B15 updateIncidentStatus — re-resolve RESOLVED (idempotent)
    try {
      const resolvedIncident = {
        _id: "inc_resolved",
        status: "RESOLVED",
        statusHistory: [{ status: "RESOLVED", changedAt: new Date(), note: "Done" }],
        save: function () { return Promise.resolve(this); },
      };
      Incident.findById = () => Promise.resolve(resolvedIncident);
      const res = buildRes();
      await updateIncidentStatus({ params: { id: "inc_resolved" }, body: { status: "RESOLVED" } }, res);
      assert.strictEqual(res.code, 200);
      assert.strictEqual(resolvedIncident.statusHistory.length, 2);
      ok("B15 · PATCH status — re-resolve RESOLVED → 200 idempotent");
    } catch (e) { fail("B15 · status — re-resolve → 200", e); }

    // ── B16 updateIncidentStatus — incident not found
    try {
      Incident.findById = () => Promise.resolve(null);
      const res = buildRes();
      await updateIncidentStatus({ params: { id: "ghost" }, body: { status: "RESOLVED" } }, res);
      assert.strictEqual(res.code, 404);
      ok("B16 · PATCH status — not found → 404");
    } catch (e) { fail("B16 · status — not found → 404", e); }

    // ── B17 attachMedia — no URL & no file
    try {
      Incident.findById = () => Promise.resolve({ _id: "inc_001", media: [] });
      const res = buildRes();
      await attachVerificationMedia(
        { params: { id: "inc_001" }, body: {}, file: null, protocol: "http", get: () => "localhost" },
        res
      );
      assert.strictEqual(res.code, 400);
      ok("B17 · POST media — no URL & no file → 400");
    } catch (e) { fail("B17 · media — no URL/file → 400", e); }

    // ── B18 attachMedia — empty string mediaUrl
    try {
      Incident.findById = () => Promise.resolve({ _id: "inc_001", media: [] });
      const res = buildRes();
      await attachVerificationMedia(
        { params: { id: "inc_001" }, body: { mediaUrl: "" }, file: null, protocol: "http", get: () => "localhost" },
        res
      );
      assert.strictEqual(res.code, 400);
      ok("B18 · POST media — empty string URL → 400");
    } catch (e) { fail("B18 · media — empty URL → 400", e); }

    // ── B19 attachMedia — incident not found
    try {
      Incident.findById = () => Promise.resolve(null);
      const res = buildRes();
      await attachVerificationMedia(
        { params: { id: "ghost" }, body: { mediaUrl: "https://x.com/a.jpg" }, file: null, protocol: "http", get: () => "localhost" },
        res
      );
      assert.strictEqual(res.code, 404);
      ok("B19 · POST media — incident not found → 404");
    } catch (e) { fail("B19 · media — not found → 404", e); }


    // ══════════════════════════════════════════════════════════════════════════
    //  SECTION C — HOSPITAL CONTROLLER NEGATIVES
    // ══════════════════════════════════════════════════════════════════════════
    console.log("\n── SECTION C: HOSPITAL CONTROLLER NEGATIVES ─────────────────────");

    // ── C1  getHospitalCapacity — not found
    try {
      Hospital.findById = () => ({ select: () => Promise.resolve(null) });
      const res = buildRes();
      await getHospitalCapacity({ params: { id: "ghost" } }, res);
      assert.strictEqual(res.code, 404);
      ok("C1 · GET hospital capacity — not found → 404");
    } catch (e) { fail("C1 · hospital cap — not found → 404", e); }

    // ── C2  updateHospitalCapacity — not found
    try {
      Hospital.findById = () => Promise.resolve(null);
      const res = buildRes();
      await updateHospitalCapacity({ params: { id: "ghost" }, body: { capacity: { available: 5 } } }, res);
      assert.strictEqual(res.code, 404);
      ok("C2 · PATCH hospital capacity — not found → 404");
    } catch (e) { fail("C2 · update cap — not found → 404", e); }

    // ── C3  updateHospitalCapacity — negative bed count (documents gap)
    try {
      const hospital = {
        _id: "h1", name: "Test", isOperational: true,
        capacity: { total: 50, available: 20, icuAvailable: 5 },
        ambulances: { total: 6, activeOnCall: 2 },
        save: function () { return Promise.resolve(this); },
      };
      Hospital.findById = () => Promise.resolve(hospital);
      const res = buildRes();
      await updateHospitalCapacity({ params: { id: "h1" }, body: { capacity: { available: -5 } } }, res);
      assert.strictEqual(res.code, 200);
      assert.strictEqual(hospital.capacity.available, -5);
      ok("C3 · PATCH capacity — negative beds → 200 (GAP: no min-value guard)");
    } catch (e) { fail("C3 · cap — negative beds → gap", e); }

    // ── C4  updateHospitalCapacity — string '15' coerced to number
    try {
      const hospital = {
        _id: "h1", name: "Test", isOperational: true,
        capacity: { total: 50, available: 20, icuAvailable: 5 },
        ambulances: { total: 6, activeOnCall: 2 },
        save: function () { return Promise.resolve(this); },
      };
      Hospital.findById = () => Promise.resolve(hospital);
      const res = buildRes();
      await updateHospitalCapacity({ params: { id: "h1" }, body: { capacity: { available: "15" } } }, res);
      assert.strictEqual(res.code, 200);
      assert.strictEqual(hospital.capacity.available, 15);
      assert.strictEqual(typeof hospital.capacity.available, "number");
      ok("C4 · PATCH capacity — string '15' → parseInt coerced → 200");
    } catch (e) { fail("C4 · cap — string coercion → 200", e); }

    // ── C5  updateHospitalCapacity — non-numeric string (documents NaN gap)
    try {
      const hospital = {
        _id: "h1", name: "Test", isOperational: true,
        capacity: { total: 50, available: 20, icuAvailable: 5 },
        ambulances: { total: 6, activeOnCall: 2 },
        save: function () { return Promise.resolve(this); },
      };
      Hospital.findById = () => Promise.resolve(hospital);
      const res = buildRes();
      await updateHospitalCapacity({ params: { id: "h1" }, body: { capacity: { available: "many" } } }, res);
      assert.strictEqual(res.code, 200);
      assert.ok(isNaN(hospital.capacity.available));
      ok("C5 · PATCH capacity — 'many' → NaN stored (GAP: no NaN guard)");
    } catch (e) { fail("C5 · cap — NaN gap", e); }

    // ── C6  updateHospitalCapacity — empty body (no-op save)
    try {
      const hospital = {
        _id: "h1", name: "Test", isOperational: true,
        capacity: { total: 50, available: 20, icuAvailable: 5 },
        ambulances: { total: 6, activeOnCall: 2 },
        save: function () { return Promise.resolve(this); },
      };
      Hospital.findById = () => Promise.resolve(hospital);
      const res = buildRes();
      await updateHospitalCapacity({ params: { id: "h1" }, body: {} }, res);
      assert.strictEqual(res.code, 200);
      assert.strictEqual(hospital.capacity.available, 20, "unchanged");
      ok("C6 · PATCH capacity — empty body → no-op save → 200");
    } catch (e) { fail("C6 · cap — empty body → 200", e); }


    // ══════════════════════════════════════════════════════════════════════════
    //  SECTION D — NOTIFICATION CONTROLLER NEGATIVES
    // ══════════════════════════════════════════════════════════════════════════
    console.log("\n── SECTION D: NOTIFICATION CONTROLLER NEGATIVES ─────────────────");

    // ── D1  sms-webhook — empty body
    try {
      const res = buildRes();
      await handleSmsWebhook({ body: {}, headers: {} }, res);
      assert.strictEqual(res.code, 400);
      ok("D1 · POST sms-webhook — empty body → 400");
    } catch (e) { fail("D1 · sms — empty body → 400", e); }

    // ── D2  sms-webhook — from present but no message
    try {
      const res = buildRes();
      await handleSmsWebhook({ body: { from: "+2347010001111" }, headers: {} }, res);
      assert.strictEqual(res.code, 400);
      ok("D2 · POST sms-webhook — no message → 400");
    } catch (e) { fail("D2 · sms — no message → 400", e); }

    // ── D3  sms-webhook — unrecognised keyword (no state change)
    try {
      User.findOne = () => Promise.resolve({ name: "Resp X", phone: "+2340001" });
      const incident = {
        _id: "inc_kw", status: "DISPATCHED", statusHistory: [],
        save: function () { return Promise.resolve(this); },
      };
      Incident.findById = () => Promise.resolve(incident);
      const res = buildRes();
      await handleSmsWebhook(
        { body: { from: "+2340001", message: "HELLO WORLD", incidentId: "inc_kw" }, headers: {} },
        res
      );
      assert.strictEqual(res.code, 200);
      assert.strictEqual(incident.status, "DISPATCHED");
      assert.strictEqual(incident.statusHistory.length, 0);
      ok("D3 · POST sms-webhook — unrecognised keyword → 200, no state change");
    } catch (e) { fail("D3 · sms — unrecognised keyword", e); }

    // ── D4  sms-webhook — incidentId not found
    try {
      User.findOne = () => Promise.resolve({ name: "Resp X", phone: "+2340001" });
      Incident.findById = () => Promise.resolve(null);
      const res = buildRes();
      await handleSmsWebhook(
        { body: { from: "+2340001", message: "EN ROUTE", incidentId: "ghost_99" }, headers: {} },
        res
      );
      assert.strictEqual(res.code, 200);
      assert.ok(res.body.message.toLowerCase().includes("no active"));
      ok("D4 · POST sms-webhook — incidentId not found → 200 graceful");
    } catch (e) { fail("D4 · sms — incidentId not found → 200", e); }

    // ── D5  sms-webhook — update RESOLVED incident (documents gap)
    try {
      User.findOne = () => Promise.resolve({ name: "Resp X", phone: "+2340001" });
      const resolvedInc = {
        _id: "inc_res", status: "RESOLVED",
        statusHistory: [{ status: "RESOLVED", changedAt: new Date(), note: "Done" }],
        save: function () { return Promise.resolve(this); },
      };
      Incident.findById = () => Promise.resolve(resolvedInc);
      const res = buildRes();
      await handleSmsWebhook(
        { body: { from: "+2340001", message: "EN ROUTE", incidentId: "inc_res" }, headers: {} },
        res
      );
      assert.strictEqual(res.code, 200);
      ok("D5 · POST sms-webhook — update RESOLVED → 200 (GAP: no resolved-lock)");
    } catch (e) { fail("D5 · sms — update resolved → gap", e); }

    // ── D6  sms-webhook — Twilio field format (From/Body capitalised)
    try {
      User.findOne = () => Promise.resolve({ name: "Twilio Resp", phone: "+2340002" });
      const twilioInc = {
        _id: "inc_tw", status: "DISPATCHED", statusHistory: [],
        save: function () { return Promise.resolve(this); },
      };
      Incident.findById = () => Promise.resolve(twilioInc);
      const res = buildRes();
      await handleSmsWebhook(
        { body: { From: "+2340002", Body: "YES", incidentId: "inc_tw" }, headers: {} },
        res
      );
      assert.strictEqual(res.code, 200);
      assert.strictEqual(twilioInc.status, "ACKNOWLEDGED");
      ok("D6 · POST sms-webhook — Twilio format (From/Body) → ACKNOWLEDGED");
    } catch (e) { fail("D6 · sms — Twilio format → 200", e); }

    // ── D7  sms-webhook — Africa's Talking format (phone/text)
    try {
      User.findOne = () => Promise.resolve({ name: "AT Resp", phone: "+2340003" });
      const atInc = {
        _id: "inc_at", status: "DISPATCHED", statusHistory: [],
        save: function () { return Promise.resolve(this); },
      };
      Incident.findById = () => Promise.resolve(atInc);
      const res = buildRes();
      await handleSmsWebhook(
        { body: { phone: "+2340003", text: "MOVING", incidentId: "inc_at" }, headers: {} },
        res
      );
      assert.strictEqual(res.code, 200);
      assert.strictEqual(atInc.status, "EN_ROUTE");
      ok("D7 · POST sms-webhook — Africa's Talking format → EN_ROUTE");
    } catch (e) { fail("D7 · sms — AT format → 200", e); }


  } finally {
    // ── Restore all mocked model methods ─────────────────────────────────────
    Hospital.find     = orig.HospitalFind;
    Hospital.findById = orig.HospitalFindById;
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

  // ── Final Summary ─────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log("\n=================================================================");
  if (failed === 0) {
    console.log(` 🎉  ALL ${total} NEGATIVE TESTS PASSED!  (${passed} passed · 0 failed)`);
  } else {
    console.log(` ⚠️   ${passed}/${total} NEGATIVE TESTS PASSED  —  ${failed} FAILED`);
  }
  console.log("=================================================================\n");

  if (failed > 0) process.exit(1);
}

runNegativeTests().catch((err) => {
  console.error("\n[FATAL TEST ERROR]", err);
  process.exit(1);
});
