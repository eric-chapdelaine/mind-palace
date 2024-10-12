import { REACT_APP_API_URL, api} from "./config";

const TASK_API_URL = `${REACT_APP_API_URL}/task`;

export const getTasks = async () => {
    let res = await api.get(TASK_API_URL);
    return res.data;
}