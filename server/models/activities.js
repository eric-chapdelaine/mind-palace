const mongoose = require("mongoose")

const Activity = require("./schema/activity");

module.exports = mongoose.model("Activity", Activity);