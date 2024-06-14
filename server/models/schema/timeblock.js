const mongoose = require("mongoose");

module.exports = new mongoose.Schema({
    start_time: {type: Date, required: true},
    end_time: {type: Date, required: true},
}, {collection: "TimeBlock"});