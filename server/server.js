const express = require("express");
const app = express();
const mongoose = require("mongoose");

const {MONGO_URL, port, CLIENT_URL} = require("./config");
 
mongoose.connect(MONGO_URL);

mongoose.connection.on("error", err => {
  console.error('Mongoose connection error:', err);
});

mongoose.connection.on("connected", () => {
  console.log('Mongoose connected!');
})

//middleware
app.use(express.json());
 
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

const activityTypeController = require("./controller/activitytypes");
const tagsController = require("./controller/tags");
const taskController = require("./controller/tasks");

app.use('/activity_type', activityTypeController);
app.use('/tag', tagsController);
app.use('/task', taskController);
 
app.get("/", (_, res) => {
  res.send("success!");
  res.end()
});

module.exports = app;