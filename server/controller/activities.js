const express = require("express");

let Activity = require('../models/activities');
let ActivityType = require('../models/activitytypes');
let Task = require('../models/tasks');
// const { get_activity_type } = require('./activitytypes');
// const { get_task } = require('./tasks');

const router = express.Router();

// CRUD
// create - create new activity with activity type and task
router.post('/', async (req, res) => {
    try {
    let {
        activity_id,
        task_id,
        scheduled_times,
        feel_answer
    } = req.body;

    // ensure task exists
    const task = await Task.findOne({_id: task_id});
    console.log(req);
    if (!task) return res.status(404).json({message: "Task not found"});

    // ensure activity type exists
    const activityType = await ActivityType.findOne({_id: activity_id});
    if (!activityType) return res.status(404).json({message: "activity type not found"});

    // create activity with params
    const activity = await Activity.create({
        activity_id,
        task_id,
        scheduled_times,
        feel_answer
    });


    // add activity to task
    await Task.findOneAndUpdate(
        {_id: task_id},
        {$push: {activities: {$each: [activity._id], $position: 0}}},
        {new : true}
    );

    res.status(200).json(activity)

   } catch (error) {
    res.status(500).json({message: error.message});
   }
});

router.get("/", async (req, res) => {
    const newTask = await Task.create({
    title: "test title",
    tags: [],
    description: "desc",
    activities: []
    });
    await ActivityType.create({
        name: 'Researching'
    });
    res.status(200).json(newTask);
});

module.exports = router;

// read - get info about given activity (takes in activity id)
// update - edit information (takes in acitivty id and fields to be modified)
// delete - delete activity (takes in activity id)

// router.get('/:activity_id')
// exports.get_activity = async (activity_id, task_id) => {
//     return Activity.findOne({activity_id : activity_id, task_id: task_id})
//     .populate('activity_id').populate('task_id').populate('scheduled_times.time');
// }

// exports.get_all_activities = async () => {
//     return Activity.find({})
//     .populate('activity_id').populate('task_id').populate('scheduled_times.time');
// }

// exports.new_activity = async (res, activity_name, task_name, scheduled_time_blocks, feel_answer) => {
//     // scheduled_times should be required but possibly empty
//     if (scheduled_time_blocks === "undefined") scheduled_time_blocks = [];
//     let scheduled_times = scheduled_time_blocks.map(async function(t) {
//         let time_block = await get_time_block(t[0], t[1]).exec();
//         return time_block;
//     });
//     let activity_id = get_activity_type(activity_name);
//     let task_id = get_task(task_name);
//     let activity_details = {
//         activity_id : activity_id,
//         task_id : task_id,
//         scheduled_times : scheduled_times,
//     };
//     if (feel_answer != false) {
//         activity_details.feel_answer = feel_answer;
//     };
//     let activity = Activity(activity_details);
//     await activity.save();
//     res.send('Created new activity: ' + activity)
// }

// exports.delete_activity = async (activity_name, task_name) => {
//     let activity_id = get_activity_type(activity_name);
//     let task_id = get_task(task_name);
//     Activity.deleteOne({activity_id : activity_id, task_id : task_id});
// }