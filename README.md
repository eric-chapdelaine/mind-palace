# Test Data

We can populate the collections with test data with the following command:

$ node insert_sample_data.js "mongodb://127.0.0.1:27017/my_library_db"

At any point, we can delete all data in the database and start afresh by using the following command:

$ node remove_db.js "mongodb://127.0.0.1:27017/my_library_db".