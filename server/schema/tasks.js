const mongoose = require("mongoose")

const Task = new mongoose.Schema({
    title: {type: String, unique: true, required: true},
    due_date: {type: Date, required: false},
    tags: [{type: mongoose.Schema.Types.ObjectId, ref: "Tag"}],
    description: {type: String, required: true, default: ""},
    activities: [{type: mongoose.Schema.Types.ObjectId, ref: "Activity"}],
    is_completed: {type: Boolean, required: true, default: false}
}, {collection: "Task"});

module.exports = mongoose.model("Task", Task);