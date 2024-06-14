const mongoose = require("mongoose");

module.exports = new mongoose.Schema({
    description: {type: String, required: true, default: ""},
    activity: {type: mongoose.Schema.Types.ObjectId, ref: "Activity", required: true},
    task: {type: mongoose.Schema.Types.ObjectId, ref: "Task"},
    time_block: {type: mongoose.Schema.Types.ObjectId, ref: "TimeBlock", required: true},
    // TODO: add validation to check for valid commit?
    commits: [{type: String}],
}, {collection: "TimeEntry"});