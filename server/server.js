const express = require("express");
const app = express();
const port = 8000;
 
//middleware
app.use(express.json());
 
app.listen(port, () => {
  console.log("Server is running on port 3001");
});
 
module.exports = app;

const mongoose = require("mongoose");
//configure mongoose
const mongoDB = "mongodb://127.0.0.1:27017/my_library_db";
mongoose.connect(
  mongoDB,
  {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  },
  (err) => {
    if (err) {
      console.log(err);
    } else {
      console.log("Connected to MongoDB");
    }
  }
);