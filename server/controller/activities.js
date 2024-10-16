const express = require("express");

let Activity = require('../schema/activities');
let ActivityType = require('../schema/activitytypes');
let Task = require('../schema/tasks');
const TimeBlock = require("../schema/timeblocks");
const TimeEntry = require("../schema/timeentries");

const router = express.Router();

// create - create new activity with activity type and task
router.post('/', async (req, res) => {
    try {
    let {
        activity_type_id,
        task_id,
        scheduled_times,
        feel_answer
    } = req.body;

    // ensure task exists
    const task = await Task.findOne({_id: task_id});
    if (!task) return res.status(404).json({message: "Task not found"});

    // ensure activity type exists
    const activity_type = await ActivityType.findOne({_id: activity_type_id});
    if (!activity_type) return res.status(404).json({message: "activity type not found"});

    // create activity with params
    const activity = await Activity.create({
        activity_type_id,
        task_id,
        scheduled_times: scheduled_times || [],
        feel_answer
    });


    // add activity to task
    await Task.findOneAndUpdate(
        {_id: task_id},
        {$push: {activities: {$each: [activity._id], $position: 0}}},
        {new : true}
    );

    return res.status(200).json(activity)

   } catch (error) {
    res.status(500).json({message: error.message});
   }
});

// TODO: remove endpoint when done
router.get("/test", async (req, res) => {
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

// read - get info about all activities

router.get('/', async (req, res) => {
    try {
        const activity = await Activity.find().populate('task_id activity_type_id');
        // TODO: maybe populate scheduled_times too when we need to
        if (!activity) return res.status(500).json({message: "failed to fetch activities"});
        return res.status(200).json(activity);
    } catch (error) {
        res.status(500).json({message: error.message});
    }
});

// read - get info about given activity (takes in activity id)

router.get('/:id', async (req, res) => {
    try {
        let {id} = req.params;
        const activity = await Activity.findOne({_id: id}).populate('task_id activity_type_id');
        // TODO: maybe populate scheduled_times too when we need to
        if (!activity) return res.status(404).json({message: "activity not found"});
        return res.status(200).json(activity);
    } catch (error) {
        res.status(500).json({message: error.message});
    }
});

// update - edit information (takes in acitivty id and fields to be modified)
router.post('/:id', async (req, res) => {
    try {
        let {id} = req.params;
        let {
            activity_type_id,
            task_id,
            scheduled_times,
            feel_answer
        } = req.body;
        // TODO: maybe eventually validate input?
        const activity = await Activity.findOneAndUpdate(
            {_id: id},
            {
                activity_type_id,
                task_id,
                scheduled_times,
                feel_answer
            },
            {new: true}
        );
        if (!activity) return res.status(404).json({message: "activity not found"});
        return res.status(200).json(activity);
    } catch (error) {
        res.status(500).json({message: error.message});
    }
});


// update - add scheduled time to activity
router.post('/:id/schedule', async (req, res) => {
    try {
        let {id} = req.params;
        let {
            start_time,
            end_time
        } = req.body;

        const time = TimeBlock({start_time, end_time});

        const activity = await Activity.findOneAndUpdate(
            {_id: id},
            {$push: {scheduled_times: {$each: [time._id], $position: 0}}},
            {new: true}
        );

        await time.save();

        if (!activity) return res.status(404).json({message: "activity not found"});

        return res.status(200).json(activity);
    } catch (error) {
        res.status(500).json({message: error.message});
    }
});

// update - log time entry
router.post('/:id/log_time', async (req, res) => {
    try {
        let {id} = req.params;
        let {
            description,
            start_time,
            end_time,
        } = req.body;

        const activity = await Activity.findOne({_id: id});

        if (!activity) return res.status(404).json({message: "activity not found"});

        const time_block = await TimeBlock.create({start_time, end_time});

        const time_entry = await TimeEntry.create({
            description,
            activity: activity._id,
            task: activity.task_id,
            time_block,
        });

        return res.status(200).json(time_entry);
    } catch (error) {
        res.status(500).json({message: error.message});
    }
});

// update - delete scheduled time
router.delete('/:id/schedule', async (req, res) => {
    try {
        let {id} = req.params;
        let {time_block_id} = req.body;
        res.status(401).json("Unimplemented");

    } catch (error) {
        res.status(500).json({message: error.message});
    }

});

// delete - delete activity

router.delete('/:id', async (req, res) => {
    try {
        let {id} = req.params;
        await Activity.deleteOne({_id: id});
        res.status(200);
    } catch (error) {
        res.status(500).json({message: error.message});
    }
});

module.exports = router;