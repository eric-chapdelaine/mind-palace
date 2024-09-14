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
    dependencies: [tag2.data.tag._id]
});

// Create activity types

const activity_type_1 = await api.post(`${API_URL}/activity_type`, {
    name: "Researching"
});

const activity_type_2 = await api.post(`${API_URL}/activity_type`, {
    name: "Story Work"
});

// Create time blocks

const time_block_1 = await api.post(`${API_URL}/activity`, {
    start_time: new Date(2024, 9, 14, 8, 0),
    end_time: new Date(2024, 9, 14, 9, 0),
});

const time_block_2 = await api.post(`${API_URL}/activity`, {
    start_time: new Date(2024, 9, 14, 12, 0),
    end_time: new Date(2024, 9, 14, 15, 0),
});

// Create activities

console.log(activity_type_1);
// const activity_1 = await api.post(`${API_URL}/activity`, {
//     activity_type_id: activity_type_1.data.
// });

// Create tasks

// Create time entry