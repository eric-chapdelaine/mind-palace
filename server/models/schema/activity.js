const mongoose = require("mongoose");

const rangeValidator = {
    validator: function(value) {
        return value >= 1 && value <= 7;
    },
    message: 'feel_answer must be an integer between 1 and 7'
};

module.exports = new mongoose.Schema({
    activity_id: {type: mongoose.Schema.Types.ObjectId, ref: "Activity", required: true},
    task_id: {type: mongoose.Schema.Types.ObjectId, ref: "Task", required: true},
    scheduled_times: [{type: mongoose.Schema.Types.ObjectId, ref: "TimeBlock"}],
    feel_answer: {type: Number, validate: rangeValidator },
}, {collection: "Activity"});