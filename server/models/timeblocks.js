const mongoose = require("mongoose")

const TimeBlock = require("./schema/timeblock");

module.exports = mongoose.model("TimeBlock", TimeBlock);