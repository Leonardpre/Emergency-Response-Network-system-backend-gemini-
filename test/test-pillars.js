const assert = require("assert");

async function verifyNewFeatures() {
  console.log("=================================================");
  console.log(" 🧪 Verifying Hospital Capacity, Audit & SMS Webhook");
  console.log("=================================================");

  const baseUrl = "http://127.0.0.1:5000";

  // 1. Hospital Capacity Overview
  console.log("\n1. Testing GET /api/hospitals/capacity-overview...");
  const overviewRes = await fetch(`${baseUrl}/api/hospitals/capacity-overview`);
  const overviewData = await overviewRes.json();
  assert.strictEqual(overviewRes.status, 200);
  assert.strictEqual(overviewData.success, true);
  console.log(" ✅ Capacity Overview OK:", {
    totalHospitals: overviewData.summary.totalHospitals,
    totalBeds: overviewData.summary.totalBeds,
    availableBeds: overviewData.summary.availableBeds,
    icuAvailable: overviewData.summary.totalIcuBeds,
  });

  const firstHospital = overviewData.hospitals[0];
  assert.ok(firstHospital, "At least 1 hospital must exist");

  // 2. Individual Hospital Capacity
  console.log(`\n2. Testing GET /api/hospitals/${firstHospital._id}/capacity...`);
  const singleCapRes = await fetch(`${baseUrl}/api/hospitals/${firstHospital._id}/capacity`);
  const singleCapData = await singleCapRes.json();
  assert.strictEqual(singleCapRes.status, 200);
  console.log(" ✅ Individual Capacity OK:", singleCapData.name);

  // 3. Update Hospital Capacity
  console.log(`\n3. Testing PATCH /api/hospitals/${firstHospital._id}/capacity...`);
  const updateCapRes = await fetch(`${baseUrl}/api/hospitals/${firstHospital._id}/capacity`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      capacity: { available: 12, icuAvailable: 3, oxygenAvailable: true },
      ambulances: { activeOnCall: 2 },
    }),
  });
  const updateCapData = await updateCapRes.json();
  assert.strictEqual(updateCapRes.status, 200);
  assert.strictEqual(updateCapData.hospital.capacity.available, 12);
  assert.strictEqual(updateCapData.hospital.ambulances.activeOnCall, 2);
  console.log(" ✅ Hospital Capacity Update OK: Available beds set to 12");

  // 4. Incident Audit Trail
  console.log("\n4. Testing GET /api/dispatch/incident/:id/audit-trail...");
  // Fetch an existing incident first
  const incidentsRes = await fetch(`${baseUrl}/api/dispatch/incidents`);
  const incidentsData = await incidentsRes.json();
  const testIncident = incidentsData.incidents[0];
  assert.ok(testIncident, "At least 1 test incident must exist");

  const auditRes = await fetch(`${baseUrl}/api/dispatch/incident/${testIncident._id}/audit-trail`);
  const auditData = await auditRes.json();
  assert.strictEqual(auditRes.status, 200);
  assert.strictEqual(auditData.success, true);
  assert.ok(auditData.timeline.length >= 1, "Timeline must contain at least 1 event");
  console.log(" ✅ Incident Audit Trail OK: Recorded transitions:", auditData.totalTransitions);

  // 5. SMS Fallback Webhook
  console.log("\n5. Testing POST /api/notifications/sms-webhook...");
  const smsRes = await fetch(`${baseUrl}/api/notifications/sms-webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "+2347010001111", // Seeded volunteer John Doe
      message: "EN ROUTE",
      incidentId: testIncident._id,
    }),
  });
  const smsData = await smsRes.json();
  assert.strictEqual(smsRes.status, 200);
  assert.strictEqual(smsData.success, true);
  assert.strictEqual(smsData.updatedStatus, "EN_ROUTE");
  console.log(" ✅ SMS Fallback Webhook OK: Status updated via SMS to:", smsData.updatedStatus);

  console.log("\n=================================================");
  console.log(" 🎉 ALL NEW ARCHITECTURAL FEATURES VERIFIED!");
  console.log("=================================================\n");
}

verifyNewFeatures().catch((err) => {
  console.error("\n❌ Verification Failure:", err);
  process.exit(1);
});
