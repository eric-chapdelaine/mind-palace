const _axios = require("axios");

// Assumes you are calling this from the host machine
const API_URL = "http://localhost:8000"

const api = _axios.create();

const main = async () => {

    const tasks = await api.get(`${API_URL}/task`);
    const completed_tasks = Array.from(tasks.data).filter((t) => t.is_completed && !t.date_completed);

    for (let i = 0; i < completed_tasks.length; i++) {
        await api.post(`${API_URL}/task/${completed_tasks.data[i]._id}`, {
            is_completed: true
        });
    }
}

main();
