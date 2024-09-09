const express = required("express");
let Task = require('../models/tasks');

const router = express.Router();

// create - create new task
router.post('/', async (req, res) => {
    try {
        let {
            title,
            due_date,
            tags,
            description,
            activities
        } = req.body;
        const task = await Task.create({
            title,
            due_date,
            tags,
            description,
            activities
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
        return res.status(200).json

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
            activities
        } = req.body;

        const task = await Task.findOneAndUpdate(
            {_id: id},
            {
                title,
                due_date,
                tags,
                description,
                activities
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
        // TODO: implement
        res.status(501).json({message: "Unimplemented"});
    } catch (error) {
        res.status(500).json({message: error.message});
    }
});

// update - add activity
router.post('/:id/add_activity', async (req, res) => {
    try {
        // TODO: implement
        res.status(501).json({message: "Unimplemented"});

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