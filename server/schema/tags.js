const mongoose = require("mongoose")

const Tag = new mongoose.Schema({
    title: {type: String, unique: true, required: true},
    // The list of all parent tags to this one
    dependencies: [{type: mongoose.Schema.Types.ObjectId, ref: "Tag"}],
}, {collection: "Tag"});

module.exports = mongoose.model("Tag", Tag);