const mongoose = require("mongoose");

module.exports = new mongoose.Schema({
    title: {type: String, unique: true, required: true},
    due_date: {type: Date, required: false},
    tags: [{type: mongoose.Schema.Types.ObjectId, ref: "Tag"}],
    description: {type: String, required: true, default: ""},
    activities: [{type: mongoose.Schema.Types.ObjectId, ref: "Activity"}]
}, {collection: "Task"});