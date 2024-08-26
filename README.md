# Mind Palace!

Object types (a high-level description of what is described in `./server/models/schema`):

## Task: A goal which requires action. 
* Example: submit HW1 for CS101
* Has:
    * due date/end date
    * tags
    * title
    * description
    * activities
    * list of URI (either websites or links to files)
## Activities: the thematic action to be done. 
* Examle: Researching, Writing, etc.
* Has:
    * name
* Relationship with task:
    * Scheduled times (list)
    * Estimated time left
    * isDone?
    * feel_number


## Tags: A short, hierarchical description which helps describe the context of a particular task
* Example: CS101, Univerity, etc.
* Has:
    * Name
    * Dependencies

## Time Entry: A logged or planned instance of a particular activitity in relation to a task
* Example: "On Sunday at 1pm to 2pm, start researching for HW1 for CS101", "On Monday between 3pm - 5pm, I worked on xyz"
* Has:
    * Title
    * Activity
    * Task
    * Date and time
