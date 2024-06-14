const mongoose = require("mongoose");

module.exports = new mongoose.Schema({
    name: {type: String, unique: true, required: true},
}, {collection: "ActivityType"});