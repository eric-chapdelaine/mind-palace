import { REACT_APP_API_URL, api} from "./config";

const TASK_API_URL = `${REACT_APP_API_URL}/task`;

export const getTasks = async () => {
    let res = await api.get(TASK_API_URL);
    return res.data;
}

export const updateTask = async (id, updated_task) => {
    let res = await api.post(`${TASK_API_URL}/${id}`, updated_task);
    return res.data;
}
