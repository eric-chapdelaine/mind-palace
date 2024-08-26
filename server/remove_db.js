// Pass URL of your mongoDB instance as first argument
let userArgs = process.argv.slice(2);
let mongoose = require('mongoose');
let mongoDB = userArgs[0];
mongoose.connect(mongoDB);
let db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));

const clearDatabase = async () => {
    // Clear each collection
    await db.dropDatabase();

    console.log('Database cleared');
    if (db) db.close();
}

clearDatabase()
    .catch((err) => {
        console.log('ERROR: ' + err);
        if (db) db.close();
    });

console.log('Processing ...');