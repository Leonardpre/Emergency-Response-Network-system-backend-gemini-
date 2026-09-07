const { io: Client } = require("socket.io-client");
const assert = require("assert");

async function runLiveE2ETest() {
  console.log("=================================================");
  console.log(" 🌐 End-to-End Live Integration Verification");
  console.log("=================================================");

  const baseUrl = "http://localhost:5000";

  // 1. Verify Health Check
  console.log("\n1. Testing Backend /health...");
  const healthRes = await fetch(`${baseUrl}/health`);
  const healthData = await healthRes.json();
  assert.strictEqual(healthData.status, "ONLINE");
  console.log(" ✅ Health Check OK:", healthData.status);

  // 2. Connect Socket.io Client (simulating Frontend React App)
  console.log("\n2. Connecting Socket.io Client...");
  const socket = Client(baseUrl, { transports: ["websocket", "polling"] });
  await new Promise((resolve) => socket.on("connect", resolve));
  console.log(" ✅ Socket.io Handshake connected with ID:", socket.id);

  // Join dispatch consoles & hospital rooms
  socket.emit("JOIN_ROOM", "dispatch_consoles");
  socket.emit("JOIN_ROOM", "hospitals");
  console.log(" ✅ Joined rooms: dispatch_consoles, hospitals");

  // Setup event listeners
  let receivedSosEvent = null;
  let receivedStatusEvent = null;
  let receivedMediaEvent = null;

  socket.on("DISPATCH_SOS", (p) => {
    receivedSosEvent = p;
    console.log(" ⚡ [Socket Received] DISPATCH_SOS for incident:", p.incident?._id);
  });

  socket.on("STATUS_UPDATED", (p) => {
    receivedStatusEvent = p;
    console.log(" ⚡ [Socket Received] STATUS_UPDATED:", p.status);
  });

  socket.on("MEDIA_ATTACHED", (p) => {
    receivedMediaEvent = p;
    console.log(" ⚡ [Socket Received] MEDIA_ATTACHED:", p.mediaItem?.url);
  });

  // 3. Register & Login via Auth API
  console.log("\n3. Testing Auth API (/api/auth/register & login)...");
  const testEmail = `operator_${Date.now()}@aidecheck.org`;
  const regRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Lead Dispatcher",
      email: testEmail,
      password: "DispatcherPass2026!",
      phone: "+2348099887766",
      role: "dispatcher",
      coordinates: [3.3792, 6.5244],
    }),
  });
  const regData = await regRes.json();
  assert.strictEqual(regRes.status, 201);
  assert.ok(regData.token, "Token must be returned on register");
  console.log(" ✅ Auth Register OK, Token generated");

  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: testEmail,
      password: "DispatcherPass2026!",
    }),
  });
  const loginData = await loginRes.json();
  assert.strictEqual(loginRes.status, 200);
  assert.ok(loginData.token, "Token must be returned on login");
  console.log(" ✅ Auth Login OK");

  // 4. Trigger SOS Dispatch (Simulating Citizen Panic Button)
  console.log("\n4. Triggering SOS Emergency from Citizen...");
  const sosRes = await fetch(`${baseUrl}/api/dispatch/sos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "MEDICAL",
      coordinates: [3.3792, 6.5244],
      description: "E2E Test: Severe breathing difficulty",
      victimInfo: { name: "Test Citizen", phone: "+234700000000" },
    }),
  });
  const sosData = await sosRes.json();
  assert.strictEqual(sosRes.status, 201);
  const incidentId = sosData.incident?._id;
  assert.ok(incidentId, "Incident ID must be returned");
  console.log(` ✅ SOS Created with ID: ${incidentId}`);

  // Wait for socket DISPATCH_SOS event
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(receivedSosEvent, "DISPATCH_SOS socket event must be received by client");

  // 5. Attach Media Proof (Voice Note)
  console.log("\n5. Attaching Asynchronous Audio Media Proof...");
  const mediaRes = await fetch(`${baseUrl}/api/dispatch/incident/${incidentId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mediaUrl: "https://storage.aidecheck.org/voice/panic_audio.mp3",
      mediaType: "VOICE_NOTE",
    }),
  });
  const mediaData = await mediaRes.json();
  assert.strictEqual(mediaRes.status, 200);
  console.log(" ✅ Media Attached successfully to Incident");

  await new Promise((r) => setTimeout(r, 300));
  assert.ok(receivedMediaEvent, "MEDIA_ATTACHED socket event must be received");

  // 6. Responder Status Update (Acknowledged -> En Route)
  console.log("\n6. Updating Incident Status to EN_ROUTE...");
  const statusRes = await fetch(`${baseUrl}/api/dispatch/incident/${incidentId}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${loginData.token}`,
    },
    body: JSON.stringify({
      status: "EN_ROUTE",
      note: "Ambulance Unit 07 en route to coordinates",
      responderName: "St. Nicholas Ambulance 07",
    }),
  });
  const statusData = await statusRes.json();
  assert.strictEqual(statusRes.status, 200);
  assert.strictEqual(statusData.incident?.status, "EN_ROUTE");
  console.log(" ✅ Status Transitioned to EN_ROUTE");

  await new Promise((r) => setTimeout(r, 300));
  assert.ok(receivedStatusEvent, "STATUS_UPDATED socket event must be received");
  assert.strictEqual(receivedStatusEvent.status, "EN_ROUTE");

  console.log("\n=================================================");
  console.log(" 🎉 LIVE END-TO-END INTEGRATION TEST PASSED 100%!");
  console.log("=================================================\n");

  socket.close();
  process.exit(0);
}

runLiveE2ETest().catch((err) => {
  console.error("\n❌ E2E Test Failure:", err);
  process.exit(1);
});
