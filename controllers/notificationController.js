const User = require("../models/User");
const Incident = require("../models/Incident");
const { emitStatusUpdated } = require("../sockets/emergencySocket");

/**
 * Handle incoming SMS / GSM reply from field responders
 * POST /api/notifications/sms-webhook
 * Compatible with Twilio / Africa's Talking / Custom GSM Gateway
 */
const handleSmsWebhook = async (req, res) => {
  try {
    const senderPhone = req.body.From || req.body.from || req.body.phone;
    const incomingText = (req.body.Body || req.body.text || req.body.message || "").trim().toUpperCase();
    const incidentId = req.body.incidentId || req.body.IncidentId;

    console.log(`[SMS Webhook] Inbound SMS from ${senderPhone}: "${incomingText}"`);

    if (!senderPhone || !incomingText) {
      return res.status(400).json({
        success: false,
        message: "Sender phone ('From') and message body ('Body') are required.",
      });
    }

    // Match sender with registered responder / volunteer
    const responder = await User.findOne({ phone: senderPhone });
    const responderName = responder ? responder.name : `Field Responder (${senderPhone})`;

    // Determine target incident: either passed in payload or find latest active dispatched incident
    let incident = null;
    if (incidentId) {
      incident = await Incident.findById(incidentId);
    } else {
      incident = await Incident.findOne({
        status: { $in: ["DISPATCHED", "PENDING"] },
      }).sort({ createdAt: -1 });
    }

    if (!incident) {
      return res.status(200).json({
        success: true,
        message: "SMS received, but no active pending incident matched.",
        replyText: "Aide Check: No active pending incidents currently awaiting your response.",
      });
    }

    let newStatus = null;
    let replyMessage = "";

    if (["YES", "ACCEPT", "ACK", "1", "OK"].includes(incomingText)) {
      newStatus = "ACKNOWLEDGED";
      replyMessage = `Aide Check: Acknowledged for Incident #${incident._id.toString().slice(-4)}. Please proceed to scene.`;
    } else if (["EN ROUTE", "ENROUTE", "MOVING", "2"].includes(incomingText)) {
      newStatus = "EN_ROUTE";
      replyMessage = `Aide Check: Status updated to EN_ROUTE for Incident #${incident._id.toString().slice(-4)}.`;
    } else if (["ARRIVED", "ON SCENE", "ONSCENE", "3"].includes(incomingText)) {
      newStatus = "ON_SCENE";
      replyMessage = `Aide Check: Status updated to ON_SCENE for Incident #${incident._id.toString().slice(-4)}.`;
    } else if (["NO", "DECLINE", "UNAVAILABLE", "4"].includes(incomingText)) {
      replyMessage = `Aide Check: Declined recorded. We will re-route to next closest unit.`;
    }

    if (newStatus) {
      incident.status = newStatus;
      incident.statusHistory.push({
        status: newStatus,
        changedAt: new Date(),
        note: `GSM/SMS Fallback update from ${responderName}: "${incomingText}"`,
      });

      await incident.save();

      // Emit real-time status update to all connected dispatch consoles
      emitStatusUpdated(incident, {
        note: `Updated via SMS from ${responderName}`,
        responderName,
        phone: senderPhone,
      });
    }

    // Return TwiML or JSON format
    if (req.headers["content-type"]?.includes("form-urlencoded")) {
      res.set("Content-Type", "text/xml");
      return res.send(
        `<Response><Message>${replyMessage || "Aide Check: Message received."}</Message></Response>`
      );
    }

    return res.status(200).json({
      success: true,
      message: "SMS webhook processed successfully.",
      incomingText,
      updatedStatus: newStatus || incident.status,
      incidentId: incident._id,
      replyText: replyMessage,
    });
  } catch (error) {
    console.error("[SMS Webhook Error]:", error);
    return res.status(500).json({
      success: false,
      message: "Server error processing SMS webhook.",
      error: error.message,
    });
  }
};

module.exports = {
  handleSmsWebhook,
};
