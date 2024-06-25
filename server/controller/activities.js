let Activity = require('../models/activities');
const { get_activity_type } = require('./activitytypes');
const { get_task } = require('./tasks');

exports.get_activity = async (activity_id, task_id) => {
    return Activity.findOne({activity_id : activity_id, task_id: task_id})
    .populate('activity_id').populate('task_id').populate('scheduled_times.time');
}

exports.get_all_activities = async () => {
    return Activity.find({})
    .populate('activity_id').populate('task_id').populate('scheduled_times.time');
}

exports.new_activity = async (res, activity_name, task_name, scheduled_time_blocks, feel_answer) => {
    let scheduled_times = scheduled_time_blocks.map(function(t) {
        let time_block = await get_time_block(t[0], t[1]).exec();
        // what should scheduled_time_blocks look like? is it an array of pairs [start, end] or a list of TimeBlock refs?
        return time_block;
    });
    let activity_id = get_activity_type(activity_name);
    let task_id = get_task(task_name);
    let activity = Activity({
        activity_id : activity_id,
        task_id : task_id,
        scheduled_times : scheduled_times,
        feel_answer : feel_answer
    });
    await activity.save();
    res.send('Created new activity: ' + activity)
}

exports.delete_activity = async (activity_name, task_name) => {
    let activity_id = get_activity_type(activity_name);
    let task_id = get_task(task_name);
    Activity.deleteOne({activity_id : activity_id, task_id : task_id});
}