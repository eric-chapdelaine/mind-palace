import { REACT_APP_API_URL, api } from "./config";

const ACTIVITY_API_URL = `${REACT_APP_API_URL}/activity`;

export const getActivity = async (id) => {
    let res = await api.get(`${ACTIVITY_API_URL}/${id}`);
    return res.data;
}