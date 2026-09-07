let ioInstance = null;

/**
 * Initialize Socket.io server and event listeners
 * @param {Server} io - Socket.io server instance
 */
const initEmergencySocket = (io) => {
  ioInstance = io;

  io.on("connection", (socket) => {
    console.log(`[Socket.io] Client connected: ${socket.id}`);

    // Join room event (e.g., 'hospitals', 'fire_stations', 'volunteers', 'incident_<id>')
    socket.on("JOIN_ROOM", (data) => {
      const room = typeof data === "string" ? data : data?.room;
      if (room) {
        socket.join(room);
        console.log(`[Socket.io] Client ${socket.id} joined room: ${room}`);
        socket.emit("ROOM_JOINED", { room, status: "SUCCESS" });
      }
    });

    // Client manually triggering DISPATCH_SOS via socket (optional alternative to REST endpoint)
    socket.on("DISPATCH_SOS", (payload) => {
      console.log(`[Socket.io] Received direct DISPATCH_SOS from ${socket.id}:`, payload);
      // Echo acknowledgment
      socket.emit("SOS_RECEIVED", { status: "PROCESSING", timestamp: new Date() });
    });

    // Responder acknowledging / accepting an incident
    socket.on("RESPONDER_ACK", (data) => {
      console.log(`[Socket.io] Responder ACK received from ${socket.id}:`, data);
      socket.broadcast.emit("RESPONDER_ACKNOWLEDGED", {
        ...data,
        receivedAt: new Date(),
      });
    });

    socket.on("disconnect", () => {
      console.log(`[Socket.io] Client disconnected: ${socket.id}`);
    });
  });
};

/**
 * Helper to retrieve Socket.io instance for controller usage
 */
const getIO = () => {
  if (!ioInstance) {
    throw new Error("[Socket.io Error] Socket.io has not been initialized!");
  }
  return ioInstance;
};

/**
 * Broadcast Medical/Security SOS dispatch event
 */
const emitDispatchSos = (incident, responders) => {
  if (!ioInstance) return;
  const payload = { incident, responders, eventTimestamp: new Date() };
  ioInstance.to("hospitals").to("dispatch_consoles").emit("DISPATCH_SOS", payload);
  console.log(`[Socket.io] Emitted DISPATCH_SOS for Incident ${incident._id}`);
};

/**
 * Broadcast Tier 1 Fire Emergency CAD dispatch event
 */
const emitFireEmergencyDispatch = (incident, fireStations) => {
  if (!ioInstance) return;
  const payload = { incident, fireStations, tier: "TIER_1_FIRE_STATION", eventTimestamp: new Date() };
  ioInstance.to("fire_stations").to("dispatch_consoles").emit("FIRE_EMERGENCY_DISPATCH", payload);
  console.log(`[Socket.io] Emitted FIRE_EMERGENCY_DISPATCH (Tier 1) for Incident ${incident._id}`);
};

/**
 * Broadcast Tier 2 Fire Emergency Vicinity event to community volunteers
 */
const emitVicinityFireBroadcast = (incident, volunteers) => {
  if (!ioInstance) return;
  const payload = { incident, volunteers, tier: "TIER_2_VOLUNTEER_VICINITY", eventTimestamp: new Date() };
  ioInstance.to("volunteers").to("dispatch_consoles").emit("VICINITY_FIRE_BROADCAST", payload);
  console.log(`[Socket.io] Emitted VICINITY_FIRE_BROADCAST (Tier 2 Fallback) for Incident ${incident._id}`);
};

/**
 * Broadcast MEDIA_ATTACHED event when voice note or photo is uploaded asynchronously
 */
const emitMediaAttached = (incidentId, mediaItem) => {
  if (!ioInstance) return;
  const payload = { incidentId, mediaItem, eventTimestamp: new Date() };
  ioInstance.to(`incident_${incidentId}`).to("dispatch_consoles").to("hospitals").to("fire_stations").emit("MEDIA_ATTACHED", payload);
  console.log(`[Socket.io] Emitted MEDIA_ATTACHED for Incident ${incidentId}`);
};

/**
 * Broadcast status update event (ACKNOWLEDGED, EN_ROUTE, ON_SCENE, RESOLVED, CANCELLED)
 */
const emitStatusUpdated = (incident, updateMetadata = {}) => {
  if (!ioInstance) return;
  const payload = {
    incidentId: incident._id,
    status: incident.status,
    incident,
    updateMetadata,
    eventTimestamp: new Date(),
  };
  ioInstance
    .to(`incident_${incident._id}`)
    .to("dispatch_consoles")
    .to("hospitals")
    .to("fire_stations")
    .to("volunteers")
    .emit("STATUS_UPDATED", payload);
  console.log(`[Socket.io] Emitted STATUS_UPDATED (${incident.status}) for Incident ${incident._id}`);
};

/**
 * Broadcast hospital bed/resource capacity update
 */
const emitHospitalCapacityUpdated = (hospitalId, capacityData) => {
  if (!ioInstance) return;
  const payload = {
    hospitalId,
    ...capacityData,
    updatedAt: new Date(),
  };
  ioInstance
    .to("dispatch_consoles")
    .to("hospitals")
    .emit("HOSPITAL_CAPACITY_UPDATED", payload);
  console.log(`[Socket.io] Emitted HOSPITAL_CAPACITY_UPDATED for Hospital ${hospitalId}`);
};

module.exports = {
  initEmergencySocket,
  getIO,
  emitDispatchSos,
  emitFireEmergencyDispatch,
  emitVicinityFireBroadcast,
  emitMediaAttached,
  emitStatusUpdated,
  emitHospitalCapacityUpdated,
};


