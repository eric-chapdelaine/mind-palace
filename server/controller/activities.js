const express = require("express");

let Activity = require('../models/activities');
let ActivityType = require('../models/activitytypes');
let Task = require('../models/tasks');
const TimeBlock = require("../models/timeblocks");

const router = express.Router();

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
        scheduled_times: scheduled_times || [],
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
        const activity = await Activity.find().populate('task_id activity_id');
        // TODO: maybe populate scheduled_times too when we need to
        if (!activity) return res.status(404).json({message: "failed to fetch activities"});
        return res.status(200).json(activity);
    } catch (error) {
        res.status(500).json({message: error.message});
    }
});

// read - get info about given activity (takes in activity id)

router.get('/:id', async (req, res) => {
    try {
        let {id} = req.params;
        const activity = await Activity.findOne({_id: id}).populate('task_id activity_id');
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
            activity_id,
            task_id,
            scheduled_times,
            feel_answer
        } = req.body;
        // TODO: maybe eventually validate input?
        const activity = await Activity.findOneAndUpdate(
            {_id: id},
            {
                activity_id,
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

// delete - delete activity

router.delete('/:id', async (req, res) => {
    try {
        let {id} = req.params;
        await Activity.deleteOne({_id: id});
    } catch (error) {
        res.status(500).json({message: error.message});
    }
});

module.exports = router;