let ActivityType = require('../models/activitytypes');

exports.get_activity_type = async (name) => {
    return ActivityType.findOne({name: name});
}

exports.get_all_activity_types = async () => {
    return ActivityType.find({});
}

exports.new_activity_type = async (res, name) => {
    let activity_type = ActivityType({name: name});
    await activity_type.save();
    res.send('Created new activity type: ' + activity_type);
}