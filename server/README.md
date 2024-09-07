# Test Data

By default, the MongoDB service will run on 127.0.0.1, port 27017 (or just `mongo` if using docker compose). We can populate the collections with test data with the following command:

$ node insert_sample_data.js "mongodb://127.0.0.1:27017/my_library_db"

At any point, we can delete all data in the database and start afresh by using the following command:

$ node remove_db.js "mongodb://127.0.0.1:27017/my_library_db".

## endpoints

### Activity

* POST `/activity/` - Creates a new activity instance
    * takes in `{activity_id, task_id, scheduled_times feel_answer}` (but anything can be undefined)

* GET `/activity/` - Reads info about all activities
* GET `/activity/:id` - Reads info about the requested activity
* POST `/activity/:id` - Updates the given activity
    * takes in `{activity_id, task_id, scheduled_times feel_answer}` (anything left undefined will stay the same)
* POST `/activity/:id/schedule` - Updates the list of scheduled times with a new time block
    * takes in `{start_time, end_time}`
* DELETE `/activity/:id` - Deletes the given activity

### Activty Type

CRUD

* create - create activity type
* read - get info on particular activity type
* read - list all activity types
* update - change name
* delete - delete activity type