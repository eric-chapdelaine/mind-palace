const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
// const Meal = require("./models/meal");
// const MealEntry = require("./models/mealentry");

const {MONGO_URL, port, CLIENT_URL} = require("./config");

const app = express();

mongoose.connect(MONGO_URL);

app.use(express.json());

app.use(cors({
  credentails: true,
  origin: [CLIENT_URL]
}));

app.get("/", (_, res) => {
  res.send("success!");
  res.end()
});

let server = app.listen(port, () => {
  console.log(`Server starting at localhost:${port}`);
});

module.exports = server;