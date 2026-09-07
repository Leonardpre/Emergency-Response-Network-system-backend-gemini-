const Hospital = require("../models/Hospital");
const FireStation = require("../models/FireStation");
const User = require("../models/User");
const Incident = require("../models/Incident");
const {
  emitDispatchSos,
  emitFireEmergencyDispatch,
  emitVicinityFireBroadcast,
  emitMediaAttached,
  emitStatusUpdated,
} = require("../sockets/emergencySocket");
const { sendIncidentAlert } = require("../services/emailService");

/**
 * Helper function to extract longitude and latitude from request
 */
const extractCoordinates = (reqBody) => {
  let longitude, latitude;

  if (Array.isArray(reqBody.coordinates) && reqBody.coordinates.length === 2) {
    longitude = parseFloat(reqBody.coordinates[0]);
    latitude = parseFloat(reqBody.coordinates[1]);
  } else if (reqBody.longitude !== undefined && reqBody.latitude !== undefined) {
    longitude = parseFloat(reqBody.longitude);
    latitude = parseFloat(reqBody.latitude);
  } else if (reqBody.location?.coordinates && Array.isArray(reqBody.location.coordinates)) {
    longitude = parseFloat(reqBody.location.coordinates[0]);
    latitude = parseFloat(reqBody.location.coordinates[1]);
  }

  if (isNaN(longitude) || isNaN(latitude)) {
    return null;
  }
  return [longitude, latitude]; // GeoJSON [lng, lat]
};

/**
 * Handle incoming Medical, Security, or Fire SOS dispatch
 * POST /api/dispatch/sos
 */
const dispatchSOS = async (req, res) => {
  try {
    const { type, description, victimInfo } = req.body;

    if (!type || typeof type !== "string" || !["MEDICAL", "SECURITY", "FIRE"].includes(type.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: "Invalid emergency type. Allowed values: MEDICAL, SECURITY, FIRE",
      });
    }

    const coords = extractCoordinates(req.body);
    if (!coords) {
      return res.status(400).json({
        success: false,
        message: "Invalid location coordinates. Please provide [longitude, latitude].",
      });
    }

    const [longitude, latitude] = coords;
    const geoPoint = { type: "Point", coordinates: [longitude, latitude] };
    const emergencyType = type.toUpperCase();

    // ---------------------------------------------------------
    // Case A: MEDICAL or SECURITY SOS Geo-Dispatch (10 km Radius)
    // ---------------------------------------------------------
    if (emergencyType === "MEDICAL" || emergencyType === "SECURITY") {
      const radiusMeters = 10000; // 10 km

      const nearbyHospitals = await Hospital.find({
        isOperational: true,
        location: {
          $nearSphere: {
            $geometry: geoPoint,
            $maxDistance: radiusMeters,
          },
        },
      });

      const assignedUnits = nearbyHospitals.map((h) => ({
        unitId: h._id,
        unitType: "Hospital",
        name: h.name,
      }));

      const incident = await Incident.create({
        type: emergencyType,
        location: geoPoint,
        description: description || `${emergencyType} Emergency Dispatch`,
        dispatchTier: "TIER_1_HOSPITAL",
        assignedUnits,
        victimInfo,
        status: "DISPATCHED",
      });

      // Real-time WebSocket Alert
      emitDispatchSos(incident, nearbyHospitals);

      // Asynchronous Email Alert Dispatch (if enabled)
      sendIncidentAlert(incident).catch((err) =>
        console.error("[Email Alert Error]:", err.message)
      );

      return res.status(201).json({
        success: true,
        message: `SOS dispatched to ${nearbyHospitals.length} hospital(s) within 10 km radius.`,
        dispatchTier: "TIER_1_HOSPITAL",
        matchedCount: nearbyHospitals.length,
        incident,
        nearbyFacilities: nearbyHospitals,
      });
    }

    // ---------------------------------------------------------
    // Case B: Cascading Fire Outbreak Protocol
    // ---------------------------------------------------------
    if (emergencyType === "FIRE") {
      // Tier 1: 20 km Fire Station radius query
      const fireStationRadiusMeters = 20000; // 20 km

      const nearbyFireStations = await FireStation.find({
        isOperational: true,
        location: {
          $nearSphere: {
            $geometry: geoPoint,
            $maxDistance: fireStationRadiusMeters,
          },
        },
      });

      // Tier 1 Success: Fire station(s) available within 20 km
      if (nearbyFireStations.length > 0) {
        const assignedUnits = nearbyFireStations.map((fs) => ({
          unitId: fs._id,
          unitType: "FireStation",
          name: fs.name,
        }));

        const incident = await Incident.create({
          type: "FIRE",
          location: geoPoint,
          description: description || "Fire Outbreak - CAD Tier 1 Dispatch",
          dispatchTier: "TIER_1_FIRE_STATION",
          assignedUnits,
          victimInfo,
          status: "DISPATCHED",
        });

        // Emit CAD Event
        emitFireEmergencyDispatch(incident, nearbyFireStations);

        // Asynchronous Email Alert Dispatch (if enabled)
        sendIncidentAlert(incident).catch((err) =>
          console.error("[Email Alert Error]:", err.message)
        );

        return res.status(201).json({
          success: true,
          message: `Tier 1 Fire CAD dispatched to ${nearbyFireStations.length} station(s) within 20 km.`,
          dispatchTier: "TIER_1_FIRE_STATION",
          matchedCount: nearbyFireStations.length,
          incident,
          nearbyFacilities: nearbyFireStations,
        });
      }

      // Tier 2 Fallback: Zero fire stations within 20 km -> 2 km Vicinity Broadcast to Community Volunteers
      const volunteerRadiusMeters = 2000; // 2 km

      const nearbyVolunteers = await User.find({
        role: "volunteer",
        isAvailable: true,
        location: {
          $nearSphere: {
            $geometry: geoPoint,
            $maxDistance: volunteerRadiusMeters,
          },
        },
      });

      const assignedUnits = nearbyVolunteers.map((vol) => ({
        unitId: vol._id,
        unitType: "User",
        name: vol.name,
      }));

      const incident = await Incident.create({
        type: "FIRE",
        location: geoPoint,
        description: description || "Fire Outbreak - Tier 2 Community Volunteer Vicinity Broadcast",
        dispatchTier: "TIER_2_VOLUNTEER_VICINITY",
        assignedUnits,
        victimInfo,
        status: "DISPATCHED",
      });

      // Emit Vicinity Broadcast Event
      emitVicinityFireBroadcast(incident, nearbyVolunteers);

      // Asynchronous Email Alert Dispatch (if enabled)
      sendIncidentAlert(incident).catch((err) =>
        console.error("[Email Alert Error]:", err.message)
      );

      return res.status(201).json({
        success: true,
        message: `Zero fire stations within 20 km. Escalated to Tier 2 Vicinity Broadcast alerting ${nearbyVolunteers.length} volunteer(s) within 2 km.`,
        dispatchTier: "TIER_2_VOLUNTEER_VICINITY",
        matchedCount: nearbyVolunteers.length,
        incident,
        nearbyVolunteers,
      });
    }
  } catch (error) {
    console.error("[Dispatch Controller Error]:", error);
    return res.status(500).json({
      success: false,
      message: "Server error during SOS dispatch execution.",
      error: error.message,
    });
  }
};

/**
 * Asynchronous Proof Verification Engine
 * Attaches voice note, photo, or compressed proof media to an existing Incident ID
 * POST /api/dispatch/incident/:id/media
 */
const attachVerificationMedia = async (req, res) => {
  try {
    const { id } = req.params;
    let finalUrl = req.body?.mediaUrl;
    let finalType = req.body?.mediaType ? req.body.mediaType.toUpperCase() : null;

    if (req.file) {
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      finalUrl = `${baseUrl}/uploads/${req.file.filename}`;

      if (!finalType) {
        if (req.file.mimetype.startsWith("audio/")) {
          finalType = "VOICE_NOTE";
        } else if (req.file.mimetype.startsWith("image/")) {
          finalType = "PHOTO";
        } else {
          finalType = "OTHER";
        }
      }
    }

    if (!finalUrl) {
      return res.status(400).json({
        success: false,
        message: "Please upload a media file ('mediaFile') or provide a 'mediaUrl'.",
      });
    }

    const incident = await Incident.findById(id);
    if (!incident) {
      return res.status(404).json({
        success: false,
        message: `Incident with ID ${id} not found.`,
      });
    }

    const newMedia = {
      url: finalUrl,
      mediaType: finalType || "PHOTO",
      uploadedAt: new Date(),
    };

    incident.media.push(newMedia);
    await incident.save();

    // Emit socket event to consoles and incident room
    emitMediaAttached(incident._id.toString(), newMedia);

    return res.status(200).json({
      success: true,
      message: "Media attached asynchronously to incident successfully.",
      incident,
      attachedMedia: newMedia,
    });
  } catch (error) {
    console.error("[Attach Media Controller Error]:", error);
    return res.status(500).json({
      success: false,
      message: "Server error during media attachment.",
      error: error.message,
    });
  }
};

/**
 * Utility Controller to Seed Sample Responder Facilities & Volunteers
 * POST /api/dispatch/seed
 */
const seedFacilities = async (req, res) => {
  try {
    // Center point: Lagos City Center [3.3792, 6.5244]
    const baseLng = 3.3792;
    const baseLat = 6.5244;

    await Hospital.deleteMany({});
    await FireStation.deleteMany({});
    await User.deleteMany({ role: "volunteer" });

    // Seed Hospitals: 1 within 3 km (~0.02 deg), 1 within 8 km (~0.06 deg), 1 far away 25 km (~0.2 deg)
    const hospitals = await Hospital.create([
      {
        name: "St. Nicholas Hospital (Central)",
        contactNumber: "+234-801-111-2222",
        isOperational: true,
        location: { type: "Point", coordinates: [baseLng + 0.015, baseLat + 0.015] }, // ~2.3 km
      },
      {
        name: "Lagos University Teaching Hospital (LUTH)",
        contactNumber: "+234-802-333-4444",
        isOperational: true,
        location: { type: "Point", coordinates: [baseLng - 0.04, baseLat + 0.04] }, // ~6.2 km
      },
      {
        name: "Outskirts General Hospital (Out of 10km Range)",
        contactNumber: "+234-803-555-6666",
        isOperational: true,
        location: { type: "Point", coordinates: [baseLng + 0.25, baseLat + 0.25] }, // ~38 km
      },
    ]);

    // Seed Fire Stations: 1 within 15 km (~0.1 deg), 1 far away 50 km (~0.45 deg)
    const fireStations = await FireStation.create([
      {
        name: "Ikeja Fire Station HQ",
        contactNumber: "+234-800-FIRE-01",
        isOperational: true,
        location: { type: "Point", coordinates: [baseLng + 0.08, baseLat + 0.08] }, // ~12.5 km
      },
      {
        name: "Remote Regional Fire Station",
        contactNumber: "+234-800-FIRE-02",
        isOperational: true,
        location: { type: "Point", coordinates: [baseLng + 0.45, baseLat + 0.45] }, // ~70 km
      },
    ]);

    // Seed Volunteers: 2 within 1 km (~0.008 deg), 1 outside 2 km (~0.03 deg)
    const volunteers = await User.create([
      {
        name: "John Doe (Community First Responder)",
        phone: "+234-701-000-1111",
        role: "volunteer",
        isAvailable: true,
        location: { type: "Point", coordinates: [baseLng + 0.005, baseLat + 0.005] }, // ~0.8 km
      },
      {
        name: "Jane Smith (Safety Volunteer)",
        phone: "+234-702-000-2222",
        role: "volunteer",
        isAvailable: true,
        location: { type: "Point", coordinates: [baseLng - 0.007, baseLat + 0.006] }, // ~1.1 km
      },
      {
        name: "Alex Faraway (Volunteer Outside 2km)",
        phone: "+234-703-000-3333",
        role: "volunteer",
        isAvailable: true,
        location: { type: "Point", coordinates: [baseLng + 0.035, baseLat + 0.035] }, // ~5.4 km
      },
    ]);

    return res.status(200).json({
      success: true,
      message: "Sample responder facilities and community volunteers seeded successfully.",
      seeded: {
        hospitals: hospitals.length,
        fireStations: fireStations.length,
        volunteers: volunteers.length,
      },
    });
  } catch (error) {
    console.error("[Seed Controller Error]:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to seed sample facilities.",
      error: error.message,
    });
  }
};

/**
 * Fetch all incidents with optional filtering and pagination
 * GET /api/dispatch/incidents
 */
const getIncidents = async (req, res) => {
  try {
    const { status, type, limit = 50, page = 1 } = req.query;
    const filter = {};

    if (status) {
      filter.status = status.toUpperCase();
    }
    if (type) {
      filter.type = type.toUpperCase();
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [incidents, total] = await Promise.all([
      Incident.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Incident.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      count: incidents.length,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      incidents,
    });
  } catch (error) {
    console.error("[Get Incidents Error]:", error);
    return res.status(500).json({
      success: false,
      message: "Server error fetching incidents.",
      error: error.message,
    });
  }
};

/**
 * Fetch single incident by ID
 * GET /api/dispatch/incident/:id
 */
const getIncidentById = async (req, res) => {
  try {
    const { id } = req.params;
    const incident = await Incident.findById(id);

    if (!incident) {
      return res.status(404).json({
        success: false,
        message: `Incident with ID ${id} not found.`,
      });
    }

    return res.status(200).json({
      success: true,
      incident,
    });
  } catch (error) {
    console.error("[Get Incident By ID Error]:", error);
    return res.status(500).json({
      success: false,
      message: "Server error fetching incident.",
      error: error.message,
    });
  }
};

/**
 * Update incident status (e.g. ACKNOWLEDGED, EN_ROUTE, ON_SCENE, RESOLVED, CANCELLED)
 * PATCH /api/dispatch/incident/:id/status
 */
const updateIncidentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, note, responderId, responderName } = req.body;

    const validStatuses = [
      "PENDING",
      "DISPATCHED",
      "ACKNOWLEDGED",
      "EN_ROUTE",
      "ON_SCENE",
      "RESOLVED",
      "CANCELLED",
    ];

    const upperStatus = (typeof status === "string") ? status.toUpperCase() : null;
    if (!status || !upperStatus || !validStatuses.includes(upperStatus)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status '${status}'. Allowed values: ${validStatuses.join(", ")}`,
      });
    }

    const incident = await Incident.findById(id);
    if (!incident) {
      return res.status(404).json({
        success: false,
        message: `Incident with ID ${id} not found.`,
      });
    }

    incident.status = upperStatus;
    incident.statusHistory.push({
      status: upperStatus,
      changedAt: new Date(),
      note: note || `Status updated to ${upperStatus}${responderName ? ` by ${responderName}` : ""}`,
    });

    await incident.save();

    // Broadcast real-time status update to all connected consoles, rooms & incident listeners
    emitStatusUpdated(incident, { note, responderId, responderName });

    return res.status(200).json({
      success: true,
      message: `Incident status updated to ${upperStatus} successfully.`,
      incident,
    });
  } catch (error) {
    console.error("[Update Incident Status Error]:", error);
    return res.status(500).json({
      success: false,
      message: "Server error updating incident status.",
      error: error.message,
    });
  }
};

/**
 * Fetch all registered facilities and active volunteers for dispatcher maps
 * GET /api/dispatch/facilities
 */
const getFacilities = async (req, res) => {
  try {
    const [hospitals, fireStations, volunteers] = await Promise.all([
      Hospital.find({ isOperational: true }),
      FireStation.find({ isOperational: true }),
      User.find({ role: "volunteer", isAvailable: true }).select("-password"),
    ]);

    return res.status(200).json({
      success: true,
      facilities: {
        hospitals,
        fireStations,
        volunteers,
      },
    });
  } catch (error) {
    console.error("[Get Facilities Error]:", error);
    return res.status(500).json({
      success: false,
      message: "Server error fetching facilities.",
      error: error.message,
    });
  }
};

/**
 * Fetch immutable chronological audit trail for an incident
 * GET /api/dispatch/incident/:id/audit-trail
 */
const getIncidentAuditTrail = async (req, res) => {
  try {
    const { id } = req.params;
    const incident = await Incident.findById(id).select(
      "type description status statusHistory assignedUnits createdAt updatedAt"
    );

    if (!incident) {
      return res.status(404).json({
        success: false,
        message: `Incident with ID ${id} not found.`,
      });
    }

    const timeline = incident.statusHistory.map((item) => ({
      status: item.status,
      timestamp: item.changedAt,
      note: item.note,
    }));

    return res.status(200).json({
      success: true,
      incidentId: incident._id,
      emergencyType: incident.type,
      currentStatus: incident.status,
      createdAt: incident.createdAt,
      totalTransitions: timeline.length,
      timeline,
      assignedUnits: incident.assignedUnits,
    });
  } catch (error) {
    console.error("[Get Audit Trail Error]:", error);
    return res.status(500).json({
      success: false,
      message: "Server error fetching incident audit trail.",
      error: error.message,
    });
  }
};

module.exports = {
  dispatchSOS,
  attachVerificationMedia,
  seedFacilities,
  getIncidents,
  getIncidentById,
  updateIncidentStatus,
  getFacilities,
  getIncidentAuditTrail,
};

