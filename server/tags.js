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

exports.delete_tag = async (title) => {
    // sever all dependencies on this tag and then delete it
    var dependents = Tag.find({dependencies : title});
    for (let t of dependents) {
        remove_dependency(title, t);
    };
    Tag.deleteOne({title : title});
}

exports.remove_dependency = async (tag_name, dependency_name) => {
    let tag = Tag.findOne({title : tag_name}).populate('dependencies.tag');
    let dep = Tag.findOne({title: dependency_name}).populate('dependencies.tag');
    let i = tag.dependencies.indexOf(dep);  // will this work as expected? I don't know how JS handles identity of database documents
    tag.dependencies.splice(i, 1);
}