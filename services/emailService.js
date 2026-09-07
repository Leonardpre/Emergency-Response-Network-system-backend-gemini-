const nodemailer = require("nodemailer");
const { getIO } = require("../sockets/emergencySocket");

let transporter = null;

/**
 * Reset cached transporter (useful for testing or config changes)
 */
const resetTransporter = () => {
  transporter = null;
};

/**
 * Override transporter instance (useful for mocking or custom transports)
 */
const setTransporter = (t) => {
  transporter = t;
};

/**
 * Get or create the Nodemailer transporter
 */
const getTransporter = () => {
  if (transporter) return transporter;

  const emailService = process.env.EMAIL_SERVICE || "gmail";

  const pass = (process.env.SMTP_PASS || "").replace(/\s+/g, "");

  if (emailService.toLowerCase() === "gmail") {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.SMTP_USER,
        pass,
      },
    });
  } else {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: parseInt(process.env.SMTP_PORT, 10) || 587,
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass,
      },
    });
  }

  return transporter;
};

/**
 * Generate HTML template for emergency dispatch email
 */
const buildAlertHtml = (incident) => {
  const typeColor =
    incident.type === "FIRE"
      ? "#e53e3e"
      : incident.type === "SECURITY"
      ? "#d69e2e"
      : "#3182ce";

  const coords = incident.location?.coordinates || [0, 0];
  const mapsUrl = `https://maps.google.com/?q=${coords[1]},${coords[0]}`;

  const unitsList =
    incident.assignedUnits && incident.assignedUnits.length > 0
      ? incident.assignedUnits
          .map(
            (u) =>
              `<li><strong>${u.name || "Assigned Unit"}</strong> (${u.unitType || "Responder"} - ${
                u.distanceMeters ? Math.round(u.distanceMeters) + "m away" : "dispatched"
              })</li>`
          )
          .join("")
      : "<li>No immediate local units auto-assigned. Dispatch queue notified.</li>";

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; background-color: #ffffff;">
      <div style="background-color: ${typeColor}; padding: 20px; text-align: center; color: #ffffff;">
        <h1 style="margin: 0; font-size: 22px; letter-spacing: 0.5px;">🚨 EMERGENCY ALERT DISPATCHED</h1>
        <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">Aide Check Emergency Response Network</p>
      </div>

      <div style="padding: 24px; color: #2d3748;">
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <tr>
            <td style="padding: 8px 0; font-weight: bold; width: 140px; color: #4a5568;">Incident ID:</td>
            <td style="padding: 8px 0; font-family: monospace; font-size: 14px;">${incident._id || "N/A"}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold; color: #4a5568;">Emergency Type:</td>
            <td style="padding: 8px 0;">
              <span style="background-color: ${typeColor}; color: white; padding: 3px 8px; border-radius: 4px; font-weight: bold; font-size: 12px;">
                ${incident.type}
              </span>
            </td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold; color: #4a5568;">Status:</td>
            <td style="padding: 8px 0; font-weight: 600; color: #2b6cb0;">${incident.status || "DISPATCHED"}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold; color: #4a5568;">Dispatch Tier:</td>
            <td style="padding: 8px 0;">${incident.dispatchTier || "TIER_1"}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold; color: #4a5568;">Coordinates:</td>
            <td style="padding: 8px 0;">
              [Lng: ${coords[0]}, Lat: ${coords[1]}]
              <br/>
              <a href="${mapsUrl}" target="_blank" style="color: #3182ce; text-decoration: underline; font-size: 13px;">View on Google Maps &rarr;</a>
            </td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold; color: #4a5568;">Description:</td>
            <td style="padding: 8px 0;">${incident.description || "Emergency SOS Alert"}</td>
          </tr>
          ${
            incident.victimInfo?.phone
              ? `<tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #4a5568;">Victim Contact:</td>
                  <td style="padding: 8px 0;">${incident.victimInfo.name || "Victim"} (${incident.victimInfo.phone})</td>
                </tr>`
              : ""
          }
        </table>

        <div style="background-color: #f7fafc; border: 1px solid #edf2f7; border-radius: 6px; padding: 16px; margin-bottom: 20px;">
          <h3 style="margin: 0 0 10px 0; font-size: 15px; color: #2d3748;">Assigned Responders</h3>
          <ul style="margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.6; color: #4a5568;">
            ${unitsList}
          </ul>
        </div>

        <p style="font-size: 12px; color: #a0aec0; text-align: center; margin: 20px 0 0 0;">
          This is an automated dispatch notification sent by Aide Check Emergency Response Network.<br/>
          Please do not reply directly to this email.
        </p>
      </div>
    </div>
  `;
};

/**
 * Send an email alert for a newly dispatched incident
 * @param {Object} incident - Incident document
 * @param {Object} options - Override options (to, subject)
 */
const sendIncidentAlert = async (incident, options = {}) => {
  const isEnabled = process.env.ENABLE_EMAIL_ALERTS === "true";
  if (!isEnabled) {
    return {
      sent: false,
      reason: "EMAIL_ALERTS_DISABLED",
      message: "Email alerts are disabled in environment configuration (ENABLE_EMAIL_ALERTS != true).",
    };
  }

  const recipient =
    options.to || process.env.ALERT_TO_EMAIL || process.env.SMTP_USER;
  if (!recipient) {
    return {
      sent: false,
      reason: "NO_RECIPIENT_CONFIGURED",
      message: "No recipient email configured for alerts.",
    };
  }

  try {
    const client = getTransporter();
    const coords = incident.location?.coordinates || [0, 0];
    const subject =
      options.subject ||
      `🚨 [EMERGENCY ${incident.type}] Incident Dispatched #${incident._id || "NEW"}`;

    const mailOptions = {
      from:
        process.env.ALERT_FROM_EMAIL ||
        `"Emergency Response Network" <${process.env.SMTP_USER || "alerts@aidecheck.org"}>`,
      to: recipient,
      subject,
      text: `[EMERGENCY ${incident.type}] Dispatched at [${coords[0]}, ${coords[1]}]. Description: ${incident.description || "Emergency SOS Alert"}.`,
      html: buildAlertHtml(incident),
    };

    const info = await client.sendMail(mailOptions);
    console.log(`[Email Service] Emergency alert sent for Incident ${incident._id}. MessageId: ${info?.messageId}`);

    // Emit live socket event for real-time dashboards
    try {
      const io = getIO();
      if (io) {
        io.emit("INCIDENT_ALERT_EMAIL_SENT", {
          incidentId: incident._id,
          type: incident.type,
          recipient,
          messageId: info?.messageId,
          timestamp: new Date(),
        });
      }
    } catch (socketErr) {
      // Non-fatal if socket is not initialized during unit tests
    }

    return {
      sent: true,
      messageId: info?.messageId,
      recipient,
    };
  } catch (error) {
    console.error(`[Email Service Error] Failed to send incident alert email:`, error.message);
    return {
      sent: false,
      reason: "TRANSPORTER_ERROR",
      message: error.message,
    };
  }
};

module.exports = {
  sendIncidentAlert,
  buildAlertHtml,
  getTransporter,
  setTransporter,
  resetTransporter,
};
