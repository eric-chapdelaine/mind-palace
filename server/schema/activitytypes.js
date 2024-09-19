const mongoose = require("mongoose")

const ActivityType = new mongoose.Schema({
    name: {type: String, unique: true, required: true},
}, {collection: "ActivityType"});

module.exports = mongoose.model("ActivityType", ActivityType);