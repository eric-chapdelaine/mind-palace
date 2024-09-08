const mongoose = require("mongoose");

module.exports = new mongoose.Schema({
    title: {type: String, unique: true, required: true},
    // The list of all parent tags to this one
    dependencies: [{type: mongoose.Schema.Types.ObjectId, ref: "Tag"}],
}, {collection: "Tag"});
// maybe: replace dependencies line with dependencies: {type: [Tag], required: true, default: []} and require Tag from models