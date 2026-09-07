/**
 * ================================================================
 *  Emergency Response Network — EMAIL NOTIFICATION TEST SUITE
 *  Phase 2B of the full implementation plan
 *
 *  Tests:
 *    1. HTML Template Generation (colors, map links, units, victim)
 *    2. Disabled Guard (ENABLE_EMAIL_ALERTS !== true)
 *    3. Successful Dispatch via Nodemailer (with socket notification)
 *    4. Error Handling (transporter failure gracefully caught)
 * ================================================================
 */

const assert = require("assert");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const { io: Client } = require("socket.io-client");
const nodemailer = require("nodemailer");
const { initEmergencySocket } = require("../sockets/emergencySocket");
const { sendIncidentAlert, buildAlertHtml, resetTransporter } = require("../services/emailService");

async function runEmailTests() {
  console.log("=================================================================");
  console.log(" 📧  EMAIL NOTIFICATION TEST SUITE — ERN Backend Phase 2B");
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

  // Setup Socket.io test server to catch INCIDENT_ALERT_EMAIL_SENT
  const port = 5098;
  const app = express();
  const server = http.createServer(app);
  const ioServer = new Server(server);
  initEmergencySocket(ioServer);

  await new Promise((r) => server.listen(port, r));
  const client = Client(`http://localhost:${port}`);
  await new Promise((r) => client.on("connect", r));

  const sampleIncident = {
    _id: "inc_email_01",
    type: "FIRE",
    status: "DISPATCHED",
    dispatchTier: "TIER_1_FIRE_STATION",
    location: {
      type: "Point",
      coordinates: [3.3792, 6.5244],
    },
    description: "Factory fire near industrial zone",
    assignedUnits: [
      { name: "Ikeja Fire HQ", unitType: "FireStation", distanceMeters: 1420 },
    ],
    victimInfo: {
      name: "Security Guard",
      phone: "+2348000000000",
    },
  };

  // ─────────────────────────────────────────────────────────────
  // 1. HTML TEMPLATE BUILDER
  // ─────────────────────────────────────────────────────────────
  console.log("── 1. HTML TEMPLATE BUILDER ───────────────────────────────────");
  try {
    const html = buildAlertHtml(sampleIncident);
    assert(html.includes("EMERGENCY ALERT DISPATCHED"));
    assert(html.includes("inc_email_01"));
    assert(html.includes("#e53e3e"), "Fire alert should have red accent color");
    assert(html.includes("maps.google.com"));
    assert(html.includes("Ikeja Fire HQ"));
    assert(html.includes("+2348000000000"));
    ok("E1 · buildAlertHtml() generates responsive HTML template with badge, map link & units");
  } catch (err) {
    fail("E1 · buildAlertHtml() failed", err);
  }

  // ─────────────────────────────────────────────────────────────
  // 2. DISABLED GUARD
  // ─────────────────────────────────────────────────────────────
  console.log("\n── 2. DISABLED GUARD ──────────────────────────────────────────");
  try {
    process.env.ENABLE_EMAIL_ALERTS = "false";
    const result = await sendIncidentAlert(sampleIncident);
    assert.strictEqual(result.sent, false);
    assert.strictEqual(result.reason, "EMAIL_ALERTS_DISABLED");
    ok("E2 · sendIncidentAlert() returns clean disabled status when ENABLE_EMAIL_ALERTS != true");
  } catch (err) {
    fail("E2 · disabled check failed", err);
  }

  // ─────────────────────────────────────────────────────────────
  // 3. SUCCESSFUL DISPATCH & SOCKET BROADCAST
  // ─────────────────────────────────────────────────────────────
  console.log("\n── 3. DISPATCH & REAL-TIME SOCKET EMISSION ────────────────────");
  const origCreateTransport = nodemailer.createTransport;
  try {
    process.env.ENABLE_EMAIL_ALERTS = "true";
    process.env.ALERT_TO_EMAIL = "dispatcher@aidecheck.org";
    process.env.SMTP_USER = "test@gmail.com";
    process.env.SMTP_PASS = "app_password";

    let sentMailOptions = null;
    nodemailer.createTransport = () => ({
      sendMail: async (opts) => {
        sentMailOptions = opts;
        return { messageId: "<msg-test-12345@aidecheck.org>" };
      },
    });

    let socketEventReceived = null;
    client.on("INCIDENT_ALERT_EMAIL_SENT", (payload) => {
      socketEventReceived = payload;
    });

    const result = await sendIncidentAlert(sampleIncident);

    assert.strictEqual(result.sent, true);
    assert.strictEqual(result.messageId, "<msg-test-12345@aidecheck.org>");
    assert.strictEqual(sentMailOptions.to, "dispatcher@aidecheck.org");
    assert(sentMailOptions.subject.includes("[EMERGENCY FIRE]"));

    // Wait 100ms for socket client to receive event
    await new Promise((r) => setTimeout(r, 100));
    assert(socketEventReceived !== null, "Socket event INCIDENT_ALERT_EMAIL_SENT should be received");
    assert.strictEqual(socketEventReceived.incidentId, "inc_email_01");
    assert.strictEqual(socketEventReceived.type, "FIRE");

    ok("E3 · sendIncidentAlert() sends mail via Nodemailer and emits INCIDENT_ALERT_EMAIL_SENT to socket");
  } catch (err) {
    fail("E3 · email dispatch failed", err);
  }

  // ─────────────────────────────────────────────────────────────
  // 4. ERROR HANDLING
  // ─────────────────────────────────────────────────────────────
  console.log("\n── 4. ERROR HANDLING ──────────────────────────────────────────");
  try {
    resetTransporter();
    nodemailer.createTransport = () => ({
      sendMail: async () => {
        throw new Error("SMTP 535 5.7.8 Authentication credentials invalid");
      },
    });

    const result = await sendIncidentAlert(sampleIncident);
    assert.strictEqual(result.sent, false);
    assert.strictEqual(result.reason, "TRANSPORTER_ERROR");
    assert(result.message.includes("Authentication credentials invalid"));
    ok("E4 · sendIncidentAlert() catches SMTP error gracefully without throwing");
  } catch (err) {
    fail("E4 · error handling failed", err);
  }

  // Cleanup
  nodemailer.createTransport = origCreateTransport;
  process.env.ENABLE_EMAIL_ALERTS = "false";
  client.disconnect();
  await new Promise((r) => server.close(r));

  console.log("\n=================================================================");
  if (failed === 0) {
    console.log(` 🎉  ALL ${passed} EMAIL TESTS PASSED!  (${passed} passed · 0 failed)`);
  } else {
    console.error(` ❌  FAILED: ${failed} tests failed (${passed} passed)`);
    process.exit(1);
  }
  console.log("=================================================================\n");
}

if (require.main === module) {
  runEmailTests().catch((err) => {
    console.error("Fatal test runner error:", err);
    process.exit(1);
  });
}

module.exports = { runEmailTests };
