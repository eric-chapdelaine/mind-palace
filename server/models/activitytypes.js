const mongoose = require("mongoose")

const ActivityType = require("./schema/activitytype");

module.exports = mongoose.model("ActivityType", ActivityType);