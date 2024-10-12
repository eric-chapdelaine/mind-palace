const express = require("express");
let Task = require('../schema/tasks');
let Tag = require('../schema/tags');

const router = express.Router();

// create - create new task
router.post('/', async (req, res) => {
    try {
        let {
            title,
            due_date,
            tags,
            description,
            activities,
            is_completed,
        } = req.body;
        const task = await Task.create({
            title,
            due_date,
            tags,
            description,
            activities,
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
        const task = await Task.findOne({_id: id});
        if (!task) return res.status(404).json({message: "Task not found"});
        return res.status(200).json(task);
    } catch (error) {
        res.status(500).json({message: error.message});
    }
});

// read - read all tasks
router.get('/', async (req, res) => {
    try {
        const tasks = await Task.find();
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

        let {
            title,
            due_date,
            tags,
            description,
            activities,
            is_completed,
        } = req.body;

        const task = await Task.findOneAndUpdate(
            {_id: id},
            {
                title,
                due_date,
                tags,
                description,
                activities,
                is_completed,
            },
            {new: true}
        );
        if (!task) return res.status(404).json({message: "Task not found"});
    } catch (error) {
        res.status(500).json({message: error.message});
    }
});

// update - add tag
router.post('/:id/add_tag', async (req, res) => {
    try {
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