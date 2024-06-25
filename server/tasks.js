let Task = require('./models/tasks');
const { get_activity } = require('./activities');
const { get_tag } = require('./tags');

exports.get_task = async (title) => {
    return Task.findOne({'title': title}).populate('activities.activity').populate('tags.tag');
}

exports.get_all_tasks = async () => {
    return Task.find({}).populate('activities.activity').populate('tags.tag');
}

exports.new_task = async (res, title, description, due_date, tag_names, activity_names) => {
    let tags = tag_names.map(function(t) {
        let tag = await get_tag(t).exec();
        return tag;
    })
    let activities = activity_names.map(function(a) {
        let activity = await get_activity(a).exec();
        return activity;
    })
    let task = Task({
        title: title,
        due_date: due_date,  // how to make this optional? Leave it and let it be possibly null?
        description: description,
        activities: activities
    });
    await task.save();
    res.send('Created new task: ' + task);
}

exports.delete_task = async (title) => {
    Task.deleteOne({title : title});
}