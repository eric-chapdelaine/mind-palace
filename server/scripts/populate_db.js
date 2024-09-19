import _axios from "axios";

// Assumes you are calling this from the host machine
const API_URL = "http://localhost:8000"

const api = _axios.create();

// Create tags

const tag1 = await api.post(`${API_URL}/tag`, {
    title: "University"
});

const tag2 = await api.post(`${API_URL}/tag`, {
    title: "Wayfair"
});

const tag3 = await api.post(`${API_URL}/tag`, {
    title: "Random",
});

const tag4 = await api.post(`${API_URL}/tag`, {
    title: "Class 1",
    dependencies: [tag1.data.tag._id]
});

// Create activity types

const activity_type_1 = await api.post(`${API_URL}/activity_type`, {
    name: "Researching"
});

const activity_type_2 = await api.post(`${API_URL}/activity_type`, {
    name: "Story Work"
});

const activity_type_3 = await api.post(`${API_URL}/activity_type`, {
    name: "Planning"
});

const activity_type_4 = await api.post(`${API_URL}/activity_type`, {
    name: "Grocery Shopping"
});

// Create tasks

const task1 = await api.post(`${API_URL}/task`, {
    title: 'HW1',
    due_date: new Date(2024, 9, 20),
    tags: [tag4.data.tag._id],
    description: "The first homework for Class 1!",
    is_completed: true
});

const task2 = await api.post(`${API_URL}/task`, {
    title: 'Get next week\'s meals',
    tags: [tag3.data.tag._id],
    description: "Everything involved with cooking for the next week",
});

const task3 = await api.post(`${API_URL}/task`, {
    title: 'Finish some feature',
    due_date: new Date(2024, 9, 21, 17, 0, 0),
    tags: [tag2.data.tag._id],
    description: "Some feature for Wayfair",
});

// Create activities

const activity1 = await api.post(`${API_URL}/activity`, {
    activity_type_id: activity_type_1.data.activity_type._id,
    task_id: task1.data.task._id,
});

const activity2 = await api.post(`${API_URL}/activity`, {
    activity_type_id: activity_type_2.data.activity_type._id,
    task_id: task3.data.task._id,
    feel_answer: 3
});

const activity3 = await api.post(`${API_URL}/activity`, {
    activity_type_id: activity_type_3.data.activity_type._id,
    task_id: task2.data.task._id,
});

const activity4 = await api.post(`${API_URL}/activity`, {
    activity_type_id: activity_type_4.data.activity_type._id,
    task_id: task2.data.task._id,
});

// Create time blocks

// Plan meals
const time_block_1 = await api.post(`${API_URL}/activity/${activity3.data._id}/schedule`, {
    start_time: new Date(2024, 9, 20, 17, 0),
    end_time: new Date(2024, 9, 20, 17, 30),
});

// Go grocery shopping
const time_block_2 = await api.post(`${API_URL}/activity/${activity3.data._id}/schedule`, {
    start_time: new Date(2024, 9, 21, 12, 0),
    end_time: new Date(2024, 9, 21, 12, 45),
});

// Create time entry

// actually went grocery shopping a bit later

const time_entry_1 = await api.post(`${API_URL}/activity/${activity3.data._id}/log_time`, {
    start_time: new Date(2024, 9, 21, 1, 0),
    end_time: new Date(2024, 9, 21, 1, 50),
    description: "went grocery shopping for planned meals. total was $85"
});