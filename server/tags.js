let Tag = require('../models/tags');

exports.get_tag = async (title) => {
    return Tag.findOne({title: title}).populate('dependencies.tag');
}

exports.get_all_tags = async () => {
    return Tag.find({}).populate('dependencies.tag');
}

exports.new_tag = async (res, title, dependency_names) => {
    let dependencies = dependency_names.map(function(t) {
        let tag = await get_tag(t).exec();
        return tag;
    })
    let tag = Tag({
        title: title,
        dependencies : dependencies
    });
    await tag.save();
    res.send('Created new tag: ' + tag);
}