const mongoose = require("mongoose")

const TimeEntry = new mongoose.Schema({
    description: {type: String, required: true, default: ""},
    task: {type: mongoose.Schema.Types.ObjectId, ref: "Task"},
    time_block: {type: mongoose.Schema.Types.ObjectId, ref: "TimeBlock", required: true},
    // TODO: add validation to check for valid commit?
    commits: [{type: String}],
}, {collection: "TimeEntry"});

module.exports = mongoose.model("TimeEntry", TimeEntry);