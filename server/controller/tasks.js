const express = require("express");
let Task = require('../schema/tasks');
let Tag = require('../schema/tags');
const TimeBlock = require("../schema/timeblocks");
const TimeEntry = require("../schema/timeentries");

const router = express.Router();

// create - create new task
router.post('/', async (req, res) => {
    try {
        let {
            title,
            due_date,
            tags,
            description,
            is_completed,
        } = req.body;
        const task = await Task.create({
            title,
            due_date,
            tags,
            description,
            is_completed,
        });
        res.status(200).json({task});
    } catch (error) {
        res.status(500).json({message: error.message});
    }
});

// read - read individual task
router.get('/:id', async (req, res) => {
    try {
        let {id} = req.params;
        const task = await Task.findOne({_id: id}).populate('scheduled_times');
        if (!task) return res.status(404).json({message: "Task not found"});
        return res.status(200).json(task);
    } catch (error) {
        res.status(500).json({message: error.message});
    }
});

// read - read all tasks
router.get('/', async (req, res) => {
    try {
        const tasks = await Task.find().populate('scheduled_times');
        if (!tasks) return res.status(500).json({message: "Failed to fetch tasks"});
        return res.status(200).json(tasks);
    } catch (error) {
        res.status(500).json({message: error.message});
    }
});

// update - update task
router.post('/:id', async (req, res) => {
    try {
        let {id} = req.params;

        // let updated_fields = {};

        let {
            title,
            due_date,
            tags,
            description,
            is_completed,
            scheduled_times,
        } = req.body;

        // // only update the fields if they are given
        // if (title) updated_fields.title = title;
        // if (due_date) updated_fields.due_date = due_date;
        // if (tags) updated_fields.tags = tags;
        // if (description) updated_fields.description = description;
        // if (is_completed) updated_fields.is_completed = is_completed;
        // if (scheduled_times) updated_fields.scheduled_times = scheduled_times;

        const task = await Task.findOneAndUpdate(
            {_id: id},
            {
              title,
              due_date,
              tags,
              description,
              is_completed,
              scheduled_times,
            },
            {new: true}
        );
        if (!task) return res.status(404).json({message: "Task not found"});
        return res.status(200).json(task);
    } catch (error) {
        res.status(500).json({message: error.message});
    }
});

// update - add tag
router.post('/:id/add_tag', async (req, res) => {
    try {
        let {id} = req.params;
        let {tag_id} = req.body;

        const tag = await Tag.findOne({_id: tag_id});
        if (!tag) return res.status(404).json({message: "Tag not found"});

        const task = await Task.findOne({_id: id});
        if (!task) return res.status(404).json({message: "Task not found"});

        await Task.findOneAndUpdate(
            {_id: id},
            {$push: {tags: {$each: [tag._id], $position: 0}}},
            {new: true}
        );

        return res.status(200).json(task);
    } catch (error) {
        res.status(500).json({message: error.message});
    }
});

// update - add new scheduled time
router.post('/:id/add_scheduled_time', async (req, res) => {
    try {
        let {id} = req.params;
        let {
            start_time,
            end_time,
            activity_type_id
        } = req.body;

        const new_time = await TimeBlock.create({
            start_time,
            end_time,
            activity_type_id
        })

        const task = await Task.findOne({_id: id});
        if (!task) return res.status(404).json({message: "Task not found"});

        await Task.findOneAndUpdate(
            {_id: id},
            {$push: {scheduled_times: {$each: [new_time], $position: 0}}},
            {new: true}
        );

        return res.status(200).json(task);
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
            activity_type_id
        } = req.body;

        const task = await Task.findOne({_id: id});

        if (!task) return res.status(404).json({message: "task not found"});

        const time_block = await TimeBlock.create({start_time, end_time, activity_type_id});

        const time_entry = await TimeEntry.create({
            description,
            task: id,
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

// delete - delete task
router.delete('/:id', async (req, res) => {
    try {
        let {id} = req.params;
        await Task.deleteOne({_id: id});
        res.status(200);
    } catch (error) {
        res.status(500).json({message: error.message});
    }
});

module.exports = router;
