console.log(
    'Populates some sample tasks and activities. Specified database as argument - e.g.: node populatedb "mongodb://127.0.0.1:27017/my_library_db"'
);

// Get arguments passed on command line
const userArgs = process.argv.slice(2);
  
const Task = require("./server/models/tasks");
const Tag = require("./server/models/tags");
const ActivityType = require("./server/models/activitytypes");
  
const tasks = [];
const tags = [];
const activitytypes = [];
  
const mongoose = require("mongoose");
mongoose.set("strictQuery", false); // Prepare for Mongoose 7
  
const mongoDB = userArgs[0];
  
main().catch((err) => console.log(err));
  
async function main() {
    console.log("Debug: About to connect");
    await mongoose.connect(mongoDB);
    console.log("Debug: Should be connected?");
    await createTasks();
    console.log("Debug: Closing mongoose");
    mongoose.connection.close();
}

async function taskCreate(title, due_date, tags, description, activities) {
    task_details = {title: title, description : description};
    if (due_date != false) task_details.due_date = due_date;
    if (tags != false) task_details.tags = tags;
    if (activities != false) task_details.activities = activities;
    const task = new Task(task_details);
    await task.save();
    tasks.push(task);
    console.log(`Added task: ${title}`);
}

async function createTasks() {
    console.log("Adding tasks");
    await Promise.all([
        taskCreate("CS101 HW1", false, false, "Easy", false),
        taskCreate("CS61A Hog Project", false, false, "Medium", false),
        taskCreate("Math 110 Final Exam", false, false, "Hard", false)
    ]);
}