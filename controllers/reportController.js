const Incident = require("../models/Incident");
const Hospital = require("../models/Hospital");

/**
 * Helper to build Date filter for time window
 * @param {string} timeframe - 'today', '7d', '30d', 'all'
 */
const getDateFilter = (timeframe) => {
  if (!timeframe || timeframe === "all") return {};
  const now = new Date();
  const filterDate = new Date();

  switch (timeframe.toLowerCase()) {
    case "today":
      filterDate.setHours(0, 0, 0, 0);
      break;
    case "7d":
    case "week":
      filterDate.setDate(now.getDate() - 7);
      break;
    case "30d":
    case "month":
      filterDate.setDate(now.getDate() - 30);
      break;
    default:
      return {};
  }
  return { createdAt: { $gte: filterDate } };
};

/**
 * @desc    Get summary report of incidents by status and type
 * @route   GET /api/reports/summary
 * @access  Public
 */
const getSummaryReport = async (req, res) => {
  try {
    const timeframe = req.query.timeframe || req.query.window || "all";
    const dateFilter = getDateFilter(timeframe);

    const [byStatus, byType, totalCount] = await Promise.all([
      Incident.aggregate([
        { $match: dateFilter },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Incident.aggregate([
        { $match: dateFilter },
        { $group: { _id: "$type", count: { $sum: 1 } } },
      ]),
      Incident.countDocuments(dateFilter),
    ]);

    const statusCounts = {
      PENDING: 0,
      DISPATCHED: 0,
      ACKNOWLEDGED: 0,
      EN_ROUTE: 0,
      ON_SCENE: 0,
      RESOLVED: 0,
      CANCELLED: 0,
    };
    (byStatus || []).forEach((item) => {
      if (item._id) statusCounts[item._id] = item.count;
    });

    const typeCounts = {
      MEDICAL: 0,
      SECURITY: 0,
      FIRE: 0,
    };
    (byType || []).forEach((item) => {
      if (item._id) typeCounts[item._id] = item.count;
    });

    const activeIncidents =
      (statusCounts.PENDING || 0) +
      (statusCounts.DISPATCHED || 0) +
      (statusCounts.ACKNOWLEDGED || 0) +
      (statusCounts.EN_ROUTE || 0) +
      (statusCounts.ON_SCENE || 0);

    return res.status(200).json({
      success: true,
      timeframe,
      data: {
        total: totalCount || 0,
        active: activeIncidents,
        resolved: statusCounts.RESOLVED || 0,
        cancelled: statusCounts.CANCELLED || 0,
        byStatus: statusCounts,
        byType: typeCounts,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: `Failed to generate summary report: ${error.message}`,
    });
  }
};

/**
 * @desc    Get average response times per incident type
 * @route   GET /api/reports/response-times
 * @access  Public
 */
const getResponseTimesReport = async (req, res) => {
  try {
    const timeframe = req.query.timeframe || req.query.window || "all";
    const dateFilter = getDateFilter(timeframe);

    const incidents = await Incident.find(dateFilter)
      .select("type statusHistory createdAt")
      .lean();

    const metricsByType = {
      MEDICAL: { count: 0, totalToOnSceneSec: 0, onSceneCount: 0, totalToResolvedSec: 0, resolvedCount: 0 },
      SECURITY: { count: 0, totalToOnSceneSec: 0, onSceneCount: 0, totalToResolvedSec: 0, resolvedCount: 0 },
      FIRE: { count: 0, totalToOnSceneSec: 0, onSceneCount: 0, totalToResolvedSec: 0, resolvedCount: 0 },
    };

    (incidents || []).forEach((inc) => {
      const type = inc.type;
      if (!metricsByType[type]) {
        metricsByType[type] = { count: 0, totalToOnSceneSec: 0, onSceneCount: 0, totalToResolvedSec: 0, resolvedCount: 0 };
      }
      metricsByType[type].count++;

      const createdTime = new Date(inc.createdAt).getTime();
      const history = inc.statusHistory || [];

      // Find first ON_SCENE transition
      const onSceneEntry = history.find((h) => h.status === "ON_SCENE");
      if (onSceneEntry && onSceneEntry.changedAt) {
        const diffSec = Math.max(0, (new Date(onSceneEntry.changedAt).getTime() - createdTime) / 1000);
        metricsByType[type].totalToOnSceneSec += diffSec;
        metricsByType[type].onSceneCount++;
      }

      // Find first RESOLVED transition
      const resolvedEntry = history.find((h) => h.status === "RESOLVED");
      if (resolvedEntry && resolvedEntry.changedAt) {
        const diffSec = Math.max(0, (new Date(resolvedEntry.changedAt).getTime() - createdTime) / 1000);
        metricsByType[type].totalToResolvedSec += diffSec;
        metricsByType[type].resolvedCount++;
      }
    });

    const result = {};
    let grandTotalOnSceneSec = 0;
    let grandOnSceneCount = 0;

    Object.keys(metricsByType).forEach((type) => {
      const m = metricsByType[type];
      const avgOnSceneSec = m.onSceneCount > 0 ? Math.round(m.totalToOnSceneSec / m.onSceneCount) : null;
      const avgResolvedSec = m.resolvedCount > 0 ? Math.round(m.totalToResolvedSec / m.resolvedCount) : null;

      result[type] = {
        totalIncidents: m.count,
        recordedOnScene: m.onSceneCount,
        recordedResolved: m.resolvedCount,
        avgTimeToOnSceneSeconds: avgOnSceneSec,
        avgTimeToOnSceneMinutes: avgOnSceneSec !== null ? +(avgOnSceneSec / 60).toFixed(1) : null,
        avgTimeToResolvedSeconds: avgResolvedSec,
        avgTimeToResolvedMinutes: avgResolvedSec !== null ? +(avgResolvedSec / 60).toFixed(1) : null,
      };

      grandTotalOnSceneSec += m.totalToOnSceneSec;
      grandOnSceneCount += m.onSceneCount;
    });

    const overallAvgSec = grandOnSceneCount > 0 ? Math.round(grandTotalOnSceneSec / grandOnSceneCount) : null;

    return res.status(200).json({
      success: true,
      timeframe,
      data: {
        overallAverageOnSceneSeconds: overallAvgSec,
        overallAverageOnSceneMinutes: overallAvgSec !== null ? +(overallAvgSec / 60).toFixed(1) : null,
        byType: result,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: `Failed to compute response times: ${error.message}`,
    });
  }
};

/**
 * @desc    Get top geographic hotspots for incidents
 * @route   GET /api/reports/hotspots
 * @access  Public
 */
const getHotspotsReport = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 5;
    const timeframe = req.query.timeframe || req.query.window || "all";
    const dateFilter = getDateFilter(timeframe);

    const hotspots = await Incident.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: {
            // Round coordinates to 2 decimal places (~1.1km cluster)
            lng: { $round: [{ $arrayElemAt: ["$location.coordinates", 0] }, 2] },
            lat: { $round: [{ $arrayElemAt: ["$location.coordinates", 1] }, 2] },
          },
          count: { $sum: 1 },
          types: { $push: "$type" },
        },
      },
      { $sort: { count: -1 } },
      { $limit: limit },
    ]);

    const formattedHotspots = (hotspots || []).map((h) => {
      // Find predominant incident type
      const typeMap = {};
      (h.types || []).forEach((t) => {
        typeMap[t] = (typeMap[t] || 0) + 1;
      });
      let predominantType = "UNKNOWN";
      let maxTypeCount = 0;
      Object.entries(typeMap).forEach(([t, count]) => {
        if (count > maxTypeCount) {
          maxTypeCount = count;
          predominantType = t;
        }
      });

      return {
        coordinates: [h._id.lng, h._id.lat],
        incidentCount: h.count,
        predominantType,
        breakdown: typeMap,
      };
    });

    return res.status(200).json({
      success: true,
      timeframe,
      data: {
        totalHotspots: formattedHotspots.length,
        hotspots: formattedHotspots,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: `Failed to compute hotspots: ${error.message}`,
    });
  }
};

/**
 * @desc    Get hospital bed utilisation rates & overall capacity
 * @route   GET /api/reports/hospital-utilisation
 * @access  Public
 */
const getHospitalUtilisationReport = async (req, res) => {
  try {
    const hospitals = await Hospital.find({}).lean();

    let totalBeds = 0;
    let availableBeds = 0;
    let totalIcu = 0;
    let totalAmbulances = 0;
    let activeAmbulances = 0;

    const breakdown = (hospitals || []).map((h) => {
      const cap = h.capacity || {};
      const amb = h.ambulances || {};
      const hTotal = cap.total || 0;
      const hAvail = cap.available || 0;
      const occupied = Math.max(0, hTotal - hAvail);
      const occupancyRate = hTotal > 0 ? +((occupied / hTotal) * 100).toFixed(1) : 0;

      totalBeds += hTotal;
      availableBeds += hAvail;
      totalIcu += cap.icuAvailable || 0;
      totalAmbulances += amb.total || h.availableAmbulances || 0;
      activeAmbulances += amb.activeOnCall || 0;

      return {
        id: h._id,
        name: h.name,
        isOperational: h.isOperational,
        totalBeds: hTotal,
        availableBeds: hAvail,
        occupiedBeds: occupied,
        occupancyRatePercent: occupancyRate,
        icuAvailable: cap.icuAvailable || 0,
        oxygenAvailable: !!cap.oxygenAvailable,
      };
    });

    const totalOccupied = Math.max(0, totalBeds - availableBeds);
    const overallOccupancyRate = totalBeds > 0 ? +((totalOccupied / totalBeds) * 100).toFixed(1) : 0;

    return res.status(200).json({
      success: true,
      data: {
        totalHospitals: hospitals.length,
        totalBeds,
        availableBeds,
        occupiedBeds: totalOccupied,
        overallOccupancyRatePercent: overallOccupancyRate,
        totalIcuAvailable: totalIcu,
        totalAmbulances,
        activeAmbulances,
        hospitals: breakdown,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: `Failed to compute hospital utilisation: ${error.message}`,
    });
  }
};

/**
 * @desc    Get responder activity (assignments and dispatch distribution)
 * @route   GET /api/reports/responder-activity
 * @access  Public
 */
const getResponderActivityReport = async (req, res) => {
  try {
    const timeframe = req.query.timeframe || req.query.window || "all";
    const dateFilter = getDateFilter(timeframe);

    const incidents = await Incident.find(dateFilter)
      .select("assignedUnits status statusHistory")
      .lean();

    let totalAssignments = 0;
    const unitTypeBreakdown = {
      Hospital: 0,
      FireStation: 0,
      User: 0,
    };
    const unitActivity = {};

    (incidents || []).forEach((inc) => {
      (inc.assignedUnits || []).forEach((unit) => {
        totalAssignments++;
        const uType = unit.unitType || "User";
        if (unitTypeBreakdown[uType] !== undefined) {
          unitTypeBreakdown[uType]++;
        } else {
          unitTypeBreakdown[uType] = 1;
        }

        const key = unit.name || (unit.unitId ? unit.unitId.toString() : "Unknown Unit");
        if (!unitActivity[key]) {
          unitActivity[key] = {
            unitId: unit.unitId,
            unitType: uType,
            name: unit.name,
            totalDispatches: 0,
          };
        }
        unitActivity[key].totalDispatches++;
      });
    });

    const activeRespondersList = Object.values(unitActivity).sort(
      (a, b) => b.totalDispatches - a.totalDispatches
    );

    return res.status(200).json({
      success: true,
      timeframe,
      data: {
        totalAssignments,
        byUnitType: unitTypeBreakdown,
        topResponders: activeRespondersList.slice(0, 10),
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: `Failed to compute responder activity: ${error.message}`,
    });
  }
};

module.exports = {
  getSummaryReport,
  getResponseTimesReport,
  getHotspotsReport,
  getHospitalUtilisationReport,
  getResponderActivityReport,
};
