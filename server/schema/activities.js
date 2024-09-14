const mongoose = require("mongoose")

const rangeValidator = {
    validator: function(value) {
        return value >= 1 && value <= 7;
    },
    message: 'feel_answer must be an integer between 1 and 7'
};

const Activity = new mongoose.Schema({
    activity_type_id: {type: mongoose.Schema.Types.ObjectId, ref: "ActivityType", required: true},
    task_id: {type: mongoose.Schema.Types.ObjectId, ref: "Task", required: true},
    scheduled_times: [{type: mongoose.Schema.Types.ObjectId, ref: "TimeBlock"}],
    feel_answer: {type: Number, validate: rangeValidator},
}, {collection: "Activity"});

// maybe: replace scheduled_times line with scheduled_times: {type: [TimeBlock], required: true, default: []} and require TimeBlock from models

module.exports = mongoose.model("Activity", Activity);