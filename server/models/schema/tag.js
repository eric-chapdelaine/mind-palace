const mongoose = require("mongoose");

module.exports = new mongoose.Schema({
    title: {type: String, unique: true, required: true},
    dependencies: [{type: mongoose.Schema.Types.ObjectId, ref: "Tag"}],
}, {collection: "Tag"});