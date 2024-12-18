const express = require("express");

let ActivityType = require('../schema/activitytypes');

const router = express.Router();

// create - create activity type
router.post('/', async (req, res) => {
    try {
        let {name} = req.body;
        const activity_type = await ActivityType.create({
            name
        });
        return res.status(200).json({activity_type});
    } catch (error) {
        return res.status(500).json({message: error.message});
    }
});

// read - get info on particular activity type
router.get('/:id', async (req, res) => {
    try {
        let {id} = req.params;
        const activity_type = await ActivityType.findOne({_id: id});
        if (!activity_type) return res.status(404).json({message: "Activity type cannot be found"});
        return res.status(200).json(activity_type);
    } catch (error) {
        return res.status(500).json({message: error.message});
    }
});

// read - list all activity types
router.get('/', async (req, res) => {
    try {
        const activity_types = await ActivityType.find();
        if (!activity_types) return res.status(500).json({message: "failed to fetch activity type"});
        return res.status(200).json(activity_types);
    } catch (error) {
        return res.status(500).json({message: error.message});
    }
});

// update - change name
router.post('/:id/rename', async (req, res) => {
    try {
        let {id} = req.params;
        let {name} = req.body;
        const activity_type = await ActivityType.findOneAndUpdate(
            {_id: id},
            {name},
            {new: true}
        );
        if (!activity_type) return res.status(404).json({message: "Activity type not found"});
        return res.status(200).json(activity_type);
    } catch (error) {
        return res.status(500).json({message: error.message});
    }
});

// delete - delete activity type
router.delete('/:id', async (req, res) => {
    try {
        let {id} = req.params;
        await ActivityType.deleteOne({_id: id});
        return res.status(200);
    } catch (error) {
        return res.status(500).json({message: error.message});
    }
});

module.exports = router;
