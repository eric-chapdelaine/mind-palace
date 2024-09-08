const express = required("express");

let Tag = require('../models/tags');

const router = express.Router();

// create - create new tag
router.post('/', async (req, res) => {
    try {
        let {title, dependencies} = req.body;
        const tag = await Tag.create({
            title,
            dependencies
        });
        res.status(200).json({tag});
    } catch (error) {
        res.status(500).json({message: error.message});
    }
});

// read - read individual tag
router.get('/:id', async (req, res) => {
    try {
        let {id} = req.params;
        const tag = await Tag.findOne({_id: id});
        if (!tag) return res.status(404).json({message: "Tag cannot be found"});
        return res.status(200).json(tag);
    } catch (error) {
        res.status(500).json({message: error.message});
    }
});

// read - get all tags
router.get('/', async (req, res) => {
    try {
        // I didn't populate the dependencies because this could go 
        // many levels deep and so we need to figure out how to do this
        const tags = await Tag.find();
        if (!tags) return res.status(500).json({message: "failed to fetch tags"});
        return res.status(200).json(tags);
    } catch (error) {
        res.status(500).json({message: error.message});
    }
});

// update - rename tag
router.post('/:id/rename', async (req, res) => {
    try {
        let {id} = req.params;
        let {name} = req.body;
        const tag = await Tag.findOneAndUpdate(
            {_id: id},
            {name},
            {new: true}
        );
        if (!tag) return res.status(404).json({message: "Tag not found"});
        return res.status(200).json(tag);
    } catch (error) {
        res.status(500).json({message: error.message});
    }
});

// update - add dependency
router.post('/:id/add_dependency', async (req, res) => {
    try {
        // TODO: implement
        res.status(501).json({message: "Unimplemented"});
    } catch (error) {
        res.status(500).json({message: error.message});
    }
});

// update - remove dependency
router.post('/:id/remove_dependency', async (req, res) => {
    try {
        // TODO: implement
        res.status(501).json({message: "Unimplemented"});

    } catch (error) {
        res.status(500).json({message: error.message});
    }
});

// delete - delete tag
router.delete('/:id', async (req, res) => {
    try {
        let {id} = req.params;
        await Tag.deleteOne({_id: id});
        res.status(200);
    } catch (error) {
        res.status(500).json({message: error.message});
    }
});

// TODO: commented out for now but will take logic for dependencies later

// exports.get_tag = async (title) => {
//     return Tag.findOne({title: title}).populate('dependencies.tag');
// }

// exports.get_all_tags = async () => {
//     return Tag.find({}).populate('dependencies.tag');
// }

// exports.new_tag = async (res, title, dependency_names) => {
//     if (dependency_names === "undefined") dependency_names = [];
//     let dependencies = dependency_names.map(async function(t) {
//         let tag = await get_tag(t).exec();
//         return tag;
//     })
//     let tag = Tag({
//         title: title,
//         dependencies : dependencies
//     });
//     await tag.save();
//     res.send('Created new tag: ' + tag);
// }

// exports.delete_tag = async (title) => {
//     let tag = Tag.findOne({title : title}).populate('dependencies.tag');
//     let deps = tag.dependencies;
//     var dependents = Tag.find({dependencies : title}).populate('dependencies.tag');  // this may only hold up to 20 matches
//     // sever dependencies on TAG and push TAG's parents to be parents of each of TAG's children
//     dependents.forEach(function(t){
//         remove_dependency(t.title, title);
//         Array.prototype.push.apply(t.dependencies, deps);
//     });
//     Tag.deleteOne({title : title});
// }

// exports.remove_dependency = async (tag_name, dependency_name) => {
//     let tag = Tag.findOne({title : tag_name}).populate('dependencies.tag');
//     let dep = Tag.findOne({title: dependency_name}).populate('dependencies.tag');
//     let i = tag.dependencies.indexOf(dep);  // will this work as expected? I don't know how JS handles identity of database documents
//     if (i < 0) {
//         throw new Error(`${tag_name} not dependent on ${dependency_name}`);
//     };
//     tag.dependencies.splice(i, 1);
// }

module.exports = router;