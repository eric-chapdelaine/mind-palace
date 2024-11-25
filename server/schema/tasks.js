const mongoose = require("mongoose")

const Task = new mongoose.Schema({
    title: {type: String, unique: true, required: true},
    due_date: {type: Date, required: false},
    tags: [{type: mongoose.Schema.Types.ObjectId, ref: "Tag"}],
    description: {type: String, required: false, default: ""},
    is_completed: {type: Boolean, required: true, default: false},
    date_completed: {type: Date, required: false},
    scheduled_times: [{type: mongoose.Schema.Types.ObjectId, ref: "TimeBlock"}],
}, {collection: "Task"});

module.exports = mongoose.model("Task", Task);
