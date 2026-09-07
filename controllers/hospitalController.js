const Hospital = require("../models/Hospital");
const { emitHospitalCapacityUpdated } = require("../sockets/emergencySocket");

/**
 * Fetch live bed and resource capacity for a specific hospital
 * GET /api/hospitals/:id/capacity
 */
const getHospitalCapacity = async (req, res) => {
  try {
    const { id } = req.params;
    const hospital = await Hospital.findById(id).select(
      "name isOperational capacity ambulances availableAmbulances location contactNumber"
    );

    if (!hospital) {
      return res.status(404).json({
        success: false,
        message: `Hospital with ID ${id} not found.`,
      });
    }

    return res.status(200).json({
      success: true,
      hospitalId: hospital._id,
      name: hospital.name,
      capacity: hospital.capacity,
      ambulances: hospital.ambulances,
      isOperational: hospital.isOperational,
    });
  } catch (error) {
    console.error("[Get Capacity Error]:", error);
    return res.status(500).json({
      success: false,
      message: "Server error fetching hospital capacity.",
      error: error.message,
    });
  }
};

/**
 * Update hospital bed and resource capacity
 * PATCH /api/hospitals/:id/capacity
 */
const updateHospitalCapacity = async (req, res) => {
  try {
    const { id } = req.params;
    const { capacity, ambulances, isOperational } = req.body;

    const hospital = await Hospital.findById(id);
    if (!hospital) {
      return res.status(404).json({
        success: false,
        message: `Hospital with ID ${id} not found.`,
      });
    }

    if (capacity) {
      if (capacity.total !== undefined) hospital.capacity.total = parseInt(capacity.total);
      if (capacity.available !== undefined) hospital.capacity.available = parseInt(capacity.available);
      if (capacity.icuAvailable !== undefined) hospital.capacity.icuAvailable = parseInt(capacity.icuAvailable);
      if (capacity.oxygenAvailable !== undefined) hospital.capacity.oxygenAvailable = Boolean(capacity.oxygenAvailable);
    }

    if (ambulances) {
      if (ambulances.total !== undefined) {
        hospital.ambulances.total = parseInt(ambulances.total);
        hospital.availableAmbulances = hospital.ambulances.total;
      }
      if (ambulances.activeOnCall !== undefined) hospital.ambulances.activeOnCall = parseInt(ambulances.activeOnCall);
    }

    if (isOperational !== undefined) {
      hospital.isOperational = Boolean(isOperational);
    }

    await hospital.save();

    // Real-time broadcast to dispatchers and hospital consoles
    emitHospitalCapacityUpdated(hospital._id.toString(), {
      name: hospital.name,
      capacity: hospital.capacity,
      ambulances: hospital.ambulances,
      isOperational: hospital.isOperational,
    });

    return res.status(200).json({
      success: true,
      message: `Capacity updated successfully for ${hospital.name}.`,
      hospital: {
        id: hospital._id,
        name: hospital.name,
        capacity: hospital.capacity,
        ambulances: hospital.ambulances,
        isOperational: hospital.isOperational,
      },
    });
  } catch (error) {
    console.error("[Update Capacity Error]:", error);
    return res.status(500).json({
      success: false,
      message: "Server error updating hospital capacity.",
      error: error.message,
    });
  }
};

/**
 * Get summary overview of all hospitals' bed & ambulance capacity
 * GET /api/hospitals/capacity-overview
 */
const getCapacityOverview = async (req, res) => {
  try {
    const hospitals = await Hospital.find({ isOperational: true }).select(
      "name contactNumber isOperational capacity ambulances location"
    );

    const summary = {
      totalHospitals: hospitals.length,
      totalBeds: 0,
      availableBeds: 0,
      totalIcuBeds: 0,
      totalAmbulances: 0,
      ambulancesOnCall: 0,
    };

    hospitals.forEach((h) => {
      summary.totalBeds += h.capacity?.total || 0;
      summary.availableBeds += h.capacity?.available || 0;
      summary.totalIcuBeds += h.capacity?.icuAvailable || 0;
      summary.totalAmbulances += h.ambulances?.total || 0;
      summary.ambulancesOnCall += h.ambulances?.activeOnCall || 0;
    });

    return res.status(200).json({
      success: true,
      summary,
      hospitals,
    });
  } catch (error) {
    console.error("[Capacity Overview Error]:", error);
    return res.status(500).json({
      success: false,
      message: "Server error fetching capacity overview.",
      error: error.message,
    });
  }
};

module.exports = {
  getHospitalCapacity,
  updateHospitalCapacity,
  getCapacityOverview,
};
