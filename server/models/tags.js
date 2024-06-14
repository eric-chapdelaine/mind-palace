const mongoose = require("mongoose")

const Tag = require("./schema/tag");

module.exports = mongoose.model("Tag", Tag);