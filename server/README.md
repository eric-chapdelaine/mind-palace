# Test Data

By default, the MongoDB service will run on 127.0.0.1, port 27017 (or just `mongo` if using docker compose). We can populate the collections with test data with the following command:

$ node insert_sample_data.js "mongodb://127.0.0.1:27017/my_library_db"

At any point, we can delete all data in the database and start afresh by using the following command:

$ node remove_db.js "mongodb://127.0.0.1:27017/my_library_db".

## Endpoints

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

* POST `/activitytype/` - Create activity type
    * takes in `{name}`
* GET `/activitytype/:id`  - Get info on activity type
* GET `/activitytype/` - Get list of all activitiy types
* POST `/activitytype/:id/rename` - Rename given activity type
    * takes in `{name}`
* DELETE `/activitytype/:id` - Deletes given activity

### Tags

* POST `/tags/` - Create new tag
    * takes in `{title, dependencies}`
* GET `/tags/:id` - Get info on tag
* GET `/tags/` - Get info on all tags
* POST `/tags/:id/rename` - Renames given tag
    * takes in `{name}`
* POST `/tags/:id/add_dependency` - Add another tag to the given tags dependency list - UNIMPLEMENTED
    * takes in `{tag_id}`
* POST `/tags/:id/remove_dependency` - Removes another tag from the given tags dependency list - UNIMPLEMENTED
    * takes in `{tag_id}`
* DELETE `/tags/:id` - Deletes the given tag

### Tasks

* POST `/tasks/` - Creates a new task
    * Takes in `{title, due_date, tags, description, activities}`
* GET `/tasks/:id` - Read info on given task
* GET `/tasks/` - Read info on all tasks
* POST `/tasks/:id` - Updates given task with new info
    * Takes in `{title, due_date, tags, description, activities}`
* POST `/tasks/:id/add_tag` - Add a tag to the given task
    * Takes in `{tag_id}`
* DELETE `/tasks/:id/` - Delete given task