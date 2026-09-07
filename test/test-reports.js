/**
 * ================================================================
 *  Emergency Response Network — REPORTING & ANALYTICS TEST SUITE
 *  Phase 2A of the full implementation plan
 *
 *  Tests all 5 reporting endpoints:
 *    1. GET /api/reports/summary
 *    2. GET /api/reports/response-times
 *    3. GET /api/reports/hotspots
 *    4. GET /api/reports/hospital-utilisation
 *    5. GET /api/reports/responder-activity
 * ================================================================
 */

const assert = require("assert");
const Incident = require("../models/Incident");
const Hospital = require("../models/Hospital");
const {
  getSummaryReport,
  getResponseTimesReport,
  getHotspotsReport,
  getHospitalUtilisationReport,
  getResponderActivityReport,
} = require("../controllers/reportController");

/** Build mock res object */
function buildRes() {
  let statusCode = null;
  let body = null;
  const res = {
    status(code) {
      statusCode = code;
      return res;
    },
    json(data) {
      body = data;
      return res;
    },
    get code() {
      return statusCode;
    },
    get body() {
      return body;
    },
  };
  return res;
}

async function runReportTests() {
  console.log("=================================================================");
  console.log(" 📊  REPORTING & ANALYTICS TEST SUITE — ERN Backend Phase 2A");
  console.log("=================================================================\n");

  let passed = 0;
  let failed = 0;

  function ok(label) {
    console.log(`   ✅  ${label}`);
    passed++;
  }

  function fail(label, err) {
    console.error(`   ❌  ${label}`);
    console.error(`       Error: ${err.message}`);
    failed++;
  }

  const origIncidentAggregate = Incident.aggregate;
  const origIncidentCount = Incident.countDocuments;
  const origIncidentFind = Incident.find;
  const origHospitalFind = Hospital.find;

  // ─────────────────────────────────────────────────────────────
  // 1. GET /api/reports/summary
  // ─────────────────────────────────────────────────────────────
  console.log("── 1. SUMMARY REPORT ──────────────────────────────────────────");
  try {
    Incident.aggregate = async (pipeline) => {
      // Determine if grouping by status or type
      const groupStage = pipeline.find((p) => p.$group);
      if (groupStage && groupStage.$group._id === "$status") {
        return [
          { _id: "DISPATCHED", count: 4 },
          { _id: "ON_SCENE", count: 2 },
          { _id: "RESOLVED", count: 10 },
        ];
      }
      if (groupStage && groupStage.$group._id === "$type") {
        return [
          { _id: "MEDICAL", count: 8 },
          { _id: "SECURITY", count: 5 },
          { _id: "FIRE", count: 3 },
        ];
      }
      return [];
    };
    Incident.countDocuments = async () => 16;

    const res = buildRes();
    await getSummaryReport({ query: { timeframe: "7d" } }, res);

    assert.strictEqual(res.code, 200, "Should return HTTP 200");
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.timeframe, "7d");
    assert.strictEqual(res.body.data.total, 16);
    assert.strictEqual(res.body.data.active, 6); // 4 dispatched + 2 on_scene
    assert.strictEqual(res.body.data.resolved, 10);
    assert.strictEqual(res.body.data.byStatus.DISPATCHED, 4);
    assert.strictEqual(res.body.data.byType.MEDICAL, 8);
    ok("R1 · GET /api/reports/summary (7d window with active & type breakdowns)");
  } catch (err) {
    fail("R1 · GET /api/reports/summary failed", err);
  }

  try {
    // Empty database fallback
    Incident.aggregate = async () => [];
    Incident.countDocuments = async () => 0;

    const res = buildRes();
    await getSummaryReport({ query: {} }, res);

    assert.strictEqual(res.code, 200);
    assert.strictEqual(res.body.data.total, 0);
    assert.strictEqual(res.body.data.active, 0);
    assert.strictEqual(res.body.data.byStatus.PENDING, 0);
    ok("R2 · GET /api/reports/summary (empty database returns clean zero counters)");
  } catch (err) {
    fail("R2 · GET /api/reports/summary empty DB failed", err);
  }

  // ─────────────────────────────────────────────────────────────
  // 2. GET /api/reports/response-times
  // ─────────────────────────────────────────────────────────────
  console.log("\n── 2. RESPONSE TIMES REPORT ───────────────────────────────────");
  try {
    const baseTime = new Date("2026-09-01T10:00:00.000Z");
    const onSceneTime = new Date("2026-09-01T10:06:30.000Z"); // 390s
    const resolvedTime = new Date("2026-09-01T10:25:00.000Z"); // 1500s

    Incident.find = () => ({
      select: () => ({
        lean: async () => [
          {
            type: "MEDICAL",
            createdAt: baseTime,
            statusHistory: [
              { status: "DISPATCHED", changedAt: baseTime },
              { status: "ON_SCENE", changedAt: onSceneTime },
              { status: "RESOLVED", changedAt: resolvedTime },
            ],
          },
          {
            type: "FIRE",
            createdAt: baseTime,
            statusHistory: [
              { status: "DISPATCHED", changedAt: baseTime },
              { status: "ON_SCENE", changedAt: new Date("2026-09-01T10:04:00.000Z") }, // 240s
            ],
          },
        ],
      }),
    });

    const res = buildRes();
    await getResponseTimesReport({ query: {} }, res);

    assert.strictEqual(res.code, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.byType.MEDICAL.avgTimeToOnSceneSeconds, 390);
    assert.strictEqual(res.body.data.byType.MEDICAL.avgTimeToOnSceneMinutes, 6.5);
    assert.strictEqual(res.body.data.byType.MEDICAL.avgTimeToResolvedSeconds, 1500);
    assert.strictEqual(res.body.data.byType.FIRE.avgTimeToOnSceneSeconds, 240);
    assert.strictEqual(res.body.data.byType.FIRE.avgTimeToOnSceneMinutes, 4);
    assert.strictEqual(res.body.data.overallAverageOnSceneSeconds, 315); // (390+240)/2
    ok("R3 · GET /api/reports/response-times (calculates seconds and minutes by type & overall)");
  } catch (err) {
    fail("R3 · GET /api/reports/response-times failed", err);
  }

  // ─────────────────────────────────────────────────────────────
  // 3. GET /api/reports/hotspots
  // ─────────────────────────────────────────────────────────────
  console.log("\n── 3. HOTSPOTS REPORT ─────────────────────────────────────────");
  try {
    Incident.aggregate = async (pipeline) => {
      return [
        {
          _id: { lng: 3.38, lat: 6.52 },
          count: 12,
          types: ["MEDICAL", "MEDICAL", "SECURITY", "MEDICAL"],
        },
        {
          _id: { lng: 3.42, lat: 6.45 },
          count: 5,
          types: ["FIRE", "FIRE", "SECURITY"],
        },
      ];
    };

    const res = buildRes();
    await getHotspotsReport({ query: { limit: "2" } }, res);

    assert.strictEqual(res.code, 200);
    assert.strictEqual(res.body.data.totalHotspots, 2);
    assert.deepStrictEqual(res.body.data.hotspots[0].coordinates, [3.38, 6.52]);
    assert.strictEqual(res.body.data.hotspots[0].incidentCount, 12);
    assert.strictEqual(res.body.data.hotspots[0].predominantType, "MEDICAL");
    assert.strictEqual(res.body.data.hotspots[1].predominantType, "FIRE");
    ok("R4 · GET /api/reports/hotspots (returns cluster coordinates, count & predominant type)");
  } catch (err) {
    fail("R4 · GET /api/reports/hotspots failed", err);
  }

  // ─────────────────────────────────────────────────────────────
  // 4. GET /api/reports/hospital-utilisation
  // ─────────────────────────────────────────────────────────────
  console.log("\n── 4. HOSPITAL UTILISATION REPORT ─────────────────────────────");
  try {
    Hospital.find = () => ({
      lean: async () => [
        {
          _id: "hosp_1",
          name: "St. Nicholas Hospital",
          isOperational: true,
          capacity: { total: 100, available: 40, icuAvailable: 8, oxygenAvailable: true },
          ambulances: { total: 10, activeOnCall: 4 },
        },
        {
          _id: "hosp_2",
          name: "General Hospital Victoria",
          isOperational: true,
          capacity: { total: 50, available: 10, icuAvailable: 2, oxygenAvailable: true },
          ambulances: { total: 5, activeOnCall: 2 },
        },
      ],
    });

    const res = buildRes();
    await getHospitalUtilisationReport({}, res);

    assert.strictEqual(res.code, 200);
    assert.strictEqual(res.body.data.totalHospitals, 2);
    assert.strictEqual(res.body.data.totalBeds, 150);
    assert.strictEqual(res.body.data.availableBeds, 50);
    assert.strictEqual(res.body.data.occupiedBeds, 100);
    assert.strictEqual(res.body.data.overallOccupancyRatePercent, 66.7);
    assert.strictEqual(res.body.data.totalIcuAvailable, 10);
    assert.strictEqual(res.body.data.totalAmbulances, 15);
    assert.strictEqual(res.body.data.activeAmbulances, 6);
    assert.strictEqual(res.body.data.hospitals[0].occupancyRatePercent, 60.0);
    ok("R5 · GET /api/reports/hospital-utilisation (network total & per-hospital occupancy rates)");
  } catch (err) {
    fail("R5 · GET /api/reports/hospital-utilisation failed", err);
  }

  // ─────────────────────────────────────────────────────────────
  // 5. GET /api/reports/responder-activity
  // ─────────────────────────────────────────────────────────────
  console.log("\n── 5. RESPONDER ACTIVITY REPORT ───────────────────────────────");
  try {
    Incident.find = () => ({
      select: () => ({
        lean: async () => [
          {
            assignedUnits: [
              { unitId: "u1", unitType: "Hospital", name: "Lagos University Teaching Hospital" },
              { unitId: "u2", unitType: "User", name: "Volunteer John" },
            ],
          },
          {
            assignedUnits: [
              { unitId: "u1", unitType: "Hospital", name: "Lagos University Teaching Hospital" },
              { unitId: "u3", unitType: "FireStation", name: "Alausa Fire HQ" },
            ],
          },
        ],
      }),
    });

    const res = buildRes();
    await getResponderActivityReport({ query: {} }, res);

    assert.strictEqual(res.code, 200);
    assert.strictEqual(res.body.data.totalAssignments, 4);
    assert.strictEqual(res.body.data.byUnitType.Hospital, 2);
    assert.strictEqual(res.body.data.byUnitType.User, 1);
    assert.strictEqual(res.body.data.byUnitType.FireStation, 1);
    assert.strictEqual(res.body.data.topResponders[0].name, "Lagos University Teaching Hospital");
    assert.strictEqual(res.body.data.topResponders[0].totalDispatches, 2);
    ok("R6 · GET /api/reports/responder-activity (aggregates unit types & top active responders)");
  } catch (err) {
    fail("R6 · GET /api/reports/responder-activity failed", err);
  }

  // ─────────────────────────────────────────────────────────────
  // 6. ERROR HANDLING
  // ─────────────────────────────────────────────────────────────
  console.log("\n── 6. ERROR HANDLING ──────────────────────────────────────────");
  try {
    Incident.aggregate = async () => {
      throw new Error("DB Connection Interrupted");
    };
    Incident.countDocuments = async () => 0;

    const res = buildRes();
    await getSummaryReport({ query: {} }, res);

    assert.strictEqual(res.code, 500);
    assert.strictEqual(res.body.success, false);
    assert(res.body.message.includes("DB Connection Interrupted"));
    ok("R7 · GET /api/reports/summary handles database error gracefully → 500");
  } catch (err) {
    fail("R7 · GET /api/reports/summary error handling failed", err);
  }

  // Restore originals
  Incident.aggregate = origIncidentAggregate;
  Incident.countDocuments = origIncidentCount;
  Incident.find = origIncidentFind;
  Hospital.find = origHospitalFind;

  console.log("\n=================================================================");
  if (failed === 0) {
    console.log(` 🎉  ALL ${passed} REPORT TESTS PASSED!  (${passed} passed · 0 failed)`);
  } else {
    console.error(` ❌  FAILED: ${failed} tests failed (${passed} passed)`);
    process.exit(1);
  }
  console.log("=================================================================\n");
}

if (require.main === module) {
  runReportTests().catch((err) => {
    console.error("Fatal test runner error:", err);
    process.exit(1);
  });
}

module.exports = { runReportTests };
