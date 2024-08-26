const express = require("express");
const app = express();
const mongoose = require("mongoose");

const {MONGO_URL, port, CLIENT_URL} = require("./config");
 
mongoose.connect(MONGO_URL, 
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
  });

//middleware
app.use(express.json());
 
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
 
app.get("/", (_, res) => {
  res.send("success!");
  res.end()
});

module.exports = app;