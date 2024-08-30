let Task = require('../models/tasks');
const { get_activity } = require('./activities');
const { get_tag } = require('./tags');

exports.get_task = async (title) => {
    return Task.findOne({'title': title}).populate('activities.activity').populate('tags.tag');
}

exports.get_all_tasks = async () => {
    return Task.find({}).populate('activities.activity').populate('tags.tag');
}

exports.new_task = async (res, title, description, due_date, tag_names, activity_names) => {
    let task_details = {title: title};
    if (tag_names != false) {
        let tags = tag_names.map(async function(t) {
            let tag = await get_tag(t).exec();
            return tag;
        });
        task_details.tags = tags;
    };
    if (activity_names != false) {
    let activities = activity_names.map(async function(a) {
        let activity = await get_activity(a).exec();
        return activity;
    });
    task_details.activities = activities;
    };
    if (description == false) {
        task_details.description = "";
    } else {
        task_details.description = description;
    };
    if (due_date != false) task_details.due_date = due_date;
    let task = Task(task_details);
    await task.save();
    res.send('Created new task: ' + task);
    return task;
}

exports.delete_task = async (title) => {
    Task.deleteOne({title : title});
}