const express = require("express");
let Task = require('../schema/tasks');
const TimeBlock = require("../schema/timeblocks");
const TimeEntry = require("../schema/timeentries");

const router = express.Router();

// delete - delete scheduled task
router.delete('/:id', async (req, res) => {
    try {
        let {id} = req.params;
        await TimeBlock.deleteOne({_id: id});
        // TODO: maybe figure out a more scalable way to do this
        await Task.updateMany(
            { scheduled_times: id },
            { $pull: { scheduled_times: id } }
        );
        return res.status(200).json({message: "Success"});
    } catch (error) {
        return res.status(500).json({message: error.message});
    }
});

module.exports = router;
