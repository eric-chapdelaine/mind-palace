const mongoose = require("mongoose")

const Task = require("./schema/task");

module.exports = mongoose.model("Task", Task);