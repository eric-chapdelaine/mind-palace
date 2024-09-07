const express = require("express");

let ActivityType = require('../models/activitytypes');

const router = express.Router();

// create - create activity type
router.post('/', async (req, res) => {
    try {
        let {name} = req.body;
        const activity_type = await ActivityType.create({
            name
        });
        res.status(200).json({activity_type});
    } catch (error) {
        res.status(500).json({message: error.message});
    }
});

// read - get info on particular activity type
router.get('/:id', async (req, res) => {
    try {
        let {id} = req.params;
        const activityType = await ActivityType.findOne({_id: id});
        if (!activityType) return res.status(404).json({message: "Activity type cannot be found"});
        return res.status(200).json(activityType);
    } catch (error) {
        res.status(500).json({message: error.message});
    }
});

// read - list all activity types
router.get('/', async (req, res) => {
    try {
        const activityType = await ActivityType.find();
        if (!activityType) return res.status(500).json({message: "failed to fetch activity type"});
        return res.status(200).json(activityType);
    } catch (error) {
        res.status(500).json({message: error.message});
    }
});

// update - change name
router.post('/:id', async (req, res) => {
    try {
        let {id} = req.params;
        let {name} = req.body;
        const activityType = await ActivityType.findOneAndUpdate(
            {_id: id},
            {name},
            {new: true}
        );
        if (!activityType) return res.status(404).json({message: "Activity type not found"});
        return res.status(200).json(activityType);
    } catch (error) {
        res.status(500).json({message: error.message});
    }
});

// delete - delete activity type
router.delete('/:id', async (req, res) => {
    try {
        let {id} = req.params;
        await ActivityType.deleteOne({_id: id});
        res.status(200);
    } catch (error) {
        res.status(500).json({message: error.message});
    }
});