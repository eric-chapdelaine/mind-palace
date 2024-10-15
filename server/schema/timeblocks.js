const mongoose = require("mongoose")

const TimeBlock = new mongoose.Schema({
    start_time: {type: Date, required: true},
    end_time: {type: Date, required: true},
    activity_type_id: {type: mongoose.Schema.Types.ObjectId, ref: "ActivityType", required: false}
}, {collection: "TimeBlock"});

module.exports = mongoose.model("TimeBlock", TimeBlock);