const express = require("express");
const router = express.Router();
const { handleSmsWebhook } = require("../controllers/notificationController");

// @route   POST /api/notifications/sms-webhook
// @desc    Inbound SMS/GSM webhook for responder accept/en-route replies
// @access  Public (Webhook Provider)
router.post("/sms-webhook", handleSmsWebhook);

module.exports = router;
