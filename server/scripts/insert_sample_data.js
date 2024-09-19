const {MONGO_URL} = require("../config");

const Task = require("./models/tasks");
const Tag = require("./models/tags");
const ActivityType = require("./models/activitytypes");
  
const tasks = [];
const tags = [];
const activitytypes = [];
  
const mongoose = require("mongoose");
mongoose.set("strictQuery", false); // Prepare for Mongoose 7
  
main().catch((err) => console.log(err));
  
async function main() {
    console.log("Debug: About to connect");
    await mongoose.connect(MONGO_URL);
    console.log("Debug: Should be connected");
    await createTasks();
    console.log("Debug: Closing mongoose");
    mongoose.connection.close();
}

async function taskCreate(title, due_date, tags, description, activities) {
    let task_details = {title: title, description : description};
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