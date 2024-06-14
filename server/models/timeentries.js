const mongoose = require("mongoose")

const TimeEntry = require("./schema/timeentry");

module.exports = mongoose.model("TimeEntry", TimeEntry);