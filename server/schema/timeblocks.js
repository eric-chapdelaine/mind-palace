const mongoose = require("mongoose")

const TimeBlock = new mongoose.Schema({
    start_time: {type: Date, required: true},
    end_time: {type: Date, required: true},
}, {collection: "TimeBlock"});

module.exports = mongoose.model("TimeBlock", TimeBlock);